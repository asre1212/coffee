const FIELD_KEYS = ["name", "roaster", "countries", "altitude", "roast", "caffeine", "instructions"];

const STATUS_VALUES = new Set(["found", "inferred", "conflict", "not_found"]);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.COFFEE_LOOKUP_ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function extractOutputText(response) {
  if (response && typeof response.output_text === "string") return response.output_text;

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.value === "string") chunks.push(content.value);
    }
  }
  return chunks.join("\n");
}

function parseJsonObject(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Lookup returned an unreadable response.");
  return JSON.parse(match[0]);
}

function normalizeStatus(status, value) {
  const clean = String(status || "").toLowerCase().replace(/-/g, "_");
  if (STATUS_VALUES.has(clean)) return clean;
  const hasValue = Array.isArray(value) ? value.length > 0 : String(value || "").trim().length > 0;
  return hasValue ? "found" : "not_found";
}

function normalizeField(rawField, key) {
  const raw = rawField && typeof rawField === "object" && !Array.isArray(rawField)
    ? rawField
    : { value: rawField };
  let value = raw.value;

  if (key === "countries") {
    value = Array.isArray(value)
      ? value.map(String).map(v => v.trim()).filter(Boolean)
      : String(value || "").split(",").map(v => v.trim()).filter(Boolean);
  } else if (key === "roast") {
    const roast = String(value || "").toLowerCase();
    value = ["light", "medium", "dark"].includes(roast) ? roast : "";
  } else if (key === "caffeine") {
    const caffeine = String(value || "").toLowerCase();
    value = caffeine.includes("decaf") ? "decaf" : (caffeine ? "caffeine" : "");
  } else {
    value = String(value || "").trim();
  }

  return {
    value,
    status: normalizeStatus(raw.status, value),
    confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : null,
    note: String(raw.note || raw.notes || "").trim(),
    sources: Array.isArray(raw.sources) ? raw.sources.map(String).filter(Boolean).slice(0, 5) : [],
  };
}

function normalizeLookupPayload(payload) {
  const rawFields = payload && payload.fields && typeof payload.fields === "object" ? payload.fields : {};
  const fields = {};
  FIELD_KEYS.forEach(key => {
    fields[key] = normalizeField(rawFields[key], key);
  });

  const sourceSet = new Set(Array.isArray(payload.sources) ? payload.sources.map(String).filter(Boolean) : []);
  FIELD_KEYS.forEach(key => {
    fields[key].sources.forEach(url => sourceSet.add(url));
  });

  return {
    summary: String(payload.summary || "").trim(),
    fields,
    sources: Array.from(sourceSet).slice(0, 5),
    rawText: String(payload.rawText || payload.raw_text || "").trim(),
  };
}

async function requestLookup({ image, fileName, toolType }) {
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const prompt = [
    "You help fill a personal coffee log from a coffee bag photo.",
    "Read visible label text, then use web search to identify the exact roasted coffee when possible.",
    "Return only JSON with this shape:",
    "{",
    '  "summary": "short human-readable lookup summary",',
    '  "fields": {',
    '    "name": {"value": "", "status": "found|inferred|conflict|not_found", "confidence": 0, "note": "", "sources": []},',
    '    "roaster": {"value": "", "status": "found|inferred|conflict|not_found", "confidence": 0, "note": "", "sources": []},',
    '    "countries": {"value": [], "status": "found|inferred|conflict|not_found", "confidence": 0, "note": "", "sources": []},',
    '    "altitude": {"value": "", "status": "found|inferred|conflict|not_found", "confidence": 0, "note": "", "sources": []},',
    '    "roast": {"value": "light|medium|dark|", "status": "found|inferred|conflict|not_found", "confidence": 0, "note": "", "sources": []},',
    '    "caffeine": {"value": "caffeine|decaf|", "status": "found|inferred|conflict|not_found", "confidence": 0, "note": "", "sources": []},',
    '    "instructions": {"value": "", "status": "found|inferred|conflict|not_found", "confidence": 0, "note": "", "sources": []}',
    "  },",
    '  "sources": [],',
    '  "rawText": "important text read from the bag"',
    "}",
    "Use found for facts directly visible on the bag or confirmed on a matching roaster/product page.",
    "Use inferred only for cautious inferences, such as roast level from roaster language.",
    "Use conflict when sources disagree. Use not_found rather than guessing.",
    "For instructions, prefer tasting notes, processing details, or brew guidance from the bag or product page.",
    `Image filename: ${fileName || "coffee-bag.jpg"}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      tools: [{ type: toolType, search_context_size: "medium" }],
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: image, detail: "high" },
          ],
        },
      ],
      max_output_tokens: 1800,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error && payload.error.message ? payload.error.message : "OpenAI lookup failed.";
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST for coffee bag lookup." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured for the lookup endpoint." });
    return;
  }

  const body = getBody(req);
  const image = String(body.image || "");
  if (!image.startsWith("data:image/")) {
    res.status(400).json({ error: "Expected a base64 data URL image." });
    return;
  }

  if (image.length > 5_000_000) {
    res.status(413).json({ error: "Image is too large after compression. Try a closer crop of the bag." });
    return;
  }

  try {
    let openaiResponse;
    try {
      openaiResponse = await requestLookup({
        image,
        fileName: body.fileName,
        toolType: "web_search",
      });
    } catch (err) {
      const text = JSON.stringify(err.payload || {}) + " " + err.message;
      if (!/web_search/i.test(text)) throw err;
      openaiResponse = await requestLookup({
        image,
        fileName: body.fileName,
        toolType: "web_search_preview",
      });
    }

    const text = extractOutputText(openaiResponse);
    const parsed = parseJsonObject(text);
    res.status(200).json(normalizeLookupPayload(parsed));
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message || "Coffee lookup failed." });
  }
};
