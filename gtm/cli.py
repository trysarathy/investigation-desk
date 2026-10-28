"""Command line for Clearline GTM OS.

Every command reads CSV exports of the Master Sheet tabs from one folder (default ./work):
  settings.csv (key,value) · leads.csv · touches.csv · dnc.csv · spot_checks.csv · calls.csv
and writes results next to them. Nothing here sends email or calls any API.

  python -m gtm.cli guard   --dir work --candidates work/queue.csv   # ALLOW/BLOCK + needs_approval
  python -m gtm.cli level   --dir work                               # earned autonomy level
  python -m gtm.cli score   --dir work                               # rescore + retier leads.csv
  python -m gtm.cli merge   --dir work --incoming new_leads.csv      # dedupe new leads vs Master
  python -m gtm.cli metrics --dir work                               # dashboard numbers (JSON)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from . import autonomy, guard, merge, metrics, score
from .model import LEAD_COLS, QUEUE_COLS, Settings, read_csv, write_csv


def _load(d: Path) -> dict:
    return {n: read_csv(d / f"{n}.csv") for n in ("settings", "leads", "touches", "dnc", "spot_checks", "calls")}


def cmd_guard(a) -> int:
    d = Path(a.dir)
    t = _load(d)
    s = Settings.from_rows(t["settings"])
    stats = autonomy.stats_from(t["touches"], t["spot_checks"])
    lvl, why = autonomy.effective_level(s.autonomy_level, stats)
    s.autonomy_level = lvl
    cands = read_csv(a.candidates)
    today = date.fromisoformat(a.today) if a.today else None
    verdicts = guard.check(cands, t["leads"], t["touches"], t["dnc"], s, today)
    for c, v in zip(cands, verdicts):
        c["guard"] = v.label
        c["guard_reasons"] = "; ".join(v.reasons)
        c["needs_approval"] = "yes" if v.needs_approval else "no"
    cols = list(dict.fromkeys(list(cands[0].keys()) if cands else QUEUE_COLS))
    for k in ("guard", "guard_reasons", "needs_approval"):
        if k not in cols:
            cols.append(k)
    write_csv(a.candidates, cands, cols)
    allowed = sum(v.allow for v in verdicts)
    print(json.dumps({"level": lvl, "downgrade_reasons": why, "pause": s.pause,
                      "daily_cap": s.effective_daily_cap, "allowed": allowed, "blocked": len(verdicts) - allowed,
                      "verdicts": [{"lead_id": v.lead_id, "step": v.step, "result": v.label,
                                    "needs_approval": v.needs_approval, "reasons": v.reasons} for v in verdicts]}, indent=1))
    return 0


def cmd_level(a) -> int:
    t = _load(Path(a.dir))
    s = Settings.from_rows(t["settings"])
    st = autonomy.stats_from(t["touches"], t["spot_checks"])
    lvl, why = autonomy.effective_level(s.autonomy_level, st)
    print(json.dumps({"settings_level": s.autonomy_level, "earned_level": autonomy.earned_level(st),
                      "effective_level": lvl, "downgrade_reasons": why, "first_sent": st.first_sent,
                      "bounce_rate": round(st.bounce_rate, 4), "reply_rate": round(st.reply_rate, 4),
                      "spot_checked": st.spot_checked, "factual_errors": st.factual_errors}, indent=1))
    return 0


def cmd_score(a) -> int:
    d = Path(a.dir)
    leads = read_csv(d / "leads.csv")
    for l in leads:
        sc = score.score(l, l.get("engagement", ""))
        l["score"], l["tier"] = str(sc), score.tier(sc)
    cols = list(dict.fromkeys(LEAD_COLS + (list(leads[0].keys()) if leads else [])))
    write_csv(d / "leads.csv", leads, cols)
    print(json.dumps({"scored": len(leads), "tier1": sum(l["tier"] == "1" for l in leads),
                      "tier2": sum(l["tier"] == "2" for l in leads), "tier3": sum(l["tier"] == "3" for l in leads)}))
    return 0


def cmd_merge(a) -> int:
    d = Path(a.dir)
    existing = read_csv(d / "leads.csv")
    incoming = read_csv(a.incoming)
    fresh, dropped = merge.merge_new(existing, incoming)
    for l in fresh:
        sc = score.score(l)
        l["score"], l["tier"] = str(sc), score.tier(sc)
        l.setdefault("stage", "Researched")
    out = Path(a.out or d / "new_leads_clean.csv")
    write_csv(out, fresh, list(dict.fromkeys(LEAD_COLS + (list(fresh[0].keys()) if fresh else []))))
    print(json.dumps({"new": len(fresh), "dropped": [{"company": c, "why": w} for c, w in dropped], "out": str(out)}, indent=1))
    return 0


def cmd_metrics(a) -> int:
    t = _load(Path(a.dir))
    print(json.dumps(metrics.metrics(t["leads"], t["touches"], t["calls"]), indent=1))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="gtm")
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("guard"); g.add_argument("--dir", default="work"); g.add_argument("--candidates", required=True); g.add_argument("--today")
    sub.add_parser("level").add_argument("--dir", default="work")
    sub.add_parser("score").add_argument("--dir", default="work")
    m = sub.add_parser("merge"); m.add_argument("--dir", default="work"); m.add_argument("--incoming", required=True); m.add_argument("--out")
    sub.add_parser("metrics").add_argument("--dir", default="work")
    a = p.parse_args(argv)
    return {"guard": cmd_guard, "level": cmd_level, "score": cmd_score, "merge": cmd_merge, "metrics": cmd_metrics}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
