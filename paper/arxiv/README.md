# arXiv preprint — build and submit

```bash
cd paper/arxiv
latexmk -pdf main.tex     # → main.pdf (12 pages, A4)
latexmk -c                # clean intermediates
```

Sources: `main.tex`, `refs.bib`. Everything else in this directory is a build artifact
(gitignored) except `main.pdf`, which is committed so the exact submitted version is in the history.

## Submitting to arXiv

Primary category **cs.SE** (software engineering); cross-list **cs.CL** and **cs.AI** are both
defensible given the judge comparison.

arXiv prefers LaTeX source over a bare PDF — it lets them regenerate and it renders on the abstract
page. Upload:

- `main.tex`
- `refs.bib` **and** `main.bbl` (arXiv does not run BibTeX; it needs the `.bbl`, which
  `latexmk -pdf` produces. Do not run `latexmk -c` before you grab it.)

No other files are required — the figure is TikZ, so there are no image dependencies.

## Every citation was verified

`refs.bib` was checked entry by entry against primary sources (ACL Anthology, NeurIPS proceedings,
IEEE DOIs, and the project's own `CITATION.cff`). Two things worth knowing, because they bite anyone
who copies from the obvious place:

- **The ACL Anthology's own BibTeX export for FActScore drops "Wei" from Pang Wei Koh.** Corrected
  here against the arXiv page and the PDF.
- **DeepEval has no peer-reviewed paper.** It is cited as software, per its `CITATION.cff`
  (Ip & Vongthongsri). Inventing a paper for it — or citing "Confident AI" as a corporate author —
  would have been a fabricated citation.

## Before a CAIN submission (double-anonymous)

This is the **named preprint** version. For the conference:

1. Swap `article` for the IEEE conference class (10 pages + 2 for references).
2. Remove the author block and the Acknowledgments section.
3. Replace the repository URL in §8 with an anonymous artifact link
   (e.g. anonymous.4open.science).
4. Put self-citations in the third person.
5. Expect the page limit to bite: §6.1 and the ledger table are the parts to compress, not the
   limitations.

## What must stay true

Every number in §6 and §6.1 is generated from committed artifacts:

```bash
node paper/exp2/score-deterministic.mjs && node paper/exp2/analyse.mjs   # → paper/exp2/RESULTS.md
```

If those numbers ever change, the paper is wrong until it is regenerated. There is no manual
transcription step, and there should never be one.
