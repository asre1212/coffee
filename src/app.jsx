    const { useState, useEffect } = React;

    const STORAGE_KEY = "coffee-gazette-data-v3";

    const BREW_METHODS = [
      { key: "pourover", label: "Pour Over", shortLabel: "POUR OVER", icon: "▲" },
      { key: "espresso", label: "Espresso", shortLabel: "ESPRESSO", icon: "◉" },
      { key: "frenchpress", label: "French Press", shortLabel: "FRENCH PRESS", icon: "▤" },
    ];
    const methodLabel = (key) => (BREW_METHODS.find(m => m.key === key) || BREW_METHODS[0]).label;
    const methodShortLabel = (key) => (BREW_METHODS.find(m => m.key === key) || BREW_METHODS[0]).shortLabel;

    const SAMPLE_DATA = {
      pourover: [],
      espresso: [],
      frenchpress: [],
      beans: [],
      notes: "",
    };

    const randomSuffix = () => Math.random().toString(36).slice(2, 8);
    const makeBeanId = () => `bean-${Date.now()}-${randomSuffix()}`;
    const makeEntryId = () => `${Date.now()}-${randomSuffix()}`;
    const beanFactsFromEntry = (entry) => ({
      name: entry.name || "",
      roaster: entry.roaster || "",
      countries: Array.isArray(entry.countries) ? entry.countries : [],
      altitude: entry.altitude || "",
    });
    const withBeanFacts = (entry, beansById) => {
      const { id: _beanRecordId, ...beanFacts } = beansById[entry.beanId] || {};
      return {
        ...entry,
        ...beanFacts,
        id: entry.id,
      };
    };

    function normalizeData(raw) {
      const base = raw && typeof raw === "object" ? raw : {};
      const beansById = {};
      const usedKeys = {};
      const beans = Array.isArray(base.beans) ? base.beans.map(bean => {
        const id = bean.id || makeBeanId();
        const normalized = { id, ...beanFactsFromEntry(bean) };
        beansById[id] = normalized;
        return normalized;
      }) : [];

      const normalizeEntry = (entry) => {
        const beanId = entry.beanId || makeBeanId();
        if (!beansById[beanId]) {
          beansById[beanId] = { id: beanId, ...beanFactsFromEntry(entry) };
          beans.push(beansById[beanId]);
        }
        return {
          ...entry,
          id: entry.id || makeEntryId(),
          beanId,
          rating: typeof entry.rating === "number" ? entry.rating : 4,
          roast: entry.roast || "light",
          caffeine: entry.caffeine || "caffeine",
          instructions: entry.instructions || "",
        };
      };

      const normalized = {
        beans,
        notes: typeof base.notes === "string" ? base.notes : "",
      };

      BREW_METHODS.forEach(method => {
        normalized[method.key] = Array.isArray(base[method.key])
          ? base[method.key].map(normalizeEntry)
          : [];
      });

      beans.forEach(bean => {
        const key = [
          (bean.name || "").trim().toLowerCase(),
          (bean.roaster || "").trim().toLowerCase(),
        ].join("|");
        if (key !== "|" && usedKeys[key]) {
          const canonicalId = usedKeys[key];
          BREW_METHODS.forEach(method => {
            normalized[method.key] = normalized[method.key].map(entry =>
              entry.beanId === bean.id ? { ...entry, beanId: canonicalId } : entry
            );
          });
        } else if (key !== "|") {
          usedKeys[key] = bean.id;
        }
      });

      const referencedIds = new Set(BREW_METHODS.flatMap(method => normalized[method.key].map(entry => entry.beanId)));
      normalized.beans = beans.filter(bean => referencedIds.has(bean.id));
      return normalized;
    }

    // ── IndexedDB mirror ────────────────────────────────────────────────────
    // localStorage can be evicted by the browser; every save is mirrored to
    // IndexedDB (stronger persistence guarantees) and restored from there if
    // localStorage comes up empty.
    const IDB_NAME = "coffee-gazette";
    const IDB_STORE = "kv";
    function idbOpen() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") { reject(new Error("no-idb")); return; }
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    async function idbSet(key, value) {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    }
    async function idbGet(key) {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    }

    // Set when the app boots with no saved data, so the IndexedDB mirror can
    // be consulted once after mount (the save-on-change effect repopulates
    // localStorage immediately, so this can't be re-checked later).
    let bootedFromEmptyStorage = false;
    // While a restore from IndexedDB may still happen, mirror writes are
    // suspended so the initial empty state can't clobber the mirror first.
    let idbRestorePending = false;

    function loadData() {
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      bootedFromEmptyStorage = !saved;
      idbRestorePending = bootedFromEmptyStorage;
      try {
        return normalizeData(saved ? JSON.parse(saved) : SAMPLE_DATA);
      } catch (e) {
        return normalizeData(SAMPLE_DATA);
      }
    }

    function saveData(data) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {}
      if (!idbRestorePending) {
        idbSet(STORAGE_KEY, data).catch(() => {});
      }
    }

    // ── Backup recency ──────────────────────────────────────────────────────
    const LAST_BACKUP_KEY = "coffee-gazette-last-backup";
    const markBackupDone = () => {
      try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch (e) {}
    };
    const lastBackupAt = () => {
      try {
        const v = parseInt(localStorage.getItem(LAST_BACKUP_KEY), 10);
        return isNaN(v) ? null : v;
      } catch (e) {
        return null;
      }
    };

    const ROAST_ORDER = ["light", "medium", "dark"];

    const defaultForm = {
      name: "",
      roaster: "",
      roast: "light",
      rating: 4.0,
      caffeine: "caffeine",
      instructions: "",
      countries: [],
      altitude: "",
      beanId: "",
    };

    // Parse a free-text MASL string ("1750", "1500-1800", "1500m") into a
    // numeric value used for sorting. Returns null when no number found.
    function parseMASL(str) {
      if (str == null) return null;
      const matches = String(str).match(/\d+(?:\.\d+)?/g);
      if (!matches || !matches.length) return null;
      const nums = matches.map(Number).filter(n => !isNaN(n));
      return nums.length ? Math.max(...nums) : null;
    }

    const formatDate = () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
      }).toUpperCase();

    // Coffee bean SVG — supports partial fill for decimals
    function BeanIcon({ filled = true, partial = 0, size = 16 }) {
      const uid = React.useId ? React.useId() : Math.random().toString(36).slice(2);
      const clipId = `bc-${uid}`;
      const fillWidth = filled ? 24 : partial * 24;
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={fillWidth} height="24" />
            </clipPath>
          </defs>
          <ellipse cx="12" cy="12" rx="7" ry="10" stroke="#8B5E3C" strokeWidth="1.5" fill="#F9F9F7" transform="rotate(-20 12 12)" />
          <path d="M9 6 Q14 12 9 18" stroke="#8B5E3C" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <g clipPath={`url(#${clipId})`}>
            <ellipse cx="12" cy="12" rx="7" ry="10" fill="#8B5E3C" transform="rotate(-20 12 12)" />
            <path d="M9 6 Q14 12 9 18" stroke="#F9F9F7" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </g>
        </svg>
      );
    }

    function BeanRating({ rating, size = 16 }) {
      const beans = [];
      for (let i = 1; i <= 5; i++) {
        if (i <= Math.floor(rating)) {
          beans.push(<BeanIcon key={i} filled={true} size={size} />);
        } else if (i === Math.ceil(rating) && rating % 1 > 0) {
          beans.push(<BeanIcon key={i} filled={false} partial={rating % 1} size={size} />);
        } else {
          beans.push(<BeanIcon key={i} filled={false} partial={0} size={size} />);
        }
      }
      return <div className="bean-icons-row">{beans}</div>;
    }

    const COFFEE_COUNTRIES = [
      "Bolivia","Brazil","Burundi","China","Colombia","Congo",
      "Costa Rica","Cuba","Ecuador","El Salvador","Ethiopia",
      "Guatemala","Haiti","Honduras","India","Indonesia","Jamaica",
      "Kenya","Laos","Madagascar","Malawi","Mexico","Myanmar",
      "Nicaragua","Panama","Papua New Guinea","Peru","Philippines",
      "Rwanda","Tanzania","Thailand","Timor-Leste","Uganda",
      "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
    ];

    function CountrySelector({ selected, onChange }) {
      const [query, setQuery] = useState("");

      const filtered = query.trim()
        ? COFFEE_COUNTRIES.filter(c =>
            c.toLowerCase().includes(query.toLowerCase()) && !selected.includes(c)
          )
        : COFFEE_COUNTRIES.filter(c => !selected.includes(c));

      const showAddCustom =
        query.trim() &&
        !COFFEE_COUNTRIES.some(c => c.toLowerCase() === query.toLowerCase()) &&
        !selected.some(c => c.toLowerCase() === query.toLowerCase());

      const toggle = (country) => {
        if (selected.includes(country)) {
          onChange(selected.filter(c => c !== country));
        } else {
          onChange([...selected, country]);
          setQuery("");
        }
      };

      const addCustom = () => {
        const val = query.trim();
        if (val && !selected.includes(val)) {
          onChange([...selected, val]);
        }
        setQuery("");
      };

      return (
        <div>
          {selected.length > 0 && (
            <div className="country-selected-chips">
              {selected.map(c => (
                <span key={c} className="country-chip">
                  {c}
                  <button className="country-chip-remove" aria-label={`Remove ${c}`} onClick={() => toggle(c)}>✕</button>
                </span>
              ))}
            </div>
          )}
          <input
            className="country-search"
            placeholder="Search or type a country…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="country-list">
            {filtered.slice(0, 40).map(c => (
              <button
                type="button"
                key={c}
                className={`country-list-item${selected.includes(c) ? " selected" : ""}`}
                onClick={() => toggle(c)}
              >
                {c}
              </button>
            ))}
            {showAddCustom && (
              <button type="button" className="country-list-item add-custom" onClick={addCustom}>
                + Add "{query.trim()}"
              </button>
            )}
            {filtered.length === 0 && !showAddCustom && (
              <div className="country-list-item" style={{color:"#A3A3A3",fontStyle:"italic",cursor:"default"}}>
                No matches
              </div>
            )}
          </div>
        </div>
      );
    }

    // ── Export: download all data as a .json file ──────────────────────────
    function exportData(data) {
      const payload = {
        _app: "coffee-gazette",
        _version: 3,
        _exported: new Date().toISOString(),
        ...normalizeData(data),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coffee-gazette-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      markBackupDone();
    }

    // ── Lazy-load the XLSX library (~900 KB) only when an export is requested
    let xlsxPromise = null;
    function loadXLSX() {
      if (window.XLSX) return Promise.resolve(window.XLSX);
      if (!xlsxPromise) {
        xlsxPromise = new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "vendor/xlsx.full.min.js";
          s.onload = () => resolve(window.XLSX);
          s.onerror = () => { xlsxPromise = null; reject(new Error("xlsx-load-failed")); };
          document.head.appendChild(s);
        });
      }
      return xlsxPromise;
    }

    // ── Export to Excel (.xlsx) ─────────────────────────────────────────────
    async function exportToExcel(data) {
      const XLSX = await loadXLSX();
      const normalized = normalizeData(data);
      const beansById = Object.fromEntries((normalized.beans || []).map(bean => [bean.id, bean]));
      const toRows = (entries, method) =>
        entries.map(entry => {
          const b = withBeanFacts(entry, beansById);
          return ({
          "Method":          method,
          "Bean Name":       b.name,
          "Roaster":         b.roaster || "",
          "Roast Level":     b.roast ? b.roast.charAt(0).toUpperCase() + b.roast.slice(1) : "",
          "Caffeine":        b.caffeine === "decaf" ? "Decaf" : "Caffeinated",
          "Origin":          (b.countries || []).join(", "),
          "Altitude (MASL)": b.altitude || "",
          "Rating":          b.rating,
          "Instructions":    b.instructions || "",
        });
      });

      const allRows = BREW_METHODS.flatMap(method => toRows(normalized[method.key], method.label));

      const COLS = [10,22,20,12,13,30,16,8,40];

      const wb = XLSX.utils.book_new();

      // Sheet 1 — All beans
      const wsAll = XLSX.utils.json_to_sheet(allRows);
      wsAll["!cols"] = COLS.map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, wsAll, "All Beans");

      BREW_METHODS.forEach(method => {
        const ws = XLSX.utils.json_to_sheet(toRows(normalized[method.key], method.label));
        ws["!cols"] = COLS.map(w => ({ wch: w }));
        XLSX.utils.book_append_sheet(wb, ws, method.label);
      });

      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `coffee-gazette-${date}.xlsx`);
      markBackupDone();
    }

    // ── Import: read a .json file and restore data ──────────────────────────
    function importData(file, onSuccess, onError) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          // Accept both raw shape and exported shape with _meta keys.
          // An empty backup (fresh install) is still a valid backup.
          const looksLikeBackup = parsed && typeof parsed === "object" && (
            parsed._app === "coffee-gazette" ||
            Array.isArray(parsed.beans) ||
            BREW_METHODS.some(method => Array.isArray(parsed[method.key]))
          );
          if (!looksLikeBackup) {
            onError("This doesn't look like a Coffee Gazette backup file.");
            return;
          }
          onSuccess(normalizeData(parsed));
        } catch {
          onError("Could not read file. Make sure it's a Coffee Gazette backup.");
        }
      };
      reader.readAsText(file);
    }

    // Flatten every entry across all methods, with bean facts + method label
    function collectAllBeans(data, beansById) {
      return BREW_METHODS.flatMap(method =>
        (data[method.key] || []).map(entry => ({
          ...withBeanFacts(entry, beansById),
          method: method.label,
        }))
      );
    }

    // Shared row card for the Origin and Altitude roll-up views
    function AllBeansCard({ bean, extraTags, right }) {
      return (
        <div className="origin-bean-card">
          <div className="origin-bean-left">
            <div className="origin-bean-name">{bean.name}</div>
            {bean.roaster ? <div className="origin-bean-roaster">{bean.roaster}</div> : null}
            <div className="origin-bean-tags">
              <span className="origin-method-badge">{bean.method}</span>
              <span className="origin-method-badge">{bean.roast}</span>
              {extraTags}
            </div>
          </div>
          <div className="origin-bean-right">{right}</div>
        </div>
      );
    }

    function CoffeeLog() {
      const [activeTab, setActiveTab] = useState("espresso");
      const [data, setData] = useState(loadData);
      const [showForm, setShowForm] = useState(false);
      const [editingId, setEditingId] = useState(null);
      const [form, setForm] = useState(defaultForm);
      const [detailId, setDetailId] = useState(null);
      const [showSettings, setShowSettings] = useState(false);
      const [importMsg, setImportMsg] = useState(null); // { type: "success"|"error", text }
      const [showOrigin, setShowOrigin] = useState(false);
      const [showAltitude, setShowAltitude] = useState(false);
      const [notesOpen, setNotesOpen] = useState(false);
      const [search, setSearch] = useState("");
      const [confirmDelete, setConfirmDelete] = useState(false);
      const [excelBusy, setExcelBusy] = useState(false);
      const [excelMsg, setExcelMsg] = useState(null);
      const [backupAt, setBackupAt] = useState(lastBackupAt);

      useEffect(() => {
        saveData(data);
      }, [data]);

      // If localStorage was empty at boot, try the IndexedDB mirror once,
      // and ask the browser to protect our storage from eviction.
      useEffect(() => {
        let cancelled = false;
        if (bootedFromEmptyStorage) {
          idbGet(STORAGE_KEY)
            .then(saved => {
              idbRestorePending = false;
              if (!cancelled && saved) setData(normalizeData(saved));
            })
            .catch(() => { idbRestorePending = false; });
        }
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(() => {});
        }
        return () => { cancelled = true; };
      }, []);

      // Escape closes the topmost layer (form modal, settings, detail view)
      useEffect(() => {
        const onKeyDown = (e) => {
          if (e.key !== "Escape") return;
          if (showForm) { setShowForm(false); setEditingId(null); }
          else if (showSettings) setShowSettings(false);
          else if (detailId) setDetailId(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [showForm, showSettings, detailId]);

      // Delete needs a second tap to confirm; re-arm when the context changes
      useEffect(() => {
        setConfirmDelete(false);
      }, [detailId, activeTab]);

      const handleExport = () => {
        exportData(data);
        setBackupAt(lastBackupAt());
      };

      const handleExcelExport = () => {
        setExcelMsg(null);
        setExcelBusy(true);
        exportToExcel(data)
          .then(() => setBackupAt(lastBackupAt()))
          .catch(() => setExcelMsg({
            type: "error",
            text: "Couldn't load the spreadsheet library. Check your connection and try again.",
          }))
          .finally(() => setExcelBusy(false));
      };

      const refreshApp = async () => {
        try {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.update()));
          }
          if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
        } catch (e) {}
        window.location.reload();
      };

      const handleImportFile = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        importData(
          file,
          (newData) => {
            setData(prev => normalizeData({
              ...newData,
              notes: newData.notes !== undefined ? newData.notes : (prev.notes || ""),
            }));
            const totalEntries = BREW_METHODS.reduce((sum, method) => sum + newData[method.key].length, 0);
            setImportMsg({
              type: "success",
              text: totalEntries
                ? `Imported ${totalEntries} ${totalEntries === 1 ? "entry" : "entries"} successfully.`
                : "Imported backup — it contained no entries yet.",
            });
            e.target.value = "";
          },
          (errMsg) => {
            setImportMsg({ type: "error", text: errMsg });
            e.target.value = "";
          }
        );
      };

      const beansById = Object.fromEntries((data.beans || []).map(bean => [bean.id, bean]));
      const linkedBeanOptions = (data.beans || []).slice().sort((a, b) =>
        `${a.name} ${a.roaster}`.localeCompare(`${b.name} ${b.roaster}`)
      );
      const currentBeans = (data[activeTab] || []).map(entry => withBeanFacts(entry, beansById));

      const searchQuery = search.trim().toLowerCase();
      const visibleBeans = searchQuery
        ? currentBeans.filter(b =>
            [b.name, b.roaster, b.altitude, b.instructions, ...(b.countries || [])]
              .some(v => (v || "").toLowerCase().includes(searchQuery))
          )
        : currentBeans;

      const grouped = ROAST_ORDER.reduce((acc, roast) => {
        const items = visibleBeans
          .filter((b) => b.roast === roast)
          .sort((a, b) => b.rating - a.rating);
        if (items.length) acc[roast] = items;
        return acc;
      }, {});

      const openAdd = () => {
        setForm({ ...defaultForm });
        setEditingId(null);
        setShowForm(true);
      };

      const openEdit = (bean) => {
        setForm({ ...bean });
        setEditingId(bean.id);
        setShowForm(true);
        setDetailId(null);
      };

      const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
      };

      const saveForm = () => {
        if (!form.name.trim()) return;
        setData((prev) => {
          const beanId = form.beanId || makeBeanId();
          const beanFacts = {
            id: beanId,
            name: form.name.trim(),
            roaster: form.roaster.trim(),
            countries: form.countries || [],
            altitude: form.altitude || "",
          };
          const beans = prev.beans && prev.beans.some(bean => bean.id === beanId)
            ? prev.beans.map(bean => bean.id === beanId ? { ...bean, ...beanFacts } : bean)
            : [...(prev.beans || []), beanFacts];
          const entry = {
            id: editingId || makeEntryId(),
            beanId,
            roast: form.roast,
            rating: form.rating,
            caffeine: form.caffeine,
            instructions: form.instructions,
          };
          const list = [...(prev[activeTab] || [])];
          if (editingId) {
            const idx = list.findIndex((b) => b.id === editingId);
            if (idx !== -1) list[idx] = entry;
          } else {
            list.push(entry);
          }
          return normalizeData({ ...prev, beans, [activeTab]: list });
        });
        closeForm();
      };

      const deleteBean = (id) => {
        setData((prev) => normalizeData({
          ...prev,
          [activeTab]: (prev[activeTab] || []).filter((b) => b.id !== id),
        }));
        setDetailId(null);
      };

      const detailBean = currentBeans.find((b) => b.id === detailId);

      const totalEntryCount = BREW_METHODS.reduce((sum, method) => sum + (data[method.key] || []).length, 0);
      const backupAgeDays = backupAt ? Math.floor((Date.now() - backupAt) / 86400000) : null;
      const backupText = backupAt === null
        ? "No backup downloaded yet"
        : backupAgeDays === 0
          ? "Last backup: today"
          : `Last backup: ${backupAgeDays} ${backupAgeDays === 1 ? "day" : "days"} ago`;
      const backupWarn = totalEntryCount > 0 && (backupAt === null || backupAgeDays > 30);

      const switchTab = (tab) => {
        setActiveTab(tab);
        setDetailId(null);
        setShowOrigin(false);
        setShowAltitude(false);
        setSearch("");
      };

      const handleLinkedBeanChange = (beanId) => {
        if (!beanId) {
          setForm({ ...form, beanId: "" });
          return;
        }
        const bean = beansById[beanId];
        if (!bean) return;
        setForm({
          ...form,
          beanId,
          name: bean.name || "",
          roaster: bean.roaster || "",
          countries: bean.countries || [],
          altitude: bean.altitude || "",
        });
      };

      return (
        <div className="app">
          {/* Masthead */}
          <div className="masthead">
            <div className="masthead-overline">Daily Record</div>
            <div className="masthead-row">
              <div className="masthead-title">The Coffee Gazette</div>
              <button className="btn-settings" aria-label="Settings, export, and import" onClick={() => { setShowSettings(true); setImportMsg(null); setExcelMsg(null); setBackupAt(lastBackupAt()); }} title="Settings / Export / Import">
                ⚙
              </button>
            </div>
            <div className="masthead-sub">{formatDate()} · BREW LOG · EST. 2021</div>
          </div>

          {/* Tabs */}
          <div className="tab-bar">
            {BREW_METHODS.map(method => (
              <button
                key={method.key}
                className={`tab-btn ${activeTab === method.key ? "active" : ""}`}
                onClick={() => switchTab(method.key)}
              >
                {method.icon} {method.label}
              </button>
            ))}
          </div>

          {/* ── Origin view ─────────────────────────────────────────────── */}
          {showOrigin && (() => {
            const allBeans = collectAllBeans(data, beansById);

            // Build country → beans map; beans with no countries go under "Unspecified"
            const countryMap = {};
            allBeans.forEach(bean => {
              const cs = bean.countries && bean.countries.length > 0 ? bean.countries : ["Unspecified"];
              cs.forEach(c => {
                if (!countryMap[c]) countryMap[c] = [];
                countryMap[c].push(bean);
              });
            });

            // Sort countries alphabetically, Unspecified last
            const sortedCountries = Object.keys(countryMap).sort((a, b) => {
              if (a === "Unspecified") return 1;
              if (b === "Unspecified") return -1;
              return a.localeCompare(b);
            });

            const totalCountries = sortedCountries.filter(c => c !== "Unspecified").length;

            return (
              <>
                <div className="origin-close-bar">
                  <button className="btn-origin-close" onClick={() => setShowOrigin(false)}>
                    ← Back to {methodLabel(activeTab)}
                  </button>
                </div>
                <div className="origin-summary-bar">
                  <span className="origin-summary-text">{totalCountries} ORIGINS · {allBeans.length} TOTAL ENTRIES</span>
                  <span className="origin-summary-text">ALL METHODS</span>
                </div>
                {allBeans.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-title">No beans logged yet.</div>
                    <div className="empty-state-sub">Add entries in any brew method tab.</div>
                  </div>
                ) : (
                  sortedCountries.map(country => {
                    const beans = countryMap[country].sort((a, b) => b.rating - a.rating);
                    const avg = (beans.reduce((s, b) => s + b.rating, 0) / beans.length);
                    return (
                      <div key={country}>
                        <div className="origin-country-header">
                          <div className="origin-country-name">{country}</div>
                          <div className="origin-country-meta">
                            AVG {avg.toFixed(2)} · {beans.length} {beans.length === 1 ? "BEAN" : "BEANS"}
                          </div>
                        </div>
                        {beans.map(bean => (
                          <AllBeansCard
                            key={bean.id + country}
                            bean={bean}
                            extraTags={
                              <span className={bean.caffeine === "decaf" ? "decaf-badge" : "caff-badge"} style={{fontSize:"8px"}}>
                                {bean.caffeine === "decaf" ? "Decaf" : "Caff"}
                              </span>
                            }
                            right={<>
                              <BeanRating rating={bean.rating} size={12} />
                              <span className="rating-num">{bean.rating.toFixed(2)}</span>
                            </>}
                          />
                        ))}
                      </div>
                    );
                  })
                )}
              </>
            );
          })()}

          {/* ── Altitude (MASL) view ────────────────────────────────────── */}
          {showAltitude && (() => {
            const allBeans = collectAllBeans(data, beansById);

            // Split into beans with parsed MASL and those without; sort numeric desc
            const withAlt = [];
            const withoutAlt = [];
            allBeans.forEach(b => {
              const v = parseMASL(b.altitude);
              if (v != null) withAlt.push({ bean: b, masl: v });
              else withoutAlt.push(b);
            });
            withAlt.sort((a, b) => b.masl - a.masl);

            return (
              <>
                <div className="origin-close-bar">
                  <button className="btn-origin-close" onClick={() => setShowAltitude(false)}>
                    ← Back to {methodLabel(activeTab)}
                  </button>
                </div>
                <div className="origin-summary-bar">
                  <span className="origin-summary-text">{withAlt.length} WITH ALTITUDE · {allBeans.length} TOTAL ENTRIES</span>
                  <span className="origin-summary-text">HIGH → LOW</span>
                </div>

                {allBeans.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-title">No beans logged yet.</div>
                    <div className="empty-state-sub">Add entries in any brew method tab.</div>
                  </div>
                ) : (
                  <>
                    {withAlt.length > 0 && (
                      <div>
                        <div className="origin-country-header">
                          <div className="origin-country-name">By Altitude (MASL)</div>
                          <div className="origin-country-meta">
                            HIGH {withAlt[0].masl} · LOW {withAlt[withAlt.length-1].masl}
                          </div>
                        </div>
                        {withAlt.map(({ bean }) => (
                          <AllBeansCard
                            key={bean.id + "-alt"}
                            bean={bean}
                            extraTags={(bean.countries || []).slice(0, 2).map(c => (
                              <span key={c} className="origin-method-badge">{c}</span>
                            ))}
                            right={<>
                              <span className="masl-value">▲ {bean.altitude.trim()}</span>
                              <span className="rating-num" style={{color:"#737373"}}>MASL</span>
                              <BeanRating rating={bean.rating} size={11} />
                            </>}
                          />
                        ))}
                      </div>
                    )}

                    {withoutAlt.length > 0 && (
                      <div>
                        <div className="origin-country-header">
                          <div className="origin-country-name">Unspecified</div>
                          <div className="origin-country-meta">
                            {withoutAlt.length} {withoutAlt.length === 1 ? "BEAN" : "BEANS"}
                          </div>
                        </div>
                        {withoutAlt.map(bean => (
                          <AllBeansCard
                            key={bean.id + "-noalt"}
                            bean={bean}
                            right={<>
                              <BeanRating rating={bean.rating} size={11} />
                              <span className="rating-num">{bean.rating.toFixed(2)}</span>
                            </>}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}

          {/* Detail view */}
          {!showOrigin && !showAltitude && detailBean ? (
            <>
              <div className="detail-back">
                <button className="btn-back" onClick={() => setDetailId(null)}>
                  ← Back to {methodLabel(activeTab)}
                </button>
              </div>
              <div className="detail-hero">
                <div className="detail-roast-label">{detailBean.roast.toUpperCase()} ROAST</div>
                <div className="detail-bean-name">{detailBean.name}</div>
                <div className="detail-roaster">{detailBean.roaster}</div>
                <div className="detail-rating-row">
                  <BeanRating rating={detailBean.rating} size={22} />
                  <span className="detail-rating-num">{detailBean.rating.toFixed(2)}</span>
                </div>
                <div className="detail-meta-badges">
                  <span className={detailBean.caffeine === "decaf" ? "decaf-badge" : "caff-badge"}>
                    {detailBean.caffeine === "decaf" ? "Decaf" : "Caffeine"}
                  </span>
                </div>
                {detailBean.countries && detailBean.countries.length > 0 && (
                  <div style={{marginTop:"10px"}}>
                    <div className="detail-section-label" style={{marginBottom:"6px"}}>Origin</div>
                    <div className="country-display-chips">
                      {detailBean.countries.map(c => (
                        <span key={c} className="country-display-chip" style={{fontSize:"10px",padding:"3px 8px"}}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                {detailBean.altitude && detailBean.altitude.trim() && (
                  <div style={{marginTop:"10px"}}>
                    <div className="detail-section-label" style={{marginBottom:"6px"}}>Altitude</div>
                    <div className="country-display-chips">
                      <span className="country-display-chip masl-chip" style={{fontSize:"10px",padding:"3px 8px"}}>
                        ▲ {detailBean.altitude.trim()} MASL
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {detailBean.instructions ? (
                <div className="detail-instructions-section">
                  <div className="detail-section-label">Brew Instructions</div>
                  <div className="detail-instructions-text">{detailBean.instructions}</div>
                </div>
              ) : null}
              <div className="detail-actions">
                <button
                  className={`btn-delete${confirmDelete ? " confirm" : ""}`}
                  onClick={() => (confirmDelete ? deleteBean(detailBean.id) : setConfirmDelete(true))}
                >
                  {confirmDelete ? "Tap again to delete" : "Delete"}
                </button>
                <button className="btn-edit" onClick={() => openEdit(detailBean)}>Edit Entry</button>
              </div>
            </>
          ) : !showOrigin && !showAltitude ? (
            <>
              <div className="edition-bar">
                <span className="edition-text">
                  {currentBeans.length} {currentBeans.length === 1 ? "ENTRY" : "ENTRIES"} · BY ROAST &amp; RATING
                </span>
                <span className="edition-text">{methodShortLabel(activeTab)}</span>
              </div>

              <div className="add-bar">
                <button className="btn-add" onClick={openAdd}>+ Log New Bean</button>
              </div>

              {currentBeans.length > 0 && (
                <div className="search-bar">
                  <input
                    className="search-input"
                    type="search"
                    placeholder="Search name, roaster, origin…"
                    aria-label="Search beans"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="search-clear" onClick={() => setSearch("")} aria-label="Clear search">✕</button>
                  )}
                </div>
              )}

              {currentBeans.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">No beans logged yet.</div>
                  <div className="empty-state-sub">Tap "Log New Bean" to record your first brew.</div>
                </div>
              ) : visibleBeans.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">No matches.</div>
                  <div className="empty-state-sub">No {methodLabel(activeTab).toLowerCase()} entries match "{search.trim()}".</div>
                </div>
              ) : (
                Object.entries(grouped).map(([roast, beans]) => (
                  <div key={roast}>
                    <div className="roast-group-header">
                      <span className={`roast-dot ${roast}`} />
                      {roast.toUpperCase()} ROAST · {beans.length} {beans.length === 1 ? "ENTRY" : "ENTRIES"}
                    </div>
                    {beans.map((bean) => (
                      <div
                        key={bean.id}
                        className="bean-card"
                        role="button"
                        tabIndex={0}
                        aria-label={`${bean.name}${bean.roaster ? `, ${bean.roaster}` : ""} — view details`}
                        onClick={() => setDetailId(bean.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetailId(bean.id);
                          }
                        }}
                      >
                        <div className="bean-card-header">
                          <div className="bean-name">{bean.name}</div>
                          <div className="rating-display">
                            <BeanRating rating={bean.rating} size={13} />
                            <span className="rating-num">{bean.rating.toFixed(2)}</span>
                          </div>
                        </div>
                        <div className="bean-roaster">{bean.roaster}</div>
                        <div className="bean-meta-row">
                          <span className={bean.caffeine === "decaf" ? "decaf-badge" : "caff-badge"}>
                            {bean.caffeine === "decaf" ? "Decaf" : "Caffeine"}
                          </span>
                        </div>
                        {((bean.countries && bean.countries.length > 0) || (bean.altitude && bean.altitude.trim())) && (
                          <div className="country-display-chips" style={{marginTop:"5px"}}>
                            {(bean.countries || []).map(c => (
                              <span key={c} className="country-display-chip">{c}</span>
                            ))}
                            {bean.altitude && bean.altitude.trim() && (
                              <span className="country-display-chip masl-chip">▲ {bean.altitude.trim()} MASL</span>
                            )}
                          </div>
                        )}
                        {bean.instructions ? (
                          <div className="instructions-preview">{bean.instructions}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))
              )}

              {/* ── Notes section (small, collapsible footer) ────────────── */}
              <div className="notes-section">
                <button className="notes-header" aria-expanded={notesOpen} onClick={() => setNotesOpen(o => !o)}>
                  <span className="notes-title">✎ Notes &amp; Bookmarks</span>
                  <span className="notes-toggle">{notesOpen ? "− Hide" : "+ Show"}</span>
                </button>
                {notesOpen && (
                  <div className="notes-body">
                    <textarea
                      className="notes-textarea"
                      placeholder="Places to buy from, shop hours, ratios you want to remember…"
                      value={data.notes || ""}
                      onChange={(e) => setData(prev => ({ ...prev, notes: e.target.value }))}
                    />
                    <div className="notes-help">Saved automatically · backed up with your data</div>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {/* Sticky bottom view-toggles */}
          {!showOrigin && !showAltitude && (
            <div className="origin-bar two-cols">
              <button className="btn-origin" onClick={() => { setDetailId(null); setShowOrigin(true); }}>
                ⊕ Origin
              </button>
              <button className="btn-origin" onClick={() => { setDetailId(null); setShowAltitude(true); }}>
                ▲ Altitude
              </button>
            </div>
          )}

          {/* Settings / Export / Import Modal */}
          {showSettings && (
            <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}>
              <div className="modal-sheet" role="dialog" aria-modal="true" aria-label="Settings">
                <div className="modal-header">
                  <div className="modal-title">Settings</div>
                  <button className="modal-close" aria-label="Close settings" onClick={() => setShowSettings(false)}>✕</button>
                </div>

                <div className="settings-section-label">Data Transfer</div>

                {/* Export */}
                <div className="settings-row">
                  <div className="settings-row-title">Export All Data</div>
                  <div className="settings-row-desc">
                    Downloads a <strong>.json</strong> backup of every entry across all brew method tabs. Save it to Files, iCloud, or AirDrop it to your new iPhone — then import it there.
                  </div>
                  <div className="settings-stat">
                    {totalEntryCount} total entries · {BREW_METHODS.map(method => `${(data[method.key] || []).length} ${method.label.toLowerCase()}`).join(" · ")}
                  </div>
                  <div className={`settings-stat${backupWarn ? " backup-warn" : ""}`}>
                    {backupWarn ? "⚠ " : ""}{backupText}
                  </div>
                  <button className="btn-settings-action" onClick={handleExport}>
                    ↓ Download Backup
                  </button>
                </div>

                {/* Excel export */}
                <div className="settings-row">
                  <div className="settings-row-title">Export to Excel</div>
                  <div className="settings-row-desc">
                    Downloads a <strong>.xlsx</strong> spreadsheet with one all-beans sheet and a sheet for each brew method. Opens in Numbers, Excel, or Google Sheets.
                  </div>
                  <button className="btn-settings-action outline" onClick={handleExcelExport} disabled={excelBusy}>
                    {excelBusy ? "Preparing…" : "↓ Download Spreadsheet"}
                  </button>
                  {excelMsg && (
                    <div className={`import-msg ${excelMsg.type}`}>{excelMsg.text}</div>
                  )}
                </div>

                {/* Import */}
                <div className="settings-row">
                  <div className="settings-row-title">Import from Backup</div>
                  <div className="settings-row-desc">
                    Load a previously exported <strong>.json</strong> file. This will <em>replace</em> all current entries with the backup — use on a new device after exporting from your old one.
                  </div>
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="import-file-input"
                    id="import-file"
                    onChange={handleImportFile}
                  />
                  <button
                    className="btn-settings-action outline"
                    onClick={() => { setImportMsg(null); document.getElementById("import-file").click(); }}
                  >
                    ↑ Choose Backup File
                  </button>
                  {importMsg && (
                    <div className={`import-msg ${importMsg.type}`}>{importMsg.text}</div>
                  )}
                </div>

                <div className="settings-section-label">App</div>

                {/* Refresh */}
                <div className="settings-row">
                  <div className="settings-row-title">Refresh App</div>
                  <div className="settings-row-desc">
                    Fetches the latest version of the app from GitHub. Your saved entries won't be affected — they live in your browser's local storage.
                  </div>
                  <button
                    className="btn-settings-action outline"
                    onClick={refreshApp}
                  >
                    ↺ Reload from GitHub
                  </button>
                </div>

                <div className="settings-section-label">How to move to a new iPhone</div>
                <div className="settings-row">
                  <div className="settings-row-desc" style={{fontStyle:"normal", lineHeight:"1.7"}}>
                    1. Tap <strong>Download Backup</strong> above and save the file to iCloud Drive or Files.<br/>
                    2. On your new iPhone, open this app in Safari and add it to your Home Screen.<br/>
                    3. Open the app, tap ⚙, choose <strong>Choose Backup File</strong>, and select your saved file.
                  </div>
                </div>

                <div className="form-actions" style={{gridTemplateColumns:"1fr"}}>
                  <button className="btn-cancel" onClick={() => setShowSettings(false)}>Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Add / Edit Modal */}
          {showForm && (
            <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeForm()}>
              <div className="modal-sheet" role="dialog" aria-modal="true" aria-label={editingId ? "Edit entry" : "New entry"}>
                <div className="modal-header">
                  <div className="modal-title">
                    {editingId ? "Edit Entry" : `New ${methodLabel(activeTab)}`}
                  </div>
                  <button className="modal-close" aria-label="Close form" onClick={closeForm}>✕</button>
                </div>

                <div className="form-body">
                  {linkedBeanOptions.length > 0 && (
                    <div className="form-field">
                      <label className="form-label" htmlFor="field-linked-bean">Use Existing Bean</label>
                      <select
                        id="field-linked-bean"
                        className="linked-bean-select"
                        value={form.beanId || ""}
                        onChange={(e) => handleLinkedBeanChange(e.target.value)}
                      >
                        <option value="">New bean / unlinked entry</option>
                        {linkedBeanOptions.map(bean => (
                          <option key={bean.id} value={bean.id}>
                            {bean.name || "Unnamed Bean"}{bean.roaster ? ` — ${bean.roaster}` : ""}
                          </option>
                        ))}
                      </select>
                      <div className="linked-bean-help">
                        Pulls shared bean info into this entry. Editing name, roaster, origin, or altitude here updates every linked log.
                      </div>
                    </div>
                  )}

                  <div className="form-field">
                    <label className="form-label" htmlFor="field-bean-name">Bean Name</label>
                    <input
                      id="field-bean-name"
                      className="form-input"
                      placeholder="e.g. Ethiopia Yirgacheffe"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="field-roaster">Roaster</label>
                    <input
                      id="field-roaster"
                      className="form-input"
                      placeholder="e.g. Onyx Coffee Lab"
                      value={form.roaster}
                      onChange={(e) => setForm({ ...form, roaster: e.target.value })}
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label">Roast Level</label>
                    <div className="roast-selector">
                      {["light", "medium", "dark"].map((r) => (
                        <button
                          type="button"
                          key={r}
                          className={`roast-opt ${form.roast === r ? `selected ${r}` : ""}`}
                          aria-pressed={form.roast === r}
                          onClick={() => setForm({ ...form, roast: r })}
                        >
                          <span className={`roast-circle ${r}`} />
                          {r.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="form-label">Caffeine</label>
                    <div className="toggle-row">
                      <button
                        type="button"
                        className={`toggle-opt ${form.caffeine === "caffeine" ? "selected-caff" : ""}`}
                        aria-pressed={form.caffeine === "caffeine"}
                        onClick={() => setForm({ ...form, caffeine: "caffeine" })}
                      >
                        ◉ Caffeinated
                      </button>
                      <button
                        type="button"
                        className={`toggle-opt ${form.caffeine === "decaf" ? "selected-decaf" : ""}`}
                        aria-pressed={form.caffeine === "decaf"}
                        onClick={() => setForm({ ...form, caffeine: "decaf" })}
                      >
                        ○ Decaf
                      </button>
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="form-label">Country of Origin</label>
                    <CountrySelector
                      selected={form.countries || []}
                      onChange={(countries) => setForm({ ...form, countries })}
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="field-altitude">Altitude — MASL</label>
                    <input
                      id="field-altitude"
                      className="form-input"
                      placeholder='e.g. 1750  or  1500-1800'
                      inputMode="numeric"
                      value={form.altitude || ""}
                      onChange={(e) => setForm({ ...form, altitude: e.target.value })}
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="field-rating">Rating — out of 5</label>
                    <div className="bean-rating-row" style={{marginBottom: "10px"}}>
                      <BeanRating rating={form.rating} size={22} />
                      <span className="rating-num-display">{form.rating.toFixed(2)}</span>
                    </div>
                    <input
                      id="field-rating"
                      type="range"
                      className="rating-slider"
                      min={0}
                      max={5}
                      step={0.25}
                      value={form.rating}
                      onChange={(e) => setForm({ ...form, rating: parseFloat(e.target.value) })}
                    />
                    <div className="rating-scale-labels">
                      <span className="rating-scale-label">0</span>
                      <span className="rating-scale-label">5</span>
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="field-instructions">Brew Instructions</label>
                    <textarea
                      id="field-instructions"
                      className="form-textarea"
                      placeholder="Grind size, water temp, bloom time, ratios, tasting notes..."
                      value={form.instructions}
                      onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button className="btn-cancel" onClick={closeForm}>Cancel</button>
                  <button className="btn-save" onClick={saveForm}>
                    {editingId ? "Save Changes" : "Log Bean"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(<CoffeeLog />);
