// ONLINE scorer — simplification faithfulness.
//
// Exercises the adapter's simplify() capability against gold cases of kind
// "simplification": a source clinical text plus the facts that must survive
// simplification. Simplified text is paraphrase BY DESIGN, so verbatim checks
// on prose are meaningless — instead the scorer measures what is
// deterministically checkable and clinically dangerous to get wrong:
//
//   • anchor recall (gate) — critical facts (drug names, doses, key values)
//     must appear in the output, matched case-insensitively with per-anchor
//     aliases ("5 mg" ≈ "5mg"). A dropped dose is the failure that matters.
//   • fabricated numbers (gate) — every number in the output must exist in
//     the source, an anchor/alias, or the case's allowedNewNumbers list.
//     An invented value in patient-facing text is the worst failure there is.
//   • length contract (gate, when the case specifies) — e.g. Patiently's
//     Brief mode: ≤3 bullets, ≤20 words per bullet. Contract drift here
//     previously hid silent prompt-fallback bugs.
//   • readability (info) — Flesch-Kincaid grade of the output; reported,
//     not gated, in v1.
//
// The check itself lives in ../lib/simplification-check.mjs (pure, shared), so
// the same code scores live adapter output and frozen outputs replayed offline
// (paper/exp2).
//
// Case schema (datasets/SCHEMA.md):
//   { "id", "kind": "simplification", "text", "audience", "tone", "length",
//     "anchors": [{ "value", "aliases": [] }],
//     "allowedNewNumbers": ["2"], "maxBullets": 3, "maxWordsPerBullet": 20 }

import { mean } from '../lib/metrics.mjs';
import { checkSimplification } from '../lib/simplification-check.mjs';

export const meta = { id: 'simplification', mode: 'online' };

export async function run({ cases, adapter }) {
  if (!adapter.capabilities.simplify) {
    return { meta, skipped: true, reason: `adapter "${adapter.name}" has no simplify capability` };
  }
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }
  const goldCases = cases.filter(c => c.kind === 'simplification' && (c.anchors || []).length);
  if (goldCases.length === 0) {
    return { meta, skipped: true, reason: 'No cases of kind "simplification" with anchors.' };
  }

  adapter.resetTiming();

  const perCase = [];
  const failures = [];

  for (const c of goldCases) {
    let out;
    try {
      const res = await adapter.simplify({
        text: c.text, audience: c.audience, tone: c.tone, length: c.length, language: c.language,
      });
      out = res.text ?? '';
    } catch (err) {
      failures.push(`case ${c.id}: ${err.message}`);
      continue;
    }

    // Shared, deterministic check — the same core the exp-2 replay harness runs
    // over frozen outputs.
    const chk = checkSimplification({
      output: out,
      text: c.text,
      anchors: c.anchors,
      allowedNewNumbers: c.allowedNewNumbers,
      maxBullets: c.maxBullets,
      maxWordsPerBullet: c.maxWordsPerBullet,
    });

    for (const a of chk.anchorsMissed) {
      failures.push(`DROPPED FACT in ${c.id}: anchor "${a}" absent from simplified output`);
    }
    for (const n of chk.fabricated) {
      failures.push(`FABRICATED NUMBER in ${c.id}: "${n}" appears in output but not in source`);
    }
    for (const v of chk.contractViolations) failures.push(`CONTRACT in ${c.id}: ${v}`);

    perCase.push({
      case: c.id,
      anchors: (c.anchors || []).length,
      anchorsMissed: chk.anchorsMissed,
      fabricated: chk.fabricated,
      contractViolations: chk.contractViolations,
      grade: round(chk.grade ?? -1),
      outputChars: out.length,
      bullets: chk.bullets,
      // The output itself, so a dropped-fact failure can be diagnosed from the
      // snapshot (was it omitted, reworded past the aliases, or replaced?).
      output: out.slice(0, 600),
    });
  }

  const totalAnchors = perCase.reduce((a, p) => a + p.anchors, 0);
  const totalMissed = perCase.reduce((a, p) => a + p.anchorsMissed.length, 0);
  const latencies = adapter.callLatencies();

  const metrics = {
    n_cases: perCase.length,
    n_anchors: totalAnchors,
    anchor_recall: round(totalAnchors ? 1 - totalMissed / totalAnchors : 0),
    dropped_facts: totalMissed,
    fabricated_numbers: perCase.reduce((a, p) => a + p.fabricated.length, 0),
    contract_violations: perCase.reduce((a, p) => a + p.contractViolations.length, 0),
    mean_grade: round(mean(perCase.map(p => p.grade).filter(g => g >= 0))),
    ...(latencies.length ? { latency_p50_ms: Math.round(percentileOf(latencies, 50)) } : {}),
    ...(adapter.runModel() ? { run_model: adapter.runModel() } : {}),
  };

  return { meta, metrics, detail: { perCase }, failures, passed: failures.length === 0 };
}

function percentileOf(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  return xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0;
}
function round(x) { return Math.round(x * 100) / 100; }
