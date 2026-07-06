"""Parity tests — ported from tests/grounding-check.test.mjs in the JS package,
plus a few Python-specific ergonomics checks. Pure stdlib; run with either:

    python -m unittest discover -s tests
    pytest
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from opengate_grounding import (  # noqa: E402
    check_grounding,
    assert_grounded,
    numbers_in,
    contains,
    Anchor,
)

CTX = "Customers may request a full refund within 30 days. There is no restocking fee."


class GroundingParity(unittest.TestCase):
    # ── ported from grounding-check.test.mjs ──

    def test_correct_grounded_answer_is_grounded(self):
        r = check_grounding(
            "You have 30 days to request a refund, with no restocking fee.",
            CTX,
            anchors=[{"value": "30 days"}, {"value": "no restocking fee"}],
        )
        self.assertTrue(r.grounded, r.issues)
        self.assertEqual(r.issues, [])

    def test_missing_fact_is_reported(self):
        r = check_grounding(
            "You have 30 days to request a refund.",
            CTX,
            anchors=[{"value": "30 days"}, {"value": "no restocking fee"}],
        )
        self.assertFalse(r.grounded)
        self.assertEqual(r.anchors_missed, ["no restocking fee"])

    def test_fabricated_number_is_reported(self):
        r = check_grounding(
            "30 days, no restocking fee, plus a 90-day extension.",
            CTX,
            anchors=[{"value": "30 days"}, {"value": "no restocking fee"}],
        )
        self.assertFalse(r.grounded)
        self.assertEqual(r.ungrounded_numbers, ["90"])

    def test_context_numbers_not_flagged_aliases_satisfy_anchors(self):
        r = check_grounding(
            "Refund within 30-day window; no fee.",
            CTX,
            anchors=[
                {"value": "30 days", "aliases": ["30-day"]},
                {"value": "no restocking fee", "aliases": ["no fee"]},
            ],
        )
        self.assertTrue(r.grounded, r.issues)

    def test_unanswerable_abstaining_is_grounded_contraction_aware(self):
        r = check_grounding(
            "That isn't in the provided context — contact sales.",
            "Pro plan has a 30-day trial.",
            answerable=False,
        )
        self.assertTrue(r.grounded)
        self.assertTrue(r.abstained)

    def test_unanswerable_fabricating_instead_of_abstaining_fails(self):
        r = check_grounding(
            "The Enterprise plan is $499 per year.",
            "Pro plan has a 30-day trial.",
            answerable=False,
        )
        self.assertFalse(r.grounded)
        self.assertTrue(any("did not abstain" in i for i in r.issues))

    def test_context_may_be_a_list_of_passages(self):
        r = check_grounding(
            "30 days, no fee.",
            ["Refund within 30 days.", "There is no restocking fee."],
            anchors=[{"value": "30 days"}, {"value": "no fee"}],
        )
        self.assertTrue(r.grounded, r.issues)

    # ── Python ergonomics ──

    def test_string_and_anchor_object_forms(self):
        r = check_grounding(
            "You have 30 days, no restocking fee.",
            CTX,
            anchors=["30 days", Anchor("no restocking fee", ["no fee"])],
        )
        self.assertTrue(r.grounded, r.issues)

    def test_result_is_truthy_when_grounded(self):
        self.assertTrue(bool(check_grounding("30 days", CTX, anchors=["30 days"])))
        self.assertFalse(bool(check_grounding("nope", CTX, anchors=["30 days"])))

    def test_assert_grounded_raises_on_failure(self):
        with self.assertRaises(AssertionError):
            assert_grounded("no info here", CTX, anchors=["30 days"])
        # passes silently and returns the result
        res = assert_grounded("30 days", CTX, anchors=["30 days"])
        self.assertTrue(res.grounded)

    # ── helper behaviour ──

    def test_numbers_in_strips_leading_zeros_and_keeps_order(self):
        self.assertEqual(numbers_in("007 then 90 then 30 then 90"), ["7", "90", "30"])
        self.assertEqual(numbers_in("value 0.5 and 12.75"), ["0.5", "12.75"])

    def test_contains_is_whitespace_and_case_insensitive(self):
        self.assertTrue(contains("No  Restocking   Fee", "no restocking fee"))
        self.assertFalse(contains("anything", ""))

    def test_allowed_new_numbers_whitelist(self):
        r = check_grounding(
            "30 days, and a bonus 90-day extension.",
            CTX,
            anchors=["30 days"],
            allowed_new_numbers=[90],
        )
        self.assertTrue(r.grounded, r.issues)


if __name__ == "__main__":
    unittest.main(verbosity=2)
