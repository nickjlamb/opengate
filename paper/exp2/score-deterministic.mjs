#!/usr/bin/env node
// exp-2 step 3 — the deterministic arm: OpenGATE's own checkers, 5 repeats.
//
// The point of running it five times is that the result is dull: five
// byte-identical result sets, hashed to prove it. That is the claim under test
// ("a gate you can block a release on"), and it costs nothing and calls nothing.
//
//   node paper/exp2/score-deterministic.mjs [--repeats 5]
//
// Output: paper/exp2/results/deterministic.json

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreItem } from './score-item.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CASES_DIR = resolve(ROOT, 'datasets/cases');
const CORPUS = resolve(HERE, 'corpus/frozen-corpus.json');
const OUT = resolve(HERE, 'results/deterministic.json');

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const REPEATS = Number(arg('--repeats', 5));

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function loadCases() {
  const map = new Map();
  for (const f of readdirSync(CASES_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const c = JSON.parse(readFileSync(resolve(CASES_DIR, f), 'utf8'));
    map.set(c.id, c);
  }
  return map;
}

function main() {
  const cases = loadCases();
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));

  const repeats = [];
  const wallMs = [];

  for (let r = 0; r < REPEATS; r++) {
    const t0 = performance.now();
    const scores = corpus.items.map(item => {
      const s = scoreItem(item, cases.get(item.caseId));
      return {
        outputId: item.outputId,
        // The deterministic arm's verdict is binary and its "score" is the same
        // number every time — expressed on [0,1] so it sits alongside the judge
        // scores in the analysis without special-casing.
        //
        // The verdict compared against the judges is the FAITHFULNESS one
        // (anchors + numbers + abstention). The length-contract gate is recorded
        // but excluded: mutation perturbs output shape, and shape is not what a
        // faithfulness judge measures. See score-item.mjs.
        score: s.faithfulnessPass ? 1 : 0,
        pass: s.faithfulnessPass,
        fullGatePass: s.pass,
        // Failure LOCALISATION — the axis a scalar judge score cannot provide.
        issues: s.issues,
        anchorsMissed: s.anchorsMissed,
        ungroundedNumbers: s.ungroundedNumbers,
        contractViolations: s.contractViolations,
        abstained: s.abstained,
      };
    });
    wallMs.push(performance.now() - t0);
    repeats.push({ repeat: r + 1, scores, sha256: sha256(JSON.stringify(scores)) });
  }

  const hashes = [...new Set(repeats.map(r => r.sha256))];
  const identical = hashes.length === 1;

  const payload = {
    arm: 'opengate-deterministic',
    ranAt: new Date().toISOString(),
    corpusSha256: corpus.corpusSha256,
    repeats: REPEATS,
    identicalAcrossRepeats: identical,
    resultSha256: hashes,
    cost: {
      apiCalls: 0,
      tokens: 0,
      usd: 0,
      meanWallMsPerRepeat: Math.round(wallMs.reduce((a, b) => a + b, 0) / wallMs.length * 100) / 100,
    },
    runs: repeats,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

  console.error(`deterministic arm → ${OUT}`);
  console.error(`  ${corpus.items.length} outputs × ${REPEATS} repeats`);
  console.error(`  identical across repeats: ${identical ? 'YES' : 'NO — investigate, this is the whole claim'}`);
  console.error(`  ${payload.cost.meanWallMsPerRepeat} ms per repeat, 0 API calls, $0`);
  if (!identical) process.exit(1);
}

main();
