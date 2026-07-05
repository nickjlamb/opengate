// Public programmatic API for @pharmatools/opengate.
//
// The CLI (bin: opengate → src/runner.mjs) is the primary interface; these
// exports let implementations reuse the framework's pure logic directly —
// e.g. scoring inside an existing test suite, or building custom tooling on
// the metric primitives.

export {
  jaccard,
  exactSetMatch,
  precisionRecallF1,
  VERDICT_SCALE,
  verdictAccuracy,
  confusionMatrix,
  mean,
  stdev,
  percentile,
  normText,
  claimMatch,
} from './lib/metrics.mjs';

export {
  normalizeCitations,
  parseClaimCitations,
  detectAuthorYear,
  detectCitations,
} from './lib/citations.mjs';

export { loadAdapter, validateAdapter } from './lib/adapter.mjs';
