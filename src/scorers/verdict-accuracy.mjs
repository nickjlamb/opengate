// ONLINE scorer — verdict accuracy + passage hallucination + consistency.
//
// Verifies ONE claim per call against its single cited reference (sent as a text
// document) via the adapter's analyzeBatch(). One-claim-per-call deliberately
// sidesteps multi-claim reassembly bugs in batch endpoints, so this measures the
// model's verdict QUALITY, not batch-matching behaviour.
//
// Metrics:
//   • exact / adjacency verdict accuracy on the six-point support scale
//   • confusion matrix (gold vs predicted)
//   • passage hallucination rate (cited quotes not found verbatim in the source)
//   • guard_downgrades (verdicts the integrity guard downgraded)
//   • consistency (when OPENGATE_EVAL_REPEATS > 1): verdict stability across repeats

import { verdictAccuracy, confusionMatrix, normText, mean, percentile } from '../lib/metrics.mjs';

export const meta = { id: 'verdict-accuracy', mode: 'online' };

const REPEATS = Math.max(1, parseInt(process.env.OPENGATE_EVAL_REPEATS || process.env.REFCHECKR_EVAL_REPEATS || '1', 10));

// One claim against its one cited reference.
function buildPairPayload(caseId, claimText, citation, ref) {
  return {
    claims: [claimText],
    documents: [{ name: ref.name, type: 'text', content: ref.text }],
    citationMapping: { [citation]: { refId: 'upload:' + ref.name } },
    claimCitations: [{ citations: [citation] }],
    document_name: `eval-${caseId}`,
  };
}

function readVerdict(resp, refName) {
  const r = (resp.claims || [])[0];
  if (!r) return { verdict: undefined, analysis: null };
  const a = (r.individual_analyses || []).find(x => x.document_name === refName)
    || (r.individual_analyses || [])[0];
  return { verdict: a?.verdict, analysis: a || null };
}

// Quote text from a passage object, tolerant of field naming.
function passageQuote(p) {
  return p?.quote ?? p?.text ?? p?.passage ?? p?.snippet ?? '';
}

// enforceVerdictIntegrity() prepends a fixed reason to the summary when it
// downgrades a verdict; detecting it tells us the guard fired vs the model judged.
function isGuardDowngrade(summary) {
  if (!summary) return false;
  const s = String(summary).toLowerCase();
  return s.includes('could not be verified against the document')
    || s.includes('no explicit textual statement was found')
    || s.includes('no explicit textual support found');
}

export async function run({ cases, adapter }) {
  if (!adapter.capabilities.qa) {
    return { meta, skipped: true, reason: `adapter "${adapter.name}" has no QA capability` };
  }
  if (!adapter.onlineAvailable()) {
    return { meta, skipped: true, reason: adapter.onlineConfigHint() };
  }
  const goldCases = cases.filter(c => (c.goldVerdicts || []).length > 0 && c.references);
  if (goldCases.length === 0) {
    return { meta, skipped: true, reason: 'No cases include goldVerdicts + references.' };
  }

  adapter.resetTiming(); // start latency capture for the verify calls below
  adapter.resetTokens();  // start token-usage capture for real cost/claim

  const pairs = [];
  const consistencyShares = [];
  let passageTotal = 0, passageInfidel = 0;
  const failures = [];

  for (const c of goldCases) {
    for (const g of c.goldVerdicts) {
      const ref = c.references[g.citation];
      if (!ref) { failures.push(`missing reference ${g.citation} in ${c.id}`); continue; }
      const payload = buildPairPayload(c.id, g.claimText, g.citation, ref);

      const runVerdicts = [];
      let firstAnalysis = null, firstVerdict;
      for (let run = 0; run < REPEATS; run++) {
        let resp;
        try {
          resp = await adapter.analyzeBatch(payload);
        } catch (err) {
          failures.push(`${c.id} "${g.claimText.slice(0, 30)}…" run ${run + 1}: ${err.message}`);
          break;
        }
        const { verdict, analysis } = readVerdict(resp, ref.name);
        runVerdicts.push(verdict);
        if (run === 0) { firstAnalysis = analysis; firstVerdict = verdict; }
      }

      if (firstVerdict) {
        pairs.push({
          case: c.id,
          claim: g.claimText.slice(0, 45),
          predicted: firstVerdict,
          gold: g.verdict,
          downgraded: isGuardDowngrade(firstAnalysis?.summary),
          summary: String(firstAnalysis?.summary || '').slice(0, 200),
          passageCount: (firstAnalysis?.passages || []).length,
        });
      } else {
        failures.push(`no prediction for "${g.claimText.slice(0, 40)}…" in ${c.id}`);
      }

      // Passage hallucination (first run): cited quote should appear in the source.
      const refText = normText(ref.text || '');
      for (const p of (firstAnalysis?.passages || [])) {
        const q = normText(passageQuote(p));
        if (q.length < 12) continue;
        passageTotal++;
        if (!refText.includes(q.slice(0, Math.min(q.length, 60)))) passageInfidel++;
      }

      // Consistency across repeats for this pair (modal-verdict share).
      if (REPEATS > 1 && runVerdicts.length) {
        const counts = {};
        for (const v of runVerdicts) counts[v] = (counts[v] || 0) + 1;
        consistencyShares.push(Math.max(...Object.values(counts)) / runVerdicts.length);
      }
    }
  }

  const acc = verdictAccuracy(pairs);
  const cm = confusionMatrix(pairs);
  const hallucinationRate = passageTotal ? passageInfidel / passageTotal : 0;
  const consistency = consistencyShares.length ? mean(consistencyShares) : null;
  const downgradedPairs = pairs.filter(p => p.downgraded);

  // Per-verify-call latency (one call verifies one claim against its reference,
  // so this is p50/p95 latency per claim). Counts as info in the snapshot — not
  // a pass/fail gate.
  const verifyMs = adapter.callLatencies();
  const tok = adapter.tokenTotals();
  const model = adapter.runModel();

  const metrics = {
    n_pairs: pairs.length,
    verdict_exact: round(acc.exact),
    verdict_adjacency: round(acc.adjacent),
    hallucination_rate: round(hallucinationRate),
    guard_downgrades: downgradedPairs.length,
    ...(consistency != null ? { consistency: round(consistency), repeats: REPEATS } : {}),
    ...(verifyMs.length ? {
      latency_p50_ms: Math.round(percentile(verifyMs, 50)),
      latency_p95_ms: Math.round(percentile(verifyMs, 95)),
      latency_calls: verifyMs.length,
    } : {}),
    ...(tok.calls ? {
      avg_input_tokens: Math.round(tok.prompt_tokens / tok.calls),
      avg_output_tokens: Math.round(tok.completion_tokens / tok.calls),
      avg_reasoning_tokens: Math.round(tok.reasoning_tokens / tok.calls),
      avg_total_tokens: Math.round(tok.total_tokens / tok.calls),
      token_calls: tok.calls,
    } : {}),
    ...(model ? { run_model: model } : {}),
  };

  return { meta, metrics, detail: { confusion: cm, pairs }, failures, passed: failures.length === 0 };
}

function round(x) { return Math.round(x * 1000) / 1000; }
