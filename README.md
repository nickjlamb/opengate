# OpenGATE

**Evidence over plausibility.**

OpenGATE is an open-source framework for evaluating evidence-grounded AI systems — systems that must justify every answer from underlying source documents. It measures one thing above all: **can the system prove its answer from the source material?**

As AI moves into high-stakes domains — healthcare, scientific publishing, regulatory, legal, finance — evaluation is becoming as fundamental as automated testing is in traditional software engineering. OpenGATE turns grounding failures into numbers you can track, and gates every prompt, model, or workflow change against a baseline so reliability can't quietly regress.

Originally developed to power [RefCheckr](https://www.pharmatools.ai/refcheckr). Designed to evaluate any AI system built on retrieved documents or reference material.

## Why not DeepEval?

Use both. General-purpose frameworks such as DeepEval and OpenAI Evals evaluate AI systems in general. OpenGATE specialises in systems that must justify every answer from evidence:

- **Provenance is first-class** — does the cited passage actually exist, verbatim, in the source?
- **Citation fidelity is first-class** — are the right citations detected and mapped to the right references?
- **Regression detection is first-class** — every run is diffed against a baseline; drops fail the build.

If your system's core promise is *grounded* answers, these aren't plugins — they're the whole evaluation. That's the niche OpenGATE fills.

## First evaluation in 60 seconds

No API key needed — the offline suite tests deterministic logic against the bundled gold set:

```bash
git clone https://github.com/nickjlamb/opengate.git
cd opengate
npm run eval
```

```
OpenGATE — 25 case(s), online=false, sha=eff971b

  ✓ citation-detection   PASS
      perClaim_exactSetRate      100.0%
      perClaim_jaccardMean       100.0%
      supportedStyle_accuracy    100.0%
  ⊘ claim-extraction     SKIPPED — online scorer (pass --online)
  ⊘ verdict-accuracy     SKIPPED — online scorer (pass --online)
```

To run the online scorers against a live system (bundled RefCheckr adapter):

```bash
export REFCHECKR_BASE_URL=http://localhost:3848
export REFCHECKR_TOKEN=<a valid auth token>
export OPENGATE_EVAL_REPEATS=3        # optional: measure verdict consistency
export OPENGATE_EVAL_MODEL=sonar-pro  # optional: label the model in the scorecard

npm run eval:online
npm run eval:baseline   # save current run as the regression reference
npm run eval:ci         # exit non-zero on any failure or metric regression
```

## Architecture

```
                        ┌─────────────────────────────────┐
                        │            OpenGATE             │
                        │                                 │
                        │  benchmark datasets (gold sets) │
                        │  scorers (one per metric family)│
                        │  scorecards (versioned, on disk)│
                        │  regression gate (CI)           │
                        └───────────────┬─────────────────┘
                                        │ adapters
                 ┌──────────────┬───────┴──────┬──────────────┐
                 ▼              ▼              ▼              ▼
             RefCheckr     Patiently AI     Redacta      your system
          (first impl.)     (planned)      (planned)    (write an adapter)
```

Where it sits in the development loop:

```
change a prompt, model, or pipeline
              ↓
        run OpenGATE
              ↓
     metrics vs baseline?
        ↙          ↘
  ▲ improved      ▼ regressed
    deploy         investigate (build fails in CI)
```

## Core concepts

**Gold cases** — hand-labelled benchmark cases (`datasets/cases/`): source text, the claims that should be extracted, the sentences that should *not* be, and reference snippets with known-correct verdicts. Copy `_template.json` to add one; format spec in `datasets/SCHEMA.md`, labelling rules in `datasets/LABELING-GUIDE.md`.

**Scorers** — one module per metric family (`src/scorers/`):

| Scorer | Mode | Metrics |
|---|---|---|
| `citation-detection` | offline | per-claim citation set exact-match & Jaccard; supported-style accuracy; tracked known-gap styles |
| `claim-extraction` | online | precision / recall / F1 vs gold; non-claim leakage; citation agreement; **fidelity** (extracted claim is verbatim from source) |
| `verdict-accuracy` | online | exact & adjacency accuracy on a six-point support scale; confusion matrix; **passage hallucination rate**; consistency across repeats; per-claim latency (p50/p95) and token usage for real cost/claim |

Offline scorers run with no API key — fast enough for every commit. Online scorers exercise a live system through an adapter.

**Scorecards** — every run writes `results/<timestamp>.json` stamped with the git SHA, so any result is reproducible and auditable. Per-model runs carry a `run_model` label, turning the results directory into a measured model comparison (accuracy × hallucination × latency × cost).

**Regression gate** — `--baseline` saves a reference; subsequent runs print per-metric deltas (▲/▼ in percentage points) and `--ci` fails the build on any drop. No change ships without proving it didn't make the system less reliable.

## Adapters: evaluating your own system

Scorers never talk to a system directly — they go through an adapter, injected by the runner. The bundled `src/adapters/refcheckr.mjs` is the reference implementation; select your own with:

```bash
OPENGATE_ADAPTER=./adapters/my-system.mjs npm run eval:online
```

An adapter is one file with four required exports — `splitClaims(text)`, `analyzeBatch(payload)`, `onlineAvailable()`, `onlineConfigHint()` — plus optional timing/token/model-label hooks that unlock latency and cost columns in the scorecard. Adapters are validated at load: a malformed one fails fast with a message listing every missing export. Full contract, minimal skeleton, and verdict-mapping notes: **[ADAPTERS.md](ADAPTERS.md)**.

**The methodology travels; only the gold set changes.**

## Proven in production

Run against RefCheckr's gold set, OpenGATE:

- surfaced a **silent parse-failure mode** affecting ~50% of multi-claim verdicts, eliminated with enforced structured output (→ 0);
- **halved passage hallucination** (5.8% → 2.4%) by driving a measured production model change — a decision made on numbers, not reputation;
- holds claim extraction at **~0.95 F1** with near-full recall.

Full methodology and the model comparison: [how RefCheckr is evaluated](https://www.pharmatools.ai/refcheckr-eval).

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
    adapters/     system-under-test boundary (refcheckr.mjs is the reference)
    runner.mjs    CLI: discover cases → run scorers → report → snapshot → regression-check
  results/        timestamped run snapshots + baseline.json
```

## Roadmap

- **Generic HTTP adapter** — config-driven endpoint mapping, covering most REST-backed RAG systems without code
- **Second adapter** — Patiently AI (faithfulness evaluation for patient-language simplification)
- **Author-year citation styles** — currently a tracked known gap (numbered styles are fully supported)
- **Growing gold set** — more domains, all six verdict types, real-world reference material
- **npm packaging** — extract `opengate` core as an installable package once the adapter surface stabilises
- **GitHub Action** — drop-in regression gate for any repo

## Contributing

Contributions are welcome, particularly:

- **Gold cases** — new domains and citation styles (see `datasets/LABELING-GUIDE.md`)
- **Adapters** — connect OpenGATE to your evidence-grounded system
- **Scorers** — new metric families that fit the gold-case format

Open an issue to discuss before large changes. Interfaces — particularly the adapter surface — may still shift pre-1.0.

## License

[MIT](LICENSE) — because evaluation frameworks shouldn't be black boxes. If an evaluation influences deployment decisions, engineers should be able to inspect every scorer, metric, and benchmark.
