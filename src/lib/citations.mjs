// Reference implementation of the deterministic citation-detection logic
// (originally developed for RefCheckr, OpenGATE's first implementation).
//
// This MIRRORS the pure functions currently inlined in routes/verify.js
// (normalizeCitations + the per-claim citation parser). It is duplicated here
// only so the eval harness can exercise the algorithm offline with zero API
// cost.
//
// FOLLOW-UP (recommended first "make-it-evaluable" task): promote this module
// to the app's lib/ (e.g. lib/citations.js) and have routes/verify.js import
// from it, so production and the eval share a single source of truth. The
// citation-detection scorer then becomes a true regression test of prod code.
// Until then, keep this in sync with verify.js — the scorer's style fixture
// will catch most drift.

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

/** Convenience: detect citations directly from raw claim text (normalise then parse). */
export function detectCitations(rawClaim) {
  return parseClaimCitations(normalizeCitations(rawClaim + ' '));
}
