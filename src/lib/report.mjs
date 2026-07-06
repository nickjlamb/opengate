// Render a run snapshot into a self-contained HTML dashboard.
//
// Pure: (snapshot, { baseline }) -> HTML string. No I/O, no dependencies, no
// network — so it's trivially testable and the output is one file you can open,
// email, or attach to a CI run. This is the human-readable face of the JSON
// scorecards the runner already writes.

const RATE_RE = /(rate|accuracy|precision|recall|f1|jaccard|consistency|adjacency|exact|share|score|fidelity|recall)/i;
const isRate = (k) => RATE_RE.test(k);

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtVal(k, v) {
  if (typeof v === 'number') return isRate(k) ? (v * 100).toFixed(1) + '%' : String(v);
  if (Array.isArray(v)) return v.map(String).join(', ') || '—';
  return String(v);
}

/** Per-metric delta vs baseline, matching the runner's regression semantics. */
function deltaHtml(k, cur, base) {
  if (typeof cur !== 'number' || typeof base !== 'number') return '';
  const d = cur - base;
  if (Math.abs(d) < 1e-9) return '<span class="d d0">±0</span>';
  const up = d > 0;
  const cls = up ? 'dup' : 'ddown';
  const arrow = up ? '▲' : '▼';
  const txt = isRate(k)
    ? `${up ? '+' : ''}${(d * 100).toFixed(1)}pp`
    : `${up ? '+' : ''}${d}`;
  return `<span class="d ${cls}">${arrow} ${esc(txt)}</span>`;
}

export function renderReport(snapshot, { baseline } = {}) {
  const results = snapshot.results || [];
  const baseById = baseline
    ? Object.fromEntries((baseline.results || []).map(r => [r.id, r]))
    : {};

  const scored = results.filter(r => !r.skipped);
  const passed = scored.filter(r => r.passed).length;
  const failed = scored.filter(r => r.passed === false).length;
  const skipped = results.filter(r => r.skipped).length;
  const overall = failed === 0 ? 'PASS' : 'FAIL';

  const cards = results.map(r => {
    if (r.skipped) {
      return `<section class="card skip">
        <header><span class="badge b-skip">SKIPPED</span><h2>${esc(r.id)}</h2></header>
        <p class="reason">${esc(r.reason || '')}</p>
      </section>`;
    }
    const b = baseById[r.id];
    const rows = Object.entries(r.metrics || {}).map(([k, v]) => {
      const dl = b && b.metrics ? deltaHtml(k, v, b.metrics[k]) : '';
      return `<tr><td class="k">${esc(k)}</td><td class="v">${esc(fmtVal(k, v))}</td><td class="dl">${dl}</td></tr>`;
    }).join('');
    const fails = (r.failures || []).length
      ? `<div class="fails"><div class="fails-h">${r.failures.length} failure${r.failures.length === 1 ? '' : 's'}</div><ul>${
          r.failures.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`
      : '';
    const cls = r.passed ? 'pass' : 'fail';
    const badge = r.passed ? '<span class="badge b-pass">PASS</span>' : '<span class="badge b-fail">FAIL</span>';
    return `<section class="card ${cls}">
      <header>${badge}<h2>${esc(r.id)}</h2></header>
      <table class="metrics"><tbody>${rows}</tbody></table>
      ${fails}
    </section>`;
  }).join('\n');

  const meta = [
    ['adapter', snapshot.adapter],
    ['mode', snapshot.online ? 'online' : 'offline'],
    ['commit', snapshot.sha],
    ['run', snapshot.timestamp],
    baseline ? ['vs baseline', 'yes'] : null,
  ].filter(Boolean).map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenGATE report — ${esc(overall)} · ${esc(snapshot.adapter || '')}</title>
<style>
  :root{--ink:#0f1a2e;--muted:#6b7b8d;--rule:#e2e5ea;--teal:#0d7377;--teal-l:#e6f3f3;--cream:#faf9f7;--code:#f5f7f9;--red:#b4453a;--red-l:#fdf6f5;--green:#2d7a4f}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:var(--cream);line-height:1.5;padding:2rem 1rem}
  .wrap{max-width:860px;margin:0 auto}
  .top{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1rem;margin-bottom:.4rem}
  .logo{font-weight:700;letter-spacing:.02em}
  .verdict{font-weight:700;font-size:.8rem;padding:.25rem .7rem;border-radius:999px}
  .v-pass{background:var(--teal-l);color:var(--teal)}
  .v-fail{background:var(--red-l);color:var(--red)}
  .summary{color:var(--muted);font-size:.85rem;margin-bottom:.9rem}
  .meta{display:flex;flex-wrap:wrap;gap:.4rem 1.1rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--muted);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:.6rem 0;margin-bottom:1.4rem}
  .meta b{color:var(--ink);font-weight:600}
  .card{background:#fff;border:1px solid var(--rule);border-radius:10px;padding:1.1rem 1.25rem;margin-bottom:1rem;border-left:4px solid var(--rule)}
  .card.pass{border-left-color:var(--teal)}
  .card.fail{border-left-color:var(--red)}
  .card.skip{opacity:.7}
  .card header{display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem}
  .card h2{font-size:1rem;font-weight:600}
  .badge{font-size:.6rem;font-weight:700;letter-spacing:.08em;padding:.15rem .45rem;border-radius:4px}
  .b-pass{background:var(--teal-l);color:var(--teal)}
  .b-fail{background:var(--red-l);color:var(--red)}
  .b-skip{background:#eef1f4;color:var(--muted)}
  .reason{color:var(--muted);font-size:.82rem}
  table.metrics{width:100%;border-collapse:collapse;font-size:.8rem}
  table.metrics td{padding:.28rem .4rem;border-bottom:1px solid var(--rule);vertical-align:top}
  table.metrics tr:last-child td{border-bottom:none}
  td.k{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);width:52%}
  td.v{font-weight:600;font-variant-numeric:tabular-nums}
  td.dl{text-align:right;white-space:nowrap}
  .d{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem}
  .dup{color:var(--green)} .ddown{color:var(--red)} .d0{color:var(--muted)}
  .fails{margin-top:.8rem;background:var(--red-l);border-radius:6px;padding:.6rem .75rem}
  .fails-h{font-size:.72rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.35rem}
  .fails ul{margin:0;padding-left:1.1rem}
  .fails li{font-size:.8rem;color:var(--ink);margin:.15rem 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  footer{color:var(--muted);font-size:.72rem;text-align:center;margin-top:1.5rem}
  footer a{color:var(--teal);text-decoration:none}
</style></head>
<body><div class="wrap">
  <div class="top">
    <span class="logo">OpenGATE</span>
    <span class="verdict ${overall === 'PASS' ? 'v-pass' : 'v-fail'}">${esc(overall)}</span>
  </div>
  <div class="summary">${passed} passed · ${failed} failed · ${skipped} skipped</div>
  <div class="meta">${meta}</div>
  ${cards}
  <footer>Generated by <a href="https://github.com/nickjlamb/opengate">OpenGATE</a> · deterministic, gold-anchored evaluation</footer>
</div></body></html>`;
}
