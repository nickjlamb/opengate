// Pure simplification check — the shared core behind the simplification scorer
// and the exp-2 replay harness. Given a simplified output and the gold case it
// came from, it reports the three deterministic failures that matter:
//
//   • anchor recall — clinically critical facts must survive the paraphrase
//   • fabricated numbers — every number must trace to the source, an anchor,
//     or the case's allowedNewNumbers
//   • length contract — the product's documented output shape (e.g. Brief mode:
//     ≤3 bullets, ≤20 words each)
//
// Deterministic, no LLM judge. Single source of truth: if the check changes,
// the scorer and any offline replay of frozen outputs change with it.

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ');

/** Whitespace-tolerant, case-insensitive containment. */
export function contains(haystack, needle) {
  const h = norm(haystack).replace(/\s/g, '');
  const n = norm(needle).replace(/\s/g, '');
  return n.length > 0 && h.includes(n);
}

const NUM_RE = /\d+(?:\.\d+)?/g;
export const numbersIn = (s) =>
  new Set((String(s).match(NUM_RE) || []).map(n => n.replace(/^0+(?=\d)/, '')));

/** Lines that look like bullets: -, •, *, or "1." style. */
export function bulletLines(text) {
  return String(text).split(/\r?\n/).map(l => l.trim())
    .filter(l => /^([-•*]|\d+[.)])\s+/.test(l));
}

// Flesch-Kincaid grade with a vowel-group syllable heuristic. Approximate,
// which is why readability is reported rather than gated.
export function fleschKincaidGrade(text) {
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  const sentences = Math.max(1, (String(text).match(/[.!?]+/g) || []).length);
  if (!words.length) return null;
  let syllables = 0;
  for (const w of words) {
    const groups = (w.replace(/e$/, '').match(/[aeiouy]+/g) || []).length;
    syllables += Math.max(1, groups);
  }
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

/**
 * @param {object} input
 *   output            (string, required) the simplified text
 *   text              (string, required) the source text it was simplified from
 *   anchors           ([{ value, aliases? }]) facts that must survive
 *   allowedNewNumbers ([string|number], optional)
 *   maxBullets        (number, optional) length contract
 *   maxWordsPerBullet (number, optional) length contract
 * @returns {{ faithful, anchorsMissed, fabricated, contractViolations, bullets, grade, issues }}
 */
export function checkSimplification(input) {
  const out = String(input.output ?? '');
  const anchors = input.anchors || [];
  const issues = [];

  // Anchor recall: value or any alias must survive.
  const anchorsMissed = anchors
    .filter(a => ![a.value, ...(a.aliases || [])].some(v => contains(out, v)))
    .map(a => a.value);
  for (const v of anchorsMissed) issues.push(`missing fact "${v}"`);

  // Fabricated numbers: output numbers must come from somewhere legitimate.
  const legit = new Set([
    ...numbersIn(input.text || ''),
    ...anchors.flatMap(a => [
      ...numbersIn(a.value),
      ...(a.aliases || []).flatMap(x => [...numbersIn(x)]),
    ]),
    ...(input.allowedNewNumbers || []).map(String),
  ]);
  const fabricated = [...numbersIn(out)].filter(n => !legit.has(n));
  for (const n of fabricated) issues.push(`fabricated number "${n}" — not in the source`);

  // Length contract (only when the case declares one).
  const bullets = bulletLines(out);
  const contractViolations = [];
  if (input.maxBullets != null && bullets.length > input.maxBullets) {
    contractViolations.push(`${bullets.length} bullets > max ${input.maxBullets}`);
  }
  if (input.maxWordsPerBullet != null) {
    for (const b of bullets) {
      const words = b.replace(/^([-•*]|\d+[.)])\s+/, '').split(/\s+/).filter(Boolean).length;
      if (words > input.maxWordsPerBullet) {
        contractViolations.push(`bullet has ${words} words > max ${input.maxWordsPerBullet}`);
      }
    }
  }
  if (input.maxBullets != null && bullets.length === 0) {
    contractViolations.push('bullet output expected, none found');
  }
  for (const v of contractViolations) issues.push(`contract: ${v}`);

  return {
    faithful: anchorsMissed.length === 0 && fabricated.length === 0,
    anchorsMissed,
    fabricated,
    contractViolations,
    bullets: bullets.length,
    grade: fleschKincaidGrade(out),
    issues,
  };
}
