"""Export the simulated provider funding desk as a static site (works from file:// or any static host).

    python3 tools/export_site.py <outdir>

Breadth-first walk of every state reachable from each case's start, following only enabled actions.
Writes states/lc-<case>-<stateid>.js (document.currentScript.deliver({...})), lc-meta.js, the provider desk
(index.html + lifecycle.js + CSS) and the existing importer replay tester under replay/.
Fails loudly if any case exceeds the state cap or any exported state breaks an invariant.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from engine import lifecycle  # noqa: E402

STATE_CAP = lifecycle.STATE_CAP  # per case; the walk raises above this


def _js(view):
    return "document.currentScript.deliver(" + json.dumps(view, ensure_ascii=True, separators=(",", ":")) + ");"


def source_build_id():
    """Short source commit of this checkout, with -dirty if tracked files differ from it."""
    try:
        sha = subprocess.check_output(["git", "-C", str(root), "rev-parse", "--short=7", "HEAD"], text=True).strip()
        dirty = subprocess.call(["git", "-C", str(root), "diff", "--quiet", "HEAD", "--", "."]) != 0
        return sha + ("-dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _stamp(html, build_id):
    tag = ('<p id="build-id" style="margin:24px 16px;font:12px/1.4 system-ui,sans-serif;color:#667">'
           'Simulated prototype — no funds move. Build %s</p>' % build_id)
    return html.replace("</body>", tag + "\n</body>", 1) if "</body>" in html else html + tag


def export(out, cap=STATE_CAP, build_id=None):
    build_id = build_id or source_build_id()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if list(out.iterdir()):
        raise ValueError("Choose a new or empty output folder.")
    (out / "states").mkdir()
    counts, cases = {}, []
    for cid in lifecycle.CASE_ORDER:
        states = lifecycle.reachable(cid, cap=cap)
        for sid, st in states.items():
            bad = [i for i in lifecycle.check_invariants(st) if not i["ok"]]
            if bad:
                raise AssertionError("Invariant failed in %s/%s: %s" % (cid, sid, bad))
            v = lifecycle.view(st)
            if v["state_id"] != sid or any(not i["ok"] for i in v["invariants"]):
                raise AssertionError("View mismatch in %s/%s" % (cid, sid))
            for a in v["actions"]:
                if a["enabled"] and a["next"] not in states:
                    raise AssertionError("Dangling next %s from %s/%s" % (a["next"], cid, sid))
            (out / "states" / ("lc-%s-%s.js" % (cid, sid))).write_text(_js(v), encoding="utf8")
        counts[cid] = len(states)
        meta = lifecycle.case_meta(cid)
        meta["start"] = lifecycle.state_id(lifecycle.initial_state(cid))
        cases.append(meta)
    (out / "lc-meta.js").write_text("window.lcMeta=" + json.dumps({"label": lifecycle.LABEL, "cases": cases}, ensure_ascii=True)
                                    + ";\n", encoding="utf8")
    static = root / "app" / "static"
    page = static / "lifecycle.html"
    if page.exists() and (static / "lifecycle.js").exists():
        html = page.read_text(encoding="utf8").replace('"/static/', '"')
        (out / "index.html").write_text(_stamp(html, build_id), encoding="utf8")
        for name in ("lifecycle.js", "app.css", "lifecycle.css"):
            if (static / name).exists():
                shutil.copyfile(static / name, out / name)
    else:
        (out / "index.html").write_text(
            "<!doctype html><meta charset=\"utf-8\"><title>Clearline | Provider funding desk</title>"
            "<p><b>Simulated — no funds move.</b> The provider desk interface is pending. The engine states are in "
            "<code>states/</code>; the importer replay is at <a href=\"replay/index.html\">replay/index.html</a>.</p>\n",
            encoding="utf8")
    from tools import export_tester  # noqa: E402  (same repo; writes into an empty folder)
    export_tester.export(out / "replay")
    info = {"build": build_id, "source_repo": "trysarathy/investigation-desk", "source_path": "funding-replay/",
            "states": counts, "simulated": True}
    (out / "build.json").write_text(json.dumps(info, indent=1) + "\n", encoding="utf8")
    (out / "build.txt").write_text("Clearline provider funding desk (simulated). Build %s\n" % build_id, encoding="utf8")
    return counts


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("output", type=Path)
    p.add_argument("--build-id", help="release identifier (default: short source commit, -dirty if modified)")
    args = p.parse_args()
    counts = export(args.output, build_id=args.build_id)
    for cid, n in counts.items():
        print("%-15s %4d states" % (cid, n))
    print("total           %4d states" % sum(counts.values()))
    print("build           %s" % (args.build_id or source_build_id()))
