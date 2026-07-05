// The HTTP adapter reads its config at import time, so each scenario imports a
// fresh copy via a cache-busting query string after setting the environment.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const HTTP_ADAPTER = new URL('../src/adapters/http.mjs', import.meta.url).href;
let importCount = 0;

async function loadHttp(configPath) {
  if (configPath == null) delete process.env.OPENGATE_HTTP_CONFIG;
  else process.env.OPENGATE_HTTP_CONFIG = configPath;
  return import(`${HTTP_ADAPTER}?v=${++importCount}`);
}

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'opengate-http-')); });
after(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OPENGATE_HTTP_CONFIG;
});

async function writeConfig(name, obj) {
  const path = join(dir, name);
  await writeFile(path, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return path;
}

test('no config file: offline with a "no config found" hint', async () => {
  const mod = await loadHttp(join(dir, 'missing.json'));
  assert.equal(mod.onlineAvailable(), false);
  assert.match(mod.onlineConfigHint(), /no config found/);
});

test('malformed JSON: offline with a parse hint', async () => {
  const path = await writeConfig('bad.json', '{ not json');
  const mod = await loadHttp(path);
  assert.equal(mod.onlineAvailable(), false);
  assert.match(mod.onlineConfigHint(), /could not parse/);
});

test('unset ${ENV} placeholder: hint names the missing variable', async () => {
  delete process.env.OPENGATE_TEST_MISSING_URL;
  const path = await writeConfig('env.json', {
    name: 'x', baseUrl: '${OPENGATE_TEST_MISSING_URL}',
    endpoints: { splitClaims: '/a', analyzeBatch: '/b' },
  });
  const mod = await loadHttp(path);
  assert.equal(mod.onlineAvailable(), false);
  assert.match(mod.onlineConfigHint(), /OPENGATE_TEST_MISSING_URL/);
});

test('missing endpoints: offline with an endpoints hint', async () => {
  const path = await writeConfig('noend.json', { name: 'x', baseUrl: 'http://localhost:1' });
  const mod = await loadHttp(path);
  assert.equal(mod.onlineAvailable(), false);
  assert.match(mod.onlineConfigHint(), /endpoints/);
});

test('valid config: online, named from config, model from modelEnv', async () => {
  process.env.OPENGATE_TEST_BASE = 'http://localhost:9';
  process.env.OPENGATE_TEST_MODEL = 'model-under-test';
  const path = await writeConfig('ok.json', {
    name: 'configured-system', baseUrl: '${OPENGATE_TEST_BASE}',
    endpoints: { splitClaims: '/a', analyzeBatch: '/b' },
    modelEnv: 'OPENGATE_TEST_MODEL',
  });
  const mod = await loadHttp(path);
  assert.equal(mod.onlineAvailable(), true);
  assert.equal(mod.meta.name, 'configured-system');
  assert.equal(mod.runModel(), 'model-under-test');
});

test('round-trip against a live server: transport, latency, and token capture', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      assert.equal(req.headers['x-test-auth'], 'token-123'); // headers forwarded
      if (req.url === '/split') {
        res.end(JSON.stringify({ claims: ['c1'] }));
      } else {
        res.end(JSON.stringify({
          claims: [{ individual_analyses: [{ verdict: 'strong_support' }] }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }));
      }
    });
  });
  await new Promise((ok) => server.listen(0, ok));
  const port = server.address().port;
  try {
    process.env.OPENGATE_TEST_TOKEN = 'token-123';
    const path = await writeConfig('live.json', {
      name: 'live', baseUrl: `http://localhost:${port}`,
      headers: { 'X-Test-Auth': '${OPENGATE_TEST_TOKEN}' },
      endpoints: { splitClaims: '/split', analyzeBatch: '/verify' },
    });
    const mod = await loadHttp(path);
    assert.equal(mod.onlineAvailable(), true);

    mod.resetTiming();
    mod.resetTokens();
    const split = await mod.splitClaims('some text');
    assert.deepEqual(split.claims, ['c1']);
    const verdict = await mod.analyzeBatch({ claims: ['c1'] });
    assert.equal(verdict.claims[0].individual_analyses[0].verdict, 'strong_support');

    assert.equal(mod.callLatencies().length, 2);
    assert.ok(mod.callLatencies().every((ms) => ms >= 0));
    const tok = mod.tokenTotals();
    assert.equal(tok.calls, 1); // only the verify response carried usage
    assert.equal(tok.prompt_tokens, 100);
    assert.equal(tok.total_tokens, 120);
  } finally {
    server.close();
  }
});

test('HTTP error surfaces the server message', async () => {
  const server = createServer((_req, res) => {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'bad token' }));
  });
  await new Promise((ok) => server.listen(0, ok));
  try {
    const path = await writeConfig('err.json', {
      name: 'err', baseUrl: `http://localhost:${server.address().port}`,
      endpoints: { splitClaims: '/a', analyzeBatch: '/b' },
    });
    const mod = await loadHttp(path);
    await assert.rejects(mod.splitClaims('x'), /bad token/);
  } finally {
    server.close();
  }
});
