// Generic scoring primitives used by the eval scorers.
// Pure functions, no I/O — easy to unit-test and reason about.

/** Set intersection-over-union for two arrays of primitives. */
export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** True if two arrays contain exactly the same set of values. */
export function exactSetMatch(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

/**
 * Precision / recall / F1 for predicted vs gold items.
 * `matchFn(pred, gold) => bool` decides whether two items are "the same"
 * (e.g. fuzzy text match for claims). Greedy one-to-one matching.
 */
export function precisionRecallF1(predicted, gold, matchFn = (a, b) => a === b) {
  const usedGold = new Set();
  let tp = 0;
  for (const p of predicted) {
    const gi = gold.findIndex((g, i) => !usedGold.has(i) && matchFn(p, g));
    if (gi >= 0) { tp++; usedGold.add(gi); }
  }
  const fp = predicted.length - tp;
  const fn = gold.length - tp;
  const precision = predicted.length ? tp / predicted.length : (gold.length ? 0 : 1);
  const recall = gold.length ? tp / gold.length : 1;
  const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision, recall, f1 };
}

// Verdict spectrum, ordered by how well the claim (as written) is borne out by
// the reference — see datasets/LABELING-GUIDE.md. Used for exact accuracy and
// "off-by-one" adjacency accuracy.
export const VERDICT_SCALE = [
  'strong_support',
  'partial_support',
  'implied_by_data',
  'overclaim',
  'not_supported',
  'contradicted',
];

export function verdictAccuracy(pairs) {
  // pairs: [{ predicted, gold }]
  let exact = 0, adjacent = 0;
  for (const { predicted, gold } of pairs) {
    if (predicted === gold) { exact++; adjacent++; continue; }
    const pi = VERDICT_SCALE.indexOf(predicted);
    const gi = VERDICT_SCALE.indexOf(gold);
    if (pi >= 0 && gi >= 0 && Math.abs(pi - gi) === 1) adjacent++;
  }
  const n = pairs.length || 1;
  return { n: pairs.length, exact: exact / n, adjacent: adjacent / n };
}

export function confusionMatrix(pairs, labels = VERDICT_SCALE) {
  const idx = Object.fromEntries(labels.map((l, i) => [l, i]));
  const m = labels.map(() => labels.map(() => 0));
  for (const { predicted, gold } of pairs) {
    if (idx[gold] != null && idx[predicted] != null) m[idx[gold]][idx[predicted]]++;
  }
  return { labels, matrix: m };
}

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

/** Normalise claim text for fuzzy matching (lowercase, alnum-only). */
export function normText(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Fuzzy claim match: containment either direction after normalisation. */
export function claimMatch(a, b) {
  const x = normText(a), y = normText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // Require the shorter to be a substantial substring of the longer.
  return short.length >= 12 && long.includes(short);
}
