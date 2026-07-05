import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeCitations, parseClaimCitations, detectAuthorYear, detectCitations,
} from '../src/lib/citations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Data-driven: every supported style in the fixture must detect exactly ──
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'datasets', 'fixtures', 'citation-styles.json'), 'utf8'));

for (const item of fixture.items.filter(i => !i.knownGap)) {
  test(`fixture style: ${item.style}`, () => {
    assert.deepEqual(detectCitations(item.text), item.expected);
  });
}

test('fixture still tracks number-adjacent-superscript as the only known gap', () => {
  assert.deepEqual(fixture.items.filter(i => i.knownGap).map(i => i.style),
    ['number-adjacent-superscript']);
});

// ── normalizeCitations guards ──
test('decimal values are never bracketed', () => {
  const out = normalizeCitations('the p-value was 0.17 and the mean was 4.13 overall. ');
  assert.ok(!out.includes('['), out);
});

test('numbers above 200 are treated as data, not citations', () => {
  const out = normalizeCitations('enrolled patients.250 across sites ');
  assert.ok(!out.includes('['), out);
});

test('letter-glued single number stays an identifier (ACR20)', () => {
  const out = normalizeCitations('the ACR20 response was higher ');
  assert.ok(!out.includes('['), out);
});

test('letter-glued list converts (outcomes1,2)', () => {
  const out = normalizeCitations('these outcomes were consistent1,2 across trials ');
  assert.ok(out.includes('consistent[1,2]'), out);
});

// ── parseClaimCitations ──
test('parseClaimCitations expands ranges and dedupes across markers', () => {
  assert.deepEqual(parseClaimCitations('claim [1,3-5] and again [3] end'), [1, 3, 4, 5]);
});

test('parseClaimCitations handles en-dash ranges', () => {
  assert.deepEqual(parseClaimCitations('claim [4–6]'), [4, 5, 6]);
});

test('parseClaimCitations returns sorted numbers', () => {
  assert.deepEqual(parseClaimCitations('a [9] b [2]'), [2, 9]);
});

// ── detectAuthorYear ──
test('author-year: narrative two-author "Smith and Jones (2019)"', () => {
  assert.deepEqual(detectAuthorYear('Smith and Jones (2019) reported improvement.'), ['Smith 2019']);
});

test('author-year: year suffix letters are stripped ("2020a")', () => {
  assert.deepEqual(detectAuthorYear('Smith et al. (2020a) reported improvement.'), ['Smith 2020']);
});

test('author-year: duplicate mentions dedupe', () => {
  const text = 'Smith et al. (2020) showed X; later work (Smith et al., 2020) confirmed it.';
  assert.deepEqual(detectAuthorYear(text), ['Smith 2020']);
});

test('author-year: 19th-century years accepted, 21xx rejected', () => {
  assert.deepEqual(detectAuthorYear('Osler (1892) described the syndrome.'), ['Osler 1892']);
  assert.deepEqual(detectAuthorYear('scheduled for review (Smith, 2150).'), []);
});

test('author-year: lowercase names never match', () => {
  assert.deepEqual(detectAuthorYear('the trial began in 2019 as planned (see protocol 2020)'), []);
});

// ── detectCitations combined output ──
test('numeric citations come first, then author-year keys', () => {
  const got = detectCitations('proven effective.1,2 as shown by Smith et al. (2020)');
  assert.deepEqual(got, [1, 2, 'Smith 2020']);
});
