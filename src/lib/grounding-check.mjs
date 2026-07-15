// Pure grounding check — the shared core behind the grounding scorer and the
// MCP server. Given an answer, the context it should be grounded in, and
// (optionally) the facts a correct answer must contain, it reports whether the
// answer is grounded: are the required facts present, is every number traceable
// to the context, and — for unanswerable questions — did the system abstain?
//
// Deterministic, no LLM judge. This is the single source of truth; if the check
// changes, both the scorer and the MCP tool change with it.

export const DEFAULT_ABSTAIN = [
  'not in the provided context', 'not in the context', 'no information',
  "don't know", 'do not know', 'cannot answer', "can't answer",
  'unable to answer', 'not enough information', 'not stated', 'not mentioned',
  'no answer', 'not available', 'insufficient information', 'not specified',
  'not provided',
  // Active-voice forms. Systems abstain far more often with "the context does
  // not state the price" than with "the price is not stated", and matching only
  // the passive form scored a correct abstention as a fabrication.
  // (normNeg() expands "doesn't" → "does not", so contractions are covered.)
  'does not state', 'does not specify', 'does not say', 'does not mention',
  'does not provide', 'does not contain', 'does not include', 'no mention',
];

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ');
// Expand negating contractions so "isn't in the context" matches a marker
// phrased with "not" — abstention phrasing varies.
const normNeg = (s) => norm(s).replace(/n['’]t\b/g, ' not').replace(/\s+/g, ' ');

/** Context may be a string or an array of passages. */
export const flattenContext = (v) => (Array.isArray(v) ? v.join('\n') : String(v ?? ''));

/** Whitespace-tolerant, case-insensitive containment. */
export function contains(haystack, needle) {
  const h = norm(haystack).replace(/\s/g, '');
  const n = norm(needle).replace(/\s/g, '');
  return n.length > 0 && h.includes(n);
}

const NUM_RE = /\d+(?:\.\d+)?/g;
export const numbersIn = (s) => new Set((String(s).match(NUM_RE) || []).map(n => n.replace(/^0+(?=\d)/, '')));

/**
 * @param {object} input
 *   answer            (string, required) the system's answer
 *   context           (string | string[], required) the retrieved context
 *   question          (string, optional) used to whitelist numbers from the question
 *   anchors           ([{ value, aliases? }], optional) facts a correct answer must contain
 *   allowedNewNumbers ([string|number], optional) numbers the answer may introduce
 *   answerable        (boolean, default true) when false, the answer must abstain
 *   abstainMarkers    (string[], optional) phrases that count as a valid refusal
 * @returns {{ grounded, anchorsMissed, ungroundedNumbers, abstained, issues }}
 */
export function checkGrounding(input) {
  const answer = String(input.answer ?? '');
  const context = flattenContext(input.context);
  const anchors = input.anchors || [];
  const issues = [];

  if (input.answerable === false) {
    const markers = input.abstainMarkers || DEFAULT_ABSTAIN;
    const outNeg = normNeg(answer);
    const abstained = markers.some(m => outNeg.includes(normNeg(m)));
    if (!abstained) issues.push('unanswerable question — the answer did not abstain (risk of fabrication)');
    return { grounded: issues.length === 0, anchorsMissed: [], ungroundedNumbers: [], abstained, issues };
  }

  const anchorsMissed = anchors
    .filter(a => ![a.value, ...(a.aliases || [])].some(v => contains(answer, v)))
    .map(a => a.value);
  for (const v of anchorsMissed) issues.push(`missing answer fact "${v}"`);

  const legit = new Set([
    ...numbersIn(context),
    ...numbersIn(input.question || ''),
    ...anchors.flatMap(a => [...numbersIn(a.value), ...(a.aliases || []).flatMap(x => [...numbersIn(x)])]),
    ...(input.allowedNewNumbers || []).map(String),
  ]);
  const ungroundedNumbers = [...numbersIn(answer)].filter(n => !legit.has(n));
  for (const n of ungroundedNumbers) issues.push(`ungrounded number "${n}" — not in the provided context`);

  return { grounded: issues.length === 0, anchorsMissed, ungroundedNumbers, abstained: false, issues };
}
