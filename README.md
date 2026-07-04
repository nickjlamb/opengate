# OpenGATE

**Open Grounded AI Testing & Evaluation** — an open-source framework for evaluating evidence-grounded AI systems.

As AI systems move into high-stakes domains, evaluation is becoming as fundamental as automated testing is in traditional software engineering. OpenGATE measures one thing above all: **can the system prove its answer from the source material?** Rather than asking whether an answer sounds plausible, it measures whether every answer can be justified from its underlying sources.

Originally developed to power [RefCheckr](https://www.pharmatools.ai/refcheckr), OpenGATE is designed to evaluate any AI system that answers questions from source documents — RAG pipelines, document QA, medical, legal, and regulatory AI, enterprise search, and scientific assistants.

## Why this exists

Most AI evaluation asks whether a model produces a plausible answer. In evidence-grounded systems the failure modes that matter are subtler and invisible without measurement: a supporting passage that doesn't exist in the source; a slightly reworded claim verified in place of the original; a prompt tweak that quietly lowers verdict accuracy. OpenGATE turns those failure modes into numbers you can track — and gates every prompt, model, or workflow change against a baseline so reliability can't quietly regress.

## What it measures

| Scorer | Mode | Metrics |
|---|---|---|
| `citation-detection` | offline | per-claim citation set exact-match & Jaccard; supported-style accuracy; tracked known-gap styles (e.g. author-year) |
| `claim-extraction` | online | precision / recall / F1 of extracted claims vs gold; non-claim leakage; citation agreement; **fidelity** (extracted claim is verbatim from source) |
| `verdict-accuracy` | online | exact & off-by-one (adjacency) accuracy on the six-point support scale; confusion matrix; passage hallucination rate; consistency across repeats (set `OPENGATE_EVAL_REPEATS`); **per-claim latency** (`latency_p50_ms` / `latency_p95_ms`); **per-claim token usage** (`avg_input_tokens` / `avg_output_tokens`, for real cost/claim); and `run_model` label |

"Offline" scorers run with **no API key** (deterministic logic only) — fast and CI-friendly. "Online" scorers exercise a live system through an adapter and need configuration.

## Run it

```bash
npm run eval            # offline scorers only — no API key needed
npm run eval:online     # also run online scorers (needs adapter config below)
npm run eval:baseline   # save current run as results/baseline.json
npm run eval:ci         # exit non-zero on any failure or metric regression
```

Online config for the bundled RefCheckr adapter (`src/adapters/refcheckr.mjs`):

```bash
export REFCHECKR_BASE_URL=http://localhost:3848      # or the deployed URL
export REFCHECKR_TOKEN=<a valid auth token>
export OPENGATE_EVAL_REPEATS=3                       # optional: run each case N times to measure verdict consistency
export OPENGATE_EVAL_MODEL=claude-haiku-4-5          # optional: label the deployment's model; recorded in the scorecard
```

## Architecture

```
OpenGATE
    ↓ powers
RefCheckr · Patiently AI · Redacta · future evidence-grounded systems
```

The framework is built like a test suite for an AI system — gold cases in, metrics out, a baseline to compare against:

1. **Gold cases** — hand-labelled benchmark cases: source text, the claims that should be extracted, the sentences that should not be, and reference snippets with known-correct verdicts.
2. **Scorers** — independent scorers per metric family; offline scorers test deterministic logic on every commit, online scorers exercise the live system.
3. **Scorecard** — every run is stamped with the exact code version and written to disk, so any result is reproducible and auditable.
4. **Regression gate** — each run is diffed against a saved baseline; any metric that drops fails the build in CI.

### Adapters: evaluating your own system

Scorers never talk to a system directly — they go through an adapter (`src/adapters/`). The bundled `refcheckr.mjs` adapter is the reference: to evaluate a different system, implement the same surface —

- `splitClaims(text)` — extract candidate claims from a document
- `analyzeBatch(payload)` — verify claims against reference documents
- `onlineAvailable()` / `onlineConfigHint()` — config detection
- `runModel()` — label which model the system ran, for per-model comparison
- timing/token helpers (`resetTiming`, `callLatencies`, `percentile`, `resetTokens`, `tokenTotals`)

— then point the online scorers at your adapter. The offline scorers and all metric logic are system-agnostic. Only the gold set changes.

## Layout

```
opengate/
  datasets/
    cases/        gold-labelled source sections (copy _template.json to add)
    fixtures/     citation-style coverage fixture
    SCHEMA.md     case format spec
    LABELING-GUIDE.md
  src/
    lib/          metrics.mjs (PRF1, Jaccard, verdict accuracy, confusion matrix)
                  citations.mjs (reference impl of deterministic citation logic)
    scorers/      one file per metric family
    adapters/     system-under-test boundary (refcheckr.mjs is the reference adapter)
    runner.mjs    CLI: discover cases → run scorers → report → snapshot → regression-check
  results/        timestamped run snapshots + baseline.json
```

## How regression-checking works

Each run writes `results/<timestamp>.json` with the git SHA. `--baseline` saves a reference. Subsequent runs diff headline metrics against `results/baseline.json` and print per-metric deltas (▲/▼ in percentage points); `--ci` fails the build on any drop. Drop this into CI to gate prompt/model changes.

## Measuring latency and comparing models

The verdict scorer times every verification call and reports `latency_p50_ms` / `latency_p95_ms` per claim in the scorecard (info only — latency never gates CI). To compare models on accuracy **and** latency, point the deployment at one model, set `OPENGATE_EVAL_MODEL` to name it, run `npm run eval:online`, then repeat for each model. Each run's scorecard carries its own `run_model`, so the timestamped results in `results/` become a per-model comparison.

**Real cost per claim.** When the system surfaces token `usage`, the scorer averages it into `avg_input_tokens` / `avg_output_tokens`. Multiply by the model's published token rates (plus any per-request fee) for a measured — not estimated — cost per claim. For reasoning models, the hidden reasoning trace is billed but doesn't appear in `completion_tokens`; the adapter reads `reasoning_tokens` (or infers `total − prompt − completion`) and the scorer surfaces `avg_reasoning_tokens` and `avg_total_tokens` so true cost isn't undercounted.

## First implementation: RefCheckr

OpenGATE powers the evaluation infrastructure behind [RefCheckr](https://www.pharmatools.ai/refcheckr), an evidence verification tool for medical writers. Run against RefCheckr's gold set, the framework surfaced a silent parse-failure mode (~50% of multi-claim verdicts → 0 after enforced structured output), halved passage hallucination (5.8% → 2.4%) by driving a measured production model change, and holds claim extraction at ~0.95 F1. Full methodology and model comparison: [how RefCheckr is evaluated](https://www.pharmatools.ai/refcheckr-eval).

The bundled gold set (`datasets/cases/`) is RefCheckr's — hand-labelled biomedical manuscript sections. It doubles as a worked example of the case format; see `datasets/SCHEMA.md` and `datasets/LABELING-GUIDE.md` to build a gold set for your own domain.

## Status

Extracted from the RefCheckr repository as a standalone framework (v0.1.0). Interfaces — particularly the adapter surface — may still shift. Contributions, gold-set additions, and adapters for new systems are welcome.

## License

[MIT](LICENSE)
