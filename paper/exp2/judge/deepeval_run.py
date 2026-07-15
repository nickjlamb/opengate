#!/usr/bin/env python3
"""exp-2 — judge arm B: DeepEval faithfulness, 5 repeats over the frozen corpus.

Same protocol as ragas_run.py (temperature 0, byte-identical inputs, 5 repeats),
a different judge implementation. Two independent judge frameworks make the
variance result harder to dismiss as an artefact of one library's prompt.

DeepEval also returns a natural-language `reason` per verdict. That is worth
capturing: it is the closest a judge arm gets to the failure LOCALISATION the
deterministic arm gives for free, and the analysis compares them.

    pip install -r paper/exp2/judge/requirements.txt
    OPENAI_API_KEY=sk-... python paper/exp2/judge/deepeval_run.py

Env:
    OPENAI_API_KEY     required
    JUDGE_MODEL        default gpt-4o-mini
    REPEATS            default 5

Output: paper/exp2/results/deepeval.json
"""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

# Before importing deepeval: no telemetry, no cloud upload of the corpus.
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
os.environ.setdefault("ERROR_REPORTING", "NO")

# DeepEval's default per-attempt timeout (~88s) is tight for the longer
# simplification outputs, and a single slow API call was killing the whole run.
os.environ.setdefault("DEEPEVAL_PER_ATTEMPT_TIMEOUT_SECONDS_OVERRIDE", "300")

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
CASES_DIR = EXP.parent.parent / "datasets" / "cases"
CORPUS = EXP / "corpus" / "frozen-corpus.json"
OUT = EXP / "results" / "deepeval.json"

# gpt-4o, not gpt-4o-mini: the mini model degenerated into a repetition loop inside
# DeepEval's structured-output call and could not score one of the outputs at all
# (see ../INCIDENTS.md). Both judge arms must run the SAME model or their scores
# are not comparable — change this and change ragas_run.py with it.
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "gpt-4o")
REPEATS = int(os.environ.get("REPEATS", "5"))

SIMPLIFY_INSTRUCTION = (
    "Rewrite the clinical text below so a patient can understand it, "
    "without losing or altering any clinically important fact."
)


def load_cases():
    cases = {}
    for f in sorted(CASES_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue
        c = json.loads(f.read_text())
        cases[c["id"]] = c
    return cases


def flatten(ctx):
    return "\n".join(ctx) if isinstance(ctx, list) else str(ctx or "")


def main():
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required")

    from deepeval.metrics import FaithfulnessMetric
    from deepeval.models import GPTModel
    from deepeval.test_case import LLMTestCase

    # Give the judge's structured-output calls an explicit, generous ceiling.
    # DeepEval passes no max_tokens by default, so a completion that runs long
    # dies with LengthFinishReasonError — and at temperature 0 that is not a
    # transient fault: the same input regenerates the same over-long completion,
    # so retrying it just fails five times more slowly.
    judge = GPTModel(
        model=JUDGE_MODEL,
        temperature=0,
        generation_kwargs={"max_completion_tokens": 16384},
    )

    cases = load_cases()
    corpus = json.loads(CORPUS.read_text())
    items = corpus["items"]

    # Checkpoint after every repeat. A single slow API call used to kill the run
    # and discard every evaluation already paid for; now an interrupted run is
    # resumed rather than restarted. Note what this does NOT do: it never reuses
    # a score across repeats. Each repeat is a fresh set of judge calls, which is
    # the whole point of the experiment.
    ckpt = OUT.with_suffix(".partial.json")
    runs = []
    if ckpt.exists():
        saved = json.loads(ckpt.read_text())
        if saved.get("corpusSha256") == corpus["corpusSha256"]:
            runs = saved.get("runs", [])
            print(f"resuming from checkpoint: {len(runs)} repeat(s) already complete\n", flush=True)
        else:
            print("checkpoint is for a different corpus — ignoring it\n", flush=True)

    def measure_with_retry(metric, tc, label, attempts=5):
        """A timeout is a property of the network, not of the output being judged.
        Retry it; only a persistent failure is a real failure."""
        for attempt in range(1, attempts + 1):
            try:
                metric.measure(tc)
                return
            except Exception as err:  # noqa: BLE001 — deepeval wraps many error types
                # A length failure is deterministic at temperature 0: the same
                # input regenerates the same over-long completion. Retrying it
                # just fails more slowly, so say what it is and stop.
                if "LengthFinishReason" in repr(err):
                    raise RuntimeError(
                        f"{label}: the judge's completion hit the token ceiling. This is not "
                        "transient at temperature 0. Raise max_completion_tokens in the GPTModel "
                        "above, or switch JUDGE_MODEL (and re-run the RAGAS arm with the same "
                        "model, so the two judges stay comparable)."
                    ) from err
                if attempt == attempts:
                    raise
                wait = min(60, 5 * 2 ** (attempt - 1))
                print(f"    ! {label}: {type(err).__name__} — retry {attempt}/{attempts - 1} in {wait}s",
                      flush=True)
                time.sleep(wait)

    for r in range(len(runs), REPEATS):
        # A fresh metric per repeat: no cached verdicts leak between repeats.
        metric = FaithfulnessMetric(threshold=1.0, model=judge, include_reason=True)
        scores = []
        t0 = time.time()
        usd = 0.0

        for item in items:
            case = cases[item["caseId"]]
            if item["kind"] == "simplification":
                user_input, context = SIMPLIFY_INSTRUCTION, case["text"]
            else:
                user_input, context = case["question"], flatten(case["context"])

            tc = LLMTestCase(
                input=user_input,
                actual_output=item["text"],
                retrieval_context=[context],
            )
            measure_with_retry(metric, tc, item["outputId"])
            cost = getattr(metric, "evaluation_cost", None) or 0.0
            usd += float(cost)

            scores.append({
                "outputId": item["outputId"],
                "score": float(metric.score),
                # The judge's own account of the failure — compared against the
                # deterministic arm's named issues in the analysis.
                "reason": metric.reason,
            })
            print(f"  repeat {r + 1}  {item['outputId']:<44} {float(metric.score):.3f}", flush=True)

        runs.append({
            "repeat": r + 1,
            "scores": scores,
            "wallSeconds": round(time.time() - t0, 1),
            "usd": round(usd, 6),
        })
        ckpt.parent.mkdir(parents=True, exist_ok=True)
        ckpt.write_text(json.dumps({"corpusSha256": corpus["corpusSha256"], "runs": runs}, indent=2))
        print(f"repeat {r + 1} done — {runs[-1]['wallSeconds']}s, ${usd:.4f} (checkpointed)\n", flush=True)

    payload = {
        "arm": "deepeval-faithfulness",
        "judgeModel": JUDGE_MODEL,
        # Recorded in the artifact, not just in the code: the paper's "temperature 0"
        # claim must be checkable from the committed results alone.
        "judgeTemperature": 0.0,
        "flagThreshold": 1.0,
        "note": (
            "Second, independent judge implementation. Same frozen inputs, same 5 repeats. "
            "Per-verdict `reason` captured for the failure-localisation comparison."
        ),
        "ranAt": datetime.now(timezone.utc).isoformat(),
        "corpusSha256": corpus["corpusSha256"],
        "repeats": REPEATS,
        "cost": {
            "usd": round(sum(r["usd"] for r in runs), 6),
            "meanWallSecondsPerRepeat": round(sum(r["wallSeconds"] for r in runs) / len(runs), 1),
        },
        "runs": runs,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    ckpt.unlink(missing_ok=True)
    print(f"deepeval arm → {OUT}")
    print(f"  {len(items)} outputs × {REPEATS} repeats, ${payload['cost']['usd']:.4f}")


if __name__ == "__main__":
    main()
