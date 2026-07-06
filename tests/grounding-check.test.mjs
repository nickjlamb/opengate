import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGrounding } from '../src/lib/grounding-check.mjs';

const CTX = 'Customers may request a full refund within 30 days. There is no restocking fee.';

test('a correct, grounded answer is grounded', () => {
  const r = checkGrounding({
    answer: 'You have 30 days to request a refund, with no restocking fee.',
    context: CTX,
    anchors: [{ value: '30 days' }, { value: 'no restocking fee' }],
  });
  assert.equal(r.grounded, true, JSON.stringify(r.issues));
  assert.deepEqual(r.issues, []);
});

test('a missing fact is reported', () => {
  const r = checkGrounding({
    answer: 'You have 30 days to request a refund.',
    context: CTX,
    anchors: [{ value: '30 days' }, { value: 'no restocking fee' }],
  });
  assert.equal(r.grounded, false);
  assert.deepEqual(r.anchorsMissed, ['no restocking fee']);
});

test('a fabricated number is reported', () => {
  const r = checkGrounding({
    answer: '30 days, no restocking fee, plus a 90-day extension.',
    context: CTX,
    anchors: [{ value: '30 days' }, { value: 'no restocking fee' }],
  });
  assert.equal(r.grounded, false);
  assert.deepEqual(r.ungroundedNumbers, ['90']);
});

test('context numbers are not flagged; aliases satisfy anchors', () => {
  const r = checkGrounding({
    answer: 'Refund within 30-day window; no fee.',
    context: CTX,
    anchors: [{ value: '30 days', aliases: ['30-day'] }, { value: 'no restocking fee', aliases: ['no fee'] }],
  });
  assert.equal(r.grounded, true, JSON.stringify(r.issues));
});

test('unanswerable: abstaining is grounded (contraction-aware)', () => {
  const r = checkGrounding({
    answer: "That isn't in the provided context — contact sales.",
    context: 'Pro plan has a 30-day trial.',
    answerable: false,
  });
  assert.equal(r.grounded, true);
  assert.equal(r.abstained, true);
});

test('unanswerable: fabricating instead of abstaining fails', () => {
  const r = checkGrounding({
    answer: 'The Enterprise plan is $499 per year.',
    context: 'Pro plan has a 30-day trial.',
    answerable: false,
  });
  assert.equal(r.grounded, false);
  assert.ok(r.issues.some(i => /did not abstain/.test(i)));
});

test('context may be an array of passages', () => {
  const r = checkGrounding({
    answer: '30 days, no fee.',
    context: ['Refund within 30 days.', 'There is no restocking fee.'],
    anchors: [{ value: '30 days' }, { value: 'no fee' }],
  });
  assert.equal(r.grounded, true, JSON.stringify(r.issues));
});
