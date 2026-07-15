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

> **STATUS (2026-07-11): harness built and dry-run verified; awaiting the three
> networked steps, which must run on Nick's machine.** See `paper/exp2/README.md`
> for the exact commands. Decisions taken since this plan was written:
>
> - The grounding cases have **no production adapter** (only the generic `http`
>   adapter implements `answer()`, and no committed scorecard has ever run the
>   grounding scorer). Their outputs come from a *generic RAG answerer* —
>   temperature 0, answer-from-context prompt — and the paper says so plainly.
>   Simplification outputs are real Patiently production outputs.
> - The corpus is **base outputs + deterministic mutants**, because six outputs
>   give no ground truth to score either arm against. 27 outputs total, across
>   five defect classes — and crucially, the classes are split by *scope*:
>   - **in scope** for deterministic checking: `dropped_anchor`,
>     `fabricated_number`, `non_abstention`;
>   - **out of scope** by construction: `contradiction` and — the important one —
>     `inversion`: the meaning of a statement flipped *in place* ("dose increased
>     to 100 micrograms" → "dose reduced to 100 micrograms"), with every anchor
>     and number surviving verbatim. OpenGATE **cannot** catch these, is expected
>     not to, and is scored 0/5 on them in the report.
>
>   Without the inversion class the experiment is a home fixture: every mutant
>   would be a defect OpenGATE catches by construction, and a reviewer would say
>   so. With it, the result is two-sided — *deterministic scoring is stable and
>   cheap but has a floor; LLM judges see semantics but wobble* — which is the
>   honest finding and the one §7 wants.
> - **Scoping rule, enforced in code:** because the mutants come from a defect
>   taxonomy we wrote, sensitivity is compared only *within* scope groups.
>   `analyse.mjs` reports in-scope and out-of-scope detection separately and never
>   sums them; a combined number would just reward whichever arm the taxonomy was
>   drawn around.
> - Arms are compared on the **faithfulness gates only** (anchors, numbers,
>   abstention). The length-contract gate is excluded: mutation perturbs output
>   shape, and letting the deterministic arm "catch" a contradiction via bullet
>   count would be a false win.
> - Both judge arms (RAGAS **and** DeepEval) are wired, in separate virtualenvs —
>   their langchain pins conflict.
>
> Building the corpus surfaced a real defect in the shared grounding checker: the
> abstention markers matched only passive phrasing ("not stated"), so a system
> answering "the context does not state the price" was scored as *failing to
> abstain*. Fixed in `src/lib/grounding-check.mjs`, regression test added. That is
> a found-and-fixed entry for §6 in its own right.

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
