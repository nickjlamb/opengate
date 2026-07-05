import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/scorers/grounding.mjs';

function fakeAdapter(answerFn) {
  return {
    name: 'fake',
    capabilities: { qa: false, redaction: false, simplify: false, retrieval: false, grounding: true },
    onlineAvailable: () => true,
    onlineConfigHint: () => '',
    resetTiming: () => {},
    callLatencies: () => [],
    runModel: () => null,
    answer: answerFn,
  };
}

const ANSWERABLE = {
  id: 'g1', kind: 'grounding',
  question: 'How many days for a refund and is there a fee?',
  context: 'Customers may request a full refund within 30 days. There is no restocking fee.',
  answerAnchors: [
    { value: '30 days', aliases: ['30-day'] },
    { value: 'no restocking fee', aliases: ['no fee'] },
  ],
  answerable: true,
};

const UNANSWERABLE = {
  id: 'g2', kind: 'grounding',
  question: 'What is the Enterprise price?',
  context: 'The Pro plan has a 30-day trial. Contact sales for volume discounts.',
  answerable: false,
};

test('skips without the grounding capability', async () => {
  const adapter = { ...fakeAdapter(async () => ({ text: '' })), capabilities: { grounding: false } };
  const r = await run({ cases: [ANSWERABLE], adapter });
  assert.equal(r.skipped, true);
});

test('a correct, grounded answer passes', async () => {
  const adapter = fakeAdapter(async () => ({ text: 'You have 30 days to request a refund, with no restocking fee.' }));
  const r = await run({ cases: [ANSWERABLE], adapter });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
  assert.equal(r.metrics.answer_recall, 1);
  assert.equal(r.metrics.ungrounded_numbers, 0);
});

test('a missing answer fact is a named failure', async () => {
  const adapter = fakeAdapter(async () => ({ text: 'You have 30 days to request a refund.' }));
  const r = await run({ cases: [ANSWERABLE], adapter });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /missing answer fact "no restocking fee"/.test(f)), JSON.stringify(r.failures));
});

test('an ungrounded (fabricated) number is caught', async () => {
  const adapter = fakeAdapter(async () => ({ text: 'You have 30 days and no restocking fee, plus a 90-day extension.' }));
  const r = await run({ cases: [ANSWERABLE], adapter });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /ungrounded number "90"/.test(f)), JSON.stringify(r.failures));
});

test('numbers from the context are not flagged', async () => {
  const c = { ...ANSWERABLE, context: 'Refund within 30 days, processed in 5 business days. No restocking fee.' };
  const adapter = fakeAdapter(async () => ({ text: '30 days, processed in 5 business days, no restocking fee.' }));
  const r = await run({ cases: [c], adapter });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
});

test('unanswerable case: abstaining passes', async () => {
  const adapter = fakeAdapter(async () => ({ text: "That isn't in the provided context — please contact sales." }));
  const r = await run({ cases: [UNANSWERABLE], adapter });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
  assert.equal(r.metrics.abstention_rate, 1);
});

test('unanswerable case: fabricating instead of abstaining fails', async () => {
  const adapter = fakeAdapter(async () => ({ text: 'The Enterprise plan is $499 per year.' }));
  const r = await run({ cases: [UNANSWERABLE], adapter });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /did not abstain/.test(f)));
  assert.equal(r.metrics.abstention_rate, 0);
});

test('answer can be returned as { answer } or { text }', async () => {
  const adapter = fakeAdapter(async () => ({ answer: '30 days, no restocking fee.' }));
  const r = await run({ cases: [ANSWERABLE], adapter });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
});

test('context may be an array of passages', async () => {
  const c = { ...ANSWERABLE, context: ['Refund within 30 days.', 'There is no restocking fee.'] };
  const adapter = fakeAdapter(async () => ({ text: '30 days, no restocking fee.' }));
  const r = await run({ cases: [c], adapter });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
});

test('an adapter error is a failure, not a crash', async () => {
  const adapter = fakeAdapter(async () => { throw new Error('RAG endpoint down'); });
  const r = await run({ cases: [ANSWERABLE], adapter });
  assert.equal(r.passed, false);
  assert.match(r.failures[0], /RAG endpoint down/);
});

test('skips when there are no grounding cases', async () => {
  const r = await run({ cases: [{ id: 'x', kind: 'redaction' }], adapter: fakeAdapter(async () => ({ text: '' })) });
  assert.equal(r.skipped, true);
});
