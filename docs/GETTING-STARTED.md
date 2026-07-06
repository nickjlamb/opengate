# Getting started: evaluate your own system

OpenGATE evaluates evidence-grounded AI — systems that must justify their answers from source material. This guide takes you from zero to a passing CI gate on **your** system, whether that's enterprise RAG, document QA, a legal assistant, a scientific-literature tool, or a redaction/simplification pipeline.

The whole model is four steps:

1. **Pick the capability** that matches what your system does.
2. **Connect your system** — a config file (no code) or a small adapter.
3. **Write gold cases** in your own domain.
4. **Gate CI** so a regression can't ship.

You never send OpenGATE your model. It calls your system, compares the output to hand-labelled gold, and fails the build if a metric drops.

> **Fastest start:** `npx @pharmatools/opengate init` scaffolds a starter gold set, an `opengate.http.json`, and a ready GitHub Action into your repo — then jump to step 2 to point it at your endpoint. The steps below explain what each piece does.

---

## 1. Pick your capability

| Your system… | Capability | What gets scored |
|---|---|---|
| Answers questions from retrieved context (RAG, doc QA, legal AI, scientific assistants) | **`grounding`** | Did it answer correctly from context, without inventing facts, and abstain when the context lacks the answer? |
| Extracts claims and verifies them against cited references on a graded scale | **`qa`** | Claim extraction quality + verdict accuracy + passage hallucination |
| Rewrites text for a different audience (simplification, translation, summarisation) | **`simplify`** | Do critical facts survive the rewrite, with nothing fabricated? |
| Removes identifiers / PII from text | **`redaction`** | Are all gold identifiers actually removed? |
| Retrieves records from an authority (search/DB wrappers) | **`retrieval`** | Does the record match the source — no dropped or garbled fields? |

**Most RAG / QA teams want `grounding`.** It's the turnkey path: no verdict taxonomy to adopt, no citation-mapping contract. If your system does graded evidence-verification with citations (like RefCheckr), `qa` is richer but you'll map your output onto its six-point scale — see [ADAPTERS.md](../ADAPTERS.md).

---

## 2. Connect your system

### No-code: the HTTP adapter

If your system has an HTTP endpoint, you don't write any code. Copy the example config and point it at your endpoint:

```bash
cp opengate.http.example.json opengate.http.json
```

For a grounding (RAG) system, you only need an `answer` endpoint:

```json
{
  "name": "my-rag",
  "baseUrl": "${MY_RAG_URL}",
  "headers": { "Authorization": "Bearer ${MY_RAG_TOKEN}" },
  "endpoints": { "answer": "/api/answer" }
}
```

`${VAR}` placeholders are read from the environment, so tokens never sit in the file. Your `/api/answer` endpoint receives `{ question, context }` and should return `{ "text": "…the answer…" }` (or `{ "answer": "…" }`).

### With code: a 15-line adapter

If your system is a library or needs custom wiring, write an adapter — one file implementing your capability's method plus two config hooks:

```js
// adapters/my-rag.mjs
export const meta = { name: 'my-rag' };

export const onlineAvailable = () => Boolean(process.env.MY_RAG_URL);
export const onlineConfigHint = () => 'Set MY_RAG_URL to run the grounding scorer.';

export async function answer({ question, context }) {
  const res = await fetch(`${process.env.MY_RAG_URL}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context }),
  });
  const data = await res.json();
  return { text: data.answer };   // map your response shape to { text }
}
```

That's the entire contract for grounding. (Other capabilities have their own one or two methods — [ADAPTERS.md](../ADAPTERS.md) lists them all.)

---

## 3. Write gold cases

Gold cases are where *your* domain knowledge goes. A grounding case is a question, the context your retriever would return, and the facts a correct answer must contain:

```json
{
  "id": "refund-policy",
  "kind": "grounding",
  "question": "How many days do customers have to request a refund, and is there a fee?",
  "context": "Customers may request a full refund within 30 days of purchase. There is no restocking fee for standard plans.",
  "answerAnchors": [
    { "value": "30 days", "aliases": ["30-day", "thirty days"] },
    { "value": "no restocking fee", "aliases": ["no fee"] }
  ],
  "answerable": true
}
```

Two things make this robust:

- **Anchors, not exact strings.** You assert the *facts* that must appear ("30 days", "no restocking fee"), with aliases for phrasing variants — not a verbatim expected answer. Paraphrase is fine; dropping a fact is not.
- **Unanswerable cases.** Add cases where the context does *not* contain the answer and set `answerable: false`. A faithful system must abstain; a hallucinating one gets caught:

```json
{
  "id": "price-not-in-context",
  "kind": "grounding",
  "question": "What is the annual price of the Enterprise plan?",
  "context": "Our Pro plan includes unlimited projects and a 30-day trial. Contact sales for volume discounts.",
  "answerable": false
}
```

Put these in a `datasets/cases/` directory in your repo. The full field reference is in [datasets/SCHEMA.md](../datasets/SCHEMA.md). Aim for a handful of cases covering your real failure modes first — coverage grows over time.

> **Tip:** the bundled `datasets/cases/grounding-*.json` are runnable examples (a SaaS refund policy, a legal termination clause, an unanswerable case). Copy one and edit.

---

## 4. Run it, then gate CI

Run locally against your system:

```bash
node src/runner.mjs --online \
  --adapter ./src/adapters/http.mjs \
  --datasets ./datasets \
  --results ./results
```

You'll get a scorecard: answer recall, ungrounded-number count, abstention rate, and a **PASS/FAIL**. Every failure is named ("missing answer fact …", "ungrounded number …", "did not abstain"), so you know exactly what broke.

Add `--report` for a shareable HTML dashboard (`results/report.html`) — pass/fail per scorer, deltas vs baseline, and the named failures, in one self-contained file you can open or attach to a CI run:

```bash
node src/runner.mjs --online --adapter ./src/adapters/http.mjs --datasets ./datasets --results ./results --report
```

Save a baseline once you're happy, then gate every change against it:

```bash
node src/runner.mjs --online --adapter ./src/adapters/http.mjs --datasets ./datasets --results ./results --baseline
```

Baselines are **per-adapter** (`baseline.<adapter>.json`), so different systems keep separate references. Commit it, then add the GitHub Action:

```yaml
# .github/workflows/opengate.yml
- uses: nickjlamb/opengate@v0
  with:
    datasets: ./datasets
    results: ./results          # your committed baseline.<adapter>.json lives here
    adapter: ./src/adapters/http.mjs
    online: 'true'
  env:
    MY_RAG_URL: ${{ vars.MY_RAG_URL }}
    MY_RAG_TOKEN: ${{ secrets.MY_RAG_TOKEN }}
```

Now any prompt, model, or pipeline change that drops answer recall — or starts inventing figures, or stops abstaining — fails the build before it ships.

---

## What OpenGATE deliberately does *not* do

- **No LLM-as-judge.** Scores are deterministic checks against hand-labelled gold. That makes them reproducible and free to run in CI, and means the gold set is where your judgment lives — not a grader model's.
- **No general "quality" score.** OpenGATE measures whether an answer is *grounded in its evidence*, not whether it's fluent or helpful. For broad quality metrics, pair it with a general framework like DeepEval; use OpenGATE to gate the grounding.
- **It never sees your model or weights.** It calls your system's interface, exactly as a user would.

## Next steps

- Full capability contracts and the minimal adapter for each: **[ADAPTERS.md](../ADAPTERS.md)**
- Gold-case field reference for every `kind`: **[datasets/SCHEMA.md](../datasets/SCHEMA.md)**
- Questions or an adapter for a system that doesn't fit? Open an issue.
