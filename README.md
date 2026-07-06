# OpenGATE

[![CI](https://github.com/nickjlamb/opengate/actions/workflows/ci.yml/badge.svg)](https://github.com/nickjlamb/opengate/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/%40pharmatools%2Fopengate)](https://www.npmjs.com/package/@pharmatools/opengate)

**Evidence over plausibility.**

OpenGATE is an open-source framework for evaluating evidence-grounded AI systems — systems that must justify every answer from underlying source documents. It measures one thing above all: **can the system prove its answer from the source material?**

As AI moves into high-stakes domains — healthcare, scientific publishing, regulatory, legal, finance — evaluation is becoming as fundamental as automated testing is in traditional software engineering. OpenGATE turns grounding failures into numbers you can track, and gates every prompt, model, or workflow change against a baseline so reliability can't quietly regress.

Originally developed to power [RefCheckr](https://www.pharmatools.ai/refcheckr). Designed to evaluate any AI system built on retrieved documents or reference material.

**Evaluating your own RAG, doc-QA, or legal/scientific assistant?** Start with the **[Getting Started guide](docs/GETTING-STARTED.md)** — pick a capability, connect your system (no code for HTTP endpoints), write gold cases, gate CI.

## Why not DeepEval?

Use both. General-purpose frameworks such as DeepEval and OpenAI Evals evaluate AI systems in general. OpenGATE specialises in systems that must justify every answer from evidence:

- **Provenance is first-class** — does the cited passage actually exist, verbatim, in the source?
- **Citation fidelity is first-class** — are the right citations detected and mapped to the right references?
- **Regression detection is first-class** — every run is diffed against a baseline; drops fail the build.

If your system's core promise is *grounded* answers, these aren't plugins — they're the whole evaluation. That's the niche OpenGATE fills.

## First evaluation in 60 seconds

No API key needed — the offline suite tests deterministic logic against the bundled gold set:

```bash
npx @pharmatools/opengate
```

Or from a clone:

```bash
git clone https://github.com/nickjlamb/opengate.git
cd opengate
npm run eval
```

For programmatic use, the metric and citation primitives are importable directly:

```js
import { detectCitations, verdictAccuracy, precisionRecallF1 } from '@pharmatools/opengate';
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
          RefCheckr    Redacta    Patiently AI   PubCrawl    your system
         (QA, first) (redaction)  (simplify)   (retrieval)  (write one)
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
| `redaction` | online | recall on gold identifiers with **leaks as named failures** (verbatim, and word-level for names); over-redaction count; known-gap tracking for documented engine gaps |
| `simplification` | online | faithfulness of rewritten text: **anchor recall** (critical facts like doses must survive), **fabricated numbers** (nothing invented), length-contract gates, readability grade (info) |
| `retrieval` | online | fidelity of retrieved records vs the authority: field presence, hand-verified **anchor fields** (author surnames, year, distinctive abstract phrases), and structural invariants that catch parser regressions (collapsed author arrays, `[object Object]` leakage) |
| `grounding` | online | generic RAG / document QA: **answer-anchor recall** (did it answer correctly from context), **fabrication** against the retrieved context (no invented numbers), and **abstention** (declines when the context lacks the answer). No verdict scale or citation mapping — the turnkey path for non-RefCheckr-shaped systems |

Offline scorers run with no API key — fast enough for every commit. Online scorers exercise a live system through an adapter.

**Scorecards** — every run writes `results/<timestamp>.json` stamped with the git SHA, so any result is reproducible and auditable. Per-model runs carry a `run_model` label, turning the results directory into a measured model comparison (accuracy × hallucination × latency × cost).

**Regression gate** — `--baseline` saves a reference; subsequent runs print per-metric deltas (▲/▼ in percentage points) and `--ci` fails the build on any drop. Baselines are **per-adapter** (`baseline.<adapter>.json`), so a PubCrawl retrieval scorecard can't clobber a RefCheckr QA one — each adapter keeps its own reference. No change ships without proving it didn't make the system less reliable.

**HTML report** — add `--report` to any run (or `opengate report` to render the latest snapshot) for a self-contained HTML dashboard: pass/fail per scorer, metric deltas vs baseline, and every named failure. One file — open it, email it, or attach it to a CI run. No dependencies, no server.

## Adapters: evaluating your own system

Scorers never talk to a system directly — they go through an adapter, injected by the runner. The bundled `src/adapters/refcheckr.mjs` is the reference implementation; select your own with:

```bash
OPENGATE_ADAPTER=./adapters/my-system.mjs npm run eval:online
```

An adapter is one file: two base exports — `onlineAvailable()`, `onlineConfigHint()` — plus at least one complete **capability**: `qa` (`splitClaims` + `analyzeBatch`) or `redaction` (`redact`). Scorers check `adapter.capabilities` and skip cleanly across the boundary. Optional timing/token/model-label hooks unlock latency and cost columns in the scorecard. Adapters are validated at load: a malformed one fails fast with a message naming every missing export and incomplete capability.

For REST-backed systems there's a no-code path: the bundled **generic HTTP adapter** (`src/adapters/http.mjs`) reads endpoint paths and headers from `opengate.http.json` (see `opengate.http.example.json`), with `${ENV}` interpolation and built-in latency/token capture.

Full contract, minimal skeleton, and verdict-mapping notes: **[ADAPTERS.md](ADAPTERS.md)**. New to OpenGATE? The **[Getting Started guide](docs/GETTING-STARTED.md)** walks a generic RAG system from zero to a CI gate.

**The methodology travels; only the gold set changes.**

## CI: the GitHub Action

Use OpenGATE as a drop-in regression gate in any repository. Keep your gold set and committed baseline (`baseline.<adapter>.json`) in your own tree; any metric that drops fails the build:

```yaml
- uses: nickjlamb/opengate@v0
  with:
    datasets: ./evals/datasets      # your cases/ + fixtures/
    results: ./evals/results        # where baseline.<adapter>.json lives
    adapter: ./evals/my-adapter.mjs # or the bundled HTTP adapter
    online: 'true'
  env:
    MY_SYSTEM_URL: ${{ vars.MY_SYSTEM_URL }}
    MY_SYSTEM_TOKEN: ${{ secrets.MY_SYSTEM_TOKEN }}
```

All inputs are optional — with none, it runs the offline suite against the bundled gold set. The same overrides work locally: `--datasets <dir>` and `--results <dir>` (or `OPENGATE_DATASETS` / `OPENGATE_RESULTS`).

## Proven in production

Run against RefCheckr's gold set, OpenGATE:

- surfaced a **silent parse-failure mode** affecting ~50% of multi-claim verdicts, eliminated with enforced structured output (→ 0);
- **halved passage hallucination** (5.8% → 2.4%) by driving a measured production model change — a decision made on numbers, not reputation;
- holds claim extraction at **~0.95 F1** with near-full recall.

Full methodology and the model comparison: [how RefCheckr is evaluated](https://www.pharmatools.ai/refcheckr-eval).

## Second implementation: Redacta

[Redacta](https://www.pharmatools.ai/redacta) exercises the framework's **redaction capability** — proof the methodology isn't QA-shaped. The bundled adapter wraps the `@pharmatools/redacta` engine, scored against synthetic UK clinical notes with gold-labelled identifiers:

```bash
npm install --no-save @pharmatools/redacta
node src/runner.mjs --online --adapter ./src/adapters/redacta.mjs
```

On its first run against the new gold set, the eval found two real engine bugs — relation phrases like "Next of kin:" swallowed nested name matches, and apostrophe surnames (O'Brien) were dropped from name capture. Both were fixed in `@pharmatools/redacta` 1.2.1 and confirmed by the eval (`knownGap_closed: 2`), then promoted to gold. Street-line address detection followed in 1.3.0, closing the last tracked gap. Current scorecard: **100% recall on 25 gold identifiers, 0 leaks, no open gaps**.

## Third implementation: Patiently AI

[Patiently AI](https://www.pharmatools.ai/patiently-ai) exercises the **simplify capability** — faithfulness scoring for text that is paraphrase by design. On its first production run, the eval found the simplifier **dropping safety-critical specifics**: an antibiotic dose vanished from a Brief discharge summary and a haemoglobin value from a lab letter (anchor recall 86%). Root cause: the composed prompt had no faithfulness rule. A preservation rule added to Patiently's tone prompts (additively — the backend is shared with another product) took the next run to **100% anchor recall, 0 dropped facts, 0 fabricated numbers, 0 contract violations** — with the readability grade slightly *better* than before the fix.

```bash
node src/runner.mjs --online --adapter ./src/adapters/patiently.mjs
```

## Fourth implementation: PubCrawl

[PubCrawl](https://www.pharmatools.ai/pubcrawl) is the odd one out — an MCP server wrapping PubMed and ClinicalTrials.gov, with **no model**. It exercises the **retrieval capability**: the deterministic layer everything else grounds on. A silent XML-parser regression (a collapsed author array, a merged abstract) would poison every citation built on the record, so the scorer checks retrieval fidelity against hand-verified anchors and structural invariants. The adapter drives PubCrawl through its real MCP interface, so the full production parse path is under test — and `scripts/capture-retrieval-case.mjs` bootstraps gold cases from live records for you to verify against the source.

```bash
npm install --no-save @modelcontextprotocol/sdk
node scripts/capture-retrieval-case.mjs 31904519 > datasets/cases/retrieval-example.json  # then verify anchors
node src/runner.mjs --online --adapter ./src/adapters/pubcrawl.mjs
```

That OpenGATE scores a non-AI system at all is the point: **evidence-grounded AI is only as trustworthy as the retrieval beneath it**, so the retrieval belongs in the same regression gate.

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
  results/        timestamped run snapshots + baseline.<adapter>.json
```

## Roadmap


- **`opengate init`** — scaffold a starter gold case, an `opengate.http.json`, and a ready `.github/workflows/opengate.yml` into a repo, so a working CI gate is one command
- **Grounding depth** — the grounding scorer checks anchor recall, fabrication, and abstention deterministically; contextual-precision/recall of the retrieved passages themselves is a natural next metric
- **Retrieval breadth** — retrieval currently scores one PubMed record type; extend to full-text, citation formatting, and trial detail across PubCrawl's other tools
- **Retrieval coverage** — the retrieval gold set is one case; add a single-author paper (the exact array-collapse risk the capability exists to catch), a trial (NCT) record, and a full-text/citation case across PubCrawl's other tools
- **Number-adjacent superscript** — `week 24.1` is genuinely ambiguous with decimals; remains a tracked known gap
- **Growing gold set** — more domains, all six verdict types, real-world reference material
- **Stable adapter surface** — the contract may still shift pre-1.0; semver will signal breaking changes

## Contributing

Contributions are welcome, particularly:

- **Gold cases** — new domains and citation styles (see `datasets/LABELING-GUIDE.md`)
- **Adapters** — connect OpenGATE to your evidence-grounded system
- **Scorers** — new metric families that fit the gold-case format

Open an issue to discuss before large changes. Interfaces — particularly the adapter surface — may still shift pre-1.0.

## License

[MIT](LICENSE) — because evaluation frameworks shouldn't be black boxes. If an evaluation influences deployment decisions, engineers should be able to inspect every scorer, metric, and benchmark.
