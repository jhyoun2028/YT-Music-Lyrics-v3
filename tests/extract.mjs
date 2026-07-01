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
  "normalizeAccent",
  "hslToRgb",
  "accentPalette",
];

// Constants these functions close over in content.js.
const constants = `
  var INTERLUDE_GAP = 10;
  var INTERLUDE_MARKER = "\\u266a";
  var MAX_DURATION_DIFF = 10;
`;

const body =
  '"use strict";' +
  constants +
  NAMES.map(extractFunction).join("\n\n") +
  "\nreturn { " + NAMES.join(", ") + " };";

// eslint-disable-next-line no-new-func
const mod = new Function(body)();
export default mod;
