// Zero-dependency test support: pull pure functions out of content.js by name
// (brace-matched) and eval them in isolation, so tests exercise the REAL source
// without duplicating it and without running the IIFE's chrome.* side effects.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "content.js"), "utf8");

function extractFunction(name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error("function not found in content.js: " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Pull a single-line `var NAME = <...>;` declaration verbatim from content.js so
// the extracted functions close over the REAL constant values. This replaces a
// hand-kept duplicate that had to be edited in lockstep with content.js (and
// could silently drift, letting tests pass against stale tables).
function extractVar(name) {
  const m = src.match(new RegExp("\\bvar\\s+" + name + "\\s*=[^;]*;"));
  if (!m) throw new Error("var not found in content.js: " + name);
  return m[0];
}

const NAMES = [
  "parseLRC",
  "parseTTMLTime",
  "formatTime",
  "getArtistVariations",
  "getTitleVariations",
  "normMatch",
  "looseMatch",
  "candidateMatches",
  "insertInterludes",
  "remapWordDataIndices",
  "cssUrl",
  "rgbToHsl",
  "normalizeAccent",
  "hslToRgb",
  "accentPalette",
  "mxmExtractSubtitleBody",
  "hasHangul",
  "romanizeHangul",
  "parseCubeyResponse",
  "lrcTimeTag",
  "serializeLRC",
];

// Constants these functions close over in content.js — extracted from source,
// not duplicated, so they can never drift from the real declarations.
const CONST_NAMES = [
  "INTERLUDE_GAP", "INTERLUDE_MARKER", "MAX_DURATION_DIFF",
  "RR_INITIAL", "RR_MEDIAL", "RR_FINAL", "RR_LIAISON", "RR_NASAL",
  "RR_DBL_LIAISON", "RR_ASP_FWD", "RR_ASP_BACK", "RR_H_CLUSTER",
];
const constants = CONST_NAMES.map(extractVar).join("\n");

const body =
  '"use strict";' +
  constants +
  NAMES.map(extractFunction).join("\n\n") +
  "\nreturn { " + NAMES.join(", ") + " };";

// eslint-disable-next-line no-new-func
const mod = new Function(body)();
export default mod;
