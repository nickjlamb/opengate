// The pure extraction core: per-field normalisation, alias matching, and the
// verdict taxonomy — especially FABRICATED, the extraction hallucination.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkExtraction,
  normalizeDate,
  normalizeMoney,
  normalizeNumber,
  normalizeValue,
} from '../src/lib/extraction-check.mjs';

test('normalizeDate: ISO, written, and slashed forms converge', () => {
  assert.equal(normalizeDate('2026-03-14'), '2026-03-14');
  assert.equal(normalizeDate('14 March 2026'), '2026-03-14');
  assert.equal(normalizeDate('March 14, 2026'), '2026-03-14');
  assert.equal(normalizeDate('14/03/2026'), '2026-03-14'); // day-first
  assert.equal(normalizeDate('03/14/2026'), '2026-03-14'); // month can only be 3
  assert.equal(normalizeDate('1st June 2025'), '2025-06-01');
  // unparseable falls back to folded text, deterministically
  assert.equal(normalizeDate('sometime  in Spring'), 'sometime in spring');
});

test('normalizeMoney: symbols, separators, and decimals → minor units', () => {
  assert.equal(normalizeMoney('£16,000'), '1600000');
  assert.equal(normalizeMoney('16000'), '1600000');
  assert.equal(normalizeMoney('£1,250.50'), '125050');
  assert.equal(normalizeMoney('1250.5 GBP'), '125050');
  assert.equal(normalizeMoney(1250.5), '125050');
  assert.equal(normalizeMoney('-£40'), '-4000');
});

test('normalizeNumber and default folding', () => {
  assert.equal(normalizeNumber('07.50'), '7.5');
  assert.equal(normalizeValue('  Two   Words '), 'two words');
  assert.equal(normalizeValue(true), true);
  assert.equal(normalizeValue(null), null);
  assert.deepEqual(normalizeValue(['A', ' b '], undefined), ['a', 'b']);
});

test('checkExtraction: correct values and correct abstentions pass clean', () => {
  const { issues, counts } = checkExtraction({
    record: { name: 'Jordan  Reeves', date: '14/03/2026', dob: null },
    gold: { name: 'Jordan Reeves', date: '2026-03-14', dob: null },
    normalize: { date: 'date' },
  });
  assert.deepEqual(issues, []);
  assert.equal(counts.correct, 2);
  assert.equal(counts.correctAbstentions, 1);
});

test('checkExtraction: a fabricated field is named — the extraction hallucination', () => {
  const { issues, counts, perField } = checkExtraction({
    record: { dob: '1974-03-02' },
    gold: { dob: null },
  });
  assert.equal(counts.fabricated, 1);
  assert.equal(perField.dob.verdict, 'fabricated');
  assert.match(issues[0], /FABRICATED field "dob": document does not state it/);
});

test('checkExtraction: wrong gates, missed counts but does not gate', () => {
  const { issues, counts } = checkExtraction({
    record: { amount: '£900', reason: null },
    gold: { amount: '£950', reason: 'damp and mould' },
    normalize: { amount: 'money' },
  });
  assert.equal(counts.wrong, 1);
  assert.equal(counts.missed, 1);
  assert.equal(issues.length, 1); // only the WRONG value is a gate failure
  assert.match(issues[0], /WRONG field "amount"/);
});

test('checkExtraction: aliases accept documented wording variants', () => {
  const { issues } = checkExtraction({
    record: { urgency: 'routine' },
    gold: { urgency: 'standard' },
    aliases: { urgency: ['routine', 'non-urgent'] },
  });
  assert.deepEqual(issues, []);
});
