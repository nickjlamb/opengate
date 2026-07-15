#!/usr/bin/env node
// exp-1 step 2 — score the returned labels against gold.
//
//   node paper/exp1/agreement.mjs paper/exp1/responses/<labeller>.json
//
// Reports, per capability:
//   • raw percentage agreement
//   • Cohen's κ with a 95% confidence interval (asymptotic SE)
//   • the confusion matrix for verdicts (6-class) — where we disagree matters more
//     than how often
//   • cold (pre-rubric) vs guided (post-rubric) agreement on the same six items
//   • every disagreement, in full, with the labeller's reason
//
// κ is reported BEFORE any reconciliation, per the pre-registered plan. If the
// second labeller turns out to be right, the gold case is corrected in the public
// history afterwards, and the paper reports both numbers.
//
// Landis & Koch bands are printed for orientation only. They are a convention,
// not a law, and a κ of 0.7 on a six-class clinical judgment is not the same
// thing as a κ of 0.7 on a coin flip.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = resolve(HERE, 'gold-key.json');
const OUT_MD = resolve(HERE, 'RESULTS.md');
const OUT_JSON = resolve(HERE, 'agreement.json');

const r3 = (x) => Math.round(x * 1000) / 1000;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** Cohen's κ for two raters over categorical labels, with asymptotic 95% CI. */
export function cohensKappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const labels = [...new Set(pairs.flatMap(([a, b]) => [a, b]))].sort();

  let observed = 0;
  const rowA = {}, colB = {};
  for (const [a, b] of pairs) {
    if (a === b) observed++;
    rowA[a] = (rowA[a] || 0) + 1;
    colB[b] = (colB[b] || 0) + 1;
  }
  const po = observed / n;
  const pe = labels.reduce((acc, l) => acc + ((rowA[l] || 0) / n) * ((colB[l] || 0) / n), 0);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);

  // Asymptotic standard error (Fleiss, Cohen & Everitt 1969) — the simple form.
  const se = Math.sqrt((po * (1 - po)) / (n * (1 - pe) ** 2));
  const lo = kappa - 1.96 * se;
  const hi = kappa + 1.96 * se;

  return {
    n,
    observedAgreement: r3(po),
    expectedAgreement: r3(pe),
    kappa: r3(kappa),
    se: r3(se),
    ci95: [r3(Math.max(-1, lo)), r3(Math.min(1, hi))],
    band: band(kappa),
  };
}

function band(k) {
  if (k < 0) return 'worse than chance';
  if (k <= 0.20) return 'slight';
  if (k <= 0.40) return 'fair';
  if (k <= 0.60) return 'moderate';
  if (k <= 0.80) return 'substantial';
  return 'almost perfect';
}

function confusion(pairs, labels) {
  const m = {};
  for (const a of labels) { m[a] = {}; for (const b of labels) m[a][b] = 0; }
  for (const [a, b] of pairs) if (m[a] && m[a][b] !== undefined) m[a][b]++;
  return m;
}

function main() {
  const responsePath = process.argv[2];
  if (!responsePath) {
    console.error('usage: node paper/exp1/agreement.mjs <responses.json>');
    process.exit(1);
  }
  if (!existsSync(KEY)) {
    console.error('missing gold-key.json — run make-pack.mjs first');
    process.exit(1);
  }

  const key = JSON.parse(readFileSync(KEY, 'utf8'));
  const resp = JSON.parse(readFileSync(resolve(responsePath), 'utf8'));
  const A = resp.answers || {};
  const byId = new Map(key.key.map(k => [k.id, k]));
  const warmupIds = new Set(key.warmupIds || []);

  // The pack namespaces the two passes over the warm-up items:
  //   warmup::<id>  (cold, before the rubric)   and   claim::<id>  (guided)
  const guided = (id) => A[`claim::${id}`];
  const cold = (id) => A[`warmup::${id}`];
  const noteOf = (id) => A[`claim::${id}::note`] || A[`${id}::note`] || A[`warmup::${id}::note`] || null;

  const tasks = {};
  const disagreements = [];

  // ── Task A: verdicts ────────────────────────────────────────────────────
  const vPairs = [];
  for (const k of key.key.filter(x => x.task === 'verdict')) {
    const theirs = guided(k.id);
    if (theirs == null) continue;
    vPairs.push([k.gold, theirs]);
    if (theirs !== k.gold) {
      disagreements.push({
        task: 'verdict', id: k.id, caseId: k.caseId,
        gold: k.gold, theirs, goldRationale: k.rationale, theirReason: noteOf(k.id),
      });
    }
  }
  const VERDICTS = ['strong_support', 'partial_support', 'implied_by_data', 'overclaim', 'not_supported', 'contradicted'];
  tasks.verdict = {
    ...cohensKappa(vPairs),
    confusion: confusion(vPairs, VERDICTS),
    labels: VERDICTS,
  };

  // ── Tasks B & C: binary ─────────────────────────────────────────────────
  for (const task of ['redaction', 'simplification']) {
    const pairs = [];
    for (const k of key.key.filter(x => x.task === task)) {
      const theirs = A[k.id];
      if (theirs == null) continue;
      pairs.push([String(k.gold), String(theirs)]);
      if (String(k.gold) !== String(theirs)) {
        disagreements.push({
          task, id: k.id, caseId: k.caseId,
          gold: k.gold, theirs, boundaryNote: k.note, theirReason: noteOf(k.id),
        });
      }
    }
    tasks[task] = cohensKappa(pairs);
  }

  // ── Cold vs guided, on the same six items ───────────────────────────────
  const coldPairs = [], guidedPairs = [];
  for (const id of warmupIds) {
    const k = byId.get(id);
    if (!k) continue;
    if (cold(id) != null) coldPairs.push([k.gold, cold(id)]);
    if (guided(id) != null) guidedPairs.push([k.gold, guided(id)]);
  }
  const rubricEffect = {
    n: warmupIds.size,
    coldAgreement: coldPairs.length ? r3(coldPairs.filter(([a, b]) => a === b).length / coldPairs.length) : null,
    guidedAgreement: guidedPairs.length ? r3(guidedPairs.filter(([a, b]) => a === b).length / guidedPairs.length) : null,
    changedTheirMind: [...warmupIds].filter(id => cold(id) != null && guided(id) != null && cold(id) !== guided(id)).length,
  };

  const summary = {
    scoredAt: new Date().toISOString(),
    responseFile: basename(responsePath),
    labeller: resp.labeller ?? 'anonymous',
    tasks,
    rubricEffect,
    disagreements,
    reconciled: false,
    comments: A.__comments || null,
  };

  writeFileSync(OUT_JSON, `${JSON.stringify(summary, null, 2)}\n`);
  writeMarkdown(summary);

  console.error(`agreement → ${OUT_MD}`);
  for (const [name, t] of Object.entries(tasks)) {
    if (!t) continue;
    console.error(`  ${name.padEnd(15)} κ=${t.kappa} [${t.ci95.join(', ')}]  agreement ${pct(t.observedAgreement)}  n=${t.n}`);
  }
  console.error(`  ${disagreements.length} disagreement(s) to reconcile`);
}

function writeMarkdown(s) {
  const L = [];
  const P = (x = '') => L.push(x);

  P('# exp-1 — independent second labeller: agreement');
  P();
  P(`*Generated by \`paper/exp1/agreement.mjs\` from \`${s.responseFile}\`. κ is reported`);
  P('**before reconciliation**, as pre-registered. Where the second labeller is right, the gold case is');
  P('corrected afterwards in the public history and both numbers are reported.*');
  P();

  P('## Agreement');
  P();
  P('| task | items | agreement | Cohen\'s κ | 95% CI | |');
  P('|---|---|---|---|---|---|');
  for (const [name, t] of Object.entries(s.tasks)) {
    if (!t) continue;
    P(`| ${name} | ${t.n} | ${pct(t.observedAgreement)} | **${t.kappa}** | ${t.ci95[0]} – ${t.ci95[1]} | ${t.band} |`);
  }
  P();
  P('*Verdicts are a 6-class judgment; redaction and simplification are binary. κ corrects for the');
  P('agreement you would get by chance, which is why a binary task with 90% raw agreement can still');
  P('produce a modest κ. Landis–Koch bands are printed for orientation only — they are a convention,');
  P('not a finding.*');
  P();

  const v = s.tasks.verdict;
  if (v?.confusion) {
    P('## Where we disagree (verdict confusion matrix)');
    P();
    P('Rows: our gold label. Columns: the second labeller\'s.');
    P();
    P(`| gold \\ theirs | ${v.labels.map(l => l.replace(/_/g, ' ')).join(' | ')} |`);
    P(`|---|${v.labels.map(() => '---').join('|')}|`);
    for (const a of v.labels) {
      const cells = v.labels.map(b => {
        const n = v.confusion[a][b];
        return a === b ? (n ? `**${n}**` : '·') : (n || '·');
      });
      P(`| **${a.replace(/_/g, ' ')}** | ${cells.join(' | ')} |`);
    }
    P();
    P('The off-diagonal cells are the paper\'s real interest. A benchmark whose disagreements cluster on');
    P('one boundary (the classic being *overclaim* vs *contradicted*) has a rubric problem that can be');
    P('fixed; one whose disagreements are scattered has a labelling problem that cannot.');
    P();
  }

  const r = s.rubricEffect;
  if (r && r.coldAgreement != null) {
    P('## What the rubric buys');
    P();
    P(`The same ${r.n} claims were labelled twice: once cold, before the rubric was shown, and again`);
    P('inside the main pass after reading it.');
    P();
    P('| | agreement with gold |');
    P('|---|---|');
    P(`| cold (no rubric) | ${pct(r.coldAgreement)} |`);
    P(`| guided (after the rubric) | ${pct(r.guidedAgreement)} |`);
    P();
    P(`The labeller changed their answer on ${r.changedTheirMind} of ${r.n} items after reading the rubric.`);
    P('This is a small sample and is reported as a directional signal, not a result. It answers a');
    P('specific reviewer question: is the agreement below a property of the *labels*, or of the');
    P('*rubric* that trains people to produce them? Both answers are publishable; they are not the same');
    P('claim.');
    P();
  }

  P('## Every disagreement');
  P();
  if (!s.disagreements.length) {
    P('None. (Treat total agreement on a 6-class judgment with suspicion, not satisfaction — check that');
    P('the answer key did not leak into the pack.)');
  } else {
    P(`${s.disagreements.length} of the judgments differ. Each is listed in full, with our rationale and`);
    P('theirs, so a reader can decide who was right rather than take our word for it.');
    P();
    for (const d of s.disagreements) {
      P(`### \`${d.id}\``);
      P();
      P(`- **Our gold:** \`${d.gold}\``);
      P(`- **Second labeller:** \`${d.theirs}\``);
      if (d.goldRationale) P(`- **Our rationale:** ${d.goldRationale}`);
      if (d.boundaryNote) P(`- **Known boundary case:** ${d.boundaryNote}`);
      P(`- **Their reason:** ${d.theirReason ? d.theirReason : '*(none given)*'}`);
      P(`- **Resolution:** \`TODO\` — uphold / correct the gold case / clarify the rubric`);
      P();
    }
  }

  if (s.comments) {
    P('## The labeller\'s comments');
    P();
    P('> ' + s.comments.replace(/\n/g, '\n> '));
    P();
  }

  P('---');
  P();
  P('Reproduce: `node paper/exp1/agreement.mjs <responses.json>`. The pack itself is rebuilt');
  P('byte-identically by `node paper/exp1/make-pack.mjs`.');
  P();

  writeFileSync(OUT_MD, L.join('\n'));
}

// Only run when invoked directly, so cohensKappa() can be imported and tested.
// The κ figure is the headline of this experiment; it needs a test, and a module
// that scores a file as a side effect of being imported cannot have one.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
