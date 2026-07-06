# @pharmatools/opengate-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent **check whether its own answers are grounded** in the context it was given — before returning them.

It exposes one tool, `check_grounding`, backed by [OpenGATE](https://www.pharmatools.ai/opengate)'s deterministic grounding check. No LLM-as-judge: the verdict is reproducible and gold-anchored.

## Why

An agent doing RAG or document QA can hallucinate a figure, drop a required fact, or answer confidently when the context doesn't actually contain the answer. `check_grounding` catches all three, deterministically:

- **Required facts** you name must appear in the answer.
- **Every number** in the answer must trace to the context (or the question).
- **Unanswerable questions** must be declined, not fabricated.

## Add it to your MCP client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opengate": {
      "command": "npx",
      "args": ["-y", "@pharmatools/opengate-mcp"]
    }
  }
}
```

Then, in a conversation, the agent can self-check:

> Before you answer, use `check_grounding` with your draft answer and the retrieved passages.

## The tool

`check_grounding`

| Argument | Type | Meaning |
|---|---|---|
| `answer` | string | The answer to check. |
| `context` | string \| string[] | The retrieved context it must be grounded in. |
| `question` | string (optional) | The original question (lets its numbers count as grounded). |
| `expected_facts` | string[] (optional) | Facts a correct answer must contain. |
| `allowed_new_numbers` | string[] (optional) | Numbers the answer may introduce that aren't in the context. |
| `must_abstain` | boolean (optional) | Set true when the context can't answer — the answer must then decline. |

Returns a `GROUNDED` / `NOT GROUNDED` verdict with named issues, plus structured output (`grounded`, `issues`, `anchorsMissed`, `ungroundedNumbers`, `abstained`).

## Privacy

Runs entirely on your machine. `check_grounding` is a deterministic, local text
comparison — the answer and context you pass are processed in memory and never
transmitted or stored. No accounts, no analytics, no external network calls, no
third-party model. Full policy: https://www.pharmatools.ai/privacy

## Related

- OpenGATE (the framework): https://github.com/nickjlamb/opengate
- Evaluate a whole gold set in CI: [Getting Started](https://github.com/nickjlamb/opengate/blob/main/docs/GETTING-STARTED.md)

MIT licensed.
