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

// Deterministic grounding check — the core behind the grounding scorer and the
// OpenGATE MCP server. Usable directly: checkGrounding({ answer, context, … }).
export {
  checkGrounding,
  DEFAULT_ABSTAIN,
  contains,
  numbersIn,
  flattenContext,
} from './lib/grounding-check.mjs';

// Deterministic extraction check — the core behind the extraction scorer.
// Usable directly: checkExtraction({ record, gold, … }); schema validation
// (ajv) lives in schema-validate so this core stays dependency-free.
export {
  checkExtraction,
  normalizeValue,
  normalizeDate,
  normalizeMoney,
  normalizeNumber,
  normalizeText,
} from './lib/extraction-check.mjs';

export { validateRecordAgainstSchema } from './lib/schema-validate.mjs';
