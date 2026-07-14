# The Coffee Gazette

A personal, offline-capable brew log for pour over, espresso, and French press —
styled like a small-town newspaper. Designed to be opened in Safari and added to
the iPhone Home Screen as a standalone app.

**Live app:** https://asre1212.github.io/coffee/

## Features

- Log beans per brew method with roaster, roast level, caffeine, origin
  countries, altitude (MASL), a 0–5 rating, and free-form brew instructions
- Beans are shared across methods — editing a linked bean's facts (name,
  roaster, origin, altitude) updates every entry that uses it
- Roll-up views by **origin country** and by **altitude**
- Search entries by name, roaster, origin, altitude, or instructions
- Notes & bookmarks scratchpad
- Backup/restore as JSON; export to Excel (.xlsx)
- Works fully offline once loaded (service worker caches the app shell)

## Where data lives

All data stays on the device: `localStorage` is the primary store, mirrored to
IndexedDB on every save as protection against eviction. Nothing is sent to a
server. Use **⚙ → Download Backup** regularly — the settings sheet shows how
long it's been since the last backup.

To move to a new phone: Download Backup on the old device, open the app on the
new device, ⚙ → Choose Backup File.

## Repo layout

| Path | What it is |
|---|---|
| `index.html` | Markup + all CSS; loads the vendored libraries and `app.js` |
| `src/app.jsx` | **The app source. Edit this file.** |
| `app.js` | Compiled output of `src/app.jsx` — do not edit by hand |
| `vendor/` | Pinned local copies of React 18.3.1, ReactDOM, SheetJS 0.18.5 |
| `sw.js` | Service worker (offline cache) |
| `manifest.webmanifest`, `icons/` | PWA install metadata |
| `build/` | In-browser compiler (vendored Babel) for rebuilding `app.js` |

The XLSX library is only loaded when an Excel export is requested, so it does
not slow down app startup.

## Making changes

1. Edit `src/app.jsx`.
2. Rebuild `app.js`: from the repo root run any static server, e.g.
   `python3 -m http.server`, open `http://localhost:8000/build/compile.html`,
   click **Compile**, download the result, and replace `app.js`.
3. Bump `CACHE_NAME` in `sw.js` (any new string) so installed devices pick up
   the new version on their next online visit.
4. Commit and push. GitHub Pages serves the repo as-is; there is no CI build.

There is deliberately no Node/npm toolchain — the "build" is a single Babel
JSX transform that runs in the browser using the pinned copy in `build/`.

## Deployment

GitHub Pages, serving the repository root from the `main` branch. Everything
is static; no build step runs on GitHub.
