# Pre-submission experiments — handover plan

Two experiments strengthen `paper-draft.md` before arXiv/CAIN submission. They are
marked `TODO(exp-1)` and `TODO(exp-2)` in the draft (§7). Results get written into
§6/§7 and the scorecards committed under `results/`.

## Context for a fresh session

- Paper draft: `paper/paper-draft.md` (this directory). Framework: this repo,
  v0.9.x — five capabilities, four adapters (refcheckr, redacta, patiently,
  pubcrawl) + generic HTTP, per-adapter baselines, deterministic scorers only.
- Gold cases: `datasets/cases/` (schema in `datasets/SCHEMA.md`, labelling rules
  in `datasets/LABELING-GUIDE.md`). All identifiers synthetic.
- Every §6 number in the draft traces to a committed scorecard in `results/`.
- Online runs against RefCheckr production need `REFCHECKR_BASE_URL` +
  `REFCHECKR_TOKEN` (mint: `node scripts/mint-eval-token.js` in ~/refcheck).
  Patiently's endpoint is public. The dev sandbox cannot reach either — live
  runs happen on Nick's machine; sandbox work is tooling, analysis, and stats.

## exp-1 — Independent second labeller (gold-label agreement)

**Claim it defends:** gold labels are not one person's idiosyncrasy.

1. Build a stratified sample: ~10 QA cases (claims + verdicts), all redaction
   cases, all simplification cases (small sets → take them whole).
2. Generate a *blind labelling pack*: case inputs with labels stripped, plus the
   labelling guide. Deliverable: `paper/exp1/labelling-pack/` + response sheet.
3. Second labeller = a medical-writer colleague (Nick recruits; not Claude —
   the point is independent human judgment).
4. Score agreement per capability: Cohen's κ for verdict labels (6-class);
   percentage agreement + κ where applicable for anchor/entity inclusion.
   Script: `paper/exp1/agreement.mjs` (deterministic, committed).
5. Reconcile disagreements in public history; update gold cases if the second
   labeller is right; report κ before reconciliation in the paper.

## exp-2 — Deterministic vs LLM-judge stability comparison

**Claim it defends:** complementarity, with evidence — and the headline result
either way (stability-vs-coverage).

1. Fix a corpus: the simplification and grounding gold cases + captured system
   outputs (reuse committed scorecard outputs where present; otherwise capture
   one fresh output set and freeze it — *the outputs must be identical across
   judges and repeats*).
2. Run RAGAS faithfulness (Python, needs an OpenAI key) over the frozen outputs
   **5 times**; record per-case scores, mean, per-case score range, and cost.
3. Run OpenGATE's deterministic scorers over the same frozen outputs 5 times
   (expect bit-identical results; that's the point).
4. Optional third arm: DeepEval's faithfulness metric, same protocol.
5. Report: per-case score variance (judge) vs zero (deterministic); cost per
   1,000 evaluations; failure localisation (named failure vs scalar score);
   and agreement between judge scores and deterministic pass/fail.
   Script + analysis: `paper/exp2/`.

## Definition of done

- `paper/exp1/` and `paper/exp2/` contain scripts, frozen inputs/outputs, and
  a RESULTS.md each.
- `paper-draft.md` §6/§7 updated with real numbers; TODO markers removed.
- Everything committed; numbers reproducible from the repo alone.
