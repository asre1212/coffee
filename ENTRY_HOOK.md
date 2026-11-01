# Assistant entries — coffee

Repository: `asre1212/coffee`, branch `main`. The existing app URL and local journal storage are preserved.

## One-time setup on the receiving phone

Update/reload the installed app, then Settings → Assistant entries → Connect this device. Create a fine-grained GitHub token for this repository with **Contents: Read and write**, and paste it directly into the app, never chat. One token may select matcha, coffee, and hotel; connect each app once. Hotel's older gist-only token is separate and is not sufficient.

The phone generates a nonextractable RSA-OAEP private key in IndexedDB, publishes only `delivery-key.json`, and stores the token locally. A different receiving device requires an explicit replacement confirmation. No receiving key or token is built into the source.

## Send a batch from chat

1. Read this file and fetch the current `delivery-key.json` via the connected GitHub tool. If absent, ask the user to connect the installed app; do not create a key on the assistant's computer or claim delivery is active.
2. Prepare the following JSON in a temporary file outside the repository. Use stable UUIDs for the delivery and each entry. Never invent personal ratings. Do not upload the plaintext or use a public issue/comment for entries.

```json
{"app":"coffee","version":1,"id":"DELIVERY_UUID","entries":[{"id":"ENTRY_UUID","name":"SCHEMA_EXAMPLE"}]}
```

Required: `id` (UUID), `name`, `method` (`espresso`, `pourover`, `frenchpress`). Optional: `roaster`, `roast` (`light`, `medium`, `dark`, `unspecified`), `caffeine` (`caffeine`, `decaf`, `unspecified`), `rating` (0–5 or null), `countries` (strings), `altitude` (string), `instructions`. Missing rating stays unrated. Unknown roast and caffeine stay unspecified. Do not guess a brew method.

3. Run `node scripts/create-delivery.mjs /tmp/public-key.json /tmp/plaintext.json /tmp/DELIVERY_UUID.json` with Node 20+ to validate and encrypt. Maximum 500 entries and 900 KB envelope; split larger batches. The example above illustrates the shape; required app-specific fields still apply.
4. Create `inbox/DELIVERY_UUID.json` on main with only the encrypted output via GitHub. No index update or app code change is needed. Do not reuse an accepted delivery UUID. Retry an uncertain write with the same file, never generate a duplicate packet blindly. Inspect an existing same-name file before retrying.
5. Confirm **queued** only after the GitHub write succeeds. The app checks on opening, returning to the foreground, coming online, and Settings → Check entries. iOS background delivery while the app is closed is not promised. The assistant cannot see the local journal; it cannot assert received until the device acknowledges by deleting the queued file.

## Save and cleanup behavior

Entries are append-only. IDs and normalized identities are deduplicated (matcha: name/company; coffee: name/roaster/method; hotel: name/city/country). Existing ratings, notes, photos and contacts are not overwritten. A new coffee brew method can share an existing bean without changing the bean's facts. Each payload is validated in full before saving.

Entries and the delivery receipt are committed in one localStorage write, read back, then the exact accepted GitHub blob SHA is deleted. A failed save prevents deletion. Cleanup failure retries without reimporting or resurrecting edited/deleted entries. Invalid, changed, or wrong-device packets remain queued with an error. A check handles up to 100 batches; press Check entries again for more. Keep the active inbox below GitHub's 1,000-item Contents API limit.

JSON backups include accepted-delivery receipts, but exclude the token and receiving private key. On a new phone, restore your journal backup, reconnect, and ask for pending batches to be resent to the new public key. Clearing website data can erase the local journal and receiving key. Use regular backups.

GitHub stores only temporary encrypted envelopes, not readable entries. Removing a file removes the active inbox copy, not Git history. Historical ciphertext remains. The delivery feature does not upload the existing journal. Hotel's separately enabled gist sync keeps its existing behavior.

## Checks and references

Run `node --test tests/assistant-inbox.test.cjs`. Browser checks: `node tests/assistant-inbox-ui.test.cjs` with Playwright available (or set `PLAYWRIGHT_MODULE` to its absolute module path and optionally `CHROMIUM_PATH`). The browser test uses a mock GitHub server and real Web Crypto to exercise pairing, encrypted delivery, persistence, duplicates, cleanup retries, and mobile layout. Test offline reopening on the intended installed phone. No live personal entries are included in tests.

Implementation checked against the existing matcha, coffee, hotel, wine, and Hiking-Trails source plus:
- https://docs.github.com/en/rest/repos/contents — exact-SHA sequential deletion.
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt — RSA-OAEP and AES-GCM.
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API — serialized checks across tabs.
