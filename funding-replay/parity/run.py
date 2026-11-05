#!/usr/bin/env python3
"""Parity harness: run the same economic facts through the original and the rebuilt engine and compare the
answers a treasurer cares about. Stdlib only. Run from funding-replay/:

    python3 parity/run.py [--original-dir DIR] [--zip PATH] [--out parity/RESULTS.md]

Exit status is non-zero only for harness errors, never for differences between the engines.
"""
import argparse
import datetime as _dt
import hashlib
import importlib.util
import json
import os
import re
import sys
import traceback
from decimal import Decimal as D

sys.dont_write_bytecode = True  # never leave __pycache__ in engine/ or in the read-only reference
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # funding-replay/
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)

import common  # noqa: E402
import to_original  # noqa: E402
import to_rebuild  # noqa: E402

SCRATCH = "/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad"
DEFAULT_ORIGINAL = os.path.join(SCRATCH, "original-ref", "funding-replay")
DEFAULT_ZIP = "/root/.claude/uploads/8ae5c623-3937-5b3f-978e-8dd7c464008e/1fb78459-Funding_Replay_Experiment.zip"
EXPECTED_ZIP_SHA = "7cbab786925d105ccd902ded51d6c822fd36653e08444c9838f16db915e24a9d"


class NA(str):
    """A cell that cannot be compared (engine unavailable, not expressible, engine error)."""


ORIGINAL_MISSING = NA("original not available")


# --------------------------------------------------------------------------- loading
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def load_original(directory):
    path = os.path.join(directory, "replay.py")
    if not os.path.isfile(path):
        return None
    spec = importlib.util.spec_from_file_location("original_replay_ref", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # module body only defines functions; __main__ block is not run
    return mod


def engine_error(exc):
    tb = traceback.extract_tb(exc.__traceback__)
    where = "%s:%d" % (os.path.basename(tb[-1].filename), tb[-1].lineno) if tb else "?"
    return NA("engine error: %s: %s (%s)" % (type(exc).__name__, exc, where))


# --------------------------------------------------------------------------- normalisation
def money(text):
    if text is None:
        return None
    t = str(text).replace("SGD", "").replace(",", "").replace("\u2212", "-").strip()
    return D(t).quantize(D("0.01"))


ORIG_STATUS = {"feasible in model": "feasible", "infeasible": "infeasible", "unknown": "unknown",
               "not yet observable": "not-yet"}
REB_STATUS = {"feasible": "feasible", "infeasible": "infeasible", "unknown": "unknown", "not_evidenced": "not-yet",
              "passed": "passed"}


def orig_decision_cat(status):
    for prefix, cat in (("Keep baseline", "KEEP_BASELINE"), ("Escalate", "ESCALATE"),
                        ("Manual review", "MANUAL_REVIEW"), ("not yet due", "NOT_YET")):
        if status.startswith(prefix):
            return cat
    return "OTHER"


def reb_decision_cat(state):
    return {"KEEP_FRIDAY": "KEEP_BASELINE", "MANUAL_REVIEW": "MANUAL_REVIEW"}.get(state, "ESCALATE")


def sgt_text(text):
    """'Wed 18 Nov 2026, 23:00 SGT' or '2026-11-18 23:00 SGT' -> '2026-11-18 23:00'."""
    if text is None:
        return None
    t = text.replace(" SGT", "")
    for fmt in ("%a %d %b %Y, %H:%M", "%Y-%m-%d %H:%M"):
        try:
            return _dt.datetime.strptime(t, fmt).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    return text


FIELDS = (
    ("known", "Known (fact ids visible)"),
    ("fri.status", "Friday slot status"),
    ("mon.status", "Monday slot status"),
    ("fri.usable", "Friday usable cash"),
    ("fri.required", "Friday required"),
    ("fri.headroom", "Friday headroom"),
    ("mon.usable", "Monday usable cash"),
    ("mon.required", "Monday required"),
    ("mon.headroom", "Monday headroom"),
    ("fri.cutoff", "Friday cutoff"),
    ("mon.cutoff", "Monday cutoff"),
    ("deadline", "Spendable deadline"),
    ("decision", "Friday decision (category)"),
    ("comparison", "Comparison allowed / net"),
)
INFO = ("asof_answer", "fri.reason", "mon.reason")


# --------------------------------------------------------------------------- extraction
def extract_original(orig, rows, idmap, asof):
    data = [dict(r) for r in rows]
    out = orig.replay(data, orig.instant(asof))
    vis = orig.view(data, orig.instant(asof))
    known = set()
    for r in vis:
        known.update(idmap.get(r["id"], []))
    res = {"known": known, "deadline": sgt_text(out["deadline"])}
    for key, r in zip(("fri", "mon"), out["routes"]):
        res[key + ".status"] = ORIG_STATUS.get(r["status"], r["status"])
        res[key + ".usable"] = money(r.get("free_sgd"))
        res[key + ".required"] = money(r.get("required_sgd"))
        res[key + ".headroom"] = money(r.get("headroom_sgd"))
        res[key + ".cutoff"] = r.get("cutoff")
        res[key + ".reason"] = "%s: %s" % (r["status"], r["reason"])
    pd = out["prior_decision"]
    res["decision"] = orig_decision_cat(pd["status"])
    res["decision.raw"] = pd["status"] + (" [missing: %s]" % ", ".join(pd["missing"]) if pd["missing"] else "")
    c = out["comparison"]
    res["comparison"] = "yes, net %s" % money(c["net_sgd"]) if c else "no"
    res["asof_answer"] = pd["status"]
    return res, out


def _reb_usable(opt):
    if opt["required_sgd"] is not None and opt["cash_headroom_sgd"] is not None:
        return money(opt["required_sgd"]) + money(opt["cash_headroom_sgd"])
    for c in opt["checks"]:
        if c["name"].startswith("Cash"):
            m = re.search(r"(?:Usable|Documented cash support) SGD ([\d,]+\.\d\d)", c["detail"])
            if m:
                return money(m.group(1))
    return None


def _reb_cutoff(out, slot, status):
    if status == "not-yet":
        return None  # rebuild hides every number of a not_evidenced slot; the cutoff is treated the same way
    for e in out["evidence"]:
        if e["kind"] == "funding_slot" and e["slot"] == slot and any(u.startswith(slot + ":") for u in e["used_by"]):
            return sgt_text(e["expires_sgt"])[11:]
    return None


def extract_rebuild(rb, events, idmap, dt_id, rate, friday_out):
    out = rb.evaluate(events, dt_id, rate)
    known = set()
    for e in out["evidence"]:
        known.update(idmap.get(e["record_id"], []))
    known.discard("xlate")
    res = {"known": known, "deadline": sgt_text(out["payment"]["deadline_sgt"])}
    for key, opt in zip(("fri", "mon"), out["options"]):
        st = REB_STATUS.get(opt["status"], opt["status"])
        res[key + ".status"] = st
        res[key + ".usable"] = _reb_usable(opt)
        res[key + ".required"] = money(opt["required_sgd"])
        res[key + ".headroom"] = money(opt["cash_headroom_sgd"])
        res[key + ".cutoff"] = _reb_cutoff(out, opt["slot"], st)
        bad = ["%s=%s: %s" % (c["name"], c["state"], c["detail"]) for c in opt["checks"] if c["state"] != "ok"]
        res[key + ".reason"] = "%s: %s" % (opt["status"], " | ".join(bad) or "all checks ok")
    fd = friday_out["decision"]
    res["decision"] = reb_decision_cat(fd["state"])
    res["decision.raw"] = "%s (%s)" % (fd["state"], fd["headline"])
    c = out["comparison"]
    if c is None:
        res["comparison"] = "no"
    elif not c["available"]:
        res["comparison"] = "no"
        res["comparison.raw"] = "withheld: " + (c["withheld_reason"] or "")
    else:
        res["comparison"] = "yes, net %s" % money(c["net_benefit_before_subscription"])
    d = out["decision"]
    res["asof_answer"] = "%s (%s)" % (d["state"], d["headline"])
    return res, out


def flag(a, b):
    if isinstance(a, NA) or isinstance(b, NA):
        return "n/a"
    return "same" if a == b else "differs"


def show(v):
    if v is None:
        return "—"
    if isinstance(v, set):
        return "%d facts" % len(v)
    return str(v)


# --------------------------------------------------------------------------- fidelity checks
def _strip(o):
    o = json.loads(json.dumps(o))
    o.pop("invoice", None)  # the invoice record id (INV-1001 vs INV); ids are not facts
    for r in o["routes"]:
        r.pop("evidence", None)
    o["prior_decision"].pop("evidence", None)
    return o


def row_signature(orig, rows):
    sig = []
    for r in rows:
        detail = r["detail"] if r["kind"] in ("cutoff_sgt", "offramp_usd", "destination_sla_hours", "closure") else ""
        t = lambda s: orig.instant(s).isoformat() if s else ""
        sig.append((r["kind"], r["route"], t(r["effective_at"]), t(r["known_at"]), t(r["valid_until"]),
                    format(D(r["amount"]).normalize(), "f") if r["amount"] else "", detail))
    return sorted(sig)


def fidelity(orig, original_dir, case, rows):
    base = orig.scenario(orig.rows(os.path.join(original_dir, "events.csv")), case)
    a, b = row_signature(orig, base), row_signature(orig, rows)
    only_orig = [x for x in a if x not in b]
    only_ours = [x for x in b if x not in a]
    outs = []
    for _, asof, label in common.AS_OF:
        same = _strip(orig.replay(base, orig.instant(asof))) == _strip(orig.replay([dict(r) for r in rows],
                                                                               orig.instant(asof)))
        outs.append("%s %s" % (label, "identical" if same else "DIFFERENT"))
    return only_orig, only_ours, outs


def first_known(rows, idmap, key):
    """fact id -> earliest known_at among the records a translator emitted for it."""
    out = {}
    for r in rows:
        t = _dt.datetime.fromisoformat(r["known_at"])
        for fid in idmap.get(r[key], []):
            if fid != "xlate" and (fid not in out or t < out[fid]):
                out[fid] = t
    return out


# --------------------------------------------------------------------------- main
def run(args):
    orig = load_original(args.original_dir)
    from engine import replay as rb  # the rebuild, imported read-only from funding-replay/engine
    outdir = os.path.join(HERE, "out")
    os.makedirs(outdir, exist_ok=True)

    results = []
    for sc in common.SCENARIOS:
        facts = common.build(sc)
        entry = {"sc": sc, "cells": {}, "notes_o": [], "notes_r": [], "fidelity": None, "retro_alt": None,
                 "orig_status": None, "reb_status": None}
        # ---- translate
        try:
            o_rows, o_map, o_notes, _ = to_original.translate(facts)
            entry["notes_o"] = o_notes
            with open(os.path.join(outdir, sc["id"] + ".original.csv"), "w", encoding="utf-8") as fh:
                fh.write(to_original.to_csv(o_rows))
        except to_original.NotExpressible as exc:
            o_rows, o_map, entry["orig_status"] = None, {}, NA("not expressible: %s" % exc)
        try:
            r_rows, r_map, r_notes, r_params = to_rebuild.translate(facts)
            entry["notes_r"] = r_notes
            r_text = to_rebuild.to_csv(r_rows)
            with open(os.path.join(outdir, sc["id"] + ".rebuild.csv"), "w", encoding="utf-8") as fh:
                fh.write(r_text)
        except to_rebuild.NotExpressible as exc:
            r_rows, r_map, r_params, entry["reb_status"] = None, {}, {}, NA("not expressible: %s" % exc)
        if orig is None:
            entry["orig_status"] = ORIGINAL_MISSING
        both, entry["known_skew"] = set(), []
        if o_rows is not None and r_rows is not None:
            ko = first_known(o_rows, o_map, "id")
            kr = first_known(r_rows, r_map, "record_id")
            for fid in sorted(set(ko) & set(kr)):
                if ko[fid] == kr[fid]:
                    both.add(fid)
                else:
                    entry["known_skew"].append("%s (original known %s, rebuild known %s)" % (
                        fid, ko[fid].strftime("%a %d %H:%M"), kr[fid].strftime("%a %d %H:%M")))
        # ---- rebuild: load once, Friday answer reused for the 'Friday decision' field
        events = friday_out = None
        if entry["reb_status"] is None:
            events, errors = rb.load_events(r_text)
            if errors:
                entry["reb_status"] = NA("engine rejected CSV: %s" % errors[:3])
            else:
                try:
                    friday_out = rb.evaluate(events, "friday", r_params.get("funding_rate_pct", common.FUNDING_RATE_PCT))
                except Exception as exc:  # engine failure is a result, not a harness error
                    entry["reb_status"] = engine_error(exc)
        rate = r_params.get("funding_rate_pct", common.FUNDING_RATE_PCT)
        for dt_id, asof, label in common.AS_OF:
            o = r = None
            if entry["orig_status"] is None:
                try:
                    o, _ = extract_original(orig, o_rows, o_map, asof)
                except Exception as exc:
                    o = engine_error(exc)
            else:
                o = entry["orig_status"]
            if entry["reb_status"] is None:
                try:
                    r, _ = extract_rebuild(rb, events, r_map, dt_id, rate, friday_out)
                except Exception as exc:
                    r = engine_error(exc)
            else:
                r = entry["reb_status"]
            cell = {}
            for key, _ in FIELDS:
                ov = o if isinstance(o, NA) else o.get(key)
                rv = r if isinstance(r, NA) else r.get(key)
                if key == "known" and not isinstance(ov, NA) and not isinstance(rv, NA):
                    ov, rv = ov & both, rv & both
                cell[key] = (ov, rv, flag(ov, rv))
            for key in INFO + ("decision.raw", "comparison.raw"):
                cell[key] = (o if isinstance(o, NA) else o.get(key), r if isinstance(r, NA) else r.get(key), "info")
            entry["cells"][dt_id] = cell
        # ---- original-only checks: retro as-of choice and translation fidelity
        if entry["orig_status"] is None:
            try:
                a, _ = extract_original(orig, o_rows, o_map, common.AS_OF[2][1])
                b, _ = extract_original(orig, o_rows, o_map, common.ORIGINAL_RETRO_ALT)
                diff = [k for k, _ in FIELDS if k != "known" and a.get(k) != b.get(k)]
                entry["retro_alt"] = ("original at Wed 18 15:00 gives the same compared fields as at Thu 19 09:00"
                                      if not diff else "original Wed 18 15:00 vs Thu 19 09:00 differ on: %s" % diff)
                if sc["case"]:
                    entry["fidelity"] = fidelity(orig, args.original_dir, sc["case"], o_rows)
            except Exception as exc:
                entry["retro_alt"] = str(engine_error(exc))
        results.append(entry)
    return orig, results


def summarize(results):
    n_diff = sum(1 for e in results for c in e["cells"].values() for k, _ in FIELDS if c[k][2] == "differs")
    n_same = sum(1 for e in results for c in e["cells"].values() for k, _ in FIELDS if c[k][2] == "same")
    n_na = sum(1 for e in results for c in e["cells"].values() for k, _ in FIELDS if c[k][2] == "n/a")
    return n_same, n_diff, n_na


def pair(c):
    o, r, f = c
    if f == "same":
        return show(o)
    return "%s / %s" % (show(o), show(r))


def console_table(results):
    cols = (("as-of", None), ("Fri", "fri.status"), ("Mon", "mon.status"), ("Fri hdrm", "fri.headroom"),
            ("Mon hdrm", "mon.headroom"), ("Fri decision", "decision"), ("Comparison", "comparison"))
    lines = ["Cells: one value = same in both engines; 'orig / rebuild' = differs; n/a = not comparable.", ""]
    for e in results:
        lines.append("== %s" % e["sc"]["id"])
        for dt_id, _, label in common.AS_OF:
            c = e["cells"][dt_id]
            nd = sum(1 for k, _ in FIELDS if c[k][2] == "differs")
            if any(c[k][2] == "n/a" for k, _ in FIELDS):
                o, r, _ = c["fri.status"]
                parts = ["orig: %s" % (o if isinstance(o, NA) else "ok"), "rebuild: %s" % (r if isinstance(r, NA) else "ok")]
                lines.append("  %-6s n/a  %s" % (dt_id, "; ".join(parts)))
                continue
            lines.append("  %-6s " % dt_id + " | ".join("%s %s" % (h, pair(c[k])) for h, k in cols[1:])
                         + "  [%d differ]" % nd)
    return "\n".join(lines)


def md_escape(v):
    return show(v).replace("|", "\\|").replace("\n", " ")


def write_markdown(path, args, orig, results, zip_info):
    n_same, n_diff, n_na = summarize(results)
    now = _dt.datetime.now(_dt.timezone.utc).astimezone(_dt.timezone(_dt.timedelta(hours=8)))
    L = ["# Parity results: original vs rebuild", "",
         "Generated by `python3 parity/run.py` on %s. Synthetic replay — no funds move." % now.strftime(
             "%Y-%m-%d %H:%M SGT"), ""]
    L += ["## Inputs", "",
          "- Input zip: `%s`" % zip_info[0],
          "- Zip SHA-256 (computed at run time): `%s`%s" % (zip_info[1], zip_info[2]),
          "- Original engine: `%s` %s" % (os.path.join(args.original_dir, "replay.py"),
                                          "(SHA-256 `%s`)" % sha256(os.path.join(args.original_dir, "replay.py"))
                                          if orig else "— **original not available**; no original output shown"),
          "- Rebuild engine: `engine/replay.py` (SHA-256 `%s`)" % sha256(os.path.join(ROOT, "engine", "replay.py")),
          "- As-of times: Fri 13 15:00, Mon 16 15:00, Thu 19 09:00 SGT (the rebuild's fixed `retro` time; the "
          "original's default Wed 18 15:00 is checked to give the same answers).",
          "- Funding rate: 8% (original: annual_rate record 0.08; rebuild: `funding_rate_pct=8`).",
          "- Translated CSVs: `parity/out/<scenario>.original.csv` and `.rebuild.csv`.", ""]
    L += ["## How to read this", "",
          "- **same**: both engines give the same normalised answer. **differs**: they do not; every difference "
          "is reviewed in `docs/PARITY_REVIEW.md` (code vs fixture vs policy vs wording). **n/a**: one side is "
          "not available, not expressible in that engine's schema, or the engine raised an error.",
          "- Slot status is normalised to feasible / infeasible / unknown / not-yet (original 'not yet "
          "observable', rebuild `not_evidenced`); the rebuild's `passed` (cutoff already gone at this as-of) is "
          "kept as `passed` because folding it into another value would hide its meaning.",
          "- Rebuild usable cash is derived as required + headroom (or read from the cash check text when "
          "required is unknown); the rebuild has no per-option usable field.",
          "- Friday decision: original `prior_decision.status` (recomputed from Friday-known records at every "
          "as-of) vs the rebuild's `evaluate(..., 'friday')` decision state. Categories: KEEP_BASELINE (original "
          "'Keep baseline…', rebuild KEEP_FRIDAY), MANUAL_REVIEW, ESCALATE (original 'Escalate…'; rebuild "
          "INSUFFICIENT_CASH / NO_DECISION / NEED_NEWER_BALANCE / DEADLINE_AT_RISK).",
          "- Known: the set of common fact ids visible to each engine at the as-of, restricted to facts both "
          "translators emit with the same known_at (translation-only records such as the rebuild's calendar/floor, "
          "and facts the translations date differently, are excluded and listed per scenario).", "",
          "Totals over %d scenarios x 3 as-of times x %d fields: **%d same, %d differs, %d n/a**." % (
              len(results), len(FIELDS), n_same, n_diff, n_na), ""]
    # summary matrix
    L += ["## Summary", "", "| Scenario | Fri 13 15:00 | Mon 16 15:00 | Thu 19 retro |", "|---|---|---|---|"]
    for e in results:
        row = []
        for dt_id, _, _ in common.AS_OF:
            c = e["cells"][dt_id]
            nd = [lbl for k, lbl in FIELDS if c[k][2] == "differs"]
            na = any(c[k][2] == "n/a" for k, _ in FIELDS)
            row.append("n/a" if na else ("same" if not nd else "%d differ" % len(nd)))
        L.append("| `%s` | %s |" % (e["sc"]["id"], " | ".join(row)))
    L.append("")
    # notes shared by all scenarios
    all_o = [set(e["notes_o"]) for e in results if e["notes_o"]]
    all_r = [set(e["notes_r"]) for e in results if e["notes_r"]]
    shared_o = set.intersection(*all_o) if all_o else set()
    shared_r = set.intersection(*all_r) if all_r else set()
    L += ["## Translation notes (every scenario)", "", "Original:"] + ["- " + n for n in sorted(shared_o)]
    L += ["", "Rebuild:"] + ["- " + n for n in sorted(shared_r)] + [""]
    for e in results:
        sc = e["sc"]
        L += ["## `%s`" % sc["id"], "", sc["title"] + ".", ""]
        if sc["case"]:
            L.append("Original built-in case: `--case %s`." % sc["case"])
        for who, st in (("Original", e["orig_status"]), ("Rebuild", e["reb_status"])):
            if st is not None:
                L.append("**%s: %s**" % (who, st))
        L += ["", "| Field | Fri orig | Fri rebuild | | Mon orig | Mon rebuild | | Retro orig | Retro rebuild | |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for key, label in FIELDS:
            cells = []
            for dt_id, _, _ in common.AS_OF:
                o, r, f = e["cells"][dt_id][key]
                cells += [md_escape(o), md_escape(r), "**differs**" if f == "differs" else f]
            L.append("| %s | %s |" % (label, " | ".join(cells)))
        L.append("")
        # known differences
        for dt_id, _, label in common.AS_OF:
            o, r, f = e["cells"][dt_id]["known"]
            if f == "differs":
                L.append("- Known at %s: original only %s; rebuild only %s." % (
                    label, sorted(o - r) or "—", sorted(r - o) or "—"))
        L += ["", "<details><summary>Answers and reasons (not compared)</summary>", ""]
        for dt_id, _, label in common.AS_OF:
            c = e["cells"][dt_id]
            L.append("**%s**" % label)
            for key, name in (("asof_answer", "Answer at this as-of"), ("decision.raw", "Friday decision"),
                              ("fri.reason", "Friday slot"), ("mon.reason", "Monday slot"),
                              ("comparison.raw", "Comparison")):
                o, r, _ = c[key]
                if o is None and r is None:
                    continue
                L.append("- %s — original: %s" % (name, md_escape(o)))
                L.append("- %s — rebuild: %s" % (name, md_escape(r)))
            L.append("")
        L += ["</details>", ""]
        if e.get("known_skew"):
            L.append("- Excluded from the Known comparison (the translations give the fact different known_at "
                     "times): %s." % "; ".join(e["known_skew"]))
        extra_o = [n for n in e["notes_o"] if n not in shared_o]
        extra_r = [n for n in e["notes_r"] if n not in shared_r]
        if extra_o or extra_r:
            L += ["Scenario translation notes:"] + ["- original: " + n for n in extra_o] + \
                 ["- rebuild: " + n for n in extra_r] + [""]
        if e["retro_alt"]:
            L.append("Check: %s." % e["retro_alt"])
        if e["fidelity"]:
            only_o, only_ours, outs = e["fidelity"]
            L.append("Check: original engine output (ids aside) on this translation vs its own `--case %s`: %s." % (
                sc["case"], "; ".join(outs)))
            if only_o or only_ours:
                L.append("Record differences vs the built-in case (kind, route, effective, known, valid_until, "
                         "amount, detail): built-in only %s; translation only %s." % (only_o, only_ours))
            else:
                L.append("Records match the built-in case field for field (ids and free-text detail aside).")
        L.append("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--original-dir", default=DEFAULT_ORIGINAL)
    p.add_argument("--zip", default=DEFAULT_ZIP)
    p.add_argument("--out", default=os.path.join(HERE, "RESULTS.md"))
    args = p.parse_args()
    try:
        if os.path.isfile(args.zip):
            digest = sha256(args.zip)
            match = " (matches the expected digest)" if digest == EXPECTED_ZIP_SHA else \
                " (**does not match** expected %s)" % EXPECTED_ZIP_SHA
            zip_info = (os.path.basename(args.zip), digest, match)
        else:
            zip_info = (os.path.basename(args.zip), "not computed: zip not found at %s" % args.zip, "")
        orig, results = run(args)
        if orig is None:
            print("original not available: no replay.py in %s; original cells are marked n/a" % args.original_dir)
        print("Input zip %s SHA-256 %s%s" % zip_info)
        print(console_table(results))
        n_same, n_diff, n_na = summarize(results)
        print("\nTotals: %d same, %d differs, %d n/a" % (n_same, n_diff, n_na))
        print("\nTranslation notes:")
        seen = []
        for e in results:
            for n in ["original: " + x for x in e["notes_o"]] + ["rebuild: " + x for x in e["notes_r"]]:
                if n not in seen:
                    seen.append(n)
                    print(" - " + n)
            for st in (e["orig_status"], e["reb_status"]):
                if st is not None and st != ORIGINAL_MISSING:
                    print(" - %s: %s" % (e["sc"]["id"], st))
        write_markdown(args.out, args, orig, results, zip_info)
        print("\nWrote %s" % os.path.relpath(args.out))
        return 0
    except Exception:
        traceback.print_exc()
        print("HARNESS ERROR", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
