# Changelog

Notable changes to the extension. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/); there is no formal version
tagging yet, so everything lands under **Unreleased** (branch
`feat/review-fixes-and-redesign`, PR #6).

## [Unreleased]

### Added
- **Korean romanization** (`R`) — a Revised-Romanization reading under each Hangul
  line (and the song title), applying the common assimilation rules: 받침 liaison,
  palatalization, silent ㅎ, nasalization, liquidization (신라 → *silla*),
  double-batchim liaison (읽어 → *ilgeo*, 앉아 → *anja*, 싫어 → *sireo*), and
  ㅎ-aspiration in every direction — forward, backward, ㅅ/ㅆ, ㄶ/ㅀ clusters, and
  the ㅌ→ch palatalization (좋다 → *jota*, 축하 → *chuka*, 못해 → *motae*,
  많다 → *manta*, 굳히다 → *guchida*).
- **Export synced lyrics as `.lrc`** (`E`, or the toolbar button) — round-trips
  cleanly back through the parser.
- **Sound-reactive background** (`V`) — the blurred album backdrop pulses with the
  music via gesture-safe Web Audio (never mutes playback).
- **Album-accent theming** — a color sampled from the cover tints the active-line
  glow, album halo, and controls, and degrades gracefully to neutral on
  monochrome art.
- Loading screen while the source chain resolves, and an intentional, legible
  "No lyrics available" empty state.
- Zero-dependency test suite (42 tests, Node's `node:test`) for the pure
  parser / sync / romanization helpers; test constants are lifted directly from
  `content.js` so they can never drift from the source.
- Dev-only preview harness (`preview/preview.html`) with `?theme`, `?roman`,
  `?loading`, `?nolyrics`, `?karaoke`, and `?controls` modes.

### Changed
- Lyrics now resolve through a **data-driven fallback chain** — Binimum (Apple
  Music TTML) → Musixmatch → lrclib.net → Cubey — cached per `videoId`; the first
  acceptable hit wins.
- Restyled to the Apple-Music aesthetic: a proximity-fade lyric cascade (upcoming
  lines stay more legible than past ones), a single-hue accent aura that drifts in
  a slow organic arc, a refined toolbar with a white play button, and a popup
  redesigned to match the overlay with a built-in keyboard-shortcut reference.
- Word-level (karaoke) highlighting is CSS-driven (`animation-delay` scrubbing),
  so the compositor does the work rather than per-frame JavaScript.
- Every network request has a hard timeout, so one slow source can't stall the
  whole chain.

### Fixed
- Wrong-song lyrics are rejected by loose title **+ artist** match verification.
- ~1-minute lyric searches (caused by an over-broad title × artist fan-out) are
  eliminated; variations are capped and searches trimmed.
- Lyrics rebuild correctly on song auto-advance (driven by the player bridge's
  `videoId`, not just the DOM observer).
- Cubey's 403-retry path parses JSON instead of returning the raw response.
- Interlude word-sync index remapping; enhanced-LRC `<mm:ss.xx>` word tags no
  longer render as literal text; copying no longer pulls in the romanization
  sub-line or destroys the copy icon.
- Time formatting for tracks longer than an hour.
