// RefCheckr adapter — the reference implementation of the OpenGATE adapter
// contract (see ADAPTERS.md). Selected by default; to evaluate a different
// system, write an adapter with the same exports and select it with
// OPENGATE_ADAPTER=./path/to/adapter.mjs.
//
// OFFLINE scorers don't touch this. ONLINE scorers call it to exercise the real
// RefCheckr endpoints. Configure via env:
//   REFCHECKR_BASE_URL   e.g. http://localhost:3848 or https://refcheckr.pharmatools.ai
//   REFCHECKR_TOKEN      a valid auth token (endpoints are behind checkAuth)
//
// Kept deliberately thin: each method maps to one endpoint and returns parsed
// JSON, so scorers stay focused on measurement, not transport.

export const meta = { name: 'refcheckr' };

const BASE = process.env.REFCHECKR_BASE_URL;
const TOKEN = process.env.REFCHECKR_TOKEN;

export function onlineAvailable() {
  return Boolean(BASE && TOKEN);
}

export function onlineConfigHint() {
  return 'Set REFCHECKR_BASE_URL and REFCHECKR_TOKEN to run online scorers.';
}

// Optional label for which model the deployment was running during this eval.
// The adapter can't infer the server's model, so the operator names it, e.g.
//   export OPENGATE_EVAL_MODEL=claude-haiku-4-5
// It's recorded in the scorecard so per-model runs stay comparable.
// (REFCHECKR_EVAL_MODEL is accepted as a legacy fallback.)
export function runModel() {
  return process.env.OPENGATE_EVAL_MODEL || process.env.REFCHECKR_EVAL_MODEL || null;
}

// ── Timing ──────────────────────────────────────────────────────────────
// Every request through post() records its wall-clock latency here so scorers
// can report p50/p95. Call resetTiming() at the start of a scorer, then read
// callLatencies(pathFilter) after the calls complete.
const _calls = [];
export function resetTiming() { _calls.length = 0; }
export function callLatencies(pathIncludes) {
  const rows = pathIncludes ? _calls.filter(c => c.path.includes(pathIncludes)) : _calls.slice();
  return rows.map(c => c.ms);
}

/** p-th percentile (0–100) of a numeric array; null if empty. */
export function percentile(values, p) {
  const xs = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const idx = Math.min(xs.length - 1, Math.floor((p / 100) * xs.length));
  return xs[idx];
}

// ── Token usage ─────────────────────────────────────────────────────────
// When the server surfaces a `usage` block (model token counts), post() records
// it here so scorers can compute real cost per claim. Call resetTokens() at the
// start of a scorer, then tokenTotals(pathFilter) after the calls complete.
const _tokens = [];
export function resetTokens() { _tokens.length = 0; }
export function tokenTotals(pathIncludes) {
  const rows = pathIncludes ? _tokens.filter(t => t.path.includes(pathIncludes)) : _tokens.slice();
  const sum = (k) => rows.reduce((a, t) => a + (t[k] || 0), 0);
  return {
    calls: rows.length,
    prompt_tokens: sum('prompt_tokens'),
    completion_tokens: sum('completion_tokens'),
    reasoning_tokens: sum('reasoning_tokens'),
    total_tokens: sum('total_tokens'),
  };
}

async function post(path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${path} → HTTP ${res.status}`);
    if (data && data.usage) {
      _tokens.push({
        path,
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
        reasoning_tokens: data.usage.reasoning_tokens || 0,
        total_tokens: data.usage.total_tokens || 0,
      });
    }
    return data;
  } finally {
    _calls.push({ path, ms: performance.now() - t0 });
  }
}

/** POST /api/claims/split → { claims: [{ text, originalText, citations }] } */
export function splitClaims(text) {
  return post('/api/claims/split', { text });
}

/**
 * Batch verify — POST /api/verify/batch.
 * payload: { claims[], documents[{name,type,content}], citationMapping, claimCitations, document_name }
 */
export function analyzeBatch(payload) {
  return post('/api/verify/batch', payload);
}
