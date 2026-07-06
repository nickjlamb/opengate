"""Test-suite helper for gating grounding in CI.

``assert_grounded`` runs the deterministic check and fails the test with the
concrete issues (missing facts, fabricated numbers, failure to abstain) when the
answer isn't grounded — so a regression shows up as a red build, not a silent
quality drift. Works with pytest, unittest, or a bare ``python -m`` script.
"""

from __future__ import annotations

from typing import Union, Sequence, Optional, Iterable

from .core import check_grounding, GroundingResult, AnchorLike


def assert_grounded(
    answer: object,
    context: Union[str, Sequence[str], None],
    *,
    question: Optional[str] = None,
    anchors: Optional[Iterable[AnchorLike]] = None,
    allowed_new_numbers: Optional[Iterable[Union[str, int, float]]] = None,
    answerable: bool = True,
    abstain_markers: Optional[Sequence[str]] = None,
) -> GroundingResult:
    """Assert an answer is grounded; raise ``AssertionError`` with the issues if not.

    Returns the ``GroundingResult`` on success so callers can make further
    assertions (e.g. on ``abstained``).
    """
    result = check_grounding(
        answer,
        context,
        question=question,
        anchors=anchors,
        allowed_new_numbers=allowed_new_numbers,
        answerable=answerable,
        abstain_markers=abstain_markers,
    )
    if not result.grounded:
        detail = "\n  - ".join(result.issues)
        raise AssertionError("OpenGATE grounding check failed:\n  - " + detail)
    return result
