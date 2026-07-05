// ONLINE scorer — retrieval fidelity.
//
// Exercises the adapter's fetchRecord() capability against gold cases of kind
// "retrieval": a stable record ID plus a few HAND-VERIFIED anchor fields.
// Unlike the model-scoring scorers, the system under test is deterministic
// (PubCrawl wraps NCBI / ClinicalTrials.gov). The failure that matters here is
// a PARSE REGRESSION: a record comes back but a field is dropped, collapsed,
// or garbled — e.g. an authors array that collapses to a single object when a
// paper has one author, or an abstract whose sections merge or truncate.
// Because everything downstream (RefCheckr, any RAG) grounds on these records,
// a silent parse bug poisons every citation built on it.
//
// Ground truth is independent of the system: anchors are copied from the
// paper/record itself, not from PubCrawl's output (see datasets/SCHEMA.md and
// scripts/capture-retrieval-case.mjs to bootstrap them). The scorer checks:
//
//   • field presence (gate) — every field named in `requireFields` is present
//     and non-empty (title, authors, year, …). Catches dropped/blank fields.
//   • anchor fidelity (gate) — each anchor must be satisfied by the record:
//       { field: "authors",  contains: "Douglas" }   surname survived parsing
//       { field: "year",     equals: "2020" }
//       { field: "abstract", contains: "proptosis" } distinctive phrase intact
//       { field: "authors",  minCount: 5 }            array didn't collapse
//   • structural invariants (gate) — authors is a non-empty array of strings
//     (not "[object Object]" from a collapsed single-author record); title is a
//     non-empty string; no field serialises to "[object Object]".

export const meta = { id: 'retrieval', mode: 'online' };

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Read a possibly-nested field from a record; arrays are joined for text ops. */
function fieldValue(record, field) {
  const v = record?.[field];
  if (Array.isArray(v)) return v;
  return v;
}
function asText(v) {
  return Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') : String(v ?? '');
}

function checkAnchor(record, a) {
  const v = fieldValue(record, a.field);
  if (a.minCount != null) {
    return Array.isArray(v) && v.length >= a.minCount
      ? null : `${a.field} has ${Array.isArray(v) ? v.length : 0} items, expected ≥ ${a.minCount}`;
  }
  if (a.equals != null) {
    return norm(asText(v)) === norm(a.equals) ? null : `${a.field} = "${asText(v)}", expected "${a.equals}"`;
  }
  if (a.contains != null) {
    return norm(asText(v)).includes(norm(a.contains)) ? null : `${a.field} missing "${a.contains}"`;
  }
  return `anchor on ${a.field} has no check (equals/contains/minCount)`;
}

function structuralProblems(record) {
  const problems = [];
  const flat = JSON.stringify(record);
  if (flat.includes('[object Object]')) problems.push('record contains "[object Object]" (a value failed to serialise — likely a parser shape bug)');
  if ('authors' in record) {
    const a = record.authors;
    if (!Array.isArray(a)) problems.push('authors is not an array (single-author collapse?)');
    else if (a.some(x => typeof x !== 'string' || !x.trim())) problems.push('authors contains a non-string / empty entry');
  }
  if ('title' in record && (typeof record.title !== 'string' || !record.title.trim())) {
    problems.push('title is missing or not a non-empty string');
  }
  return problems;
}

export async function run({ cases, adapter }) {
  if (!adapter.capabilities.retrieval) {
    return { meta, skipped: true, reason: `adapter "${adapter.name}" has no retrieval capability` };
  }
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }
  const goldCases = cases.filter(c => c.kind === 'retrieval' && c.id && (c.anchors || c.requireFields));
  if (goldCases.length === 0) {
    return { meta, skipped: true, reason: 'No cases of kind "retrieval" with anchors/requireFields.' };
  }

  adapter.resetTiming();

  const perCase = [];
  const failures = [];

  for (const c of goldCases) {
    let record;
    try {
      const res = await adapter.fetchRecord({ id: c.recordId, type: c.recordType });
      record = res?.record ?? res;
    } catch (err) {
      failures.push(`case ${c.id}: ${err.message}`);
      continue;
    }
    if (!record || typeof record !== 'object') {
      failures.push(`NO RECORD in ${c.id}: fetchRecord returned nothing usable`);
      continue;
    }

    const caseFailures = [];
    for (const f of c.requireFields || []) {
      const v = fieldValue(record, f);
      const empty = v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
      if (empty) caseFailures.push(`missing field "${f}"`);
    }
    for (const a of c.anchors || []) {
      const problem = checkAnchor(record, a);
      if (problem) caseFailures.push(`anchor ${JSON.stringify(a)} — ${problem}`);
    }
    for (const s of structuralProblems(record)) caseFailures.push(s);

    for (const cf of caseFailures) failures.push(`FIDELITY ${c.id}: ${cf}`);
    perCase.push({
      case: c.id, recordId: c.recordId,
      anchors: (c.anchors || []).length,
      requireFields: (c.requireFields || []).length,
      problems: caseFailures,
    });
  }

  const totalChecks = perCase.reduce((a, p) => a + p.anchors + p.requireFields, 0);
  const failedChecks = perCase.reduce((a, p) => a + p.problems.length, 0);
  const latencies = adapter.callLatencies();

  const metrics = {
    n_cases: perCase.length,
    n_checks: totalChecks,
    fidelity: round(totalChecks ? 1 - Math.min(failedChecks, totalChecks) / totalChecks : (perCase.length && !failedChecks ? 1 : 0)),
    failed_checks: failedChecks,
    ...(latencies.length ? { latency_p50_ms: Math.round(percentileOf(latencies, 50)) } : {}),
  };

  return { meta, metrics, detail: { perCase }, failures, passed: failures.length === 0 };
}

function percentileOf(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  return xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0;
}
function round(x) { return Math.round(x * 1000) / 1000; }
