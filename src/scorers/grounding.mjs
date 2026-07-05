// ONLINE scorer — answer grounding (generic RAG / document QA / legal AI).
//
// The turnkey path for evidence-grounded AI that isn't RefCheckr-shaped: no
// six-point verdict scale, no citation mapping. Given a question and the
// retrieved context, the system produces an answer; the scorer measures the
// two failures that matter for grounded QA, deterministically against gold —
//
//   • answer-anchor recall (gate) — the facts a correct answer must contain
//     (from the context) actually appear. Catches wrong or incomplete answers.
//   • grounding / no fabrication (gate) — every number in the answer traces to
//     the context, the question, an anchor, or the case's allowedNewNumbers.
//     An invented figure absent from the retrieved context is a hallucination.
//   • abstention (gate, when answerable:false) — if the context does not
//     contain the answer, the system must decline rather than fabricate.
//
// This is gold-anchored and LLM-judge-free by design: OpenGATE measures whether
// an answer can be justified from its evidence, not whether it sounds plausible.
//
// Case schema (datasets/SCHEMA.md):
//   { "id", "kind": "grounding", "question", "context": "…" | ["…","…"],
//     "answerAnchors": [{ "value", "aliases": [] }],   // omit when answerable:false
//     "allowedNewNumbers": ["95"],
//     "answerable": true,                               // false → must abstain
//     "abstainMarkers": ["not in the provided context"] // optional override }

import { mean } from '../lib/metrics.mjs';

export const meta = { id: 'grounding', mode: 'online' };

const DEFAULT_ABSTAIN = [
  'not in the provided context', 'not in the context', 'no information',
  "don't know", 'do not know', 'cannot answer', "can't answer",
  'unable to answer', 'not enough information', 'not stated', 'not mentioned',
  'no answer', 'not available', 'insufficient information',
];

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ');
// Expand negating contractions so "isn't in the context" matches a marker
// phrased with "not" — abstention phrasing varies, and this closes the most
// common gap without a brittle marker per contraction.
const normNeg = (s) => norm(s).replace(/n['’]t\b/g, ' not').replace(/\s+/g, ' ');
const flat = (v) => (Array.isArray(v) ? v.join('\n') : String(v ?? ''));
function contains(haystack, needle) {
  const h = norm(haystack).replace(/\s/g, '');
  const n = norm(needle).replace(/\s/g, '');
  return n.length > 0 && h.includes(n);
}
const NUM_RE = /\d+(?:\.\d+)?/g;
const numbersIn = (s) => new Set((String(s).match(NUM_RE) || []).map(n => n.replace(/^0+(?=\d)/, '')));

export async function run({ cases, adapter }) {
  if (!adapter.capabilities.grounding) {
    return { meta, skipped: true, reason: `adapter "${adapter.name}" has no grounding capability` };
  }
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }
  const goldCases = cases.filter(c => c.kind === 'grounding' && c.question != null);
  if (goldCases.length === 0) {
    return { meta, skipped: true, reason: 'No cases of kind "grounding" with a question.' };
  }

  adapter.resetTiming();

  const perCase = [];
  const failures = [];

  for (const c of goldCases) {
    const context = flat(c.context);
    let out;
    try {
      const res = await adapter.answer({ question: c.question, context });
      out = res?.text ?? res?.answer ?? '';
    } catch (err) {
      failures.push(`case ${c.id}: ${err.message}`);
      continue;
    }

    const caseFailures = [];

    if (c.answerable === false) {
      // Must decline, not fabricate.
      const markers = c.abstainMarkers || DEFAULT_ABSTAIN;
      const outNeg = normNeg(out);
      const abstained = markers.some(m => outNeg.includes(normNeg(m)));
      if (!abstained) caseFailures.push('unanswerable case — system did not abstain (risk of fabrication)');
    } else {
      // Answer-anchor recall.
      const missed = (c.answerAnchors || []).filter(a =>
        ![a.value, ...(a.aliases || [])].some(v => contains(out, v)));
      for (const a of missed) caseFailures.push(`missing answer fact "${a.value}"`);

      // Grounding: numbers in the answer must be legitimate.
      const legit = new Set([
        ...numbersIn(context),
        ...numbersIn(c.question),
        ...(c.answerAnchors || []).flatMap(a => [...numbersIn(a.value), ...(a.aliases || []).flatMap(x => [...numbersIn(x)])]),
        ...(c.allowedNewNumbers || []).map(String),
      ]);
      const fabricated = [...numbersIn(out)].filter(n => !legit.has(n));
      for (const n of fabricated) caseFailures.push(`ungrounded number "${n}" — not in the retrieved context`);
    }

    for (const cf of caseFailures) failures.push(`GROUNDING ${c.id}: ${cf}`);
    perCase.push({
      case: c.id,
      answerable: c.answerable !== false,
      anchors: (c.answerAnchors || []).length,
      problems: caseFailures,
      outputChars: out.length,
    });
  }

  const answerable = perCase.filter(p => p.answerable);
  const totalAnchors = answerable.reduce((a, p) => a + p.anchors, 0);
  const anchorFails = failures.filter(f => /missing answer fact/.test(f)).length;
  const fabFails = failures.filter(f => /ungrounded number/.test(f)).length;
  const abstainCases = perCase.filter(p => !p.answerable);
  const abstainFails = failures.filter(f => /did not abstain/.test(f)).length;
  const latencies = adapter.callLatencies();

  const metrics = {
    n_cases: perCase.length,
    n_answerable: answerable.length,
    answer_recall: round(totalAnchors ? 1 - anchorFails / totalAnchors : (answerable.length ? 1 : 0)),
    ungrounded_numbers: fabFails,
    ...(abstainCases.length ? { abstention_rate: round(1 - abstainFails / abstainCases.length) } : {}),
    ...(latencies.length ? { latency_p50_ms: Math.round(percentileOf(latencies, 50)) } : {}),
    ...(adapter.runModel() ? { run_model: adapter.runModel() } : {}),
  };

  return { meta, metrics, detail: { perCase }, failures, passed: failures.length === 0 };
}

function percentileOf(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  return xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0;
}
function round(x) { return Math.round(x * 1000) / 1000; }
