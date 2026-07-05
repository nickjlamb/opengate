import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAdapter, loadAdapter } from '../src/lib/adapter.mjs';

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'opengate-adapters-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

async function writeAdapter(name, source) {
  const path = join(dir, name);
  await writeFile(path, source);
  return path;
}

const VALID = `
export const meta = { name: 'valid-dummy' };
export const onlineAvailable = () => false;
export const onlineConfigHint = () => 'hint';
export async function splitClaims() { return { claims: [] }; }
export async function analyzeBatch() { return { claims: [] }; }
`;

// ── validateAdapter ──
test('validateAdapter: lists every missing required export', () => {
  assert.throws(
    () => validateAdapter({}, 'empty'),
    (err) => ['splitClaims', 'analyzeBatch', 'onlineAvailable', 'onlineConfigHint']
      .every(fn => err.message.includes(`missing required export: ${fn}()`))
  );
});

test('validateAdapter: flags a non-function optional export', () => {
  const mod = {
    splitClaims() {}, analyzeBatch() {}, onlineAvailable() {}, onlineConfigHint() {},
    runModel: 'not-a-function',
  };
  assert.throws(() => validateAdapter(mod), /optional export runModel is not a function/);
});

test('validateAdapter: a minimal valid module passes silently', () => {
  const mod = { splitClaims() {}, analyzeBatch() {}, onlineAvailable() {}, onlineConfigHint() {} };
  validateAdapter(mod); // must not throw
});

// ── loadAdapter ──
test('loadAdapter: default is the bundled RefCheckr reference adapter', async () => {
  delete process.env.OPENGATE_ADAPTER;
  const a = await loadAdapter();
  assert.equal(a.name, 'refcheckr');
});

test('loadAdapter: explicit spec wins and meta.name is used', async () => {
  const path = await writeAdapter('valid.mjs', VALID);
  const a = await loadAdapter(path);
  assert.equal(a.name, 'valid-dummy');
});

test('loadAdapter: spec override beats OPENGATE_ADAPTER env', async () => {
  const envPath = await writeAdapter('env-adapter.mjs', VALID.replace('valid-dummy', 'from-env'));
  const argPath = await writeAdapter('arg-adapter.mjs', VALID.replace('valid-dummy', 'from-arg'));
  process.env.OPENGATE_ADAPTER = envPath;
  try {
    const a = await loadAdapter(argPath);
    assert.equal(a.name, 'from-arg');
    const b = await loadAdapter();
    assert.equal(b.name, 'from-env');
  } finally {
    delete process.env.OPENGATE_ADAPTER;
  }
});

test('loadAdapter: missing optional hooks get safe defaults', async () => {
  const path = await writeAdapter('minimal.mjs', VALID);
  const a = await loadAdapter(path);
  assert.equal(a.runModel(), null);
  assert.deepEqual(a.callLatencies(), []);
  assert.equal(a.tokenTotals().calls, 0);
  a.resetTiming(); // no-ops must be callable
  a.resetTokens();
});

test('loadAdapter: falls back to filename when meta.name is absent', async () => {
  const path = await writeAdapter('anon-system.mjs', VALID.replace(/export const meta.*\n/, ''));
  const a = await loadAdapter(path);
  assert.equal(a.name, 'anon-system');
});

test('loadAdapter: malformed adapter throws with the source path', async () => {
  const path = await writeAdapter('broken.mjs', 'export const onlineAvailable = () => false;');
  await assert.rejects(loadAdapter(path), (err) =>
    err.message.includes('Invalid adapter') && err.message.includes('broken.mjs'));
});

test('loadAdapter: nonexistent path throws a load error', async () => {
  await assert.rejects(loadAdapter(join(dir, 'nope.mjs')), /Could not load adapter/);
});
