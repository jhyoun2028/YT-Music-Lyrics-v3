import { test } from "node:test";
import assert from "node:assert/strict";
import core from "./extract.mjs";

const { parseLRC, parseTTMLTime, formatTime, getArtistVariations, getTitleVariations, normMatch, looseMatch, candidateMatches, insertInterludes, remapWordDataIndices, cssUrl, normalizeAccent, hslToRgb, accentPalette, mxmExtractSubtitleBody, hasHangul, romanizeHangul, parseCubeyResponse, lrcTimeTag, serializeLRC } = core;

test("lrcTimeTag: zero-padded [mm:ss.xx]", () => {
  assert.equal(lrcTimeTag(0), "[00:00.00]");
  assert.equal(lrcTimeTag(1), "[00:01.00]");
  assert.equal(lrcTimeTag(65.5), "[01:05.50]");
  assert.equal(lrcTimeTag(600), "[10:00.00]");
});

test("serializeLRC: round-trips timed lines and skips interludes", () => {
  const data = [
    { time: 1, text: "a" },
    { time: 65.5, text: "b" },
    { interlude: true, time: 70, text: "♪" },
    { time: 80, text: "c" },
  ];
  assert.equal(serializeLRC(data), "[00:01.00]a\n[01:05.50]b\n[01:20.00]c");
  // and it parses back to the same times/texts
  const back = parseLRC(serializeLRC(data));
  assert.deepEqual(back.map((l) => l.text), ["a", "b", "c"]);
  assert.equal(back[1].time, 65.5);
});

test("parseCubeyResponse: normalizes each non-TTML branch (mxm / lrclib / plain)", () => {
  const synced = "[00:01.00]a\n[00:02.00]b";
  assert.deepEqual(
    { s: parseCubeyResponse({ musixmatchSyncedLyrics: synced }).source, n: parseCubeyResponse({ musixmatchSyncedLyrics: synced }).parsed.length },
    { s: "cubey-mxm", n: 2 }
  );
  assert.equal(parseCubeyResponse({ lrclibSyncedLyrics: synced }).source, "cubey-lrclib");
  var plain = parseCubeyResponse({ lrclibPlainLyrics: "a longer plain lyric block" });
  assert.equal(plain.source, "cubey-plain");
  assert.equal(plain.type, "plain");
});

test("parseCubeyResponse: null/empty/too-short → null", () => {
  assert.equal(parseCubeyResponse(null), null);
  assert.equal(parseCubeyResponse({}), null);
  assert.equal(parseCubeyResponse({ lrclibPlainLyrics: "short" }), null);   // ≤10 chars
});

test("romanizeHangul: per-syllable Revised Romanization", () => {
  assert.equal(romanizeHangul("사랑"), "sarang");
  assert.equal(romanizeHangul("노래"), "norae");
  assert.equal(romanizeHangul("안녕"), "annyeong");
  assert.equal(romanizeHangul("이게"), "ige");
});

test("romanizeHangul: batchim liaison before ㅇ (연음)", () => {
  assert.equal(romanizeHangul("생각이"), "saenggagi");   // ㄱ moves: ...ga-gi
  assert.equal(romanizeHangul("음악을"), "eumageul");     // ㅁ, ㄱ both liaise
  assert.equal(romanizeHangul("사랑을"), "sarangeul");    // ㅇ(ng) does NOT move
});

test("romanizeHangul: palatalization (ㄷ/ㅌ+이) and silent ㅎ before a vowel", () => {
  assert.equal(romanizeHangul("같이"), "gachi");   // ㅌ + 이 → chi
  assert.equal(romanizeHangul("굳이"), "guji");    // ㄷ + 이 → ji
  assert.equal(romanizeHangul("좋아"), "joa");     // ㅎ drops before a vowel
});

test("romanizeHangul: nasalization of obstruent batchim before ㄴ/ㅁ", () => {
  assert.equal(romanizeHangul("국물"), "gungmul");  // ㄱ before ㅁ → ng
  assert.equal(romanizeHangul("있는"), "inneun");   // ㅆ(t) before ㄴ → n
  assert.equal(romanizeHangul("안녕"), "annyeong"); // ㄴ final unaffected (regression guard)
});

test("romanizeHangul: liquidization ㄴ+ㄹ / ㄹ+ㄴ → ll", () => {
  assert.equal(romanizeHangul("신라"), "silla");     // ㄴ+ㄹ
  assert.equal(romanizeHangul("설날"), "seollal");   // ㄹ+ㄴ
  assert.equal(romanizeHangul("일년"), "illyeon");   // ㄹ+ㄴ
  assert.equal(romanizeHangul("난로"), "nallo");     // ㄴ+ㄹ
});

test("romanizeHangul: double-batchim liaison before ㅇ (겹받침 연음)", () => {
  assert.equal(romanizeHangul("읽어"), "ilgeo");     // ㄺ → l + g carries
  assert.equal(romanizeHangul("앉아"), "anja");      // ㄵ → n + j carries
  assert.equal(romanizeHangul("젊어"), "jeolmeo");   // ㄻ → l + m carries
  assert.equal(romanizeHangul("넓어"), "neolbeo");   // ㄼ → l + b carries
  assert.equal(romanizeHangul("싫어"), "sireo");     // ㅀ → ㅎ drops, ㄹ liaises as r
  // Double batchim before a consonant keeps its single representative sound.
  assert.equal(romanizeHangul("읽다"), "ikda");      // ㄺ before ㄷ → k (regression guard)
});

test("romanizeHangul: ㅎ aspiration (격음화)", () => {
  assert.equal(romanizeHangul("좋고"), "joko");      // ㅎ + ㄱ → k
  assert.equal(romanizeHangul("좋다"), "jota");      // ㅎ + ㄷ → t
  assert.equal(romanizeHangul("좋지"), "jochi");     // ㅎ + ㅈ → ch
  assert.equal(romanizeHangul("축하"), "chuka");     // ㄱ + ㅎ → k
  assert.equal(romanizeHangul("급히"), "geupi");     // ㅂ + ㅎ → p
  assert.equal(romanizeHangul("못해"), "motae");     // ㅅ(→t) + ㅎ → t
  assert.equal(romanizeHangul("못한"), "motan");     // ㅅ(→t) + ㅎ → t
  assert.equal(romanizeHangul("옷 한"), "ot han");   // no aspiration across a space
  assert.equal(romanizeHangul("굳히다"), "guchida"); // ㄷ+ㅎ→ㅌ then ㅌ+ㅣ→ch
  assert.equal(romanizeHangul("묻히다"), "muchida"); // aspiration + palatalization
  assert.equal(romanizeHangul("급히"), "geupi");     // ㅂ+ㅎ→ㅍ before ㅣ does NOT palatalize (guard)
  assert.equal(romanizeHangul("좋아"), "joa");       // ㅎ + ㅇ still silent (regression guard)
});

test("romanizeHangul: ㅎ-cluster batchim (ㄶ/ㅀ) aspirates a following stop", () => {
  assert.equal(romanizeHangul("많다"), "manta");       // ㄶ + ㄷ → n + t
  assert.equal(romanizeHangul("않고"), "anko");        // ㄶ + ㄱ → n + k
  assert.equal(romanizeHangul("싫다"), "silta");       // ㅀ + ㄷ → l + t
  assert.equal(romanizeHangul("괜찮다"), "gwaenchanta"); // ㄶ mid-word + ㄷ
  assert.equal(romanizeHangul("많아"), "mana");        // ㄶ + ㅇ still liaises to n (regression)
  assert.equal(romanizeHangul("싫어"), "sireo");       // ㅀ + ㅇ still ㄹ-liaison (regression)
});

test("romanizeHangul: rules compose across realistic sequences", () => {
  assert.equal(romanizeHangul("많이"), "mani");            // ㄶ+ㅇ → n, silent ㅎ
  assert.equal(romanizeHangul("괜찮아"), "gwaenchana");    // ㄶ+ㅇ mid-word
  assert.equal(romanizeHangul("좋은 날"), "joeun nal");    // silent ㅎ + space passthrough
  assert.equal(romanizeHangul("싫었어"), "sireosseo");     // ㅀ liaison then ㅆ liaison chain
});

test("romanizeHangul: non-Hangul passes through; mixed lines work", () => {
  assert.equal(romanizeHangul("oh baby"), "oh baby");
  assert.equal(romanizeHangul("봐 oh"), "bwa oh");
  assert.equal(romanizeHangul(""), "");
});

test("hasHangul: detects Hangul syllables", () => {
  assert.ok(hasHangul("사랑해"));
  assert.ok(hasHangul("mixed 사랑"));
  assert.ok(!hasHangul("just latin"));
  assert.ok(!hasHangul(""));
});

test("mxmExtractSubtitleBody: pulls the subtitle body from the nested macro shape", () => {
  const body = "[00:01.00]hi";
  const data = { message: { body: { macro_calls: { "track.subtitles.get": { message: { body: { subtitle_list: [{ subtitle: { subtitle_body: body } }] } } } } } } };
  assert.equal(mxmExtractSubtitleBody(data), body);
});

test("mxmExtractSubtitleBody: any missing level returns falsy (no throw)", () => {
  assert.ok(!mxmExtractSubtitleBody({}));
  assert.ok(!mxmExtractSubtitleBody({ message: { body: { macro_calls: {} } } }));
  assert.ok(!mxmExtractSubtitleBody(null));
});

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

test("parseLRC: strips enhanced-LRC <mm:ss.xx> word tags from the text", () => {
  const out = parseLRC("[00:01.00]<00:01.00>hello <00:01.50>world");
  assert.equal(out.length, 1);
  assert.equal(out[0].time, 1);
  assert.equal(out[0].text, "hello world");
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
