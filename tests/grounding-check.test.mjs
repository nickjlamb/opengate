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

// Regression: the marker list matched only passive phrasing ("not stated"), so
// the far more common active abstention ("the context does not state the price")
// was scored as a fabrication — a false positive against a correctly behaving
// system. Found while building the exp-2 frozen corpus.
test('unanswerable: active-voice abstention phrasings count as abstaining', () => {
  const phrasings = [
    'The context does not state the annual price of the Enterprise plan.',
    "The provided context doesn't specify Enterprise pricing.",
    'The policy does not mention an annual Enterprise price.',
    'There is no mention of the Enterprise plan price in the context.',
    'The Enterprise plan price is not specified.',
  ];
  for (const answer of phrasings) {
    const r = checkGrounding({
      answer,
      context: 'Pro plan has a 30-day trial. Contact sales for volume discounts.',
      answerable: false,
    });
    assert.equal(r.abstained, true, `should abstain: ${answer}`);
    assert.equal(r.grounded, true, `should be grounded: ${answer}`);
  }
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
