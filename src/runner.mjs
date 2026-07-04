#!/usr/bin/env node
// OpenGATE eval runner.
//
//   node src/runner.mjs            # offline scorers only
//   node src/runner.mjs --online   # also run scorers that hit the API
//   node src/runner.mjs --ci       # exit non-zero on failure or regression
//   node src/runner.mjs --baseline # save this run as results/baseline.json
//
// Discovers gold cases (datasets/cases/*.json) and fixtures (datasets/fixtures/*.json),
// runs each scorer, prints a summary, writes a timestamped results file, and
// compares headline metrics against results/baseline.json to catch regressions.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadAdapter } from './lib/adapter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = join(__dirname, '..');
const CASES_DIR = join(EVAL_ROOT, 'datasets', 'cases');
const FIX_DIR = join(EVAL_ROOT, 'datasets', 'fixtures');
const RESULTS_DIR = join(EVAL_ROOT, 'results');

const args = new Set(process.argv.slice(2));
const ONLINE = args.has('--online');
const CI = args.has('--ci');
const SAVE_BASELINE = args.has('--baseline');

const SCORERS = [
  './scorers/citation-detection.mjs',
  './scorers/claim-extraction.mjs',
  './scorers/verdict-accuracy.mjs',
];

async function loadJsonDir(dir, { skipPrefix } = {}) {
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.json')) continue;
    if (skipPrefix && f.startsWith(skipPrefix)) continue;
    const key = f.replace(/\.json$/, '');
    out[key] = JSON.parse(await readFile(join(dir, f), 'utf8'));
  }
  return out;
}

function gitSha() {
  try { return execSync('git rev-parse --short HEAD', { cwd: EVAL_ROOT }).toString().trim(); }
  catch { return 'unknown'; }
}

function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
// Percent-format rates/scores; show counts (n_pairs, totalLeaked, repeats, …) raw.
function isRateKey(k) { return /(rate|accuracy|precision|recall|f1|jaccard|consistency|adjacency|exact|share|score)/i.test(k); }

async function main() {
  const casesMap = await loadJsonDir(CASES_DIR, { skipPrefix: '_' });
  const cases = Object.values(casesMap);
  const fixtures = await loadJsonDir(FIX_DIR);

  if (cases.length === 0) {
    console.error('No gold cases found in datasets/cases/. Add one (copy _template.json).');
    process.exit(2);
  }

  // Load and validate the adapter up front — fail fast on a malformed one,
  // even for offline runs, so a broken config never produces a partial scorecard.
  let adapter;
  try {
    adapter = await loadAdapter();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  console.log(`\nOpenGATE — ${cases.length} case(s), online=${ONLINE}, adapter=${adapter.name}, sha=${gitSha()}\n`);

  const results = [];
  for (const path of SCORERS) {
    const mod = await import(path);
    const isOnline = mod.meta?.mode === 'online';
    if (isOnline && !ONLINE) {
      results.push({ id: mod.meta.id, skipped: true, reason: 'online scorer (pass --online)' });
      continue;
    }
    const r = await mod.run({ cases, fixtures, adapter });
    results.push({ id: mod.meta.id, ...r });
  }

  // ── Summary table ──
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ⊘ ${r.id.padEnd(20)} SKIPPED — ${r.reason}`);
      continue;
    }
    const status = r.passed ? '✓' : '✗';
    console.log(`  ${status} ${r.id.padEnd(20)} ${r.passed ? 'PASS' : 'FAIL'}`);
    for (const [k, v] of Object.entries(r.metrics || {})) {
      const val = typeof v === 'number' ? (isRateKey(k) ? fmtPct(v) : String(v)) : JSON.stringify(v);
      console.log(`      ${k.padEnd(26)} ${val}`);
    }
    for (const f of r.failures || []) console.log(`      ✗ ${f}`);
  }

  // ── Persist ──
  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot = {
    timestamp: new Date().toISOString(),
    sha: gitSha(),
    online: ONLINE,
    adapter: adapter.name,
    results: results.map(({ detail, ...rest }) => rest), // drop bulky detail from snapshot
  };
  await writeFile(join(RESULTS_DIR, `${stamp}.json`), JSON.stringify({ ...snapshot, results }, null, 2));
  if (SAVE_BASELINE) {
    await writeFile(join(RESULTS_DIR, 'baseline.json'), JSON.stringify(snapshot, null, 2));
    console.log('\n  saved baseline.json');
  }

  // ── Regression check vs baseline ──
  let regressed = false;
  const baselinePath = join(RESULTS_DIR, 'baseline.json');
  if (existsSync(baselinePath) && !SAVE_BASELINE) {
    const base = JSON.parse(await readFile(baselinePath, 'utf8'));
    const baseById = Object.fromEntries(base.results.map(r => [r.id, r]));
    console.log('\n  vs baseline:');
    for (const r of results) {
      const b = baseById[r.id];
      if (!b || !r.metrics || !b.metrics) continue;
      for (const [k, v] of Object.entries(r.metrics)) {
        if (typeof v !== 'number' || typeof b.metrics[k] !== 'number') continue;
        const delta = v - b.metrics[k];
        if (Math.abs(delta) < 1e-9) continue;
        const arrow = delta > 0 ? '▲' : '▼';
        // Only rate metrics gate regressions (higher = better); counts shown for info.
        if (isRateKey(k)) {
          if (delta < -1e-9) regressed = true;
          console.log(`      ${r.id}.${k}: ${arrow} ${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`);
        } else {
          console.log(`      ${r.id}.${k}: ${arrow} ${delta > 0 ? '+' : ''}${delta}`);
        }
      }
    }
  }

  const anyFail = results.some(r => !r.skipped && r.passed === false);
  console.log('');
  if (CI && (anyFail || regressed)) {
    console.error(`CI gate failed (failures=${anyFail}, regression=${regressed}).`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(2); });
