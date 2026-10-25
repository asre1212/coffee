# Seasonal launch splash

The self-contained CSS and script at the start of `index.html` show a two-second,
app-specific animation on a fresh installed-app launch. There is no skip button.
The final 160 ms fade is included in the two seconds. Reduced motion shows a still
illustration for the same duration. Unsupported browsers simply open the journal.

The splash does not replay on browser-tab visits, refresh, history navigation, or
returning to a running app. Browsers do not expose a reliable home-screen icon-tap
event when a live app resumes; a fresh standalone document is used as the launch
signal. This also avoids interrupting entry, dictation, and app switching.

## Automatic theme dates

Dates use America/New_York, matching Puzzle. Holidays take priority over seasons;
when each holiday ends, the current seasonal design returns automatically.

| Theme | Annual window |
| --- | --- |
| New Year | December 27–January 3 |
| Valentine's Day | February 7–15 |
| July 4th | June 27–July 7 |
| Halloween | October 18–November 1 |
| Christmas | December 10–26 |
| Spring | March–May |
| Summer | June–August |
| Autumn | September–November |
| Winter | December–February |

All vector illustrations and animation are included in the HTML. No image, font,
API, or model download is required for the splash. It does not access storage,
saved entries, photos, credentials, or sync settings. Existing offline behavior
is retained; Coffee and Cellar cache the complete HTML with their app shell.
Hotel retains its existing single-file approach and has no offline service worker.

## References reviewed

- Existing `asre1212/puzzle/dist/splash-themes.js` (holiday schedule).
- Each app's current HTML, style, and service-worker code.
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/display-mode
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming/type
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
