// OFFLINE scorer — runs with no API key.
// Measures the deterministic citation pipeline two ways:
//   1. Per-claim detection: feed each gold claim's originalText (with markers)
//      through normalize+parse, compare detected citation set to gold.
//   2. Style coverage: run the citation-styles fixture, report supported-style
//      accuracy and surface known-gap styles (e.g. author-year) as a tracked
//      target rather than a failure.

import { detectCitations } from '../lib/citations.mjs';
import { exactSetMatch, jaccard, mean } from '../lib/metrics.mjs';

export const meta = { id: 'citation-detection', mode: 'offline' };

export function run({ cases, fixtures }) {
  // ── 1. Per-claim citation detection across all cases ──
  const perClaim = [];
  for (const c of cases) {
    for (const claim of c.goldClaims || []) {
      const detected = detectCitations(claim.originalText);
      perClaim.push({
        case: c.id,
        claim: claim.text.slice(0, 60),
        gold: claim.citations,
        detected,
        exact: exactSetMatch(detected, claim.citations),
        jaccard: jaccard(detected, claim.citations),
      });
    }
  }
  const exactRate = perClaim.length ? perClaim.filter(p => p.exact).length / perClaim.length : 1;
  const jaccardMean = mean(perClaim.map(p => p.jaccard));

  // ── 2. Style coverage fixture ──
  const styles = (fixtures['citation-styles']?.items) || [];
  const supported = styles.filter(s => !s.knownGap);
  const knownGaps = styles.filter(s => s.knownGap);
  const supportedResults = supported.map(s => ({
    style: s.style,
    pass: exactSetMatch(detectCitations(s.text), s.expected),
  }));
  const supportedAccuracy = supportedResults.length
    ? supportedResults.filter(r => r.pass).length / supportedResults.length : 1;
  // For known-gap styles, "still a gap" = we detect nothing where a target exists.
  const gapResults = knownGaps.map(s => ({
    style: s.style,
    stillUnsupported: detectCitations(s.text).length === 0,
    target: s.targetExpected || [],
  }));

  const failures = [
    ...perClaim.filter(p => !p.exact).map(p => `claim "${p.claim}…" expected [${p.gold}] got [${p.detected}]`),
    ...supportedResults.filter(r => !r.pass).map(r => `style ${r.style} failed`),
  ];

  return {
    meta,
    metrics: {
      perClaim_exactSetRate: round(exactRate),
      perClaim_jaccardMean: round(jaccardMean),
      supportedStyle_accuracy: round(supportedAccuracy),
      knownGap_styles: knownGaps.map(s => s.style),
    },
    detail: { perClaim, supportedResults, gapResults },
    failures,
    passed: failures.length === 0,
  };
}

function round(x) { return Math.round(x * 1000) / 1000; }
