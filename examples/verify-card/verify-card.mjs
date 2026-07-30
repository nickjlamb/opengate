/**
 * OpenGATE verification card — a self-contained HTML rendering of one answer
 * being verified against its context.
 *
 * Prototype / reference implementation. In the OpenGATE repo, delete the
 * "grounding check (inlined port)" section below and import the real thing:
 *
 *   import { checkGrounding, numbersIn, contains, flattenContext }
 *     from '../src/lib/grounding-check.mjs';
 *
 * Usage:
 *   import { renderVerificationCard } from './verify-card.mjs';
 *   const html = renderVerificationCard({
 *     answer, context,                  // required
 *     question,                         // optional — whitelists its numbers
 *     anchors: ['30 days', {value: 'no restocking fee', aliases: ['no fee']}],
 *     answerable: true,                 // false → the answer must abstain
 *     caseId: 'refund-policy',          // optional label
 *   });
 *
 * The output is one self-contained <!DOCTYPE html> document: inline CSS,
 * system + web-safe fonts only, no scripts, no network. Same conventions as
 * `opengate report`.
 */

/* ── grounding check (inlined port of src/lib/grounding-check.mjs) ────── */

const DEFAULT_ABSTAIN = [
  'not in the provided context', 'not in the context', 'no information',
  "don't know", 'do not know', 'cannot answer', "can't answer",
  'unable to answer', 'not enough information', 'not stated', 'not mentioned',
  'no answer', 'not available', 'insufficient information',
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ');
const normNeg = (s) => norm(s).replace(/n['’]t\b/g, ' not').replace(/\s+/g, ' ');

export function flattenContext(v) {
  return Array.isArray(v) ? v.map(String).join('\n') : String(v ?? '');
}

export function contains(haystack, needle) {
  const h = norm(haystack).replace(/\s/g, '');
  const n = norm(needle).replace(/\s/g, '');
  return n.length > 0 && h.includes(n);
}

const NUM_RE = /\d+(?:\.\d+)?/g;

export function numbersIn(s) {
  const seen = [];
  for (const raw of String(s ?? '').match(NUM_RE) ?? []) {
    const v = raw.replace(/^0+(?=\d)/, '');
    if (!seen.includes(v)) seen.push(v);
  }
  return seen;
}

const normalizeAnchors = (anchors) => (anchors ?? []).map((a) =>
  typeof a === 'string' ? { value: a, aliases: [] }
    : { value: String(a.value), aliases: (a.aliases ?? []).map(String) });

export function checkGrounding(answer, context, {
  question, anchors, allowedNewNumbers, answerable = true, abstainMarkers,
} = {}) {
  const answerS = String(answer ?? '');
  const ctx = flattenContext(context);
  const anchorObjs = normalizeAnchors(anchors);
  const issues = [];

  if (answerable === false) {
    const markers = abstainMarkers ?? DEFAULT_ABSTAIN;
    const outNeg = normNeg(answerS);
    const abstained = markers.some((m) => outNeg.includes(normNeg(m)));
    if (!abstained) issues.push('unanswerable question — the answer did not abstain (risk of fabrication)');
    return { grounded: issues.length === 0, anchorsMissed: [], ungroundedNumbers: [], abstained, issues };
  }

  const anchorsMissed = anchorObjs
    .filter((a) => ![a.value, ...a.aliases].some((v) => contains(answerS, v)))
    .map((a) => a.value);
  for (const v of anchorsMissed) issues.push(`missing answer fact "${v}"`);

  const legit = new Set(numbersIn(ctx));
  for (const n of numbersIn(question ?? '')) legit.add(n);
  for (const a of anchorObjs) {
    for (const n of numbersIn(a.value)) legit.add(n);
    for (const x of a.aliases) for (const n of numbersIn(x)) legit.add(n);
  }
  for (const n of allowedNewNumbers ?? []) legit.add(String(n));

  const ungroundedNumbers = numbersIn(answerS).filter((n) => !legit.has(n));
  for (const n of ungroundedNumbers) issues.push(`ungrounded number "${n}" — not in the provided context`);

  return { grounded: issues.length === 0, anchorsMissed, ungroundedNumbers, abstained: false, issues };
}

/* ── span location (rendering only — never affects the verdict) ────────── */

// contains() is whitespace-agnostic, so to paint a matched phrase back onto
// the original text we search with a whitespace-flexible, case-insensitive
// regex. If a span can't be located (exotic spacing), the check still counts —
// it just isn't highlighted.
function findSpans(text, needle) {
  const tokens = norm(needle).split(' ').filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return [];
  const re = new RegExp(tokens.join('\\s*'), 'gi');
  const out = [];
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

function numberSpans(text) {
  const out = [];
  for (const m of text.matchAll(NUM_RE)) {
    out.push({ start: m.index, end: m.index + m[0].length, value: m[0].replace(/^0+(?=\d)/, '') });
  }
  return out;
}

// Merge candidate spans, dropping overlaps (earlier/longer spans win).
function paint(text, spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start >= cursor) { kept.push(s); cursor = s.end; }
  }
  let html = '';
  let i = 0;
  for (const s of kept) {
    html += esc(text.slice(i, s.start));
    const tip = s.tip ? ` title="${esc(s.tip)}"` : '';
    html += `<mark class="${s.cls}"${tip}>${esc(text.slice(s.start, s.end))}</mark>`;
    i = s.end;
  }
  return html + esc(text.slice(i));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ── card renderer ─────────────────────────────────────────────────────── */

export function renderVerificationCard(input) {
  const { answer, context, question, anchors, answerable = true, caseId } = input;
  const result = input.result ?? checkGrounding(answer, context, {
    question, anchors, allowedNewNumbers: input.allowedNewNumbers,
    answerable, abstainMarkers: input.abstainMarkers,
  });
  const anchorObjs = normalizeAnchors(anchors);
  const ctxText = flattenContext(context);
  const answerS = String(answer ?? '');

  /* answer highlights */
  const spans = [];
  const matchedAnchors = [];
  for (const a of anchorObjs) {
    if (result.anchorsMissed.includes(a.value)) continue;
    const hit = [a.value, ...a.aliases].find((v) => contains(answerS, v));
    matchedAnchors.push({ value: a.value, via: hit });
    for (const [start, end] of findSpans(answerS, hit).slice(0, 1)) {
      spans.push({ start, end, cls: 'ok', tip: `required fact: "${a.value}"` });
    }
  }
  for (const n of numberSpans(answerS)) {
    if (result.ungroundedNumbers.includes(n.value)) {
      spans.push({ start: n.start, end: n.end, cls: 'bad', tip: 'not found in the provided context' });
    }
  }
  const answerHtml = paint(answerS, spans);

  /* context highlights — where the answer's facts live */
  const ctxSpans = [];
  for (const a of matchedAnchors) {
    for (const cand of [a.value, a.via]) {
      for (const [start, end] of findSpans(ctxText, cand).slice(0, 1)) {
        ctxSpans.push({ start, end, cls: 'src' });
      }
    }
  }
  const legitInAnswer = numbersIn(answerS).filter((n) => !result.ungroundedNumbers.includes(n));
  for (const n of numberSpans(ctxText)) {
    if (legitInAnswer.includes(n.value)) ctxSpans.push({ start: n.start, end: n.end, cls: 'src' });
  }
  const contextHtml = paint(ctxText, ctxSpans);

  /* check rows */
  const rows = [];
  if (answerable === false) {
    rows.push(row(result.abstained,
      result.abstained ? 'Abstained — the context cannot answer this question'
        : 'Did not abstain on an unanswerable question (risk of fabrication)'));
  } else {
    if (anchorObjs.length) {
      rows.push(row(result.anchorsMissed.length === 0,
        `Required facts present — ${anchorObjs.length - result.anchorsMissed.length}/${anchorObjs.length}`,
        result.anchorsMissed.map((v) => `missing answer fact "${v}"`)));
    }
    const total = numbersIn(answerS).length;
    rows.push(row(result.ungroundedNumbers.length === 0,
      total === 0 ? 'Numbers trace to the context — none introduced'
        : `Numbers trace to the context — ${total - result.ungroundedNumbers.length}/${total}`,
      result.ungroundedNumbers.map((n) => `ungrounded number "${n}" — not in the provided context`)));
  }

  const verdict = result.grounded
    ? '<span class="pill pass">VERIFIED ✓</span>'
    : '<span class="pill fail">NOT VERIFIED ✗</span>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenGATE — verification${caseId ? ` · ${esc(caseId)}` : ''}</title>
<style>
:root { --ink:#0f1a2e; --teal:#0d7377; --teal-light:#e6f3f3; --muted:#6b7b8d;
  --rule:#e2e5ea; --cream:#faf9f7; --red:#b4453a; --red-light:#fdf6f5; --red-rule:#f0dcd9; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system, 'Segoe UI', sans-serif; background:var(--ink);
  padding:2.5rem; display:flex; justify-content:center; -webkit-font-smoothing:antialiased; }
.card { background:#fff; border-radius:12px; max-width:680px; width:100%;
  box-shadow:0 24px 60px rgba(0,0,0,0.35); padding:1.6rem 1.75rem 1.4rem; }
.head { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.1rem; }
.brand { display:flex; align-items:center; gap:0.5rem; font-weight:700; color:var(--ink); font-size:0.95rem; }
.brand small { font-weight:400; color:var(--muted); font-size:0.72rem; }
.pill { font-family:ui-monospace, 'SF Mono', Menlo, monospace; font-size:0.7rem; font-weight:600;
  letter-spacing:0.08em; padding:0.35rem 0.85rem; border-radius:999px; }
.pill.pass { background:var(--teal-light); color:#0a5c5f; }
.pill.fail { background:var(--red-light); color:var(--red); }
.label { font-family:ui-monospace, 'SF Mono', Menlo, monospace; font-size:0.6rem;
  letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin:0.9rem 0 0.4rem; }
.panel { border:1px solid var(--rule); border-radius:8px; padding:0.8rem 0.95rem;
  font-size:0.84rem; line-height:1.7; color:rgba(15,26,46,0.85); background:var(--cream); }
.panel.ctx { background:#fff; font-size:0.78rem; color:var(--muted); }
mark { border-radius:3px; padding:0 0.15em; }
mark.ok { background:var(--teal-light); color:#0a5c5f; box-shadow:inset 0 -2px 0 var(--teal); }
mark.bad { background:var(--red-light); color:var(--red); box-shadow:inset 0 -2px 0 var(--red);
  text-decoration:underline wavy var(--red) 1px; text-underline-offset:3px; }
mark.src { background:var(--teal-light); color:inherit; }
.checks { list-style:none; margin-top:0.2rem; }
.checks li { display:flex; align-items:baseline; gap:0.55rem; padding:0.4rem 0;
  border-bottom:1px solid var(--cream); font-family:ui-monospace,'SF Mono',Menlo,monospace;
  font-size:0.72rem; color:rgba(15,26,46,0.85); }
.checks li:last-child { border-bottom:none; }
.checks .t { flex-shrink:0; font-weight:700; }
.checks .t.ok { color:var(--teal); } .checks .t.bad { color:var(--red); }
.checks .why { display:block; color:var(--red); margin-top:0.15rem; }
.foot { display:flex; justify-content:space-between; gap:1rem; margin-top:1rem;
  padding-top:0.85rem; border-top:1px solid var(--rule);
  font-size:0.66rem; color:var(--muted); line-height:1.5; }
.foot .cmd { font-family:ui-monospace,'SF Mono',Menlo,monospace; white-space:nowrap; color:var(--ink); }
</style></head><body>
<div class="card">
  <div class="head">
    <div class="brand">
      <svg width="20" height="20" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22 84 V32 Q22 22 32 22 H68 Q78 22 78 32 V84" fill="none" stroke="#0d7377" stroke-width="9" stroke-linecap="round"/><line x1="8" y1="58" x2="58" y2="58" stroke="#0d7377" stroke-width="9" stroke-linecap="round"/><polyline points="44,42 60,58 44,74" fill="none" stroke="#0d7377" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      OpenGATE <small>· verification${caseId ? ` · ${esc(caseId)}` : ''}</small>
    </div>
    ${verdict}
  </div>
  ${question ? `<div class="label">Question</div><div class="panel ctx">${esc(question)}</div>` : ''}
  <div class="label">AI answer</div>
  <div class="panel">${answerHtml}</div>
  <div class="label">Checks</div>
  <ul class="checks">${rows.join('')}</ul>
  <div class="label">Context (the evidence)</div>
  <div class="panel ctx">${contextHtml}</div>
  <div class="foot">
    <span>Deterministic — same evidence, same verdict, every run. No LLM judge.</span>
    <span class="cmd">github.com/nickjlamb/opengate</span>
  </div>
</div>
</body></html>`;

  function row(ok, text, whys = []) {
    const mark = ok ? '<span class="t ok">✓</span>' : '<span class="t bad">✗</span>';
    const why = whys.map((w) => `<span class="why">↳ ${esc(w)}</span>`).join('');
    return `<li>${mark}<span>${esc(text)}${why}</span></li>`;
  }
}
