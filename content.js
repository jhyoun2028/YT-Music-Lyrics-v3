(function () {
  "use strict";

  var STATE_KEY = "aml_enabled";
  var enabled = true;
  var overlay = null;
  var activeIndex = -1;
  var lastSongTitle = "";
  var lyricsTabClicked = false;
  var songObserver = null;
  var panelObserver = null;
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

  function clickLyricsTab() {
    var sels = [
      "ytmusic-player-page tp-yt-paper-tab",
      "tp-yt-paper-tab.tab-header",
      "#tabsContent tp-yt-paper-tab",
      "tp-yt-paper-tab",
    ];
    var tabs = [];
    for (var c = 0; c < sels.length; c++) {
      tabs = document.querySelectorAll(sels[c]);
      if (tabs.length > 0) break;
    }
    if (tabs.length === 0) return false;
    var kw = ["lyrics", "lyric", "\uac00\uc0ac", "\u6b4c\u8a5e", "letras", "paroles", "testo"];
    for (var t = 0; t < tabs.length; t++) {
      var text = tabs[t].textContent.trim().toLowerCase();
      for (var k = 0; k < kw.length; k++) {
        if (text.indexOf(kw[k]) !== -1) { tabs[t].click(); lyricsTabClicked = true; return true; }
      }
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
      var text = textPart.trim();
      for (var t = 0; t < timestamps.length; t++) {
        result.push({ time: timestamps[t], text: text });
      }
    }
    result.sort(function (a, b) { return a.time - b.time; });
    return result;
  }

  // Binimum — Apple Music's TTML lyrics database (word/syllable timing).
  // Same source Better Lyrics treats as primary. Returns Apple Music TTML
  // (itunes:timing="Word") with absolute <p begin> and <span begin> times.
  var BINIMUM_API = "https://lyrics-api.binimum.org/";

  function binimumFetchLyrics(title, artist, duration) {
    if (!title) return Promise.resolve(null);
    var qs = "?track=" + encodeURIComponent(title) +
             "&artist=" + encodeURIComponent(artist || "");
    if (duration > 0 && !isNaN(duration)) qs += "&duration=" + Math.round(duration);
    var searchUrl = BINIMUM_API + qs;
    return fetch(searchUrl).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      if (!data || !data.results || !data.results.length) return null;
      // Prefer word-level results, then closest duration match.
      var results = data.results.slice();
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
      if (duration > 0 && pick.duration && Math.abs(pick.duration - duration) > MAX_DURATION_DIFF) return null;
      return fetch(pick.lyricsUrl).then(function (r) {
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
      setTimeout(function () { cleanup(); reject(new Error("turnstile timeout")); }, 15000);
    });
  }

  function cubeyGetJWT(forceNew) {
    if (!forceNew) {
      try {
        var stored = localStorage.getItem("aml_cubey_jwt");
        if (stored) {
          var parts = stored.split(".");
          if (parts[1]) {
            var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (payload.exp && Date.now() / 1000 < payload.exp) {
              return Promise.resolve(stored);
            }
          }
        }
      } catch (e) { }
    }

    return cubeyTurnstile().then(function (token) {
      return fetch(CUBEY_API + "verify-turnstile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token }),
        credentials: "include"
      });
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      if (data && data.jwt) {
        localStorage.setItem("aml_cubey_jwt", data.jwt);
        return data.jwt;
      }
      return null;
    }).catch(function () { return null; });
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
        return fetch(url, {
          headers: { "Authorization": "Bearer " + token },
          credentials: "include"
        }).then(function (r) {
          if (debugVisible) console.log("[AML] Cubey response:", r.status);
          if (r.status === 403) {
            return cubeyGetJWT(true).then(function (newJwt) {
              if (!newJwt) return null;
              return fetch(url.replace(token, newJwt), {
                headers: { "Authorization": "Bearer " + newJwt },
                credentials: "include"
              });
            });
          }
          if (!r.ok) {
            return r.text().then(function (body) {
              console.warn("[AML] Cubey API error:", r.status, body);
              return null;
            });
          }
          return r.json();
        });
      }

      return doFetch(jwt);
    }).catch(function (e) { console.warn("[AML] Cubey failed:", e); return null; });
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
      var se = spans[s].getAttribute("end") || spans[s].getAttribute("d");
      var st = (spans[s].textContent || "");
      if (sb && st) {
        // Apple Music TTML separates words with whitespace TEXT NODES between
        // sibling spans. Syllables within a word have no such gap. Detect and
        // preserve the inter-word space so rendering doesn't run words together.
        var trail = "";
        var sib = spans[s].nextSibling;
        if (sib && sib.nodeType === 3 && /^\s/.test(sib.nodeValue || "")) trail = " ";
        var startSec = divOffset + parseTTMLTime(sb);
        var endSec = se ? divOffset + parseTTMLTime(se) : 0;
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

  var MAX_DURATION_DIFF = 10;

  function lrcGet(title, artist, dur) {
    var u = "https://lrclib.net/api/get?track_name=" + encodeURIComponent(title) +
      "&artist_name=" + encodeURIComponent(artist) + "&duration=" + Math.round(dur);
    return fetch(u).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.syncedLyrics) return null;
        if (dur > 0 && d.duration && Math.abs(d.duration - dur) > MAX_DURATION_DIFF) return null;
        return parseLRC(d.syncedLyrics);
      })
      .catch(function () { return null; });
  }

  function lrcSearch(q, duration) {
    return fetch("https://lrclib.net/api/search?q=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (a) {
        if (!a || !a.length) return null;
        var synced = a.filter(function (r) { return r.syncedLyrics; });
        if (!synced.length) return null;

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
        fetch(tokenUrl)
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

      return fetch(url)
        .then(function (r) {
          if (r.status === 401) return { __mxmUnauthorized: true };
          if (!r.ok) {
            console.warn("Musixmatch lyrics request failed", r.status);
            return null;
          }
          return r.json();
        })
        .then(function (data) {
          if (data && data.__mxmUnauthorized) {
            if (!forceTokenRefresh) {
              return mxmFetchForArtist(title, artist, duration, true);
            }
            console.warn("Musixmatch token refresh failed after 401");
            return null;
          }

          var subtitleBody = mxmExtractSubtitleBody(data);
          if (!subtitleBody) return null;

          var parsed = parseLRC(subtitleBody);
          if (parsed && parsed.length >= 2) return parsed;
          return null;
        })
        .catch(function (err) {
          console.warn("Musixmatch lyrics fetch error", err);
          return null;
        });
    });
  }

  function mxmFetchLyrics(title, artist, duration) {
    var artists = getArtistVariations(artist);
    if (!artists.length) artists = [artist || ""];
    var idx = 0;

    function nextArtist() {
      if (idx >= artists.length) return Promise.resolve(null);
      return mxmFetchForArtist(title, artists[idx++], duration, false).then(function (parsed) {
        return parsed || nextArtist();
      });
    }

    return nextArtist();
  }

  function fetchSyncedLyrics(title, artist, duration) {
    var arts = getArtistVariations(artist);
    var gi = 0;
    function nextGet() {
      if (gi >= arts.length) return nextSearch();
      return lrcGet(title, arts[gi++], duration).then(function (r) { return r || nextGet(); });
    }
    var searches = arts.map(function (a) { return title + " " + a; });
    searches.push(title);
    var si = 0;
    function nextSearch() {
      if (si >= searches.length) return Promise.resolve(null);
      return lrcSearch(searches[si++], duration).then(function (r) { return r || nextSearch(); });
    }
    return nextGet();
  }

  function spotifyGetToken(forceRefresh) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          { type: "SPOTIFY_GET_TOKEN", forceRefresh: !!forceRefresh },
          function (resp) {
            if (chrome.runtime.lastError) { resolve(null); return; }
            resolve(resp && resp.token ? resp.token : null);
          }
        );
      } catch (e) { resolve(null); }
    });
  }

  function normalizeTitle(t) {
    return t.replace(/\(feat\..*?\)/gi, "")
            .replace(/\(ft\..*?\)/gi, "")
            .replace(/\(.*?remaster.*?\)/gi, "")
            .replace(/\(.*?remix.*?\)/gi, "")
            .replace(/\(.*?version.*?\)/gi, "")
            .replace(/\(.*?live.*?\)/gi, "")
            .trim();
  }

  function buildSearchQueries(title, artist) {
    var t = title.trim();
    var a = artist.trim();
    var norm = normalizeTitle(t);
    var stripped = t.split("(")[0].trim();
    var dashed = t.split("-")[0].trim();
    var queries = [];
    queries.push("track:" + t + " artist:" + a);
    queries.push(t + " " + a);
    if (norm !== t) queries.push(norm + " " + a);
    if (stripped !== t && stripped !== norm) queries.push(stripped + " " + a);
    if (dashed !== t && dashed !== stripped) queries.push(dashed + " " + a);
    queries.push(t);
    return queries;
  }

  function spotifySearchTrack(title, artist, token) {
    var queries = buildSearchQueries(title, artist);
    var idx = 0;

    function tryNext() {
      if (idx >= queries.length) return Promise.resolve(null);
      var q = queries[idx++];
      var url = "https://api.spotify.com/v1/search?q=" + encodeURIComponent(q) + "&type=track&limit=1";
      return fetch(url, {
        headers: { "Authorization": "Bearer " + token }
      }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (data) {
        var items = data && data.tracks && data.tracks.items;
        if (items && items.length) return items[0].id;
        return tryNext();
      });
    }

    return tryNext().catch(function () { return null; });
  }

  function spotifyFetchColorLyrics(trackId, token) {
    var url = "https://spclient.wg.spotify.com/color-lyrics/v2/track/" + trackId +
      "?format=json&vocalRemoval=false&market=from_token";
    return fetch(url, {
      headers: {
        "Authorization": "Bearer " + token,
        "App-Platform": "WebPlayer"
      }
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }

  function spotifyFetchLyrics(title, artist, duration) {
    return spotifyGetToken(false).then(function (token) {
      if (!token) return null;
      return spotifySearchTrack(title, artist, token).then(function (trackId) {
        if (!trackId) return null;
        return spotifyFetchColorLyrics(trackId, token);
      });
    }).catch(function () { return null; });
  }

  function parseSpotifyLyrics(data) {
    if (!data || !data.lyrics || !data.lyrics.lines) return null;
    var lyrics = data.lyrics;
    var lines = lyrics.lines;
    if (lines.length < 2) return null;

    var isSyllable = lyrics.syncType === "SYLLABLE_SYNCED";
    var parsed = [];
    var syllableData = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var timeS = parseInt(line.startTimeMs, 10) / 1000;
      var text = line.words || "";
      if (text === "\u266a" || text === "") text = "";
      parsed.push({ time: timeS, text: text });

      if (isSyllable && line.syllables && line.syllables.length > 0) {
        var syls = [];
        for (var s = 0; s < line.syllables.length; s++) {
          syls.push({
            startMs: parseInt(line.syllables[s].startTimeMs, 10),
            endMs: parseInt(line.syllables[s].endTimeMs || "0", 10),
            text: line.syllables[s].words || ""
          });
        }
        syllableData.push({ lineIndex: i, syllables: syls });
      }
    }

    return { parsed: parsed, syllableData: syllableData, isSyllable: isSyllable };
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
      var timeEl = overlay.querySelector(".aml-toolbar-time");
      if (timeEl) {
        timeEl.textContent = formatTime(t) + " / " + formatTime(video.duration);
      }
      var playBtn = overlay.querySelector(".aml-tb-play");
      if (playBtn) {
        playBtn.textContent = video.paused ? "\u25b6" : "\u23f8";
      }
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
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
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

  function bindToolbarVideoEvents(playBtn) {
    var video = getVideo();
    if (!video || !playBtn) return;
    function updatePlayState() {
      playBtn.textContent = video.paused ? "\u25b6" : "\u23f8";
    }
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
      window.postMessage({ type: "aml-seek-to", time: seekTime }, "*");
    }

    activeIndex = -1;
    lastSearchHint = 0;
    seekTimeout = setTimeout(function () { userSeeking = false; }, 150);
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
    stopSync();

    var artUrl = getAlbumArtUrl();
    var song = getSongInfo();

    overlay = document.createElement("div");
    overlay.className = "aml-overlay";

    var bgTint = document.createElement("div");
    bgTint.className = "aml-bg-tint";
    if (artUrl) bgTint.style.backgroundImage = "url(" + artUrl + ")";
    overlay.appendChild(bgTint);

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
    closeBtn.addEventListener("click", function () {
      closedByUser = true;
      hideOverlay();
    });
    overlay.appendChild(closeBtn);

    var offsetWrap = document.createElement("div");
    offsetWrap.className = "aml-offset-controls";
    offsetWrap.title = "Sync offset — keyboard: [ earlier, ] later, \\ reset";
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
    overlay.appendChild(offsetWrap);
    updateOffsetLabel();

    var debugEl = document.createElement("div");
    debugEl.className = "aml-debug";
    debugEl.style.display = debugVisible ? "block" : "none";
    debugEl.textContent = lyricsSource + " | " + lyricsType;
    overlay.appendChild(debugEl);

    var toolbar = document.createElement("div");
    toolbar.className = "aml-toolbar";

    var toolbarProgress = document.createElement("div");
    toolbarProgress.className = "aml-toolbar-progress";
    var toolbarProgressFill = document.createElement("div");
    toolbarProgressFill.className = "aml-toolbar-progress-fill";
    toolbarProgress.appendChild(toolbarProgressFill);
    toolbar.appendChild(toolbarProgress);

    var toolbarInner = document.createElement("div");
    toolbarInner.className = "aml-toolbar-inner";

    var toolbarControls = document.createElement("div");
    toolbarControls.className = "aml-toolbar-controls";
    var prevBtn = document.createElement("button");
    prevBtn.className = "aml-tb-btn aml-tb-prev";
    prevBtn.textContent = "\u23ee";
    var playBtn = document.createElement("button");
    playBtn.className = "aml-tb-btn aml-tb-play";
    playBtn.textContent = "\u25b6";
    var nextBtn = document.createElement("button");
    nextBtn.className = "aml-tb-btn aml-tb-next";
    nextBtn.textContent = "\u23ed";
    toolbarControls.appendChild(prevBtn);
    toolbarControls.appendChild(playBtn);
    toolbarControls.appendChild(nextBtn);

    var toolbarInfo = document.createElement("div");
    toolbarInfo.className = "aml-toolbar-info";
    var toolbarTitle = document.createElement("div");
    toolbarTitle.className = "aml-toolbar-title";
    toolbarTitle.textContent = song.title;
    var toolbarArtist = document.createElement("div");
    toolbarArtist.className = "aml-toolbar-artist";
    toolbarArtist.textContent = song.rawArtist || song.artist;
    toolbarInfo.appendChild(toolbarTitle);
    toolbarInfo.appendChild(toolbarArtist);

    var toolbarRight = document.createElement("div");
    toolbarRight.className = "aml-toolbar-right";
    var toolbarTime = document.createElement("span");
    toolbarTime.className = "aml-toolbar-time";
    toolbarTime.textContent = "0:00 / 0:00";
    toolbarRight.appendChild(toolbarTime);

    toolbarInner.appendChild(toolbarControls);
    toolbarInner.appendChild(toolbarInfo);
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

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (overlay) overlay.classList.add("aml-visible");
      });
    });
  }

  function showNoLyrics() {
    removeOverlay();
    var artUrl = getAlbumArtUrl();
    var song = getSongInfo();
    overlay = document.createElement("div");
    overlay.className = "aml-overlay";
    var bgTint = document.createElement("div");
    bgTint.className = "aml-bg-tint";
    if (artUrl) bgTint.style.backgroundImage = "url(" + artUrl + ")";
    overlay.appendChild(bgTint);
    var left = document.createElement("div");
    left.className = "aml-left";
    if (artUrl) { var a = document.createElement("img"); a.className = "aml-album-art"; a.src = artUrl; left.appendChild(a); }
    var t = document.createElement("div"); t.className = "aml-song-title"; t.textContent = song.title; left.appendChild(t);
    var ar = document.createElement("div"); ar.className = "aml-song-artist"; ar.textContent = song.rawArtist || song.artist; left.appendChild(ar);
    overlay.appendChild(left);
    var msg = document.createElement("div"); msg.className = "aml-no-lyrics"; msg.textContent = "No lyrics available"; overlay.appendChild(msg);
    var cb = document.createElement("button"); cb.className = "aml-close"; cb.textContent = "\u00d7";
    cb.addEventListener("click", function () { closedByUser = true; hideOverlay(); });
    overlay.appendChild(cb);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (overlay) overlay.classList.add("aml-visible"); }); });
  }

  function hideOverlay() {
    stopSync();
    if (!overlay) return;
    overlay.classList.remove("aml-visible");
    var el = overlay;
    setTimeout(function () { el.remove(); }, 500);
    overlay = null;
  }

  function removeOverlay() {
    stopSync();
    cachedLineOffsets = null;
    cachedContentHeight = 0;
    cachedLines = null;
    if (overlay) { overlay.remove(); overlay = null; }
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
      result.push({ time: parsed[i].time, text: parsed[i].text, interlude: false });
    }
    if (parsed.length > 0 && parsed[0].time >= INTERLUDE_GAP) {
      result.unshift({ time: parsed[0].time * 0.3, text: INTERLUDE_MARKER, interlude: true });
    }
    return result;
  }

  function showWithSpotifyLyrics(spData) {
    var result = parseSpotifyLyrics(spData);
    if (!result || !result.parsed || result.parsed.length < 2) { return false; }
    useTimedSync = true;
    useWordSync = result.isSyllable;
    wordData = result.syllableData || [];
    lyricsSource = "spotify";
    lyricsType = result.isSyllable ? "word" : "line";
    currentVideoId = getVideoId();
    userOffset = loadSongOffset(currentVideoId);
    var withInterludes = insertInterludes(result.parsed);
    timedData = withInterludes;
    if (useWordSync) {
      for (var adj = 0; adj < wordData.length; adj++) {
        var offset = 0;
        for (var k = 0; k < withInterludes.length; k++) {
          if (k <= wordData[adj].lineIndex) {
            if (withInterludes[k].interlude) offset++;
          }
        }
        wordData[adj].lineIndex = wordData[adj].lineIndex + offset;
      }
    }
    var lines = [];
    for (var i = 0; i < withInterludes.length; i++) {
      lines.push(withInterludes[i].text);
    }
    buildOverlay(lines, withInterludes);
    return true;
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

    if (useWordSync) {
      for (var adj = 0; adj < wordData.length; adj++) {
        var offset = 0;
        for (var k = 0; k < withInterludes.length; k++) {
          if (k <= wordData[adj].lineIndex) {
            if (withInterludes[k].interlude) offset++;
          }
        }
        wordData[adj].lineIndex = wordData[adj].lineIndex + offset;
      }
    }

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

  function tryShowLyrics() {
    if (!isExtensionValid() || !enabled || closedByUser || overlay) return;

    var song = getSongInfo();
    var video = getVideo();
    var duration = video ? video.duration : 0;
    var myFetch = ++fetchId;

    function isStale() { return myFetch !== fetchId || closedByUser; }

    if (song.title && duration > 0 && !isNaN(duration)) {
      function fallbackToCubeyThenPlain() {
        if (isStale()) return;
        var vid = getVideoId();
        cubeyFetchLyrics(song.title, song.artist, duration, vid).then(function (data) {
          if (isStale()) return;
          var result = parseCubeyResponse(data);
          if (result && result.parsed) {
            if (overlay) removeOverlay();
            lyricsSource = result.source; lyricsType = result.type;
            showWithSyncedLyrics(result.parsed);
          } else if (result && result.plainText) {
            if (overlay) removeOverlay();
            lyricsSource = result.source; lyricsType = "plain";
            showWithPlainLyrics(result.plainText);
          } else if (!overlay) {
            showNoLyrics();
          }
        }).catch(function () {
          if (isStale() || overlay) return;
          showNoLyrics();
        });
      }

      function fallbackToLrclibThenCubey() {
        if (isStale()) return;
        fetchSyncedLyrics(song.title, song.artist, duration)
          .then(function (parsed) {
            if (isStale()) return;
            if (parsed && parsed.length >= 2) {
              lyricsSource = "lrclib"; lyricsType = "line";
              showWithSyncedLyrics(parsed);
            } else {
              fallbackToCubeyThenPlain();
            }
          })
          .catch(function () {
            if (!isStale()) fallbackToCubeyThenPlain();
          });
      }

      function fallbackToMxmThenRest() {
        if (isStale()) return;
        mxmFetchLyrics(song.title, song.artist, duration).then(function (parsed) {
          if (isStale()) return;
          if (parsed && parsed.length >= 2) {
            lyricsSource = "musixmatch"; lyricsType = "line";
            showWithSyncedLyrics(parsed);
          } else {
            fallbackToLrclibThenCubey();
          }
        }).catch(function () {
          if (!isStale()) fallbackToLrclibThenCubey();
        });
      }

      // Binimum (Apple Music TTML) is the primary source — same one Better
      // Lyrics treats as #1. Word-level timing on most major-label tracks.
      function fallbackToBinimumThenRest() {
        if (isStale()) return;
        binimumFetchLyrics(song.title, song.artist, duration).then(function (result) {
          if (isStale()) return;
          if (result && result.parsed && result.parsed.length >= 2) {
            lyricsSource = "binimum";
            lyricsType = result.hasWords ? "word" : "line";
            showWithSyncedLyrics(result.parsed);
          } else {
            fallbackToMxmThenRest();
          }
        }).catch(function () {
          if (!isStale()) fallbackToMxmThenRest();
        });
      }

      fallbackToBinimumThenRest();
    } else {
      showNoLyrics();
    }
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
    if (!isExtensionValid()) return;
    var song = getSongInfo();
    if (song.title && song.title !== lastSongTitle) {
      var wasShowing = !!overlay;
      lastSongTitle = song.title;
      lyricsTabClicked = false;
      closedByUser = false;
      activeIndex = -1;
      userOffset = 0;
      fetchId++;
      removeOverlay();
      if (wasShowing) tryShowLyricsWithRetry();
    }
  }

  function tryShowLyricsWithRetry() {
    var attempts = 0;
    var maxAttempts = 20;
    var launched = false;
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
    new MutationObserver(function () {
      if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(onSongChange, 100); }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function findLyricsTab() {
    var sels = [
      "ytmusic-player-page tp-yt-paper-tab",
      "tp-yt-paper-tab.tab-header",
      "#tabsContent tp-yt-paper-tab",
      "tp-yt-paper-tab",
    ];
    var tabs = [];
    for (var c = 0; c < sels.length; c++) {
      tabs = document.querySelectorAll(sels[c]);
      if (tabs.length > 0) break;
    }
    var kw = ["lyrics", "lyric", "\uac00\uc0ac", "\u6b4c\u8a5e", "letras", "paroles", "testo"];
    for (var t = 0; t < tabs.length; t++) {
      var text = tabs[t].textContent.trim().toLowerCase();
      for (var k = 0; k < kw.length; k++) {
        if (text.indexOf(kw[k]) !== -1) return tabs[t];
      }
    }
    return null;
  }

  function watchLyricsTab() {
    document.addEventListener("click", function (e) {
      var tab = findLyricsTab();
      if (!tab) return;
      if (tab.contains(e.target) || tab === e.target) {
        if (overlay) {
          closedByUser = true;
          hideOverlay();
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
    if (!overlay) return;
    if (e.key === "Escape") { closedByUser = true; hideOverlay(); return; }
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
  });

  function isExtensionValid() {
    try { return !!chrome.runtime && !!chrome.runtime.id; }
    catch (e) { return false; }
  }

  chrome.runtime.onMessage.addListener(function (msg, _s, sendResponse) {
    if (!isExtensionValid()) return;
    if (msg.type === "AML_TOGGLE") {
      enabled = msg.enabled;
      chrome.storage.local.set({ [STATE_KEY]: enabled });
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
