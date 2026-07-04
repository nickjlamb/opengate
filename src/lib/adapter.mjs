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

// Required: online scorers cannot run without these.
const REQUIRED = ['splitClaims', 'analyzeBatch', 'onlineAvailable', 'onlineConfigHint'];

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

/** Throws with a readable message listing every problem, or returns silently. */
export function validateAdapter(mod, source = 'adapter') {
  const problems = [];
  for (const fn of REQUIRED) {
    if (typeof mod[fn] !== 'function') problems.push(`missing required export: ${fn}()`);
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
  const methods = Object.fromEntries(
    [...REQUIRED, ...OPTIONAL]
      .filter(f => typeof mod[f] === 'function')
      .map(f => [f, mod[f]])
  );
  return {
    name: mod.meta?.name || basename(path, '.mjs'),
    ...DEFAULTS,
    ...methods,
  };
}
