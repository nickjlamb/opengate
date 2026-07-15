# Depositing on Zenodo

Two separate deposits, two DOIs. They are not the same thing and should not be merged:

| deposit | type | what it is |
|---|---|---|
| **the preprint** | Publication → Preprint | `main.pdf` (and the LaTeX source) |
| **the artifact** | Software | the repository at the version the paper describes |

The paper's central claim is that every number in it is reproducible from the committed repo. A
preprint DOI that points at a moving `main` branch does not honour that. An archived snapshot does.

---

## 1. The artifact (do this first)

Zenodo's GitHub integration mints a DOI per release, so the paper can cite an immutable snapshot.

1. Zenodo → **Log in with GitHub** → **GitHub** tab → flip the switch on `nickjlamb/opengate`.
2. In GitHub, cut a release: tag `v0.9.0`, title "OpenGATE v0.9.0 — paper artifact".
3. Zenodo picks it up automatically and mints a DOI. Metadata comes from the committed
   `.zenodo.json`, so it will be right without hand-editing.
4. Zenodo also issues a **concept DOI** that always resolves to the newest version. Cite the
   *version* DOI in the paper (it is the one that matches the numbers), not the concept DOI.

Then put the DOI into §8 of the paper and into `CITATION.cff`.

## 2. The preprint

Zenodo → **New upload**:

- **Files:** `main.pdf`. Optionally `main.tex` + `refs.bib` (the source is small; including it costs
  nothing and helps anyone who wants to reuse a table).
- **Resource type:** Publication → **Preprint**
- **Title:** Evaluation as Infrastructure: Deterministic Regression Gating for Evidence-Grounded AI
  Systems in Production
- **Author:** Lamb, Nick — PharmaTools.AI (add your ORCID; it is what makes the record findable)
- **Description:** paste the abstract
- **License:** **CC BY 4.0** — same choice as for arXiv, and consistent with the MIT artifact
- **Keywords:** AI engineering; evaluation; regression testing; retrieval-augmented generation;
  grounding; hallucination; LLM-as-judge; continuous integration; medical AI
- **Related identifiers:**
  - `isSupplementedBy` → the artifact DOI from step 1
  - `isSupplementTo` → `https://github.com/nickjlamb/opengate`

## 3. This does not close the arXiv door

arXiv accepts work already posted elsewhere. When an endorsement comes through, submit the same
paper and note the Zenodo DOI in the submission comments. The Zenodo DOI keeps the priority date you
established today, which is the part you cannot recover later.

Do not chase the endorsement by watering down where you submit. cs.SE is where this paper's readers
are; Zenodo is how it exists in the meantime.

## 4. After you have the DOIs

Update, in this order:

1. `CITATION.cff` — add `doi:` and `preferred-citation:` for the preprint
2. §8 (Availability) in `main.tex` — cite the archived artifact DOI, not just the repo URL
3. `README.md` — add the DOI badge Zenodo gives you
4. Rebuild the PDF and re-upload it as a **new version** of the Zenodo preprint record (Zenodo
   versions cleanly; the concept DOI follows the newest one)
