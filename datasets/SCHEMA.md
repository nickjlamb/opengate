# Gold case schema

One JSON file per case in `datasets/cases/` (files starting with `_` are ignored, e.g. `_template.json`).

| Field | Required | Used by | Meaning |
|---|---|---|---|
| `id` | yes | all | Unique slug. |
| `title` / `notes` | no | — | Human context / provenance. |
| `manuscript` | yes | claim-extraction | The pasted section, with citation markers exactly as authored. |
| `goldClaims[]` | yes | citation-detection, claim-extraction | The verifiable claims a reviewer should extract. Each has `originalText` (with markers), `text` (clean), and `citations` (number array). |
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
