// ONLINE scorer — exercises the adapter's splitClaims().
// Measures whether the splitter extracts the right verifiable claims:
//   • recall   — did it find the gold claims?
//   • precision — did it avoid pulling in non-claims (background/aims)?
//   • citation agreement on the claims it did extract
//   • fidelity  — is each extracted claim verbatim-ish from the manuscript?

import { precisionRecallF1, claimMatch, jaccard, normText, mean } from '../lib/metrics.mjs';

export const meta = { id: 'claim-extraction', mode: 'online' };

export async function run({ cases, adapter }) {
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }

  const perCase = [];
  const splitErrors = [];
  for (const c of cases) {
   try {
    const resp = await adapter.splitClaims(c.manuscript);
    const extracted = (resp.claims || []).map(x => (typeof x === 'string' ? { text: x, citations: [] } : x));
    const goldTexts = (c.goldClaims || []).map(g => g.text);

    // Precision / recall / F1 of extracted claims vs gold claims.
    const prf = precisionRecallF1(extracted.map(e => e.text), goldTexts, claimMatch);

    // Leakage: any extracted claim that matches a known non-claim is a false positive.
    const leaked = extracted.filter(e => (c.goldNonClaims || []).some(nc => claimMatch(e.text, nc)));

    // Citation agreement on matched claims.
    const citJaccards = [];
    for (const g of c.goldClaims || []) {
      const m = extracted.find(e => claimMatch(e.text, g.text));
      if (m) citJaccards.push(jaccard(m.citations || [], g.citations || []));
    }

    // Fidelity: extracted claim text should appear (normalised) in the manuscript.
    const src = normText(c.manuscript);
    const infidelities = extracted.filter(e => {
      const t = normText(e.text);
      return t.length >= 12 && !src.includes(t);
    });

    perCase.push({
      case: c.id,
      precision: prf.precision, recall: prf.recall, f1: prf.f1,
      leakedCount: leaked.length,
      citationJaccardMean: mean(citJaccards),
      infidelityCount: infidelities.length,
      infidelities: infidelities.map(e => e.text.slice(0, 80)),
    });
   } catch (err) {
    splitErrors.push(`case ${c.id}: ${err.message}`);
   }
  }

  const agg = {
    f1: round(mean(perCase.map(p => p.f1))),
    precision: round(mean(perCase.map(p => p.precision))),
    recall: round(mean(perCase.map(p => p.recall))),
    citationJaccardMean: round(mean(perCase.map(p => p.citationJaccardMean))),
    totalLeaked: perCase.reduce((a, p) => a + p.leakedCount, 0),
    totalInfidelities: perCase.reduce((a, p) => a + p.infidelityCount, 0),
  };
  const failures = [...splitErrors];
  if (agg.totalInfidelities > 0) failures.push(`${agg.totalInfidelities} extracted claim(s) not verbatim from source`);
  if (agg.totalLeaked > 0) failures.push(`${agg.totalLeaked} non-claim(s) leaked into extraction`);
  agg.casesEvaluated = perCase.length;
  agg.splitErrors = splitErrors.length;

  return { meta, metrics: agg, detail: { perCase }, failures, passed: failures.length === 0 };
}

function round(x) { return Math.round(x * 1000) / 1000; }
