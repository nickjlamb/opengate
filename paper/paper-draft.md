# Evaluation as Infrastructure: Deterministic Regression Gating for Evidence-Grounded AI Systems in Production

> **Status: DRAFT v0.1** — content draft for arXiv (cs.SE) and CAIN 2027 (full paper, IEEE 10+2).
> Target: double-anonymous submission — this file uses real names; anonymize (title change, anonymous.4open.science artifact link, third-person self-citations) at submission time.
> `TODO(exp-1)` and `TODO(exp-2)` mark the two strengthening experiments to run before submission.

**Author:** Nick Lamb (PharmaTools.AI) — *single author; AI-assistance disclosure in Acknowledgments.*

---

## Abstract

AI systems are increasingly deployed in domains where an answer is only useful if it can be justified from source material: clinical claim verification, patient-facing simplification of medical text, de-identification, and retrieval over biomedical authorities. Prevailing evaluation practice measures whether outputs are *plausible* — often using a second language model as judge — which is costly, non-deterministic, and difficult to gate a release on. We present OpenGATE, an open-source framework that treats evaluation of evidence-grounded AI as continuous engineering infrastructure: hand-labelled gold datasets, deterministic scorers (no LLM-as-judge), reproducible scorecards, and a per-adapter regression gate wired into continuous integration. The framework defines five *capabilities* — evidence QA, redaction, simplification, retrieval, and generic grounding — behind a small adapter contract, so one methodology evaluates systems of different task shapes. We report experience applying OpenGATE to four production systems operated by a single small organisation, including an MHRA-registered medical device. On its first run against each system the framework surfaced real defects that human review and conventional testing had missed, including a silent parse-failure mode affecting roughly half of multi-claim verdicts, two name-capture failures in a de-identification engine, and a simplifier that dropped an antibiotic dose from a discharge summary. Each was fixed and re-verified by the same gate, typically the same day. We describe the design principles, the found-and-fixed ledger, a tracked-known-gap lifecycle that turns honest limitation reporting into a test-driven workflow, and the limitations of deterministic scoring. OpenGATE is available under the MIT licence.

**Keywords** — AI engineering, evaluation, regression testing, retrieval-augmented generation, grounding, hallucination, continuous integration, medical AI

---

## 1. Introduction

Software engineering answered the question "how do we change code without breaking it?" decades ago: automated tests, run on every change, gating every release. AI-enabled systems mostly lack an equivalent. Teams ship prompt changes, model upgrades, and pipeline refactors on the strength of spot checks and anecdote, because the standard evaluation tools measure the wrong thing at the wrong time: benchmark suites measure a *model* before integration, and LLM-as-judge harnesses measure *plausibility* at a per-run cost and variance that make them awkward to gate a build on.

For a class of systems we call *evidence-grounded* — systems whose core promise is that every output is justified by identified source material — this gap is acute. The failure modes that matter in production are quiet and specific: a supporting passage that does not exist verbatim in the cited source; a claim reworded before verification; a patient identifier that survives de-identification; a medication dose silently dropped from a simplified letter; an author's name lost by a retrieval parser. None of these are visible in aggregate quality scores, and none require semantic judgment to detect — they are checkable, deterministically, against labelled expectations.

This paper reports the design of, and production experience with, **OpenGATE** (Open Grounded AI Testing & Evaluation), an open-source framework built on three positions:

1. **Evaluation is infrastructure, not an experiment.** Scorers run in CI; a regression against a committed per-adapter baseline fails the build. The unit of value is not a leaderboard number but a *prevented deployment*.
2. **Judgment belongs in the gold set, not in a judge model.** All scorers are deterministic functions of system output and hand-labelled expectations. This trades semantic coverage for reproducibility, zero marginal cost, named failures, and CI-compatible stability — a trade we examine critically in §7.
3. **The methodology travels; only the gold set changes.** A small adapter contract (two base exports plus at least one *capability*) lets one framework evaluate systems of different task shapes. We currently define five capabilities: evidence QA, redaction, simplification, retrieval, and generic grounding for RAG.

Our primary contribution is empirical: an experience report across **four production systems** — a clinical claim verifier, a de-identification engine, a patient-language simplifier registered as a Class I medical device, and a biomedical retrieval server — operated by a single small organisation. The headline observation is that *on its first run against every system, the framework surfaced at least one real, previously unknown defect* (§6, Table 2), each subsequently fixed and re-verified by the same gate, typically within one day. We also contribute the framework's design (capabilities, adapter contract, per-adapter baselines), a *tracked-known-gap lifecycle* that operationalises honest limitation reporting (§4.4), and a discussion of what deterministic scoring can and cannot see.

## 2. Related Work

**LLM evaluation frameworks.** General-purpose harnesses such as DeepEval, OpenAI Evals, TruLens, and RAGAS [refs] provide metric libraries for LLM applications; RAGAS in particular targets RAG faithfulness. Most faithfulness metrics in these frameworks are LLM-as-judge: a grader model scores the output. LLM-as-judge has documented strengths for open-ended quality [Zheng et al., MT-Bench] and known weaknesses — positional and self-preference biases, prompt sensitivity, run-to-run variance, and per-invocation cost [refs: G-Eval, judge-bias studies]. OpenGATE is positioned as a complement, not a replacement: it specialises in the deterministic subset of grounding properties that can gate CI, and delegates open-ended quality to human review or general frameworks.

**Reference-based factuality checking.** FEVER [Thorne et al.], FActScore [Min et al.], SummaC [Laban et al.], and QAFactEval [refs] measure factual consistency against sources, largely via trained models over public benchmarks. OpenGATE differs in unit of deployment (a CI gate over an organisation's own gold cases, not a benchmark), and in scoring mechanics (string- and structure-level determinism rather than model inference).

**Regression testing for ML systems.** The SE4AI literature has long argued that ML components need continuous, system-level testing [refs: Sculley et al. hidden technical debt; Breck et al. ML test score; Amershi et al. SE for ML]. OpenGATE can be read as an instantiation of that argument for the specific contract of evidence-groundedness, with an empirical ledger from production.

**De-identification and simplification evaluation.** Clinical de-identification is conventionally evaluated by recall on annotated PHI corpora [refs: i2b2 challenges]; text simplification by readability and human ratings [refs]. OpenGATE's redaction and simplification scorers adapt both to the regression-gate setting, adding word-level leak scanning for partially redacted names and anchor/fabrication checks that tolerate paraphrase (§4.2).

`TODO: flesh citations; verify each ref against current literature before submission.`

## 3. Design Principles

**P1 — Deterministic scoring.** Every scorer is a pure function of (system output, gold case). No grader model, no sampling, no network beyond the system under test. Consequences: scores are reproducible bit-for-bit; a failing case names the exact expectation violated ("DROPPED FACT: anchor '500 mg' absent"); offline scorers cost nothing and run on every commit; and the framework cannot be gamed by persuading a judge. The cost is coverage: paraphrase-level semantic error is out of scope unless it disturbs an anchor, number, contract, or structural invariant (§7).

**P2 — Gold sets as the locus of judgment.** Human judgment enters exactly once: when a case is labelled. Cases are versioned JSON documents with a documented schema and labelling guide; all bundled cases are synthetic (test-range NHS numbers valid under modulus-11, Ofcom-reserved phone numbers, fictitious people), so the gold set itself is publishable.

**P3 — Capabilities behind a thin adapter.** An adapter is one file with two required exports (`onlineAvailable`, `onlineConfigHint`) plus at least one complete capability: `qa` (claim splitting + verdicts against references), `redaction` (`redact`), `simplify`, `retrieval`, or `grounding` (`answer`). Adapters are validated at load with fail-fast messages naming any missing export. A configuration-driven HTTP adapter covers REST-backed systems without code.

**P4 — Regression gating with per-adapter baselines.** `--baseline` commits a reference scorecard per adapter; subsequent runs print per-metric deltas and `--ci` fails the build on any drop in a rate metric. Scorecards are stamped with the git SHA and, where relevant, a `run_model` label — so the results directory doubles as a measured model comparison (accuracy × hallucination × latency × token cost).

**P5 — Known gaps are tracked, not hidden.** Where the system under test does not yet handle a phenomenon, the gold case records it as a *known gap* rather than a failure. The scorer reports `knownGap_open` / `knownGap_closed`; when an engine fix lands, the flip to *closed* is itself the verification, and the entity is promoted to gold. This gives limitation reporting the same lifecycle as test-driven development (§4.4).

## 4. The Framework

### 4.1 Architecture

*(Figure 1: core — gold datasets → scorers → scorecards → regression gate — connected via adapters to systems under test. Reuse the repository's mermaid diagrams.)*

The runner discovers gold cases, loads and validates one adapter, executes each scorer (offline scorers always; online scorers when `--online`), prints named failures, writes a versioned scorecard, and diffs against the adapter's baseline. A self-contained HTML report renders pass/fail, deltas, and every named failure. The deterministic grounding core also ships as a Python package, an MCP server (so agents can verify their own answers inline), and a Docker image — one check, several surfaces.

### 4.2 Scorers

*(Table 1 — seven metric families; abridge from repository README.)* Two design details matter beyond the table. First, **word-level leak scanning** in redaction: a full-string check would miss a partially redacted name ("[PATIENT_1] O'Brien" removes the labelled value yet leaks the surname), so name-typed anchors are also scanned word-by-word, with known-gap values excused. Second, **paraphrase-tolerant faithfulness** in simplification: rewritten text is paraphrase *by design*, so prose is never compared verbatim; instead critical facts must survive (anchors with aliases: "500 mg" ≈ "500mg"), every output number must trace to the source or a declared rephrasing allowance ("twice daily" → "2 times a day"), and declared length contracts are enforced.

### 4.3 What a gold case looks like

*(One boxed example: a simplification case with anchors, allowedNewNumbers, and Brief-mode contract; ~15 lines of JSON.)*

### 4.4 The known-gap lifecycle

Label honestly → the scorer reports the gap as open, not failing → fix the engine → the same run flips `knownGap_closed` → promote the entity to gold → the gate now defends the fix forever. §6 shows this lifecycle executing three times in one day against a production de-identification engine.

## 5. Systems Under Test

Four production systems, one operator (PharmaTools.AI), four task shapes:

| System | Task | Capability | Deployment context |
|---|---|---|---|
| RefCheckr | verify clinical claims against cited references | qa | commercial web app + Word add-in |
| Redacta | de-identify clinical text on device | redaction | npm/PyPI/CLI/MCP/iOS app |
| Patiently AI | simplify medical text for patients | simplify | MHRA-registered Class I device |
| PubCrawl | retrieval over PubMed/ClinicalTrials.gov | retrieval | MCP server + library |

## 6. Experience: the Found-and-Fixed Ledger

*(Table 2 — the empirical core. One row per issue: system, how found, defect, severity rationale, fix, verification, elapsed time.)*

**RefCheckr — silent verdict loss.** The first harness runs measured a parse-failure mode in batch verification: model responses that were not strict JSON were silently defaulted to "Not Supported", affecting ≈50% of multi-claim verdicts. Fix: enforced structured output on the verdict call; parse failures → 0. A later live-production run caught the *same defect class* on a second endpoint (claim splitting) as an intermittent total failure — visible only because the eval runs repeatedly — fixed the same way. The framework also drove an evidence-based model selection: across three Perplexity tiers on the same gold set (three repeats each), the mid tier roughly halved passage hallucination (5.8% → 2.4%) versus the incumbent while a reasoning tier scored higher verdict accuracy (82.8% exact) but hallucinated passages at 15.1% — disqualifying for an evidence tool. Production switched tiers on those numbers; per-1,000-claim cost was computed from measured token usage, not list-price estimates.

**Redacta — two name-capture failures and a closed feature gap.** On the first run against a new five-case gold set, redaction recall was 86%: (i) a relation phrase ("Next of kin:") loosely captured following lowercase words, failed a strict-name trim, and *consumed the region*, so the inner "daughter Anita" match never ran; (ii) the name pattern required a lowercase letter directly after the initial capital, so apostrophe surnames ("O'Brien") fell out of capture — found only because the scorer scans name anchors word-by-word. Both were fixed in the shared TypeScript engine and its Python port (verified independently), shipped across five surfaces, and confirmed by the gate: `knownGap_closed: 2`. A tracked feature gap (street-address lines) was closed the same way days later. Final scorecard: 100% recall on 25 identifiers, zero leaks, no open gaps.

**Patiently AI — dropped safety-critical specifics.** First production run: anchor recall 86% — an antibiotic dose vanished from a Brief-mode discharge summary and a haemoglobin value from a results letter; zero fabricated numbers. Root cause: the composed prompt (audience + tone + length) contained no faithfulness rule at all. The fix had a shared-backend constraint (the prompt map serves a second product), so the preservation rule was added *additively* to the three product-specific tone keys. Next run: 100% anchor recall, zero dropped facts, zero fabrications, zero contract violations — with the readability grade slightly improved. For a registered medical device, this finding alone arguably justifies the framework.

**PubCrawl — retrieval fidelity.** The retrieval capability checks that records fetched from an authority arrive intact: anchor fields (title, first author, year) plus structural invariants. Its first gold case surfaced an author-name capture error in the record-parsing heuristics, fixed and pinned by the case. `TODO: tighten this paragraph against the repository history before submission.`

**Cross-cutting observations.** (1) *First-run yield was 100%*: every system yielded at least one real defect on its first evaluation — consistent with these systems having been shipped with conventional review but no grounding-specific gate. (2) *The eval-first workflow held*: in the largest change (adding author-year citation support to RefCheckr end-to-end), gold cases were written before implementation; planning against them also exposed a latent key-collision bug (`parseInt("Smith 2020") → NaN`) that would have silently verified claims against the wrong reference document. (3) *Run-to-run variance is real and must be reported*: claim-extraction F1 fluctuates over a ~92–94% band across identical runs, and a recurring, named pattern (compound-claim decomposition) accounts for most fidelity failures — a finding a single-number benchmark would hide.

## 7. Limitations and Threats to Validity

**Self-evaluation.** The framework's author built the systems it evaluates; the gold labels encode one person's judgment. `TODO(exp-1): second independent labeller over a stratified sample of gold cases; report per-capability agreement (Cohen's κ) and reconcile disagreements in the public history.`

**No comparison baseline yet.** We claim complementarity with LLM-as-judge frameworks but have not measured it. `TODO(exp-2): run an LLM-judge faithfulness metric (e.g., RAGAS) over the same gold cases and outputs; compare stability across repeats, cost, and failure localisation against OpenGATE's deterministic scorers. Stability-vs-coverage is the interesting result either way.`

**Coverage of deterministic checks.** Anchor/number/contract checks cannot see a paraphrase that inverts meaning while preserving every anchor ("no evidence of malignancy" → "evidence of malignancy" *would* be caught by anchor loss, but subtler inversions may not be). We consider the deterministic layer a *floor*, not a ceiling.

**Scale and generality.** Gold sets are tens of cases per capability, sized for gating rather than benchmarking; all four systems share one operator and domain (healthcare); several case texts are synthetic. Findings about first-run yield may reflect this population.

**Construct validity of "found by the eval".** Some fixes (e.g., model selection) are improvements rather than defects; Table 2 separates the two.

## 8. Availability

OpenGATE is MIT-licensed at github.com/nickjlamb/opengate *(anonymize for review)*: framework, all gold cases, scorecards, per-adapter baselines, and CI configuration. npm `@pharmatools/opengate`, PyPI `opengate-grounding`, Docker `pharmatools/opengate`. Every number in §6 is reproducible from committed scorecards stamped with git SHAs.

## 9. Conclusion

Treating evaluation as infrastructure — deterministic, gold-anchored, regression-gated, and cheap enough to run on every commit — changed how one organisation ships evidence-grounded AI: five capabilities, four production systems, one standard, and a ledger of defects caught by the gate rather than by users. The approach is deliberately narrow; its narrowness is what makes it dependable. We offer the framework, the gold sets, and the ledger as a template for the many teams whose systems promise grounded answers and whose CI currently has no way to check.

## Acknowledgments

*(Funding: none / self-funded.)* **AI-assistance disclosure:** portions of the framework's code, tests, and documentation, and early drafts of this paper, were produced with AI assistance (Anthropic's Claude) under the author's direction; the problem framing, design decisions, scoring philosophy, gold-set labels, and all verification of results are the author's. This mirrors the disclosure policy the project applies to its own contributors.

## References

`TODO: complete and verify. Anticipated: DeepEval; RAGAS (Es et al.); OpenAI Evals; TruLens; MT-Bench / LLM-as-judge (Zheng et al. 2023); G-Eval (Liu et al. 2023); judge-bias studies; FEVER (Thorne et al. 2018); FActScore (Min et al. 2023); SummaC (Laban et al. 2022); QAFactEval; Hidden Technical Debt (Sculley et al. 2015); ML Test Score (Breck et al. 2017); SE for ML case study (Amershi et al. 2019); i2b2 de-identification challenges; text simplification evaluation surveys; Patiently AI validation study (SN Comprehensive Clinical Medicine, 2026).`
