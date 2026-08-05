// Pure extraction check — the shared core behind the extraction scorer and
// downstream tools (e.g. the Groundwork MCP server). Given an extracted record
// and a hand-labelled gold record, it reports field by field whether the
// extraction is faithful: correct values, correct abstentions (null when the
// document does not state the field), and — the extraction hallucination —
// no fabricated value in a field whose gold is null.
//
// Deterministic, no LLM judge. Gold values compare exactly after per-field
// normalisation; there is no paraphrase problem in structured extraction, and
// this module keeps it that way. Schema validation lives separately in
// schema-validate.mjs (it carries the ajv dependency); this module stays pure.
//
// Field verdicts:
//   correct            extracted equals gold (after normalisation / aliases)
//   wrong              both non-null, values differ                  → gate
//   fabricated         extracted non-null, gold null                 → gate
//   missed             extracted null, gold non-null                 → metric
//   correct_abstention both null (document doesn't state the field)  → metric

/** Collapse whitespace, lowercase — the default text normaliser. */
export function normalizeText(v) {
  return String(v).toLowerCase().replace(/\s+/g, ' ').trim();
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Normalise a date to ISO `YYYY-MM-DD`. Accepts ISO dates, `14 March 2026`,
 * `March 14, 2026`, and slashed/dotted numeric dates — which are read
 * DAY-FIRST (`14/03/2026`), except when the first number can only be a month
 * (`03/14/2026`). Unparseable input falls back to normalizeText so comparison
 * stays deterministic either way.
 */
export function normalizeDate(v) {
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${MONTHS[m[2].slice(0, 3).toLowerCase()]}-${pad2(m[1])}`;
  }
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${MONTHS[m[1].slice(0, 3).toLowerCase()]}-${pad2(m[2])}`;
  }
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) {
    let [, a, b, year] = m;
    a = Number(a); b = Number(b);
    // Day-first by default; if the first number cannot be a day's partner
    // month (>12) it must itself be the day — and if the FIRST number is a
    // valid month while the second cannot be (b>12), read month-first.
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }
  return normalizeText(s);
}

/**
 * Normalise money to integer minor units (e.g. "£1,250.50" → "125050",
 * "16000" → "1600000"). Currency symbols and codes are stripped — the check
 * compares amounts, not currencies. Values without a decimal part are read as
 * major units. Unparseable input falls back to normalizeText.
 */
export function normalizeMoney(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(Math.round(v * 100));
  }
  const s = String(v).trim()
    .replace(/[£$€]/g, '')
    .replace(/\b(gbp|usd|eur|pounds?|dollars?|euros?)\b/gi, '')
    .replace(/[,\s]/g, '');
  const m = s.match(/^-?\d+(?:\.\d{1,2})?$/);
  if (!m) return normalizeText(v);
  const neg = s.startsWith('-');
  const [major, minor = ''] = s.replace('-', '').split('.');
  const minorUnits = BigInt(major) * 100n + BigInt(minor.padEnd(2, '0') || '0');
  return (neg ? '-' : '') + minorUnits.toString();
}

/** Normalise a number to a canonical string ("07.50" → "7.5"). */
export function normalizeNumber(v) {
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : normalizeText(v);
}

const NORMALIZERS = {
  date: normalizeDate,
  money: normalizeMoney,
  number: normalizeNumber,
  text: normalizeText,
};

/**
 * Normalise one field value for comparison. `kind` is the per-field entry
 * from the case's `normalize` map ("date" | "money" | "number" | "text");
 * unset falls back by JS type: strings fold whitespace/case, numbers
 * canonicalise, booleans stay booleans, arrays normalise element-wise.
 */
export function normalizeValue(v, kind) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => normalizeValue(x, kind));
  if (kind) {
    const fn = NORMALIZERS[kind];
    if (!fn) throw new Error(`unknown normalizer "${kind}" (use date, money, number, or text)`);
    return fn(v);
  }
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return normalizeNumber(v);
  return normalizeText(v);
}

const sameNormalized = (a, b) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {object} input
 *   record    (object, required) the extracted record ({ field: value|null })
 *   gold      (object, required) hand-labelled gold ({ field: value|null });
 *             null means THE DOCUMENT DOES NOT STATE IT — the only correct
 *             extraction is null. Gold's keys define the fields compared.
 *   normalize (object, optional) per-field normaliser: { field: "date"|"money"|"number"|"text" }
 *   aliases   (object, optional) per-field acceptable alternative gold values:
 *             { field: ["value", …] } — matched after normalisation
 * @returns {{ perField, counts, issues }}
 *   perField: { field: { verdict, extracted, gold } }
 *   counts:   { correct, wrong, fabricated, missed, correctAbstentions }
 *   issues:   named gate failures (wrong values, fabricated fields) — missed
 *             fields are reported in perField/counts, not as gate failures
 */
export function checkExtraction(input) {
  const record = input.record ?? {};
  const gold = input.gold ?? {};
  const normalize = input.normalize ?? {};
  const aliases = input.aliases ?? {};
  const issues = [];
  const perField = {};
  const counts = { correct: 0, wrong: 0, fabricated: 0, missed: 0, correctAbstentions: 0 };

  for (const field of Object.keys(gold)) {
    const goldRaw = gold[field];
    const extractedRaw = record[field] ?? null;
    const kind = normalize[field];
    const goldNorm = normalizeValue(goldRaw, kind);
    const extractedNorm = normalizeValue(extractedRaw, kind);

    let verdict;
    if (goldNorm === null && extractedNorm === null) {
      verdict = 'correct_abstention';
      counts.correctAbstentions++;
    } else if (goldNorm === null) {
      verdict = 'fabricated';
      counts.fabricated++;
      issues.push(
        `FABRICATED field "${field}": document does not state it (got ${JSON.stringify(extractedRaw)})`
      );
    } else if (extractedNorm === null) {
      verdict = 'missed';
      counts.missed++;
    } else {
      const accepted = [goldNorm, ...(aliases[field] || []).map((a) => normalizeValue(a, kind))];
      if (accepted.some((a) => sameNormalized(extractedNorm, a))) {
        verdict = 'correct';
        counts.correct++;
      } else {
        verdict = 'wrong';
        counts.wrong++;
        issues.push(
          `WRONG field "${field}": got ${JSON.stringify(extractedRaw)}, expected ${JSON.stringify(goldRaw)}`
        );
      }
    }
    perField[field] = { verdict, extracted: extractedRaw, gold: goldRaw };
  }

  return { perField, counts, issues };
}
