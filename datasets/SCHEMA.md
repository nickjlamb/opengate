# Gold case schema

One JSON file per case in `datasets/cases/` (files starting with `_` are ignored, e.g. `_template.json`).

| Field | Required | Used by | Meaning |
|---|---|---|---|
| `id` | yes | all | Unique slug. |
| `title` / `notes` | no | — | Human context / provenance. |
| `manuscript` | yes | claim-extraction | The pasted section, with citation markers exactly as authored. |
| `goldClaims[]` | yes | citation-detection, claim-extraction | The verifiable claims a reviewer should extract. Each has `originalText` (with markers), `text` (clean), and `citations` — an array of numbers and/or author-year string keys (e.g. "Smith 2020", "Meyer 2020a"). Numeric [N] markers are stripped from `text`; author-year mentions are grammatical prose and are never stripped, so for pure author-year claims `text === originalText`. |
| `goldNonClaims[]` | no | claim-extraction | Sentences that should **not** be extracted (background, aims, transitions). Drives precision/leakage. |
| `references{}` | online only | verdict-accuracy | Map of citation-number → `{ name, text }`. |
| `goldVerdicts[]` | online only | verdict-accuracy | `{ claimText, citation, verdict }` where `verdict` ∈ the six-point scale. Mark `_requires: "online"`. |

Verdict scale (ordered, strongest support → strongest refutation): `strong_support`, `partial_support`, `implied_by_data`, `not_supported`, `contradicted`, `overclaim`.

Offline scorers need only `manuscript` + `goldClaims`. Reference texts and gold verdicts are required solely for the online verdict scorer.

## Redaction cases (`kind: "redaction"`)

Cases for the `redaction` scorer, exercising an adapter's `redact()` capability. All bundled cases are **synthetic** — test-range NHS numbers (999‑prefix, valid modulus‑11), Ofcom test phone numbers (07700 9xxxxx), example.com emails, and fictitious people.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique slug. |
| `kind` | yes | Must be `"redaction"`. |
| `description` | no | Human context; state that identifiers are synthetic. |
| `text` | yes | The source clinical note. |
| `goldEntities[]` | yes | `{ type, value }` — identifiers that MUST be removed. Any that survive (verbatim, or word-level for `*_NAME` types) are **leaks** and fail the run. |
| `knownGapEntities[]` | no | `{ type, value, comment }` — identifiers the system does not yet catch. Reported as tracked targets (`knownGap_open` / `knownGap_closed`), not failures. Use `comment` to document the reproduction. When a gap closes, promote the entity to `goldEntities`. |

## Simplification cases (`kind: "simplification"`)

Cases for the `simplification` scorer, exercising an adapter's `simplify()` capability. Simplified text is paraphrase by design, so the scorer checks what is deterministic and clinically dangerous to get wrong, not verbatim prose.

| Field | Required | Meaning |
|---|---|---|
| `id` / `kind` | yes | `kind` must be `"simplification"`. |
| `text` | yes | The source clinical text (synthetic). |
| `audience` / `tone` / `length` | no | Passed to the adapter (defaults: Adult / Informative / Standard). |
| `anchors[]` | yes | `{ value, aliases? }` — critical facts that MUST survive simplification (drug names, doses, key values, timeframes). Matched case-insensitively, whitespace-tolerant. A missing anchor is a **dropped fact** and fails the run. |
| `allowedNewNumbers[]` | no | Numbers legitimately introduced by rephrasing (e.g. "twice daily" → "2 times a day"). Any other output number absent from the source is a **fabricated number** and fails the run. |
| `maxBullets` / `maxWordsPerBullet` | no | Length-contract gates (e.g. Patiently Brief: 3 / 20). Only checked when present. |
