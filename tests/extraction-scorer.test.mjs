// The extraction scorer end to end: schema-validity gate (nullability as the
// abstention contract), field accuracy vs gold, fabrication named per field,
// and honest skips when the capability or cases are absent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/scorers/extraction.mjs';

const SCHEMA = {
  type: 'object',
  required: ['referral_date', 'reason', 'date_of_birth'],
  properties: {
    referral_date: { type: 'string' },            // must always be found
    reason: { type: 'string' },
    date_of_birth: { type: ['string', 'null'] },  // document may not state it
  },
  additionalProperties: false,
};

const CASES = [
  {
    id: 'referral-1',
    kind: 'extraction',
    document: 'Referral dated 14 March 2026. Reason: damp and mould in the property.',
    schema: SCHEMA,
    gold: { referral_date: '2026-03-14', reason: 'damp and mould in the property', date_of_birth: null },
    normalize: { referral_date: 'date', date_of_birth: 'date' },
  },
];

function fakeAdapter(extractFn, { available = true } = {}) {
  return {
    name: 'fake',
    capabilities: { extraction: Boolean(extractFn) },
    onlineAvailable: () => available,
    onlineConfigHint: () => 'set FAKE_URL',
    resetTiming: () => {},
    callLatencies: () => [],
    runModel: () => null,
    extract: extractFn,
  };
}

test('skips without the extraction capability, offline, or without cases', async () => {
  let r = await run({ cases: CASES, adapter: { ...fakeAdapter(null), capabilities: {} } });
  assert.equal(r.skipped, true);
  r = await run({ cases: CASES, adapter: fakeAdapter(async () => ({}), { available: false }) });
  assert.equal(r.skipped, true);
  r = await run({ cases: [{ id: 'x', kind: 'grounding' }], adapter: fakeAdapter(async () => ({})) });
  assert.equal(r.skipped, true);
});

test('faithful extraction passes with full accuracy and a correct abstention', async () => {
  const adapter = fakeAdapter(async () => ({
    record: { referral_date: '14/03/2026', reason: 'Damp and mould in the property', date_of_birth: null },
  }));
  const r = await run({ cases: CASES, adapter });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
  assert.equal(r.metrics.field_accuracy, 1);
  assert.equal(r.metrics.fabricated_fields, 0);
  assert.equal(r.metrics.abstention_rate, 1);
  assert.equal(r.metrics.schema_failures, 0);
});

test('a fabricated date of birth fails, named by field', async () => {
  const adapter = fakeAdapter(async () => ({
    record: { referral_date: '14/03/2026', reason: 'damp and mould in the property', date_of_birth: '1974-03-02' },
  }));
  const r = await run({ cases: CASES, adapter });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f =>
    /EXTRACTION referral-1: FABRICATED field "date_of_birth": document does not state it/.test(f)));
  assert.equal(r.metrics.fabricated_fields, 1);
});

test('a dropped required field fails the schema gate (nullability is the contract)', async () => {
  const adapter = fakeAdapter(async () => ({
    record: { referral_date: null, reason: 'damp and mould in the property', date_of_birth: null },
  }));
  const r = await run({ cases: CASES, adapter });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /SCHEMA: \/referral_date must be string/.test(f)),
    JSON.stringify(r.failures));
  assert.ok(r.metrics.schema_failures >= 1);
  assert.equal(r.metrics.missed_fields, 1); // counted, not double-gated
});

test('a wrong value gates; metrics stay honest', async () => {
  const adapter = fakeAdapter(async () => ({
    record: { referral_date: '2026-03-15', reason: 'damp and mould in the property', date_of_birth: null },
  }));
  const r = await run({ cases: CASES, adapter });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /WRONG field "referral_date"/.test(f)));
  assert.equal(r.metrics.value_recall, 0.5);
});
