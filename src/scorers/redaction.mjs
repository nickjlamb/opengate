// ONLINE scorer — redaction recall.
//
// Exercises the adapter's redact() capability against gold cases of kind
// "redaction": source text plus the identifiers that must be removed. The
// decisive metric is the LEAK — a gold identifier still present verbatim in
// the redacted output. For a privacy tool, a single leak is the worst failure
// there is, so every leak is a named failure and gates the run.
//
// Case schema (datasets/SCHEMA.md):
//   {
//     "id": "...", "kind": "redaction", "text": "...",
//     "goldEntities":     [{ "type": "PATIENT_NAME", "value": "Mr John Smith" }],
//     "knownGapEntities": [{ "type": "STREET_ADDRESS", "value": "42 Maple Road" }]
//   }
// knownGapEntities are identifiers the system does not yet catch — reported
// separately as tracked targets, not failures (same mechanism as known-gap
// citation styles).
//
// Metrics:
//   • recall — share of gold identifiers removed (leaks lower it)
//   • leaks — count of gold identifiers still present (each is a failure)
//   • over_redactions — detected entities not in the gold or known-gap sets
//     (info only: often legitimate extra catches)
//   • knownGap_open / knownGap_closed — tracked targets still open vs now
//     caught (a closed gap means the case can be promoted to goldEntities)

import { mean } from '../lib/metrics.mjs';

export const meta = { id: 'redaction', mode: 'online' };

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Is the identifier value still present in the text (case-insensitive, word-bounded)? */
function stillPresent(text, value) {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRx(value)}(?![A-Za-z0-9])`, 'i').test(text);
}

// For *_NAME entities a full-string check is not enough: a partially redacted
// name ("[PATIENT_NAME_1] O'Brien") removes the full value but leaks the
// surname. Scan the individual words of name values too.
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof']);
function nameWords(value) {
  return value.split(/[^A-Za-z'’\-]+/)
    .filter(w => w.replace(/[^A-Za-z]/g, '').length >= 3 && !TITLES.has(w.toLowerCase()));
}

/** Words of a name entity that survived redaction and are not excused by a known gap. */
function leakedNameWords(out, value, gapValues) {
  return nameWords(value).filter(w =>
    stillPresent(out, w) && !gapValues.some(g => g.toLowerCase().includes(w.toLowerCase())));
}

export async function run({ cases, adapter }) {
  if (!adapter.capabilities.redaction) {
    return { meta, skipped: true, reason: `adapter "${adapter.name}" has no redaction capability` };
  }
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }
  const goldCases = cases.filter(c => c.kind === 'redaction' && (c.goldEntities || []).length);
  if (goldCases.length === 0) {
    return { meta, skipped: true, reason: 'No cases of kind "redaction" with goldEntities.' };
  }

  const perCase = [];
  const failures = [];
  let gapOpen = 0, gapClosed = 0;

  for (const c of goldCases) {
    let res;
    try {
      res = await adapter.redact(c.text);
    } catch (err) {
      failures.push(`case ${c.id}: ${err.message}`);
      continue;
    }
    const out = res.text ?? '';
    const gaps = c.knownGapEntities || [];
    const gapValues = gaps.map(e => e.value);

    const leaked = [];
    for (const e of c.goldEntities || []) {
      if (stillPresent(out, e.value)) {
        leaked.push({ ...e, how: 'verbatim' });
      } else if (/NAME/.test(e.type)) {
        const words = leakedNameWords(out, e.value, gapValues);
        if (words.length) leaked.push({ ...e, how: `partial: ${words.join(', ')}` });
      }
    }
    for (const e of leaked) {
      failures.push(`LEAK in ${c.id}: ${e.type} "${e.value}" survived redaction (${e.how})`);
    }

    // Tracked targets: not failures, but their status is reported.
    const gapsStillOpen = gaps.filter(e => stillPresent(out, e.value));
    gapOpen += gapsStillOpen.length;
    gapClosed += gaps.length - gapsStillOpen.length;

    // Over-redaction: detected values unrelated to the gold + known-gap sets.
    // Substring relation in either direction excuses partial captures
    // ("Mrs Eileen" detected for gold "Mrs Eileen O'Brien").
    const expectedVals = [...(c.goldEntities || []), ...gaps].map(e => e.value.toLowerCase());
    const over = (res.entities || []).filter(e => {
      const v = String(e.value).toLowerCase();
      return !expectedVals.some(x => x.includes(v) || v.includes(x));
    });

    perCase.push({
      case: c.id,
      entities: (c.goldEntities || []).length,
      leaks: leaked.length,
      leakedValues: leaked.map(e => `${e.type}:${e.value}`),
      recall: 1 - leaked.length / (c.goldEntities || []).length,
      overRedactions: over.length,
      gapsStillOpen: gapsStillOpen.map(e => `${e.type}:${e.value}`),
    });
  }

  const totalEntities = perCase.reduce((a, p) => a + p.entities, 0);
  const totalLeaks = perCase.reduce((a, p) => a + p.leaks, 0);

  const metrics = {
    n_cases: perCase.length,
    n_entities: totalEntities,
    recall: round(totalEntities ? 1 - totalLeaks / totalEntities : 0),
    leaks: totalLeaks,
    over_redactions: perCase.reduce((a, p) => a + p.overRedactions, 0),
    knownGap_open: gapOpen,
    knownGap_closed: gapClosed,
    mean_case_recall: round(mean(perCase.map(p => p.recall))),
  };

  return { meta, metrics, detail: { perCase }, failures, passed: failures.length === 0 };
}

function round(x) { return Math.round(x * 1000) / 1000; }
