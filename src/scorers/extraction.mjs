// ONLINE scorer — structured extraction (documents → fields → human review).
//
// Exercises the adapter's extract() capability against gold cases of kind
// "extraction": a document, the partner's JSON Schema for the target record,
// and a hand-labelled gold record. The system fills the schema from the
// document; unknown → null, never guessed. This is the most deterministically
// checkable pattern in the family — gold values compare exactly (after
// per-field normalisation), so there is no paraphrase problem and no judge.
//
//   • schema validity (gate) — the extracted record validates against the
//     case's JSON Schema. Nullability is the abstention contract: a required
//     non-nullable field that comes back null fails here, by design.
//   • field accuracy (gate) — extracted values vs hand-labelled gold, with
//     per-field normalisers (dates → ISO, money → minor units, whitespace/case
//     folding) and per-field aliases where the document's wording varies.
//   • fabrication (gate) — a non-null value in a field whose gold is null is
//     the extraction hallucination: a fabricated date of birth on a referral
//     is the extraction twin of a fabricated dose. Named per field.
//   • abstention / missing (metrics) — null-when-gold-null (correct
//     abstention) vs null-when-gold-present (missed field). Reported as
//     precision/recall; regressions gate via the baseline machinery.
//
// Case schema (datasets/SCHEMA.md):
//   { "id", "kind": "extraction", "document", "schema": { …JSON Schema… },
//     "gold": { "field": value | null },        // null = document doesn't state it
//     "normalize": { "field": "date"|"money"|"number"|"text" },
//     "aliases": { "field": ["accepted alternative", …] } }

import { checkExtraction } from '../lib/extraction-check.mjs';
import { validateRecordAgainstSchema } from '../lib/schema-validate.mjs';

export const meta = { id: 'extraction', mode: 'online' };

export async function run({ cases, adapter }) {
  if (!adapter.capabilities.extraction) {
    return { meta, skipped: true, reason: `adapter "${adapter.name}" has no extraction capability` };
  }
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }
  const goldCases = cases.filter(c => c.kind === 'extraction' && c.document != null && c.schema && c.gold);
  if (goldCases.length === 0) {
    return { meta, skipped: true, reason: 'No cases of kind "extraction" with document + schema + gold.' };
  }

  adapter.resetTiming();

  const perCase = [];
  const failures = [];
  const totals = { correct: 0, wrong: 0, fabricated: 0, missed: 0, correctAbstentions: 0, schemaFailures: 0 };

  for (const c of goldCases) {
    let record;
    try {
      const res = await adapter.extract({ document: c.document, schema: c.schema });
      record = res?.record ?? res;
    } catch (err) {
      failures.push(`case ${c.id}: ${err.message}`);
      continue;
    }
    if (!record || typeof record !== 'object') {
      failures.push(`NO RECORD in ${c.id}: extract() returned nothing usable`);
      continue;
    }

    const caseFailures = [];

    // 1. Schema validity — the partner's contract, including nullability.
    const schemaResult = validateRecordAgainstSchema(record, c.schema);
    if (!schemaResult.valid) {
      totals.schemaFailures += schemaResult.errors.length;
      for (const e of schemaResult.errors) caseFailures.push(`SCHEMA: ${e}`);
    }

    // 2. Field-by-field comparison against gold — shared, deterministic core.
    const chk = checkExtraction({
      record, gold: c.gold, normalize: c.normalize, aliases: c.aliases,
    });
    for (const issue of chk.issues) caseFailures.push(issue);
    for (const k of Object.keys(totals)) {
      if (k in chk.counts) totals[k] += chk.counts[k];
    }

    for (const cf of caseFailures) failures.push(`EXTRACTION ${c.id}: ${cf}`);
    perCase.push({
      case: c.id,
      fields: Object.keys(c.gold).length,
      schemaValid: schemaResult.valid,
      perField: chk.perField,
      problems: caseFailures,
    });
  }

  const goldPresent = totals.correct + totals.wrong + totals.missed;
  const goldNull = totals.fabricated + totals.correctAbstentions;
  const extractedNonNull = totals.correct + totals.wrong + totals.fabricated;
  const nFields = goldPresent + goldNull;
  const latencies = adapter.callLatencies();

  const metrics = {
    n_cases: perCase.length,
    n_fields: nFields,
    field_accuracy: round(nFields ? (totals.correct + totals.correctAbstentions) / nFields : 0),
    value_precision: round(extractedNonNull ? totals.correct / extractedNonNull : (goldPresent ? 0 : 1)),
    value_recall: round(goldPresent ? totals.correct / goldPresent : 1),
    fabricated_fields: totals.fabricated,
    missed_fields: totals.missed,
    schema_failures: totals.schemaFailures,
    ...(goldNull ? { abstention_rate: round(totals.correctAbstentions / goldNull) } : {}),
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
