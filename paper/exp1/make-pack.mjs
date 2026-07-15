#!/usr/bin/env node
// exp-1 step 1 — build the blind labelling pack.
//
// Splits the gold cases into two files that must never meet:
//
//   labelling-pack/opengate-labelling-pack.html   what the labeller opens.
//                                                  Contains items and rubric.
//                                                  Contains NO gold labels.
//   gold-key.json                                  the answer key, for scoring.
//
// The HTML is self-contained (no network, no dependencies): open it, work
// through it, click export, email back one JSON file. A labeller can do it
// offline on a train.
//
// Item order is deterministically shuffled from a fixed seed, so the six verdict
// classes are not clustered and the labeller cannot infer a pattern from
// position — but the pack rebuilds byte-identically for anyone checking our work.
//
//   node paper/exp1/make-pack.mjs
//
// Design note — the warm-up. Six verdict items are presented BEFORE the rubric,
// and then again inside the main pass. Cold-vs-guided on the same items measures
// how much of the agreement the rubric is buying, which is the thing §7 actually
// claims. It costs the labeller six extra judgments.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CASES_DIR = resolve(ROOT, 'datasets/cases');
const GUIDE = resolve(ROOT, 'datasets/LABELING-GUIDE.md');
const DISTRACTORS = resolve(HERE, 'distractors.json');
const PACK_DIR = resolve(HERE, 'labelling-pack');
const PACK = resolve(PACK_DIR, 'opengate-labelling-pack.html');
const KEY = resolve(HERE, 'gold-key.json');

const VERDICTS = [
  'strong_support', 'partial_support', 'implied_by_data',
  'overclaim', 'not_supported', 'contradicted',
];
const N_WARMUP = 6;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Deterministic PRNG (mulberry32) — a fixed seed, so the pack is reproducible.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, seed) {
  const r = rng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadCases() {
  return readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort()
    .map(f => JSON.parse(readFileSync(resolve(CASES_DIR, f), 'utf8')));
}

function main() {
  const cases = loadCases();
  const distractors = JSON.parse(readFileSync(DISTRACTORS, 'utf8'));
  const guide = readFileSync(GUIDE, 'utf8');

  const items = [];   // what the labeller sees
  const key = [];     // what we score against

  // ── Task A: verdicts (6-class) ──────────────────────────────────────────
  for (const c of cases) {
    for (const [i, gv] of (c.goldVerdicts || []).entries()) {
      const ref = (c.references || {})[String(gv.citation)];
      if (!ref) continue;
      const id = `verdict::${c.id}::${i}`;
      items.push({
        id,
        task: 'verdict',
        caseId: c.id,
        claim: gv.claimText,
        citation: gv.citation,
        referenceName: ref.name,
        referenceText: ref.text,
      });
      key.push({ id, task: 'verdict', caseId: c.id, gold: gv.verdict, rationale: gv.rationale });
    }
  }

  // ── Task B: redaction (binary) ──────────────────────────────────────────
  for (const c of cases.filter(x => x.kind === 'redaction')) {
    const positives = (c.goldEntities || []).map(e => ({ value: e.value, gold: true, type: e.type }));
    const negatives = (distractors.redaction[c.id] || []).map(d => ({ value: d.value, gold: false, note: d.note }));
    for (const [i, cand] of shuffled([...positives, ...negatives], 7001).entries()) {
      const id = `redaction::${c.id}::${i}`;
      items.push({ id, task: 'redaction', caseId: c.id, text: c.text, candidate: cand.value });
      key.push({ id, task: 'redaction', caseId: c.id, gold: cand.gold, entityType: cand.type ?? null, note: cand.note ?? null });
    }
  }

  // ── Task C: simplification anchors (binary) ─────────────────────────────
  for (const c of cases.filter(x => x.kind === 'simplification')) {
    const positives = (c.anchors || []).map(a => ({ value: a.value, gold: true }));
    const negatives = (distractors.simplification[c.id] || []).map(d => ({ value: d.value, gold: false, note: d.note }));
    for (const [i, cand] of shuffled([...positives, ...negatives], 7002).entries()) {
      const id = `simplification::${c.id}::${i}`;
      items.push({
        id, task: 'simplification', caseId: c.id, text: c.text,
        audience: c.audience, tone: c.tone, length: c.length,
        candidate: cand.value,
      });
      key.push({ id, task: 'simplification', caseId: c.id, gold: cand.gold, note: cand.note ?? null });
    }
  }

  // Present each task's items in a fixed, shuffled order.
  const verdictItems = shuffled(items.filter(i => i.task === 'verdict'), 4242);
  const redactionItems = items.filter(i => i.task === 'redaction');
  const simplifyItems = items.filter(i => i.task === 'simplification');

  // Warm-up: the first six verdict items, seen before the rubric. They appear
  // again in the main pass; cold-vs-guided on the same items is the measurement.
  const warmup = verdictItems.slice(0, N_WARMUP);

  const payload = {
    generatedAt: new Date().toISOString(),
    verdictOptions: VERDICTS,
    warmup,
    verdicts: verdictItems,
    redaction: redactionItems,
    simplification: simplifyItems,
  };

  const html = renderHtml(payload, guide);
  mkdirSync(PACK_DIR, { recursive: true });
  writeFileSync(PACK, html);

  const keyPayload = {
    generatedAt: payload.generatedAt,
    note: 'ANSWER KEY — must not be given to the labeller. paper/exp1/agreement.mjs scores against this.',
    warmupIds: warmup.map(w => w.id),
    itemsSha256: sha256(JSON.stringify(items.map(i => i.id))),
    key,
  };
  writeFileSync(KEY, `${JSON.stringify(keyPayload, null, 2)}\n`);

  // Guard: the answer key must not leak into the file we hand over.
  //
  // Checked STRUCTURALLY, against the payload the page actually embeds — not by
  // scanning the HTML for the word "gold", which produces false alarms because
  // the rubric itself legitimately documents the `goldVerdict` and `rationale`
  // fields. A guard that cries wolf on its own documentation is a guard people
  // learn to override, which defeats the point of having one.
  const ALLOWED = {
    verdict: ['id', 'task', 'caseId', 'claim', 'citation', 'referenceName', 'referenceText'],
    redaction: ['id', 'task', 'caseId', 'text', 'candidate'],
    simplification: ['id', 'task', 'caseId', 'text', 'audience', 'tone', 'length', 'candidate'],
  };
  const embedded = [...payload.warmup, ...payload.verdicts, ...payload.redaction, ...payload.simplification];
  const problems = [];
  for (const item of embedded) {
    const allowed = ALLOWED[item.task] || [];
    for (const field of Object.keys(item)) {
      if (!allowed.includes(field)) problems.push(`item ${item.id} exposes field "${field}"`);
    }
  }
  // And the gold values themselves must be absent from the payload as data.
  const payloadJson = JSON.stringify(embedded);
  for (const k of key) {
    if (k.task === 'verdict' && payloadJson.includes(`"${k.gold}"`)) {
      problems.push(`verdict label "${k.gold}" appears in the item payload`);
      break;
    }
    if (k.rationale && payloadJson.includes(k.rationale)) {
      problems.push(`gold rationale for ${k.id} appears in the item payload`);
    }
  }
  if (problems.length) {
    console.error('ABORT — the answer key leaked into the labelling pack. Do NOT send this file:');
    console.error('  ' + [...new Set(problems)].slice(0, 10).join('\n  '));
    process.exit(1);
  }

  console.error(`labelling pack → ${PACK}`);
  console.error(`  ${verdictItems.length} verdict items (6-class), ${redactionItems.length} redaction, ${simplifyItems.length} simplification`);
  console.error(`  + ${warmup.length} warm-up items presented before the rubric`);
  console.error(`  ${items.length} judgments in total`);
  console.error(`answer key   → ${KEY} (do NOT send this)`);
}

function renderHtml(data, guide) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const guideHtml = mdToHtml(guide);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenGATE — independent labelling pack</title>
<style>
  :root { --ink:#111; --muted:#666; --line:#e5e5e5; --accent:#0f766e; --warn:#b45309; }
  * { box-sizing: border-box; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, serif;
         color: var(--ink); max-width: 820px; margin: 0 auto; padding: 24px 20px 120px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.25rem; margin: 40px 0 8px; padding-top: 16px; border-top: 2px solid var(--line); }
  h3 { font-size: 1rem; margin: 24px 0 8px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 16px 0; }
  .card.done { border-color: var(--accent); background: #f6fffd; }
  .meta { font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .claim { font-weight: 600; margin: 8px 0; }
  .ref { background: #fafafa; border-left: 3px solid var(--line); padding: 10px 12px; margin: 10px 0;
         font-size: .95rem; }
  .ref .name { font-size: .8rem; color: var(--muted); display: block; margin-bottom: 4px; }
  .src { background: #fafafa; border-left: 3px solid var(--line); padding: 10px 12px; margin: 10px 0;
         font-size: .9rem; white-space: pre-wrap; }
  label.opt { display: block; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
  label.opt:hover { background: #f2f2f2; }
  input[type=radio] { margin-right: 8px; }
  .cand { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #fff3cd;
          padding: 2px 6px; border-radius: 4px; font-size: .95rem; }
  textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px;
             font: inherit; font-size: .9rem; margin-top: 8px; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; border-top: 1px solid var(--line);
         padding: 12px 20px; display: flex; gap: 16px; align-items: center; justify-content: center; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 10px 18px;
           font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { background: #bbb; cursor: not-allowed; }
  .count { color: var(--muted); font-size: .9rem; }
  .note { background: #fffbea; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; }
  .guide { font-size: .95rem; }
  .guide table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  .guide th, .guide td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; font-size: .9rem; }
  .hidden { display: none; }
  code { background:#f2f2f2; padding:1px 4px; border-radius:3px; font-size:.9em; }
</style>

<h1>OpenGATE — independent labelling pack</h1>
<p class="sub">Thank you. This should take around two hours. Nothing is sent anywhere: everything stays
in your browser until you click <strong>Export</strong> at the end, which saves one file for you to email back.
You can close the tab and come back — your answers are kept in this browser.</p>

<div class="note">
  <strong>What this is for.</strong> Every gold label in this benchmark was written by one person.
  That is a weakness in the paper, and the honest fix is to have someone else label the same material
  independently and report how often we agree — <em>including</em> where we don't. Please label what
  <em>you</em> think is right. If you disagree with the rubric, say so in the notes box: a disagreement
  you can justify is more useful to us than a matching answer.
  <br><br>
  <strong>Please don't</strong> look at the OpenGATE repository while you work — the answers are in it.
</div>

<h2>Part 1 — Six claims, before you read our rubric</h2>
<p class="sub">Judge these six on your own instincts first. We ask the same six again later, after the
rubric, so we can measure how much the rubric changes things. There is no trick here and no wrong answer.
<br>For each: <strong>does the reference support the claim, and how?</strong></p>
<div id="warmup"></div>

<h2>Part 2 — The rubric</h2>
<p class="sub">Now please read this. Everything after it should follow these definitions.</p>
<div class="guide">${guideHtml}</div>

<h2>Part 3 — All claims (including the six above)</h2>
<p class="sub">The main task. Judge each claim <strong>only against the reference shown</strong> —
not against the wider literature or what you know to be clinically true. The question is whether
<em>this reference</em> supports <em>this claim</em>.</p>
<div id="verdicts"></div>

<h2>Part 4 — De-identification</h2>
<p class="sub">For each highlighted span: <strong>must it be removed</strong> before this text could be
shared outside the care team? Judge the span, not the sentence.</p>
<div id="redaction"></div>

<h2>Part 5 — What must survive a plain-English rewrite</h2>
<p class="sub">Each note below is rewritten for a patient. For each highlighted fact:
<strong>would losing it be a safety problem?</strong> Some of these are deliberately arguable.</p>
<div id="simplification"></div>

<h2>Anything else?</h2>
<textarea id="comments" rows="4" placeholder="Cases you found badly worded, rubric rules that didn't fit, anything that felt wrong…"></textarea>

<div class="bar">
  <span class="count" id="count"></span>
  <button id="export" disabled>Export my answers</button>
</div>

<script>
const DATA = ${json};
const KEYNAME = 'opengate-exp1-answers';
const answers = JSON.parse(localStorage.getItem(KEYNAME) || '{}');
const pretty = v => v.replace(/_/g, ' ');

function save() {
  localStorage.setItem(KEYNAME, JSON.stringify(answers));
  const total = DATA.warmup.length + DATA.verdicts.length + DATA.redaction.length + DATA.simplification.length;
  const done = Object.keys(answers).filter(k => !k.endsWith('::note')).length;
  document.getElementById('count').textContent = done + ' of ' + total + ' answered';
  document.getElementById('export').disabled = done < total;
}

function card(item, name, options, body) {
  const d = document.createElement('div');
  d.className = 'card' + (answers[name] !== undefined ? ' done' : '');
  d.innerHTML = body;
  for (const [val, label] of options) {
    const id = name + '::' + val;
    const l = document.createElement('label');
    l.className = 'opt';
    l.innerHTML = '<input type="radio" name="' + name + '" value="' + val + '" id="' + id + '">' + label;
    const input = l.querySelector('input');
    if (String(answers[name]) === String(val)) input.checked = true;
    input.addEventListener('change', () => {
      answers[name] = val === 'true' ? true : val === 'false' ? false : val;
      d.classList.add('done'); save();
    });
    d.appendChild(l);
  }
  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.placeholder = 'Why? (optional — but very useful where you disagree)';
  ta.value = answers[name + '::note'] || '';
  ta.addEventListener('input', () => { answers[name + '::note'] = ta.value; save(); });
  d.appendChild(ta);
  return d;
}

function renderVerdicts(items, into, prefix) {
  const el = document.getElementById(into);
  items.forEach((it, n) => {
    const body =
      '<div class="meta">' + prefix + ' ' + (n + 1) + ' of ' + items.length + '</div>' +
      '<div class="claim">Claim: “' + it.claim + '”</div>' +
      '<div class="ref"><span class="name">Reference ' + it.citation + ' — ' + it.referenceName + '</span>' +
      it.referenceText + '</div>';
    el.appendChild(card(it, prefix.toLowerCase().replace(/[^a-z]/g,'') + '::' + it.id,
      DATA.verdictOptions.map(v => [v, '<strong>' + pretty(v) + '</strong>']), body));
  });
}

function renderBinary(items, into, question) {
  const el = document.getElementById(into);
  let lastCase = null;
  items.forEach(it => {
    if (it.caseId !== lastCase) {
      const h = document.createElement('h3');
      h.textContent = it.caseId;
      el.appendChild(h);
      const src = document.createElement('div');
      src.className = 'src';
      src.textContent = it.text;
      el.appendChild(src);
      lastCase = it.caseId;
    }
    const body = '<div class="meta">' + it.caseId + '</div>' +
      '<div class="claim">' + question + ' <span class="cand">' + it.candidate + '</span></div>';
    el.appendChild(card(it, it.id, [['true', '<strong>Yes</strong>'], ['false', '<strong>No</strong>']], body));
  });
}

renderVerdicts(DATA.warmup, 'warmup', 'Warm-up');
renderVerdicts(DATA.verdicts, 'verdicts', 'Claim');
renderBinary(DATA.redaction, 'redaction', 'Must this be removed?');
renderBinary(DATA.simplification, 'simplification', 'Would losing this be a safety problem?');

document.getElementById('comments').value = answers['__comments'] || '';
document.getElementById('comments').addEventListener('input', e => {
  answers['__comments'] = e.target.value; save();
});

document.getElementById('export').addEventListener('click', () => {
  const out = {
    exportedAt: new Date().toISOString(),
    packGeneratedAt: DATA.generatedAt,
    answers,
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'opengate-exp1-labels.json';
  a.click();
});

save();
</script>
</html>
`;
}

// Minimal Markdown → HTML for the rubric (tables, headings, lists, emphasis).
// The rubric is committed Markdown; rendering it here keeps the pack self-contained.
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  const out = [];
  const lines = md.split(/\r?\n/);
  let inTable = false, inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const isTableRow = /^\|/.test(line);
    const isDivider = /^\|[\s:|-]+\|$/.test(line);

    if (isTableRow) {
      if (isDivider) continue;
      const cells = line.split('|').slice(1, -1).map(c => inline(c.trim()));
      if (!inTable) { out.push('<table>'); inTable = true;
        out.push('<tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>');
      } else {
        out.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
      }
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }

    const li = line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(4, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (!line.trim()) continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inTable) out.push('</table>');
  if (inList) out.push('</ul>');
  return out.join('\n');
}

main();
