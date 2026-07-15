#!/usr/bin/env node
// exp-2 step 2 — derive the frozen corpus: base outputs + deterministic mutants.
//
// Six base outputs is too thin to say anything about judge variance, and it
// gives no ground truth to score either arm against. So each base output is
// mutated in fixed, committed ways that inject ONE known defect:
//
//   dropped_anchor     the safety-critical fact is deleted from the output.
//                      An OMISSION, not a fabrication — the deterministic anchor
//                      gate catches it; a faithfulness judge, which asks only
//                      whether asserted claims are supported, is blind to it by
//                      construction. Reported as a coverage difference, not as a
//                      judge failure.
//   fabricated_number  a plausible sentence carrying a number that appears
//                      nowhere in the source is appended. Both arms should catch
//                      this.
//   contradiction      a sentence that CONTRADICTS the source is appended. It
//                      adds no numbers and removes no anchors, so the
//                      deterministic layer passes it by construction. A
//                      faithfulness judge should catch it easily: it is an
//                      unsupported ASSERTION, which is exactly what the metric
//                      looks for.
//   inversion          the hard one. An existing statement in the output has its
//                      POLARITY FLIPPED in place — "increased to 100 micrograms"
//                      → "reduced to 100 micrograms", "haemoglobin is low" →
//                      "haemoglobin is high". Every anchor survives verbatim,
//                      every number is unchanged, nothing is added: the output is
//                      the same length, the same shape, and says the opposite
//                      thing. The deterministic layer CANNOT see this, and is not
//                      claimed to. It is the reverse-direction test — the judges
//                      are expected to win here — and it is what makes exp-2 a
//                      two-sided complementarity result rather than a home fixture.
//   non_abstention     (unanswerable case only) the abstention is replaced with
//                      a confident answer the context does not support.
//
// SCOPE, stated up front: dropped_anchor, fabricated_number and non_abstention
// are IN SCOPE for deterministic checking; contradiction and inversion are OUT
// OF SCOPE by construction. Because the mutants are derived from that taxonomy,
// any sensitivity comparison between the arms must be scoped accordingly — a
// deterministic score of 3/3 on in-scope classes says nothing about the classes
// it cannot see, and the inversion arm exists to keep that honest. analyse.mjs
// reports the two groups separately and never sums them.
//
// Mutation is pure and deterministic: same base outputs in, byte-identical
// corpus out. The script self-checks — every mutant is run through OpenGATE's
// own checkers and the build fails if a mutant does not carry exactly the defect
// it claims to carry. In particular: if a contradiction or inversion mutant is
// accidentally CAUGHT by the deterministic layer (a stray number, a lost anchor),
// the build fails rather than quietly manufacturing a false win.
//
//   node paper/exp2/make-mutants.mjs
//
// Output: paper/exp2/corpus/frozen-corpus.json

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenContext, numbersIn } from '../../src/lib/grounding-check.mjs';
import { scoreItem } from './score-item.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CASES_DIR = resolve(ROOT, 'datasets/cases');
const BASE = resolve(HERE, 'corpus/base-outputs.json');
const OUT = resolve(HERE, 'corpus/frozen-corpus.json');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ── Committed contradiction sentences ───────────────────────────────────────
// Authored from the CASE (not from the captured output), so they were fixed
// before any output existed. Each one: contradicts the source, contains no
// digits, and repeats rather than removes the case's anchors — so it is
// invisible to number and anchor checks by construction.
const CONTRADICTIONS = {
  'simplify-discharge-brief':
    'You do not need to finish the full course of antibiotics once you feel better.',
  'simplify-lab-results':
    'Your iron levels are within the normal range, so no treatment is needed.',
  'simplify-medication-change':
    'Take the new dose of levothyroxine at bedtime rather than in the morning.',
  'grounding-saas-refund':
    'Standard plans are also subject to a restocking fee on return.',
  'grounding-legal-clause':
    'Either party may also terminate for convenience without any written notice, at its discretion.',
};

// ── Committed inversion rules ───────────────────────────────────────────────
// The reverse-direction probe: flip the MEANING of a statement the output
// already makes, in place, without touching a single anchor or number.
//
// Rules are authored from the CASE, not from the captured output (they were
// fixed before any output existed), and are phrased as alternatives because the
// output is a paraphrase and we cannot know in advance which wording it used.
// The FIRST rule that matches is applied, and exactly one is applied.
//
// If none matches, the build FAILS and prints the base output: add a pattern
// rather than let the case silently drop out of the inversion arm. A missing
// inversion mutant would quietly bias the experiment toward the deterministic
// arm, which is precisely the bias this class exists to correct for.
const INVERSIONS = {
  'simplify-discharge-brief': {
    // Source: return to hospital IF breathlessness worsens or fever > 38.
    // Inverted: the safety-netting advice is reversed. "38" survives verbatim.
    intent: 'safety-netting advice reversed (return to hospital → do not return)',
    rules: [
      { find: /\b(?:please\s+)?return to (?:the\s+)?hospital\b/i, replace: 'Do not return to hospital' },
      { find: /\bgo (?:back )?to (?:the\s+)?hospital\b/i, replace: 'Do not go to hospital' },
      { find: /\bseek (?:urgent |immediate )?(?:medical )?(?:help|attention|advice)\b/i, replace: 'Do not seek medical help' },
      { find: /\bcontact (?:your (?:GP|doctor)|the hospital|us)\b/i, replace: 'Do not contact anyone' },
    ],
  },
  'simplify-lab-results': {
    // Source: haemoglobin 9.8 LOW, ferritin 8 LOW → iron-deficiency anaemia.
    // Inverted: the same values, described as high. Every number identical.
    //
    // `all: true` — every polarity word is flipped, not just the first. A
    // half-flipped output ("haemoglobin is high … iron stores are low") is
    // internally incoherent, and a judge might flag the incoherence rather than
    // the inversion. That would score as a catch for the wrong reason.
    all: true,
    intent: 'abnormal results described as the opposite abnormality (low → high)',
    rules: [
      { find: /\bbelow the normal range\b/gi, replace: 'above the normal range' },
      { find: /\blower than (?:the )?normal\b/gi, replace: 'higher than normal' },
      { find: /\b(is|are|was|were)\s+(?:a little\s+|slightly\s+|quite\s+|very\s+)?low\b/gi, replace: '$1 high' },
      { find: /\b(?:a little\s+|slightly\s+)?low\b/gi, replace: 'high' },
      { find: /\bdepleted\b/gi, replace: 'elevated' },
      { find: /\banaemia\b/gi, replace: 'iron overload' },
    ],
  },
  'simplify-medication-change': {
    // Source: dose INCREASED 50 → 100 micrograms. Inverted: the same 100
    // micrograms, described as a reduction. The anchor "100 micrograms" survives.
    intent: 'dose change direction reversed (increase → reduction)',
    rules: [
      { find: /\bhas been increased\b/i, replace: 'has been reduced' },
      { find: /\bis (?:going|being) increased\b/i, replace: 'is being reduced' },
      { find: /\bis going up\b/i, replace: 'is going down' },
      { find: /\bincreas(?:ed|ing|e)\b/i, replace: 'reduced' },
      { find: /\bputting up\b/i, replace: 'cutting down' },
    ],
  },
  'grounding-saas-refund': {
    // Source: refund available WITHIN 30 days. Inverted: refunds refused within
    // that window. The "30 days" and "no restocking fee" anchors both survive
    // verbatim — the whole clause is rewritten, so the result stays grammatical.
    // (An ungrammatical mutant is worse than useless: a judge may flag the
    // incoherence rather than the inverted meaning, and score a catch it did not
    // earn.)
    intent: 'refund entitlement reversed (refund within 30 days → no refund within 30 days)',
    rules: [
      { find: /\b(?:customers\s+)?(?:may|can)\s+request\s+a\s+(?:full\s+)?refund\s+within\s+30 days\b/i,
        replace: 'Customers may not request a refund within 30 days' },
      { find: /\b(?:customers\s+)?(?:have|get)\s+30 days\b[^.]*?\brefund\b/i,
        replace: 'Customers may not request a refund within 30 days of purchase' },
      { find: /\b(?:customers\s+)?(?:can|may)\s+request\s+a\s+(?:full\s+)?refund\b/i,
        replace: 'Customers may not request a refund' },
      { find: /\bwithin 30 days\b/i, replace: 'only after 30 days' },
    ],
  },
  'grounding-legal-clause': {
    // Source: termination for convenience REQUIRES 90 days' written notice.
    // Inverted: the same 90 days and the same "written notice", now not required.
    intent: 'notice requirement negated (requires 90 days → does not require)',
    rules: [
      { find: /\brequires?\b/i, replace: 'does not require' },
      { find: /\bmust (?:give|provide|serve)\b/i, replace: 'need not give' },
      { find: /\bis required\b/i, replace: 'is not required' },
      { find: /\bupon\b/i, replace: 'without' },
    ],
  },
  // grounding-unanswerable has no statement to invert — the base output abstains.
  // The non_abstention mutant is that case's out-of-scope-for-nothing probe.
};

// Non-abstention replacement for the unanswerable case: a confident answer the
// context does not support. No digits — the abstention gate, not the number
// gate, is what must catch this.
const NON_ABSTENTION = {
  'grounding-unanswerable':
    'The Enterprise plan is priced the same as the Pro plan and is billed annually.',
};

// Fabricated-number sentence templates, per kind. The number is chosen
// deterministically: the smallest integer in [11, 99] that appears nowhere in
// the case (source text / context / question / anchors / allowedNewNumbers).
const FABRICATION = {
  simplification: (n) => `About ${n}% of people notice an improvement within the first few days.`,
  grounding: (n) => `This applies in approximately ${n}% of cases.`,
};

function loadCases() {
  const map = new Map();
  for (const f of readdirSync(CASES_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const c = JSON.parse(readFileSync(resolve(CASES_DIR, f), 'utf8'));
    map.set(c.id, c);
  }
  return map;
}

const anchorsOf = (c) => (c.kind === 'grounding' ? c.answerAnchors : c.anchors) || [];

/** Legitimate numbers for a case — everything the output may contain. */
function legitNumbers(c) {
  const src = c.kind === 'grounding'
    ? `${flattenContext(c.context)} ${c.question || ''}`
    : (c.text || '');
  return new Set([
    ...numbersIn(src),
    ...anchorsOf(c).flatMap(a => [
      ...numbersIn(a.value),
      ...(a.aliases || []).flatMap(x => [...numbersIn(x)]),
    ]),
    ...(c.allowedNewNumbers || []).map(String),
  ]);
}

/** Smallest 11–99 integer that is not legitimate for this case. */
function pickFabricatedNumber(c) {
  const legit = legitNumbers(c);
  for (let n = 11; n <= 99; n++) if (!legit.has(String(n))) return String(n);
  throw new Error(`no free number for case ${c.id}`);
}

/** The anchor whose loss matters most: the first one carrying a number (a dose,
 *  a value, a deadline), else the first anchor. Deterministic. */
function targetAnchor(c) {
  const as = anchorsOf(c);
  return as.find(a => /\d/.test(a.value)) || as[0] || null;
}

/** Whitespace-tolerant, case-insensitive deletion of a phrase and its aliases. */
function deletePhrase(text, anchor) {
  let out = text;
  for (const form of [anchor.value, ...(anchor.aliases || [])]) {
    const pattern = form
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // escape regex metacharacters
      .replace(/\s+/g, '\\s*');                  // "500 mg" also matches "500mg"
    out = out.replace(new RegExp(pattern, 'gi'), '');
  }
  // Tidy the punctuation wreckage a deletion leaves behind, so the mutant reads
  // as a natural (if less specific) sentence rather than as obvious corruption.
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+$/gm, '');
}

/** Append a sentence to the output, respecting bullet formatting. */
function appendSentence(text, sentence) {
  const isBulleted = /^\s*[-•*]\s+/m.test(text);
  return isBulleted ? `${text.replace(/\s+$/, '')}\n- ${sentence}` : `${text.replace(/\s+$/, '')} ${sentence}`;
}

function main() {
  const cases = loadCases();
  const base = JSON.parse(readFileSync(BASE, 'utf8'));
  const items = [];
  const problems = [];

  for (const b of base.outputs) {
    const c = cases.get(b.caseId);
    if (!c) throw new Error(`no gold case for ${b.caseId}`);

    // ── base ────────────────────────────────────────────────────────────────
    // Ground truth for a base output is not assumed: it is whatever the gate
    // says. If a production output really does drop a fact, that is data.
    const baseScore = scoreItem(b, c);
    items.push({
      ...b,
      expected: {
        // "faithful" = asserts nothing the source does not support. An omission
        // is unfaithful to the TASK but not to the SOURCE; the judges are asked
        // only the latter question, so this flag reflects it.
        faithful: baseScore.ungroundedNumbers.length === 0,
        defectClass: baseScore.faithfulnessPass ? 'none' : 'observed-in-production',
        note: baseScore.faithfulnessPass
          ? null
          : `base output already fails the gate: ${baseScore.issues.join('; ')}`,
      },
    });

    const anchor = targetAnchor(c);
    const isUnanswerable = c.answerable === false;

    // ── mutant: dropped_anchor ─────────────────────────────────────────────
    if (anchor && !isUnanswerable) {
      const text = deletePhrase(b.text, anchor);
      const item = {
        outputId: `${b.caseId}::drop-anchor`,
        caseId: b.caseId,
        kind: b.kind,
        variant: 'drop-anchor',
        injectedDefect: {
          class: 'dropped_anchor',
          detail: `anchor "${anchor.value}" deleted from the output`,
        },
        producer: { ...b.producer, mutated: 'deterministic deletion' },
        caseSha256: b.caseSha256,
        text,
        expected: {
          faithful: true,          // omission, not fabrication
          defectClass: 'dropped_anchor',
          deterministicShouldFail: true,
          judgeExpectation: 'blind by construction — faithfulness asks only whether asserted claims are supported',
        },
      };
      const s = scoreItem(item, c);
      if (!s.anchorsMissed.includes(anchor.value)) {
        problems.push(`${item.outputId}: deletion did not produce the anchor loss (anchor still detected)`);
      }
      items.push(item);
    }

    // ── mutant: fabricated_number ──────────────────────────────────────────
    // Skipped for the unanswerable case: there, the abstention gate is the
    // check under test and it short-circuits number checking. The
    // non_abstention mutant covers that case instead.
    if (!isUnanswerable) {
      const n = pickFabricatedNumber(c);
      const text = appendSentence(b.text, FABRICATION[b.kind](n));
      const item = {
        outputId: `${b.caseId}::fabricate-number`,
        caseId: b.caseId,
        kind: b.kind,
        variant: 'fabricate-number',
        injectedDefect: { class: 'fabricated_number', detail: `number "${n}" appears nowhere in the source` },
        producer: { ...b.producer, mutated: 'deterministic append' },
        caseSha256: b.caseSha256,
        text,
        expected: {
          faithful: false,
          defectClass: 'fabricated_number',
          deterministicShouldFail: true,
          judgeExpectation: 'should catch — an unsupported asserted claim',
        },
      };
      const s = scoreItem(item, c);
      if (!s.ungroundedNumbers.includes(n)) {
        problems.push(`${item.outputId}: fabricated number ${n} was not flagged by the deterministic layer`);
      }
      items.push(item);
    }

    // ── mutant: contradiction / non_abstention ─────────────────────────────
    const contradiction = CONTRADICTIONS[b.caseId];
    const nonAbstention = NON_ABSTENTION[b.caseId];

    if (contradiction) {
      const text = appendSentence(b.text, contradiction);
      const item = {
        outputId: `${b.caseId}::contradiction`,
        caseId: b.caseId,
        kind: b.kind,
        variant: 'contradiction',
        injectedDefect: { class: 'contradiction', detail: contradiction },
        producer: { ...b.producer, mutated: 'deterministic append' },
        caseSha256: b.caseSha256,
        text,
        expected: {
          faithful: false,
          defectClass: 'contradiction',
          deterministicShouldFail: false,   // the admitted coverage ceiling
          judgeExpectation: 'should catch — this is what a judge is for',
        },
      };
      const s = scoreItem(item, c);
      // The coverage claim depends on this: the contradiction must be invisible
      // to the deterministic FAITHFULNESS checks (anchors, numbers, abstention)
      // relative to the base output. Length-contract violations are excluded —
      // appending a sentence to a 3-bullet output makes it a 4-bullet output,
      // which is an artefact of mutation, not a detection. See score-item.mjs.
      const baseIssues = new Set(baseScore.issues);
      const newIssues = s.issues.filter(i => !baseIssues.has(i));
      if (newIssues.length) {
        problems.push(
          `${item.outputId}: contradiction was caught by the deterministic layer ` +
          `(${newIssues.join('; ')}) — rewrite the sentence so it adds no numbers and removes no anchors, ` +
          'or the coverage comparison is invalid');
      }
      items.push(item);
    }

    // ── mutant: inversion ──────────────────────────────────────────────────
    // The reverse-direction probe. Polarity flipped in place; no text added, no
    // anchor removed, no number changed. The deterministic layer is EXPECTED to
    // miss this, and the experiment is only honest if it does.
    const inversion = INVERSIONS[b.caseId];
    if (inversion) {
      const applied = [];
      let text = b.text;
      for (const rule of inversion.rules) {
        const before = text;
        text = text.replace(rule.find, rule.replace);
        if (text !== before) {
          applied.push({ pattern: String(rule.find), replacement: rule.replace });
          // Default: one flip, the first that matches. `all: true` keeps going —
          // used where a single polarity word appears several times and flipping
          // only one would leave the output self-contradictory (see
          // simplify-lab-results), which a judge could flag as incoherence rather
          // than as the inversion, scoring a catch it did not earn.
          if (!inversion.all) break;
        }
      }

      if (!applied.length) {
        // Fail loudly. Silently skipping the case would bias the corpus toward
        // the classes the deterministic layer catches — the exact bias this
        // mutant class exists to correct.
        problems.push(
          `${b.caseId}::inversion: no inversion rule matched the captured output. ` +
          `Add a pattern to INVERSIONS['${b.caseId}'] that flips the polarity of a statement ` +
          `this output actually makes. The output was:\n      ${JSON.stringify(b.text)}`);
      } else {
        const item = {
          outputId: `${b.caseId}::inversion`,
          caseId: b.caseId,
          kind: b.kind,
          variant: 'inversion',
          injectedDefect: {
            class: 'inversion',
            detail: inversion.intent,
            applied,
          },
          producer: { ...b.producer, mutated: 'deterministic in-place polarity flip' },
          caseSha256: b.caseSha256,
          text,
          expected: {
            faithful: false,
            defectClass: 'inversion',
            // Not a failure of the deterministic arm — a statement of its floor.
            deterministicShouldFail: false,
            deterministicInScope: false,
            judgeExpectation: 'should catch — semantics is the one thing anchors cannot check',
          },
        };
        const s = scoreItem(item, c);

        // Three conditions, all load-bearing:
        //   (a) every anchor still present,
        //   (b) no number changed or introduced,
        //   (c) therefore the deterministic verdict is UNCHANGED from the base.
        // If any fails, the mutant is not a clean inversion and the coverage
        // result would be contaminated.
        const baseIssues = new Set(baseScore.issues);
        const newIssues = s.issues.filter(i => !baseIssues.has(i));
        if (newIssues.length) {
          problems.push(
            `${item.outputId}: the inversion perturbed an anchor or a number (${newIssues.join('; ')}). ` +
            'An inversion must flip meaning while leaving every anchor and number intact — ' +
            'otherwise the deterministic arm "catches" it for the wrong reason.');
        }
        if (numbersIn(item.text).size !== numbersIn(b.text).size) {
          problems.push(`${item.outputId}: the inversion changed the set of numbers in the output`);
        }
        items.push(item);
      }
    }

    if (nonAbstention) {
      const item = {
        outputId: `${b.caseId}::non-abstention`,
        caseId: b.caseId,
        kind: b.kind,
        variant: 'non-abstention',
        injectedDefect: { class: 'non_abstention', detail: nonAbstention },
        producer: { ...b.producer, mutated: 'deterministic replacement' },
        caseSha256: b.caseSha256,
        text: nonAbstention,
        expected: {
          faithful: false,
          defectClass: 'non_abstention',
          deterministicShouldFail: true,
          judgeExpectation: 'should catch — answers a question the context cannot answer',
        },
      };
      const s = scoreItem(item, c);
      if (s.faithfulnessPass) {
        problems.push(`${item.outputId}: non-abstention mutant still passes the abstention gate`);
      }
      items.push(item);
    }
  }

  if (problems.length) {
    console.error('mutant self-check FAILED:\n  ' + problems.join('\n  '));
    process.exit(1);
  }

  const payload = {
    builtFrom: { file: 'corpus/base-outputs.json', corpusSha256: base.corpusSha256, capturedAt: base.capturedAt },
    builtAt: new Date().toISOString(),
    note:
      'FROZEN corpus for exp-2. Base outputs captured once; mutants derived deterministically. ' +
      'Every judge, every repeat, and the deterministic arm all score these exact bytes.',
    // SCOPE is data, not prose: analyse.mjs groups the detection table by it and
    // refuses to sum across the groups. A deterministic arm scoring 3/3 on the
    // classes it was built to check is not evidence about the classes it cannot
    // see, and vice versa for the judges.
    defectClasses: {
      none: {
        description: 'base output, no injected defect',
        deterministicInScope: null,
        judgeInScope: null,
      },
      dropped_anchor: {
        description: 'safety-critical fact deleted from the output',
        deterministicInScope: true,
        judgeInScope: false,
        why: 'an omission asserts nothing unsupported, so a faithfulness judge cannot see it by construction',
      },
      fabricated_number: {
        description: 'number asserted that appears nowhere in the source',
        deterministicInScope: true,
        judgeInScope: true,
      },
      non_abstention: {
        description: 'confident answer to a question the context cannot answer',
        deterministicInScope: true,
        judgeInScope: true,
      },
      contradiction: {
        description: 'sentence contradicting the source, appended; adds no numbers, removes no anchors',
        deterministicInScope: false,
        judgeInScope: true,
        why: 'an added unsupported assertion — the deterministic layer has no semantic model',
      },
      inversion: {
        description: 'meaning of an existing statement flipped in place; every anchor and number survives verbatim',
        deterministicInScope: false,
        judgeInScope: true,
        why: 'the floor of anchor-and-number checking, stated as a measurement rather than a caveat',
      },
    },
    items,
  };
  payload.corpusSha256 = sha256(JSON.stringify(items));

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

  const byClass = {};
  for (const i of items) byClass[i.expected.defectClass] = (byClass[i.expected.defectClass] || 0) + 1;
  console.error(`frozen corpus → ${OUT}`);
  console.error(`  ${items.length} outputs  ${JSON.stringify(byClass)}`);
  console.error(`  sha256 ${payload.corpusSha256.slice(0, 12)}…  (self-check passed)`);
}

main();
