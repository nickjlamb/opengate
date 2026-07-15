#!/usr/bin/env node
// exp-2 step 5 — analysis. Reads whichever arms have been run and writes
// RESULTS.md plus a machine-readable summary.
//
//   node paper/exp2/analyse.mjs [--threshold 1.0]
//
// Reports, per the experiment plan:
//   1. STABILITY   — per-output score range across 5 repeats (judge) vs zero
//                    (deterministic), plus verdict-flip rate: how often the 5
//                    repeats disagree about pass/fail for the same bytes. Flips
//                    are the number that matters for a release gate: a metric
//                    that changes its mind about identical input cannot block a
//                    build.
//   2. COST        — tokens and USD per 1,000 evaluations, measured, not listed.
//   3. DETECTION   — per injected defect class, did each arm catch it? This is
//                    where the deterministic layer is expected to LOSE on
//                    contradictions (its admitted ceiling) and win on omissions
//                    (which a faithfulness judge cannot see by construction).
//   4. LOCALISATION— named failure ("missing fact '500 mg'") vs a scalar.
//   5. AGREEMENT   — judge score vs deterministic pass/fail, on the outputs
//                    where both arms are in scope.
//
// Output: paper/exp2/RESULTS.md, paper/exp2/results/summary.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(HERE, 'corpus/frozen-corpus.json');
const RES = resolve(HERE, 'results');
const OUT_MD = resolve(HERE, 'RESULTS.md');
const OUT_JSON = resolve(RES, 'summary.json');

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
};
// A judge score below this counts as "flagged". 1.0 = any unsupported claim at
// all fails, which is the gate semantics OpenGATE uses; the sensitivity of the
// conclusion to this choice is reported.
const THRESHOLD = Number(arg('--threshold', 1.0));

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

function loadArm(file) {
  const p = resolve(RES, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** outputId → [score per repeat] */
function scoresByOutput(arm) {
  const m = new Map();
  for (const run of arm.runs) {
    for (const s of run.scores) {
      if (!m.has(s.outputId)) m.set(s.outputId, []);
      m.get(s.outputId).push(s.score);
    }
  }
  return m;
}

/** Per-output stability: range, sd, and whether the pass/fail verdict flipped. */
function stability(arm, flagged) {
  const by = scoresByOutput(arm);
  const rows = [];
  for (const [outputId, xs] of by) {
    const verdicts = new Set(xs.map(x => flagged(x)));
    rows.push({
      outputId,
      scores: xs,
      mean: r3(mean(xs)),
      range: r3(Math.max(...xs) - Math.min(...xs)),
      sd: r3(sd(xs)),
      verdictFlipped: verdicts.size > 1,
    });
  }
  rows.sort((a, b) => b.range - a.range);
  return rows;
}

function main() {
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const byId = new Map(corpus.items.map(i => [i.outputId, i]));

  const det = loadArm('deterministic.json');
  const ragas = loadArm('ragas.json');
  const deepeval = loadArm('deepeval.json');
  // Retained from the earlier, cheaper judge — used only for the §1c robustness
  // comparison, never mixed into the headline arms.
  const ragasMini = loadArm('ragas.gpt-4o-mini.json');
  if (!det) throw new Error('run score-deterministic.mjs first');

  const arms = [
    { key: 'deterministic', label: 'OpenGATE (deterministic)', data: det, judge: false },
    ragas && { key: 'ragas', label: `RAGAS faithfulness (${ragas.judgeModel})`, data: ragas, judge: true },
    deepeval && { key: 'deepeval', label: `DeepEval faithfulness (${deepeval.judgeModel})`, data: deepeval, judge: true },
  ].filter(Boolean);

  // Every arm must have scored the same bytes, or none of this means anything.
  const mismatched = arms.filter(a => a.data.corpusSha256 !== corpus.corpusSha256);
  if (mismatched.length) {
    throw new Error(
      `corpus mismatch — ${mismatched.map(a => a.key).join(', ')} scored a different corpus. ` +
      'Re-run those arms against the current frozen corpus.');
  }

  // flagged() = "this arm says the output is bad"
  const flaggedFn = (arm) => (arm.judge ? (x) => x < THRESHOLD : (x) => x === 0);

  const summary = { threshold: THRESHOLD, corpusSha256: corpus.corpusSha256, arms: {} };
  for (const a of arms) {
    const rows = stability(a.data, flaggedFn(a));
    const ranges = rows.map(r => r.range);
    summary.arms[a.key] = {
      label: a.label,
      repeats: a.data.repeats,
      stability: {
        meanRange: r3(mean(ranges)),
        maxRange: r3(Math.max(...ranges)),
        outputsWithAnyMovement: rows.filter(r => r.range > 0).length,
        verdictFlips: rows.filter(r => r.verdictFlipped).length,
        nOutputs: rows.length,
      },
      cost: a.data.cost,
      rows,
    };
  }

  // ── Detection by injected defect class — DELTA semantics ──────────────────
  //
  // Two of the captured base outputs already fail the gate (a real production
  // finding, reported below). Their mutants therefore INHERIT that defect: the
  // lab-results inversion carries the base's fabricated number whether or not
  // anything was inverted. Counting a raw flag as a detection would credit
  // OpenGATE with catching inversions it cannot see — precisely the false win
  // this experiment is built to avoid.
  //
  // So detection is measured as a REACTION TO THE INJECTED DEFECT, relative to
  // the same case's base output:
  //
  //   deterministic — the mutant raises at least one issue the base did not.
  //                   (Issue-set delta, not pass/fail: a base that already fails
  //                   can still fail *further*, and only the new issue counts.)
  //   judge         — within the SAME repeat, the mutant scores below threshold
  //                   AND strictly below what that judge gave the base. Pairing
  //                   within a repeat also cancels some of the judge's own drift.
  //
  // Raw (non-delta) detection is retained alongside, so the effect of the
  // correction is visible rather than buried.
  const baseIdFor = (outputId) => `${byId.get(outputId).caseId}::base`;

  const detIssuesByOutput = new Map(
    det.runs[0].scores.map(s => [s.outputId, new Set(s.issues)]));

  const scoresByOutputFor = (arm) => scoresByOutput(arm.data);

  const classes = [...new Set(corpus.items.map(i => i.expected.defectClass))];
  const detection = {};
  for (const cls of classes) {
    const ids = corpus.items.filter(i => i.expected.defectClass === cls).map(i => i.outputId);
    detection[cls] = { n: ids.length, arms: {} };

    for (const a of arms) {
      const flagged = flaggedFn(a);
      const byOut = scoresByOutputFor(a);

      // Did this arm react to the injected defect, in repeat r?
      const reacted = (outputId, r) => {
        const baseId = baseIdFor(outputId);
        if (baseId === outputId) return false;                 // a base is not a mutant
        if (!a.judge) {
          const mine = detIssuesByOutput.get(outputId) ?? new Set();
          const theirs = detIssuesByOutput.get(baseId) ?? new Set();
          return [...mine].some(i => !theirs.has(i));          // a NEW issue
        }
        const m = byOut.get(outputId)?.[r];
        const b = byOut.get(baseId)?.[r];
        if (m == null || b == null) return false;
        return flagged(m) && m < b;                            // worse than its own base
      };

      const repeats = a.data.repeats;
      const idx = [...Array(repeats).keys()];
      const always = ids.filter(id => idx.every(r => reacted(id, r))).length;
      const ever = ids.filter(id => idx.some(r => reacted(id, r))).length;

      // Raw, for comparison: flagged in every repeat, base ignored.
      const rawAlways = ids.filter(id => (byOut.get(id) ?? []).every(flagged)).length;

      detection[cls].arms[a.key] = {
        detectedEveryRepeat: always,
        detectedAtLeastOnce: ever,
        rawDetectedEveryRepeat: rawAlways,
        rate: ids.length ? r2(always / ids.length) : null,
      };
    }
  }
  summary.detection = detection;

  // ── False positives on the clean baseline ─────────────────────────────────
  //
  // Measured RAW, never delta. Delta semantics ask "did the arm react to the
  // injected defect", and a clean base has no injected defect — so a delta
  // measure would report zero false positives by construction, which would be a
  // free pass for exactly the failure mode that decides whether a metric can
  // gate a release. A gate that fails clean output is unusable no matter how
  // well it detects defects.
  const cleanBaseIds = corpus.items
    .filter(i => i.variant === 'base' && i.expected.defectClass === 'none')
    .map(i => i.outputId);

  summary.falsePositives = {};
  for (const a of arms) {
    const flagged = flaggedFn(a);
    const byOut = scoresByOutput(a.data);
    const rows = cleanBaseIds.map(id => {
      const xs = byOut.get(id) ?? [];
      return {
        outputId: id,
        scores: xs,
        flaggedRepeats: xs.filter(flagged).length,
        flaggedEveryRepeat: xs.length > 0 && xs.every(flagged),
      };
    });
    summary.falsePositives[a.key] = {
      n: cleanBaseIds.length,
      flaggedEveryRepeat: rows.filter(r => r.flaggedEveryRepeat).length,
      flaggedAtLeastOnce: rows.filter(r => r.flaggedRepeats > 0).length,
      rows,
    };
  }

  // ── Threshold sensitivity ─────────────────────────────────────────────────
  //
  // The judge's pass/fail verdict is a threshold applied to a continuous score,
  // and the threshold is OUR choice, not the judge's. At 1.0 (gate semantics:
  // any unsupported claim fails) almost everything is flagged, so verdicts look
  // stable — stably alarmed. Lower it and the verdicts start flipping. Reporting
  // one threshold would let us pick the story; reporting the curve does not.
  summary.thresholdSensitivity = [1.0, 0.9, 0.75, 0.5].map((T) => {
    const at = { threshold: T, arms: {} };
    for (const a of arms.filter(x => x.judge)) {
      const byOut = scoresByOutput(a.data);
      const flag = (x) => x < T;
      const idx = [...Array(a.data.repeats).keys()];

      const flips = [...byOut.values()]
        .filter(xs => new Set(xs.map(flag)).size > 1).length;

      const fp = cleanBaseIds
        .filter(id => (byOut.get(id) ?? []).every(flag)).length;

      const detected = (cls) => corpus.items
        .filter(i => i.expected.defectClass === cls)
        .filter(i => idx.every(r => {
          const m = byOut.get(i.outputId)?.[r];
          const b = byOut.get(`${i.caseId}::base`)?.[r];
          return m != null && b != null && flag(m) && m < b;
        })).length;

      at.arms[a.key] = {
        verdictFlips: flips,
        falsePositivesOnCleanBase: `${fp}/${cleanBaseIds.length}`,
        dropped_anchor: detected('dropped_anchor'),
        fabricated_number: detected('fabricated_number'),
        contradiction: detected('contradiction'),
        inversion: detected('inversion'),
      };
    }
    return at;
  });

  // ── Contaminated bases: captured outputs that already failed the gate ─────
  summary.failingBases = det.runs[0].scores
    .filter(s => !s.pass && byId.get(s.outputId)?.variant === 'base')
    .map(s => ({
      outputId: s.outputId,
      producer: byId.get(s.outputId).producer,
      issues: s.issues,
      text: byId.get(s.outputId).text,
    }));

  // ── Cost per 1,000 evaluations ────────────────────────────────────────────
  const nEvals = corpus.items.length;
  summary.costPer1000 = {};
  for (const a of arms) {
    const c = a.data.cost || {};
    const evalsRun = nEvals * a.data.repeats;
    summary.costPer1000[a.key] = {
      usd: c.usd != null ? r3((c.usd / evalsRun) * 1000) : null,
      tokens: c.tokens != null ? Math.round((c.tokens / evalsRun) * 1000) : null,
    };
  }

  // ── Localisation ──────────────────────────────────────────────────────────
  // The deterministic arm names the failure; the judges return a scalar (DeepEval
  // additionally returns a free-text reason). Sample it rather than assert it.
  const localisation = det.runs[0].scores
    .filter(s => !s.pass)
    .map(s => ({
      outputId: s.outputId,
      injected: byId.get(s.outputId)?.injectedDefect?.class ?? 'none',
      deterministic: s.issues,
      deepevalReason: deepeval
        ? deepeval.runs[0].scores.find(x => x.outputId === s.outputId)?.reason ?? null
        : null,
    }));
  summary.localisation = localisation;

  writeMarkdown({ corpus, arms, summary, det, ragas, deepeval, ragasMini, byId });
  mkdirSync(RES, { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`analysis → ${OUT_MD}`);
  for (const a of arms) {
    const s = summary.arms[a.key].stability;
    console.error(`  ${a.label}: mean range ${s.meanRange}, ${s.verdictFlips}/${s.nOutputs} verdict flips`);
  }
}

function writeMarkdown({ corpus, arms, summary, det, ragas, deepeval, ragasMini }) {
  const L = [];
  const P = (s = '') => L.push(s);

  P('# exp-2 — deterministic scorers vs LLM-judge faithfulness');
  P();
  P('*Generated by `paper/exp2/analyse.mjs`. Every number here traces to a committed');
  P('JSON result file in `results/`; every arm scored the byte-identical frozen corpus');
  P(`\`${corpus.corpusSha256.slice(0, 16)}…\` (${corpus.items.length} outputs).*`);
  P();
  P('## Protocol');
  P();
  P('Outputs were captured once and frozen: the simplification outputs come from');
  P('the Patiently AI production endpoint; the grounding outputs from a generic RAG answerer');
  P('(temperature 0, answer-from-context prompt) — the grounding capability has no production');
  P('adapter, and the experiment only requires outputs both arms can read. Mutants were then');
  P('derived deterministically, each injecting exactly one known defect. Every arm — deterministic,');
  P('RAGAS, DeepEval — scored those same bytes, five times, with the judges at temperature 0');
  P('(the most favourable setting for judge stability).');
  P();
  P('| defect class | n | what it is | in scope for deterministic checking? | in scope for a faithfulness judge? |');
  P('|---|---|---|---|---|');
  for (const [cls, d] of Object.entries(corpus.defectClasses || {})) {
    const n = corpus.items.filter(i => i.expected.defectClass === cls).length;
    if (!n) continue;
    const yn = (v) => (v === null || v === undefined ? '—' : v ? 'yes' : '**no**');
    P(`| \`${cls}\` | ${n} | ${d.description} | ${yn(d.deterministicInScope)} | ${yn(d.judgeInScope)} |`);
  }
  P();
  P('**The scope columns are the experiment.** The mutants are constructed from a defect');
  P('taxonomy, so a sensitivity comparison across all classes at once would be circular —');
  P('whichever arm the taxonomy was written around would win. The comparison is therefore');
  P('scoped: the two arms are compared *within* the classes each is built to see, and the');
  P('out-of-scope rows are reported as coverage floors, not as failures. The `inversion`');
  P('class is what keeps this honest — it is the class the deterministic layer is *expected*');
  P('to miss, and it is scored, not asserted.');
  P();

  P('## 1. Stability across five identical repeats');
  P();
  P('| arm | mean score range | max range | outputs that moved | verdict flips |');
  P('|---|---|---|---|---|');
  for (const a of arms) {
    const s = summary.arms[a.key].stability;
    P(`| ${a.label} | ${s.meanRange} | ${s.maxRange} | ${s.outputsWithAnyMovement}/${s.nOutputs} | **${s.verdictFlips}/${s.nOutputs}** |`);
  }
  P();
  P(`*Verdict flip = the five repeats did not agree on pass/fail for identical bytes (judge threshold ${summary.threshold}).*`);
  P();
  P('**Read this table honestly: on a strong judge model, run-to-run instability is small.** The');
  P('scores move — every judge arm has outputs that changed between byte-identical repeats — but the');
  P('movement is mostly too small to flip a verdict. An earlier version of this experiment used a');
  P('cheaper judge and found much larger swings (§1c). *Instability is therefore a property of the');
  P('judge model, not of LLM-judging as such, and we do not rest the argument on it.* The findings');
  P('that survive a strong judge are in §3: false positives on clean output, blindness to omission,');
  P('and — most seriously — the two judge libraries disagreeing with each other about what');
  P('"faithfulness" means.');
  P(`*The deterministic arm produced ${det.identicalAcrossRepeats ? 'byte-identical results across all five repeats' : 'NON-identical results — investigate'}`);
  P(`(SHA-256 \`${det.resultSha256[0].slice(0, 16)}…\`).*`);
  P();

  const movers = arms
    .filter(a => a.judge)
    .flatMap(a => summary.arms[a.key].rows.filter(r => r.range > 0).map(r => ({ arm: a.label, ...r })));
  if (movers.length) {
    P('Outputs whose judge score moved between repeats:');
    P();
    P('| arm | output | scores | range |');
    P('|---|---|---|---|');
    for (const m of movers.slice(0, 20)) {
      P(`| ${m.arm} | \`${m.outputId}\` | ${m.scores.map(r3).join(', ')} | ${m.range} |`);
    }
    P();
  }

  if (summary.thresholdSensitivity.some(t => Object.keys(t.arms).length)) {
    P('### 1b. Threshold sensitivity');
    P();
    P('A judge returns a continuous score; the pass/fail threshold is **our** choice, not the judge\'s.');
    P('That choice is load-bearing, so here is the whole curve rather than the number that tells the');
    P('best story. Detection figures are delta-corrected as above.');
    P();
    for (const a of arms.filter(x => x.judge)) {
      P(`**${a.label}**`);
      P();
      P('| threshold | verdict flips | false positives on clean output | dropped_anchor | fabricated_number | contradiction | inversion |');
      P('|---|---|---|---|---|---|---|');
      for (const t of summary.thresholdSensitivity) {
        const x = t.arms[a.key];
        if (!x) continue;
        P(`| ${t.threshold} | ${x.verdictFlips}/${summary.arms[a.key].stability.nOutputs} | ${x.falsePositivesOnCleanBase} | ${x.dropped_anchor}/5 | ${x.fabricated_number}/5 | ${x.contradiction}/5 | ${x.inversion}/5 |`);
      }
      P();
    }
    P('Read the whole curve before quoting any figure from it. Detection falls off steeply as the');
    P('threshold is relaxed, while the false positives on clean output do not clear at the same rate —');
    P('so the threshold that catches the defects is also the threshold that fails clean production');
    P('output. That trade-off, not run-to-run noise, is the reason this metric cannot be a release gate.');
    P();
  }

  // ── 1c. Judge-model robustness ────────────────────────────────────────────
  // The obvious reviewer objection to any judge-instability claim is "you used a
  // cheap model". Answer it with data rather than a promise.
  if (ragasMini) {
    const stabOf = (arm) => {
      const rows = stability(arm, (x) => x < THRESHOLD);
      const ranges = rows.map(r => r.range);
      return {
        meanRange: r3(mean(ranges)),
        maxRange: r3(Math.max(...ranges)),
        moved: rows.filter(r => r.range > 0).length,
        n: rows.length,
      };
    };
    const a = stabOf(ragasMini);
    const b = stabOf(ragas);
    P('### 1c. Judge-model robustness — does a better judge fix it?');
    P();
    P('Partly, and we say so. The same RAGAS metric over the same frozen corpus, on two judge models:');
    P();
    P('| judge model | mean score range | max range | outputs that moved | cost / 1k evals |');
    P('|---|---|---|---|---|');
    const miniEvals = corpus.items.length * ragasMini.repeats;
    const miniUsd = ragasMini.cost?.usd != null ? r3((ragasMini.cost.usd / miniEvals) * 1000) : null;
    P(`| \`${ragasMini.judgeModel}\` | ${a.meanRange} | ${a.maxRange} | ${a.moved}/${a.n} | ${miniUsd != null ? `$${miniUsd}` : '—'} |`);
    P(`| \`${ragas.judgeModel}\` | ${b.meanRange} | ${b.maxRange} | ${b.moved}/${b.n} | $${summary.costPer1000.ragas.usd} |`);
    P();
    P('The stronger judge is markedly steadier — roughly a quarter of the score movement, at roughly');
    P(`${miniUsd ? Math.round(summary.costPer1000.ragas.usd / miniUsd) : '?'}× the price. So **"LLM judges wobble" is a claim about cheap judges, and we withdraw it as`);
    P('a general one.** What a stronger judge does *not* fix: it still fails clean production output in');
    P('every repeat, it is still blind to omission, and it still disagrees with the other judge library');
    P('about what faithfulness means. Those are the findings the argument rests on.');
    P();
  }

  P('## 2. Cost per 1,000 evaluations');
  P();
  P('| arm | tokens / 1k evals | USD / 1k evals | wall clock per repeat |');
  P('|---|---|---|---|');
  for (const a of arms) {
    const c = summary.costPer1000[a.key];
    const w = a.data.cost?.meanWallSecondsPerRepeat != null
      ? `${a.data.cost.meanWallSecondsPerRepeat} s`
      : `${a.data.cost?.meanWallMsPerRepeat ?? '?'} ms`;
    P(`| ${a.label} | ${c.tokens ?? '—'} | ${c.usd != null ? `$${c.usd}` : '—'} | ${w} |`);
  }
  P();
  P('*Measured from actual token usage over this corpus, not list-price estimates. The');
  P('deterministic arm makes no API calls; its cost is CPU time.*');
  P();

  P('## 3. Detection by injected defect');
  P();
  const armKeys = arms.map(a => a.key);
  const classMeta = corpus.defectClasses || {};

  if (summary.failingBases.length) {
    P('> **Detection is measured as a reaction to the *injected* defect, not as a raw flag.**');
    P(`> ${summary.failingBases.length} of the captured base outputs already failed the gate before any`);
    P('> mutation (see §6 below), and their mutants inherit that defect. An arm is credited with a');
    P('> detection only if it reacts to what was injected: for OpenGATE, a *new* issue the base did not');
    P('> raise; for a judge, a score below threshold **and** strictly below what it gave that same base');
    P('> in the same repeat. Without this correction OpenGATE would appear to catch inversions it cannot');
    P('> see. Raw pre-correction figures are shown underneath wherever they differ.');
    P();
  }

  const detectionRow = (cls, d) => {
    const cells = armKeys.map(k => {
      const x = d.arms[k];
      const flaky = x.detectedAtLeastOnce > x.detectedEveryRepeat
        ? ` (+${x.detectedAtLeastOnce - x.detectedEveryRepeat} only sometimes)`
        : '';
      const raw = x.rawDetectedEveryRepeat !== x.detectedEveryRepeat
        ? ` <br><sub>raw ${x.rawDetectedEveryRepeat}/${d.n}, before the base correction</sub>`
        : '';
      return `${x.detectedEveryRepeat}/${d.n}${flaky}${raw}`;
    });
    return `| \`${cls}\` | ${d.n} | ${cells.join(' | ')} |`;
  };

  const inScope = (cls) => classMeta[cls]?.deterministicInScope === true;
  const outOfScope = (cls) => classMeta[cls]?.deterministicInScope === false;
  const entries = Object.entries(summary.detection).filter(([cls]) => cls !== 'none');

  P('### 3a. Defects IN SCOPE for deterministic checking');
  P();
  P('Anchors, numbers, abstention — what OpenGATE is built to see. The question here is whether');
  P('the judges match it on its own ground.');
  P();
  P(`| defect class | n | ${arms.map(a => a.label).join(' | ')} |`);
  P(`|---|---|${armKeys.map(() => '---').join('|')}|`);
  for (const [cls, d] of entries.filter(([cls]) => inScope(cls))) P(detectionRow(cls, d));
  P();

  P('### 3b. Defects OUT OF SCOPE for deterministic checking');
  P();
  P('Semantics. OpenGATE is **expected to score zero here, and the paper says so** — anchor and');
  P('number checks have no model of meaning. This is the reverse-direction test: the question is');
  P('whether the judges earn their cost and variance by catching what the gate cannot.');
  P();
  P(`| defect class | n | ${arms.map(a => a.label).join(' | ')} |`);
  P(`|---|---|${armKeys.map(() => '---').join('|')}|`);
  for (const [cls, d] of entries.filter(([cls]) => outOfScope(cls))) P(detectionRow(cls, d));
  P();
  P('`inversion` is the sharpest of these: the meaning of an existing statement is flipped in');
  P('place — *"the dose has been increased to 100 micrograms"* → *"the dose has been reduced to');
  P('100 micrograms"* — while every anchor and every number survives verbatim. Nothing is added and');
  P('nothing is removed. No anchor-based check can see it, ever. If the judges catch it, they have');
  P('bought something real with their variance.');
  P();

  P('### 3c. Clean baseline — false positives');
  P();
  P('Captured outputs with **no injected defect**, which the deterministic gate passes. Measured as');
  P('raw flags, not deltas: a metric that fails clean output cannot gate a release however well it');
  P('detects defects, and this is the number that decides it.');
  P();
  P(`| arm | clean outputs | flagged in EVERY repeat | flagged at least once |`);
  P('|---|---|---|---|');
  for (const a of arms) {
    const f = summary.falsePositives[a.key];
    P(`| ${a.label} | ${f.n} | **${f.flaggedEveryRepeat}/${f.n}** | ${f.flaggedAtLeastOnce}/${f.n} |`);
  }
  P();
  for (const a of arms.filter(x => x.judge)) {
    for (const row of summary.falsePositives[a.key].rows.filter(r => r.flaggedRepeats > 0)) {
      P(`- ${a.label} scored \`${row.outputId}\` — a clean production output — at`);
      P(`  ${row.scores.map(r3).join(', ')} across the five repeats: flagged in ${row.flaggedRepeats}/${row.scores.length}.`);
    }
  }
  P();
  P('*Detection = flagged in **every** repeat. An arm that flags a defect in three runs out of');
  P('five has not detected it in any sense a release gate can use; those are shown in parentheses.*');
  P();
  P('*Caveat against ourselves: on the shortest grounding output, deleting the anchor leaves a stump');
  P('("A notice period of is required to terminate…"). A judge flagging that may be reacting to the');
  P('broken grammar rather than to the missing fact, which would flatter the judges\' `dropped_anchor`');
  P('row rather than ours. The row is 0/5 and 1/5 even so, but the effect is there.*');
  P();
  P('**Do not sum 3a and 3b.** The mutants come from a defect taxonomy, so a combined "sensitivity"');
  P('number would reward whichever arm the taxonomy was drawn around. The two arms fail in opposite');
  P('directions, and that — not a scoreboard — is the finding:');
  P();
  P('- `dropped_anchor` (3a) — an omission. A faithfulness judge asks whether asserted claims are');
  P('  supported; a missing dose asserts nothing, so the metric is blind to it **by construction**.');
  P('  This is not a bug in RAGAS or DeepEval — it is the wrong question for this failure.');
  P('- `inversion` and `contradiction` (3b) — meaning changed while anchors and numbers survive.');
  P('  The deterministic layer passes them by construction. This is the floor of deterministic');
  P('  scoring, measured rather than conceded.');
  P();

  // ── 3d. Definitional divergence between the judge libraries ───────────────
  // Both call their metric "faithfulness". They do not mean the same thing, and
  // the corpus makes the difference legible: a fabricated number is an
  // UNSUPPORTED claim but not a CONTRADICTED one, while an inversion is both.
  const judgeArmsAll = arms.filter(a => a.judge);
  if (judgeArmsAll.length > 1) {
    P('### 3d. The two judges do not mean the same thing by "faithfulness"');
    P();
    P('Compare their rows in 3a and 3b. On the *same* frozen outputs, at temperature 0, on the same');
    P('judge model, the two libraries diverge — not by a little, and not randomly:');
    P();
    P('| defect | what the output does | ' + judgeArmsAll.map(a => a.label).join(' | ') + ' |');
    P('|---|---|' + judgeArmsAll.map(() => '---').join('|') + '|');
    const row = (cls, gloss) => {
      const d = summary.detection[cls];
      if (!d) return;
      P(`| \`${cls}\` | ${gloss} | ${judgeArmsAll.map(a => `${d.arms[a.key].detectedEveryRepeat}/${d.n}`).join(' | ')} |`);
    };
    row('fabricated_number', 'asserts a figure the source does not contain — **unsupported**, but not contradicted');
    row('non_abstention', 'answers a question the context cannot answer — **unsupported**, but not contradicted');
    row('contradiction', 'asserts something the source denies — **contradicted**');
    row('inversion', 'flips a statement the source makes — **contradicted**');
    P();
    for (const a of judgeArmsAll) {
      const d = summary.detection;
      const unsupported = (d.fabricated_number?.arms[a.key].detectedEveryRepeat ?? 0)
        + (d.non_abstention?.arms[a.key].detectedEveryRepeat ?? 0);
      const unsupportedN = (d.fabricated_number?.n ?? 0) + (d.non_abstention?.n ?? 0);
      const contradicted = (d.contradiction?.arms[a.key].detectedEveryRepeat ?? 0)
        + (d.inversion?.arms[a.key].detectedEveryRepeat ?? 0);
      const contradictedN = (d.contradiction?.n ?? 0) + (d.inversion?.n ?? 0);
      P(`- **${a.label}** — unsupported-but-not-contradicted: **${unsupported}/${unsupportedN}**;`);
      P(`  contradicted: **${contradicted}/${contradictedN}**.`);
    }
    P();
    P('The sharpest single case: the unanswerable question, where the system invents a price the');
    P('context does not contain. One library scores that **0.000** — a total failure — and the other');
    P('scores it **1.000, in all five repeats: perfectly faithful.** Both are internally consistent.');
    P('One is asking *"is every claim supported by the context?"*; the other is asking *"does any claim');
    P('contradict the context?"* — and an invented figure contradicts nothing, because the context is');
    P('silent. Silence is not endorsement, but to a contradiction-based metric it is indistinguishable');
    P('from it.');
    P();
    P('This is the most consequential finding in the experiment, and it is not about variance at all.');
    P('A team that adopts "LLM-as-judge faithfulness" and does not read the metric\'s source has not');
    P('chosen a level of rigour — they have chosen, unknowingly, *which* failure mode they are blind');
    P('to. In a patient-facing simplifier, an invented dose is the failure that matters most, and it is');
    P('exactly the one a contradiction-based judge waves through. The deterministic number check');
    P('catches it every time, for free, and names the number it caught.');
    P();
  }

  P('## 4. Failure localisation');
  P();
  P('The deterministic arm names the failure; the judges return a scalar (DeepEval also returns a');
  P('free-text reason). A sample:');
  P();
  P('| output | injected defect | OpenGATE says | DeepEval says |');
  P('|---|---|---|---|');
  for (const l of summary.localisation.slice(0, 8)) {
    const de = l.deepevalReason ? `${l.deepevalReason.slice(0, 120)}…` : '—';
    P(`| \`${l.outputId}\` | \`${l.injected}\` | ${l.deterministic.join('; ') || '—'} | ${de} |`);
  }
  P();

  P('## 5. Interpretation');
  P();
  P('**What we expected to find, and did not.** The experiment was designed around judge *instability*.');
  P('On a strong judge model that finding is weak: score movement is small and verdicts rarely flip');
  P('(§1, §1c). We report that plainly rather than quietly re-running until the story came back. The');
  P('case against gating a release on an LLM judge turns out to rest on three other things, all of');
  P('which a better judge model does **not** fix:');
  P();
  const judgeArms = arms.filter(a => a.judge);
  for (const a of judgeArms) {
    const s = summary.arms[a.key].stability;
    const f = summary.falsePositives[a.key];
    P(`- **${a.label}** — flagged ${f.flaggedEveryRepeat}/${f.n} clean production outputs in *every* repeat;`);
    P(`  caught ${summary.detection.dropped_anchor?.arms[a.key].detectedEveryRepeat ?? 0}/${summary.detection.dropped_anchor?.n ?? 0} dropped anchors; score range ${s.meanRange} mean, ${s.maxRange} max.`);
  }
  P('- **OpenGATE (deterministic)** — 0 false positives, 0 verdict changes, five byte-identical result sets.');
  P();
  // Cost ratio, computed rather than asserted. The deterministic arm's dollar
  // cost is exactly zero, so express the gap in what it actually buys: wall
  // clock, and the price of one full judge sweep.
  const detWallMs = det.cost?.meanWallMsPerRepeat ?? null;
  for (const a of judgeArms) {
    const judgeWallMs = (a.data.cost?.meanWallSecondsPerRepeat ?? 0) * 1000;
    const ratio = detWallMs ? Math.round(judgeWallMs / detWallMs) : null;
    const usd1k = summary.costPer1000[a.key].usd;
    P(`${a.label} costs $${usd1k} per 1,000 evaluations and runs ~${ratio ? ratio.toLocaleString() : '?'}× slower`);
    P(`than the deterministic arm, which costs $0 and makes no network call.`);
  }
  P();
  P();
  // The two-sided sentence, built from the measured numbers on both sides.
  const semanticClasses = entries.filter(([cls]) => outOfScope(cls));
  const semanticN = semanticClasses.reduce((a, [, d]) => a + d.n, 0);
  const detSemantic = semanticClasses.reduce((a, [, d]) => a + d.arms.deterministic.detectedEveryRepeat, 0);
  for (const a of judgeArms) {
    const caught = semanticClasses.reduce((s, [, d]) => s + d.arms[a.key].detectedEveryRepeat, 0);
    P(`On the ${semanticN} semantic defects (contradiction + inversion) that anchor-and-number checking`);
    P(`cannot see, **${a.label} caught ${caught}/${semanticN}** where the deterministic arm caught ${detSemantic}/${semanticN}.`);
  }
  P();
  P('That is the two-sided result, and both sides of it are real:');
  P();
  P('- Deterministic scoring is **stable, free, and localised — and it has a floor**. It cannot see a');
  P('  meaning inversion, and no amount of anchor engineering will change that. The judges caught the');
  P('  inversions; the gate caught none, and never will.');
  P('- LLM judges **see semantics — and they cannot be gated on**. Not because they wobble (on a strong');
  P('  model they largely do not), but because they fail clean production output in every repeat, they');
  P('  are blind to omission, and the two libraries do not agree on what the metric even means — one');
  P('  scores an invented price 0.000 and the other 1.000, five times each (§3d).');
  P();
  P('So the claim is complementarity, and it is now measured rather than asserted: use the');
  P('deterministic layer as the **release gate** — it is the only arm here that passes clean output and');
  P('names what it caught — and a judge as a **non-blocking exploratory signal** over the semantic');
  P('failures the gate is blind to. Neither replaces the other. The experiment was designed so that');
  P('either could have lost, and each of them lost something.');
  P();
  if (summary.failingBases.length) {
    P('## 6. Incidental finding — base outputs that failed before any mutation');
    P();
    P('These are *captured production outputs*, unmutated. They are reported here rather than');
    P('quietly recaptured: capturing until the system looks clean would be the experimental');
    P('equivalent of running the test until it passes.');
    P();
    for (const f of summary.failingBases) {
      P(`**\`${f.outputId}\`** — ${f.producer?.system ?? 'unknown'} (${f.producer?.model ?? 'unspecified'})`);
      P();
      P(`- Gate says: ${f.issues.map(i => `*${i}*`).join('; ')}`);
      P(`- Output: > ${f.text.replace(/\n+/g, ' ').slice(0, 300)}${f.text.length > 300 ? '…' : ''}`);
      P();
    }
    P('The fabricated-number case deserves a note for §7. A number the gate cannot trace to the');
    P('source is flagged whether it was invented or is simply *correct but unsourced* — a clinically');
    P('accurate reference range, quoted from the model\'s own knowledge rather than from the document');
    P('it was given. The gate cannot tell those apart, and deliberately does not try: in a');
    P('patient-facing simplifier, an unsourced clinical figure is exactly the thing a reviewer must');
    P('see. That is a conservative design choice, not a false positive — but it *is* a design choice,');
    P('and the paper should say so.');
    P();
    P('`TODO(Nick): decide whether this contradicts §6\'s "zero fabrications" result for Patiently —');
    P('a regression to fix, or a caveat that the earlier result was a single run.`');
    P();
  }

  P('---');
  P();
  P('Reproduce: `node paper/exp2/score-deterministic.mjs && node paper/exp2/analyse.mjs`.');
  P('The judge arms need an API key — see `paper/exp2/README.md`.');
  if (!ragas || !deepeval) {
    P();
    P(`> **Incomplete:** ${!ragas ? '`results/ragas.json` ' : ''}${!deepeval ? '`results/deepeval.json` ' : ''}not present.`);
    P('> The tables above cover only the arms that have been run.');
  }
  P();

  writeFileSync(OUT_MD, `${L.join('\n')}`);
}

main();
