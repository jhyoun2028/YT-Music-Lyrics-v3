(function () {
  "use strict";

  var STATE_KEY = "aml_enabled";
  var enabled = true;
  var overlay = null;
  var loadingEl = null;
  var fadingOverlay = null;
  var activeIndex = -1;
  var lastSongTitle = "";
  var lyricsTabClicked = false;
  var songObserver = null;
  var panelObserver = null;
  var urlObserver = null;
  var closedByUser = false;
  var syncActive = false;
  var userSeeking = false;
  var seekTimeout = null;

  var timedData = [];
  var useTimedSync = false;
  var nonEmptyIndices = [];
  var fallbackTimes = [];
  var syncRafId = null;
  var userOffset = 0;
  var currentVideoId = "";
  var cachedLineOffsets = null;
  var cachedContentHeight = 0;
  var cachedLines = null;
  var useWordSync = false;
  var wordData = [];
  var lyricsSource = "";
  var lyricsType = "";
  var debugVisible = false;
  var lastVisibleTime = 0;
  var fetchId = 0;
  var fontScale = 1;

  function getVideo() {
    return document.querySelector("video");
  }

  function getAlbumArtUrl() {
    var sels = [
      "ytmusic-player-bar .middle-controls img",
      "ytmusic-player-bar .image-wrapper img",
      "ytmusic-player-bar .thumbnail img",
      "ytmusic-player-bar img.image",
      "#song-image img",
    ];
    for (var i = 0; i < sels.length; i++) {
      var img = document.querySelector(sels[i]);
      if (img && img.src && img.src.indexOf("data:") === -1) {
        return img.src.replace(/=w\d+-h\d+/, "=w800-h800");
      }
    }
    return null;
  }

  // Build a safe CSS url() value — quote it and escape characters that could
  // break out of the url() function (defensive; YTM art URLs are well-formed).
  function cssUrl(u) {
    return 'url("' + String(u).replace(/["\\]/g, "\\$&") + '")';
  }

  // ── Hangul romanization (Revised Romanization, per-syllable) ────────────────
  // Deterministic, dictionary-free: decompose each Hangul syllable into
  // initial/medial/final jamo and map to romaji. Non-Hangul (Latin, spaces,
  // punctuation) passes through unchanged. Approximate — no cross-syllable
  // assimilation/liaison — but very usable for singing along (the K-pop use case).
  var RR_INITIAL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
  var RR_MEDIAL = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
  var RR_FINAL = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
  // A movable final consonant (batchim) before a syllable that starts with ㅇ
  // (silent initial) liaises — its sound becomes that next syllable's initial
  // (연음): 생각이 → saeng·ga·gi (not ...ki). Only clean single consonants;
  // ㅇ(ng), ㅎ, and clusters keep their plain final for simplicity.
  var RR_LIAISON = { 1: "g", 2: "kk", 4: "n", 7: "d", 8: "r", 16: "m", 17: "b", 19: "s", 20: "ss", 22: "j", 23: "ch", 24: "k", 25: "t", 26: "p" };
  // Nasalization: an obstruent batchim before a ㄴ/ㅁ initial takes a nasal sound
  // (ㄱ-type→ng, ㄷ-type→n, ㅂ-type→m): 국물→gungmul, 있는→inneun.
  var RR_NASAL = { 1: "ng", 2: "ng", 3: "ng", 9: "ng", 24: "ng", 7: "n", 19: "n", 20: "n", 22: "n", 23: "n", 25: "n", 27: "n", 14: "m", 17: "m", 18: "m", 26: "m" };
  // Double batchim (겹받침) before a silent ㅇ: the first consonant stays as this
  // syllable's final, the second liaises to the next initial — 읽어 ilgeo, 앉아
  // anja, 젊어 jeolmeo, 넓어 neolbeo. ㅀ is special: the ㅎ drops and ㄹ itself
  // liaises as r (싫어 sireo).  Value is [keptFinal, carriedInitial].
  var RR_DBL_LIAISON = { 5: ["n", "j"], 9: ["l", "g"], 10: ["l", "m"], 11: ["l", "b"], 15: ["", "r"] };
  // Aspiration (격음화) across ㅎ: a ㅎ batchim + ㄱ/ㄷ/ㅈ/ㅂ initial, or a ㄱ/ㄷ/ㅂ/ㅈ
  // batchim + ㅎ initial, merge into one aspirated stop — 좋고 joko, 좋다 jota,
  // 좋지 jochi, 축하 chuka, 급히 geupi. RR_ASP_FWD keys are the *next initial*'s
  // index; RR_ASP_BACK keys are this syllable's *final* index.
  var RR_ASP_FWD = { 0: "k", 3: "t", 12: "ch", 7: "p" };
  var RR_ASP_BACK = { 1: "k", 7: "t", 17: "p", 22: "ch" };
  // ㅎ-cluster batchim (ㄶ/ㅀ) before ㄱ/ㄷ/ㅈ: the ㅎ aspirates the following stop
  // while the ㄴ/ㄹ survives as this syllable's final — 많다 manta, 싫다 silta,
  // 않고 anko, 괜찮다 gwaenchanta. Value is the surviving final's sound.
  var RR_H_CLUSTER = { 6: "n", 15: "l" };

  function hasHangul(s) {
    return /[가-힣]/.test(s || "");
  }

  function romanizeHangul(text) {
    if (!text) return "";
    // Decompose to tokens first so we can look ahead for liaison.
    var toks = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xAC00 && code <= 0xD7A3) {
        var idx = code - 0xAC00;
        toks.push([Math.floor(idx / 588), Math.floor((idx % 588) / 28), idx % 28]);
      } else {
        toks.push(text.charAt(i));
      }
    }
    var out = "", carry = "";
    for (var t = 0; t < toks.length; t++) {
      var tok = toks[t];
      if (typeof tok === "string") { out += tok; carry = ""; continue; }
      var initial = carry !== "" ? carry : RR_INITIAL[tok[0]];
      carry = "";
      var jong = tok[2];
      var next = toks[t + 1];
      var hasNext = next && typeof next !== "string";
      var nextIni = hasNext ? next[0] : -1;
      // next syllable begins with ㅇ (silent initial) → the final can carry over
      var nextEum = nextIni === 11;
      // ...and its vowel is i / iotized (ㅣㅑㅕㅛㅠㅖ) → triggers palatalization
      var nm = nextEum ? next[1] : -1;
      var iota = nm === 20 || nm === 2 || nm === 6 || nm === 12 || nm === 17 || nm === 7;
      var body = initial + RR_MEDIAL[tok[1]];
      if (nextEum && iota && (jong === 7 || jong === 25)) {
        carry = jong === 7 ? "j" : "ch";       // 굳이 → guji, 같이 → gachi
        out += body;
      } else if (nextEum && jong === 27) {
        out += body;                           // ㅎ before a vowel is silent: 좋아 → joa
      } else if (nextEum && RR_DBL_LIAISON[jong]) {
        out += body + RR_DBL_LIAISON[jong][0]; // 읽어 → ilgeo, 앉아 → anja, 싫어 → sireo
        carry = RR_DBL_LIAISON[jong][1];
      } else if (nextEum && jong && RR_LIAISON[jong]) {
        carry = RR_LIAISON[jong];              // 생각이 → saenggagi, 살아 → sara
        out += body;
      } else if (jong === 27 && RR_ASP_FWD[nextIni]) {
        carry = RR_ASP_FWD[nextIni];           // 좋고 → joko, 좋다 → jota, 좋지 → jochi
        out += body;
      } else if (nextIni === 18 && RR_ASP_BACK[jong]) {
        carry = RR_ASP_BACK[jong];             // 축하 → chuka, 급히 → geupi
        out += body;
      } else if (RR_H_CLUSTER[jong] && RR_ASP_FWD[nextIni]) {
        out += body + RR_H_CLUSTER[jong];      // ㄶ/ㅀ + ㄱ/ㄷ/ㅈ: 많다 → manta, 싫다 → silta
        carry = RR_ASP_FWD[nextIni];
      } else if (jong === 4 && nextIni === 5) {
        out += body + "l"; carry = "l";        // ㄴ+ㄹ liquidizes → ll: 신라 → silla
      } else if (jong === 8 && nextIni === 2) {
        out += body + "l"; carry = "l";        // ㄹ+ㄴ liquidizes → ll: 설날 → seollal
      } else if (hasNext && (nextIni === 2 || nextIni === 6) && RR_NASAL[jong]) {
        out += body + RR_NASAL[jong];          // 국물 → gungmul, 있는 → inneun
      } else {
        out += body + RR_FINAL[jong];
      }
    }
    return out;
  }

  // Sample a vibrant-ish accent color from the album art and expose it as the
  // --aml-accent CSS variable (an "R, G, B" triplet). Cross-origin art can taint
  // the canvas; if reading pixels throws we silently keep the white default.
  // Purely additive — never propagates an error.
  // Pin a sampled RGB into a glow-friendly band while preserving its hue, so the
  // accent reads as the album's actual color (rich), not a washed pastel.
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0, s = 0, l = (max + min) / 2;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  function normalizeAccent(r, g, b) {
    var hsl = rgbToHsl(r, g, b);
    var h = hsl[0], s = hsl[1];
    // Target: vivid but not blinding. Pin luminance ~0.62. Lift weak saturation
    // so muted-but-colored art still reads — but leave near-gray art neutral
    // (don't invent a hue for a monochrome cover).
    if (s < 0.12) { s = Math.min(s, 0.08); }
    else { s = Math.max(s, 0.45); s = Math.min(s, 0.9); }
    return hslToRgb(h, s, 0.62);
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    var hk = h / 360;
    return [
      Math.round(f(p, q, hk + 1 / 3) * 255),
      Math.round(f(p, q, hk) * 255),
      Math.round(f(p, q, hk - 1 / 3) * 255)
    ];
  }

  // Four harmonious colors derived from the accent's hue (analogous + a far
  // accent). Always vivid, so the background mesh reads as color on any album.
  function accentPalette(r, g, b) {
    var hsl = rgbToHsl(r, g, b);
    var h = hsl[0], s = hsl[1];
    var S = Math.min(0.85, Math.max(0.5, s));
    var offsets = [0, 32, -32, 158];
    var lums = [0.56, 0.52, 0.5, 0.46];
    var out = [];
    for (var i = 0; i < 4; i++) {
      var c = hslToRgb(h + offsets[i], S, lums[i]);
      out.push(c[0] + ", " + c[1] + ", " + c[2]);
    }
    return out;
  }

  function applyAccentColor(overlayEl, artUrl) {
    if (!artUrl || !overlayEl) return;
    try {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var n = 16;
          var canvas = document.createElement("canvas");
          canvas.width = n; canvas.height = n;
          var ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, n, n);
          var data = ctx.getImageData(0, 0, n, n).data;
          var br = 0, bg = 0, bb = 0, bestScore = -1;
          var ar = 0, ag = 0, ab = 0, count = 0;
          for (var p = 0; p < data.length; p += 4) {
            var r = data[p], g = data[p + 1], b = data[p + 2], al = data[p + 3];
            if (al < 128) continue;
            var max = Math.max(r, g, b), min = Math.min(r, g, b);
            var lum = (max + min) / 2;
            ar += r; ag += g; ab += b; count++;
            // Prefer the most saturated mid-luminance pixel for the accent.
            if (lum > 30 && lum < 235) {
              var score = (max === 0 ? 0 : (max - min) / max) * (max - min);
              if (score > bestScore) { bestScore = score; br = r; bg = g; bb = b; }
            }
          }
          if (count === 0) return;
          var cr, cg, cb;
          if (bestScore > 0) { cr = br; cg = bg; cb = bb; }
          else { cr = Math.round(ar / count); cg = Math.round(ag / count); cb = Math.round(ab / count); }
          // Normalize in HSL: keep the album's hue, pin luminance into a
          // glow-friendly band.
          var rgb = normalizeAccent(cr, cg, cb);
          overlayEl.style.setProperty("--aml-accent", rgb[0] + ", " + rgb[1] + ", " + rgb[2]);

          // Mesh palette: harmonious hue rotations off the accent, so the
          // background is always colorful — even for white/monochrome covers
          // (where per-pixel extraction would yield gray).
          var pal = accentPalette(rgb[0], rgb[1], rgb[2]);
          for (var ci = 0; ci < 4; ci++) {
            overlayEl.style.setProperty("--aml-c" + (ci + 1), pal[ci]);
          }
        } catch (e) { }
      };
      img.onerror = function () { };
      img.src = artUrl;
    } catch (e) { }
  }

  // ── Sound-reactive background (opt-in) ──────────────────────────────────────
  // Drives the --aml-level CSS var (0..1) from the live audio's bass energy so
  // the gradient mesh pumps with the beat. OFF by default and toggled with "V":
  // it routes the media element through Web Audio (createMediaElementSource),
  // which we keep connected to the context destination so audio always plays.
  // If the browser blocks it (CORS / already-tapped element), we bail safely.
  // Default ON (YTM streams audio via same-origin MSE blobs, so the Web Audio
  // tap generally works without muting); the user can disable with "V" and the
  // choice persists. If the tap throws, we fail safe and leave audio untouched.
  var audioReactive = true;
  var audioCtx = null, audioSrc = null, audioAnalyser = null, audioFreq = null;
  var audioRafId = null, audioSourceFailed = false, audioSmoothed = 0;
  // Romanization of Korean lyrics — off by default, toggled with "R", persisted.
  var romanizeOn = false;
  try { romanizeOn = localStorage.getItem("aml_romanize") === "1"; } catch (e) { }
  try { audioReactive = localStorage.getItem("aml_audio_reactive") !== "0"; } catch (e) { }

  function audioSetLevel(v) {
    if (overlay) overlay.style.setProperty("--aml-level", String(v));
  }

  var audioGestureArmed = false;

  // Entry point: try to set up now; if the AudioContext can't run yet (no recent
  // user gesture), wait for the next gesture instead of routing audio through a
  // suspended context (which would mute playback).
  function startAudioReactive() {
    if (!audioReactive || audioSourceFailed) return;
    if (audioSrc && audioCtx && audioCtx.state === "running") { startAudioLoop(); return; }
    trySetupAudio();
    if (!audioSrc || !audioCtx || audioCtx.state !== "running") armAudioGesture();
  }

  function trySetupAudio() {
    if (!audioReactive || audioSourceFailed) return;
    var video = getVideo();
    if (!video) return;
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { audioSourceFailed = true; return; }
        audioCtx = new AC();
      }
    } catch (e) { audioSourceFailed = true; return; }
    if (audioCtx.state !== "running") {
      if (audioCtx.resume) {
        try { audioCtx.resume().then(function () { trySetupAudio(); }, function () { }); } catch (e) { }
      }
      return; // don't tap audio until the context is actually running
    }
    if (!audioSrc) {
      try {
        audioSrc = audioCtx.createMediaElementSource(video);
        audioAnalyser = audioCtx.createAnalyser();
        audioAnalyser.fftSize = 256;
        audioAnalyser.smoothingTimeConstant = 0.75;
        audioFreq = new Uint8Array(audioAnalyser.frequencyBinCount);
        audioSrc.connect(audioAnalyser);
        audioAnalyser.connect(audioCtx.destination);
      } catch (e) {
        // Element already tapped, or blocked — leave audio untouched.
        audioSourceFailed = true;
        return;
      }
    }
    startAudioLoop();
  }

  function armAudioGesture() {
    if (audioGestureArmed) return;
    audioGestureArmed = true;
    function onGesture() {
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
      audioGestureArmed = false;
      if (audioReactive) trySetupAudio();
    }
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
  }

  function startAudioLoop() {
    if (audioRafId || !audioAnalyser) return;
    function loop() {
      if (!audioReactive || !audioAnalyser || !overlay) { audioRafId = null; return; }
      audioAnalyser.getByteFrequencyData(audioFreq);
      var sum = 0, bins = 10;
      for (var i = 0; i < bins; i++) sum += audioFreq[i];
      var level = sum / (bins * 255);
      audioSmoothed += (level - audioSmoothed) * 0.28;
      var out = Math.min(1, audioSmoothed * 1.6);
      audioSetLevel(Math.round(out * 1000) / 1000);
      audioRafId = requestAnimationFrame(loop);
    }
    audioRafId = requestAnimationFrame(loop);
  }

  function stopAudioReactive() {
    if (audioRafId) { cancelAnimationFrame(audioRafId); audioRafId = null; }
    audioSmoothed = 0;
    audioSetLevel(0);
    // audioSrc stays connected to destination so playback continues.
  }

  function toggleAudioReactive() {
    audioReactive = !audioReactive;
    try { localStorage.setItem("aml_audio_reactive", audioReactive ? "1" : "0"); } catch (e) { }
    if (audioReactive) startAudioReactive();
    else stopAudioReactive();
    if (audioReactive && audioSourceFailed) showToast("사운드 반응 사용 불가 (브라우저 차단)");
    else showToast(audioReactive ? "사운드 반응 켜짐" : "사운드 반응 꺼짐");
  }

  function toggleRomanize() {
    romanizeOn = !romanizeOn;
    try { localStorage.setItem("aml_romanize", romanizeOn ? "1" : "0"); } catch (e) { }
    if (overlay) {
      if (romanizeOn) overlay.classList.add("aml-show-roman");
      else overlay.classList.remove("aml-show-roman");
      // Line heights changed — re-cache offsets and re-anchor the active line.
      cacheLinePositions();
      var keep = activeIndex;
      if (keep >= 0) { activeIndex = -1; setActive(keep); }
    }
    showToast(romanizeOn ? "로마자 켜짐" : "로마자 꺼짐");
  }

  var toastTimer = null;
  function showToast(text) {
    if (!overlay) return;
    var t = overlay.querySelector(".aml-toast");
    if (!t) { t = document.createElement("div"); t.className = "aml-toast"; overlay.appendChild(t); }
    t.textContent = text;
    t.classList.add("aml-toast-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      var el = overlay && overlay.querySelector(".aml-toast");
      if (el) el.classList.remove("aml-toast-show");
    }, 1700);
  }

  function getSongInfo() {
    var bar = document.querySelector("ytmusic-player-bar");
    if (!bar) return { title: "", artist: "", rawArtist: "" };
    var titleEl =
      bar.querySelector(".content-info-wrapper > yt-formatted-string") ||
      bar.querySelector("yt-formatted-string.title") ||
      bar.querySelector(".title");
    var subtitleEl =
      bar.querySelector(".content-info-wrapper .subtitle yt-formatted-string") ||
      bar.querySelector(".content-info-wrapper .byline") ||
      bar.querySelector(".subtitle");
    var rawTitle = titleEl ? (titleEl.title || titleEl.textContent || "") : "";
    var rawSubtitle = subtitleEl ? (subtitleEl.title || subtitleEl.textContent || "") : "";
    var artistParts = rawSubtitle.split(/[·•]/);
    var artist = artistParts[0] || "";
    return {
      title: rawTitle.trim(),
      artist: artist.trim(),
      rawArtist: rawSubtitle.trim(),
    };
  }

  // Shared across clickLyricsTab / findLyricsTab \u2014 kept in one place so a YTM
  // markup change is a single-point fix.
  var LYRICS_TAB_SELECTORS = [
    "ytmusic-player-page tp-yt-paper-tab",
    "tp-yt-paper-tab.tab-header",
    "#tabsContent tp-yt-paper-tab",
    "tp-yt-paper-tab",
  ];
  var LYRICS_TAB_KEYWORDS = ["lyrics", "lyric", "\uac00\uc0ac", "\u6b4c\u8a5e", "letras", "paroles", "testo"];

  function queryLyricsTabs() {
    for (var c = 0; c < LYRICS_TAB_SELECTORS.length; c++) {
      var tabs = document.querySelectorAll(LYRICS_TAB_SELECTORS[c]);
      if (tabs.length > 0) return tabs;
    }
    return [];
  }

  function tabMatchesLyrics(tab) {
    var text = tab.textContent.trim().toLowerCase();
    for (var k = 0; k < LYRICS_TAB_KEYWORDS.length; k++) {
      if (text.indexOf(LYRICS_TAB_KEYWORDS[k]) !== -1) return true;
    }
    return false;
  }

  function clickLyricsTab() {
    var tabs = queryLyricsTabs();
    if (tabs.length === 0) return false;
    for (var t = 0; t < tabs.length; t++) {
      if (tabMatchesLyrics(tabs[t])) { tabs[t].click(); lyricsTabClicked = true; return true; }
    }
    if (tabs.length >= 2) { tabs[1].click(); lyricsTabClicked = true; return true; }
    return false;
  }

  function getLyricsText() {
    var sels = [
      "ytmusic-description-shelf-renderer #description",
      "ytmusic-description-shelf-renderer .description",
      "ytmusic-description-shelf-renderer .content",
      "#tab-renderer ytmusic-description-shelf-renderer .description",
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) { var tx = (el.textContent || "").trim(); if (tx.length > 10) return tx; }
    }
    var shelf = document.querySelector("ytmusic-description-shelf-renderer");
    if (shelf) {
      var footer = shelf.querySelector(".footer");
      var header = shelf.querySelector(".header");
      var raw = shelf.textContent || "";
      if (footer) raw = raw.replace(footer.textContent, "");
      if (header) raw = raw.replace(header.textContent, "");
      raw = raw.trim();
      if (raw.length > 10) return raw;
    }
    return null;
  }

  function parseLRC(lrc) {
    var result = [];
    var lines = lrc.split("\n");
    var offsetMs = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      var offMatch = line.match(/\[offset:\s*([-\d.]+)\]/i);
      if (offMatch) { offsetMs = parseFloat(offMatch[1]); continue; }

      if (/^\[(?:ti|ar|al|by|re|ve|length):/.test(line)) continue;

      var timestamps = [];
      var textPart = line;
      var tagRe = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
      var match;
      while ((match = tagRe.exec(line)) !== null) {
        var mins = parseInt(match[1], 10);
        var secStr = match[2].replace(":", ".");
        var secs = parseFloat(secStr);
        timestamps.push(mins * 60 + secs + offsetMs / 1000);
        textPart = textPart.replace(match[0], "");
      }
      // Strip enhanced-LRC per-word timing tags (<mm:ss.xx>) so they don't
      // render as literal text; collapse the whitespace they leave behind.
      textPart = textPart.replace(/<\d+:\d+(?:[.:]\d+)?>/g, "").replace(/\s{2,}/g, " ");
      var text = textPart.trim();
      for (var t = 0; t < timestamps.length; t++) {
        result.push({ time: timestamps[t], text: text });
      }
    }
    result.sort(function (a, b) { return a.time - b.time; });
    return result;
  }

  // fetch() with a hard timeout — a single slow/hung request must never stall
  // the whole fallback chain (this was the cause of multi-second lyric loads).
  function fetchT(url, opts, ms) {
    opts = opts || {};
    ms = ms || 5000;
    if (typeof AbortController === "undefined") return fetch(url, opts);
    var ac = new AbortController();
    opts.signal = ac.signal;
    var to = setTimeout(function () { ac.abort(); }, ms);
    return fetch(url, opts).then(
      function (r) { clearTimeout(to); return r; },
      function (e) { clearTimeout(to); throw e; }
    );
  }

  // Binimum — Apple Music's TTML lyrics database (word/syllable timing).
  // Same source Better Lyrics treats as primary. Returns Apple Music TTML
  // (itunes:timing="Word") with absolute <p begin> and <span begin> times.
  var BINIMUM_API = "https://lyrics-api.binimum.org/";

  function binimumFetchLyrics(title, artist, duration) {
    var titles = getTitleVariations(title);
    var i = 0;
    function next() {
      if (i >= titles.length) return Promise.resolve(null);
      return binimumFetchOne(titles[i++], artist, duration).then(function (r) { return r || next(); });
    }
    return next();
  }

  function binimumFetchOne(title, artist, duration) {
    if (!title) return Promise.resolve(null);
    var qs = "?track=" + encodeURIComponent(title) +
             "&artist=" + encodeURIComponent(artist || "");
    if (duration > 0 && !isNaN(duration)) qs += "&duration=" + Math.round(duration);
    var searchUrl = BINIMUM_API + qs;
    return fetchT(searchUrl, null, 4500).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      if (!data || !data.results || !data.results.length) return null;
      var results = data.results.slice();
      // Reject results whose title/artist clearly don't match what's playing —
      // a short title like "팅" otherwise pulls an unrelated word-synced song.
      var anyTitled = false;
      for (var ai = 0; ai < results.length; ai++) {
        if (fieldOf(results[ai], ["trackName", "title", "name", "track"])) { anyTitled = true; break; }
      }
      if (anyTitled) {
        results = results.filter(function (r) {
          return candidateMatches(
            fieldOf(r, ["trackName", "title", "name", "track"]),
            fieldOf(r, ["artistName", "artist", "artistNames"]),
            title, artist
          );
        });
        if (!results.length) return null;
      }
      // Prefer word-level results, then closest duration match.
      results.sort(function (a, b) {
        var ta = a.timing_type === "word" ? 0 : 1;
        var tb = b.timing_type === "word" ? 0 : 1;
        if (ta !== tb) return ta - tb;
        if (duration > 0) {
          var da = Math.abs((a.duration || 0) - duration);
          var db = Math.abs((b.duration || 0) - duration);
          return da - db;
        }
        return 0;
      });
      var pick = results[0];
      if (!pick || !pick.lyricsUrl) return null;
      // Only follow lyricsUrl if it points at a known Binimum host (the same
      // origins declared in host_permissions) — don't fetch arbitrary URLs the
      // API hands us.
      try {
        var lyHost = new URL(pick.lyricsUrl, BINIMUM_API).hostname;
        if (lyHost !== "lyrics-storage.binimum.org" && lyHost !== "lyrics-api.binimum.org") return null;
      } catch (e) { return null; }
      if (duration > 0 && pick.duration && Math.abs(pick.duration - duration) > MAX_DURATION_DIFF) return null;
      return fetchT(pick.lyricsUrl, null, 4500).then(function (r) {
        if (!r.ok) return null;
        return r.text();
      }).then(function (ttml) {
        if (!ttml) return null;
        var parsed = parseTTML(ttml);
        if (!parsed || parsed.length < 2) return null;
        var hasWords = false;
        for (var i = 0; i < parsed.length; i++) {
          if (parsed[i].words && parsed[i].words.length > 0) { hasWords = true; break; }
        }
        return { parsed: parsed, hasWords: hasWords };
      });
    }).catch(function () { return null; });
  }

  var CUBEY_API = "https://lyrics.api.dacubeking.com/";

  function cubeyTurnstile() {
    return new Promise(function (resolve, reject) {
      var iframe = document.createElement("iframe");
      iframe.src = CUBEY_API + "challenge";
      iframe.style.cssText = "position:fixed;bottom:0;right:0;width:0;height:0;border:none;z-index:-1";
      document.body.appendChild(iframe);

      function onMsg(ev) {
        if (ev.source !== iframe.contentWindow) return;
        if (ev.data && ev.data.type === "turnstile-token") { cleanup(); resolve(ev.data.token); }
        else if (ev.data && (ev.data.type === "turnstile-error" || ev.data.type === "turnstile-timeout")) {
          cleanup(); reject(new Error("turnstile failed"));
        }
      }
      function cleanup() {
        window.removeEventListener("message", onMsg);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }
      window.addEventListener("message", onMsg);
      setTimeout(function () { cleanup(); reject(new Error("turnstile timeout")); }, 8000);
    });
  }

  var CUBEY_JWT_KEY = "aml_cubey_jwt";

  // JWT lives in chrome.storage.local (extension-only) rather than localStorage,
  // which any MAIN-world page script could read.
  function cubeyGetJWT(forceNew) {
    return new Promise(function (resolve) {
      if (forceNew || !isExtensionValid()) { resolve(null); return; }
      chrome.storage.local.get([CUBEY_JWT_KEY], function (res) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        var stored = res[CUBEY_JWT_KEY];
        if (stored) {
          try {
            var parts = stored.split(".");
            if (parts[1]) {
              var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
              if (payload.exp && Date.now() / 1000 < payload.exp) { resolve(stored); return; }
            }
          } catch (e) { }
        }
        resolve(null);
      });
    }).then(function (cached) {
      if (cached) return cached;
      return cubeyTurnstile().then(function (token) {
        return fetchT(CUBEY_API + "verify-turnstile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token }),
          credentials: "include"
        }, 6000);
      }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (data) {
        if (data && data.jwt) {
          if (isExtensionValid()) {
            var save = {}; save[CUBEY_JWT_KEY] = data.jwt;
            chrome.storage.local.set(save);
          }
          return data.jwt;
        }
        return null;
      }).catch(function () { return null; });
    });
  }

  function cubeyFetchLyrics(title, artist, duration, videoId) {
    if (debugVisible) console.log("[AML] Cubey: starting, videoId=" + videoId);
    return cubeyGetJWT(false).then(function (jwt) {
      if (debugVisible) console.log("[AML] Cubey: JWT=" + (jwt ? "got" : "null"));
      if (!jwt) return null;

      function doFetch(token) {
        var url = CUBEY_API + "lyrics?song=" + encodeURIComponent(title) +
          "&artist=" + encodeURIComponent(artist) +
          "&duration=" + Math.round(duration) +
          "&videoId=" + encodeURIComponent(videoId) +
          "&alwaysFetchMetadata=false";
        if (debugVisible) console.log("[AML] Cubey fetch:", url);
        return fetchT(url, {
          headers: { "Authorization": "Bearer " + token },
          credentials: "include"
        }, 6000).then(function (r) {
          if (debugVisible) console.log("[AML] Cubey response:", r.status);
          if (r.status === 403) {
            // Token expired/rejected — refresh and retry. The JWT travels in the
            // Authorization header (not the URL), so reuse the same url and parse
            // the retried response as JSON like the success path below.
            return cubeyGetJWT(true).then(function (newJwt) {
              if (!newJwt) return null;
              return fetchT(url, {
                headers: { "Authorization": "Bearer " + newJwt },
                credentials: "include"
              }, 6000).then(function (r2) {
                return r2.ok ? r2.json() : null;
              });
            });
          }
          if (!r.ok) {
            return r.text().then(function (body) {
              if (debugVisible) console.warn("[AML] Cubey API error:", r.status, body);
              return null;
            });
          }
          return r.json();
        });
      }

      return doFetch(jwt);
    }).catch(function (e) { if (debugVisible) console.warn("[AML] Cubey failed:", e); return null; });
  }

  function parseTTMLTime(str) {
    if (!str) return 0;
    if (typeof str === "number") return str;

    var unitMatch = str.match(/^([\d.]+)(h|m|s|ms)$/);
    if (unitMatch) {
      var val = parseFloat(unitMatch[1]);
      var unit = unitMatch[2];
      if (unit === "h") return val * 3600;
      if (unit === "m") return val * 60;
      if (unit === "s") return val;
      if (unit === "ms") return val / 1000;
    }

    var parts = str.replace(/[^0-9.:]/g, "").split(":");
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(str) / 1000;
  }

  function parseTTMLWords(pEl, divOffset) {
    var spans = pEl.querySelectorAll("span, s");
    var words = [];
    for (var s = 0; s < spans.length; s++) {
      var sb = spans[s].getAttribute("begin") || spans[s].getAttribute("t");
      var sEnd = spans[s].getAttribute("end");
      var sDur = spans[s].getAttribute("d");
      var st = (spans[s].textContent || "");
      if (sb && st) {
        // Apple Music TTML separates words with whitespace TEXT NODES between
        // sibling spans. Syllables within a word have no such gap. Detect and
        // preserve the inter-word space so rendering doesn't run words together.
        var trail = "";
        var sib = spans[s].nextSibling;
        if (sib && sib.nodeType === 3 && /^\s/.test(sib.nodeValue || "")) trail = " ";
        var startSec = divOffset + parseTTMLTime(sb);
        // `end` is an absolute clock value; `d` is a duration relative to begin.
        var endSec = 0;
        if (sEnd) endSec = divOffset + parseTTMLTime(sEnd);
        else if (sDur) endSec = startSec + parseTTMLTime(sDur);
        words.push({ startMs: Math.round(startSec * 1000), endMs: Math.round(endSec * 1000), text: st + trail });
      }
    }
    return words.length > 0 ? words : null;
  }

  function parseTTML(ttmlStr) {
    try {
      var doc = new DOMParser().parseFromString(ttmlStr, "text/xml");
      var result = [];
      var hasWords = false;
      var divEls = doc.querySelectorAll("div");
      if (divEls.length > 0) {
        // First pass: detect whether <p begin> values are absolute or relative to <div begin>.
        // Apple Music TTML uses absolute <p begin>; some older formats use relative. Heuristic:
        // if any <p begin> is >= its enclosing <div begin>, times are absolute for the whole doc.
        var timesAreAbsolute = false;
        for (var dd = 0; dd < divEls.length && !timesAreAbsolute; dd++) {
          var db = divEls[dd].getAttribute("begin") || divEls[dd].getAttribute("t");
          var dbSec = db ? parseTTMLTime(db) : 0;
          if (dbSec <= 0) continue;
          var probe = divEls[dd].querySelectorAll(":scope > p");
          if (probe.length === 0) probe = divEls[dd].querySelectorAll("p");
          for (var pp = 0; pp < probe.length; pp++) {
            var pb = probe[pp].getAttribute("begin") || probe[pp].getAttribute("t");
            if (!pb) continue;
            if (parseTTMLTime(pb) >= dbSec - 0.001) { timesAreAbsolute = true; break; }
          }
        }
        for (var d = 0; d < divEls.length; d++) {
          var divBegin = divEls[d].getAttribute("begin") || divEls[d].getAttribute("t");
          var divOffset = divBegin ? parseTTMLTime(divBegin) : 0;
          var effectiveOffset = timesAreAbsolute ? 0 : divOffset;
          var pEls = divEls[d].querySelectorAll(":scope > p");
          if (pEls.length === 0) pEls = divEls[d].querySelectorAll("p");
          for (var i = 0; i < pEls.length; i++) {
            var begin = pEls[i].getAttribute("begin") || pEls[i].getAttribute("t");
            var text = (pEls[i].textContent || "").trim();
            if (begin && text) {
              var pTime = parseTTMLTime(begin);
              var entry = { time: effectiveOffset + pTime, text: text };
              var words = parseTTMLWords(pEls[i], effectiveOffset);
              if (words) { entry.words = words; hasWords = true; }
              result.push(entry);
            }
          }
        }
      }
      if (result.length < 2) {
        result = [];
        hasWords = false;
        var topP = doc.querySelectorAll("p");
        for (var j = 0; j < topP.length; j++) {
          var pBegin = topP[j].getAttribute("begin") || topP[j].getAttribute("t");
          var pText = (topP[j].textContent || "").trim();
          if (pBegin && pText) {
            var topEntry = { time: parseTTMLTime(pBegin), text: pText };
            var topWords = parseTTMLWords(topP[j], 0);
            if (topWords) { topEntry.words = topWords; hasWords = true; }
            result.push(topEntry);
          }
        }
      }
      result.sort(function (a, b) { return a.time - b.time; });
      if (debugVisible && result.length >= 2) {
        console.log("[AML] TTML parsed:", result.length, "lines" + (hasWords ? " (word-synced)" : ""), ", first:", result[0].time.toFixed(2) + "s", JSON.stringify(result[0].text), "last:", result[result.length - 1].time.toFixed(2) + "s");
      }
      return result;
    } catch (e) { return []; }
  }

  function parseCubeyResponse(data) {
    if (!data) return null;

    if (data.goLyricsApiTtml) {
      try {
        var ttmlData = JSON.parse(data.goLyricsApiTtml);
        var ttmlStr = ttmlData.ttml || (typeof ttmlData === "string" ? ttmlData : null);
        if (ttmlStr) {
          var ttmlLines = parseTTML(ttmlStr);
          if (ttmlLines.length >= 2) {
            var hasWordData = false;
            for (var tw = 0; tw < ttmlLines.length; tw++) { if (ttmlLines[tw].words) { hasWordData = true; break; } }
            return { source: "cubey-ttml", type: hasWordData ? "word" : "line", parsed: ttmlLines, hasWords: hasWordData };
          }
        }
      } catch (e) { }
    }

    if (data.musixmatchSyncedLyrics) {
      var mxmLines = parseLRC(data.musixmatchSyncedLyrics);
      if (mxmLines.length >= 2) return { source: "cubey-mxm", type: "line", parsed: mxmLines };
    }
    if (data.lrclibSyncedLyrics) {
      var lrcLines = parseLRC(data.lrclibSyncedLyrics);
      if (lrcLines.length >= 2) return { source: "cubey-lrclib", type: "line", parsed: lrcLines };
    }
    if (data.lrclibPlainLyrics && data.lrclibPlainLyrics.length > 10) {
      return { source: "cubey-plain", type: "plain", plainText: data.lrclibPlainLyrics };
    }
    return null;
  }

  function getArtistVariations(artist) {
    var v = [artist];
    var p1 = artist.match(/\(([^)]+)\)/);
    if (p1) { v.push(p1[1].trim()); v.push(artist.replace(/\([^)]+\)/, "").trim()); }
    var p2 = artist.match(/\uff08([^\uff09]+)\uff09/);
    if (p2) { v.push(p2[1].trim()); v.push(artist.replace(/\uff08[^\uff09]+\uff09/, "").trim()); }
    return v.filter(function (s) { return s.length > 0; });
  }

  // Title variations to widen matching \u2014 especially for Korean tracks, which on
  // YouTube Music routinely carry a bilingual title like "\uc0ac\ub791\uc778\uac00 \ubd10 (Love, maybe)"
  // while the lyric databases key on one form or the other. Tries (in order):
  // the original, the title without any (parenthetical), the parenthetical's
  // content alone, the part before " - ", and a feat/prod-stripped form.
  // Capped to keep the per-source request count bounded.
  function getTitleVariations(title) {
    var t = (title || "").trim();
    if (!t) return [""];
    var out = [t];
    function add(s) {
      s = (s || "").trim();
      if (s && s.length >= 2 && out.indexOf(s) === -1) out.push(s);
    }
    // Full/half-width parentheses.
    add(t.replace(/\s*[\(\uff08][^\)\uff09]*[\)\uff09]\s*/g, " ").replace(/\s{2,}/g, " ").trim());
    var pm = t.match(/[\(\uff08]([^\)\uff09]+)[\)\uff09]/);
    if (pm) add(pm[1]);
    var dash = t.indexOf(" - ");
    if (dash > 0) add(t.slice(0, dash));
    add(t.replace(/\s*[\(\uff08]?\s*(feat|ft|with|prod)\.?[^\)\uff09]*[\)\uff09]?\s*$/i, "").trim());
    // Cap hard: each extra variation multiplies sequential requests. Original +
    // one cleaned form covers the common bilingual-title case without the fan-out
    // that made search take ~1 minute on misses.
    return out.slice(0, 2);
  }

  var MAX_DURATION_DIFF = 10;

  // ── Match verification ──────────────────────────────────────────────────────
  // Title variations widen matching for Korean tracks, but a short/generic title
  // (e.g. "팅") can pull a completely different song. Before trusting a result we
  // check its title+artist loosely agree with what's actually playing.
  function normMatch(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[\(\[（][^\)\]）]*[\)\]）]/g, "")           // drop (parentheticals)
      .replace(/\b(feat|ft|featuring|with|prod|remaster|remix|inst|instrumental)\b\.?/g, "")
      .replace(/[^0-9a-z가-힣]/g, "");             // keep alnum + Hangul
  }
  function looseMatch(a, b) {
    a = normMatch(a); b = normMatch(b);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 2 && b.length >= 2 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) return true;
    return false;
  }
  function fieldOf(obj, names) {
    for (var i = 0; i < names.length; i++) {
      if (obj[names[i]]) return obj[names[i]];
    }
    return "";
  }
  // True if a candidate's title+artist are an acceptable match for what's playing.
  // Artist is the strong discriminator (a bare title like "팅" matches many songs,
  // but the wrong one will have a different artist). Fields we can't read are not
  // held against the candidate.
  function candidateMatches(candTitle, candArtist, wantTitle, wantArtist) {
    var titleOk = !candTitle || looseMatch(candTitle, wantTitle);
    var artistOk = !candArtist || !wantArtist || looseMatch(candArtist, wantArtist) ||
                   looseMatch(candArtist, getArtistVariations(wantArtist)[0] || wantArtist);
    return titleOk && artistOk;
  }

  function lrcGet(title, artist, dur) {
    var u = "https://lrclib.net/api/get?track_name=" + encodeURIComponent(title) +
      "&artist_name=" + encodeURIComponent(artist) + "&duration=" + Math.round(dur);
    return fetchT(u, null, 4500).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.syncedLyrics) return null;
        if (dur > 0 && d.duration && Math.abs(d.duration - dur) > MAX_DURATION_DIFF) return null;
        return parseLRC(d.syncedLyrics);
      })
      .catch(function () { return null; });
  }

  function lrcSearch(q, duration, vTitle, vArtist) {
    return fetchT("https://lrclib.net/api/search?q=" + encodeURIComponent(q), null, 4500)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (a) {
        if (!a || !a.length) return null;
        var synced = a.filter(function (r) { return r.syncedLyrics; });
        if (!synced.length) return null;

        // Verify the returned track actually matches what's playing — the search
        // endpoint is fuzzy and will happily return a different song.
        if (vTitle) {
          synced = synced.filter(function (r) {
            return candidateMatches(r.trackName || r.name, r.artistName, vTitle, vArtist);
          });
          if (!synced.length) return null;
        }

        if (duration > 0) {
          synced.sort(function (x, y) {
            return Math.abs((x.duration || 0) - duration) - Math.abs((y.duration || 0) - duration);
          });
          if (Math.abs((synced[0].duration || 0) - duration) <= MAX_DURATION_DIFF) {
            return parseLRC(synced[0].syncedLyrics);
          }
          return null;
        }
        return parseLRC(synced[0].syncedLyrics);
      }).catch(function () { return null; });
  }

  var MXM_TOKEN_KEY = "mxm_user_token";
  var MXM_TOKEN_TS_KEY = "mxm_user_token_ts";
  var MXM_TOKEN_TTL_MS = 10 * 60 * 1000;

  function mxmGetToken(forceRefresh) {
    return new Promise(function (resolve) {
      if (!isExtensionValid()) { resolve(null); return; }
      chrome.storage.local.get([MXM_TOKEN_KEY, MXM_TOKEN_TS_KEY], function (stored) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        var now = Date.now();
        var cachedToken = stored[MXM_TOKEN_KEY];
        var cachedTs = stored[MXM_TOKEN_TS_KEY] || 0;

        if (!forceRefresh && cachedToken && now - cachedTs < MXM_TOKEN_TTL_MS) {
          resolve(cachedToken);
          return;
        }

        var tokenUrl = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&format=json&t=" + Date.now();
        fetchT(tokenUrl, null, 4500)
          .then(function (r) {
            if (!r.ok) return null;
            return r.json();
          })
          .then(function (d) {
            if (!d) { resolve(null); return; }
            var token = d && d.message && d.message.body && d.message.body.user_token;
            if (!token) {
              if (d.message && d.message.header && d.message.header.status_code === 401) {
                resolve(null); return;
              }
              resolve(null);
              return;
            }
            var save = {};
            save[MXM_TOKEN_KEY] = token;
            save[MXM_TOKEN_TS_KEY] = now;
            if (isExtensionValid()) {
              chrome.storage.local.set(save, function () { resolve(token); });
            } else { resolve(token); }
          })
          .catch(function () {
            resolve(null);
          });
      });
    });
  }

  // The matched track Musixmatch actually resolved to (for verification).
  function mxmExtractMatchedTrack(data) {
    try {
      var mc = data.message.body.macro_calls;
      var t = mc["matcher.track.get"] &&
              mc["matcher.track.get"].message &&
              mc["matcher.track.get"].message.body &&
              mc["matcher.track.get"].message.body.track;
      if (t) return { title: t.track_name || "", artist: t.artist_name || "" };
    } catch (e) { }
    return null;
  }

  function mxmExtractSubtitleBody(data) {
    return data &&
      data.message &&
      data.message.body &&
      data.message.body.macro_calls &&
      data.message.body.macro_calls["track.subtitles.get"] &&
      data.message.body.macro_calls["track.subtitles.get"].message &&
      data.message.body.macro_calls["track.subtitles.get"].message.body &&
      data.message.body.macro_calls["track.subtitles.get"].message.body.subtitle_list &&
      data.message.body.macro_calls["track.subtitles.get"].message.body.subtitle_list[0] &&
      data.message.body.macro_calls["track.subtitles.get"].message.body.subtitle_list[0].subtitle &&
      data.message.body.macro_calls["track.subtitles.get"].message.body.subtitle_list[0].subtitle.subtitle_body;
  }

  function mxmFetchForArtist(title, artist, duration, forceTokenRefresh) {
    return mxmGetToken(forceTokenRefresh).then(function (token) {
      if (!token) return null;

      var durSec = duration > 0 && !isNaN(duration) ? Math.round(duration) : 0;
      var url = "https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get" +
        "?format=json&namespace=lyrics_richsynced&subtitle_format=mxm&app_id=web-desktop-app-v1.0" +
        "&q_track=" + encodeURIComponent(title) +
        "&q_artist=" + encodeURIComponent(artist) +
        "&q_duration=" + durSec +
        "&usertoken=" + encodeURIComponent(token);

      return fetchT(url, null, 5000)
        .then(function (r) {
          if (r.status === 401) return { __mxmUnauthorized: true };
          if (!r.ok) {
            if (debugVisible) console.warn("[AML] Musixmatch lyrics request failed", r.status);
            return null;
          }
          return r.json();
        })
        .then(function (data) {
          if (data && data.__mxmUnauthorized) {
            if (!forceTokenRefresh) {
              return mxmFetchForArtist(title, artist, duration, true);
            }
            if (debugVisible) console.warn("[AML] Musixmatch token refresh failed after 401");
            return null;
          }

          // Reject a fuzzy mismatch (Musixmatch resolved a different song).
          var matched = mxmExtractMatchedTrack(data);
          if (matched && !candidateMatches(matched.title, matched.artist, title, artist)) {
            return null;
          }

          var subtitleBody = mxmExtractSubtitleBody(data);
          if (!subtitleBody) return null;

          var parsed = parseLRC(subtitleBody);
          if (parsed && parsed.length >= 2) return parsed;
          return null;
        })
        .catch(function (err) {
          if (debugVisible) console.warn("[AML] Musixmatch lyrics fetch error", err);
          return null;
        });
    });
  }

  function mxmFetchLyrics(title, artist, duration) {
    var titles = getTitleVariations(title);
    var artists = getArtistVariations(artist).slice(0, 2);
    if (!artists.length) artists = [artist || ""];
    // (title, artist) pairs — original first. Capped (≤2 titles × ≤2 artists)
    // to keep the sequential request count small.
    var pairs = [];
    for (var ti = 0; ti < titles.length; ti++) {
      for (var ai = 0; ai < artists.length; ai++) pairs.push([titles[ti], artists[ai]]);
    }
    var idx = 0;
    function nextPair() {
      if (idx >= pairs.length) return Promise.resolve(null);
      var p = pairs[idx++];
      return mxmFetchForArtist(p[0], p[1], duration, false).then(function (parsed) {
        return parsed || nextPair();
      });
    }
    return nextPair();
  }

  function fetchSyncedLyrics(title, artist, duration) {
    var titles = getTitleVariations(title);
    var arts = getArtistVariations(artist).slice(0, 2);
    if (!arts.length) arts = [artist || ""];
    // Exact get: original title across artist variations, then the cleaned title
    // against the primary artist.
    var gets = [];
    for (var ai = 0; ai < arts.length; ai++) gets.push([title, arts[ai]]);
    for (var tg = 1; tg < titles.length; tg++) gets.push([titles[tg], arts[0]]);
    var gi = 0;
    function nextGet() {
      if (gi >= gets.length) return nextSearch();
      var g = gets[gi++];
      return lrcGet(g[0], g[1], duration).then(function (r) { return r || nextGet(); });
    }
    // Free-text search: each title against the primary artist only (the get
    // step already tried the artist variations). Verified against title+artist.
    var searches = [];
    for (var ts = 0; ts < titles.length; ts++) {
      searches.push({ q: titles[ts] + " " + arts[0], t: titles[ts], a: arts[0] });
    }
    var si = 0;
    function nextSearch() {
      if (si >= searches.length) return Promise.resolve(null);
      var s = searches[si++];
      return lrcSearch(s.q, duration, s.t, s.a).then(function (r) { return r || nextSearch(); });
    }
    return nextGet();
  }

  function getVideoId() {
    if (playerVideoId) return playerVideoId;
    try {
      var params = new URLSearchParams(location.search);
      return params.get("v") || "";
    } catch (e) { return ""; }
  }

  function loadSongOffset(videoId) {
    if (!videoId) return 0;
    try { var s = localStorage.getItem("aml_offset_" + videoId); return s ? parseFloat(s) || 0 : 0; }
    catch (e) { return 0; }
  }

  function saveSongOffset(videoId, offset) {
    if (!videoId) return;
    try { localStorage.setItem("aml_offset_" + videoId, String(Math.round(offset * 1000) / 1000)); }
    catch (e) { }
  }

  var playerTime = 0;
  var playerPlaying = false;
  var playerVideoId = "";
  // Tick was generated at this Date.now() in the MAIN-world bridge. We use it to
  // (a) add back the latency between tick generation and our processing, and
  // (b) detect time jumps by comparing wall-clock delta vs song-time delta.
  var playerBrowserTime = 0;
  var lastTickPlayerTime = -1;
  var lastTickBrowserTime = 0;

  window.addEventListener("message", function (e) {
    // Only trust ticks from our own page context (the MAIN-world bridge), not
    // from embedded iframes (ads, third-party embeds) that could spoof the clock.
    if (e.origin !== location.origin) return;
    if (e.source !== window) return;
    if (!e.data || e.data.type !== "aml-player-tick") return;
    playerTime = e.data.currentTime;
    playerPlaying = e.data.playing;
    playerBrowserTime = e.data.browserTime || Date.now();
    if (e.data.videoId) playerVideoId = e.data.videoId;
  });

  // Detect a time jump (seek, song change) by comparing the song-time delta
  // since the last tick to the wall-clock delta. If they diverge by more than
  // TIME_JUMP_THRESHOLD seconds, the player jumped (rather than continuously
  // advancing). Modeled after Better Lyrics' approach.
  var TIME_JUMP_THRESHOLD = 0.5;

  function startSync() {
    if (syncActive) return;
    stopSync();
    syncActive = true;
    lastVisibleTime = 0;
    lastSyncLog = 0;
    lastSearchHint = 0;
    lastTickPlayerTime = -1;
    lastTickBrowserTime = 0;

    function syncFrame() {
      if (!syncActive || !overlay) return;
      // The bridge reports movie_player's live video id every tick. If it no
      // longer matches the song this overlay was built for, the track advanced
      // (e.g. auto-play to the next song) — rebuild instead of scrubbing the
      // previous song's lyrics against the new song's clock.
      if (playerVideoId && currentVideoId && playerVideoId !== currentVideoId) {
        handleBridgeSongChange();
        return;
      }
      var rawTime = playerTime;
      var browserNow = Date.now();
      var sourceBrowserTime = playerBrowserTime;
      var sourceFromBridge = rawTime > 0 && sourceBrowserTime > 0;
      if (!(rawTime > 0)) {
        var vid = getVideo();
        if (vid && vid.currentTime > 0) {
          rawTime = vid.currentTime;
          sourceBrowserTime = browserNow;
          sourceFromBridge = false;
        }
      }
      if (rawTime > 0) {
        // Latency correction: tick was created at sourceBrowserTime. By the time
        // we run this RAF callback, browserNow - sourceBrowserTime ms have passed.
        // While playing, song time has advanced by that much too; add it back.
        var t = rawTime;
        if (sourceFromBridge && playerPlaying) {
          var ageMs = browserNow - sourceBrowserTime;
          if (ageMs > 0 && ageMs < 1000) t += ageMs / 1000;
        }

        // Event-timestamp jump detection — robust across pause/buffer wobble.
        if (lastTickPlayerTime >= 0 && lastTickBrowserTime > 0 && playerPlaying) {
          var songDelta = rawTime - lastTickPlayerTime;
          var wallDelta = (sourceBrowserTime - lastTickBrowserTime) / 1000;
          if (wallDelta > 0.05 && Math.abs(songDelta - wallDelta) > TIME_JUMP_THRESHOLD) {
            activeIndex = -1;
            lastSearchHint = 0;
          }
        }
        lastTickPlayerTime = rawTime;
        lastTickBrowserTime = sourceBrowserTime;
        lastVisibleTime = t;
        processSync(t);
      }
      syncRafId = requestAnimationFrame(syncFrame);
    }
    syncRafId = requestAnimationFrame(syncFrame);
  }

  function stopSync() {
    syncActive = false;
    if (syncRafId) { cancelAnimationFrame(syncRafId); syncRafId = null; }
  }

  var pendingReload = false;

  // Rebuild the overlay for a newly-started track. Triggered by the bridge's
  // videoId changing under a live overlay — this covers auto-advance at the end
  // of a song, which the DOM MutationObserver can miss. Waits for the player bar
  // to actually reflect the new title before fetching, so we don't request the
  // old title against the new videoId (which the cache would then make sticky).
  function handleBridgeSongChange() {
    if (pendingReload) return;
    pendingReload = true;
    var prevTitle = lastSongTitle;
    stopSync();
    removeOverlay();
    removeLoadingOverlay();
    closedByUser = false;
    lyricsTabClicked = false;
    activeIndex = -1;
    userOffset = 0;
    fetchId++;
    showLoadingOverlay();
    var tries = 0;
    function waitForNewSong() {
      if (closedByUser || overlay) { pendingReload = false; return; }
      var s = getSongInfo();
      var v = getVideo();
      var durReady = v && v.duration > 0 && !isNaN(v.duration);
      var titleFresh = s.title && s.title !== prevTitle;
      if (titleFresh && durReady) {
        lastSongTitle = s.title;
        pendingReload = false;
        tryShowLyrics();
      } else if (tries >= 20) {
        // Player bar never refreshed the title — don't fetch/cache lyrics under
        // the NEW videoId using the OLD title (that poisons the cache). Bail to
        // the no-lyrics state; the next real song-change will retry cleanly.
        lastSongTitle = prevTitle;
        pendingReload = false;
        showNoLyrics();
      } else {
        tries++;
        setTimeout(waitForNewSong, 150);
      }
    }
    waitForNewSong();
  }

  var lastSyncLog = 0;
  var SYNC_LOOKAHEAD = 0.05;
  var FALLBACK_LOOKAHEAD = 0.10;
  var lastSearchHint = 0;
  function processSync(t) {
    if (!overlay || userSeeking) return;
    var correctedTime = t + userOffset;
    var video = getVideo();
    if (debugVisible && t - lastSyncLog >= 3) {
      lastSyncLog = t;
      var nextTime = "none";
      if (useTimedSync && activeIndex >= 0 && activeIndex + 1 < timedData.length) nextTime = timedData[activeIndex + 1].time.toFixed(2);
      console.log("[AML] heartbeat: t=" + correctedTime.toFixed(2) + " active=" + activeIndex + " next@" + nextTime + " lines=" + timedData.length);
    }

    var targetLine = -1;

    if (useTimedSync && timedData.length > 0) {
      var threshold = correctedTime + SYNC_LOOKAHEAD;
      // Incremental forward scan — most frames advance by 0-1 lines.
      var hint = lastSearchHint;
      if (hint < 0 || hint >= timedData.length) hint = 0;
      // Rewind hint if needed (after seek/song change).
      if (timedData[hint].time > threshold) hint = 0;
      var i = hint;
      while (i < timedData.length && timedData[i].time <= threshold) i++;
      targetLine = i - 1;
      if (targetLine < 0) targetLine = 0;
      lastSearchHint = targetLine;
    } else if (fallbackTimes.length > 0) {
      var fThreshold = correctedTime + FALLBACK_LOOKAHEAD;
      for (var j = 0; j < fallbackTimes.length; j++) {
        if (fallbackTimes[j].time <= fThreshold) targetLine = fallbackTimes[j].lineIndex;
        else break;
      }
      if (targetLine < 0) targetLine = fallbackTimes[0].lineIndex;
    }

    if (targetLine >= 0 && targetLine !== activeIndex) {
      setActive(targetLine, correctedTime);
    }

    // Word highlighting is now CSS-driven (set up in setActive). We only need
    // to mirror the player's play/pause state so CSS can pause animations.
    if (overlay) {
      var shouldPlay = playerPlaying;
      if (!shouldPlay && video && !video.paused) shouldPlay = true;
      var hasPlayingClass = overlay.classList.contains("aml-playing");
      if (shouldPlay && !hasPlayingClass) overlay.classList.add("aml-playing");
      else if (!shouldPlay && hasPlayingClass) overlay.classList.remove("aml-playing");
    }

    if (overlay && video) {
      var progressFill = overlay.querySelector(".aml-toolbar-progress-fill");
      if (progressFill && video.duration && !isNaN(video.duration)) {
        progressFill.style.width = ((t / video.duration) * 100) + "%";
      }
      var elapsedEl = overlay.querySelector(".aml-tb-elapsed");
      if (elapsedEl) elapsedEl.textContent = formatTime(t);
      var durationEl = overlay.querySelector(".aml-tb-duration");
      if (durationEl) durationEl.textContent = formatTime(video.duration);
      var playBtn = overlay.querySelector(".aml-tb-play");
      if (playBtn) setPlayIcon(playBtn, video.paused);
      if (debugVisible) {
        var dbg = overlay.querySelector(".aml-debug");
        if (dbg) {
          dbg.textContent = lyricsSource + " | " + lyricsType + " | offset: " + Math.round(userOffset * 1000) + "ms";
        }
      }
    }
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return "0:00";
    var total = Math.floor(s);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var sec = total % 60;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    if (h > 0) return h + ":" + pad(m) + ":" + pad(sec);
    return m + ":" + pad(sec);
  }

  // [mm:ss.xx] tag for LRC export.
  function lrcTimeTag(sec) {
    if (!(sec >= 0)) sec = 0;
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    var ss = s.toFixed(2);
    if (s < 10) ss = "0" + ss;
    return "[" + (m < 10 ? "0" + m : m) + ":" + ss + "]";
  }

  // Serialize timed lyrics back to LRC (skips interlude markers). Pure/testable.
  function serializeLRC(data) {
    var out = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i].interlude) continue;
      out.push(lrcTimeTag(data[i].time) + (data[i].text || ""));
    }
    return out.join("\n");
  }

  function clickTransportButton(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var btn = document.querySelector(selectors[i]);
      if (btn) {
        btn.click();
        return;
      }
    }
  }

  // The <video> element persists across songs (YTM is an SPA), so play/pause
  // listeners would accumulate on every overlay rebuild. Track and remove them.
  var boundVideoEl = null;
  var boundVideoHandler = null;

  function cleanupVideoEvents() {
    if (boundVideoEl && boundVideoHandler) {
      boundVideoEl.removeEventListener("play", boundVideoHandler);
      boundVideoEl.removeEventListener("pause", boundVideoHandler);
    }
    boundVideoEl = null;
    boundVideoHandler = null;
  }

  // \u2500\u2500 Inline SVG icons (crisp + consistent, vs system emoji glyphs) \u2500\u2500
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICON_PLAY = "M8 5v14l11-7z";
  var ICON_PAUSE = "M6 5h3.5v14H6zM14.5 5H18v14h-3.5z";
  function makeIcon(pathD, stroke) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", pathD);
    if (stroke) {
      svg.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "2");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
    } else {
      p.setAttribute("fill", "currentColor");
    }
    svg.appendChild(p);
    return svg;
  }
  function setIconPath(btn, pathD) {
    var p = btn.querySelector("path");
    if (p) p.setAttribute("d", pathD);
  }
  function setPlayIcon(btn, isPaused) {
    setIconPath(btn, isPaused ? ICON_PLAY : ICON_PAUSE);
  }

  function bindToolbarVideoEvents(playBtn) {
    cleanupVideoEvents();
    var video = getVideo();
    if (!video || !playBtn) return;
    function updatePlayState() {
      setPlayIcon(playBtn, video.paused);
    }
    boundVideoEl = video;
    boundVideoHandler = updatePlayState;
    video.addEventListener("play", updatePlayState);
    video.addEventListener("pause", updatePlayState);
    updatePlayState();
  }

  function seekToLine(lineIndex) {
    userSeeking = true;
    if (seekTimeout) clearTimeout(seekTimeout);

    var seekTime = -1;
    if (useTimedSync && timedData.length > 0 && lineIndex < timedData.length) {
      seekTime = timedData[lineIndex].time;
    } else if (fallbackTimes.length > 0) {
      for (var j = 0; j < fallbackTimes.length; j++) {
        if (fallbackTimes[j].lineIndex === lineIndex) {
          seekTime = fallbackTimes[j].time;
          break;
        }
      }
    }

    if (seekTime >= 0) {
      window.postMessage({ type: "aml-seek-to", time: seekTime }, location.origin);
    }

    activeIndex = -1;
    lastSearchHint = 0;
    seekTimeout = setTimeout(function () { userSeeking = false; }, 150);
  }

  // Seek to an absolute time (used by the scrubbable progress bar).
  function seekToTime(seconds) {
    if (!(seconds >= 0)) return;
    userSeeking = true;
    if (seekTimeout) clearTimeout(seekTimeout);
    window.postMessage({ type: "aml-seek-to", time: seconds }, location.origin);
    activeIndex = -1;
    lastSearchHint = 0;
    seekTimeout = setTimeout(function () { userSeeking = false; }, 150);
  }

  // ── Font scaling ──────────────────────────────────────────────────────────
  var FONT_SCALE_MIN = 0.7;
  var FONT_SCALE_MAX = 1.6;
  var FONT_SCALE_STEP = 0.1;

  function loadFontScale() {
    try {
      var s = parseFloat(localStorage.getItem("aml_font_scale"));
      if (!isNaN(s) && s >= FONT_SCALE_MIN && s <= FONT_SCALE_MAX) return s;
    } catch (e) { }
    return 1;
  }

  function setFontScale(next) {
    fontScale = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, Math.round(next * 100) / 100));
    try { localStorage.setItem("aml_font_scale", String(fontScale)); } catch (e) { }
    if (!overlay) return;
    overlay.style.setProperty("--aml-font-scale", String(fontScale));
    var disp = overlay.querySelector(".aml-font-display");
    if (disp) disp.textContent = Math.round(fontScale * 100) + "%";
    // Line heights changed — re-cache offsets and re-anchor the active line.
    cacheLinePositions();
    var keep = activeIndex;
    if (keep >= 0) { activeIndex = -1; setActive(keep); }
  }

  function bumpFontScale(delta) { setFontScale(fontScale + delta); }

  // ── Copy lyrics to clipboard ────────────────────────────────────────────────
  // The lyric text of a line, excluding the romanization sub-line (.aml-roman).
  function lineLyricText(el) {
    var s = "";
    for (var n = 0; n < el.childNodes.length; n++) {
      var ch = el.childNodes[n];
      if (ch.nodeType === 1 && ch.className && ("" + ch.className).indexOf("aml-roman") !== -1) continue;
      s += ch.textContent !== undefined ? ch.textContent : (ch.nodeValue || "");
    }
    return s.trim();
  }

  function copyLyricsToClipboard() {
    if (!overlay) return;
    var lineEls = overlay.querySelectorAll(".aml-line:not(.aml-interlude):not(.aml-empty)");
    var parts = [];
    for (var i = 0; i < lineEls.length; i++) {
      var tx = lineLyricText(lineEls[i]);
      if (tx) parts.push(tx);
    }
    if (!parts.length) return;
    var text = parts.join("\n");
    var btn = overlay.querySelector(".aml-tb-copy");
    // Feedback via the class only — don't touch the button's contents (it holds
    // an inline SVG icon that textContent would destroy).
    function flash(ok) {
      if (!btn) return;
      btn.classList.add("aml-copied");
      setTimeout(function () {
        if (!btn) return;
        btn.classList.remove("aml-copied");
      }, 1400);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash(true); }, function () { fallbackCopy(text, flash); });
      } else {
        fallbackCopy(text, flash);
      }
    } catch (e) { fallbackCopy(text, flash); }
  }

  function fallbackCopy(text, flash) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      flash(ok);
    } catch (e) { flash(false); }
  }

  // Download the current synced lyrics as an .lrc file (only when timed).
  function exportLRC() {
    if (!overlay) return;
    if (!useTimedSync || !timedData || timedData.length < 2) { showToast("싱크 가사 없음 — 내보내기 불가"); return; }
    try {
      var lrc = serializeLRC(timedData);
      if (!lrc) { showToast("내보낼 가사 없음"); return; }
      var song = getSongInfo();
      var name = ((song.artist ? song.artist + " - " : "") + (song.title || "lyrics"))
        .replace(/[\/\\:*?"<>|]/g, "_").slice(0, 120) + ".lrc";
      var blob = new Blob([lrc], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { } }, 2000);
      showToast("LRC 내보냄");
    } catch (e) { showToast("내보내기 실패"); }
  }

  function setActive(index, correctedTime) {
    if (!overlay || !cachedLines) return;
    var lines = cachedLines;
    if (index < 0 || index >= lines.length) return;
    if (index === activeIndex) return;

    if (correctedTime === undefined || correctedTime === null) {
      var base = lastVisibleTime > 0 ? lastVisibleTime : playerTime;
      correctedTime = base + userOffset;
    }

    var prev = activeIndex;
    activeIndex = index;

    function setProximityClass(el, diff) {
      el.classList.remove(
        "aml-active",
        "aml-above-1", "aml-above-2", "aml-above-3", "aml-above-far",
        "aml-below-1", "aml-below-2", "aml-below-far"
      );
      if (diff === 0)       el.classList.add("aml-active");
      else if (diff === -1) el.classList.add("aml-above-1");
      else if (diff === -2) el.classList.add("aml-above-2");
      else if (diff === -3) el.classList.add("aml-above-3");
      else if (diff < -3)   el.classList.add("aml-above-far");
      else if (diff === 1)  el.classList.add("aml-below-1");
      else if (diff === 2)  el.classList.add("aml-below-2");
      else if (diff > 2)    el.classList.add("aml-below-far");
      // Screen readers announce the current line as it changes.
      if (diff === 0) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    }

    if (useWordSync && prev >= 0 && prev < lines.length) {
      var prevWords = lines[prev].querySelectorAll(".aml-word");
      for (var pw = 0; pw < prevWords.length; pw++) {
        prevWords[pw].classList.remove("aml-word-animating");
        prevWords[pw].style.removeProperty("--aml-word-dur");
        prevWords[pw].style.removeProperty("--aml-word-anim-delay");
      }
    }

    var minAffected = Math.max(0, Math.min(prev, index) - 4);
    var maxAffected = Math.min(lines.length - 1, Math.max(prev, index) + 3);
    for (var i = minAffected; i <= maxAffected; i++) {
      setProximityClass(lines[i], i - index);
    }

    // CSS-driven word sync: set per-word duration + negative animation-delay so
    // each word's keyframe is scrubbed forward to where the song actually is.
    // No per-frame JS work — CSS handles the rest on the compositor.
    if (useWordSync && index >= 0 && index < lines.length) {
      var newWords = lines[index].querySelectorAll(".aml-word");
      if (newWords.length > 0) {
        // Two-pass to guarantee animation restart on repeat (chorus): clear,
        // single forced reflow, set vars + class. Avoids the "same class re-added
        // doesn't restart animation" CSS quirk.
        for (var cw = 0; cw < newWords.length; cw++) {
          newWords[cw].classList.remove("aml-word-animating");
        }
        // Force a single reflow on the line so the animation restarts cleanly.
        void lines[index].offsetHeight;
        for (var nw = 0; nw < newWords.length; nw++) {
          var startMs = parseInt(newWords[nw].dataset.startMs, 10);
          var endMs = parseInt(newWords[nw].dataset.endMs, 10);
          var durSec = (endMs > startMs) ? (endMs - startMs) / 1000 : 0.4;
          if (durSec < 0.12) durSec = 0.12;
          var deltaSec = correctedTime - startMs / 1000;
          newWords[nw].style.setProperty("--aml-word-dur", durSec + "s");
          newWords[nw].style.setProperty("--aml-word-anim-delay", (-deltaSec) + "s");
          newWords[nw].classList.add("aml-word-animating");
        }
      }
    }

    if (!overlay) return;
    var wrapper = overlay.querySelector(".aml-lines-wrapper");
    if (wrapper && cachedLineOffsets && cachedLineOffsets[index] !== undefined) {
      var scrollTarget = cachedLineOffsets[index] - cachedContentHeight * 0.33;
      wrapper.style.transform = "translateY(" + (-scrollTarget) + "px)";
    }
  }

  function cacheLinePositions() {
    if (!overlay) return;
    var content = overlay.querySelector(".aml-content");
    if (!content) return;
    cachedLines = content.querySelectorAll(".aml-line");
    cachedLineOffsets = [];
    for (var i = 0; i < cachedLines.length; i++) {
      cachedLineOffsets.push(cachedLines[i].offsetTop);
    }
    cachedContentHeight = content.clientHeight;
  }

  function buildOverlay(displayLines, timedEntries) {
    removeOverlay();
    removeLoadingOverlay();
    stopSync();

    var artUrl = getAlbumArtUrl();
    var song = getSongInfo();

    overlay = document.createElement("div");
    overlay.className = "aml-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Synced lyrics");
    if (romanizeOn) overlay.classList.add("aml-show-roman");
    applyAccentColor(overlay, artUrl);
    fontScale = loadFontScale();
    overlay.style.setProperty("--aml-font-scale", String(fontScale));

    var bgTint = document.createElement("div");
    bgTint.className = "aml-bg-tint";
    if (artUrl) bgTint.style.backgroundImage = cssUrl(artUrl);
    overlay.appendChild(bgTint);

    // Slow-drifting multi-color gradient mesh derived from the album palette.
    var mesh = document.createElement("div");
    mesh.className = "aml-mesh";
    overlay.appendChild(mesh);

    var left = document.createElement("div");
    left.className = "aml-left";
    if (artUrl) {
      var art = document.createElement("img");
      art.className = "aml-album-art";
      art.src = artUrl;
      left.appendChild(art);
    }
    var tEl = document.createElement("div");
    tEl.className = "aml-song-title";
    tEl.textContent = song.title;
    left.appendChild(tEl);
    // Romanized title (shown with the lyrics romanization, when the title is Korean).
    if (hasHangul(song.title)) {
      var trEl = document.createElement("div");
      trEl.className = "aml-roman aml-roman-title";
      trEl.textContent = romanizeHangul(song.title);
      left.appendChild(trEl);
    }
    var aEl = document.createElement("div");
    aEl.className = "aml-song-artist";
    aEl.textContent = song.rawArtist || song.artist;
    left.appendChild(aEl);
    overlay.appendChild(left);

    var content = document.createElement("div");
    content.className = "aml-content";

    var wrapper = document.createElement("div");
    wrapper.className = "aml-lines-wrapper";

    var topSp = document.createElement("div");
    topSp.className = "aml-spacer";
    wrapper.appendChild(topSp);

    for (var i = 0; i < displayLines.length; i++) {
      (function (idx) {
        var div = document.createElement("div");
        div.className = "aml-line";
        div.dataset.index = String(idx);
        div.style.setProperty("--aml-d", (idx * 0.035) + "s");
        var lineText = displayLines[idx];
        var isInterlude = timedEntries && timedEntries[idx] && timedEntries[idx].interlude;
        if (isInterlude) {
          div.classList.add("aml-interlude");
        } else if (lineText === "") {
          div.classList.add("aml-empty");
        } else if (useWordSync && wordData.length > 0) {
          var sylEntry = null;
          for (var wi = 0; wi < wordData.length; wi++) {
            if (wordData[wi].lineIndex === idx) { sylEntry = wordData[wi]; break; }
          }
          if (sylEntry && sylEntry.syllables.length > 0) {
            for (var si = 0; si < sylEntry.syllables.length; si++) {
              var span = document.createElement("span");
              span.className = "aml-word";
              span.dataset.startMs = String(sylEntry.syllables[si].startMs);
              span.dataset.endMs = String(sylEntry.syllables[si].endMs);
              span.textContent = sylEntry.syllables[si].text;
              div.appendChild(span);
            }
          } else {
            div.textContent = lineText;
          }
        } else {
          div.textContent = lineText;
        }
        // Romanization sub-line for Korean lyrics (hidden unless the overlay has
        // .aml-show-roman; toggled with "R"). Appended AFTER the lyric content so
        // the textContent assignments above don't wipe it.
        if (!isInterlude && lineText && hasHangul(lineText)) {
          var rom = document.createElement("div");
          rom.className = "aml-roman";
          rom.textContent = romanizeHangul(lineText);
          div.appendChild(rom);
        }
        div.addEventListener("click", function () {
          setActive(idx);
          seekToLine(idx);
        });
        wrapper.appendChild(div);
      })(i);
    }

    var btmSp = document.createElement("div");
    btmSp.className = "aml-spacer";
    wrapper.appendChild(btmSp);
    content.appendChild(wrapper);
    overlay.appendChild(content);

    var closeBtn = document.createElement("button");
    closeBtn.className = "aml-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.setAttribute("aria-label", "Close lyrics");
    closeBtn.addEventListener("click", function () {
      closedByUser = true;
      hideOverlay();
    });
    overlay.appendChild(closeBtn);

    var offsetWrap = document.createElement("div");
    offsetWrap.className = "aml-offset-controls";
    offsetWrap.title = "Sync offset: [ earlier, ] later, \\ reset · Text size: − / +";
    var offsetMinus = document.createElement("button");
    offsetMinus.className = "aml-offset-btn";
    offsetMinus.textContent = "-0.1s";
    offsetMinus.title = "Lyrics earlier ([)";
    var offsetDisplay = document.createElement("span");
    offsetDisplay.className = "aml-offset-display";
    var offsetPlus = document.createElement("button");
    offsetPlus.className = "aml-offset-btn";
    offsetPlus.textContent = "+0.1s";
    offsetPlus.title = "Lyrics later (])";
    function updateOffsetLabel() {
      var ms = Math.round(userOffset * 1000);
      offsetDisplay.textContent = (ms >= 0 ? "+" : "") + ms + "ms";
    }
    offsetMinus.addEventListener("click", function () {
      userOffset -= 0.1;
      saveSongOffset(currentVideoId, userOffset);
      updateOffsetLabel();
    });
    offsetPlus.addEventListener("click", function () {
      userOffset += 0.1;
      saveSongOffset(currentVideoId, userOffset);
      updateOffsetLabel();
    });
    offsetWrap.appendChild(offsetMinus);
    offsetWrap.appendChild(offsetDisplay);
    offsetWrap.appendChild(offsetPlus);

    var ctrlSep = document.createElement("span");
    ctrlSep.className = "aml-ctrl-sep";
    var fontMinus = document.createElement("button");
    fontMinus.className = "aml-offset-btn";
    fontMinus.textContent = "A−";
    fontMinus.title = "Smaller text (−)";
    fontMinus.setAttribute("aria-label", "Decrease text size");
    var fontDisplay = document.createElement("span");
    fontDisplay.className = "aml-offset-display aml-font-display";
    fontDisplay.textContent = Math.round(fontScale * 100) + "%";
    var fontPlus = document.createElement("button");
    fontPlus.className = "aml-offset-btn";
    fontPlus.textContent = "A+";
    fontPlus.title = "Larger text (+)";
    fontPlus.setAttribute("aria-label", "Increase text size");
    fontMinus.addEventListener("click", function () { bumpFontScale(-FONT_SCALE_STEP); });
    fontPlus.addEventListener("click", function () { bumpFontScale(FONT_SCALE_STEP); });
    offsetWrap.appendChild(ctrlSep);
    offsetWrap.appendChild(fontMinus);
    offsetWrap.appendChild(fontDisplay);
    offsetWrap.appendChild(fontPlus);

    overlay.appendChild(offsetWrap);
    updateOffsetLabel();

    // Keyboard-shortcut hint — shown only for the first several opens, then it
    // stops appearing once the user has had a chance to learn the controls.
    var hintSeen = 0;
    try { hintSeen = parseInt(localStorage.getItem("aml_hint_seen") || "0", 10) || 0; } catch (e) { }
    if (hintSeen < 6) {
      var hint = document.createElement("div");
      hint.className = "aml-hint";
      var hintParts = [["Esc", " close"], ["[ ]", " sync"], ["C", " copy"], ["− +", " size"], ["V", " bg"], ["R", " roman"]];
      for (var hp = 0; hp < hintParts.length; hp++) {
        if (hp > 0) hint.appendChild(document.createTextNode("   ·   "));
        var kb = document.createElement("kbd");
        kb.textContent = hintParts[hp][0];
        hint.appendChild(kb);
        hint.appendChild(document.createTextNode(hintParts[hp][1]));
      }
      overlay.appendChild(hint);
      try { localStorage.setItem("aml_hint_seen", String(hintSeen + 1)); } catch (e) { }
    }

    var debugEl = document.createElement("div");
    debugEl.className = "aml-debug";
    debugEl.style.display = debugVisible ? "block" : "none";
    debugEl.textContent = lyricsSource + " | " + lyricsType;
    overlay.appendChild(debugEl);

    var toolbar = document.createElement("div");
    toolbar.className = "aml-toolbar";

    var toolbarInner = document.createElement("div");
    toolbarInner.className = "aml-toolbar-inner";

    // Left: transport controls (SVG icons; play is a filled circular button).
    var toolbarControls = document.createElement("div");
    toolbarControls.className = "aml-toolbar-controls";
    var prevBtn = document.createElement("button");
    prevBtn.className = "aml-tb-btn aml-tb-prev";
    prevBtn.setAttribute("aria-label", "Previous track");
    prevBtn.appendChild(makeIcon("M7 6h2v12H7zm3 6l9 6V6z"));
    var playBtn = document.createElement("button");
    playBtn.className = "aml-tb-btn aml-tb-play";
    playBtn.setAttribute("aria-label", "Play or pause");
    playBtn.appendChild(makeIcon(ICON_PLAY));
    var nextBtn = document.createElement("button");
    nextBtn.className = "aml-tb-btn aml-tb-next";
    nextBtn.setAttribute("aria-label", "Next track");
    nextBtn.appendChild(makeIcon("M15 6h2v12h-2zM5 6v12l9-6z"));
    toolbarControls.appendChild(prevBtn);
    toolbarControls.appendChild(playBtn);
    toolbarControls.appendChild(nextBtn);

    // Center: real scrubber with elapsed / duration time labels flanking it.
    var toolbarScrub = document.createElement("div");
    toolbarScrub.className = "aml-toolbar-scrub";
    var elapsedEl = document.createElement("span");
    elapsedEl.className = "aml-tb-time aml-tb-elapsed";
    elapsedEl.textContent = "0:00";
    var toolbarProgress = document.createElement("div");
    toolbarProgress.className = "aml-toolbar-progress";
    var toolbarProgressFill = document.createElement("div");
    toolbarProgressFill.className = "aml-toolbar-progress-fill";
    toolbarProgress.appendChild(toolbarProgressFill);
    var durationEl = document.createElement("span");
    durationEl.className = "aml-tb-time aml-tb-duration";
    durationEl.textContent = "0:00";
    toolbarScrub.appendChild(elapsedEl);
    toolbarScrub.appendChild(toolbarProgress);
    toolbarScrub.appendChild(durationEl);

    // Right: copy + export lyrics.
    var toolbarRight = document.createElement("div");
    toolbarRight.className = "aml-toolbar-right";
    var copyBtn = document.createElement("button");
    copyBtn.className = "aml-tb-btn aml-tb-copy";
    copyBtn.appendChild(makeIcon("M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4M4 10h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", true));
    copyBtn.setAttribute("aria-label", "Copy lyrics");
    copyBtn.title = "Copy lyrics (C)";
    copyBtn.addEventListener("click", copyLyricsToClipboard);
    var exportBtn = document.createElement("button");
    exportBtn.className = "aml-tb-btn aml-tb-export";
    exportBtn.appendChild(makeIcon("M12 3v12m0 0l-4-4m4 4l4-4M5 21h14", true));
    exportBtn.setAttribute("aria-label", "Export .lrc");
    exportBtn.title = "Export .lrc (E)";
    exportBtn.addEventListener("click", exportLRC);
    toolbarRight.appendChild(copyBtn);
    toolbarRight.appendChild(exportBtn);

    toolbarInner.appendChild(toolbarControls);
    toolbarInner.appendChild(toolbarScrub);
    toolbarInner.appendChild(toolbarRight);
    toolbar.appendChild(toolbarInner);
    overlay.appendChild(toolbar);

    prevBtn.addEventListener("click", function () {
      clickTransportButton([
        ".previous-button",
        "tp-yt-paper-icon-button.previous-button",
        ".navigation-button.previous",
        '[aria-label="Previous"]'
      ]);
    });
    nextBtn.addEventListener("click", function () {
      clickTransportButton([
        ".next-button",
        "tp-yt-paper-icon-button.next-button",
        ".navigation-button.next",
        '[aria-label="Next"]'
      ]);
    });
    playBtn.addEventListener("click", function () {
      var video = getVideo();
      if (!video) return;
      if (video.paused) video.play();
      else video.pause();
    });

    // Scrubbable progress bar — click or drag to seek. While dragging we set
    // userSeeking so processSync stops overwriting the fill, then commit the
    // actual seek on release (avoids spamming seekTo on every pointermove).
    var progressDragging = false;
    function progressFraction(e) {
      var rect = toolbarProgress.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function progressPreview(e) {
      var f = progressFraction(e);
      toolbarProgressFill.style.width = (f * 100) + "%";
      return f;
    }
    toolbarProgress.addEventListener("pointerdown", function (e) {
      var video = getVideo();
      if (!video || !video.duration || isNaN(video.duration)) return;
      progressDragging = true;
      userSeeking = true;
      try { toolbarProgress.setPointerCapture(e.pointerId); } catch (err) { }
      progressPreview(e);
      e.preventDefault();
    });
    toolbarProgress.addEventListener("pointermove", function (e) {
      if (progressDragging) progressPreview(e);
    });
    function endProgressDrag(e) {
      if (!progressDragging) return;
      progressDragging = false;
      var video = getVideo();
      var f = progressPreview(e);
      if (video && video.duration && !isNaN(video.duration)) seekToTime(f * video.duration);
      else userSeeking = false;
    }
    toolbarProgress.addEventListener("pointerup", endProgressDrag);
    toolbarProgress.addEventListener("pointercancel", function () {
      progressDragging = false; userSeeking = false;
    });

    bindToolbarVideoEvents(playBtn);

    document.body.appendChild(overlay);
    activeIndex = -1;
    cacheLinePositions();

    var initTarget = 0;
    var initPlayerTime = playerTime;
    if (!(initPlayerTime > 0)) {
      var initVid = getVideo();
      if (initVid && initVid.currentTime > 0) initPlayerTime = initVid.currentTime;
    }
    if (useTimedSync && timedData.length > 0 && initPlayerTime > 0) {
      var initTime = initPlayerTime + userOffset;
      for (var k = 0; k < timedData.length; k++) {
        if (timedData[k].time <= initTime + 0.15) initTarget = k;
        else break;
      }
    }
    setActive(initTarget);
    startSync();
    startAudioReactive();

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (overlay) overlay.classList.add("aml-visible");
      });
    });
  }

  function showNoLyrics() {
    removeOverlay();
    removeLoadingOverlay();
    var artUrl = getAlbumArtUrl();
    var song = getSongInfo();
    overlay = document.createElement("div");
    overlay.className = "aml-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Lyrics");
    applyAccentColor(overlay, artUrl);
    var bgTint = document.createElement("div");
    bgTint.className = "aml-bg-tint";
    if (artUrl) bgTint.style.backgroundImage = cssUrl(artUrl);
    overlay.appendChild(bgTint);
    var left = document.createElement("div");
    left.className = "aml-left";
    if (artUrl) { var a = document.createElement("img"); a.className = "aml-album-art"; a.src = artUrl; a.alt = ""; left.appendChild(a); }
    var t = document.createElement("div"); t.className = "aml-song-title"; t.textContent = song.title; left.appendChild(t);
    var ar = document.createElement("div"); ar.className = "aml-song-artist"; ar.textContent = song.rawArtist || song.artist; left.appendChild(ar);
    overlay.appendChild(left);
    var msg = document.createElement("div"); msg.className = "aml-no-lyrics";
    var msgIcon = makeIcon("M5 8h14M5 12h10M5 16h6", true);
    msgIcon.setAttribute("class", "aml-no-lyrics-icon");
    msg.appendChild(msgIcon);
    var msgText = document.createElement("div"); msgText.className = "aml-no-lyrics-text";
    msgText.textContent = "No lyrics available";
    msg.appendChild(msgText);
    overlay.appendChild(msg);
    var cb = document.createElement("button"); cb.className = "aml-close"; cb.textContent = "\u00d7";
    cb.setAttribute("aria-label", "Close lyrics");
    cb.addEventListener("click", function () { closedByUser = true; hideOverlay(); });
    overlay.appendChild(cb);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (overlay) overlay.classList.add("aml-visible"); }); });
  }

  function hideOverlay() {
    stopSync();
    stopAudioReactive();
    cleanupVideoEvents();
    if (!overlay) return;
    overlay.classList.remove("aml-visible");
    // Remove any element still fading out from a previous hide, then defer this
    // one for the CSS fade. Tracking it means a song-change mid-fade (which nulls
    // `overlay`) can't strand a zombie .aml-overlay in the DOM.
    if (fadingOverlay && fadingOverlay.parentNode) fadingOverlay.remove();
    fadingOverlay = overlay;
    var el = overlay;
    setTimeout(function () { if (el && el.parentNode) el.remove(); if (fadingOverlay === el) fadingOverlay = null; }, 500);
    overlay = null;
  }

  function removeOverlay() {
    stopSync();
    stopAudioReactive();
    cleanupVideoEvents();
    cachedLineOffsets = null;
    cachedContentHeight = 0;
    cachedLines = null;
    if (fadingOverlay && fadingOverlay.parentNode) { fadingOverlay.remove(); fadingOverlay = null; }
    if (overlay) { overlay.remove(); overlay = null; }
  }

  // Loading screen — shown immediately when the user opens lyrics so the wait
  // for the fetch chain isn't a blank, unresponsive screen. It's a separate
  // element from `overlay` so it doesn't trip the "already showing" guards;
  // buildOverlay()/showNoLyrics() dismiss it (crossfade) once lyrics resolve.
  function showLoadingOverlay() {
    if (loadingEl || overlay || closedByUser || !enabled) return;
    var artUrl = getAlbumArtUrl();
    var song = getSongInfo();

    loadingEl = document.createElement("div");
    loadingEl.className = "aml-overlay aml-loading";
    loadingEl.setAttribute("role", "dialog");
    loadingEl.setAttribute("aria-label", "Loading lyrics");
    applyAccentColor(loadingEl, artUrl);

    var bgTint = document.createElement("div");
    bgTint.className = "aml-bg-tint";
    if (artUrl) bgTint.style.backgroundImage = cssUrl(artUrl);
    loadingEl.appendChild(bgTint);

    var lmesh = document.createElement("div");
    lmesh.className = "aml-mesh";
    loadingEl.appendChild(lmesh);

    var center = document.createElement("div");
    center.className = "aml-loading-center";
    if (artUrl) {
      var art = document.createElement("img");
      art.className = "aml-loading-art";
      art.src = artUrl;
      center.appendChild(art);
    }
    var spinner = document.createElement("div");
    spinner.className = "aml-loading-spinner";
    center.appendChild(spinner);
    var label = document.createElement("div");
    label.className = "aml-loading-label";
    label.textContent = song.title || "Loading";
    center.appendChild(label);
    var sub = document.createElement("div");
    sub.className = "aml-loading-sub";
    sub.textContent = "Finding lyrics…";
    center.appendChild(sub);
    loadingEl.appendChild(center);

    var closeBtn = document.createElement("button");
    closeBtn.className = "aml-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Cancel");
    closeBtn.addEventListener("click", function () {
      closedByUser = true; fetchId++; removeLoadingOverlay();
    });
    loadingEl.appendChild(closeBtn);

    document.body.appendChild(loadingEl);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (loadingEl) loadingEl.classList.add("aml-visible"); });
    });
  }

  function removeLoadingOverlay() {
    if (!loadingEl) return;
    var el = loadingEl;
    loadingEl = null;
    el.classList.remove("aml-visible");
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 400);
  }

  var INTERLUDE_GAP = 10;
  var INTERLUDE_MARKER = "\u266a";

  function insertInterludes(parsed) {
    var result = [];
    for (var i = 0; i < parsed.length; i++) {
      if (i > 0) {
        var gap = parsed[i].time - parsed[i - 1].time;
        if (gap >= INTERLUDE_GAP && parsed[i - 1].text !== "") {
          var midTime = parsed[i - 1].time + (gap * 0.3);
          result.push({ time: midTime, text: INTERLUDE_MARKER, interlude: true });
        }
      }
      var entry = { time: parsed[i].time, text: parsed[i].text, interlude: false };
      if (parsed[i].words) entry.words = parsed[i].words;
      result.push(entry);
    }
    if (parsed.length > 0 && parsed[0].time >= INTERLUDE_GAP) {
      result.unshift({ time: parsed[0].time * 0.3, text: INTERLUDE_MARKER, interlude: true });
    }
    return result;
  }

  // Remap each wordData entry's lineIndex from the original parsed-array index
  // space into its position within the interlude-expanded array. The k-th
  // non-interlude entry in withInterludes is original line k, so we build a
  // direct origIndex -> newIndex map. (A naive "count interludes where
  // withInterludesIndex <= lineIndex" loop undercounts once 2+ interludes
  // precede a line, mis-aligning word highlighting.)
  function remapWordDataIndices(wordData, withInterludes) {
    var origToNew = [];
    var origCount = 0;
    for (var k = 0; k < withInterludes.length; k++) {
      if (!withInterludes[k].interlude) { origToNew[origCount] = k; origCount++; }
    }
    for (var adj = 0; adj < wordData.length; adj++) {
      var mapped = origToNew[wordData[adj].lineIndex];
      if (mapped !== undefined) wordData[adj].lineIndex = mapped;
    }
  }

  function showWithSyncedLyrics(parsed) {
    useTimedSync = true;
    currentVideoId = getVideoId();
    userOffset = loadSongOffset(currentVideoId);

    var hasWords = false;
    wordData = [];
    for (var w = 0; w < parsed.length; w++) {
      if (parsed[w].words && parsed[w].words.length > 0) {
        hasWords = true;
        wordData.push({ lineIndex: w, syllables: parsed[w].words });
      }
    }
    useWordSync = hasWords;

    var withInterludes = insertInterludes(parsed);
    timedData = withInterludes;

    if (useWordSync) remapWordDataIndices(wordData, withInterludes);

    nonEmptyIndices = [];
    var lines = [];
    for (var i = 0; i < withInterludes.length; i++) {
      lines.push(withInterludes[i].text);
    }
    buildOverlay(lines, withInterludes);
  }

  function showWithPlainLyrics(text) {
    useTimedSync = false;
    useWordSync = false;
    wordData = [];
    lyricsSource = "ytm"; lyricsType = "plain";
    currentVideoId = getVideoId();
    userOffset = loadSongOffset(currentVideoId);
    timedData = [];
    var lines = text.split("\n").map(function (l) { return l.trim(); });
    nonEmptyIndices = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] !== "") nonEmptyIndices.push(i);
    }
    if (nonEmptyIndices.length < 2) { showNoLyrics(); return; }

    var video = getVideo();
    var dur = video ? video.duration : 0;
    fallbackTimes = [];
    if (dur > 0 && !isNaN(dur)) {
      var introRatio = 0.05;
      var outroRatio = 0.03;
      var usable = dur * (1 - introRatio - outroRatio);
      var start = dur * introRatio;
      var totalWeight = 0;
      var weights = [];
      for (var w = 0; w < nonEmptyIndices.length; w++) {
        var charLen = lines[nonEmptyIndices[w]].length;
        var weight = Math.max(charLen, 4);
        weights.push(weight);
        totalWeight += weight;
      }
      var cumTime = start;
      for (var f = 0; f < nonEmptyIndices.length; f++) {
        fallbackTimes.push({ time: cumTime, lineIndex: nonEmptyIndices[f] });
        cumTime += (weights[f] / totalWeight) * usable;
      }
    }
    buildOverlay(lines, null);
  }

  // ── Resolved-lyrics cache (per videoId) ──────────────────────────────────
  // Avoids re-running the multi-source fetch chain when returning to a song.
  // Only successful results are cached; "no lyrics" is left uncached so a
  // transient API failure can be retried on the next play.
  var lyricsCache = {};
  var lyricsCacheOrder = [];
  var LYRICS_CACHE_MAX = 50;

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function cacheTouch(videoId) {
    var pos = lyricsCacheOrder.indexOf(videoId);
    if (pos !== -1) lyricsCacheOrder.splice(pos, 1);
    lyricsCacheOrder.push(videoId);
  }

  function cacheLyrics(videoId, entry) {
    if (!videoId || !entry) return;
    cacheTouch(videoId);
    lyricsCache[videoId] = entry;
    while (lyricsCacheOrder.length > LYRICS_CACHE_MAX) {
      delete lyricsCache[lyricsCacheOrder.shift()];
    }
  }

  function renderLyricsResult(entry) {
    if (overlay) removeOverlay();
    lyricsSource = entry.source || ""; lyricsType = entry.type || "";
    if (entry.kind === "synced") showWithSyncedLyrics(entry.parsed);
    else if (entry.kind === "plain") showWithPlainLyrics(entry.text);
  }

  // Source chain in priority order. Each entry fetches, then unpacks the raw
  // response into a normalized {kind,source,type,...} result, or null to fall
  // through to the next source.
  var LYRICS_SOURCES = [
    {
      // Binimum (Apple Music TTML) — primary; word-level timing on most tracks.
      fetch: function (song, vid, dur) { return binimumFetchLyrics(song.title, song.artist, dur); },
      unpack: function (r) {
        if (r && r.parsed && r.parsed.length >= 2)
          return { kind: "synced", source: "binimum", type: r.hasWords ? "word" : "line", parsed: r.parsed };
        return null;
      }
    },
    {
      fetch: function (song, vid, dur) { return mxmFetchLyrics(song.title, song.artist, dur); },
      unpack: function (r) {
        if (r && r.length >= 2) return { kind: "synced", source: "musixmatch", type: "line", parsed: r };
        return null;
      }
    },
    {
      fetch: function (song, vid, dur) { return fetchSyncedLyrics(song.title, song.artist, dur); },
      unpack: function (r) {
        if (r && r.length >= 2) return { kind: "synced", source: "lrclib", type: "line", parsed: r };
        return null;
      }
    },
    {
      fetch: function (song, vid, dur) { return cubeyFetchLyrics(song.title, song.artist, dur, vid); },
      unpack: function (data) {
        var result = parseCubeyResponse(data);
        if (result && result.parsed)
          return { kind: "synced", source: result.source, type: result.type, parsed: result.parsed };
        if (result && result.plainText)
          return { kind: "plain", source: result.source, type: "plain", text: result.plainText };
        return null;
      }
    }
  ];

  function tryShowLyrics() {
    if (!isExtensionValid() || !enabled || closedByUser || overlay) return;

    var song = getSongInfo();
    var video = getVideo();
    var duration = video ? video.duration : 0;
    var myFetch = ++fetchId;
    function isStale() { return myFetch !== fetchId || closedByUser; }

    if (!(song.title && duration > 0 && !isNaN(duration))) { showNoLyrics(); return; }

    var vid = getVideoId();
    if (vid && hasOwn(lyricsCache, vid)) {
      cacheTouch(vid);
      renderLyricsResult(lyricsCache[vid]);
      return;
    }

    var i = 0;
    function tryNext() {
      if (isStale()) return;
      if (i >= LYRICS_SOURCES.length) {
        if (!overlay) showNoLyrics();
        return;
      }
      var src = LYRICS_SOURCES[i++];
      Promise.resolve().then(function () { return src.fetch(song, vid, duration); })
        .then(function (raw) {
          if (isStale()) return;
          var entry = null;
          try { entry = src.unpack(raw); } catch (e) { entry = null; }
          if (entry) {
            cacheLyrics(vid, entry);
            renderLyricsResult(entry);
          } else {
            tryNext();
          }
        })
        .catch(function () {
          if (!isStale()) tryNext();
        });
    }
    tryNext();
  }

  function tryPlainLyrics() {
    if (overlay || closedByUser) return;

    var text = getLyricsText();
    if (text && text.length > 10) {
      showWithPlainLyrics(text);
      return;
    }

    if (!lyricsTabClicked) clickLyricsTab();

    if (panelObserver) panelObserver.disconnect();
    panelObserver = new MutationObserver(function () {
      text = getLyricsText();
      if (text && text.length > 10) {
        panelObserver.disconnect();
        panelObserver = null;
        showWithPlainLyrics(text);
      }
    });

    var target = document.querySelector("#tab-renderer") || document.querySelector("ytmusic-player-page") || document.body;
    panelObserver.observe(target, { childList: true, subtree: true, characterData: true });

    setTimeout(function () {
      if (panelObserver) {
        panelObserver.disconnect();
        panelObserver = null;
        if (!overlay) {
          text = getLyricsText();
          if (text && text.length > 10) showWithPlainLyrics(text);
          else showNoLyrics();
        }
      }
    }, 5000);
  }

  function onSongChange() {
    if (!isExtensionValid() || pendingReload) return;
    var song = getSongInfo();
    if (song.title && song.title !== lastSongTitle) {
      var wasShowing = !!overlay || !!loadingEl;
      lastSongTitle = song.title;
      lyricsTabClicked = false;
      closedByUser = false;
      activeIndex = -1;
      userOffset = 0;
      fetchId++;
      removeOverlay();
      removeLoadingOverlay();
      if (wasShowing) tryShowLyricsWithRetry();
    }
  }

  function tryShowLyricsWithRetry() {
    var attempts = 0;
    var maxAttempts = 20;
    var launched = false;
    showLoadingOverlay();
    function attempt() {
      if (overlay || closedByUser || !enabled || launched) return;
      var video = getVideo();
      var song = getSongInfo();
      if (song.title && video && video.duration > 0 && !isNaN(video.duration)) {
        launched = true;
        tryShowLyrics();
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(attempt, 150);
      } else {
        launched = true;
        tryShowLyrics();
      }
    }
    attempt();
  }

  function watchSongChanges() {
    if (songObserver) songObserver.disconnect();
    songObserver = new MutationObserver(onSongChange);
    var bar = document.querySelector("ytmusic-player-bar");
    if (bar) {
      songObserver.observe(bar, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ["title", "src", "alt"],
      });
    }
    var lastUrl = location.href;
    if (urlObserver) urlObserver.disconnect();
    urlObserver = new MutationObserver(function () {
      if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(onSongChange, 100); }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  function findLyricsTab() {
    var tabs = queryLyricsTabs();
    for (var t = 0; t < tabs.length; t++) {
      if (tabMatchesLyrics(tabs[t])) return tabs[t];
    }
    return null;
  }

  function watchLyricsTab() {
    document.addEventListener("click", function (e) {
      var tab = findLyricsTab();
      if (!tab) return;
      if (tab.contains(e.target) || tab === e.target) {
        if (overlay || loadingEl) {
          closedByUser = true;
          fetchId++;
          removeLoadingOverlay();
          if (overlay) hideOverlay();
        } else {
          closedByUser = false;
          var song = getSongInfo();
          lastSongTitle = song.title || "";
          tryShowLyricsWithRetry();
        }
      }
    }, true);
  }

  function init() {
    var song = getSongInfo();
    lastSongTitle = song.title || "";
    watchSongChanges();
    watchLyricsTab();
  }

  function bumpOffset(deltaSec) {
    userOffset += deltaSec;
    saveSongOffset(currentVideoId, userOffset);
    if (!overlay) return;
    var disp = overlay.querySelector(".aml-offset-display");
    if (disp) {
      var ms = Math.round(userOffset * 1000);
      disp.textContent = (ms >= 0 ? "+" : "") + ms + "ms";
    }
    var dbg = overlay.querySelector(".aml-debug");
    if (dbg && debugVisible) {
      dbg.textContent = lyricsSource + " | " + lyricsType + " | offset: " + Math.round(userOffset * 1000) + "ms";
    }
    // Reset so the next sync frame re-activates the line and re-scrubs CSS word animations.
    activeIndex = -1;
    lastSearchHint = 0;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (overlay || loadingEl)) {
      closedByUser = true; fetchId++; removeLoadingOverlay();
      if (overlay) hideOverlay();
      return;
    }
    if (!overlay) return;
    if (e.key === "D" && e.shiftKey) {
      debugVisible = !debugVisible;
      var dbg = overlay.querySelector(".aml-debug");
      if (dbg) dbg.style.display = debugVisible ? "block" : "none";
      return;
    }
    var target = e.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (e.key === "[") { e.preventDefault(); bumpOffset(-0.1); }
    else if (e.key === "]") { e.preventDefault(); bumpOffset(0.1); }
    else if (e.key === "\\") { e.preventDefault(); bumpOffset(-userOffset); }
    else if (e.key === "c" || e.key === "C") { e.preventDefault(); copyLyricsToClipboard(); }
    else if (e.key === "e" || e.key === "E") { e.preventDefault(); exportLRC(); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); bumpFontScale(-FONT_SCALE_STEP); }
    else if (e.key === "=" || e.key === "+") { e.preventDefault(); bumpFontScale(FONT_SCALE_STEP); }
    else if (e.key === "v" || e.key === "V") { e.preventDefault(); toggleAudioReactive(); }
    else if (e.key === "r" || e.key === "R") { e.preventDefault(); toggleRomanize(); }
  });

  function isExtensionValid() {
    try { return !!chrome.runtime && !!chrome.runtime.id; }
    catch (e) { return false; }
  }

  chrome.runtime.onMessage.addListener(function (msg, _s, sendResponse) {
    if (!isExtensionValid()) return;
    if (msg.type === "AML_TOGGLE") {
      enabled = msg.enabled;
      var toggleSave = {}; toggleSave[STATE_KEY] = enabled;
      chrome.storage.local.set(toggleSave);
      if (enabled) { closedByUser = false; tryShowLyrics(); } else { hideOverlay(); }
      sendResponse({ ok: true });
    }
    return true;
  });

  chrome.storage.local.get([STATE_KEY], function (result) {
    enabled = result[STATE_KEY] !== false;
    if (enabled) {
      if (document.readyState === "complete") init();
      else window.addEventListener("load", init);
    }
  });
})();
