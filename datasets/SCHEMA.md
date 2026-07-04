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
