import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/scorers/simplification.mjs';

function fakeAdapter(simplifyFn) {
  const calls = [];
  return {
    name: 'fake',
    capabilities: { qa: false, redaction: false, simplify: true },
    onlineAvailable: () => true,
    onlineConfigHint: () => '',
    resetTiming: () => { calls.length = 0; },
    callLatencies: () => calls,
    runModel: () => null,
    simplify: simplifyFn,
  };
}

const CASE = {
  id: 's1', kind: 'simplification',
  text: 'Start amoxicillin 500 mg three times daily for 5 days. Review in 2 weeks.',
  anchors: [
    { value: 'amoxicillin' },
    { value: '500 mg', aliases: ['500mg'] },
    { value: '2 weeks', aliases: ['two weeks'] },
  ],
  allowedNewNumbers: ['3'],
  maxBullets: 3,
  maxWordsPerBullet: 20,
};

test('skips without the simplify capability', async () => {
  const adapter = { ...fakeAdapter(async () => ({ text: '' })), capabilities: { simplify: false } };
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.skipped, true);
});

test('skips when no simplification cases exist', async () => {
  const r = await run({ cases: [{ id: 'x', kind: 'redaction' }], adapter: fakeAdapter(async () => ({ text: '' })) });
  assert.equal(r.skipped, true);
});

test('faithful output passes: anchors survive, no new numbers, contract met', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '- Take amoxicillin 500mg 3 times a day for 5 days\n- See your GP in two weeks',
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
  assert.equal(r.metrics.anchor_recall, 1);
  assert.equal(r.metrics.fabricated_numbers, 0);
  assert.equal(r.metrics.contract_violations, 0);
});

test('a dropped dose is a named failure', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '- Take amoxicillin 3 times a day for 5 days\n- See your GP in two weeks',
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, false);
  assert.match(r.failures[0], /DROPPED FACT .* "500 mg"/);
  assert.equal(r.metrics.dropped_facts, 1);
});

test('an invented number is a named failure', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '- Take amoxicillin 500 mg 3 times a day for 7 days\n- See your GP in 2 weeks',
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /FABRICATED NUMBER .* "7"/.test(f)), JSON.stringify(r.failures));
});

test('contract: too many bullets and overlong bullets are violations', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '- amoxicillin 500 mg for 5 days\n- b 2 weeks\n- c\n- d',
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.ok(r.failures.some(f => /CONTRACT .* 4 bullets > max 3/.test(f)));
});

test('contract: bullet output expected but prose returned', async () => {
  const adapter = fakeAdapter(async () => ({
    text: 'Take amoxicillin 500 mg 3 times a day for 5 days and see your GP in 2 weeks.',
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.ok(r.failures.some(f => /bullet output expected/.test(f)));
});

test('adapter errors are failures, not crashes', async () => {
  const adapter = fakeAdapter(async () => { throw new Error('endpoint down'); });
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.passed, false);
  assert.match(r.failures[0], /endpoint down/);
});

test('readability grade is reported', async () => {
  const adapter = fakeAdapter(async () => ({
    text: '- Take amoxicillin 500 mg 3 times a day for 5 days\n- See your GP in 2 weeks',
  }));
  const r = await run({ cases: [CASE], adapter });
  assert.ok(typeof r.metrics.mean_grade === 'number');
});
