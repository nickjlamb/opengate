// ONLINE scorer — table transcription faithfulness.
//
// Exercises an adapter's transcribeTable() capability against gold cases of
// kind "table-transcription": a source document, the rows that must be copied
// out of it, or expectNoTable for documents that are not results reports.
// The check lives in ../lib/table-check.mjs (pure, shared); read its header
// for what each failure means.
//
// Failure prefixes (used by downstream gate policies, e.g. Patiently's
// scripts/ci/opengate-gate.mjs):
//   FABRICATED NUMBER / NOT VERBATIM / INVENTED FLAG / NUMBER IN EXPLANATION /
//   FALSE TABLE   — absolute correctness: one is too many
//   MISSED ROW / MISSING FLAG — completeness: gate by policy
//
// Case schema (datasets/SCHEMA.md):
//   { "id", "kind": "table-transcription", "text", "language"?,
//     "expectedRows": [{ "test", "value", "flag"? }], "expectNoTable"? }

import { checkTable } from '../lib/table-check.mjs';

export const meta = { id: 'table-transcription', mode: 'online' };

export async function run({ cases, adapter }) {
  if (!adapter.capabilities.tableTranscription) {
    return { meta, skipped: true, reason: `adapter "${adapter.name}" has no tableTranscription capability` };
  }
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }
  const goldCases = cases.filter(c => c.kind === 'table-transcription');
  if (goldCases.length === 0) {
    return { meta, skipped: true, reason: 'No cases of kind "table-transcription".' };
  }

  adapter.resetTiming();
  const perCase = [];
  const failures = [];

  for (const c of goldCases) {
    let rows;
    try {
      const res = await adapter.transcribeTable({ text: c.text, language: c.language });
      rows = Array.isArray(res?.rows) ? res.rows : [];
    } catch (err) {
      failures.push(`case ${c.id}: ${err.message}`);
      continue;
    }
    const chk = checkTable({ rows, text: c.text, expectedRows: c.expectedRows, expectNoTable: c.expectNoTable });

    for (const x of chk.fabricated) failures.push(`FABRICATED NUMBER in ${c.id}: ${x} not in source`);
    for (const x of chk.notVerbatim) failures.push(`NOT VERBATIM in ${c.id}: ${x} not printed in source`);
    for (const x of chk.inventedFlags) failures.push(`INVENTED FLAG in ${c.id}: ${x} not printed in source`);
    for (const x of chk.explanationNumbers) failures.push(`NUMBER IN EXPLANATION in ${c.id}: ${x}`);
    if (chk.falseTable) failures.push(`FALSE TABLE in ${c.id}: ${rows.length} row(s) for a non-results document`);
    for (const x of chk.missedRows) failures.push(`MISSED ROW in ${c.id}: ${x}`);
    for (const x of chk.missingFlags) failures.push(`MISSING FLAG in ${c.id}: ${x}`);

    perCase.push({
      case: c.id,
      expectedRows: (c.expectedRows || []).length,
      rows: rows.length,
      ...Object.fromEntries(['fabricated', 'notVerbatim', 'inventedFlags', 'explanationNumbers', 'missedRows', 'missingFlags'].map(k => [k, chk[k]])),
      falseTable: chk.falseTable,
      // The table itself, so a failure can be diagnosed from the snapshot.
      table: rows.slice(0, 40).map(r => ({ test: r.test, value: r.value, unit: r.unit, range: r.range, flag: r.flag })),
    });
  }

  const sum = k => perCase.reduce((a, p) => a + (Array.isArray(p[k]) ? p[k].length : p[k] ? 1 : 0), 0);
  const nExpected = perCase.reduce((a, p) => a + p.expectedRows, 0);
  const latencies = adapter.callLatencies();
  const metrics = {
    n_cases: perCase.length,
    n_expected_rows: nExpected,
    row_recall: round(nExpected ? 1 - sum('missedRows') / nExpected : 1),
    missed_rows: sum('missedRows'),
    missing_flags: sum('missingFlags'),
    fabricated_numbers: sum('fabricated'),
    not_verbatim: sum('notVerbatim'),
    invented_flags: sum('inventedFlags'),
    explanation_numbers: sum('explanationNumbers'),
    false_tables: sum('falseTable'),
    ...(latencies.length ? { latency_p50_ms: Math.round(latencies.slice().sort((a, b) => a - b)[Math.floor(latencies.length / 2)]) } : {}),
    ...(adapter.runModel() ? { run_model: adapter.runModel() } : {}),
  };
  return { meta, metrics, detail: { perCase }, failures, passed: failures.length === 0 };
}

function round(x) { return Math.round(x * 100) / 100; }
