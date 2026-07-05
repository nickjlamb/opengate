// Patiently AI adapter — third bundled implementation, exercising the
// framework's simplify capability. Patiently AI (getpatiently.ai) converts
// clinical text into patient-friendly language via a Firebase Cloud Function.
//
// Config via env (the endpoint is public; no token needed):
//   PATIENTLY_API_URL     override the translate endpoint
//   PATIENTLY_EVAL_MODEL  optional label recorded in the scorecard
//
// Request contract: POST { text, language, audience, tone, length }
// Response contract: { optimisedText }
// Patiently-flavoured keys: audience Child|Teenager|Adult|Carer,
// tone Friendly|Reassuring|Informative, length Brief|Standard|Detailed.

export const meta = { name: 'patiently' };

const DEFAULT_URL = 'https://us-central1-medicaltextoptimiser.cloudfunctions.net/translate';
const URL = process.env.PATIENTLY_API_URL || DEFAULT_URL;

export function onlineAvailable() {
  return Boolean(URL);
}

export function onlineConfigHint() {
  return 'Set PATIENTLY_API_URL (or unset it to use the production endpoint).';
}

export function runModel() {
  return process.env.PATIENTLY_EVAL_MODEL || null;
}

// ── Timing capture ──────────────────────────────────────────────────────
const _calls = [];
export function resetTiming() { _calls.length = 0; }
export function callLatencies() { return _calls.map(c => c.ms); }

/**
 * Simplify capability.
 * @param {object} req — { text, audience?, tone?, length?, language? }
 * @returns {Promise<{ text: string }>}
 */
export async function simplify(req) {
  const t0 = performance.now();
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: req.text,
        language: req.language || 'en',
        audience: req.audience || 'Adult',
        tone: req.tone || 'Informative',
        length: req.length || 'Standard',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `translate → HTTP ${res.status}`);
    if (typeof data.optimisedText !== 'string') {
      throw new Error('translate response missing optimisedText');
    }
    return { text: data.optimisedText };
  } finally {
    _calls.push({ ms: performance.now() - t0 });
  }
}
