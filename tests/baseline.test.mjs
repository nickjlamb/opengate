import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineFileName, resolveBaseline } from '../src/lib/baseline.mjs';

test('baselineFileName keys by adapter, filesystem-safe', () => {
  assert.equal(baselineFileName('refcheckr'), 'baseline.refcheckr.json');
  assert.equal(baselineFileName('pubcrawl'), 'baseline.pubcrawl.json');
  assert.equal(baselineFileName('My System/2'), 'baseline.my-system-2.json');
  assert.equal(baselineFileName(''), 'baseline.default.json');
  assert.equal(baselineFileName(undefined), 'baseline.default.json');
});

test('per-adapter baseline is preferred when present', () => {
  const r = resolveBaseline('pubcrawl', { perAdapter: true, legacy: true, legacyAdapter: 'refcheckr' });
  assert.deepEqual(r, { file: 'baseline.pubcrawl.json', source: 'per-adapter' });
});

test('legacy baseline is used only for the adapter that wrote it', () => {
  // Current adapter matches the legacy file's adapter → use it.
  assert.deepEqual(
    resolveBaseline('refcheckr', { perAdapter: false, legacy: true, legacyAdapter: 'refcheckr' }),
    { file: 'baseline.json', source: 'legacy' });
});

test('legacy baseline is NOT used cross-adapter (the core bug this fixes)', () => {
  // A PubCrawl run must not be gated against a RefCheckr baseline.
  assert.equal(
    resolveBaseline('pubcrawl', { perAdapter: false, legacy: true, legacyAdapter: 'refcheckr' }),
    null);
});

test('a legacy baseline with no adapter field is not trusted for anyone', () => {
  assert.equal(
    resolveBaseline('refcheckr', { perAdapter: false, legacy: true, legacyAdapter: null }),
    null);
});

test('no baseline present → null (regression check skipped)', () => {
  assert.equal(resolveBaseline('redacta', { perAdapter: false, legacy: false, legacyAdapter: null }), null);
});
