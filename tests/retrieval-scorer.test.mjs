import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/scorers/retrieval.mjs';

function fakeAdapter(record) {
  return {
    name: 'fake',
    capabilities: { qa: false, redaction: false, simplify: false, retrieval: true },
    onlineAvailable: () => true,
    onlineConfigHint: () => '',
    resetTiming: () => {},
    callLatencies: () => [],
    fetchRecord: async () => (record instanceof Error ? Promise.reject(record) : { record }),
  };
}

// A faithful record for a two-author paper.
const GOOD = {
  pmid: '31904519', title: 'Teprotumumab for Thyroid Eye Disease',
  authors: ['Terry J Smith', 'George J Kahaly'], year: '2020',
  abstract_sections: [{ label: 'RESULTS', text: 'Proptosis responded in most patients at week 24.' }],
};

const CASE = {
  id: 'r1', kind: 'retrieval', recordId: '31904519', recordType: 'pubmed',
  requireFields: ['title', 'authors', 'year'],
  anchors: [
    { field: 'authors', contains: 'Smith' },
    { field: 'authors', minCount: 2 },
    { field: 'year', equals: '2020' },
    { field: 'abstract_sections', contains: 'proptosis responded' },
  ],
};

test('skips without the retrieval capability', async () => {
  const adapter = { ...fakeAdapter(GOOD), capabilities: { retrieval: false } };
  const r = await run({ cases: [CASE], adapter });
  assert.equal(r.skipped, true);
});

test('a faithful record passes every check', async () => {
  const r = await run({ cases: [CASE], adapter: fakeAdapter(GOOD) });
  assert.equal(r.passed, true, JSON.stringify(r.failures));
  assert.equal(r.metrics.fidelity, 1);
  assert.equal(r.metrics.failed_checks, 0);
});

test('a dropped author surname is a named fidelity failure', async () => {
  const r = await run({ cases: [CASE], adapter: fakeAdapter({ ...GOOD, authors: ['George J Kahaly'] }) });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /authors.*"Smith"/.test(f)), JSON.stringify(r.failures));
  assert.ok(r.failures.some(f => /minCount/.test(f)));
});

test('collapsed single-author record (not an array) fails structurally', async () => {
  const r = await run({ cases: [CASE], adapter: fakeAdapter({ ...GOOD, authors: { name: 'Terry J Smith' } }) });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /authors is not an array/.test(f)), JSON.stringify(r.failures));
});

test('"[object Object]" leakage is caught', async () => {
  const r = await run({ cases: [CASE], adapter: fakeAdapter({ ...GOOD, title: '[object Object]' }) });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /\[object Object\]/.test(f)));
});

test('a missing required field is a named failure', async () => {
  const rec = { ...GOOD }; delete rec.year;
  const r = await run({ cases: [{ ...CASE, anchors: [] }], adapter: fakeAdapter(rec) });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /missing field "year"/.test(f)));
});

test('wrong year is caught by an equals anchor', async () => {
  const r = await run({ cases: [CASE], adapter: fakeAdapter({ ...GOOD, year: '2019' }) });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /year = "2019", expected "2020"/.test(f)));
});

test('a truncated abstract (distinctive phrase gone) is caught', async () => {
  const r = await run({ cases: [CASE], adapter: fakeAdapter({ ...GOOD, abstract_sections: [{ label: 'RESULTS', text: 'Proptosis' }] }) });
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => /abstract_sections missing/.test(f)));
});

test('a fetch error is a failure, not a crash', async () => {
  const r = await run({ cases: [CASE], adapter: fakeAdapter(new Error('NCBI 429')) });
  assert.equal(r.passed, false);
  assert.match(r.failures[0], /NCBI 429/);
});

test('skips when there are no retrieval cases', async () => {
  const r = await run({ cases: [{ id: 'x', kind: 'redaction' }], adapter: fakeAdapter(GOOD) });
  assert.equal(r.skipped, true);
});
