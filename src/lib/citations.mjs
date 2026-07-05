// Reference implementation of the deterministic citation-detection logic
// (originally developed for RefCheckr, OpenGATE's first implementation).
//
// This MIRRORS RefCheckr production's lib/citations.js, which routes/verify.js
// imports — the inline duplication in verify.js was promoted to a shared
// module, so the citation-detection scorer is a true regression test of the
// production algorithm. If you change behaviour in either copy, port it to the
// other; the citation-styles fixture catches drift (verified: 104 inputs,
// byte-identical outputs across both modules).

export function normalizeCitations(text) {
  // Pass 1: "word.1,2" / "word1,2" → "word.[1,2]" (letter/period/paren/quote + digits)
  let result = text.replace(/(?<!\d)([a-zA-Z.)"])(\d{1,3}(?:[,\-‐‑‒–]\d{1,3})*)\s/g, (match, prefix, nums) => {
    if (/\d$/.test(prefix)) return match;
    const numParts = nums.split(/[,\-‐‑‒–]/);
    if (numParts.some(p => parseInt(p) > 200)) return match; // guards years / large numbers
    // Avoid false positives on endpoint/identifier names glued to a single number
    // (ACR20, PASI90, EASI75, CD4, type2, grade3): only convert when the prefix is
    // punctuation (e.g. "placebo.1") or it is a list/range (e.g. "outcomes1,2").
    if (/[a-zA-Z]/.test(prefix) && numParts.length === 1) return match;
    return `${prefix}[${nums}] `;
  });
  // Pass 2: "word,12 " → "word,[12] "
  result = result.replace(/([a-zA-Z]),(\d{1,3}(?:[\-‐‑‒–]\d{1,3})?)\s/g, (match, prefix, nums) => {
    if (parseInt(nums) > 200) return match;
    return `${prefix},[${nums}] `;
  });
  // Pass 3: parenthetical "(1,2)" / "(3-9)" → "[1,2]" / "[3-9]"
  result = result.replace(/\((\d{1,3}(?:[,\-‐‑‒–]\d{1,3})*)\)/g, (match, nums) => {
    const numParts = nums.split(/[,\-‐‑‒–]/);
    if (numParts.some(p => parseInt(p) > 200)) return match;
    return `[${nums}]`;
  });
  return result;
}

/** Parse the set of citation numbers from a (already-normalised) claim string. */
export function parseClaimCitations(claim) {
  const citationPattern = /\[(\d[\d,\-‐‑‒–\s]*)\]/g;
  const citations = new Set();
  let match;
  while ((match = citationPattern.exec(claim)) !== null) {
    match[1].split(',').forEach(part => {
      part = part.trim();
      const range = part.match(/^(\d+)\s*[-‐‑‒–]\s*(\d+)$/);
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
