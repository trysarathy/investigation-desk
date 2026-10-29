#!/usr/bin/env python3
"""Build the Clearline white paper PDFs from Clearline_Whitepaper.md.

  python3 build.py            # clean copy, review copy and executive summary
Needs: pandoc 3, xelatex, the Inter font, mmdc (Mermaid CLI) and Playwright (for the hand-drawn SVGs).

Claim markers in the source:
  {{V}}       verified; the footnote that follows is the source
  {{V:path}}  product claim; proven by that file or test in the repo
  {{A}}       assumption (written as a hypothesis in the text)
  {{G}}       guess
The clean copy drops the markers; the review copy prints them as coloured labels.
"""
import re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
BUILD.mkdir(exist_ok=True)
SRC = HERE / "Clearline_Whitepaper.md"
MARK = re.compile(r"\{\{([VAG])(?::([^}]*))?\}\}")


def run(cmd):
    print("+", " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True, cwd=HERE)


def diagrams():
    d = HERE / "diagrams"
    for svg in d.glob("*.svg"):
        run(["node", d / "svg2pdf.mjs", svg, BUILD / f"{svg.stem}.pdf"])
    for mmd in d.glob("*.mmd"):
        run(["mmdc", "-q", "-i", mmd, "-o", BUILD / f"{mmd.stem}.pdf", "-c", d / "mermaid.json", "--pdfFit", "-b", "white"])


def references(md):
    """Print the footnote sources as a numbered list under Appendix C (they also stay as footnotes)."""
    notes = re.findall(r"^\[\^([\w-]+)\]: (.+)$", md, flags=re.M)
    lst = "\n".join(f"{i}. {text}" for i, (_, text) in enumerate(notes, 1))
    return md.replace("# Appendix C. References\n", "# Appendix C. References\n\n" + "PLACEHOLDER_REFS\n", 1).replace("PLACEHOLDER_REFS", lst)


def footnotes(md):
    """One footnote per source: the first citation prints it, later ones point back to the same number."""
    notes = dict(re.findall(r"^\[\^([\w-]+)\]: (.+)$", md, flags=re.M))
    md = re.sub(r"^\[\^([\w-]+)\]: .+\n?", "", md, flags=re.M)
    seen = set()
    def ref(m):
        k = m.group(1)
        if k in seen:
            return f"`\\footref{{fn-{k}}}`{{=latex}}"
        seen.add(k)
        return f"^[`\\label{{fn-{k}}}`{{=latex}}{notes[k]}]"
    return re.sub(r"\[\^([\w-]+)\]", ref, md)


def variant(md, review):
    def sub(m):
        if not review:
            return ""
        kind, path = m.group(1), m.group(2)
        if kind == "V":
            label = "VERIFIED" + (f": {path}" if path else "")
            label = label.replace("[", "\\[").replace("]", "\\]")
            return f" [{label}]{{.vtag}}"
        return " [ASSUMPTION]{.atag}" if kind == "A" else " [GUESS]{.gtag}"
    out = MARK.sub(sub, md)
    if review:
        out = out.replace(":::\n\n# 1. Abstract",
            "\n**Review copy.** Every important claim carries a label: "
            "[VERIFIED]{.vtag} with its source (a footnote, or the file or test in the repository that proves it), "
            "[ASSUMPTION]{.atag} for a hypothesis we have not yet tested, and [GUESS]{.gtag} for an estimate with no evidence behind it.\n"
            ":::\n\n# 1. Abstract", 1)
    return out


def pdf(md_text, out, subtitle, footer_note):
    tmp = BUILD / (out.stem + ".md")
    tmp.write_text(md_text)
    vars_tex = BUILD / (out.stem + "-vars.tex")
    vars_tex.write_text(f"\\newcommand{{\\CLsubtitle}}{{{subtitle}}}\n\\newcommand{{\\CLvariant}}{{{footer_note}}}\n")
    run(["pandoc", tmp, "-o", out, "--pdf-engine=xelatex", "--lua-filter", "filters.lua",
         "-H", vars_tex, "-H", "style.tex", "-V", "fontfamily=fontspec", "-V", "mainfont=Inter", "-V", "monofont=DejaVu Sans Mono", "-V", "fontsize=10pt",
         "-V", "geometry:a4paper,top=20mm,bottom=22mm,left=22mm,right=22mm", "-V", "colorlinks=true",
         "-V", "linkcolor=accent", "-V", "urlcolor=accent", 
         "--resource-path", str(HERE)])


def main():
    if "--no-diagrams" not in sys.argv:
        diagrams()
    md = footnotes(references(SRC.read_text()))
    sub = "From a stablecoin transfer to a settled invoice"
    pdf(variant(md, False), HERE / "Clearline_Whitepaper.pdf", sub, "")
    pdf(variant(md, True), HERE / "Clearline_Whitepaper_review.pdf", sub, " \\textperiodcentered{} REVIEW COPY: claims labelled")
    es = (HERE / "EXECUTIVE_SUMMARY.md")
    if es.exists():
        pdf(es.read_text(), HERE / "EXECUTIVE_SUMMARY.pdf", "Executive summary", "")


if __name__ == "__main__":
    main()
