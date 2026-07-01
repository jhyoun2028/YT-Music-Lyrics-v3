# YT Music Lyrics

Apple Music–style **synced lyrics** overlaid on [music.youtube.com](https://music.youtube.com) — full-screen, word‑by‑word timing when available, with the background tinted from the album art.

> Chrome Extension (Manifest V3), vanilla JavaScript — no build step, no bundler, no dependencies.

## Features

- **Synced lyrics** — line- and word-level (karaoke-style) timing, scrolled in lockstep with playback.
- **Multiple sources with fallback** — Binimum (Apple Music TTML) → Musixmatch → lrclib.net → Cubey. First hit wins and is cached per song. Wrong-song matches are rejected by title+artist verification.
- **🇰🇷 Korean romanization** — a romanized reading under each Hangul line (Revised Romanization with 받침 liaison). Toggle with **R**.
- **Sound-reactive background** — the blurred album backdrop gently pulses with the music. Toggle with **V**.
- **Album-accent theming** — a color sampled from the cover tints the active-line glow, album halo, and controls.
- **Controls** — click a line to seek, drag the progress bar, copy lyrics, adjust text size, nudge sync offset per song.

## Install (unpacked)

There is no build step — load the folder directly:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this directory.
4. Open [music.youtube.com](https://music.youtube.com), play a song, and open the lyrics panel. The overlay appears automatically.

Use the toolbar popup to toggle the extension on/off. After editing any file, click the reload icon on the extension card.

## Keyboard shortcuts (while the overlay is open)

| Key | Action |
|-----|--------|
| `Esc` | Close the overlay |
| `[` / `]` | Nudge sync offset earlier / later (per song, saved) |
| `\` | Reset sync offset |
| `C` | Copy lyrics to clipboard |
| `−` / `+` | Decrease / increase text size (saved) |
| `V` | Toggle the sound-reactive background |
| `R` | Toggle Korean romanization |
| `Shift`+`D` | Toggle the debug HUD |

## How it works

Two content scripts run in different JS worlds and talk over `window.postMessage`:

- **`content.js`** (ISOLATED world) — lyric fetching, parsing, the sync engine, and the overlay UI.
- **`playerBridge.js`** (MAIN world) — the only code that can read YouTube Music's `movie_player` API; posts interpolated playback time every 20 ms.

Word-level highlighting is CSS-driven (per-word `animation-delay` scrubbing), so the compositor does the work rather than per-frame JavaScript. See `AGENTS.md` for the deep dive.

## Privacy

The extension sends the **song title, artist, and duration** to the lyric providers above to look up lyrics, and reads the current track/time from the YouTube Music player. It stores small preferences locally (sync offset, text size, toggles, and a cached Musixmatch/Cubey token). No analytics, no accounts, no data sent anywhere else.

## Development

No toolchain required.

```bash
npm test                 # zero-dependency parser/sync tests (Node's built-in node:test)
node --check content.js  # syntax check
```

Design changes can be previewed without loading the extension: serve the repo over HTTP (`python3 -m http.server`) and open `preview/preview.html` — it renders the overlay with mock lyrics and the real `lyrics.css`. `?theme=warm|cool|mono|dark` and `?roman=1` help check the look across covers.

`content.js` and `playerBridge.js` are **ES5-only** (no transpiler). See `CLAUDE.md` / `AGENTS.md` for conventions.

## Credits

Lyrics from [Binimum](https://binimum.org), [Musixmatch](https://www.musixmatch.com), [lrclib.net](https://lrclib.net), and Cubey. Not affiliated with or endorsed by Google, YouTube, or Apple.
