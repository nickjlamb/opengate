# StudyDiff — handoff brief (for a new session)

Paste this into a fresh chat to continue work on StudyDiff. The repo is the source of truth.

## What StudyDiff is

A contradiction explorer for bench scientists: give it two papers and it explains **why they reach different conclusions**, grounding every claim in the source text. Built for Anthropic's *Built with Claude: Life Sciences* hackathon, **Builder track**. Named user: a bench scientist deciding between conflicting papers before planning an experiment or writing a review.

The pitch: two well-run papers often disagree not because one is wrong, but because of a methodological difference buried in the methods. StudyDiff extracts each study's design, pinpoints the differences that most plausibly drive the disagreement, ranks them (primary driver / also differs / ruled out), suggests what evidence would resolve it — and **never asserts a fact it can't trace to a verbatim quote, and never picks a winner**.

## Where everything lives

- **Repo:** github.com/nickjlamb/studydiff (default branch `main`, public, MIT)
- **Local:** `/Users/NickLamb/StudyDiff`  (bash: `/sessions/<id>/mnt/StudyDiff/`)
- **Live app:** https://studydiff.pharmatools.ai (deployed on **Railway**, auto-deploys on push to `main`)
- **Embedded at:** pharmatools.ai/studydiff (Webflow code embed → full-bleed iframe; see `webflow-embed.html`)
- **Submission draft:** `/Users/NickLamb/opengate/studydiff-submission.md`

## Architecture (Node, ESM `.mjs`, zero build step)

Pipeline: **retrieve → extract → verify → compare → explain.**

- `src/ncbi.mjs` — PubMed/PMC client; full-text→abstract fallback with `sourceDepth` tagging; DOI→PMID resolution.
- `src/pdf.mjs` — pure-JS PDF text extraction (`unpdf`).
- `src/extract.mjs` — Claude **tool-use** extraction into a fixed study-card schema; every field carries a verbatim quote; retries + fail-loud; **no `temperature`** (deprecated on this model). Model default `claude-sonnet-5`.
- `src/grounding.mjs` — deterministic verification via **OpenGATE** `checkGrounding` (no LLM-as-judge).
- `src/compare.mjs` — divergence detection + driver ranking + `sharedDesign` (ruled-out).
- `src/gaps.mjs` — bounded "not reported by either".
- `src/resolve.mjs` — deterministic "what would resolve this?" items.
- `src/pipeline.mjs` — `buildResult()`: grounds FIRST, downgrades ungrounded fields to "not reported", THEN compares/synthesises. Returns `{question, cards, comparison, gaps, grounding, synthesis, resolve}`.
- `src/server.mjs` — HTTP server + streaming NDJSON API; modes `demo` (cached fixtures, free), `papers` (per-paper `{id}` or `{citation,text}`), plus legacy `pmid`/`paste`; rate limiting + daily live cap + LRU cache + security headers (CSP `frame-ancestors` allows pharmatools.ai) + `/api/extract-pdf`.
- `src/guard.mjs` — rate limiter, cache, security headers.
- `public/index.html` — single-file dashboard UI (all HTML/CSS/JS inline).
- `src/cli.mjs`, `src/demo.mjs`, `src/render.mjs` — CLI + offline demos.
- `fixtures/` — `mouse-inflammation.json`, `resveratrol-sirt1.json` (real abstracts + example cards; every quote is an exact substring so grounding passes).

## Invariants (do not break)

1. Grounding is **deterministic** (OpenGATE), never an LLM judge.
2. **Ground before compare** — ungrounded fields become "not reported" before they can be cited.
3. **"not reported", never guessed** — extraction must not infer beyond the text.
4. Gaps stay **bounded** to the compared papers ("none of these…"), never "no one has ever…".
5. **No fabricated numbers** — no confidence bars / percentages / applicability scores that aren't computed from real signals. (Repeatedly requested by ChatGPT/Gemini; always declined. Honesty is the brand.)
6. Plain ESM, minimal deps (`@pharmatools/opengate`, `unpdf`).

## Features shipped

Inputs per paper (mixable A/B): **Upload PDF (default)**, PMID/DOI, Paste; plus two cached example pairs (free, no key). Results: verdict banner → "Why these studies differ" (grounded synthesis) → "What's driving the difference" (primary/also/ruled out) → verification → collapsible full comparison (each field + verbatim quote + ✓) → "not reported". Two-column **shell**: main answer + persistent sticky **right rail** (contextual: trust points before a run; Sources / How-this-was-produced / Verification / Explore-further / **Export** after). Export = **Markdown / PDF (print view) / Copy**, each value with its source sentence. 5-step tracker animates live. Two-card teal+purple logo. Hackathon footer + README badge.

## Environment gotchas (important)

- **Git must run on Nick's Mac**, not the sandbox — the sandbox can't manage `.git` locks on the mounted folder. Assistant edits files; Nick commits/pushes. Give copy-paste git commands.
- **Sandbox can't reach NCBI or api.anthropic.com** (egress proxy) — verify live behaviour via prod + the Chrome tools, not sandbox curl. Offline demos (`npm run demo`) work in-sandbox and are the CI smoke test.
- **Screenshots can't be saved to disk** from the browser tools — for `docs/hero.png`, Nick must supply the PNG (upload in chat or save to repo).
- Live extraction needs `ANTHROPIC_API_KEY` in `~/StudyDiff/.env` (gitignored). Also `NCBI_EMAIL=nick@pharmatools.ai`. `NCBI_API_KEY` optional.
- Railway: `npm start` runs the server; don't set `PORT` (injected). Secrets in Railway Variables.

## Submission status

Draft ready in `studydiff-submission.md` (Team=PharmaTools.AI placeholder; Project=StudyDiff; Track=Builder; description ~215 words; "How did you use Claude"; honest Claude Science feedback; links = repo + live). **Outstanding: team members, and the 3-minute demo video.** Judging weights: Demo 30 / Impact 25 / Claude Use 25 / Depth 20. Deadline: Mon Jul 13, 9pm ET.

## Outstanding / next steps

- **Demo video script** (planned for Friday) — 3 min, mapped to the mouse-models example: paste example → the answer → the "same data, opposite conclusions → primary driver = gene selection" beat → grounding/"verified" moment → what-would-resolve → export the report.
- **`docs/hero.png`** — README hero slot is wired; Nick to drop in a results-view screenshot.
- **Keyword search + results picker** — the one deferred input method (type "resveratrol SIRT1" → choose from a list). `ncbi.search()` exists; needs a picker UI + endpoint.
- Optional: a third curated example pair (e.g. cardiac c-kit: Beltrami 2003 vs Maliken/Molkentin 2018), mobile pass, accessibility touches.

## Working style

Nick iterates fast, often relaying ChatGPT/Gemini feedback for a second opinion — evaluate honestly, action the good, and **push back on anything that fabricates certainty or overclaims** (that discipline is the product's whole edge). Keep the app product-first (it's also a pharmatools.ai portfolio piece). After each change, hand Nick a ready `git add/commit/push` command and verify on prod via the Chrome tools.
