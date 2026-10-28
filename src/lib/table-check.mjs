// Pure table-transcription check — the core behind the table-transcription
// scorer. For systems that copy results out of a source document into a table
// (e.g. Patiently's lab table: test / value / unit / range / flag, plus a
// one-line plain-English explanation per row).
//
// The contract being tested: the table is a TRANSCRIPTION, not an
// interpretation. So, deterministically and with no LLM judge:
//
//   • fabricated numbers (gate) — every number in any copied cell must exist
//     in the source. An invented value or reference range is the worst failure.
//   • not verbatim (gate) — value, unit and range must appear in the source as
//     written (whitespace-tolerant). Unit conversion, rounding or tidying a
//     range ("130-170" → "13.0-17.0 g/dL") fails even if every digit exists.
//   • invented flags (gate) — a flag (H, L, *, low, …) must appear in the
//     source as a standalone token; "L" inside "mg/L" does not count. The
//     system must never decide high/low itself.
//   • numbers in explanations (gate) — the explanation column may contain no
//     digits at all (a stricter never-invent rule for free text).
//   • false table (gate) — a case that is not a results report must produce
//     no rows.
//   • missed rows / missing flags (reported; gated by policy) — gold rows that
//     must be present, and flags the source prints that the table must carry.

import { contains, numbersIn } from './simplification-check.mjs';

const fold = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A flag counts only as a standalone token in the source. */
export function flagInSource(source, flag) {
  const f = fold(flag);
  if (!f) return false;
  return new RegExp(`(?<=^|[\\s(\\[,;:])${escRe(f)}(?=$|[\\s)\\],;:.])`, 'i').test(String(source));
}

const sameTest = (a, b) => {
  const x = fold(a).toLowerCase(), y = fold(b).toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
};

/**
 * @param {object} input
 *   rows          ([{ test, value, unit?, range?, flag?, explanation? }]) the system's table
 *   text          (string) the source document
 *   expectedRows  ([{ test, value, flag? }]) gold rows that must be present
 *   expectNoTable (boolean) the source is not a results report
 * @returns {{ ok, fabricated, notVerbatim, inventedFlags, explanationNumbers, falseTable, missedRows, missingFlags, issues }}
 */
export function checkTable(input) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const src = String(input.text ?? '');
  const srcNums = numbersIn(src);
  const fabricated = [], notVerbatim = [], inventedFlags = [], explanationNumbers = [];

  for (const r of rows) {
    const label = fold(r.test) || '(unnamed row)';
    for (const field of ['test', 'value', 'unit', 'range']) {
      const v = fold(r[field]);
      if (!v) continue;
      for (const n of numbersIn(v)) if (!srcNums.has(n)) fabricated.push(`${label}.${field}: "${n}"`);
      if (field !== 'test' && !contains(src, v)) notVerbatim.push(`${label}.${field}: "${v}"`);
    }
    const flag = fold(r.flag);
    if (flag && !flagInSource(src, flag)) inventedFlags.push(`${label}: "${flag}"`);
    if (/\d/.test(String(r.explanation ?? ''))) explanationNumbers.push(`${label}: "${fold(r.explanation)}"`);
  }

  const falseTable = Boolean(input.expectNoTable) && rows.length > 0;

  const missedRows = [], missingFlags = [];
  for (const g of input.expectedRows || []) {
    const hit = rows.find(r => sameTest(r.test, g.test) && fold(r.value) === fold(g.value));
    if (!hit) { missedRows.push(`${g.test} ${g.value}`); continue; }
    if (g.flag && fold(hit.flag).toLowerCase() !== fold(g.flag).toLowerCase()) {
      missingFlags.push(`${g.test}: expected "${g.flag}", got "${fold(hit.flag) || '(none)'}"`);
    }
  }

  const issues = [
    ...fabricated.map(x => `fabricated number ${x}`),
    ...notVerbatim.map(x => `not verbatim ${x}`),
    ...inventedFlags.map(x => `invented flag ${x}`),
    ...explanationNumbers.map(x => `number in explanation ${x}`),
    ...(falseTable ? [`table produced for a non-results document (${rows.length} rows)`] : []),
    ...missedRows.map(x => `missed row ${x}`),
    ...missingFlags.map(x => `missing flag ${x}`),
  ];
  return {
    ok: issues.length === 0,
    fabricated, notVerbatim, inventedFlags, explanationNumbers, falseTable, missedRows, missingFlags, issues,
  };
}
