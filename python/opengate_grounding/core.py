"""Pure grounding check — the Python port of OpenGATE's shared grounding core.

Given an answer, the context it should be grounded in, and (optionally) the
facts a correct answer must contain, it reports whether the answer is grounded:
are the required facts present, is every number traceable to the context, and —
for unanswerable questions — did the system abstain?

Deterministic, no LLM judge. This mirrors ``src/lib/grounding-check.mjs`` in the
JavaScript package line-for-line so the two stay in lockstep.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence, Union

__all__ = [
    "DEFAULT_ABSTAIN",
    "Anchor",
    "GroundingResult",
    "check_grounding",
    "contains",
    "numbers_in",
    "flatten_context",
]

DEFAULT_ABSTAIN: List[str] = [
    "not in the provided context", "not in the context", "no information",
    "don't know", "do not know", "cannot answer", "can't answer",
    "unable to answer", "not enough information", "not stated", "not mentioned",
    "no answer", "not available", "insufficient information",
]


def _norm(s: object) -> str:
    """Lower-case and collapse whitespace runs to a single space."""
    return re.sub(r"\s+", " ", str(s).lower())


def _norm_neg(s: object) -> str:
    """Expand negating contractions so "isn't in the context" matches a marker
    phrased with "not" — abstention phrasing varies."""
    return re.sub(r"\s+", " ", re.sub(r"n['’]t\b", " not", _norm(s)))


def flatten_context(v: Union[str, Sequence[str], None]) -> str:
    """Context may be a string or a sequence of passages."""
    if isinstance(v, (list, tuple)):
        return "\n".join(str(x) for x in v)
    return str(v if v is not None else "")


def contains(haystack: object, needle: object) -> bool:
    """Whitespace-tolerant, case-insensitive containment."""
    h = re.sub(r"\s", "", _norm(haystack))
    n = re.sub(r"\s", "", _norm(needle))
    return len(n) > 0 and n in h


_NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def numbers_in(s: object) -> List[str]:
    """Every number in ``s``, unique and in order of first appearance, with
    insignificant leading zeros stripped ("007" -> "7", "0.5" unchanged)."""
    seen: List[str] = []
    for raw in _NUM_RE.findall(str(s)):
        v = re.sub(r"^0+(?=\d)", "", raw)
        if v not in seen:
            seen.append(v)
    return seen


@dataclass
class Anchor:
    """A fact a correct answer must contain, plus optional accepted phrasings."""
    value: str
    aliases: List[str] = field(default_factory=list)


@dataclass
class GroundingResult:
    grounded: bool
    anchors_missed: List[str]
    ungrounded_numbers: List[str]
    abstained: bool
    issues: List[str]

    def __bool__(self) -> bool:  # so `if check_grounding(...):` reads naturally
        return self.grounded


AnchorLike = Union[Anchor, dict, str]


def _normalize_anchors(anchors: Optional[Iterable[AnchorLike]]) -> List[Anchor]:
    out: List[Anchor] = []
    for a in (anchors or []):
        if isinstance(a, Anchor):
            out.append(Anchor(str(a.value), [str(x) for x in a.aliases]))
        elif isinstance(a, dict):
            out.append(Anchor(str(a["value"]), [str(x) for x in a.get("aliases", [])]))
        elif isinstance(a, str):
            out.append(Anchor(a, []))
        else:
            raise TypeError(
                f"anchor must be an Anchor, dict with 'value', or str; got {type(a).__name__}"
            )
    return out


def check_grounding(
    answer: object,
    context: Union[str, Sequence[str], None],
    *,
    question: Optional[str] = None,
    anchors: Optional[Iterable[AnchorLike]] = None,
    allowed_new_numbers: Optional[Iterable[Union[str, int, float]]] = None,
    answerable: bool = True,
    abstain_markers: Optional[Sequence[str]] = None,
) -> GroundingResult:
    """Check whether ``answer`` is grounded in ``context``.

    Args:
        answer: the system's answer.
        context: the retrieved context (a string or a list of passages).
        question: optional; whitelists numbers that appear in the question.
        anchors: facts a correct answer must contain. Each may be an ``Anchor``,
            a ``{"value": ..., "aliases": [...]}`` dict, or a plain string.
        allowed_new_numbers: numbers the answer is permitted to introduce.
        answerable: when ``False``, the answer must abstain rather than answer.
        abstain_markers: phrases that count as a valid refusal (defaults to
            ``DEFAULT_ABSTAIN``).

    Returns:
        A ``GroundingResult`` with ``grounded``, ``anchors_missed``,
        ``ungrounded_numbers``, ``abstained`` and human-readable ``issues``.
    """
    answer_s = str(answer if answer is not None else "")
    ctx = flatten_context(context)
    anchor_objs = _normalize_anchors(anchors)
    issues: List[str] = []

    if answerable is False:
        markers = abstain_markers if abstain_markers is not None else DEFAULT_ABSTAIN
        out_neg = _norm_neg(answer_s)
        abstained = any(_norm_neg(m) in out_neg for m in markers)
        if not abstained:
            issues.append(
                "unanswerable question — the answer did not abstain (risk of fabrication)"
            )
        return GroundingResult(
            grounded=len(issues) == 0,
            anchors_missed=[],
            ungrounded_numbers=[],
            abstained=abstained,
            issues=issues,
        )

    anchors_missed = [
        a.value
        for a in anchor_objs
        if not any(contains(answer_s, v) for v in [a.value, *a.aliases])
    ]
    for v in anchors_missed:
        issues.append(f'missing answer fact "{v}"')

    legit = set(numbers_in(ctx))
    legit.update(numbers_in(question or ""))
    for a in anchor_objs:
        legit.update(numbers_in(a.value))
        for x in a.aliases:
            legit.update(numbers_in(x))
    legit.update(str(n) for n in (allowed_new_numbers or []))

    ungrounded_numbers = [n for n in numbers_in(answer_s) if n not in legit]
    for n in ungrounded_numbers:
        issues.append(f'ungrounded number "{n}" — not in the provided context')

    return GroundingResult(
        grounded=len(issues) == 0,
        anchors_missed=anchors_missed,
        ungrounded_numbers=ungrounded_numbers,
        abstained=False,
        issues=issues,
    )
