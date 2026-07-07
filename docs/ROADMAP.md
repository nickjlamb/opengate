# Roadmap

OpenGATE is production-used but pre-1.0 — the core is stable, the adapter surface
may still shift. This is a direction of travel, not a commitment; priorities move
with real usage. Have an opinion? [Open an issue](https://github.com/nickjlamb/opengate/issues).

## Near term

- [ ] **Grounding depth** — the grounding scorer checks anchor recall, fabrication,
  and abstention. Add contextual precision/recall of the retrieved passages
  themselves, so retrieval quality is scored alongside answer grounding.
- [ ] **Retrieval breadth** — retrieval currently scores one PubMed record type;
  extend to full-text, citation formatting, and trial (NCT) detail across
  PubCrawl's other tools.
- [ ] **Retrieval coverage** — grow the retrieval gold set beyond a single case:
  add a single-author paper (the array-collapse risk the capability exists to
  catch) and a trial record.
- [ ] **Growing gold set** — more domains, all six verdict types, real-world
  reference material.

## Ecosystem

- [ ] **More worked examples** — LangChain and LlamaIndex RAG, OpenAI Responses,
  and a hosted-endpoint quickstart, each gating grounding in CI.
- [ ] **NVIDIA NIM integrations** — embedding/reranking NIMs for the retriever in
  the RAG examples; evaluate NeMo Guardrails-equipped pipelines.
- [ ] **Published gold datasets** — release select gold sets for reproducible
  benchmarking (licensing permitting).

## Toward 1.0

- [ ] **Stable adapter surface** — freeze the adapter contract; semver will signal
  any breaking change.
- [ ] **Number-adjacent superscript** — `week 24.1` is genuinely ambiguous with
  decimals; currently a tracked known gap in citation detection.
- [ ] **Docs coverage** — a scorer-authoring guide to match the adapter guide.

## Done

- [x] Deterministic grounding scorer + shared core (LLM-judge-free)
- [x] Per-adapter regression gate + `--ci`
- [x] No-code HTTP adapter + GitHub Action
- [x] HTML report
- [x] Python package (`opengate-grounding`) + DeepEval metric
- [x] MCP server (`@pharmatools/opengate-mcp`)
- [x] CPU-only Docker image (multi-arch)
- [x] Worked example: NVIDIA NIM-powered RAG agent
