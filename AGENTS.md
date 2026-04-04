# AGENTS.md — YT Music Lyrics Extension

## Project Overview

Chrome Extension (Manifest V3) that displays Apple Music-style synced lyrics on YouTube Music.
Raw vanilla JS — no TypeScript, no bundler, no framework. Load via `chrome://extensions` > "Load unpacked".

## Architecture

```
manifest.json        — MV3 config, permissions, content script registration
content.js           — Main extension logic (ISOLATED world, 1429 lines IIFE)
playerBridge.js      — YTM player API bridge (MAIN world, 59 lines)
lyrics.css           — Full-screen overlay UI (Apple Music aesthetic)
popup.html / popup.js — Extension popup toggle (ON/OFF, modern JS OK here)
icons/               — Extension icons (16/48/128)
```

### Content Script Worlds
- `content.js` runs in **ISOLATED** world — no direct access to page JS
- `playerBridge.js` runs in **MAIN** world — accesses `movie_player` API
- Communication: `window.postMessage` with structured payloads:
  - `{type: "aml-player-tick", time, duration, playing, title, artist, videoId}` — bridge → content
  - `{type: "aml-seek-to", time}` — content → bridge

### Lyrics Source Priority (fallback chain)
1. Musixmatch API (`mxmFetchLyrics`, line 462) — most popular songs
2. lrclib.net (`fetchSyncedLyrics`, line 477) — LRC format, get + search
3. Cubey API (`cubeyFetchLyrics`, line 219) — Turnstile auth, TTML/MXM/LRC/plain
4. YTM built-in plain text (`tryPlainLyrics`, line 1296) — last resort

### Key Functions (content.js)
| Function | Line | Purpose |
|---|---|---|
| `parseLRC` | 126 | Parse LRC format lyrics |
| `cubeyFetchLyrics` | 219 | Cubey API fetcher |
| `parseTTML` | 268 | Parse TTML format lyrics |
| `mxmFetchLyrics` | 462 | Musixmatch API fetcher |
| `fetchSyncedLyrics` | 477 | lrclib.net fetcher |
| `buildOverlay` | 854 | Build full-screen lyrics overlay DOM |
| `showWithSyncedLyrics` | 1170 | Display synced lyrics with parsed data |
| `tryShowLyrics` | 1226 | Main entry: fallback chain orchestrator |
| `tryPlainLyrics` | 1296 | YTM built-in plain text fallback |
| `isExtensionValid` | 1406 | Guard for chrome.runtime validity |

## Build / Lint / Test Commands

**No build step.** This directory is loaded directly as an unpacked Chrome extension.

```bash
# No build, no test suite, no package.json in this directory
# Edit files → reload extension in chrome://extensions
```

### CI Note
`.github/workflows/Build.yml` references `npm run typecheck` and `npm run build`, but those apply to the upstream repo with a bundler. This local directory has no such tooling.

### Formatting
- **Biome** is the default formatter (`.vscode/settings.json`)
- Prettier is explicitly disabled
- No `biome.json` — uses Biome defaults
- Format on save is enabled

## Code Style

### JavaScript Conventions

**content.js and playerBridge.js** — ES5-compatible syntax (no transpiler):
- `var` declarations (not `let`/`const`)
- `function` declarations/expressions (not arrow functions)
- `.then()` chains (not `async/await`)
- `for` loops with index (not `forEach`/`for..of`)
- String concatenation with `+` (not template literals)
- `.indexOf() !== -1` checks (not `.includes()`)

**popup.js** — modern JS is OK (`const`, arrows, `async/await`, `?.`) because it runs in the extension popup, not as a content script.

### Naming
- **Variables/functions**: `camelCase` — `getSongInfo`, `timedData`, `activeIndex`
- **Constants**: `UPPER_SNAKE_CASE` — `STATE_KEY`, `MAX_DURATION_DIFF`, `INTERLUDE_GAP`
- **CSS classes**: `aml-` prefix, kebab-case — `aml-overlay`, `aml-song-title`
- **Storage keys**: snake_case strings — `"aml_enabled"`, `"mxm_user_token"`
- **Message types**: string constants — `"AML_TOGGLE"`, `"aml-player-tick"`

### Code Structure (content.js)
- Entire file wrapped in IIFE: `(function () { "use strict"; ... })();`
- State variables declared at top of IIFE scope
- Functions organized by concern: DOM queries → API fetchers → parsers → sync engine → UI builders
- No modules, no imports — single file, single scope

### Error Handling
- API calls: `.catch(function () { return null; })` — silent fallback
- Extension validity: `isExtensionValid()` guard before any `chrome.runtime` call
- Empty catch `catch (e) { }` for non-critical localStorage access
- Console warnings: `console.warn("[AML] ...")` — always use `[AML]` prefix

### DOM Manipulation
- Raw `document.createElement` / `document.querySelector` — no jQuery
- CSS class toggling via `classList.add/remove`
- Scroll via CSS `transform: translateY()` on `.aml-lines-wrapper`
- `MutationObserver` for detecting song changes and lyrics panel updates

### CSS Conventions
- All classes prefixed with `aml-` to avoid YTM conflicts
- Animations: `cubic-bezier(0.22, 1, 0.36, 1)` (Apple-style ease-out)
- Colors: `rgba(255, 255, 255, ...)` with varying alpha for text hierarchy
- `will-change` hints on animated properties
- Responsive breakpoint at 900px (stacked layout)
- `backdrop-filter: blur()` for glassmorphism; `-webkit-` prefixes included

### Proximity-Based Styling
Lines near active lyric get graduated CSS classes:
- `aml-active` — current line (largest, brightest)
- `aml-above-1` → `aml-above-far` — lines above (progressively dimmer)
- `aml-below-1` → `aml-below-far` — lines below
- Only lines within +/- 4 of active index are updated (perf optimization)

## Key Patterns to Follow

### Adding a New Lyrics Source
1. Create fetch function: `newSourceFetchLyrics(title, artist, duration)`
2. Return a Promise resolving to parsed data or `null`
3. Insert into fallback chain in `tryShowLyrics()` (line 1226)
4. Set `lyricsSource` and `lyricsType` before calling `showWithSyncedLyrics()`

### API Authentication Pattern
- Token caching in `localStorage` or `chrome.storage.local`
- Check expiration before using cached token
- Retry with fresh token on 401/403
- Examples: `mxmGetToken()`, `cubeyGetJWT()`

### Extension Validity Guard
Always wrap `chrome.runtime` / `chrome.storage` calls:
```js
if (!isExtensionValid()) return;
if (!isExtensionValid()) { resolve(null); return; }
```

### Adding New UI Elements
1. Create element with `document.createElement`
2. Set class with `aml-` prefix
3. Add to overlay in `buildOverlay()` (line 854)
4. Add corresponding CSS in `lyrics.css`

## Common Pitfalls
- **No ES6+ in content.js/playerBridge.js** — no transpiler available
- **No `movie_player` access from content.js** — ISOLATED world boundary
- **Always guard chrome.runtime calls** — extension context can be invalidated
- **Test on `music.youtube.com`** — not regular `youtube.com`
- **Manual reload required** — no hot reload for extensions
- **Check both synced and plain lyrics paths** — changes may affect the fallback chain

## Git Conventions
- Main branch: `master`
- Commit convention: Angular (per `.all-contributorsrc`)
- `.claude` directory is gitignored
