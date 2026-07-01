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
  "rgbToHsl",
  "normalizeAccent",
  "hslToRgb",
  "accentPalette",
  "mxmExtractSubtitleBody",
  "hasHangul",
  "romanizeHangul",
];

// Constants these functions close over in content.js.
const constants = `
  var INTERLUDE_GAP = 10;
  var INTERLUDE_MARKER = "\\u266a";
  var MAX_DURATION_DIFF = 10;
  var RR_INITIAL = ["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];
  var RR_MEDIAL = ["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","wo","we","wi","yu","eu","ui","i"];
  var RR_FINAL = ["","k","k","k","n","n","n","t","l","k","m","l","l","l","p","l","m","p","p","t","t","ng","t","t","k","t","p","t"];
  var RR_LIAISON = { 1:"g",2:"kk",4:"n",7:"d",8:"r",16:"m",17:"b",19:"s",20:"ss",22:"j",23:"ch",24:"k",25:"t",26:"p" };
`;

const body =
  '"use strict";' +
  constants +
  NAMES.map(extractFunction).join("\n\n") +
  "\nreturn { " + NAMES.join(", ") + " };";

// eslint-disable-next-line no-new-func
const mod = new Function(body)();
export default mod;
