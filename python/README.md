# opengate-grounding

**Deterministic grounding check for evidence-grounded AI — no LLM judge.**

Is an AI answer actually supported by the context it was given? `opengate-grounding`
answers that with pure, reproducible logic — the Python port of [OpenGATE](https://www.pharmatools.ai/opengate)'s
`check_grounding`. It catches the three grounding failures that matter in production:

- **Dropped facts** — the specific facts a correct answer must contain actually appear.
- **Fabricated numbers** — every figure in the answer traces back to the context or the question.
- **Failure to abstain** — when the context can't answer, the model must decline rather than invent.

Because it's deterministic (no grader model, no API key), it's free, instant, and safe to run on
*every* answer — inline in an agent or as a CI gate. It's the same check that powers the OpenGATE
evaluation framework and the [OpenGATE MCP server](https://github.com/nickjlamb/opengate/tree/main/mcp).

## Install

```bash
pip install opengate-grounding
```

No dependencies. Python 3.8+.

## Quick start

```python
from opengate_grounding import check_grounding

result = check_grounding(
    answer="You have 30 days to request a refund, with no restocking fee.",
    context="Customers may request a full refund within 30 days. There is no restocking fee.",
    anchors=["30 days", "no restocking fee"],
)

result.grounded            # True
result.issues              # []
```

A failing answer tells you exactly why:

```python
r = check_grounding(
    answer="30 days, no restocking fee, plus a 90-day extension.",
    context="Customers may request a full refund within 30 days. There is no restocking fee.",
    anchors=["30 days", "no restocking fee"],
)
r.grounded             # False
r.ungrounded_numbers   # ['90']
r.issues               # ['ungrounded number "90" — not in the provided context']
```

Unanswerable questions must abstain:

```python
r = check_grounding(
    answer="That isn't in the provided context — contact sales.",
    context="Pro plan has a 30-day trial.",
    answerable=False,
)
r.grounded    # True
r.abstained   # True
```

## Gate it in your tests

```python
from opengate_grounding import assert_grounded

def test_refund_answer():
    assert_grounded(
        answer=my_rag("How long is the refund window?"),
        context=retrieved_passages,
        anchors=["30 days", "no restocking fee"],
    )
```

On failure the assertion names the concrete issues, so a grounding regression shows up as a red build.

## Use it as a DeepEval metric

```bash
pip install "opengate-grounding[deepeval]"
```

```python
from deepeval import evaluate
from deepeval.test_case import LLMTestCase
from opengate_grounding.deepeval_metric import GroundingMetric

case = LLMTestCase(
    input="How long is the refund window?",
    actual_output="You have 30 days, with no restocking fee.",
    retrieval_context=["Refund within 30 days. No restocking fee."],
    additional_metadata={"anchors": ["30 days", "no restocking fee"]},
)

evaluate([case], [GroundingMetric()])
```

`GroundingMetric` maps `actual_output → answer`, `retrieval_context → context`, and `input → question`.
Per-case controls (`anchors`, `answerable`, `allowed_new_numbers`) go on `additional_metadata` or the
metric constructor. Score is `1.0` when grounded, `0.0` otherwise; with the default `threshold=1.0` a
case passes only when fully grounded. Pair it with DeepEval's model-graded metrics for breadth, and use
this one to gate the grounding.

## API

### `check_grounding(answer, context, *, question=None, anchors=None, allowed_new_numbers=None, answerable=True, abstain_markers=None) -> GroundingResult`

| Argument | Meaning |
|---|---|
| `answer` | The system's answer (string). |
| `context` | The retrieved context — a string or a list of passages. |
| `question` | Optional. Whitelists numbers that appear in the question. |
| `anchors` | Facts a correct answer must contain. Each may be a string, an `Anchor`, or a `{"value": ..., "aliases": [...]}` dict. |
| `allowed_new_numbers` | Numbers the answer is permitted to introduce (e.g. a computed total). |
| `answerable` | When `False`, the answer must abstain rather than answer. |
| `abstain_markers` | Phrases that count as a valid refusal (defaults to `DEFAULT_ABSTAIN`). |

**`GroundingResult`** — `grounded: bool`, `anchors_missed: list[str]`, `ungrounded_numbers: list[str]`,
`abstained: bool`, `issues: list[str]`. Truthy when `grounded` (so `if check_grounding(...):` works).

Also exported: `Anchor`, `contains`, `numbers_in`, `flatten_context`, `DEFAULT_ABSTAIN`.

## What it deliberately won't do

- **No LLM-as-judge.** Scores are deterministic checks — reproducible, free, and your judgment lives in
  the anchors you supply, not a grader model's.
- **No general "quality" score.** It measures grounding, not fluency or helpfulness.
- **It never sees your model.** It inspects the answer text you give it — no weights, no internals.

## License

MIT © PharmaTools.AI. Part of the [OpenGATE](https://github.com/nickjlamb/opengate) project.
