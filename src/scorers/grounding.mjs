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
import { checkGrounding, flattenContext } from '../lib/grounding-check.mjs';

export const meta = { id: 'grounding', mode: 'online' };

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
    const context = flattenContext(c.context);
    let out;
    try {
      const res = await adapter.answer({ question: c.question, context });
      out = res?.text ?? res?.answer ?? '';
    } catch (err) {
      failures.push(`case ${c.id}: ${err.message}`);
      continue;
    }

    // Shared, deterministic check (same core as the MCP server).
    const chk = checkGrounding({
      answer: out, context, question: c.question,
      anchors: c.answerAnchors, allowedNewNumbers: c.allowedNewNumbers,
      answerable: c.answerable, abstainMarkers: c.abstainMarkers,
    });
    const caseFailures = chk.issues;
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
