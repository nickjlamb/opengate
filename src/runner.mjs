#!/usr/bin/env node
// OpenGATE eval runner.
//
//   node src/runner.mjs            # offline scorers only
//   node src/runner.mjs --online   # also run scorers that hit the API
//   node src/runner.mjs --ci       # exit non-zero on failure or regression
//   node src/runner.mjs --baseline # save this run as results/baseline.<adapter>.json
//
// Discovers gold cases (datasets/cases/*.json) and fixtures (datasets/fixtures/*.json),
// runs each scorer, prints a summary, writes a timestamped results file, and
// compares headline metrics against the per-adapter baseline
// (results/baseline.<adapter>.json) to catch regressions.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadAdapter } from './lib/adapter.mjs';
import { baselineFileName, resolveBaseline } from './lib/baseline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = join(__dirname, '..');

const argv = process.argv.slice(2);
const args = new Set(argv.filter(a => a.startsWith('-')));
const ONLINE = args.has('--online');
const CI = args.has('--ci');
const SAVE_BASELINE = args.has('--baseline');

// Value-taking flag: `--name <value>`, falling back to an env var.
function argVal(flag, envName) {
  const i = argv.indexOf(flag);
  if (i < 0) return process.env[envName] || undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith('-')) {
    console.error(`${flag} requires a value, e.g. ${flag} <path>`);
    process.exit(2);
  }
  return v;
}

// --adapter <path> overrides the OPENGATE_ADAPTER environment variable.
const ADAPTER_SPEC = argVal('--adapter', 'OPENGATE_ADAPTER');

// --datasets <dir> points at a directory containing cases/ and fixtures/ —
// so third-party repos can keep their gold sets in their own tree.
// --results <dir> relocates snapshots and baseline.json for the same reason.
const DATASETS_SPEC = argVal('--datasets', 'OPENGATE_DATASETS');
const RESULTS_SPEC = argVal('--results', 'OPENGATE_RESULTS');
const DATA_ROOT = DATASETS_SPEC ? resolve(process.cwd(), DATASETS_SPEC) : join(EVAL_ROOT, 'datasets');
const CASES_DIR = join(DATA_ROOT, 'cases');
const FIX_DIR = join(DATA_ROOT, 'fixtures');
// When OpenGATE runs from an installed package (npx / node_modules), snapshots
// must not be written inside the package — default to ./opengate-results in
// the caller's working directory instead.
const RESULTS_DIR = RESULTS_SPEC
  ? resolve(process.cwd(), RESULTS_SPEC)
  : (EVAL_ROOT.includes('node_modules')
      ? join(process.cwd(), 'opengate-results')
      : join(EVAL_ROOT, 'results'));

if (args.has('--help') || args.has('-h')) {
  console.log(`OpenGATE — Open-source evaluation for evidence-grounded AI

Usage: opengate [options]        (or: node src/runner.mjs [options])

Options:
  --online           also run scorers that call the live system
  --baseline         save this run as results/baseline.json
  --ci               exit non-zero on any failure or metric regression
  --adapter <path>   adapter module (overrides OPENGATE_ADAPTER;
                     default: bundled RefCheckr reference adapter)
  --datasets <dir>   directory containing cases/ and fixtures/
                     (overrides OPENGATE_DATASETS; default: bundled datasets/)
  --results <dir>    where to write snapshots and baseline.json
                     (overrides OPENGATE_RESULTS; default: bundled results/)
  -h, --help         show this help
  -v, --version      show version

Environment:
  OPENGATE_ADAPTER        adapter module path
  OPENGATE_DATASETS       datasets directory (cases/ + fixtures/)
  OPENGATE_RESULTS        results directory
  OPENGATE_HTTP_CONFIG    config path for the generic HTTP adapter
  OPENGATE_EVAL_REPEATS   run each verdict pair N times (consistency)
  OPENGATE_EVAL_MODEL     label the deployment's model in the scorecard

Docs: README.md · ADAPTERS.md`);
  process.exit(0);
}

if (args.has('--version') || args.has('-v')) {
  const pkg = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const SCORERS = [
  './scorers/citation-detection.mjs',
  './scorers/claim-extraction.mjs',
  './scorers/verdict-accuracy.mjs',
  './scorers/redaction.mjs',
  './scorers/simplification.mjs',
  './scorers/retrieval.mjs',
  './scorers/grounding.mjs',
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
    adapter = await loadAdapter(ADAPTER_SPEC);
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
    // Baselines are per-adapter — a PubCrawl scorecard must not overwrite a
    // RefCheckr one (they share no metrics).
    const fname = baselineFileName(adapter.name);
    await writeFile(join(RESULTS_DIR, fname), JSON.stringify(snapshot, null, 2));
    console.log(`\n  saved ${fname}`);
  }

  // ── Regression check vs the baseline for THIS adapter ──
  let regressed = false;
  if (!SAVE_BASELINE) {
    const legacyPath = join(RESULTS_DIR, 'baseline.json');
    const perAdapterPath = join(RESULTS_DIR, baselineFileName(adapter.name));
    let legacyAdapter = null;
    if (existsSync(legacyPath)) {
      try { legacyAdapter = JSON.parse(await readFile(legacyPath, 'utf8')).adapter ?? null; } catch { /* ignore */ }
    }
    const chosen = resolveBaseline(adapter.name, {
      perAdapter: existsSync(perAdapterPath),
      legacy: existsSync(legacyPath),
      legacyAdapter,
    });
    if (chosen) {
      const base = JSON.parse(await readFile(join(RESULTS_DIR, chosen.file), 'utf8'));
      const baseById = Object.fromEntries(base.results.map(r => [r.id, r]));
      console.log(`\n  vs baseline (${chosen.file}):`);
      if (chosen.source === 'legacy') {
        console.log(`      note: using legacy baseline.json — re-run --baseline to migrate to ${baselineFileName(adapter.name)}`);
      }
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
  }

  const anyFail = results.some(r => !r.skipped && r.passed === false);
  console.log('');
  if (CI && (anyFail || regressed)) {
    console.error(`CI gate failed (failures=${anyFail}, regression=${regressed}).`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(2); });
