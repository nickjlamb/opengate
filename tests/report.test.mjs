import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/lib/report.mjs';

const base = {
  adapter: 'my-rag', online: true, sha: 'abc1234', timestamp: '2026-07-06T10:00:00Z',
  results: [
    { id: 'grounding', passed: true, metrics: { answer_recall: 0.9, ungrounded_numbers: 1 } },
  ],
};

test('renders a self-contained HTML document', () => {
  const html = renderReport({ ...base, results: [{ id: 'grounding', passed: true, metrics: { answer_recall: 1 } }] });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<script'), 'no scripts');
  assert.ok(html.includes('OpenGATE'));
});

test('overall verdict is PASS when nothing failed, FAIL otherwise', () => {
  const pass = renderReport({ ...base, results: [{ id: 'g', passed: true, metrics: {} }] });
  assert.ok(/verdict v-pass">PASS/.test(pass));
  const fail = renderReport({ ...base, results: [{ id: 'g', passed: false, metrics: {}, failures: ['boom'] }] });
  assert.ok(/verdict v-fail">FAIL/.test(fail));
});

test('rate metrics render as percentages, counts raw', () => {
  const html = renderReport({ ...base, results: [{ id: 'g', passed: true, metrics: { answer_recall: 0.905, ungrounded_numbers: 2 } }] });
  assert.ok(html.includes('90.5%'));
  assert.match(html, />2</); // raw count
});

test('named failures are listed', () => {
  const html = renderReport({ ...base, results: [{ id: 'g', passed: false, metrics: {}, failures: ['GROUNDING g1: missing answer fact "30 days"'] }] });
  assert.ok(html.includes('1 failure'));
  assert.ok(html.includes('missing answer fact'));
});

test('skipped scorers show a SKIPPED badge and reason', () => {
  const html = renderReport({ ...base, results: [{ id: 'retrieval', skipped: true, reason: 'no retrieval cases' }] });
  assert.ok(html.includes('SKIPPED'));
  assert.ok(html.includes('no retrieval cases'));
});

test('deltas vs baseline: improvement and regression arrows', () => {
  const snapshot = { ...base, results: [{ id: 'g', passed: true, metrics: { answer_recall: 0.95 } }] };
  const baseline = { results: [{ id: 'g', metrics: { answer_recall: 0.90 } }] };
  const up = renderReport(snapshot, { baseline });
  assert.ok(up.includes('▲'));
  assert.ok(up.includes('+5.0pp'));

  const down = renderReport({ ...base, results: [{ id: 'g', passed: true, metrics: { answer_recall: 0.85 } }] }, { baseline });
  assert.ok(down.includes('▼'));
  assert.ok(down.includes('-5.0pp'));
});

test('HTML in metrics/failures/reason is escaped (no injection)', () => {
  const html = renderReport({
    ...base,
    results: [{ id: '<img src=x onerror=alert(1)>', passed: false, metrics: { run_model: '<b>evil</b>' }, failures: ['<script>bad</script>'] }],
  });
  assert.ok(!html.includes('<img src=x'), 'id escaped');
  assert.ok(!html.includes('<script>bad'), 'failure escaped');
  assert.ok(html.includes('&lt;script&gt;bad'));
});

test('summary counts passed/failed/skipped', () => {
  const html = renderReport({
    ...base,
    results: [
      { id: 'a', passed: true, metrics: {} },
      { id: 'b', passed: false, metrics: {}, failures: ['x'] },
      { id: 'c', skipped: true, reason: 'r' },
    ],
  });
  assert.ok(html.includes('1 passed · 1 failed · 1 skipped'));
});
