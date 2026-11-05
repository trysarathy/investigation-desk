"""Translate common facts (parity/common.py) into the REBUILD engine's CSV schema.

Schema (engine/replay.py, which leads CONTRACT.md where they differ):
record_id,kind,slot,effective_at,known_at,expires_at,amount,currency,rate,bp,status,source,establishes
Every choice that is not a one-to-one copy is appended to `notes`; facts the rebuild cannot hold raise
NotExpressible. Records the rebuild requires but the original has no record for are added only as explicit
translations of a rule the original applies in code, and each is listed in `notes`.
"""
import csv
import io
from decimal import Decimal as D

COLS = ("record_id", "kind", "slot", "effective_at", "known_at", "expires_at", "amount", "currency", "rate", "bp",
        "status", "source", "establishes")
SOURCE = "synthetic: parity harness translation"


class NotExpressible(Exception):
    pass


def _row(rid, kind, slot="", eff="", known="", exp="", amount="", currency="", rate="", bp="", status="", text=""):
    s = lambda v: "" if v in (None, "") else str(v)
    return {"record_id": rid, "kind": kind, "slot": slot or "", "effective_at": s(eff), "known_at": s(known),
            "expires_at": s(exp), "amount": s(amount), "currency": currency, "rate": s(rate), "bp": s(bp),
            "status": status, "source": SOURCE, "establishes": text}


def translate(facts):
    """-> (rows, idmap {record_id: [fact ids]}, notes, params)."""
    rows, idmap, notes, params = [], {}, [], {}

    def emit(fids, *args, **kw):
        r = _row(*args, **kw)
        rows.append(r)
        idmap[r["record_id"]] = list(fids)

    inv = next(f for f in facts if f["kind"] == "invoice")
    bounds = {f["slot"]: f["hours"] for f in facts if f["kind"] == "delivery_bound"}
    if len(set(bounds.values())) > 1:
        raise NotExpressible("delivery_bound: the rebuild has one common service_bound for both slots; per-slot "
                             "bounds %s cannot be expressed (two values would be contradictory evidence)." % (
                                 ", ".join("%s %s h" % (k, v) for k, v in sorted(bounds.items()))))
    fwd = {f["kind"]: f for f in facts if f["kind"] in ("forward_rate", "forward_spread")}
    closures = {(f["slot"], f["date"]) for f in facts if f["kind"] == "closure"}

    for f in facts:
        k, fid, slot = f["kind"], f["id"], f["slot"] or ""
        eff, known, until = f["effective"], f["known"], f["until"]
        if k == "invoice":
            emit([fid], fid + "-OBL", "obligation", "", f["deadline"], known, "", f["usd"], "USD",
                 text="USD net owed; effective_at = spendable deadline")
            emit([fid], fid + "-REL", "release_checkpoint", "", f["release"], known, text="common provider release")
        elif k == "funding_rate":
            params["funding_rate_pct"] = f["amount"] * D(100)
        elif k == "quote":
            emit([fid], fid, "quote", slot, eff, known, until, rate=f["rate"], bp=f["bp"], text="quote")
        elif k in ("fee", "forward_fee"):
            emit([fid], fid + "-RAIL", "fee", slot, eff, known, until, f["rail"], "SGD", status="rail", text="rail")
            emit([fid], fid + "-PROC", "fee", slot, eff, known, until, f["processing"], "SGD", status="processing",
                 text="processing")
        elif k == "slot":
            emit([fid], fid, "funding_slot", slot, f["instruction"], f["schedule_known"], f["cutoff"],
                 text="instruction time; expires_at = exclusive cutoff")
        elif k == "lead_days":
            emit([fid], fid, "lead_business_days", slot, eff, known, until, f["days"], text="lead business days")
        elif k == "capacity":
            emit([fid], fid, "capacity", slot, eff, known, until, f["usd"], "USD", status=f["status"],
                 text="payout capacity")
        elif k == "reserved_capacity":
            emit([fid], fid, "capacity", slot, eff, known, until, f["usd"], "USD", status="reserved",
                 text="reserved later-slot capacity")
        elif k == "delivery_bound":
            emit([fid], fid, "service_bound", "", eff, known, "", f["hours"], text="simulated last-mile bound")
        elif k == "balance":
            emit([fid], fid, "cash_snapshot", "", eff, known, until, f["amount"], "SGD", status="settled",
                 text="settled balance")
        elif k == "commitment_list":
            emit([fid], fid, "commitment_list", "", eff, known, until, status="complete",
                 text="commitment list complete")
        elif k == "reservation":
            emit([fid], fid, "commitment", "", "", known, "", f["amount"], "SGD", text="earmark inside balance")
        elif k == "forecast":
            emit([fid], fid, "receivable", "", eff, known, "", f["amount"], "SGD", status="forecast",
                 text="forecast receipt")
        elif k == "closure":
            for s in ([slot] if slot else ["friday", "monday"]):
                emit([fid], "%s-%s" % (fid, s[:3].upper()), "calendar", s, f["date"] + "T00:00:00+08:00", known,
                     status="closed", text="closed date")
        elif k == "forward_rate":
            sp = fwd.get("forward_spread")
            emit([fid] + ([sp["id"]] if sp else []), "FWD-TERMS", "forward_terms", slot, eff,
                 max(known, sp["known"]) if sp else known, min(until, sp["until"]) if sp else until,
                 rate=f["rate"], bp=sp["bp"] if sp else "", status="agreed", text="agreed forward terms")
        elif k == "forward_spread":
            if "forward_rate" not in fwd:
                raise NotExpressible("%s: the rebuild holds a forward spread only inside forward_terms with a rate"
                                     % fid)
        elif k == "own_cash_floor":
            emit([fid], fid, "cash_support", slot, eff, known, until, f["amount"], "SGD", status="documented",
                 text="documented cash support for the later slot")
        elif k == "fallback":
            emit([fid], fid, "fallback", slot, eff, known, until, f["usd"], "USD", status="documented",
                 text="documented fallback")
        else:
            raise NotExpressible("%s: no rebuild kind for %r" % (fid, k))

    # ---- records the rebuild requires for rules the original applies in code (explicit, listed) ----
    for f in facts:
        if f["kind"] != "slot":
            continue
        date = f["instruction"][:10]
        if (f["slot"], date) in closures or (None, date) in closures:
            continue
        rid = "XL-CAL-" + f["slot"][:3].upper()
        emit(["xlate"], rid, "calendar", f["slot"], date + "T00:00:00+08:00", inv["known"], status="open",
             text="weekday open (original rule in code)")
        notes.append("%s: calendar 'open' for %s %s added, known %s. The original treats every weekday without a "
                     "closure record as open in code; the rebuild needs a record." % (rid, f["slot"], date,
                                                                                      inv["known"]))
    emit(["xlate"], "XL-FLOOR", "cash_floor", "", "", inv["known"], "", "0", "SGD", text="no floor in original")
    notes.append("XL-FLOOR: cash_floor SGD 0 added. The original has no cash-floor policy; the rebuild requires "
                 "one (missing -> cash unknown).")

    kinds = {f["kind"] for f in facts}
    if "slot" in kinds:
        notes.append("slot: funding_slot merges the instruction time (original: code constant, known from the "
                     "start) and the cutoff (original: cutoff_sgt record first known 14:00 on the day). known_at = "
                     "the slot fact's schedule_known (Thu 12 09:00 unless the scenario says otherwise), so the "
                     "rebuild learns the Monday cutoff earlier than the original's record. The strict alternative "
                     "is the probe_monday_slot_unknown_friday scenario.")
    if "reservation" in kinds:
        notes.append("reservation: original reserved_sgd (an earmark inside the gross balance, active on "
                     "[effective, valid_until)) -> rebuild commitment with EMPTY effective_at, so it is always "
                     "subtracted. With an effective_at at or before the balance time the rebuild would treat it as "
                     "already paid out of the balance and not deduct it. The active window is not expressible "
                     "(rebuild commitments have no expiry).")
    if "commitment_list" in kinds:
        notes.append("commitment_list: original reservation_snapshot (amount 1) -> rebuild commitment_list status "
                     "complete, same times.")
    if "funding_rate" in kinds:
        notes.append("funding_rate: not a record in the rebuild; passed to evaluate() as funding_rate_pct = 8.")
    if "delivery_bound" in kinds:
        notes.append("delivery_bound: one per-route original record per slot -> rebuild service_bound with no slot "
                     "and no expiry (rebuild reads it as common to both slots).")
    if "invoice" in kinds:
        notes.append("invoice: -> obligation (effective_at = spendable deadline) + release_checkpoint.")
    if "fee" in kinds or "forward_fee" in kinds:
        notes.append("fee: one fact -> two rebuild fee records (rail 20 + processing 15/25), same times.")
    if "forward_rate" in kinds:
        notes.append("forward_rate + forward_spread -> one forward_terms (status agreed); forward_fee -> Monday "
                     "fee records; reserved_capacity -> capacity status reserved; own_cash_floor -> cash_support "
                     "(documented); fallback -> fallback (documented).")
    if "closure" in kinds:
        notes.append("closure: -> calendar status closed for the named slot, effective_at = the closed date 00:00 "
                     "SGT.")
    return rows, idmap, notes, params


def to_csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()
