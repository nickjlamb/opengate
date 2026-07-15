# exp-2 — judge harness incidents

Recorded because they are results, not just operations. Every one of these happened while
evaluating **27 short texts** — a corpus a person could read in ten minutes. The deterministic
arm scored the same 27 outputs five times over in 3.8 ms, with no network call and no failure
mode available to it.

## 1. `gpt-4o-mini` degenerated into a repetition loop inside DeepEval (fatal)

**Date:** 2026-07-11. **Arm:** DeepEval faithfulness. **Model:** `gpt-4o-mini`.

DeepEval's verdict-generation call, on this output:

> A notice period of ninety (90) days is required to terminate the agreement for convenience.

...consumed **16,384 completion tokens against a 549-token prompt** — the model's entire output
ceiling — and returned nothing:

```
openai.LengthFinishReasonError: Could not parse response content as the length limit was reached
CompletionUsage(completion_tokens=16384, prompt_tokens=549, total_tokens=16933)
```

The output is 91 characters long and contains one claim. RAGAS scored the same output `1.000`
in all five repeats without incident, so this is specific to the interaction between DeepEval's
prompt/schema pair and this model — not to the text being judged.

Not transient, and not tunable: at temperature 0 the same input regenerates the same runaway
completion, and the ceiling was already the model's maximum. Retrying it only fails more slowly.

**Resolution:** both judge arms moved to `gpt-4o` and re-run from scratch, so the two judges stay
on the same model and remain comparable. The `gpt-4o-mini` RAGAS run is retained at
`results/ragas.gpt-4o-mini.json` — it is valid data, and now serves as a judge-model robustness
comparison rather than being discarded.

**Why it matters to the paper.** A release gate must be able to *fail closed*. This one failed
*open*: it produced no score at all, and a naive harness would have crashed the build — or, worse,
defaulted the missing score to a pass. The failure is invisible to any evaluation methodology that
only reports mean scores.

## 2. Network timeout mid-run (recoverable)

**Arm:** DeepEval. A single API call exceeded DeepEval's default ~88s per-attempt timeout and
killed the process, discarding 15 completed evaluations that had already been paid for.

**Resolution:** per-attempt timeout raised to 300s; retries with exponential backoff; and a
per-repeat checkpoint (`results/deepeval.partial.json`) so an interrupted run resumes rather than
restarts. Retries never reuse a score across repeats — each repeat is a fresh set of judge calls,
which is the entire point of the experiment.

## 3. Tally

| | deterministic arm | judge arms |
|---|---|---|
| runs attempted | 1 | 3 |
| runs that crashed on infrastructure | 0 | 2 |
| network calls | 0 | ~2,000 |
| wall clock, 27 outputs × 5 repeats | 3.8 ms | ~26 min (RAGAS), ~30 min (DeepEval) |
| failure modes available to it | none | timeout, token ceiling, rate limit, auth, model loop |

This is not the headline result of exp-2 — the detection and stability tables are. But it is an
honest sentence for §6: the operational difference between the two approaches is not a matter of
degree.
