import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initFiles } from '../src/lib/init.mjs';

test('scaffolds the files a working setup needs', () => {
  const paths = initFiles().map(f => f.path);
  for (const p of [
    'opengate.http.json',
    'datasets/cases/example-grounding.json',
    'datasets/cases/example-grounding-unanswerable.json',
    '.github/workflows/opengate.yml',
    'OPENGATE.md',
  ]) assert.ok(paths.includes(p), `missing ${p}`);
});

test('scaffolded JSON files are valid and well-formed cases', () => {
  const byPath = Object.fromEntries(initFiles().map(f => [f.path, f.content]));
  const cfg = JSON.parse(byPath['opengate.http.json']);
  assert.equal(cfg.endpoints.answer, '/api/answer');
  assert.ok(cfg.baseUrl.includes('${'), 'uses an env placeholder');

  const c1 = JSON.parse(byPath['datasets/cases/example-grounding.json']);
  assert.equal(c1.kind, 'grounding');
  assert.ok(Array.isArray(c1.answerAnchors) && c1.answerAnchors.length > 0);

  const c2 = JSON.parse(byPath['datasets/cases/example-grounding-unanswerable.json']);
  assert.equal(c2.answerable, false);
});

test('the workflow pins the Action and uses the bundled http adapter', () => {
  const wf = initFiles().find(f => f.path === '.github/workflows/opengate.yml').content;
  assert.ok(wf.includes('nickjlamb/opengate@v0'));
  assert.ok(/adapter:\s*http/.test(wf));
  assert.ok(wf.includes('OPENGATE_HTTP_CONFIG'));
});
