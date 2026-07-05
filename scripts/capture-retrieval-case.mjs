#!/usr/bin/env node
// Bootstrap a retrieval gold case from a live record.
//
// Retrieval-fidelity anchors must be INDEPENDENT ground truth — copied from the
// paper itself, not from PubCrawl's output. This helper fetches a record so you
// can see the fields, then you confirm the anchors against the source (PubMed
// page, the PDF) before trusting them. It prints a gold-case skeleton with
// suggested anchors drawn from the fetched record; review and trim.
//
// Usage (needs network + the MCP SDK installed):
//   npm install --no-save @modelcontextprotocol/sdk
//   node scripts/capture-retrieval-case.mjs <pmid> [type]
//   node scripts/capture-retrieval-case.mjs 31904519 pubmed > datasets/cases/retrieval-teye.json
//
// Then open the file, VERIFY each anchor against the actual paper, and delete
// the _UNVERIFIED marker.

import { loadAdapter } from '../src/lib/adapter.mjs';

const [id, type = 'pubmed'] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node scripts/capture-retrieval-case.mjs <pmid> [type]');
  process.exit(2);
}

const adapter = await loadAdapter('./src/adapters/pubcrawl.mjs');
if (!adapter.onlineAvailable()) {
  console.error(adapter.onlineConfigHint());
  process.exit(2);
}

const { record } = await adapter.fetchRecord({ id, type });

const firstAuthorSurname = Array.isArray(record.authors) && record.authors[0]
  ? String(record.authors[0]).split(/\s+/).pop() : null;
const abstractText = Array.isArray(record.abstract_sections)
  ? record.abstract_sections.map(s => s.text).join(' ') : (record.abstract || '');
const phrase = abstractText.split(/\s+/).slice(0, 6).join(' '); // suggest; pick a DISTINCTIVE one

const skeleton = {
  id: `retrieval-${id}`,
  kind: 'retrieval',
  _UNVERIFIED: 'Confirm every anchor against the source paper, then delete this key.',
  recordId: String(id),
  recordType: type,
  requireFields: ['title', 'authors', 'year'],
  anchors: [
    ...(firstAuthorSurname ? [{ field: 'authors', contains: firstAuthorSurname }] : []),
    ...(record.year ? [{ field: 'year', equals: String(record.year) }] : []),
    ...(Array.isArray(record.authors) && record.authors.length > 1
      ? [{ field: 'authors', minCount: record.authors.length }] : []),
    ...(phrase ? [{ field: 'abstract_sections', contains: phrase }] : []),
  ],
};

console.error('\n── Fetched record (for your review) ──');
console.error(JSON.stringify(record, null, 2).slice(0, 1500));
console.error('\n── Gold-case skeleton (VERIFY anchors, then save) ──');
console.log(JSON.stringify(skeleton, null, 2));
