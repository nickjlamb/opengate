import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSimplification, contains } from '../src/lib/simplification-check.mjs';

const text = 'Start ferrous sulfate 200 mg twice daily. Repeat the blood count in 8 weeks.';
const anchors = [{ value: '200 mg', aliases: ['200mg', '200 milligrams'] }, { value: '8 weeks' }];

test('dose written out or hyphenated still counts as the anchor', () => {
  for (const out of [
    'Take a 200-milligram tablet of ferrous sulfate twice a day; recheck in 8 weeks.',
    'Take 200 milligram tablets twice a day; recheck in 8 weeks.',
    'Take 200 milligrams twice a day; recheck in 8 weeks.',
    'Take 200 mg twice a day; recheck in 8 weeks.',
  ]) assert.deepEqual(checkSimplification({ output: out, text, anchors }).anchorsMissed, [], out);
});

test('a genuinely missing dose is still caught', () => {
  const r = checkSimplification({ output: 'Take ferrous sulfate twice a day; recheck in 8 weeks.', text, anchors });
  assert.deepEqual(r.anchorsMissed, ['200 mg']);
});

test('a different dose does not match', () => {
  assert.equal(contains('Take 20 milligrams', '200 mg'), false);
  assert.equal(contains('Take 2000 mg', '200 mg'), false);
});

test('numbered-list markers are not fabricated numbers', () => {
  const out = '1. Take 200 mg twice a day.\n2. Recheck in 8 weeks.\n3. Ask if unsure.\n4. Keep taking it.';
  assert.deepEqual(checkSimplification({ output: out, text, anchors }).fabricated, []);
});

test('an invented number inside a list item is still caught', () => {
  const out = '1. Take 200 mg twice a day.\n2. Normal ferritin is above 30.';
  assert.deepEqual(checkSimplification({ output: out, text, anchors }).fabricated, ['30']);
});
