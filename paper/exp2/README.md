# exp-2 — deterministic scorers vs LLM-judge faithfulness

Defends the paper's complementarity claim (§7, `TODO(exp-2)`) with evidence, and
reports the headline result either way: stability-and-localisation versus coverage.

## The protocol, and why it is shaped this way

**One frozen corpus, scored by every arm.** Outputs are captured once, hashed, and
committed. Nothing downstream ever calls a system under test again. If the arms
scored different bytes, none of the comparison would mean anything, so every arm
records the corpus SHA-256 and `analyse.mjs` refuses to run if they disagree.

**Judges run at temperature 0.** That is the *most favourable* setting for judge
stability, so any variance we measure is a floor, not an artefact of sampling.

**Mutants, not just gold outputs.** Six captured outputs is too thin to say
anything about variance, and gives no ground truth to score either arm against.
So each base output is mutated in fixed, committed ways, each injecting one known
defect:

| defect | in scope for deterministic? | what it is | who should catch it |
|---|---|---|---|
| `dropped_anchor` | yes | the safety-critical fact is deleted | deterministic. A faithfulness judge is blind to omission **by construction** — a missing dose asserts nothing unsupported. A coverage difference, not a judge failure. |
| `fabricated_number` | yes | a number appears that is nowhere in the source | both |
| `non_abstention` | yes | a confident answer to an unanswerable question | deterministic (abstention gate) |
| `contradiction` | **no** | a sentence contradicting the source, appended; adds no numbers, removes no anchors | the judge |
| `inversion` | **no** | the meaning of an existing statement is flipped **in place** — *"the dose has been increased to 100 micrograms"* → *"…reduced to 100 micrograms"*; *"haemoglobin is low"* → *"haemoglobin is high"*. Every anchor and every number survives verbatim. Nothing added, nothing removed. | the judge — and OpenGATE **cannot**, ever |

### Why `inversion` exists

The first three classes test judge sensitivity on defects OpenGATE catches *by construction* —
run those alone and the experiment is a home fixture, and a reviewer would be right to say so.
`inversion` runs the comparison in the reverse direction: a defect the deterministic layer is
**expected to miss**, and does. That turns the result from "we win on stability" into a genuine
two-sided finding — *deterministic scoring is stable and cheap but has a floor; LLM judges see
semantics but wobble* — which is both more honest and much harder to dismiss.

**The scoping rule that follows from it:** because the mutants are constructed from a defect
taxonomy, any sensitivity comparison must be scoped to *defect classes in scope for deterministic
checking*. A combined score across all classes would simply reward whichever arm the taxonomy was
drawn around. `analyse.mjs` enforces this — it reports 3a (in scope) and 3b (out of scope)
separately and never sums them. The inversion arm is what keeps that honest.

`inversion` mutants are held to three conditions, checked at build time: every anchor still
present, no number added or changed, and therefore the deterministic verdict **unchanged from the
base output**. If an inversion is accidentally *caught*, the build fails rather than manufacture a
false win. They are also required to stay grammatical — an incoherent mutant lets a judge score a
catch it did not earn, by flagging the incoherence rather than the inverted meaning.

`make-mutants.mjs` **self-checks**: it runs every mutant through OpenGATE's own
checkers and fails the build if a mutant does not carry exactly the defect it
claims — in particular if a contradiction is accidentally caught by the
deterministic layer, which would silently invalidate the coverage result.

**Faithfulness gates only.** Arms are compared on anchors + numbers + abstention.
The length-contract gate (Brief mode: ≤3 bullets) is recorded but excluded:
appending a sentence to a 3-bullet output makes it a 4-bullet output, so the
deterministic arm would "catch" every contradiction for a reason that has nothing
to do with what it contradicts. That would be a false win.

## Provenance of the outputs — stated plainly

- **Simplification (3 cases)** — real production outputs from the Patiently AI
  endpoint, via the bundled adapter.
- **Grounding (3 cases)** — a *generic RAG answerer*: one temperature-0 completion
  answering the question from the case context and nothing else. Not a production
  system. OpenGATE's grounding capability has no production adapter, and exp-2
  needs only outputs that both arms can read. The paper says this, not "a system
  under test".

## Running it

Steps 1 and 3–4 need network access the dev sandbox does not have (the Patiently
endpoint and the OpenAI API); run them on a machine that does.

```bash
# 1. capture the base outputs — ONCE. Regenerating invalidates everything below.
OPENAI_API_KEY=sk-... node paper/exp2/capture-outputs.mjs

# 2. derive the frozen corpus (deterministic, no network, self-checking)
node paper/exp2/make-mutants.mjs

# 3. judge arm A — RAGAS (own virtualenv; its pins conflict with DeepEval's)
python3 -m venv paper/exp2/judge/.venv-ragas
paper/exp2/judge/.venv-ragas/bin/pip install -r paper/exp2/judge/requirements-ragas.txt
OPENAI_API_KEY=sk-... paper/exp2/judge/.venv-ragas/bin/python paper/exp2/judge/ragas_run.py

# 4. judge arm B — DeepEval
python3 -m venv paper/exp2/judge/.venv-deepeval
paper/exp2/judge/.venv-deepeval/bin/pip install -r paper/exp2/judge/requirements-deepeval.txt
OPENAI_API_KEY=sk-... paper/exp2/judge/.venv-deepeval/bin/python paper/exp2/judge/deepeval_run.py

# 5. the deterministic arm (free, offline) and the analysis
node paper/exp2/score-deterministic.mjs
node paper/exp2/analyse.mjs      # → RESULTS.md
```

Steps 2 and 5 are reproducible by anyone from the repo alone; steps 1, 3 and 4
need keys. Expect roughly 270 judge evaluations (27 outputs × 5 repeats × 2 arms)
— pennies at `gpt-4o-mini`, and the measured cost is what the paper reports.

If `make-mutants.mjs` fails with *"no inversion rule matched the captured output"*, the
captured paraphrase used wording none of the committed patterns anticipated. Add a pattern to
`INVERSIONS[caseId]` that flips a statement the output actually makes. Do **not** skip the case:
a missing inversion mutant biases the corpus toward the classes the deterministic layer catches,
which is the exact bias this class exists to correct.

`analyse.mjs` runs with whatever arms are present, so you can look at the
deterministic arm before spending anything.

## Files

| file | what it is |
|---|---|
| `capture-outputs.mjs` | step 1 — captures and freezes the base outputs |
| `make-mutants.mjs` | step 2 — derives the frozen corpus; self-checking |
| `score-item.mjs` | the deterministic arm: calls OpenGATE's own shared checkers, not a reimplementation |
| `score-deterministic.mjs` | step 5 — 5 repeats, hashed; proves bit-identical results |
| `judge/ragas_run.py`, `judge/deepeval_run.py` | the two judge arms |
| `analyse.mjs` | stability, cost, detection, localisation → `RESULTS.md` |
| `corpus/`, `results/` | frozen inputs and committed outputs |

## Threats to this experiment's own validity

- **Judge model choice.** One judge model (`gpt-4o-mini` by default) behind two
  frameworks. A larger judge would likely score more stably and cost more; the
  cost/stability trade-off is the point, but the specific numbers are model-bound.
  Set `JUDGE_MODEL` and re-run to test that.
- **Mutants are synthetic.** They inject defects of a kind we have *seen* in
  production (a dropped dose; an invented figure), but a mutant is not a naturally
  occurring failure. The base outputs are real; the defects are induced.
- **The taxonomy is ours.** We wrote both the defect classes and the scorers, which is
  precisely why the comparison is scoped (3a vs 3b) and never summed, and why the
  `inversion` class — a defect we are *guaranteed* to lose on — is in the corpus at all.
  A reviewer should still ask whether the taxonomy is complete. It is not: it covers the
  failures we have observed, not the failures that exist.
- **Faithfulness is one metric.** RAGAS and DeepEval offer others (answer
  relevancy, correctness) that would see omission. The claim is scoped to
  faithfulness, which is the metric usually reached for when people say "we use an
  LLM judge to catch hallucination".
- **Six cases.** Twenty-two outputs. Enough to demonstrate variance and coverage
  asymmetry; not a benchmark.
