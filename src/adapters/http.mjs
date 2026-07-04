// Generic HTTP adapter — evaluate any REST-backed system without writing code.
//
// Point OpenGATE at a JSON config describing your endpoints:
//
//   OPENGATE_ADAPTER=./src/adapters/http.mjs npm run eval:online
//
// Config is read from OPENGATE_HTTP_CONFIG (default: ./opengate.http.json,
// resolved from the current working directory):
//
//   {
//     "name": "my-system",
//     "baseUrl": "${MY_SYSTEM_URL}",
//     "headers": { "Authorization": "Bearer ${MY_SYSTEM_TOKEN}" },
//     "endpoints": {
//       "splitClaims": "/api/claims/split",
//       "analyzeBatch": "/api/verify/batch"
//     },
//     "modelEnv": "MY_SYSTEM_MODEL"
//   }
//
// ${VAR} placeholders are interpolated from the environment at load time.
// The endpoints must speak the OpenGATE contract shapes (see ADAPTERS.md):
// if your API uses different shapes, write a thin code adapter instead —
// this adapter maps transport, not payloads.
//
// Latency and token capture are built in: every call's wall-clock time is
// recorded, and any `usage` block in a response is aggregated for cost/claim.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Config ──────────────────────────────────────────────────────────────
const CONFIG_PATH = resolve(process.cwd(), process.env.OPENGATE_HTTP_CONFIG || 'opengate.http.json');

function interpolate(value, missing) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
      const v = process.env[name];
      if (v == null || v === '') { missing.add(name); return ''; }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map(v => interpolate(v, missing));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, missing)]));
  }
  return value;
}

let config = null;
let configError = null;
const missingEnv = new Set();
try {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  config = interpolate(raw, missingEnv);
  if (!config.baseUrl) configError = 'config has no baseUrl';
  else if (!config.endpoints?.splitClaims || !config.endpoints?.analyzeBatch) {
    configError = 'config.endpoints must define splitClaims and analyzeBatch paths';
  }
} catch (err) {
  configError = err.code === 'ENOENT'
    ? `no config found at ${CONFIG_PATH}`
    : `could not parse ${CONFIG_PATH}: ${err.message}`;
}

export const meta = { name: config?.name || 'http' };

export function onlineAvailable() {
  return Boolean(config && !configError && missingEnv.size === 0);
}

export function onlineConfigHint() {
  if (missingEnv.size) return `HTTP adapter: unset environment variable(s): ${[...missingEnv].join(', ')}.`;
  if (configError) return `HTTP adapter: ${configError}. Set OPENGATE_HTTP_CONFIG or create opengate.http.json (see ADAPTERS.md).`;
  return 'HTTP adapter: configuration incomplete.';
}

export function runModel() {
  const envName = config?.modelEnv;
  return (envName && process.env[envName]) || process.env.OPENGATE_EVAL_MODEL || null;
}

// ── Timing & token capture (same pattern as the reference adapter) ──────
const _calls = [];
export function resetTiming() { _calls.length = 0; }
export function callLatencies() { return _calls.map(c => c.ms); }

const _tokens = [];
export function resetTokens() { _tokens.length = 0; }
export function tokenTotals() {
  const sum = (k) => _tokens.reduce((a, t) => a + (t[k] || 0), 0);
  return {
    calls: _tokens.length,
    prompt_tokens: sum('prompt_tokens'),
    completion_tokens: sum('completion_tokens'),
    reasoning_tokens: sum('reasoning_tokens'),
    total_tokens: sum('total_tokens'),
  };
}

// ── Transport ───────────────────────────────────────────────────────────
async function post(path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${path} → HTTP ${res.status}`);
    if (data && data.usage) {
      _tokens.push({
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

export function splitClaims(text) {
  return post(config.endpoints.splitClaims, { text });
}

export function analyzeBatch(payload) {
  return post(config.endpoints.analyzeBatch, payload);
}
