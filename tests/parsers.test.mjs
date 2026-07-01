import { test } from "node:test";
import assert from "node:assert/strict";
import core from "./extract.mjs";

const { parseLRC, parseTTMLTime, formatTime, getArtistVariations, getTitleVariations, normMatch, looseMatch, candidateMatches, insertInterludes, remapWordDataIndices, cssUrl, normalizeAccent, hslToRgb, accentPalette } = core;

test("cssUrl: escapes quotes and backslashes so it can't break out of url()", () => {
  assert.equal(cssUrl("https://x/a.png"), 'url("https://x/a.png")');
  assert.equal(cssUrl('a").evil{'), 'url("a\\").evil{")');
});

test("hslToRgb: known anchors", () => {
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
  assert.deepEqual(hslToRgb(240, 1, 0.5), [0, 0, 255]);
});

test("normalizeAccent: keeps a deep red rich (not washed to pink), pins luminance", () => {
  const [r, g, b] = normalizeAccent(140, 20, 20);
  assert.ok(r > g && r > b, "stays red-dominant");
  assert.ok(r > 150, "vivid, not muddy");
});

test("normalizeAccent: near-gray input stays neutral (no invented hue)", () => {
  const [r, g, b] = normalizeAccent(100, 100, 100);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  assert.ok(max - min <= 24, "stays near-neutral for a gray album");
});

test("accentPalette: returns 4 'r, g, b' triplets", () => {
  const pal = accentPalette(230, 90, 140);
  assert.equal(pal.length, 4);
  for (const c of pal) assert.match(c, /^\d+, \d+, \d+$/);
});

test("parseLRC: basic timestamped lines, sorted", () => {
  const out = parseLRC("[00:10.00]world\n[00:05.00]hello");
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "hello");
  assert.equal(out[0].time, 5);
  assert.equal(out[1].text, "world");
  assert.equal(out[1].time, 10);
});

test("parseLRC: multiple timestamps on one line expand to multiple entries", () => {
  const out = parseLRC("[00:01.00][00:03.00]repeat");
  assert.equal(out.length, 2);
  assert.equal(out[0].time, 1);
  assert.equal(out[1].time, 3);
  assert.equal(out[0].text, "repeat");
});

test("parseLRC: [offset:] shifts times (ms, positive = later)", () => {
  const out = parseLRC("[offset:500]\n[00:10.00]line");
  assert.equal(out[0].time, 10.5);
});

test("parseLRC: metadata tags are skipped", () => {
  const out = parseLRC("[ti:Song]\n[ar:Artist]\n[00:02.00]only this");
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "only this");
});

test("parseTTMLTime: unit and clock formats", () => {
  assert.equal(parseTTMLTime("10s"), 10);
  assert.equal(parseTTMLTime("500ms"), 0.5);
  assert.equal(parseTTMLTime("2m"), 120);
  assert.equal(parseTTMLTime("1:30.5"), 90.5);
  assert.equal(parseTTMLTime("1:02:03"), 3723);
  assert.equal(parseTTMLTime(""), 0);
  assert.equal(parseTTMLTime(12.5), 12.5);
});

test("formatTime: minutes and hour+ formatting", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65), "1:05");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(NaN), "0:00");
});

test("getArtistVariations: splits out parenthetical names", () => {
  const v = getArtistVariations("A (B)");
  assert.ok(v.includes("A (B)"));
  assert.ok(v.includes("B"));
  assert.ok(v.includes("A"));
});

test("getTitleVariations: splits a bilingual Korean title (capped at 2)", () => {
  const v = getTitleVariations("사랑인가 봐 (Love, maybe)");
  assert.ok(v.includes("사랑인가 봐 (Love, maybe)"), "keeps original");
  assert.ok(v.includes("사랑인가 봐"), "adds parenthetical-stripped form");
  assert.ok(v.length <= 2, "capped to 2 to keep request fan-out small");
});

test("getTitleVariations: plain title yields just itself", () => {
  assert.deepEqual(getTitleVariations("Ditto"), ["Ditto"]);
});

test("getTitleVariations: strips a trailing ' - ...' descriptor and caps to 4", () => {
  const v = getTitleVariations("Spring Day - From the Album");
  assert.ok(v.includes("Spring Day"));
  assert.ok(v.length <= 4);
});

test("normMatch: strips parentheticals, feat, punctuation; keeps Hangul", () => {
  assert.equal(normMatch("팅 (feat. 김하온)"), "팅");
  assert.equal(normMatch("Love, maybe"), "lovemaybe");
  assert.equal(normMatch("Ditto (Remix)"), "ditto");
});

test("looseMatch: bilingual / parenthetical titles match their core", () => {
  assert.ok(looseMatch("팅 (feat. 김하온)", "팅"));
  assert.ok(looseMatch("사랑인가 봐 (Love, maybe)", "사랑인가 봐"));
  assert.ok(!looseMatch("팅", "Attention"));
});

// The "팅" regression: a candidate with the same (short) title but a DIFFERENT
// artist must be rejected — artist is the discriminator.
test("candidateMatches: same short title, wrong artist → rejected", () => {
  assert.ok(candidateMatches("팅", "우디고차일드", "팅 (feat. 김하온)", "우디고차일드"));
  assert.ok(!candidateMatches("팅", "Charlie Puth", "팅 (feat. 김하온)", "우디고차일드"));
});

test("candidateMatches: unreadable fields are not held against a candidate", () => {
  // No title/artist info from the API → can't disprove → accept (duration still gates).
  assert.ok(candidateMatches("", "", "팅", "우디고차일드"));
});

test("insertInterludes: inserts a marker across a long gap", () => {
  const parsed = [
    { time: 0, text: "a" },
    { time: 15, text: "b" }, // 15s gap >= INTERLUDE_GAP
  ];
  const out = insertInterludes(parsed);
  assert.equal(out.length, 3);
  assert.equal(out[0].text, "a");
  assert.equal(out[1].interlude, true);
  assert.equal(out[2].text, "b");
});

test("insertInterludes: no interlude when gaps are small", () => {
  const parsed = [
    { time: 0, text: "a" },
    { time: 2, text: "b" },
    { time: 4, text: "c" },
  ];
  const out = insertInterludes(parsed);
  assert.equal(out.length, 3);
  assert.ok(out.every((e) => e.interlude === false));
});

test("insertInterludes: leading interlude when first line starts late", () => {
  const parsed = [
    { time: 20, text: "a" },
    { time: 22, text: "b" },
  ];
  const out = insertInterludes(parsed);
  assert.equal(out[0].interlude, true);
  assert.equal(out[1].text, "a");
});

// --- The critical regression: word-sync index remap across MULTIPLE interludes.
test("remapWordDataIndices: maps original index to interlude-expanded position", () => {
  // Manually-built expanded array with 4 interludes interleaved between 5 lines.
  const withInterludes = [
    { interlude: false }, // orig 0 -> 0
    { interlude: true },
    { interlude: false }, // orig 1 -> 2
    { interlude: true },
    { interlude: false }, // orig 2 -> 4
    { interlude: true },
    { interlude: false }, // orig 3 -> 6
    { interlude: true },
    { interlude: false }, // orig 4 -> 8
  ];
  const wordData = [
    { lineIndex: 0, syllables: [] },
    { lineIndex: 2, syllables: [] },
    { lineIndex: 4, syllables: [] },
  ];
  remapWordDataIndices(wordData, withInterludes);
  assert.equal(wordData[0].lineIndex, 0);
  assert.equal(wordData[1].lineIndex, 4);
  // The old k<=lineIndex loop produced 6 here; the correct position is 8.
  assert.equal(wordData[2].lineIndex, 8);
});

test("remapWordDataIndices: end-to-end with insertInterludes points at the right text", () => {
  const parsed = [
    { time: 0, text: "a" },
    { time: 15, text: "b" }, // interlude before
    { time: 30, text: "c" }, // interlude before
  ];
  const withInterludes = insertInterludes(parsed);
  // word data attached to original line 2 ("c")
  const wordData = [{ lineIndex: 2, syllables: [] }];
  remapWordDataIndices(wordData, withInterludes);
  assert.equal(withInterludes[wordData[0].lineIndex].text, "c");
  assert.equal(withInterludes[wordData[0].lineIndex].interlude, false);
});
