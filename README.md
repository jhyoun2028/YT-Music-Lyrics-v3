# YT Music Lyrics

A Chrome extension that overlays time-synced lyrics on YouTube Music with an Apple Music-inspired design.

Built with Manifest V3. No external dependencies, no proxy servers, no background service workers needed for core functionality.

## Features

- Fullscreen overlay with blurred album art background
- Time-synced lyrics with word-level karaoke highlighting
- Apple Music-style proximity blur (active line glows, surrounding lines fade)
- Frosted glass toolbar with playback controls and progress bar
- Click any line to seek
- Per-song timing offset (saved per video)
- Multiple lyrics providers (Musixmatch, LRCLib, YouTube Captions, and more)
- Debug overlay (Shift+D) showing sync source, type, and offset
- Simple ON/OFF popup toggle

## How It Works

```
[YTM Page] <-- content.js --> [Lyrics Providers] --> [Overlay UI]
                                    |
              Musixmatch, LRCLib, bLyrics, YT Captions
```

The extension injects a content script into YouTube Music that:
1. Monitors the player state via a MAIN world script polling `movie_player` every 20ms
2. Detects song changes and fetches lyrics from multiple providers (priority-based fallback)
3. Renders a fullscreen overlay with proximity-based blur and word-level highlighting
4. Scrolls lyrics using GPU-composited CSS transforms for smooth 60fps animation

## Provider Priority

| # | Provider | Sync Level |
|---|----------|------------|
| 1 | bLyrics | Syllable |
| 2 | Musixmatch | Word |
| 3 | YouTube Captions | Line |
| 4 | bLyrics | Line |
| 5 | LRCLib | Line |
| 6 | Legato | Line |
| 7 | Musixmatch | Line |
| 8 | YouTube Lyrics | Unsynced |
| 9 | LRCLib | Unsynced |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| ESC | Close overlay |
| Shift+D | Toggle debug info |

## Installation

1. Clone this repo
2. `npm install`
3. `npm run dev` for development with hot reload
4. Load the `dist/chrome` folder as an unpacked extension in `chrome://extensions`

Or build for production:
```bash
npm run build
```

## Project Structure

```
src/
  core/           # App state, storage, utilities, i18n
  modules/
    lyrics/       # Lyrics fetching, parsing, injection
      providers/  # Individual lyrics sources
      requestSniffer/  # YTM API response interception
    ui/           # Animation engine, DOM, observer
    settings/     # Extension settings
  options/        # Popup UI
  index.ts        # Entry point
public/
  script.js       # MAIN world player monitoring
  earlyInject.js  # Request sniffer bootstrap
  css/            # All stylesheets
```

## Tech Stack

- TypeScript
- Chrome Extension Manifest V3
- CSS custom properties + GPU-composited transforms
- No frameworks, no build-time dependencies beyond the extension bundler

## License

[GPL v3](LICENSE)
