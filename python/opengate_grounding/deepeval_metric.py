"""DeepEval custom metric wrapping OpenGATE's deterministic grounding check.

Drop ``GroundingMetric`` into a DeepEval evaluation to get a deterministic,
no-LLM-judge grounding score alongside DeepEval's model-graded metrics. It maps
a DeepEval ``LLMTestCase`` onto ``check_grounding``:

    actual_output    -> answer
    retrieval_context -> context   (falls back to `context` if unset)
    input            -> question

Per-case controls (anchors, answerable, allowed_new_numbers) may be passed on
the metric constructor as defaults, or per test case via
``LLMTestCase.additional_metadata``.

Install the optional dependency::

    pip install "opengate-grounding[deepeval]"

Usage::

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
"""

from __future__ import annotations

from typing import Iterable, Optional, Union

from .core import check_grounding, AnchorLike

try:
    from deepeval.metrics import BaseMetric
    from deepeval.test_case import LLMTestCase
except ImportError as exc:  # pragma: no cover - exercised only without deepeval
    raise ImportError(
        "GroundingMetric requires DeepEval. Install it with:\n"
        '    pip install "opengate-grounding[deepeval]"'
    ) from exc


class GroundingMetric(BaseMetric):
    """Deterministic grounding metric for DeepEval.

    The score is 1.0 when the answer is grounded, else 0.0; with the default
    ``threshold=1.0`` a case passes only if it is fully grounded. Because the
    check is pure logic, evaluation is instant, free, and reproducible — no
    grader model is called.
    """

    def __init__(
        self,
        threshold: float = 1.0,
        anchors: Optional[Iterable[AnchorLike]] = None,
        allowed_new_numbers: Optional[Iterable[Union[str, int, float]]] = None,
        answerable: bool = True,
        question: Optional[str] = None,
        include_reason: bool = True,
    ):
        self.threshold = threshold
        self.anchors = anchors
        self.allowed_new_numbers = allowed_new_numbers
        self.answerable = answerable
        self.question = question
        self.include_reason = include_reason
        # Deterministic: no grader model, no async work needed.
        self.async_mode = False
        self.evaluation_model = None
        self.score = 0.0
        self.success = False
        self.reason = None
        self.error = None

    def measure(self, test_case: "LLMTestCase") -> float:
        answer = getattr(test_case, "actual_output", None) or ""
        context = (
            getattr(test_case, "retrieval_context", None)
            or getattr(test_case, "context", None)
            or []
        )
        metadata = getattr(test_case, "additional_metadata", None) or {}

        question = self.question or getattr(test_case, "input", None)
        anchors = metadata.get("anchors", self.anchors)
        answerable = metadata.get("answerable", self.answerable)
        allowed = metadata.get("allowed_new_numbers", self.allowed_new_numbers)

        result = check_grounding(
            answer,
            context,
            question=question,
            anchors=anchors,
            allowed_new_numbers=allowed,
            answerable=answerable,
        )

        self.score = 1.0 if result.grounded else 0.0
        self.success = self.score >= self.threshold
        if self.include_reason:
            self.reason = (
                "Grounded: required facts present and every number traces to the context."
                if result.grounded
                else "Not grounded — " + "; ".join(result.issues)
            )
        return self.score

    async def a_measure(self, test_case: "LLMTestCase", *args, **kwargs) -> float:
        # Deterministic and synchronous; just defer to measure().
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return bool(self.success)

    @property
    def __name__(self):  # some DeepEval versions read the metric name from here
        return "OpenGATE Grounding"

    @property
    def name(self) -> str:
        return "OpenGATE Grounding"
