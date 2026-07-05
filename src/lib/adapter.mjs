// Adapter loading + validation.
//
// An adapter is the boundary between OpenGATE's scorers and the system under
// test. The bundled RefCheckr adapter (src/adapters/refcheckr.mjs) is the
// reference implementation; see ADAPTERS.md for the full contract.
//
// Select an adapter with:
//   OPENGATE_ADAPTER=./path/to/my-adapter.mjs npm run eval:online
//
// Relative paths resolve from the current working directory. When the variable
// is unset, the bundled RefCheckr adapter is used.

import { resolve, basename, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ADAPTER = join(__dirname, '..', 'adapters', 'refcheckr.mjs');

// Base exports every adapter must provide.
const REQUIRED_BASE = ['onlineAvailable', 'onlineConfigHint'];

// Capabilities: an adapter implements at least one, completely. Scorers check
// `adapter.capabilities.<name>` and skip (with a reason) when absent.
const CAPABILITIES = {
  qa: ['splitClaims', 'analyzeBatch'],       // claim extraction + verdicts against references
  redaction: ['redact'],                      // identifier removal from text
  simplify: ['simplify'],                     // faithful simplification of source text
  retrieval: ['fetchRecord'],                 // fidelity of retrieved records vs the authority
  grounding: ['answer'],                      // answer faithfully grounded in provided context (generic RAG)
};

// Optional: validated if present; no-op defaults are supplied if absent, so
// scorers can call them unconditionally.
const OPTIONAL = ['runModel', 'resetTiming', 'callLatencies', 'resetTokens', 'tokenTotals'];

const DEFAULTS = {
  runModel: () => null,
  resetTiming: () => {},
  callLatencies: () => [],
  resetTokens: () => {},
  tokenTotals: () => ({
    calls: 0, prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, total_tokens: 0,
  }),
};

/** Which capabilities does a module fully implement? */
export function detectCapabilities(mod) {
  return Object.fromEntries(
    Object.entries(CAPABILITIES).map(([name, fns]) =>
      [name, fns.every(fn => typeof mod[fn] === 'function')])
  );
}

/** Throws with a readable message listing every problem, or returns silently. */
export function validateAdapter(mod, source = 'adapter') {
  const problems = [];
  for (const fn of REQUIRED_BASE) {
    if (typeof mod[fn] !== 'function') problems.push(`missing required export: ${fn}()`);
  }
  const caps = detectCapabilities(mod);
  if (!Object.values(caps).some(Boolean)) {
    problems.push(
      'no complete capability implemented — provide ' +
      Object.entries(CAPABILITIES).map(([n, fns]) => `${fns.map(f => `${f}()`).join(' + ')} (${n})`).join(' or ')
    );
    // Name partially implemented capabilities to make the fix obvious.
    for (const [name, fns] of Object.entries(CAPABILITIES)) {
      const present = fns.filter(fn => typeof mod[fn] === 'function');
      if (present.length && present.length < fns.length) {
        const missing = fns.filter(fn => typeof mod[fn] !== 'function');
        problems.push(`capability "${name}" is incomplete — missing ${missing.map(f => `${f}()`).join(', ')}`);
      }
    }
  }
  for (const fn of OPTIONAL) {
    if (fn in mod && typeof mod[fn] !== 'function') problems.push(`optional export ${fn} is not a function`);
  }
  if (problems.length) {
    throw new Error(
      `Invalid adapter (${source}):\n  - ${problems.join('\n  - ')}\n` +
      'See ADAPTERS.md for the required surface.'
    );
  }
}

/**
 * Load, validate, and normalise an adapter.
 * Precedence: explicit argument (--adapter flag) > OPENGATE_ADAPTER env >
 * bundled RefCheckr reference adapter.
 */
export async function loadAdapter(specOverride) {
  const spec = specOverride || process.env.OPENGATE_ADAPTER;
  const path = spec ? resolve(process.cwd(), spec) : DEFAULT_ADAPTER;
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (err) {
    throw new Error(`Could not load adapter from ${path}: ${err.message}`);
  }
  validateAdapter(mod, path);
  const allFns = [...REQUIRED_BASE, ...Object.values(CAPABILITIES).flat(), ...OPTIONAL];
  const methods = Object.fromEntries(
    allFns.filter(f => typeof mod[f] === 'function').map(f => [f, mod[f]])
  );
  return {
    name: mod.meta?.name || basename(path, '.mjs'),
    capabilities: detectCapabilities(mod),
    ...DEFAULTS,
    ...methods,
  };
}
