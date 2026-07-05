// Per-adapter baseline resolution.
//
// A regression baseline only means something relative to the adapter that
// produced it — a PubCrawl retrieval scorecard and a RefCheckr QA scorecard
// share no metrics, so a single baseline.json would let one clobber the other.
// Baselines are therefore keyed by adapter: baseline.<adapter>.json.
//
// Legacy migration: an older single baseline.json (which records the adapter
// that produced it) is still honoured — but ONLY for that same adapter, never
// cross-adapter.

/** Filesystem-safe per-adapter baseline filename. */
export function baselineFileName(adapterName) {
  const safe = String(adapterName || 'default').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `baseline.${safe}.json`;
}

/**
 * Choose which baseline file to read for a regression check.
 * @param {string} adapterName
 * @param {object} present
 *   { perAdapter: boolean,          // baseline.<adapter>.json exists
 *     legacy: boolean,              // baseline.json exists
 *     legacyAdapter: string|null }  // the `adapter` field inside baseline.json
 * @returns {{ file: string, source: 'per-adapter'|'legacy' } | null}
 */
export function resolveBaseline(adapterName, present) {
  if (present.perAdapter) {
    return { file: baselineFileName(adapterName), source: 'per-adapter' };
  }
  // A legacy baseline is trustworthy only for the adapter that wrote it.
  if (present.legacy && present.legacyAdapter === adapterName) {
    return { file: 'baseline.json', source: 'legacy' };
  }
  return null;
}
