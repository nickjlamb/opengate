// The deterministic arm, in one function.
//
// This is *not* a reimplementation for the experiment: it calls OpenGATE's own
// shared checkers — the same code paths src/scorers/simplification.mjs and
// src/scorers/grounding.mjs run in CI against live systems. exp-2 only swaps
// the source of the output text (frozen file instead of a live adapter call),
// which is exactly what makes the two arms comparable.
//
// TWO verdicts are returned, and exp-2 uses the narrower one:
//
//   pass              the full release gate: anchors + numbers + abstention +
//                     the product's LENGTH CONTRACT (e.g. Brief mode ≤3 bullets).
//   faithfulnessPass  anchors + numbers + abstention only.
//
// exp-2 compares arms on `faithfulnessPass`, because mutation necessarily
// perturbs output shape — appending a contradiction to a 3-bullet output makes
// it a 4-bullet output — and a length-contract violation is not a faithfulness
// failure. Scoring the contradiction mutants against the contract gate would let
// the deterministic arm "catch" them for a reason that has nothing to do with
// what they contradict, which would be a false win and would invalidate the
// coverage comparison. The contract gate is reported, never counted.

import { checkSimplification } from '../../src/lib/simplification-check.mjs';
import { checkGrounding } from '../../src/lib/grounding-check.mjs';

/**
 * @param {object} item — frozen corpus item ({ kind, text, ... })
 * @param {object} c    — the gold case it came from
 * @returns {{ pass, anchorsMissed, ungroundedNumbers, contractViolations, abstained, issues }}
 */
export function scoreItem(item, c) {
  if (item.kind === 'simplification') {
    const r = checkSimplification({
      output: item.text,
      text: c.text,
      anchors: c.anchors,
      allowedNewNumbers: c.allowedNewNumbers,
      maxBullets: c.maxBullets,
      maxWordsPerBullet: c.maxWordsPerBullet,
    });
    const faithfulnessPass = r.anchorsMissed.length === 0 && r.fabricated.length === 0;
    return {
      pass: faithfulnessPass && r.contractViolations.length === 0,
      faithfulnessPass,
      anchorsMissed: r.anchorsMissed,
      ungroundedNumbers: r.fabricated,
      contractViolations: r.contractViolations,
      abstained: null,
      // Issues, minus the contract ones — the faithfulness issues are what the
      // arms are compared on, and what "failure localisation" means here.
      issues: r.issues.filter(i => !i.startsWith('contract:')),
      contractIssues: r.issues.filter(i => i.startsWith('contract:')),
    };
  }

  const r = checkGrounding({
    answer: item.text,
    context: c.context,
    question: c.question,
    anchors: c.answerAnchors,
    allowedNewNumbers: c.allowedNewNumbers,
    answerable: c.answerable,
    abstainMarkers: c.abstainMarkers,
  });
  return {
    // Grounding has no length contract, so the two verdicts coincide.
    pass: r.grounded,
    faithfulnessPass: r.grounded,
    anchorsMissed: r.anchorsMissed,
    ungroundedNumbers: r.ungroundedNumbers,
    contractViolations: [],
    abstained: r.abstained,
    issues: r.issues,
    contractIssues: [],
  };
}
