# exp-1 — independent second labeller

Defends the claim §7 has to make: *the gold labels are not one person's idiosyncrasy.*
The framework's author wrote every gold label in this benchmark and also built the systems it
evaluates. The honest response is not to assert that the labels are sound — it is to have somebody
else label the same material blind, and publish how often we disagree, **including where we were
wrong**.

## What the labeller does

One self-contained HTML file, opened in a browser. No install, no network, no account. Their
answers live in browser storage as they go (they can stop and come back), and an **Export** button
at the end saves a single JSON file to email back.

**137 judgments, roughly two hours:**

| part | items | task |
|---|---|---|
| 1. Warm-up | 6 | Six claims judged **before** the rubric is shown |
| 2. The rubric | — | `datasets/LABELING-GUIDE.md`, rendered in full |
| 3. Claims | 63 | Six-class verdict: does *this reference* support *this claim*, and how? |
| 4. De-identification | 48 | Binary: must this span be removed before sharing? |
| 5. Simplification | 26 | Binary: would losing this fact be a safety problem? |

## Three design decisions worth knowing

**The rubric is included, and the warm-up is why.** κ measured *after* someone reads our rubric
answers the question the paper needs — is the standard reproducible by another trained person? But
it invites a fair objection: of course they agree, you told them what to think. So the same six
claims are labelled cold, before the rubric appears, and again inside the main pass. Cold-vs-guided
on identical items separates *"our labels are sound"* from *"our rubric is persuasive"*. Those are
different claims and the paper should not conflate them.

**The binary tasks are balanced on purpose.** 25 must-redact against 23 must-remain; 14 essential
against 12 not. A lopsided binary task produces impressive raw agreement and a worthless κ — 91%
agreement can hide a κ of 0.1 when one class dominates (there is a test for exactly this in
`tests/agreement.test.mjs`). The negatives are plausible, not padding.

**Some candidates are designed to expose our own gold set, not the labeller.** `distractors.json`
flags them. The sharpest: *"three times daily"* and *"twice daily"* are dose frequencies that are
**not** currently gold anchors in the simplification cases. If a medical writer says losing them
would be a safety problem, our anchors are incomplete — and that is a finding about the benchmark,
not a disagreement to be explained away. The same applies to `50 micrograms` (the *old* dose in a
dose-change letter, which arguably must be **dropped**, not kept) and to the clinician names in the
redaction cases, which the gold set deliberately leaves in place.

## Running it

```bash
# 1. build the pack (deterministic — rebuilds byte-identically)
node paper/exp1/make-pack.mjs

# 2. send ONLY this file:
#      paper/exp1/labelling-pack/opengate-labelling-pack.html
#
#    NEVER send paper/exp1/gold-key.json — it is the answer key.
#    Ask them not to browse the repository while they work; the answers are in it.

# 3. when the JSON comes back
cp ~/Downloads/opengate-exp1-labels.json paper/exp1/responses/labeller-a.json
node paper/exp1/agreement.mjs paper/exp1/responses/labeller-a.json   # → RESULTS.md
```

`make-pack.mjs` refuses to write a pack that contains any gold label, checked structurally against
the payload the page actually embeds — not by grepping the HTML for the word "gold", which false-alarms
on the rubric's own documentation. A guard that cries wolf gets overridden, which defeats the point.

## What gets reported

κ **before reconciliation**, per the plan — that is the honest number, and it is the one the paper
leads with. Then every disagreement in full, with our rationale and theirs side by side, and a
resolution: *uphold*, *correct the gold case*, or *clarify the rubric*. Where the second labeller is
right, the case is fixed in the public history and both numbers appear.

The confusion matrix matters more than the headline κ. Disagreements that **cluster** on one
boundary (the known-fuzzy one is *overclaim* vs *contradicted*) indicate a rubric that can be
sharpened. Disagreements **scattered** across the matrix indicate labels that cannot be trusted.
Same κ, opposite conclusions.

## Threats to this experiment's own validity

- **One labeller.** κ from a single pair of raters is a point estimate with a wide interval; the CI
  is reported for exactly this reason. Two labellers would let us separate rater disagreement from
  rubric ambiguity properly.
- **The labeller is a colleague**, not a blinded stranger, and knows the work is ours. Social
  pressure runs toward agreement, which biases κ *upward* — so a high κ here is weaker evidence than
  a high κ from a stranger, and we should say so rather than bank it.
- **We wrote the item set**, including the distractors. Balanced and boundary-heavy by design, but
  ours.
- **The warm-up is six items.** It is a directional signal, not a result, and is reported as one.
