// Redacta adapter — second bundled implementation, exercising the framework's
// redaction capability. Wraps @pharmatools/redacta, the dependency-free
// engine behind the Redacta app, iPhone app, CLI, and MCP server.
//
// OpenGATE itself stays zero-dependency: the engine is imported dynamically
// and this adapter reports how to install it when absent:
//
//   npm install --no-save @pharmatools/redacta
//   node src/runner.mjs --online --adapter ./src/adapters/redacta.mjs
//
// Config via env:
//   OPENGATE_REDACTA_CATEGORIES   comma-separated: clinical,general,safeharbor
//                                 (default: clinical,general)

export const meta = { name: 'redacta' };

let engine = null;
let loadError = null;
try {
  engine = await import('@pharmatools/redacta');
} catch (err) {
  loadError = err;
}

export function onlineAvailable() {
  return Boolean(engine);
}

export function onlineConfigHint() {
  return 'Redacta engine not installed — run: npm install --no-save @pharmatools/redacta' +
    (loadError ? ` (${loadError.code || loadError.message})` : '');
}

function categories() {
  return (process.env.OPENGATE_REDACTA_CATEGORIES || 'clinical,general')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// ── Timing capture (local calls, but latency is still worth recording) ──
const _calls = [];
export function resetTiming() { _calls.length = 0; }
export function callLatencies() { return _calls.map(c => c.ms); }

/**
 * Redaction capability. A fresh Redactor per call keeps token maps
 * case-scoped, so identical values across cases can't mask each other.
 * Returns { text, entities: [{ token, type, value }] }.
 */
export async function redact(text) {
  const t0 = performance.now();
  try {
    const r = new engine.Redactor(categories());
    const { text: redacted } = r.redactText(text);
    const entities = Object.entries(r.tokenMap).map(([token, value]) => ({
      token,
      type: token.replace(/^\[|_\d+\]$/g, ''),
      value,
    }));
    return { text: redacted, entities };
  } finally {
    _calls.push({ ms: performance.now() - t0 });
  }
}
