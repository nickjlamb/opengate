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
// Case schema (datasets/SCHEMA.md):
//   { "id", "kind": "simplification", "text", "audience", "tone", "length",
//     "anchors": [{ "value", "aliases": [] }],
//     "allowedNewNumbers": ["2"], "maxBullets": 3, "maxWordsPerBullet": 20 }

import { mean } from '../lib/metrics.mjs';

export const meta = { id: 'simplification', mode: 'online' };

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ');
/** Whitespace-tolerant, case-insensitive containment. */
function contains(haystack, needle) {
  const h = norm(haystack).replace(/\s/g, '');
  const n = norm(needle).replace(/\s/g, '');
  return n.length > 0 && h.includes(n);
}

const NUM_RE = /\d+(?:\.\d+)?/g;
const numbersIn = (s) => new Set((String(s).match(NUM_RE) || []).map(n => n.replace(/^0+(?=\d)/, '')));

/** Lines that look like bullets: -, •, *, or "1." style. */
function bulletLines(text) {
  return String(text).split(/\r?\n/).map(l => l.trim())
    .filter(l => /^([-•*]|\d+[.)])\s+/.test(l));
}

// Flesch-Kincaid grade with a vowel-group syllable heuristic. Approximate,
// which is why readability is reported rather than gated.
function fleschKincaidGrade(text) {
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

    // Anchor recall: value or any alias must survive.
    const missed = (c.anchors || []).filter(a =>
      ![a.value, ...(a.aliases || [])].some(v => contains(out, v)));
    for (const a of missed) {
      failures.push(`DROPPED FACT in ${c.id}: anchor "${a.value}" absent from simplified output`);
    }

    // Fabricated numbers: output numbers must come from somewhere legitimate.
    const legitimate = new Set([
      ...numbersIn(c.text),
      ...(c.anchors || []).flatMap(a => [...numbersIn(a.value), ...(a.aliases || []).flatMap(x => [...numbersIn(x)])]),
      ...(c.allowedNewNumbers || []).map(String),
    ]);
    const fabricated = [...numbersIn(out)].filter(n => !legitimate.has(n));
    for (const n of fabricated) {
      failures.push(`FABRICATED NUMBER in ${c.id}: "${n}" appears in output but not in source`);
    }

    // Length contract (only when the case declares one).
    const bullets = bulletLines(out);
    const contractViolations = [];
    if (c.maxBullets != null && bullets.length > c.maxBullets) {
      contractViolations.push(`${bullets.length} bullets > max ${c.maxBullets}`);
    }
    if (c.maxWordsPerBullet != null) {
      for (const b of bullets) {
        const words = b.replace(/^([-•*]|\d+[.)])\s+/, '').split(/\s+/).filter(Boolean).length;
        if (words > c.maxWordsPerBullet) contractViolations.push(`bullet has ${words} words > max ${c.maxWordsPerBullet}`);
      }
    }
    if (c.maxBullets != null && bullets.length === 0) {
      contractViolations.push('bullet output expected, none found');
    }
    for (const v of contractViolations) failures.push(`CONTRACT in ${c.id}: ${v}`);

    perCase.push({
      case: c.id,
      anchors: (c.anchors || []).length,
      anchorsMissed: missed.map(a => a.value),
      fabricated,
      contractViolations,
      grade: round(fleschKincaidGrade(out) ?? -1),
      outputChars: out.length,
      bullets: bullets.length,
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
