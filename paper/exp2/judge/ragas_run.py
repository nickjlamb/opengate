#!/usr/bin/env python3
"""exp-2 — judge arm A: RAGAS faithfulness, 5 repeats over the frozen corpus.

Protocol notes that matter for the claim:

* The judge is run at temperature 0 — the *best case* for a judge's stability.
  Any score movement we observe is therefore a floor on judge variance, not an
  artefact of sampling temperature.
* Every repeat scores byte-identical inputs (paper/exp2/corpus/frozen-corpus.json).
  Nothing about the system under test changes between repeats; only the judge is
  re-invoked.
* RAGAS faithfulness asks: are the claims *asserted* by the answer supported by
  the context? It is, by construction, blind to omission — a dropped dose is not
  an unsupported claim. The analysis reports that as a coverage difference
  between the arms, not as a judge error.

Runs on a machine with an OpenAI key (the dev sandbox cannot reach the API):

    pip install -r paper/exp2/judge/requirements.txt
    OPENAI_API_KEY=sk-... python paper/exp2/judge/ragas_run.py

Env:
    OPENAI_API_KEY     required
    JUDGE_MODEL        default gpt-4o-mini
    JUDGE_TEMPERATURE  default 0
    REPEATS            default 5

Output: paper/exp2/results/ragas.json
"""

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
CASES_DIR = EXP.parent.parent / "datasets" / "cases"
CORPUS = EXP / "corpus" / "frozen-corpus.json"
OUT = EXP / "results" / "ragas.json"

# gpt-4o, not gpt-4o-mini — see ../INCIDENTS.md. Both judge arms must run the SAME
# model or their scores are not comparable; change this and change deepeval_run.py
# with it. The earlier gpt-4o-mini run is retained at results/ragas.gpt-4o-mini.json
# as a judge-model robustness comparison.
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "gpt-4o")
JUDGE_TEMPERATURE = float(os.environ.get("JUDGE_TEMPERATURE", "0"))
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


def sample_for(item, case):
    """The judge sees exactly what the system saw: the task, the source, the output."""
    if item["kind"] == "simplification":
        return {
            "user_input": SIMPLIFY_INSTRUCTION,
            "retrieved_contexts": [case["text"]],
            "response": item["text"],
        }
    return {
        "user_input": case["question"],
        "retrieved_contexts": [flatten(case["context"])],
        "response": item["text"],
    }


async def main():
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required")

    from langchain_openai import ChatOpenAI
    from ragas.dataset_schema import SingleTurnSample
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import Faithfulness

    try:
        from langchain_community.callbacks.manager import get_openai_callback
    except ImportError:  # cost accounting is best-effort
        get_openai_callback = None

    cases = load_cases()
    corpus = json.loads(CORPUS.read_text())
    items = corpus["items"]

    llm = LangchainLLMWrapper(ChatOpenAI(model=JUDGE_MODEL, temperature=JUDGE_TEMPERATURE))
    metric = Faithfulness(llm=llm)

    # Checkpoint after every repeat: this run takes ~25 minutes and a single
    # network blip used to discard all of it. Resumes; never reuses a score
    # across repeats.
    ckpt = OUT.with_suffix(".partial.json")
    runs = []
    if ckpt.exists():
        saved = json.loads(ckpt.read_text())
        if saved.get("corpusSha256") == corpus["corpusSha256"] and saved.get("judgeModel") == JUDGE_MODEL:
            runs = saved.get("runs", [])
            print(f"resuming from checkpoint: {len(runs)} repeat(s) already complete\n", flush=True)
        else:
            print("checkpoint is for a different corpus or judge model — ignoring it\n", flush=True)

    async def score_with_retry(sample, label, attempts=5):
        for attempt in range(1, attempts + 1):
            try:
                return await metric.single_turn_ascore(sample)
            except Exception as err:  # noqa: BLE001
                if "LengthFinishReason" in repr(err):
                    raise RuntimeError(
                        f"{label}: the judge's completion hit the token ceiling — not transient at "
                        "temperature 0. See ../INCIDENTS.md; switch JUDGE_MODEL (both arms)."
                    ) from err
                if attempt == attempts:
                    raise
                wait = min(60, 5 * 2 ** (attempt - 1))
                print(f"    ! {label}: {type(err).__name__} — retry {attempt}/{attempts - 1} in {wait}s",
                      flush=True)
                await asyncio.sleep(wait)

    for r in range(len(runs), REPEATS):
        scores = []
        t0 = time.time()
        tokens = {"prompt": 0, "completion": 0, "total": 0}
        usd = 0.0

        for item in items:
            s = sample_for(item, cases[item["caseId"]])
            sample = SingleTurnSample(**s)

            if get_openai_callback:
                with get_openai_callback() as cb:
                    score = await score_with_retry(sample, item["outputId"])
                tokens["prompt"] += cb.prompt_tokens
                tokens["completion"] += cb.completion_tokens
                tokens["total"] += cb.total_tokens
                usd += cb.total_cost
            else:
                score = await score_with_retry(sample, item["outputId"])

            scores.append({"outputId": item["outputId"], "score": float(score)})
            print(f"  repeat {r + 1}  {item['outputId']:<44} {float(score):.3f}", flush=True)

        runs.append({
            "repeat": r + 1,
            "scores": scores,
            "wallSeconds": round(time.time() - t0, 1),
            "tokens": tokens,
            "usd": round(usd, 6),
        })
        ckpt.parent.mkdir(parents=True, exist_ok=True)
        ckpt.write_text(json.dumps(
            {"corpusSha256": corpus["corpusSha256"], "judgeModel": JUDGE_MODEL, "runs": runs}, indent=2))
        print(f"repeat {r + 1} done — {runs[-1]['wallSeconds']}s, {tokens['total']} tokens, ${usd:.4f} (checkpointed)\n", flush=True)

    payload = {
        "arm": "ragas-faithfulness",
        "judgeModel": JUDGE_MODEL,
        "judgeTemperature": JUDGE_TEMPERATURE,
        "note": (
            "Judge run at temperature 0 over byte-identical inputs — the best case for "
            "stability. Faithfulness scores asserted claims only; omission is out of scope "
            "for this metric by construction."
        ),
        "ranAt": datetime.now(timezone.utc).isoformat(),
        "corpusSha256": corpus["corpusSha256"],
        "repeats": REPEATS,
        "cost": {
            "apiCalls": None,  # RAGAS issues several calls per sample internally
            "tokens": sum(r["tokens"]["total"] for r in runs),
            "usd": round(sum(r["usd"] for r in runs), 6),
            "meanWallSecondsPerRepeat": round(sum(r["wallSeconds"] for r in runs) / len(runs), 1),
        },
        "runs": runs,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    ckpt.unlink(missing_ok=True)
    print(f"ragas arm → {OUT}")
    print(f"  {len(items)} outputs × {REPEATS} repeats, "
          f"{payload['cost']['tokens']} tokens, ${payload['cost']['usd']:.4f}")


if __name__ == "__main__":
    asyncio.run(main())
