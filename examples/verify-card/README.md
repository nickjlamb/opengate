# Verification card (prototype)

A self-contained HTML rendering of **one answer being verified** — the answer
text with the checks painted onto it: matched required facts highlighted,
ungrounded numbers flagged in place, named failures under each check, and the
context panel showing where the answer's facts live in the evidence.

This is the per-answer complement to `opengate report` (which is metric-level,
for CI). Same conventions: one self-contained HTML file, inline CSS, no
scripts, no network, deterministic.

## Try it

```bash
node demo.mjs   # writes verified.html, not-verified.html, abstained.html
```

## Status

Prototype. `verify-card.mjs` currently inlines a port of the grounding check
so it runs standalone; to integrate, delete that section and import from
`../../src/lib/grounding-check.mjs`, then expose it as `opengate verify-card`
(or a `--card` flag) and from the MCP server's `check_grounding` response.

Two design notes:

- **Span-painting is rendering only.** The verdict comes from the grounding
  check; highlight location uses a whitespace-flexible regex and, if a span
  can't be located in the original text, the check still counts — it just
  isn't highlighted.
- **Binary verdicts, deliberately.** No confidence gradients or heatmap
  colour scales — OpenGATE doesn't have confidence scores, and the card
  shouldn't imply them.
