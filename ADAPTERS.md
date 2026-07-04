# Writing an adapter

An adapter is the boundary between OpenGATE's scorers and the system under test. Scorers never make network calls directly — they call the adapter, so evaluating a new system means writing one file. The bundled RefCheckr adapter (`src/adapters/refcheckr.mjs`) is the reference implementation.

**The methodology travels; only the gold set changes** — and the adapter is how it travels.

## Selecting an adapter

```bash
# default: the bundled RefCheckr adapter
npm run eval:online

# your own
OPENGATE_ADAPTER=./adapters/my-system.mjs npm run eval:online
```

Relative paths resolve from the current working directory. The adapter is loaded and validated before any scorer runs — a malformed adapter fails fast with a message listing every missing or mistyped export, even on offline runs.

## The contract

### Required exports

```js
/**
 * Extract candidate claims from a document.
 * @param {string} text — the source document (e.g. a manuscript section)
 * @returns {Promise<{ claims: Array<string | { text, originalText?, citations? }> }>}
 */
export function splitClaims(text) {}

/**
 * Verify claims against reference documents.
 * @param {object} payload
 *   { claims: string[],
 *     documents: [{ name, type: 'text', content }],
 *     citationMapping: { [citation]: { refId } },
 *     claimCitations: [{ citations: string[] }],
 *     document_name: string }
 * @returns {Promise<{ claims: [{ individual_analyses: [{ document_name, verdict, summary, passages }] }],
 *                     usage?: { prompt_tokens, completion_tokens, reasoning_tokens, total_tokens } }>}
 *   `verdict` must be one of the six values in VERDICT_SCALE (src/lib/metrics.mjs):
 *   strong_support · partial_support · implied_by_data · overclaim · not_supported · contradicted
 */
export function analyzeBatch(payload) {}

/** True when the adapter has the config it needs (URLs, tokens, …). */
export function onlineAvailable() {}

/** Human-readable hint shown when onlineAvailable() is false. */
export function onlineConfigHint() {}
```

### Optional exports

If absent, the loader supplies no-op defaults, so scorers can call these unconditionally. Implement them to get latency, cost, and model-comparison columns in your scorecards.

```js
/** Display name for the scorecard header; defaults to the filename. */
export const meta = { name: 'my-system' };

/** Label for which model the deployment ran (e.g. from an env var); default null. */
export function runModel() {}

/** Clear latency capture; called at the start of a scorer run. */
export function resetTiming() {}

/** Wall-clock ms for each call made since resetTiming(); default []. */
export function callLatencies() {}

/** Clear token capture; called at the start of a scorer run. */
export function resetTokens() {}

/** Aggregated token usage since resetTokens();
 *  default { calls: 0, prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, total_tokens: 0 }. */
export function tokenTotals() {}
```

## Minimal skeleton

```js
// adapters/my-system.mjs
export const meta = { name: 'my-system' };

const BASE = process.env.MY_SYSTEM_URL;

export const onlineAvailable = () => Boolean(BASE);
export const onlineConfigHint = () => 'Set MY_SYSTEM_URL to run online scorers.';

export async function splitClaims(text) {
  const res = await fetch(`${BASE}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  return { claims: data.claims }; // map your shape to the contract
}

export async function analyzeBatch(payload) {
  const res = await fetch(`${BASE}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json(); // must include claims[].individual_analyses[].verdict
}
```

Run it:

```bash
OPENGATE_ADAPTER=./adapters/my-system.mjs npm run eval:online
```

## Notes

- **Verdict mapping.** If your system uses a different verdict taxonomy, map it to the six-point scale inside the adapter. Adjacency accuracy assumes the scale's ordering (see `datasets/LABELING-GUIDE.md`).
- **Gold set.** The bundled cases are biomedical. For your domain, author your own cases in `datasets/cases/` — the format spec is `datasets/SCHEMA.md`.
- **Timing/token capture.** See the reference adapter for a pattern: wrap your HTTP helper to record per-call latency and any `usage` block the server returns.
- **Stability.** The adapter surface may still shift pre-1.0; `validateAdapter()` in `src/lib/adapter.mjs` is the source of truth.
