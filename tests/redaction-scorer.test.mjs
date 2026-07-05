import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/scorers/redaction.mjs';

// Minimal adapter harness: redaction capability with a scripted redact().
function fakeAdapter(redactFn) {
  return {
    name: 'fake',
    capabilities: { qa: false, redaction: true },
    onlineAvailable: () => true,
    onlineConfigHint: () => '',
    redact: redactFn,
  };
}

const CASE = {
  id: 'c1', kind: 'redaction',
  text: "Mrs Eileen O'Brien, NHS 9990000034, seen today.",
  goldEntities: [
    { type: 'PATIENT_NAME', value: "Mrs Eileen O'Brien" },
    { type: 'NHS_NUMBER', value: '9990000034' },
  ],
};

test('skips when the adapter has no redaction capability', async () => {
  const adapter = { ...fakeAdapter(async () => ({ text: '' })), capabilities: { qa: true, redaction: false } };
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.skipped, true);
  assert.match(r.reason, /no redaction capability/);
});

test('skips when no redaction cases exist', async () => {
  const r = await run({ cases: [{ id: 'x', manuscript: 'not a redaction case' }], adapter: fakeAdapter(async () => ({ text: '' })) });
  assert.equal(r.skipped, true);
});

test('clean redaction: full recall, no leaks, passes', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '[PATIENT_NAME_1], NHS [NHS_NUMBER_1], seen today.',
    entities: [
      { value: "Mrs Eileen O'Brien", type: 'PATIENT_NAME' },
      { value: '9990000034', type: 'NHS_NUMBER' },
    ],
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, true);
  assert.equal(r.metrics.recall, 1);
  assert.equal(r.metrics.leaks, 0);
});

test('verbatim leak is a named failure and lowers recall', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '[PATIENT_NAME_1], NHS 9990000034, seen today.', // NHS number survives
    entities: [],
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, false);
  assert.equal(r.metrics.leaks, 1);
  assert.equal(r.metrics.recall, 0.5);
  assert.match(r.failures[0], /NHS_NUMBER "9990000034" survived redaction \(verbatim\)/);
});

test('partially redacted name: surviving surname is caught as a partial leak', async () => {
  const adapter = fakeAdapter(async () => ({
    text: "[PATIENT_NAME_1] O'Brien, NHS [NHS_NUMBER_1], seen today.",
    entities: [],
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, false);
  assert.match(r.failures[0], /partial: O'Brien/);
});

test('knownGapEntities excuse a tracked partial leak and are counted open', async () => {
  const c = { ...CASE, knownGapEntities: [{ type: 'PATIENT_SURNAME', value: "O'Brien" }] };
  const adapter = fakeAdapter(async () => ({
    text: "[PATIENT_NAME_1] O'Brien, NHS [NHS_NUMBER_1], seen today.",
    entities: [],
  }));
  const r = await run({ cases: [c], adapter });
  assert.equal(r.passed, true);
  assert.equal(r.metrics.knownGap_open, 1);
  assert.equal(r.metrics.knownGap_closed, 0);
});

test('a closed known gap is counted, ready for promotion to gold', async () => {
  const c = { ...CASE, knownGapEntities: [{ type: 'PATIENT_SURNAME', value: "O'Brien" }] };
  const adapter = fakeAdapter(async () => ({
    text: '[PATIENT_NAME_1], NHS [NHS_NUMBER_1], seen today.', // gap now caught
    entities: [],
  }));
  const r = await run({ cases: [c], adapter });
  assert.equal(r.metrics.knownGap_open, 0);
  assert.equal(r.metrics.knownGap_closed, 1);
});

test('over-redaction: unrelated detections counted, partial captures excused', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '[PATIENT_NAME_1], NHS [NHS_NUMBER_1], seen [DATE_1].',
    entities: [
      { value: 'Mrs Eileen', type: 'PATIENT_NAME' },  // substring of gold → excused
      { value: 'today', type: 'DATE' },                // unrelated → over-redaction
    ],
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.metrics.over_redactions, 1);
  assert.equal(r.passed, true);
});

test('word-boundary: a short name value inside a longer word is not a leak', async () => {
  const c = {
    id: 'c2', kind: 'redaction',
    text: 'Her daughter May visited. Maybe follow up next week.',
    goldEntities: [{ type: 'RELATIVE_NAME', value: 'May' }],
  };
  const adapter = fakeAdapter(async () => ({
    text: 'Her daughter [RELATIVE_NAME_1] visited. Maybe follow up next week.',
    entities: [],
  }));
  const r = await run({ cases: [c], adapter });
  assert.equal(r.metrics.leaks, 0);
  assert.equal(r.passed, true);
});

test('adapter errors are failures, not crashes', async () => {
  const adapter = fakeAdapter(async () => { throw new Error('engine exploded'); });
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, false);
  assert.match(r.failures[0], /engine exploded/);
});
