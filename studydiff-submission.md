# StudyDiff — Hackathon Submission Draft

**Team Name:** PharmaTools.AI  _(or "Nick Lamb" — your call)_

**Team Members:** Nick Lamb

**Project Name:** StudyDiff

**Track:** Builder

**Link to your work:**
- Repo: https://github.com/nickjlamb/studydiff
- Live app: https://studydiff.pharmatools.ai

**Demo Video:** _(to record — max 3 min)_

---

## Project description

StudyDiff answers a question every scientist hits: two well-run papers reach opposite conclusions — which do I trust, and why? Usually the answer isn't that one is wrong, but a methodological difference (a cell type, a dose, an analysis choice) buried in the methods sections. StudyDiff finds it.

Give it two papers — by PMID, DOI, PDF upload, or pasted text — and it extracts each study's design into a structured card, pinpoints the differences that most plausibly drive the disagreement, ranks them (primary driver / also differs / ruled out), and suggests what evidence would resolve the conflict.

What makes it different is verification. Every extracted value and every explanation is checked against the source text by a deterministic grounding step — no second LLM acting as judge. Grounding runs *before* comparison, so any claim the source can't support is downgraded to "not reported" rather than shown. StudyDiff never asserts a fact it can't trace to a verbatim quote, and never picks a "winner."

It's built for a bench scientist deciding between conflicting papers before planning an experiment or writing a review. It's live, open-source (MIT), and ships with two real worked examples — including two PNAS papers that analysed the *same data* yet reached opposite conclusions about mouse models of human inflammation, where StudyDiff isolates the single driver: the gene-selection strategy.

## How did you use Claude?

The entire application was built with **Claude Code** (via Cowork) in one agentic workflow: architecture, the retrieval → extraction → grounding → comparison pipeline, the dashboard UI, production hardening (rate limiting, caching, security headers), and deployment to Railway — including debugging real issues along the way (a Node Buffer/pdf.js extraction bug; an intermittent empty-extraction failure fixed by switching to Claude tool-use).

At runtime, StudyDiff uses the **Claude API (Sonnet) via tool-use** to extract each paper's study design into a strict schema where every field must carry a verbatim supporting quote and default to "not reported" when unsupported. This is where Claude mattered most: the tool-use contract makes extraction reliable and auditable, and — paired with our deterministic grounding gate — lets Claude's output be *trusted* without a second model judging it. Holding the whole system (retrieval, prompt design, UI, deploy) in a single Claude Code loop is what let a solo builder ship a polished, deployed product within the hackathon window.

## Thoughts / feedback on building with Claude Science

We built with Claude Code and the Claude API rather than Claude Science specifically, so this is feedback on building a trustworthy life-sciences tool with Claude in general. Tool-use is excellent for forcing structured, auditable outputs; pairing it with a deterministic grounding check proved a powerful pattern for scientific AI, and first-class primitives for "ground this answer in this source / abstain when it can't" would be hugely valuable. On the data side, more of the literature being reachable as full text would help — much isn't in the PMC open-access subset, so we fall back to abstracts and PDF upload. Claude Code made the end-to-end build remarkably fast.
