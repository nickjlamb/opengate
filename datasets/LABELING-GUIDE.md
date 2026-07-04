# Verdict labeling guide

The rubric every gold case is labeled against. The goal is **one consistent, defensible standard** so the benchmark measures the system, not the annotator's mood. Each `goldVerdict` is a judgment of one claim against **one specific reference snippet** — never against real-world truth or the wider literature. The only question is: *does this reference support this claim, and how?*

## The six verdicts

| Verdict | Use when |
|---|---|
| **strong_support** | The reference **explicitly states** the claim in narrative text, and the claim does not exceed it. There is at least one verbatim sentence a reviewer could quote. |
| **partial_support** | **Part** of the claim is explicitly supported; another part is not addressed or only weakly supported. Typical for compound claims (A and B, where A holds and B doesn't). |
| **implied_by_data** | The claim follows from **data** (a table, figure, or numbers) but **no narrative sentence states it**. The numbers clearly imply the claim. |
| **overclaim** | The reference supports a **weaker or narrower** version of the claim, but the claim **overstates** it — asserting significance the reference doesn't establish, a larger magnitude, a broader population/endpoint, or greater certainty — **and the reference does not explicitly deny the overstated part**. Direction is right; strength/scope is too much. |
| **not_supported** | The reference **does not address** the claim — no evidence for or against. Includes "population excluded / endpoint not evaluated / not reported." |
| **contradicted** | The reference **explicitly states the opposite** of, or directly negates, the claim — including explicitly saying an effect was **not** significant when the claim asserts significance, or that an outcome did **not** occur when the claim asserts it did. |

## Decision rules (the tie-breakers)

These are the boundaries the v0.1 run showed were fuzzy. Apply them in order.

1. **overclaim vs contradicted** — *Did the reference explicitly negate the over-asserted element?*
   - The reference says the opposite of the specific assertion (e.g. claim: "significantly reduced X"; reference: "X was **not** significantly reduced") → **contradicted**.
   - The reference is merely **silent** on the over-asserted element (e.g. claim asserts significance; reference reports the effect size but never mentions significance) → **overclaim**.

2. **not_supported vs contradicted** — *Is the reference silent, or opposite?*
   - Silent on the claim → **not_supported**.
   - States the opposite → **contradicted**.

3. **not_supported vs overclaim** — *Is there support for even a weaker version?*
   - No support for any version of the claim → **not_supported**.
   - Supports a weaker/narrower version but the claim overstates it → **overclaim**.

4. **strong_support vs partial_support** — Entire claim explicitly supported → **strong**. Only part → **partial**.

5. **implied_by_data vs strong_support** — A narrative sentence states it → **strong**. Only the data/table shows it → **implied_by_data**.

## Worked examples

- Claim "reduced LDL by 58% versus placebo" + ref "reduced LDL by a mean of 58% (p<0.001)" → **strong_support** (explicit, not exceeded).
- Claim "**significantly** reduced cardiovascular death" + ref "cardiovascular death alone was **not significantly** reduced" → **contradicted** (explicit negation of the significance claim — rule 1).
- Claim "X **significantly** reduced hospitalisations" + ref "hospitalisations were 18% lower with X" (no p-value, significance never mentioned) → **overclaim** (asserts significance the ref doesn't establish and doesn't deny — rule 1).
- Claim "improved renal function" + ref "did not assess renal endpoints" → **not_supported** (silent — rule 2).
- Claim "effective in **all** patients" + ref "effective in patients with **moderate-to-severe** disease" → **overclaim** (scope broadened beyond the reference — rule 3).
- Claim "reduced HbA1c more than placebo" + ref = data table only (no narrative sentence) → **implied_by_data** (rule 5).
- Claim "reduced body weight **and** blood pressure" + ref supports weight (p<0.001) but BP "not significant" → **partial_support** (one element holds — rule 4).

## Ordinal scale (for adjacency scoring)

Verdicts are ordered by **how well the claim, as written, is borne out by the reference** — used only to compute the softer "off-by-one" adjacency metric. Exact-match remains the primary metric.

```
strong_support > partial_support > implied_by_data > overclaim > not_supported > contradicted
```

Rationale: `implied_by_data` means the claim *is* supported (just via data), so it ranks above `overclaim` (partly true but overstated), which ranks above `not_supported` (no support), which ranks above `contradicted` (actively refuted). This is a judgment call — it is documented here so the adjacency metric is reproducible, not silent.

## Per-verdict gold-case field

Each `goldVerdict` may carry a short `rationale` so a reviewer can verify the label fast:

```json
{ "claimText": "...", "citation": 1, "verdict": "overclaim",
  "rationale": "Ref reports an 18% reduction but never states significance; claim asserts 'significantly' — overstated, not denied (rule 1)." }
```

The scorer ignores `rationale`; it exists purely for human verification and provenance.
