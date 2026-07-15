#!/usr/bin/env node
// exp-2 step 1 — capture the base output set, ONCE, and freeze it.
//
// Every judge and every repeat in exp-2 scores the *same* bytes. Outputs are
// therefore captured here, hashed, and committed; nothing downstream calls a
// system under test again.
//
// Two sources, both honestly labelled in the frozen corpus:
//
//   • simplification (3 cases) — Patiently AI production endpoint, via the
//     bundled adapter. Real production outputs from a registered device.
//   • grounding (3 cases) — a GENERIC RAG ANSWERER: one temperature-0 chat
//     completion per case, answering the question from the case context and
//     nothing else. Not a production system, and reported as such: the
//     grounding capability has no production adapter, and exp-2 only needs
//     outputs that the judges and the scorers can both read.
//
// Runs on a machine with network access to both (the dev sandbox has neither).
//
//   OPENAI_API_KEY=sk-... node paper/exp2/capture-outputs.mjs
//
// Env:
//   OPENAI_API_KEY   (required) for the grounding answerer
//   ANSWERER_MODEL   default gpt-4o-mini — the system under test, not the judge
//   OPENAI_BASE_URL  default https://api.openai.com/v1
//
// Output: paper/exp2/corpus/base-outputs.json  (git-tracked, never regenerated
// unless you mean to invalidate every result downstream)

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CASES_DIR = resolve(ROOT, 'datasets/cases');
const OUT = resolve(HERE, 'corpus/base-outputs.json');

const ANSWERER_MODEL = process.env.ANSWERER_MODEL || 'gpt-4o-mini';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function loadCases(kind) {
  return readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => {
      const raw = readFileSync(resolve(CASES_DIR, f), 'utf8');
      return { file: f, raw, case: JSON.parse(raw) };
    })
    .filter(c => c.case.kind === kind)
    .sort((a, b) => a.case.id.localeCompare(b.case.id));
}

// ── The generic RAG answerer (system under test for the grounding cases) ────
// Deliberately plain: the prompt an ordinary RAG application would use. No
// faithfulness coaching, no abstention drilling beyond the standard
// "answer only from the context" instruction — we want representative output,
// not best-case output.
const ANSWERER_SYSTEM =
  'You are a question-answering assistant. Answer the user\'s question using ONLY the ' +
  'provided context. If the context does not contain the answer, say so plainly. ' +
  'Be concise.';

async function answerFromContext({ question, context }) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ANSWERER_MODEL,
      temperature: 0,
      seed: 20260711,
      messages: [
        { role: 'system', content: ANSWERER_SYSTEM },
        { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

const flatten = (v) => (Array.isArray(v) ? v.join('\n') : String(v ?? ''));

async function main() {
  const simplifyCases = loadCases('simplification');
  const groundingCases = loadCases('grounding');
  if (!simplifyCases.length || !groundingCases.length) {
    throw new Error('expected simplification and grounding gold cases in datasets/cases');
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required (the grounding answerer needs it)');
  }

  const { simplify, runModel } = await import(resolve(ROOT, 'src/adapters/patiently.mjs'));

  const outputs = [];

  for (const { case: c, raw } of simplifyCases) {
    process.stderr.write(`simplify  ${c.id} … `);
    const { text } = await simplify({
      text: c.text, audience: c.audience, tone: c.tone, length: c.length, language: c.language,
    });
    outputs.push({
      outputId: `${c.id}::base`,
      caseId: c.id,
      kind: 'simplification',
      variant: 'base',
      injectedDefect: null,
      producer: { system: 'patiently', kind: 'production', model: runModel() || 'unspecified' },
      caseSha256: sha256(raw),
      text,
    });
    process.stderr.write(`${text.length} chars\n`);
  }

  for (const { case: c, raw } of groundingCases) {
    process.stderr.write(`grounding ${c.id} … `);
    const text = await answerFromContext({
      question: c.question, context: flatten(c.context),
    });
    outputs.push({
      outputId: `${c.id}::base`,
      caseId: c.id,
      kind: 'grounding',
      variant: 'base',
      injectedDefect: null,
      producer: { system: 'generic-rag-answerer', kind: 'reference implementation', model: ANSWERER_MODEL },
      caseSha256: sha256(raw),
      text,
    });
    process.stderr.write(`${text.length} chars\n`);
  }

  let sha = 'unknown';
  try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}

  const payload = {
    capturedAt: new Date().toISOString(),
    repoSha: sha,
    note:
      'FROZEN. Captured once; every judge and every repeat in exp-2 scores these exact bytes. ' +
      'Regenerating invalidates all downstream results.',
    producers: {
      simplification: 'Patiently AI production endpoint (bundled adapter)',
      grounding: `generic RAG answerer — ${ANSWERER_MODEL}, temperature 0, answer-from-context prompt`,
    },
    outputs,
  };
  payload.corpusSha256 = sha256(JSON.stringify(payload.outputs));

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(`\nfrozen → ${OUT}\n  ${outputs.length} outputs, corpus sha256 ${payload.corpusSha256.slice(0, 12)}…\n`);
}

main().catch(err => { console.error(`capture failed: ${err.message}`); process.exit(1); });
