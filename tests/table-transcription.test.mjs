import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTable, flagInSource } from '../src/lib/table-check.mjs';
import { run } from '../src/scorers/table-transcription.mjs';

const SRC = 'Haemoglobin 102 g/L 130 - 170 L\nPlatelets 245 x10^9/L 150 - 400\nCRP 14.52 mg/L <5 H';
const GOOD = [
  { test: 'Haemoglobin', value: '102', unit: 'g/L', range: '130 - 170', flag: 'L', explanation: 'Oxygen-carrying protein in red cells.' },
  { test: 'Platelets', value: '245', unit: 'x10^9/L', range: '150 - 400', flag: '', explanation: 'Cells that help blood clot.' },
];

test('a faithful transcription passes', () => {
  const r = checkTable({ rows: GOOD, text: SRC, expectedRows: [{ test: 'Haemoglobin', value: '102', flag: 'L' }, { test: 'Platelets', value: '245' }] });
  assert.equal(r.ok, true, r.issues.join('; '));
});

test('an invented reference range is a fabricated number', () => {
  const r = checkTable({ rows: [{ ...GOOD[0], range: '115 - 165' }], text: SRC });
  assert.deepEqual(r.fabricated, ['Haemoglobin.range: "115"', 'Haemoglobin.range: "165"']);
});

test('unit conversion fails as not verbatim even when no new digit appears', () => {
  const r = checkTable({ rows: [{ test: 'Haemoglobin', value: '10.2', unit: 'g/dL' }], text: SRC });
  assert.ok(r.notVerbatim.some(x => x.includes('value')));
  assert.ok(r.notVerbatim.some(x => x.includes('unit')));
});

test('rounding is caught: 14.5 is not 14.52', () => {
  const r = checkTable({ rows: [{ test: 'CRP', value: '14.5' }], text: SRC });
  assert.equal(r.fabricated.length, 1);
});

test('a flag the source does not print is invented; L inside a unit does not count', () => {
  assert.equal(flagInSource('Platelets 245 x10^9/L', 'L'), false);
  assert.equal(flagInSource('Hb 102 g/L (130-170) L', 'L'), true);
  assert.equal(flagInSource('Hb 98 (low, ref 115-165)', 'low'), true);
  const r = checkTable({ rows: [{ ...GOOD[1], flag: 'H' }], text: 'Platelets 245 x10^9/L 150 - 400' });
  assert.deepEqual(r.inventedFlags, ['Platelets: "H"']);
});

test('any digit in an explanation fails', () => {
  const r = checkTable({ rows: [{ ...GOOD[0], explanation: 'Usually above 130.' }], text: SRC });
  assert.equal(r.explanationNumbers.length, 1);
});

test('rows for a non-results document are a false table', () => {
  const r = checkTable({ rows: GOOD, text: SRC, expectNoTable: true });
  assert.equal(r.falseTable, true);
  assert.equal(checkTable({ rows: [], text: 'letter', expectNoTable: true }).ok, true);
});

test('missed rows and dropped flags are reported', () => {
  const r = checkTable({ rows: [{ ...GOOD[0], flag: '' }], text: SRC, expectedRows: [{ test: 'Haemoglobin', value: '102', flag: 'L' }, { test: 'Platelets', value: '245' }] });
  assert.deepEqual(r.missedRows, ['Platelets 245']);
  assert.equal(r.missingFlags.length, 1);
});

// ── scorer ───────────────────────────────────────────────────────────────
function fakeAdapter(fn) {
  return {
    name: 'fake', capabilities: { tableTranscription: true },
    onlineAvailable: () => true, onlineConfigHint: () => '',
    resetTiming: () => {}, callLatencies: () => [], runModel: () => null,
    transcribeTable: fn,
  };
}
const CASES = [
  { id: 't1', kind: 'table-transcription', text: SRC, expectedRows: [{ test: 'Haemoglobin', value: '102', flag: 'L' }] },
  { id: 't2', kind: 'table-transcription', text: 'Start amoxicillin 500 mg for 5 days.', expectNoTable: true },
];

test('scorer skips without the capability', async () => {
  const r = await run({ cases: CASES, adapter: { ...fakeAdapter(async () => ({ rows: [] })), capabilities: {} } });
  assert.equal(r.skipped, true);
});

test('scorer passes a faithful system and reports metrics', async () => {
  const r = await run({ cases: CASES, adapter: fakeAdapter(async ({ text }) => ({ rows: text === SRC ? GOOD : [] })) });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
  assert.equal(r.metrics.n_cases, 2);
  assert.equal(r.metrics.row_recall, 1);
  assert.equal(r.metrics.fabricated_numbers, 0);
});

test('scorer names fabricated numbers and false tables', async () => {
  const r = await run({ cases: CASES, adapter: fakeAdapter(async () => ({ rows: [{ ...GOOD[0], range: '115 - 165' }] })) });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => f.startsWith('FABRICATED NUMBER in t1')));
  assert.ok(r.failures.some(f => f.startsWith('FALSE TABLE in t2')));
  assert.equal(r.metrics.false_tables, 1);
});

test('adapter errors become case failures, not crashes', async () => {
  const r = await run({ cases: CASES.slice(0, 1), adapter: fakeAdapter(async () => { throw new Error('HTTP 500'); }) });
  assert.match(r.failures[0], /^case t1: HTTP 500/);
});
