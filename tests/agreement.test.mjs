// Cohen's κ is the headline number of exp-1. A wrong implementation would put a
// wrong number in a paper, so it is tested against worked examples with known
// answers rather than against itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cohensKappa } from '../paper/exp1/agreement.mjs';

const rep = (pair, n) => Array.from({ length: n }, () => pair);

test('κ matches the textbook worked example (po .70, pe .50, κ .40)', () => {
  // 50 items: 20 both-yes, 15 both-no, 5 and 10 split.
  const pairs = [
    ...rep(['yes', 'yes'], 20),
    ...rep(['yes', 'no'], 5),
    ...rep(['no', 'yes'], 10),
    ...rep(['no', 'no'], 15),
  ];
  const k = cohensKappa(pairs);
  assert.equal(k.observedAgreement, 0.7);
  assert.equal(k.expectedAgreement, 0.5);
  assert.equal(k.kappa, 0.4);
  assert.equal(k.n, 50);
});

test('perfect agreement is κ = 1', () => {
  const k = cohensKappa([...rep(['a', 'a'], 10), ...rep(['b', 'b'], 10)]);
  assert.equal(k.observedAgreement, 1);
  assert.equal(k.kappa, 1);
});

test('chance-level agreement is κ ≈ 0', () => {
  // Raters agree exactly as often as their marginals predict.
  const pairs = [
    ...rep(['a', 'a'], 25), ...rep(['a', 'b'], 25),
    ...rep(['b', 'a'], 25), ...rep(['b', 'b'], 25),
  ];
  const k = cohensKappa(pairs);
  assert.equal(k.observedAgreement, 0.5);
  assert.equal(k.expectedAgreement, 0.5);
  assert.equal(k.kappa, 0);
});

test('systematic disagreement is negative κ', () => {
  const k = cohensKappa([...rep(['a', 'b'], 10), ...rep(['b', 'a'], 10)]);
  assert.ok(k.kappa < 0, `expected negative κ, got ${k.kappa}`);
  assert.equal(k.band, 'worse than chance');
});

test('high raw agreement on a lopsided task still yields a modest κ', () => {
  // The trap this experiment must not fall into: 90% agreement looks impressive,
  // but when 95% of items are one class, chance alone gets you most of the way.
  // This is why the binary tasks in the pack are deliberately balanced.
  const pairs = [
    ...rep(['no', 'no'], 90),
    ...rep(['yes', 'yes'], 1),
    ...rep(['yes', 'no'], 5),
    ...rep(['no', 'yes'], 4),
  ];
  const k = cohensKappa(pairs);
  assert.equal(k.observedAgreement, 0.91);
  assert.ok(k.kappa < 0.2, `expected κ < 0.2 on a lopsided task, got ${k.kappa}`);
});

test('the 95% confidence interval brackets κ and narrows as n grows', () => {
  const small = cohensKappa([...rep(['a', 'a'], 8), ...rep(['b', 'b'], 8), ...rep(['a', 'b'], 4)]);
  const large = cohensKappa([...rep(['a', 'a'], 80), ...rep(['b', 'b'], 80), ...rep(['a', 'b'], 40)]);
  assert.ok(small.ci95[0] <= small.kappa && small.kappa <= small.ci95[1]);
  assert.equal(small.kappa, large.kappa, 'same proportions → same κ');
  const width = (c) => c.ci95[1] - c.ci95[0];
  assert.ok(width(large) < width(small), 'more items → a tighter interval');
});

test('κ is undefined for an empty set rather than silently 0', () => {
  assert.equal(cohensKappa([]), null);
});
