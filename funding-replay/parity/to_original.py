"""Translate common facts (parity/common.py) into the ORIGINAL engine's CSV schema.

Schema: id,kind,route,effective_at,known_at,valid_until,amount,detail; route standard | later | all.
Every choice that is not a one-to-one copy is appended to `notes`. Facts the original cannot hold raise
NotExpressible.
"""
import csv
import io
from datetime import datetime, timedelta

COLS = ("id", "kind", "route", "effective_at", "known_at", "valid_until", "amount", "detail")
ROUTE = {"friday": "standard", "monday": "later", None: "all"}
DAYS_BEFORE_RELEASE = {"friday": 5, "monday": 2}  # the original's route model (code constant)


class NotExpressible(Exception):
    pass


def _row(rid, kind, route, eff, known, until, amount="", detail=""):
    return {"id": rid, "kind": kind, "route": route, "effective_at": eff or "", "known_at": known or "",
            "valid_until": until or "", "amount": "" if amount in (None, "") else str(amount), "detail": detail}


def translate(facts):
    """-> (rows, idmap {row id: [fact ids]}, notes, params)."""
    rows, idmap, notes = [], {}, []
    inv = next(f for f in facts if f["kind"] == "invoice")

    def emit(fids, *args, **kw):
        r = _row(*args, **kw)
        rows.append(r)
        idmap[r["id"]] = list(fids)

    for f in facts:
        k, fid, route = f["kind"], f["id"], ROUTE[f["slot"]]
        base = (f["effective"], f["known"], f["until"])
        if k == "invoice":
            emit([fid], fid, "invoice", "all", f["release"], f["known"], f["deadline"], f["usd"],
                 "USD net; effective_at is provider release; valid_until is US beneficiary spendable deadline")
        elif k == "funding_rate":
            emit([fid], fid, "annual_rate", "all", *base, amount=f["amount"], detail="assumed annual funding hurdle")
        elif k == "quote":
            emit([fid], fid + "-RATE", "sgd_per_usd", route, *base, amount=f["rate"], detail="reference SGD per USD")
            emit([fid], fid + "-SPREAD", "spread_bps", route, *base, amount=f["bp"], detail="one-way FX charge bp")
            if f["until"][11:16] != "16:00":
                notes.append("%s: the quote's expiry is applied to both the rate and the spread record (the "
                             "original's own stale-quote case shortens only the rate record)." % fid)
        elif k == "fee":
            emit([fid], fid, "fee_sgd", route, *base, amount=f["rail"] + f["processing"], detail="fixed route cost")
        elif k == "slot":
            derived = (datetime.fromisoformat(inv["release"]) - timedelta(days=DAYS_BEFORE_RELEASE[f["slot"]]))
            if datetime.fromisoformat(f["instruction"]) != derived:
                raise NotExpressible("%s: the original derives the %s instruction time from the release "
                                     "(release - %d days); %s cannot be expressed."
                                     % (fid, route, DAYS_BEFORE_RELEASE[f["slot"]], f["instruction"]))
            emit([fid], fid, "cutoff_sgt", route, *base, detail=f["cutoff"][11:16])
        elif k == "lead_days":
            emit([fid], fid, "lead_business_days", route, *base, amount=f["days"],
                 detail="source date excluded; destination date included")
        elif k == "capacity":
            emit([fid], fid, "offramp_usd", route, *base, amount=f["usd"],
                 detail="confirmed_for_invoice" if f["status"] == "confirmed" else f["status"])
        elif k == "delivery_bound":
            emit([fid], fid, "destination_sla_hours", route, *base, amount=f["hours"], detail="spendable_net_usd")
        elif k == "balance":
            emit([fid], fid, "settled_sgd", "all", *base, amount=f["amount"], detail="gross settled own SGD")
        elif k == "commitment_list":
            emit([fid], fid, "reservation_snapshot", "all", *base, amount=1,
                 detail="all external commitments included")
        elif k == "reservation":
            emit([fid], fid, "reserved_sgd", "all", *base, amount=f["amount"], detail="earmarked SGD in gross balance")
        elif k == "forecast":
            emit([fid], fid, "forecast_sgd", "all", *base, amount=f["amount"], detail="unsettled receivable")
        elif k == "closure":
            emit([fid], fid, "closure", route, *base, detail=f["date"])
        elif k == "forward_rate":
            emit([fid], fid, "forward_sgd_per_usd", "later", *base, amount=f["rate"], detail="binding later rate")
        elif k == "forward_spread":
            emit([fid], fid, "forward_spread_bps", "later", *base, amount=f["bp"], detail="binding spread")
        elif k == "forward_fee":
            emit([fid], fid, "forward_fee_sgd", "later", *base, amount=f["rail"] + f["processing"],
                 detail="binding fee")
        elif k == "reserved_capacity":
            emit([fid], fid, "reserved_later_slot_usd", "later", *base, amount=f["usd"],
                 detail="reserved post-release USD capacity")
        elif k == "own_cash_floor":
            emit([fid], fid, "own_cash_floor_sgd", "later", *base, amount=f["amount"],
                 detail="documented own-cash floor after all obligations")
        elif k == "fallback":
            emit([fid], fid, "fallback_net_usd", "later", *base, amount=f["usd"], detail="independent fallback")
        else:
            raise NotExpressible("%s: no original kind for %r" % (fid, k))

    # Standing translation notes (only when the relevant fact is present).
    kinds = {f["kind"] for f in facts}
    if "fee" in kinds:
        notes.append("fee: rail + processing is written as one fee_sgd per route (35 Friday / 45 Monday); the "
                     "original has no fee types.")
    if "slot" in kinds:
        notes.append("slot: the original computes instruction times in code (release - 5 / - 2 days, 15:00 SGT); "
                     "only the cutoff is a record (cutoff_sgt, HH:MM), with the slot fact's known_at.")
    if "quote" in kinds:
        notes.append("quote: one quote fact becomes two original records (sgd_per_usd + spread_bps) with the same "
                     "effective/known/valid times.")
    if "commitment_list" in kinds:
        notes.append("commitment_list: written as reservation_snapshot amount 1 (the original's completeness flag).")
    if "funding_rate" in kinds:
        notes.append("funding_rate: the original reads the 8% hurdle from an annual_rate record (0.08).")
    return rows, idmap, notes, {}


def to_csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()
