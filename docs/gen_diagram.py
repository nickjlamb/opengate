"""Generate docs/architecture-{light,dark}.svg for the README.

Hand-tuned layout; run from the repo root after editing:
    python docs/gen_diagram.py
"""

import os

FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"

THEMES = {
    "light": dict(
        text="#1f2328", muted="#59636e", border="#d0d7de", panel="#f6f8fa",
        node="#ffffff", accent="#8250df", accent_soft="#fbf0ff",
        red="#cf222e", red_fill="#ffebe9", red_border="#ffc1bc",
        green="#1a7f37", green_fill="#dafbe1", green_border="#aceebb",
        edge="#8c959f",
    ),
    "dark": dict(
        text="#e6edf3", muted="#9198a1", border="#3d444d", panel="#151b23",
        node="#212830", accent="#ab7df8", accent_soft="#2a2139",
        red="#f85149", red_fill="#3c1618", red_border="#6e2a2c",
        green="#3fb950", green_fill="#122117", green_border="#2b5233",
        edge="#767d86",
    ),
}

W, H = 960, 468


def build(c: dict) -> str:
    s = []
    s.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'font-family="{FONT}" role="img" '
        'aria-label="OpenGATE architecture: systems under test connect through a '
        'one-file adapter to the deterministic core — gold datasets and system answers '
        'feed pure-logic scorers, which produce versioned scorecards; a regression '
        'gate compares each scorecard to the baseline on every commit — improved or '
        'held deploys, regressed fails the build.">'
    )
    s.append(
        '<defs>'
        f'<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        f'markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c["edge"]}"/></marker>'
        f'<marker id="arr-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        f'markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c["red"]}"/></marker>'
        f'<marker id="arr-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        f'markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c["green"]}"/></marker>'
        '</defs>'
    )

    def panel(x, y, w, h, title):
        s.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
            f'fill="{c["panel"]}" stroke="{c["border"]}"/>'
        )
        s.append(
            f'<text x="{x + 18}" y="{y + 26}" font-size="11" font-weight="600" '
            f'letter-spacing="1.5" fill="{c["muted"]}">{title}</text>'
        )

    def node(cx, y, w, h, title, sub=None, fill=None, stroke=None, tcol=None, dash=False):
        fill = fill or c["node"]
        stroke = stroke or c["border"]
        tcol = tcol or c["text"]
        x = cx - w / 2
        extra = ' stroke-dasharray="5 4"' if dash else ""
        s.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" '
            f'fill="{fill}" stroke="{stroke}"{extra}/>'
        )
        if sub:
            s.append(
                f'<text x="{cx}" y="{y + 22}" font-size="13" font-weight="600" '
                f'text-anchor="middle" fill="{tcol}">{title}</text>'
            )
            s.append(
                f'<text x="{cx}" y="{y + 40}" font-size="11" '
                f'text-anchor="middle" fill="{c["muted"]}">{sub}</text>'
            )
        else:
            s.append(
                f'<text x="{cx}" y="{y + h / 2 + 4.5}" font-size="13" font-weight="600" '
                f'text-anchor="middle" fill="{tcol}">{title}</text>'
            )

    def elbow(points, marker="arr", color=None):
        color = color or c["edge"]
        pts = " ".join(f"{x},{y}" for x, y in points)
        s.append(
            f'<polyline points="{pts}" fill="none" stroke="{color}" '
            f'stroke-width="1.5" marker-end="url(#{marker})"/>'
        )

    # ---------------- systems under test ----------------
    panel(16, 52, 230, 396, "SYSTEMS UNDER TEST")
    scx = 131
    suts = [
        (100, "RefCheckr", "QA &#183; citations"),
        (170, "Redacta", "redaction"),
        (240, "Patiently AI", "simplification"),
        (310, "PubCrawl", "retrieval"),
    ]
    for y, title, sub in suts:
        node(scx, y, 190, 48, title, sub)
    node(scx, 380, 190, 48, "Your system", "one adapter file", dash=True)

    # trunk -> adapter chip
    s.append(
        f'<polyline points="226,124 244,124 244,404 226,404" fill="none" '
        f'stroke="{c["edge"]}" stroke-width="1.5"/>'
    )
    for y, _, _ in suts[1:]:
        s.append(
            f'<line x1="226" y1="{y + 24}" x2="244" y2="{y + 24}" '
            f'stroke="{c["edge"]}" stroke-width="1.5"/>'
        )
    elbow([(244, 264), (253, 264)])
    node(291, 240, 76, 48, "adapter", dash=True)
    s.append(
        f'<text x="291" y="304" font-size="11" text-anchor="middle" '
        f'fill="{c["muted"]}">answers</text>'
    )
    elbow([(329, 264), (348, 264), (348, 208), (364, 208)])

    # ---------------- core ----------------
    panel(336, 52, 330, 396, "OPENGATE CORE &#183; NO LLM JUDGE")
    ccx = 501
    node(ccx, 92, 270, 52, "Gold datasets", "hand-labelled expected outcomes")
    elbow([(ccx, 144), (ccx, 178)])
    s.append(
        f'<text x="{ccx + 10}" y="{165}" font-size="11" fill="{c["muted"]}">expected</text>'
    )
    node(ccx, 180, 270, 56, "Deterministic scorers",
         "pure logic &#183; one per metric family",
         fill=c["accent_soft"], stroke=c["accent"], tcol=c["accent"])
    elbow([(ccx, 236), (ccx, 270)])
    node(ccx, 272, 270, 52, "Scorecards", "versioned JSON + HTML")
    s.append(
        '<text x="354" y="430" font-size="11" font-style="italic" '
        f'fill="{c["muted"]}">reproducible &#183; free &#183; fast enough for every answer</text>'
    )

    # scorecards -> gate
    elbow([(636, 298), (672, 298), (672, 148), (718, 148)])

    # ---------------- the gate ----------------
    panel(696, 52, 248, 396, "THE GATE &#183; EVERY COMMIT")
    gcx = 820
    node(gcx, 120, 200, 56, "Regression gate", "this scorecard vs baseline")
    # green branch
    elbow([(768, 176), (768, 250)], marker="arr-green", color=c["green"])
    s.append(
        f'<text x="758" y="216" font-size="11" font-weight="600" fill="{c["green"]}" '
        f'text-anchor="end">improved / held</text>'
    )
    node(775, 254, 140, 44, "Deploy",
         fill=c["green_fill"], stroke=c["green_border"], tcol=c["green"])
    # red branch
    elbow([(872, 176), (872, 340)], marker="arr-red", color=c["red"])
    s.append(
        f'<text x="882" y="216" font-size="11" font-weight="600" fill="{c["red"]}" '
        f'text-anchor="start">regressed</text>'
    )
    node(845, 344, 160, 48, "Build fails", "investigate the diff",
         fill=c["red_fill"], stroke=c["red_border"], tcol=c["red"])

    s.append("</svg>")
    return "\n".join(s)


os.makedirs("docs", exist_ok=True)
for name, palette in THEMES.items():
    path = f"docs/architecture-{name}.svg"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(build(palette))
    print("wrote", path)
