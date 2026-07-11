# Contributing to OpenGATE

Thanks for your interest in OpenGATE. Contributions that make evidence-grounded AI easier to evaluate are very welcome — especially new gold cases, adapters, and scorers.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Gold cases** — new domains and citation styles. The gold set *is* the judgment in OpenGATE, so more, better-labelled cases directly improve the framework. See [`datasets/LABELING-GUIDE.md`](datasets/LABELING-GUIDE.md).
- **Adapters** — connect OpenGATE to your evidence-grounded system. One file, a couple of exports. See [ADAPTERS.md](ADAPTERS.md).
- **Scorers** — new metric families that fit the gold-case format.
- **Docs and examples** — clearer guides, new worked examples (like [`examples/nim-rag`](examples/nim-rag)).
- **Bugs and ideas** — open an [issue](https://github.com/nickjlamb/opengate/issues).

## Development setup

Requires Node.js ≥ 18 (no build step, no framework).

```bash
git clone https://github.com/nickjlamb/opengate.git
cd opengate
npm install
npm test            # unit tests (metrics, citations, adapters, grounding — 124 tests)
npm run eval        # offline evaluation suite against the bundled gold set
```

The offline suite needs no API key. To exercise online scorers, point an adapter at a live system (see below).

## Project structure

```
src/lib/          metrics.mjs, citations.mjs, grounding-check.mjs (shared core)
src/scorers/      one module per metric family
src/adapters/     the system-under-test boundary
src/runner.mjs    the CLI
datasets/cases/   gold-labelled cases (copy _template.json to add)
tests/            node:test unit tests
python/           opengate-grounding (Python port of the grounding core)
mcp/              the MCP server
```

The grounding logic lives in exactly one place — `src/lib/grounding-check.mjs` — and is shared by the scorer, the MCP server, and (as a faithful port) the Python package. Change it there and everything stays in lockstep.

## Adding a gold case

1. Copy `datasets/cases/_template.json` and fill it in following [`datasets/SCHEMA.md`](datasets/SCHEMA.md) and [`datasets/LABELING-GUIDE.md`](datasets/LABELING-GUIDE.md).
2. Label conservatively and cite the source — the gold set is a shared source of truth, not a guess.
3. Run `npm run eval` (and `--online` if the case exercises an online scorer) to confirm it's picked up and scores as expected.

## Adding an adapter

An adapter needs `onlineAvailable()` and `onlineConfigHint()` plus at least one complete capability (e.g. `grounding` → `answer()`). It's validated at load, so a malformed adapter fails fast with a message naming every missing export. Full contract and a minimal skeleton are in [ADAPTERS.md](ADAPTERS.md); [`src/adapters/refcheckr.mjs`](src/adapters) is the reference implementation.

## Adding a scorer

Each scorer is a module in `src/scorers/` exporting `meta` (`{ id, mode }`) and an async `run({ cases, adapter })`. Keep scoring **deterministic** — OpenGATE is LLM-judge-free by design. Return named failures (not just a number) so the HTML report and CI output stay actionable.

## Pull requests

1. Fork and branch from `main`.
2. Keep changes focused; open an issue first for anything large or interface-affecting.
3. Run `npm test` and `npm run eval:ci` — both must pass. CI runs the same on every PR.
4. Update docs and the [CHANGELOG](CHANGELOG.md) (`Unreleased` section) where relevant.
5. Write a clear PR description: what changed, why, and how you verified it.

## Conventions

- ES modules throughout (`import`/`export`), `.mjs`, `const`-first, `async`/`await`.
- No new runtime dependencies without discussion — zero-dependency is a feature.
- Determinism is non-negotiable in scorers and the grounding core.

## Versioning

OpenGATE follows [semantic versioning](https://semver.org). The adapter surface may still shift pre-1.0; breaking changes will be called out in the [CHANGELOG](CHANGELOG.md) and signalled by the version bump.

## Support and governance

OpenGATE is maintained by [Nick Lamb](https://www.pharmatools.ai) (PharmaTools.AI), who runs it in production across the PharmaTools product line — so the framework is exercised daily, not maintained out of obligation. What you can expect:

- **Issues and PRs** are reviewed on a best-effort basis, typically within a week. Bug reports with a failing gold case or test attached get priority — that's the house style.
- **Decisions** rest with the maintainer, made in the open: design discussion happens in issues, and the reasoning behind changes lives in commit messages and the [CHANGELOG](CHANGELOG.md).
- **Security reports** go through [SECURITY.md](SECURITY.md), not public issues.
- **Releases** are tagged (`vX.Y.Z`), published to npm as `@pharmatools/opengate`, and documented in the changelog.

## AI-assisted development disclosure

Parts of OpenGATE — code, tests, and documentation — were developed with AI assistance (Anthropic's Claude), under human direction and review throughout: the problem framing, capability design, scoring philosophy (deterministic, no LLM-as-judge), gold-set labels, and every merge decision are the maintainer's. Contributions made with AI assistance are welcome under the same standard: you must have reviewed, understood, and tested what you submit, and you own it. If a substantial portion of a PR is AI-generated, say so in the PR description.

## Questions

Open an [issue](https://github.com/nickjlamb/opengate/issues) or start a discussion. Thanks for helping make AI evaluation less of a black box.
