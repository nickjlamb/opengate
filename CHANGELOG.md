# Changelog

All notable changes to OpenGATE are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog covers the `@pharmatools/opengate` framework. Related packages
version independently: `opengate-grounding` (PyPI), `@pharmatools/opengate-mcp`
(npm), and the `pharmatools/opengate` Docker image.

## [Unreleased]

_Nothing yet — open a PR._

## [0.9.0] — 2026-07-06

The evidence-grounding release: one shared grounding core, now reachable from
five surfaces.

### Added

- **Grounding scorer + capability** — the turnkey path for generic RAG and
  document-QA systems: deterministic answer-anchor recall, fabrication checks
  against the retrieved context, and abstention on unanswerable questions. No
  verdict scale, no citation mapping, no LLM judge.
- **Shared grounding core** (`src/lib/grounding-check.mjs`) — a single source of
  truth behind the scorer, the MCP server, and the Python port.
- **Python package** — [`opengate-grounding`](https://pypi.org/project/opengate-grounding/)
  (0.1.0), a zero-dependency port of the grounding core, with an `assert_grounded`
  pytest helper and a `GroundingMetric` for [DeepEval](https://deepeval.com).
- **MCP server** — [`@pharmatools/opengate-mcp`](mcp/) (0.1.4), exposing a single
  `check_grounding` tool so agents can self-check before replying.
- **Docker image** — [`pharmatools/opengate`](https://hub.docker.com/r/pharmatools/opengate),
  CPU-only, multi-arch (amd64 + arm64), no GPU required.
- **Worked example** — [evaluating an NVIDIA NIM-powered RAG agent](examples/nim-rag),
  with a runnable Python notebook and a Node CI adapter.
- **HTML report** — `--report` (and `opengate report`) render a self-contained
  dashboard: pass/fail per scorer, deltas vs baseline, every named failure.
- **PubCrawl retrieval capability** — scores retrieval fidelity of a non-AI system
  against hand-verified anchors and structural invariants.

### Changed

- Grounding logic consolidated into one module so the scorer, MCP server, and
  Python package stay in lockstep (verified byte-for-byte across implementations).
- README rebuilt around the multi-surface story with a rendered architecture
  diagram; contributing, changelog, and roadmap split into their own documents.

## Earlier

Pre-0.9.0 milestones, which predate this changelog:

- **Regression gate** — per-adapter baselines (`baseline.<adapter>.json`) and
  `--ci` failing the build on any metric drop.
- **Adapter surface** — pluggable one-file adapters, a no-code HTTP adapter driven
  by `opengate.http.json`, and load-time validation.
- **GitHub Action** — OpenGATE as a drop-in CI gate for any repository.
- **Capability implementations** — QA/citations (RefCheckr), redaction (Redacta),
  and simplification (Patiently AI), each with its own gold set and scorers.

[Unreleased]: https://github.com/nickjlamb/opengate/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/nickjlamb/opengate/releases/tag/v0.9.0
