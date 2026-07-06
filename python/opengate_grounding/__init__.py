"""opengate-grounding — deterministic grounding check for evidence-grounded AI.

The Python port of OpenGATE's ``check_grounding``: is an answer actually
supported by the context it was given? Required facts present, every number
traceable to the source, and abstention when the context can't answer. No LLM
judge — pure, reproducible logic you can run on every answer or gate in CI.

Basic use::

    from opengate_grounding import check_grounding

    result = check_grounding(
        answer="You have 30 days to request a refund, with no restocking fee.",
        context="Customers may request a full refund within 30 days. There is no restocking fee.",
        anchors=["30 days", "no restocking fee"],
    )
    print(result.grounded)  # True

In tests::

    from opengate_grounding import assert_grounded

    assert_grounded(answer, context, anchors=["30 days"])
"""

from .core import (
    DEFAULT_ABSTAIN,
    Anchor,
    GroundingResult,
    check_grounding,
    contains,
    flatten_context,
    numbers_in,
)
from .pytest_helper import assert_grounded

__version__ = "0.1.0"

__all__ = [
    "DEFAULT_ABSTAIN",
    "Anchor",
    "GroundingResult",
    "check_grounding",
    "assert_grounded",
    "contains",
    "numbers_in",
    "flatten_context",
    "__version__",
]
