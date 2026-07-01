# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> A detailed companion doc exists at `AGENTS.md` (function/line tables, code-style rules, common pitfalls). Read it for deep work. This file captures the big picture and the facts that change most often.

## What this is

Chrome Extension (Manifest V3) that overlays Apple Music–style synced lyrics on **music.youtube.com**. Vanilla JS — no TypeScript, no bundler, no framework, no `package.json`.

## Build / run / test

There is **no build step**. You develop by editing files and reloading the unpacked extension:

1. `chrome://extensions` → enable Developer mode → "Load unpacked" → select this directory.
2. After editing any file, click the reload icon on the extension card.
3. Test on `music.youtube.com` (NOT regular `youtube.com`). Play a song; the overlay opens via the lyrics panel.
4. Toggle the in-overlay debug HUD with **Shift+D** (gated behind `debugVisible`; verbose `[AML]` logs only print when it's on). Other shortcuts: **Esc** close, **`[`/`]`** nudge sync offset, **`\`** reset offset, **`C`** copy lyrics, **`−`/`+`** font size, **`V`** toggle sound-reactive background.

**Design changes:** verify them in `preview/preview.html` — a dev-only harness that renders the overlay with mock lyrics + the real `lyrics.css` (serve the folder over http, e.g. `python3 -m http.server`, and open it; `?theme=warm|cool|mono|dark` checks the album-accent look across covers). It's not shipped.

There is a **zero-dependency test suite** for the pure parser/sync helpers (Node's built-in `node:test`; no npm install required). `tests/extract.mjs` pulls functions straight out of `content.js` so tests track the real source.

```bash
npm test                 # node --test tests/  (parseLRC, parseTTMLTime, insertInterludes, interlude remap, …)
node --check content.js  # quick syntax check, no browser
```

CI (`.github/workflows/Build.yml`) references `npm run typecheck`/`npm run build`, but that tooling belongs to the upstream bundled repo — it does not apply here. Formatting is **Biome** (Prettier disabled in `.vscode/settings.json`); there is no `biome.json`, so Biome defaults apply.

## Architecture

Two content scripts in different JS worlds, plus a popup:

- **`content.js`** (~1750 lines, single IIFE, ISOLATED world) — all extension logic: lyric fetching, parsing, the sync engine, and the overlay UI. No access to page JS.
- **`playerBridge.js`** (MAIN world) — the only code that can touch YTM's `movie_player` API. Ticks every 20ms and posts interpolated playback time.
- **`popup.html` / `popup.js`** — ON/OFF toggle. Modern JS (`const`, arrows, `async/await`) is fine here.
- **`lyrics.css`** — full-screen overlay, all classes prefixed `aml-`.

### Cross-world communication (`window.postMessage`)
- bridge → content: `{type: "aml-player-tick", currentTime, duration, playing, song, artist, videoId, browserTime}`
- content → bridge: `{type: "aml-seek-to", time}` (e.g. clicking a lyric line to seek)

### Sync engine
`playerBridge` interpolates `getCurrentTime()` between 20ms ticks → `content.js` finds the active line and updates only lines within ±4 of the active index (DOM-cached `.aml-line` + `offsetTop`). Scrolling is a CSS `transform: translateY()` on `.aml-lines-wrapper`. **Word-level** sync (Binimum word timing) is CSS-driven: per-word `animation-delay` is scrubbed, not per-frame JS. Note: drift correction and any fixed `BASE_OFFSET` were deliberately removed — do not reintroduce them.

### Lyrics source fallback chain (current order — `tryShowLyrics`, ~line 1491)
1. **Binimum** (`binimumFetchLyrics`) — primary; Apple Music TTML, word- or line-level timing
2. **Musixmatch** (`mxmFetchLyrics`) — line
3. **lrclib.net** (`fetchSyncedLyrics`) — line
4. **Cubey** (`cubeyFetchLyrics`) — Cloudflare Turnstile auth → JWT; returns TTML / Musixmatch / lrclib / plain
5. **YTM built-in plain text** (`tryPlainLyrics`) — last resort

The chain is **data-driven** via the `LYRICS_SOURCES` array in `tryShowLyrics`: each entry has a `fetch` (returns a Promise of the raw response or `null`) and an `unpack` (normalizes to `{kind, source, type, parsed|text}` or `null` to fall through). The first hit is rendered and **cached per `videoId`** (in-memory LRU, `lyricsCache`) so returning to a song skips the network; negative results aren't cached so transient failures retry. To add a source, push an entry to `LYRICS_SOURCES` — no need to touch the orchestration.

## Conventions that matter

- **`content.js` and `playerBridge.js` are ES5-only** (no transpiler): use `var`, `function`, `.then()` chains, indexed `for` loops, string `+` concatenation, `.indexOf() !== -1`. No arrow functions, `const`/`let`, `async/await`, optional chaining, or template literals in these two files.
- **Always guard `chrome.runtime`/`chrome.storage` calls** with `isExtensionValid()` — the extension context can be invalidated on reload.
- API errors fail silently: `.catch(function () { return null; })`. Console output uses the `[AML]` prefix and is gated behind `debugVisible`.
- CSS classes use the `aml-` prefix; storage keys are snake_case strings (`"aml_enabled"`, `"mxm_user_token"`); message types are string constants.

## Git

- Main branch: **`main`** (commit style: Angular / conventional commits, e.g. `feat(lyrics):`, `fix(ui):`).
- `.claude` is gitignored.
