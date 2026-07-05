import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jaccard, exactSetMatch, precisionRecallF1, verdictAccuracy,
  confusionMatrix, VERDICT_SCALE, mean, stdev, percentile,
  normText, claimMatch,
} from '../src/lib/metrics.mjs';

test('jaccard: identical sets → 1', () => {
  assert.equal(jaccard([1, 2, 3], [3, 2, 1]), 1);
});

test('jaccard: disjoint sets → 0', () => {
  assert.equal(jaccard([1, 2], [3, 4]), 0);
});

test('jaccard: partial overlap', () => {
  assert.equal(jaccard([1, 2], [2, 3]), 1 / 3);
});

test('jaccard: both empty → 1 (vacuous agreement)', () => {
  assert.equal(jaccard([], []), 1);
});

test('exactSetMatch: order-insensitive', () => {
  assert.equal(exactSetMatch([2, 1], [1, 2]), true);
});

test('exactSetMatch: subset is not a match', () => {
  assert.equal(exactSetMatch([1], [1, 2]), false);
  assert.equal(exactSetMatch([1, 2], [1]), false);
});

test('exactSetMatch: works for string keys', () => {
  assert.equal(exactSetMatch(['Smith 2020'], ['Smith 2020']), true);
  assert.equal(exactSetMatch(['Smith 2020'], ['Jones 2019']), false);
});

test('precisionRecallF1: perfect match', () => {
  const r = precisionRecallF1(['a', 'b'], ['a', 'b']);
  assert.deepEqual([r.precision, r.recall, r.f1], [1, 1, 1]);
});

test('precisionRecallF1: nothing predicted, gold present → recall 0', () => {
  const r = precisionRecallF1([], ['a']);
  assert.equal(r.recall, 0);
  assert.equal(r.precision, 0);
  assert.equal(r.f1, 0);
});

test('precisionRecallF1: nothing predicted, nothing gold → perfect', () => {
  const r = precisionRecallF1([], []);
  assert.equal(r.precision, 1);
  assert.equal(r.recall, 1);
});

test('precisionRecallF1: greedy matching is one-to-one', () => {
  // Two identical predictions cannot both claim the single gold item.
  const r = precisionRecallF1(['a', 'a'], ['a']);
  assert.equal(r.tp, 1);
  assert.equal(r.fp, 1);
  assert.equal(r.fn, 0);
});

test('verdictAccuracy: exact and adjacent on the six-point scale', () => {
  const pairs = [
    { predicted: 'strong_support', gold: 'strong_support' },   // exact
    { predicted: 'partial_support', gold: 'strong_support' },  // adjacent (distance 1)
    { predicted: 'contradicted', gold: 'strong_support' },     // neither
  ];
  const acc = verdictAccuracy(pairs);
  assert.equal(acc.n, 3);
  assert.equal(acc.exact, 1 / 3);
  assert.equal(acc.adjacent, 2 / 3);
});

test('verdictAccuracy: empty pairs does not divide by zero', () => {
  const acc = verdictAccuracy([]);
  assert.equal(acc.n, 0);
  assert.equal(acc.exact, 0);
  assert.equal(acc.adjacent, 0);
});

test('confusionMatrix: places counts at [gold][predicted]', () => {
  const pairs = [
    { predicted: 'not_supported', gold: 'strong_support' },
    { predicted: 'strong_support', gold: 'strong_support' },
  ];
  const { labels, matrix } = confusionMatrix(pairs);
  const g = labels.indexOf('strong_support');
  assert.equal(matrix[g][labels.indexOf('not_supported')], 1);
  assert.equal(matrix[g][labels.indexOf('strong_support')], 1);
});

test('confusionMatrix: unknown labels are ignored, not thrown', () => {
  const { matrix } = confusionMatrix([{ predicted: 'bogus', gold: 'strong_support' }]);
  assert.equal(matrix.flat().reduce((a, b) => a + b, 0), 0);
});

test('VERDICT_SCALE has six ordered verdicts', () => {
  assert.equal(VERDICT_SCALE.length, 6);
  assert.equal(VERDICT_SCALE[0], 'strong_support');
  assert.equal(VERDICT_SCALE[5], 'contradicted');
});

test('mean and stdev basics', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([]), 0);
  assert.equal(stdev([5]), 0);
  assert.ok(Math.abs(stdev([2, 4, 6]) - Math.sqrt(8 / 3)) < 1e-12);
});

test('percentile: empty → null, filters non-finite', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([NaN, Infinity], 50), null);
});

test('percentile: p50 and p95 of a known array', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 50), 6);
  assert.equal(percentile(xs, 95), 10);
  assert.equal(percentile([42], 50), 42);
});

test('normText lowercases and strips non-alphanumerics', () => {
  assert.equal(normText('Hazard Ratio: 0.80 (95% CI)!'), 'hazardratio08095ci');
});

test('claimMatch: exact and containment ≥12 normalised chars', () => {
  assert.equal(claimMatch('The drug reduced mortality', 'the drug reduced mortality.'), true);
  assert.equal(claimMatch('reduced mortality significantly', 'The drug reduced mortality significantly in adults'), true);
});

test('claimMatch: short fragments do not match', () => {
  assert.equal(claimMatch('the drug', 'the drug reduced mortality significantly in adults'), false);
  assert.equal(claimMatch('', 'anything'), false);
});
