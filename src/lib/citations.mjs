// Reference implementation of the deterministic citation-detection logic
// (originally developed for RefCheckr, OpenGATE's first implementation).
//
// This MIRRORS RefCheckr production's lib/citations.js, which routes/verify.js
// imports — the inline duplication in verify.js was promoted to a shared
// module, so the citation-detection scorer is a true regression test of the
// production algorithm. If you change behaviour in either copy, port it to the
// other; the citation-styles fixture catches drift.
//
// Ported from RefCheckr v2.2.1 (Aug 2026): true Unicode superscript markers,
// whitespace and semicolons inside parenthetical citations, em-dash ranges,
// and markers sitting at the very end of the input.

// Unicode superscript digits. Word and most PDF exports render superscript
// citation markers as these codepoints when copied as plain text, so a
// manuscript pasted straight from Word arrives as "outcomes⁹,¹⁰" rather than
// "outcomes9,10". Nothing downstream understood them, so superscript-cited
// manuscripts — the single most common house style — detected zero citations.
const SUPERSCRIPT_DIGITS = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};
const SUP_DIGIT_CLASS = '\\u2070\\u00B9\\u00B2\\u00B3\\u2074-\\u2079';
// Superscript separators: comma, semicolon, superscript minus/hyphen, en dash.
const SUP_SEP_CLASS = ',;\\u002C\\u207B\\u2013\\u2012\\-';
const SUPERSCRIPT_RUN = new RegExp(
  `[${SUP_DIGIT_CLASS}]+(?:[${SUP_SEP_CLASS}][${SUP_DIGIT_CLASS}]+)*`,
  'g'
);

/** Convert a run of superscript digits/separators to plain "1,2" / "3-9" form. */
function transliterateSuperscripts(run) {
  let out = '';
  for (const ch of run) {
    if (SUPERSCRIPT_DIGITS[ch] !== undefined) out += SUPERSCRIPT_DIGITS[ch];
    else if (ch === '⁻' || ch === '–' || ch === '‒' || ch === '-') out += '-';
    else if (ch === ';' || ch === ',') out += ',';
  }
  return out;
}

/**
 * Normalize bare superscript-style citations to bracketed format.
 * e.g. "word.1,2" → "word.[1,2]", "word3-9" → "word.[3-9]",
 *      "word,12" at end of clause → "word.[12]",
 *      "word⁹,¹⁰" → "word[9,10]"
 */
export function normalizeCitations(text) {
  // Pass 0: true Unicode superscripts. Handled before everything else and
  // without the trailing-whitespace requirement the later passes impose —
  // superscript digits are never decimals or endpoint names (there is no
  // "ACR²⁰"), so a superscript run is an unambiguous citation marker wherever
  // it appears, including immediately before a full stop.
  let result = String(text ?? '').replace(SUPERSCRIPT_RUN, (run) => {
    const nums = transliterateSuperscripts(run);
    const parts = nums.split(/[,\-]/).filter(Boolean);
    if (!parts.length) return run;
    if (parts.some(p => parseInt(p, 10) > 200)) return run;
    return `[${nums}]`;
  });

  // Pass 1: Handle "word.1,2" and "word1,2" patterns (letter/period followed by digits)
  // Negative lookbehind prevents matching decimal values like "0.17 " (digit
  // before the "." prefix) — otherwise ".17" would be bracketed as a citation
  // and subsequently stripped, corrupting decimals.
  result = result.replace(/(?<!\d)([a-zA-Z.)"])(\d{1,3}(?:[,\-‐‑‒–—]\d{1,3})*)(?=[\s.,;:!?)\]]|$)/g, (match, prefix, nums) => {
    if (/\d$/.test(prefix)) return match;
    const numParts = nums.split(/[,\-‐‑‒–—]/);
    if (numParts.some(p => parseInt(p) > 200)) return match;
    // Avoid false positives on endpoint/identifier names glued to a single number
    // (ACR20, PASI90, EASI75, CD4, type2, grade3). A letter directly followed by a
    // single number is ambiguous, so only convert when the prefix is punctuation
    // (e.g. "placebo.1") or the number is a list/range (e.g. "outcomes1,2") — both
    // strong citation signals.
    if (/[a-zA-Z]/.test(prefix) && numParts.length === 1) return match;
    // Trailing delimiter is matched by lookahead, so it must not be re-emitted.
    return `${prefix}[${nums}]`;
  });

  // Pass 2: Handle "word,12 " pattern (comma then single citation number, common in superscript copy-paste)
  result = result.replace(/([a-zA-Z]),(\d{1,3}(?:[\-‐‑‒–—]\d{1,3})?)(?=[\s.,;:!?)\]]|$)/g, (match, prefix, nums) => {
    if (parseInt(nums) > 200) return match;
    return `${prefix},[${nums}]`;
  });

  // Pass 3: Handle parenthetical citations: (1,2) or (3-9) → [1,2] or [3-9]
  // Whitespace is permitted around the separators — "(9, 10)" is at least as
  // common in submitted manuscripts as "(9,10)", and previously only the
  // tight form was recognised, so a single space silently cost the user a
  // citation. Semicolons are accepted as a separator for the same reason.
  result = result.replace(/\(\s*(\d{1,3}(?:\s*[,;\-‐‑‒–—]\s*\d{1,3})*)\s*\)/g, (match, nums) => {
    const numParts = nums.split(/\s*[,;\-‐‑‒–—]\s*/);
    if (numParts.some(p => parseInt(p) > 200)) return match;
    // Collapse to canonical tight form so the parser sees "[9,10]" / "[9-11]".
    const canonical = nums
      .replace(/\s*[,;]\s*/g, ',')
      .replace(/\s*[\-‐‑‒–—]\s*/g, '-');
    return `[${canonical}]`;
  });

  return result;
}

/** Parse the set of citation numbers from a (already-normalised) claim string. */
export function parseClaimCitations(claim) {
  const citationPattern = /\[(\d[\d,;\-‐‑‒–—\s]*)\]/g;
  const citations = new Set();
  let match;
  while ((match = citationPattern.exec(claim)) !== null) {
    match[1].split(/[,;]/).forEach(part => {
      part = part.trim();
      const range = part.match(/^(\d+)\s*[-‐‑‒–—]\s*(\d+)$/);
      if (range) {
        for (let i = parseInt(range[1]); i <= parseInt(range[2]); i++) citations.add(i);
      } else if (/^\d+$/.test(part)) {
        citations.add(parseInt(part));
      }
    });
  }
  return [...citations].sort((a, b) => a - b);
}

// ── Author-year detection ───────────────────────────────────────────────
// Framework capability, additive to the numeric passes above. The numeric
// functions (normalizeCitations / parseClaimCitations) still mirror RefCheckr
// production (routes/verify.js) exactly; author-year keys are not yet consumed
// by RefCheckr's downstream citation mapping, which is numeric-keyed.
//
// A detected author-year citation is keyed "Surname YYYY" (first author only),
// e.g. "(Smith et al., 2020)" → "Smith 2020".

const NAME = String.raw`[A-Z][A-Za-z'’\-]+`;
const YEAR = String.raw`(?:1[89]|20)\d{2}`;
const ETAL = String.raw`(?:et al\.?|and colleagues|and coworkers)`;

/** Detect author-year citations in raw text; returns sorted unique keys. */
export function detectAuthorYear(text) {
  const found = new Set();
  // Year suffixes are kept: "Smith 2020a" and "Smith 2020b" are distinct
  // references in author-year styles.
  const add = (name, year) => found.add(`${name} ${year}`);

  // 1. Narrative with parenthetical year: "Smith et al. (2020)",
  //    "Smith and Jones (2019)", "Smith (2020)".
  const narrative = new RegExp(
    String.raw`\b(${NAME})(?:\s+(?:${ETAL}|(?:and|&)\s+${NAME}))?\s*\((${YEAR}[a-z]?)\)`, 'g');
  for (const m of text.matchAll(narrative)) add(m[1], m[2]);

  // 2. Parenthetical: "(Smith et al., 2020)", "(Smith & Jones, 2019)",
  //    "(Kim, 2023)", multiples split on ";": "(Brown 2018; Lee et al., 2022)".
  const inner = new RegExp(
    String.raw`^\s*(${NAME})(?:\s+${ETAL}|,?\s+(?:and|&)\s+${NAME})?,?\s+(${YEAR}[a-z]?)\s*$`);
  for (const m of text.matchAll(/\(([^()]+)\)/g)) {
    for (const part of m[1].split(';')) {
      const hit = part.match(inner);
      if (hit) add(hit[1], hit[2]);
    }
  }

  // 3. Narrative prose year: "Jones and colleagues in 2019". Requires an
  //    et-al-style marker so plain prose years ("began in 2019") never match.
  const prose = new RegExp(
    String.raw`\b(${NAME})\s+${ETAL}[^.;()]*?\bin\s+(${YEAR})\b`, 'g');
  for (const m of text.matchAll(prose)) add(m[1], m[2]);

  return [...found].sort();
}

/**
 * Convenience: detect citations directly from raw claim text.
 * Returns numeric citations (numbers) followed by author-year keys (strings).
 */
export function detectCitations(rawClaim) {
  return [
    ...parseClaimCitations(normalizeCitations(rawClaim + ' ')),
    ...detectAuthorYear(rawClaim),
  ];
}
