"""Provider funding lifecycle engine -- SIMULATED. No funds move.

Every party, facility, limit, fee, balance, date and event comes from the synthetic fixtures in
fixtures/lifecycle/*.json. Nothing here contacts a bank, provider or network.

Public API (see LIFECYCLE_CONTRACT.md)
    CASES, CASE_ORDER, LABEL
    initial_state(case_id) -> state
    apply(state, action_id) -> state        pure; a disabled/duplicate action returns the same state
    available_actions(state) -> [action]    each with enabled / disabled_reason / consequence / next
    view(state) -> dict                     the contract's View JSON
    check_invariants(state) -> [{name, ok, detail}]
    state_id(state) -> str                  hash of the canonical event log

Rules worth repeating
  * Money is decimal.Decimal with an explicit currency. SGD and USD are never added together.
    Rounding happens only when formatting (engine.replay.fmt_money).
  * A state is (case id, ordered event log). Everything else is derived by folding the log.
  * Every record carries effective_at and known_at. The view at the simulation clock shows only
    records with known_at <= clock. The clock moves only through explicit "Simulated event" actions.
  * Four independent facts: authorisation/reservation, cash movement, supplier delivery, repayment.
  * Eligibility is a list of deterministic rules, each ok / fail / unknown. There is no score.
"""

import copy
import hashlib
import json
import os
from datetime import datetime, timedelta
from decimal import Decimal

from engine.replay import SGT, fmt_money, fmt_ny, fmt_sgt

LABEL = "Simulated — no funds move."
STATE_CAP = 400  # reachable states per case; reachable() and tools/export_site.py both use it
ZERO = Decimal("0")
FIXTURES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "lifecycle")
CASE_ORDER = ("reference", "stale_balance", "fixed_terms", "no_cash", "competing", "failed_payout", "all_infeasible")
ALLOCATION_RULE = ("Each SGD repayment is applied to fees first, then to principal. Any amount above what is owed "
                   "is held as unmatched for review and never netted. Repayments in any other currency are held "
                   "as unmatched in their own currency.")
SIM_REVIEWER = "Reviewer (Simulated role)"
SIM_IMPORTER = "Importer (Simulated)"
OPERATOR = "Operator"
DISCLAIMER_ROLES = "Roles are simulated and are not authentication."


# --------------------------------------------------------------------------
# Money and time
# --------------------------------------------------------------------------
class Money:
    """An exact amount with an explicit currency. Adding different currencies raises."""
    __slots__ = ("currency", "amount")

    def __init__(self, currency, amount):
        if not isinstance(amount, Decimal):
            raise TypeError("Money amounts must be Decimal, never float")
        if currency not in ("SGD", "USD"):
            raise ValueError("Unknown currency %r" % currency)
        self.currency, self.amount = currency, amount

    @classmethod
    def parse(cls, obj):
        return cls(obj["currency"], Decimal(obj["amount"]))

    def _same(self, other):
        if self.currency != other.currency:
            raise ValueError("Refusing to combine %s with %s" % (self.currency, other.currency))

    def __add__(self, other):
        self._same(other)
        return Money(self.currency, self.amount + other.amount)

    def __sub__(self, other):
        self._same(other)
        return Money(self.currency, self.amount - other.amount)

    def text(self):
        return fmt_money(self.currency, self.amount)

    def raw(self):
        return {"amount": str(self.amount), "currency": self.currency}


def sgd(amount):
    return fmt_money("SGD", amount)


def _t(text):
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        raise ValueError("Timestamp without zone: %s" % text)
    return dt.astimezone(SGT)


def _iso(dt):
    return dt.astimezone(SGT).isoformat()


def _short(dt):
    """'Mon 16 Nov 16:00 SGT' for headlines."""
    s = fmt_sgt(dt)  # 'Mon 16 Nov 2026, 16:00 SGT'
    day, rest = s.split(", ")
    return day.rsplit(" ", 1)[0] + " " + rest


def _day(dt):
    """'Fri 13 Nov'."""
    return fmt_sgt(dt).split(",")[0].rsplit(" ", 1)[0]


def _hours(td):
    h = Decimal(int(td.total_seconds())) / Decimal(3600)
    return format(h.quantize(Decimal("0.1")).normalize(), "f")


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------
CASES = {}


def register_case(raw):
    """Validate and register a case fixture (dict as in fixtures/lifecycle/*.json)."""
    fx = copy.deepcopy(raw)
    for key in ("id", "name", "description", "start_clock", "importer", "supplier", "payout", "deadline",
                "windows", "contract", "evidence", "clock_steps", "simulated_events", "importer_repayments"):
        if key not in fx:
            raise ValueError("Case fixture %s is missing %s" % (raw.get("id"), key))
    if fx.get("synthetic") is not True:
        raise ValueError("Lifecycle fixtures must be labelled synthetic")
    fx["_start"] = _t(fx["start_clock"])
    fx["_deadline"] = _t(fx["deadline"])
    fx["_net"] = Money.parse(fx["payout"]["net"])
    fx["_cost"] = Money.parse(fx["payout"]["sgd_cost"])
    if fx["_net"].currency != "USD" or fx["_cost"].currency != "SGD":
        raise ValueError("Payout must be USD net with an SGD cost")
    for w in fx["windows"].values():
        w["_at"], w["_cutoff"] = _t(w["at"]), _t(w["cutoff"])
    fac = fx.get("facility")
    if fac:
        for k in ("company_limit", "fee"):
            m = Money.parse(fac[k])
            if m.currency != fac["denomination"] or m.currency != "SGD":
                raise ValueError("Facility amounts must be in the facility denomination (SGD)")
        fac["_limit"] = Money.parse(fac["company_limit"]).amount
        fac["_fee"] = Money.parse(fac["fee"]).amount
        fac["_due"] = _t(fac["repayment_due"])
        fac["_expiry"] = _t(fac["reservation_expiry"])
    fund = fx.get("funding_account")
    if fund:
        fund["_start"] = Money.parse(fund["start"]).amount
        fund["_others"] = Decimal("0")
        for o in fund["other_reservations"]:
            m = Money.parse(o["amount"])
            if m.currency != "SGD":
                raise ValueError("Funding reservations must be SGD")
            fund["_others"] += m.amount
    for e in fx["evidence"]:
        for k in ("id", "kind", "fact", "effective_at", "known_at", "status", "source"):
            if k not in e:
                raise ValueError("Evidence record %s is missing %s" % (e.get("id"), k))
        e["_eff"], e["_known"] = _t(e["effective_at"]), _t(e["known_at"])
        if "amount" in e:
            e["_money"] = Money.parse(e["amount"])
    for s in fx["clock_steps"]:
        s["_at"] = _t(s["at"])
    fx["clock_steps"].sort(key=lambda s: s["_at"])
    se = fx["simulated_events"]
    for k in ("credit", "return"):
        if se.get(k):
            se[k]["_eff"], se[k]["_known"] = _t(se[k]["effective_at"]), _t(se[k]["known_at"])
    fx["_repay_partial"] = Money.parse(fx["importer_repayments"]["partial"])
    fx["_repay_balance"] = Money.parse(fx["importer_repayments"]["balance"])
    rc = se.get("customer_receipt")
    if rc:
        rc["_eff"], rc["_known"], rc["_money"] = _t(rc["effective_at"]), _t(rc["known_at"]), Money.parse(rc["amount"])
    CASES[fx["id"]] = fx
    return fx


def _load_cases():
    for cid in CASE_ORDER:
        with open(os.path.join(FIXTURES_DIR, cid + ".json"), encoding="utf8") as fh:
            register_case(json.load(fh))


_load_cases()


def case_meta(case_id):
    fx = CASES[case_id]
    return {"id": fx["id"], "name": fx["name"], "description": fx["description"]}


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------
def initial_state(case_id):
    if case_id not in CASES:
        raise KeyError("Unknown case %s" % case_id)
    return {"case": case_id, "events": []}


def state_id(state):
    canon = json.dumps({"case": state["case"], "events": state["events"]}, sort_keys=True,
                       separators=(",", ":"), ensure_ascii=True)
    return "s" + hashlib.sha256(canon.encode("ascii")).hexdigest()[:12]


class D:
    """Derived (folded) state. Internal only."""


def _derive(state):
    fx = CASES[state["case"]]
    fac = fx.get("facility")
    d = D()
    d.fx, d.fac, d.fund = fx, fac, fx.get("funding_account")
    d.clock = fx["_start"]
    d.auth = "none"
    d.auth_at = None
    d.request = None
    d.reservation = None          # event dict while reserved
    d.res_limit = ZERO            # our reserved company limit (SGD)
    d.res_cash = ZERO             # our reserved funding cash (SGD)
    d.rules_snapshot = None
    d.release = None              # event dict
    d.decline = None
    d.draw = None
    d.drawn = ZERO
    d.fees_charged = ZERO
    d.principal_repaid = ZERO
    d.fees_repaid = ZERO
    d.selected = None             # 'A' | 'C'
    d.delivery = "none"
    d.instruct = d.accept = d.credit = d.ret = None
    d.conflict = None             # open conflict event
    d.conflict_resolved = None
    d.repayments = []             # matched (allocated) repayments
    d.incoming = []               # received by the provider, not yet matched
    d.receipts = []               # customer receipts into the importer's own account (never repayment)
    d.unmatched = []              # dicts {id, money, reason, status}
    d.closed = None
    d.extra_evidence = []         # evidence records created by events
    d.timeline = []               # dynamic timeline entries
    d.counts = {}
    d.missed_expiry = None
    for ev in state["events"]:
        typ = ev["type"]
        d.counts[typ] = d.counts.get(typ, 0) + 1
        if typ == "incoming":
            key = "incoming_" + ev["sub"]
            d.counts[key] = d.counts.get(key, 0) + 1
        known = _t(ev["known_at"])
        if known > d.clock:
            d.clock = known
        if typ == "clock":
            d.timeline.append(_tl(ev, "Simulation clock advanced to %s." % fmt_sgt(known)))
        elif typ == "request":
            d.auth, d.auth_at, d.request = "requested", known, ev
            d.timeline.append(_tl(ev, "Operator requested an advance of %s on %s." % (sgd(fx["_cost"].amount), fac["id"])))
        elif typ == "evidence_request":
            d.auth = "evidence_requested"
            d.timeline.append(_tl(ev, "Reviewer asked the importer for a bank balance no more than %d h old."
                                  % fx["balance_max_age_hours"]))
        elif typ == "fresh_balance":
            d.auth = "requested"
            rec = {"id": ev["id"], "kind": "importer_balance", "fact": "Northwind Foods SG settled bank balance %s, sent on request."
                   % Money.parse(ev["money"]).text(), "source": ev["source"], "_eff": _t(ev["effective_at"]),
                   "_known": known, "status": "settled", "_money": Money.parse(ev["money"])}
            d.extra_evidence.append(rec)
            d.timeline.append(_tl(ev, "Importer sent a newer bank balance (%s)." % ev["id"]))
        elif typ == "reserve":
            d.auth, d.auth_at, d.reservation = "reserved", known, ev
            amt = Decimal(ev["amount"])
            d.res_limit, d.res_cash = amt, amt
            d.rules_snapshot = ev["rules"]
            d.selected = "C"
            d.extra_evidence.append(_rec(ev, "reservation", "Reservation %s: %s of company limit and %s of provider funding cash reserved for this payout."
                                         % (ev["id"], sgd(amt), sgd(amt)), "reserved"))
            d.timeline.append(_tl(ev, "Reviewer approved and reserved %s of limit and %s of funding cash (%s)."
                                  % (sgd(amt), sgd(amt), ev["id"])))
        elif typ == "decline":
            d.auth, d.decline = "declined", ev
            d.timeline.append(_tl(ev, "Reviewer declined the advance request. Nothing was reserved."))
        elif typ == "release":
            d.auth, d.release = "released", ev
            d.selected = None
            d.timeline.append(_tl(ev, ev["text"]))
            d.res_limit, d.res_cash = ZERO, ZERO
        elif typ == "draw":
            d.auth, d.draw = "consumed", ev
            d.drawn = Decimal(ev["amount"])
            d.fees_charged = Decimal(ev["fee"])
            d.res_limit, d.res_cash = ZERO, ZERO
            d.extra_evidence.append(_rec(ev, "draw", "Advance %s drawn: principal %s paid out of the provider funding account; fee %s charged separately."
                                         % (ev["id"], sgd(d.drawn), sgd(d.fees_charged)), "recorded"))
            d.timeline.append(_tl(ev, "Operator drew the advance: principal %s, fee %s (%s). The reservation is consumed."
                                  % (sgd(d.drawn), sgd(d.fees_charged), ev["id"])))
        elif typ == "select_a":
            d.selected = "A"
            d.timeline.append(_tl(ev, "Operator recorded Option A: the importer funds the Friday window from its own cash."))
        elif typ == "instruct":
            d.delivery, d.instruct = "instructed", ev
            d.extra_evidence.append(_rec(ev, "payout_instruction", "Payout instruction %s: %s net to %s, funded by %s."
                                         % (ev["id"], fx["_net"].text(), fx["supplier"], ev["funded_by"]), "instructed"))
            d.timeline.append(_tl(ev, "Operator instructed the supplier payout %s (%s)." % (fx["_net"].text(), ev["id"])))
        elif typ == "accept":
            d.delivery, d.accept = "accepted", ev
            d.extra_evidence.append(_rec(ev, "provider_acceptance", "Provider accepted payout instruction %s for release. Acceptance is not beneficiary credit."
                                         % d.instruct["id"], "accepted"))
            d.timeline.append(_tl(ev, "Provider accepted the payout instruction (%s). Not yet credited to the supplier." % ev["id"]))
        elif typ == "credit":
            d.delivery, d.credit = "credited", ev
            d.extra_evidence.append(_rec(ev, "beneficiary_credit", "%s credited %s on %s (delivery record)."
                                         % (fx["supplier"], fx["_net"].text(), fmt_sgt(_t(ev["effective_at"]))), "credited"))
            d.timeline.append(_tl(ev, "Delivery record: %s credited %s (%s)." % (fx["supplier"], fx["_net"].text(), ev["id"])))
        elif typ == "return":
            d.delivery, d.ret = "returned", ev
            d.extra_evidence.append(_rec(ev, "payout_return", ev["text"], "returned"))
            d.timeline.append(_tl(ev, "Payout returned (%s). No second payment is sent automatically." % ev["id"]))
        elif typ == "conflict":
            d.conflict = ev
            d.extra_evidence.append(_rec(ev, "supplier_message", ev["text"], "conflicts with %s" % d.credit["id"]))
            d.timeline.append(_tl(ev, "Conflicting evidence: " + ev["text"]))
        elif typ == "resolve_conflict":
            d.conflict, d.conflict_resolved = None, ev
            d.extra_evidence.append(_rec(ev, "trace", ev["text"], "resolves conflict"))
            d.timeline.append(_tl(ev, "Reviewer resolved the conflict: " + ev["text"]))
        elif typ == "receipt":
            rec = _rec(ev, "customer_receipt", ev["fact"], "settled")
            rec["_money"] = Money.parse(ev["money"])
            d.receipts.append(rec)
            d.extra_evidence.append(rec)
            d.timeline.append(_tl(ev, "Customer receipt %s recorded in %s's own account (%s). Not a repayment."
                                  % (rec["_money"].text(), fx["importer"], ev["id"])))
        elif typ == "incoming":
            m = Money.parse(ev["money"])
            d.incoming.append({"id": ev["id"], "money": m, "_at": known})
            d.extra_evidence.append(_rec(ev, "incoming_repayment", "%s received by the provider on the repayment reference (%s). "
                                         "Not allocated until matched." % (m.text(), ev["id"]), "received"))
            d.timeline.append(_tl(ev, "Provider received %s on the repayment reference (%s); not yet matched." % (m.text(), ev["id"])))
        elif typ == "match":
            for inc in d.incoming:
                _allocate(d, ev, inc, known)
            d.incoming = []
        elif typ == "return_unmatched":
            for u in d.unmatched:
                if u["status"] == "open":
                    u["status"] = "returned to payer"
            d.timeline.append(_tl(ev, "Reviewer returned all unmatched items to the payer. Nothing was netted."))
        elif typ == "close":
            d.closed = ev
            d.timeline.append(_tl(ev, "Operator closed the case."))
        elif typ == "expire":
            d.auth, d.release = "released", ev
            d.selected = None
            d.res_limit, d.res_cash = ZERO, ZERO
            d.timeline.append(_tl(ev, ev["text"]))
        else:  # pragma: no cover
            raise ValueError("Unknown event type %s" % typ)
    d.principal_out = d.drawn - d.principal_repaid
    d.fees_out = d.fees_charged - d.fees_repaid
    d.total_out = d.principal_out + d.fees_out
    d.open_unmatched = [u for u in d.unmatched if u["status"] == "open"]
    return d


def _tl(ev, text):
    return {"_at": _t(ev["effective_at"]), "_known": _t(ev["known_at"]), "actor": ev["actor"], "text": text}


def _rec(ev, kind, fact, status):
    return {"id": ev["id"], "kind": kind, "fact": fact, "source": ev.get("source", "simulation: " + ev["actor"]),
            "_eff": _t(ev["effective_at"]), "_known": _t(ev["known_at"]), "status": status}


def _allocate(d, ev, inc, known):
    money = inc["money"]
    rid = inc["id"]
    rec = {"id": rid, "money": money, "_at": known, "received_at": inc["_at"], "fees": ZERO, "principal": ZERO, "unmatched": ZERO}
    if money.currency != "SGD":
        rec["unmatched"] = money.amount
        d.unmatched.append({"id": rid, "money": money, "status": "open",
                            "reason": "Wrong currency: %s received; repayments are matched in SGD only." % money.currency})
        text = "Matching %s: wrong currency (%s); held as unmatched, not converted or netted." % (rid, money.text())
    else:
        left = money.amount
        fees = min(left, d.fees_charged - d.fees_repaid)
        left -= fees
        principal = min(left, d.drawn - d.principal_repaid)
        left -= principal
        d.fees_repaid += fees
        d.principal_repaid += principal
        rec.update(fees=fees, principal=principal, unmatched=left)
        if left > 0:
            d.unmatched.append({"id": rid + "-X", "money": Money("SGD", left), "status": "open",
                                "reason": "Excess: %s more than was owed; held for review, not netted." % sgd(left)})
        text = "Matched %s (%s): fees %s, then principal %s%s." % (
            rid, money.text(), sgd(fees), sgd(principal),
            "; unmatched excess %s" % sgd(left) if left > 0 else "")
    d.repayments.append(rec)
    mrec = _rec(ev, "repayment_match", text, "matched" if rec["unmatched"] == 0 else "partly unmatched"
                if rec["fees"] + rec["principal"] > 0 else "unmatched")
    mrec["id"] = "MAT-" + rid
    d.extra_evidence.append(mrec)
    d.timeline.append(_tl(ev, text))


# --------------------------------------------------------------------------
# Evidence visibility
# --------------------------------------------------------------------------
def _visible_fixture(d):
    return [e for e in d.fx["evidence"] if e["_known"] <= d.clock]


def _all_visible(d):
    return _visible_fixture(d) + [e for e in d.extra_evidence if e["_known"] <= d.clock]


def _ev_ids(d, kind):
    return [e["id"] for e in _all_visible(d) if e["kind"] == kind]


def _latest_balance(d):
    bals = [e for e in _all_visible(d) if e["kind"] == "importer_balance" and e["status"] == "settled"]
    return max(bals, key=lambda e: e["_eff"]) if bals else None


def _receipts(d):
    return [e for e in d.receipts if e["_known"] <= d.clock]


def _balance_check(d):
    """(ok True/None, detail, record)."""
    bal = _latest_balance(d)
    limit = d.fx["balance_max_age_hours"]
    if bal is None:
        return None, "No importer bank balance on record.", None
    age = d.clock - bal["_eff"]
    if age <= timedelta(hours=limit):
        return True, "%s balance %s is %s h old (limit %d h)." % (bal["id"], bal["_money"].text(), _hours(age), limit), bal
    return None, ("%s balance is %s h old (limit %d h). This is unknown, not insufficient: a newer balance is needed."
                  % (bal["id"], _hours(age), limit)), bal


# --------------------------------------------------------------------------
# Facility arithmetic and rules
# --------------------------------------------------------------------------
def _company_available(d):
    return d.fac["_limit"] - d.res_limit - d.principal_out


def _funding_reserved(d):
    return (d.fund["_others"] if d.fund else ZERO) + d.res_cash


def _funding_available(d):
    return d.fund["_start"] - _funding_reserved(d) - d.principal_out


def _rules(d):
    """Deterministic eligibility for Option C at the clock: list of {rule, ok, detail, group}."""
    fx, fac, need = d.fx, d.fac, d.fx["_cost"].amount
    out = []
    active = fac["status"] == "active"
    out.append({"group": "Authorised to lend", "rule": "Facility active (Simulated %s, %s)" % (fac["id"], fac["policy_version"]),
                "ok": active, "detail": "Active." if active else "Facility is %s for new advances." % fac["status"]})
    avail = _company_available(d)
    out.append({"group": "Authorised to lend", "rule": "Company limit headroom covers the advance",
                "ok": avail >= need, "detail": "Available %s of %s limit; advance needs %s." % (sgd(avail), sgd(fac["_limit"]), sgd(need))})
    ok, detail, _ = _balance_check(d)
    brule = {"group": "Authorised to lend", "rule": "Importer bank balance no more than %d h old" % fx["balance_max_age_hours"],
             "ok": ok, "detail": detail}
    bal = _latest_balance(d)
    if ok is None and bal:
        brule["short"] = "Importer balance is %s h old (limit %d h): need a newer one, not insufficient." % (
            _hours(d.clock - bal["_eff"]), fx["balance_max_age_hours"])
    out.append(brule)
    before = d.clock < fac["_expiry"]
    out.append({"group": "Authorised to lend", "rule": "Draw and payout instruction possible before %s" % _short(fac["_expiry"]),
                "ok": before, "detail": ("Release %s precedes the supplier deadline %s." % (_short(_t(fx["release_checkpoint"])), _short(fx["_deadline"]))
                                         if before else "The draw cutoff %s has passed." % _short(fac["_expiry"]))})
    favail = _funding_available(d)
    others = d.fund["_others"]
    detail = "Deployable %s of %s; advance needs %s." % (sgd(favail), sgd(d.fund["_start"]), sgd(need))
    if others > 0:
        detail += " %s is already reserved for other payouts (%s)." % (
            sgd(others), ", ".join(o["id"] for o in d.fund["other_reservations"]))
    short = "Deployable cash %s < %s needed" % (sgd(favail), sgd(need))
    if others > 0:
        short += "; %s reserved for another payout" % sgd(others)
    out.append({"group": "Cash available to pay", "rule": "Provider funding account has deployable cash for the advance",
                "ok": favail >= need, "detail": detail, "short": short + "."})
    return out


def _rules_json(rules):
    return [{"rule": r["rule"], "ok": r["ok"], "detail": r["detail"], "group": r["group"]} for r in rules]


def _rules_state(rules):
    if any(r["ok"] is False for r in rules):
        return "fail"
    if any(r["ok"] is None for r in rules):
        return "unknown"
    return "ok"


def _cash_rule_failed(rules):
    return any(r["ok"] is False and r["group"] == "Cash available to pay" for r in rules) and \
        all(r["ok"] is not False for r in rules if r["group"] == "Authorised to lend")


# --------------------------------------------------------------------------
# Options
# --------------------------------------------------------------------------
def _option_a(d):
    fx = d.fx
    w = fx["windows"]["friday"]
    dis, unknown = [], []
    if d.clock >= w["_cutoff"] and d.selected != "A":
        dis.append("The Friday window cutoff %s has passed." % _short(w["_cutoff"]))
    ok, detail, bal = _balance_check(d)
    if ok is None:
        unknown.append("Importer balance %s is %s h old (limit %d h): unknown, need a newer one." % (
            bal["id"], _hours(d.clock - bal["_eff"]), fx["balance_max_age_hours"]) if bal else detail)
    elif bal["_money"].amount < fx["_cost"].amount:
        dis.append("Importer balance %s is below the %s needed." % (bal["_money"].text(), fx["_cost"].text()))
    status = "infeasible" if dis else "unknown" if unknown else "feasible"
    ev = [w["evidence"], "QTE-NW-01"] + ([bal["id"]] if bal else [])
    return {"key": "A", "title": "Importer funds Friday", "status": status,
            "whose_money": "Importer's own cash",
            "committed_at": _short(w["_at"]), "amount": fx["_cost"].text(),
            "duration": "%s → %s (cash tied up)" % (_day(w["_at"]), _day(fx["_deadline"])),
            "modeled_cost": "Not modelled (cost of cash unknown)",
            "risk_bearer": "Importer",
            "evidence": ev, "disqualifiers": dis + unknown}


def _option_b(d):
    fx = d.fx
    w = fx["windows"]["monday"]
    dis = []
    if not fx["contract"]["later_funding_permitted"]:
        dis.append("Contract %s fixes prefunding at the Friday window; later funding is not permitted." % fx["contract"]["evidence"])
    supports = [e for e in _all_visible(d) if e["kind"] == "cash_support" and e["status"] == "documented"]
    if not supports:
        fc = [e for e in _visible_fixture(d) if e["kind"] == "forecast_receipt"]
        txt = "No documented cash support for %s." % _day(w["_at"])
        if fc:
            txt = "No documented cash support for %s; the %s forecast (%s) does not count." % (
                _day(w["_at"]), _day(fc[0]["_eff"]), fc[0]["id"])
        dis.append(txt)
    if d.clock >= w["_cutoff"]:
        dis.append("The later window cutoff %s has passed." % _short(w["_cutoff"]))
    ev = [fx["contract"]["evidence"], w["evidence"]] + [e["id"] for e in supports] + \
        [e["id"] for e in _visible_fixture(d) if e["kind"] == "forecast_receipt"]
    return {"key": "B", "title": "Importer funds Monday (no advance)", "status": "infeasible" if dis else "feasible",
            "whose_money": "Importer's own cash, later",
            "committed_at": _short(w["_at"]), "amount": fx["_cost"].text(),
            "duration": "%s → %s (cash tied up)" % (_day(w["_at"]), _day(fx["_deadline"])),
            "modeled_cost": "Not modelled (cost of cash unknown)",
            "risk_bearer": "Importer and supplier (deadline)",
            "evidence": ev, "disqualifiers": dis}


def _option_c(d):
    fx, fac = d.fx, d.fac
    base = {"key": "C", "title": "Provider advance (Simulated)", "whose_money": "Provider funding account (Simulated)",
            "amount": fx["_cost"].text(), "risk_bearer": "Provider, until repaid and matched",
            "evidence": [], "disqualifiers": []}
    if not fac:
        base.update(status="unavailable", committed_at="—", duration="—", modeled_cost="—",
                    disqualifiers=["No advance facility exists for this importer (Simulated)."])
        return base
    base["evidence"] = list(fac["evidence"]) + [d.fund["evidence"]] + [o["id"] for o in d.fund["other_reservations"]]
    bal = _latest_balance(d)
    if bal:
        base["evidence"].append(bal["id"])
    base.update(committed_at="At draw, by %s" % _short(fac["_expiry"]),
                amount="%s + %s fee" % (sgd(fx["_cost"].amount), sgd(fac["_fee"])),
                duration="Draw → due %s" % _short(fac["_due"]),
                modeled_cost="%s flat fee (Simulated)" % sgd(fac["_fee"]))
    if d.draw:
        base["committed_at"] = "Drawn " + _short(_t(d.draw["known_at"]))
    if d.auth in ("reserved", "consumed"):
        base["status"] = "selected"
        return base
    if fac["status"] != "active":
        base.update(status="unavailable", disqualifiers=["Facility %s is %s for new advances (Simulated)." % (fac["id"], fac["status"])])
        return base
    if d.auth == "declined":
        base.update(status="infeasible", disqualifiers=["Declined by the reviewer at %s." % fmt_sgt(_t(d.decline["known_at"]))])
        return base
    if d.auth == "released":
        base.update(status="infeasible", disqualifiers=[d.release["text"]])
        return base
    rules = _rules(d)
    st = _rules_state(rules)
    base["status"] = {"ok": "feasible", "unknown": "unknown", "fail": "infeasible"}[st]
    base["disqualifiers"] = [r.get("short", r["detail"]) for r in rules if r["ok"] is not True]
    return base


def _options(d):
    opts = [_option_a(d), _option_b(d), _option_c(d)]
    sel = d.selected
    if sel:
        for o in opts:
            o["status"] = "selected" if o["key"] == sel else "not_selected"
    feasible = [o["key"] for o in opts if o["status"] == "feasible"]
    if sel:
        note = ("Option %s is selected. Costs are not ranked: the importer's cost of cash is not on record, so it "
                "cannot be compared with the provider fee." % sel)
    elif len(feasible) > 1:
        note = ("Costs are not ranked: Option A uses the importer's own cash (its cost of cash is not on record) and "
                "Option C carries a flat provider fee. They are different kinds of cost, so no option is called cheaper.")
    elif len(feasible) == 1:
        note = "Only Option %s is feasible on the evidence known at this clock; there is nothing to compare." % feasible[0]
    else:
        note = "No option is feasible on the evidence known at this clock; no costs are compared."
    return opts, note


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------
def _ev(d, typ, actor, **kw):
    at = kw.pop("_at", d.clock)
    known = kw.pop("_known", at)
    e = {"type": typ, "actor": actor, "effective_at": _iso(at), "known_at": _iso(known)}
    e.update(kw)
    return e


def _next_step(d):
    for s in d.fx["clock_steps"]:
        if s["_at"] > d.clock:
            return s
    return None


def _fresh_balance_event(d):
    fb = d.fx["simulated_events"]["fresh_balance"]
    at = d.clock + timedelta(minutes=fb["delay_minutes"])
    n = d.counts.get("fresh_balance", 0)
    return _ev(d, "fresh_balance", SIM_IMPORTER, _at=at, id=fb["id"] + ("" if n == 0 else "-%d" % (n + 1)),
               money=fb["amount"], source=fb["source"])


def _accept_event(d):
    acc = d.fx["simulated_events"]["acceptance"]
    return _ev(d, "accept", "Provider (Simulated)", id=acc["id"], source=acc["source"])


def _outcome(d):
    """The fixture's delivery outcome record: ('credit'|'return', record) or (None, None)."""
    se = d.fx["simulated_events"]
    if se.get("credit"):
        return "credit", se["credit"]
    if se.get("return"):
        return "return", se["return"]
    return None, None


def _outcome_event(d):
    kind, rec = _outcome(d)
    known = max(d.clock, rec["_known"])
    extra = {"text": rec["text"]} if kind == "return" else {}
    return _ev(d, kind, "Beneficiary bank (Simulated)", _at=rec["_eff"], _known=known, id=rec["id"], source=rec["source"], **extra)


def _advance_events(d, target, clock_event):
    """Moving the clock: responses already due by the target are recorded first (exactly as the explicit
    Simulated event would record them, so both paths reach the same state), then the clock event, then the
    reservation expiry evaluated at the new clock."""
    out = []
    if d.auth == "evidence_requested":
        fb = _fresh_balance_event(d)
        if _t(fb["known_at"]) <= target:
            out.append(fb)
    if d.delivery == "instructed":
        out.append(_accept_event(d))
    kind, rec = _outcome(d)
    if kind and d.delivery in ("instructed", "accepted") and rec["_known"] <= target:
        out.append(_outcome_event(d))
    out.append(clock_event)
    if d.auth == "reserved" and d.fac and target >= d.fac["_expiry"]:
        out.append(_ev(d, "expire", "System", _at=d.fac["_expiry"], _known=target, id="EXP-" + d.reservation["id"],
                       text="Reservation %s expired unused at %s; %s of limit and %s of funding cash released."
                       % (d.reservation["id"], fmt_sgt(d.fac["_expiry"]), sgd(d.res_limit), sgd(d.res_cash))))
    return out


def _dup(label_done):
    return False, "Already done: %s. Doing it again would change nothing." % label_done


def _action_specs(d):
    """List of (spec, builder). spec has id, label, role, enabled, disabled_reason, consequence."""
    fx, fac = d.fx, d.fac
    need = fx["_cost"].amount
    specs = []

    def add(aid, label, role, enabled, reason, consequence, build):
        specs.append(({"id": aid, "label": label, "role": role, "enabled": bool(enabled),
                       "disabled_reason": None if enabled else reason, "consequence": consequence}, build))

    closed = d.closed is not None
    if closed:
        add("close", "Close case", "Operator", False, "The case is already closed.",
            "No change.", None)
        return specs

    rules = _rules(d) if fac else None
    # ---- Authorisation / reservation -------------------------------------
    if fac and fac["status"] == "active":
        if d.auth == "none" and d.selected is None:
            ok = d.clock < fac["_expiry"]
            add("request_advance", "Request advance", "Operator", ok,
                "The draw cutoff %s has passed." % _short(fac["_expiry"]),
                "Asks the reviewer (Simulated role) to approve %s on %s. Nothing is reserved yet." % (sgd(need), fac["id"]),
                lambda: [_ev(d, "request", OPERATOR, id="REQ-NW-01")])
        if d.auth in ("requested", "evidence_requested", "reserved", "consumed"):
            if d.auth in ("reserved", "consumed"):
                en, reason = _dup("approved and reserved (%s)" % d.reservation["id"] if d.reservation else "approved")
            elif d.auth == "evidence_requested":
                en, reason = False, "Waiting for the newer bank balance the reviewer requested."
            else:
                st = _rules_state(rules)
                en = st == "ok"
                reason = "; ".join("%s: %s" % (r["rule"], r["detail"]) for r in rules if r["ok"] is not True)
                if st == "unknown":
                    reason = "We need a newer bank balance before reviewing this advance. " + reason
                elif _cash_rule_failed(rules):
                    reason = "Credit headroom exists but the provider cannot pay: " + reason + " Refer to provider treasury."
            add("approve_reserve", "Reserve capacity", "Reviewer", en, reason,
                "Approves the advance and reserves %s of company limit and %s of provider funding cash under %s "
                "(Simulated), once. It does not draw cash or pay the supplier. Expires unused at %s."
                % (sgd(need), sgd(need), fac["id"], _short(fac["_expiry"])),
                lambda: [_ev(d, "reserve", SIM_REVIEWER, id="RES-NW-01", amount=str(need), rules=_rules_json(rules))])
        if d.auth == "requested" and rules and _rules_state(rules) == "unknown":
            add("request_evidence", "Request evidence", "Reviewer", True, None,
                "Asks the importer for a settled balance no more than %d h old. Nothing is reserved." % fx["balance_max_age_hours"],
                lambda: [_ev(d, "evidence_request", SIM_REVIEWER, id="EVQ-NW-%02d" % (d.counts.get("evidence_request", 0) + 1))])
        if d.auth == "evidence_requested":
            fb = fx["simulated_events"]["fresh_balance"]
            at = d.clock + timedelta(minutes=fb["delay_minutes"])
            add("sim_fresh_balance", "Importer sends a newer bank balance (%s)" % _short(at), "Simulated event", True, None,
                "Adds a settled balance of %s as of %s and moves the clock there." % (Money.parse(fb["amount"]).text(), _short(at)),
                lambda: [_fresh_balance_event(d)])
        if d.auth in ("requested", "evidence_requested"):
            add("decline", "Decline", "Reviewer", True, None,
                "Declines the advance. Nothing was reserved; the importer must fund at the original window or the payout does not go ahead.",
                lambda: [_ev(d, "decline", SIM_REVIEWER, id="DEC-NW-01")])
        if d.auth == "reserved":
            add("release", "Withdraw approval and release reservation", "Reviewer", True, None,
                "Releases the unused %s of limit and %s of funding cash." % (sgd(d.res_limit), sgd(d.res_cash)),
                lambda: [_ev(d, "release", SIM_REVIEWER, id="REL-RES-NW-01",
                             text="Reviewer withdrew approval; reservation %s released unused (%s of limit, %s of funding cash)."
                             % (d.reservation["id"], sgd(d.res_limit), sgd(d.res_cash)))])
        if d.auth == "consumed":
            add("release", "Withdraw approval and release reservation", "Reviewer", False,
                "The advance is already drawn: principal %s stays outstanding until repaid. Cancelling cannot erase it."
                % sgd(d.principal_out), "No change.", None)
        # ---- Cash movement ----------------------------------------------
        if d.auth == "reserved":
            ok = d.clock < fac["_expiry"]
            add("draw", "Record simulated draw", "Operator", ok, "The reservation expired at %s." % _short(fac["_expiry"]),
                "Moves %s from the reservation to outstanding principal and charges the %s fee." % (sgd(need), sgd(fac["_fee"])),
                lambda: [_ev(d, "draw", OPERATOR, id="DRW-NW-01", amount=str(need), fee=str(fac["_fee"]))])
        elif d.auth == "consumed":
            add("draw", "Record simulated draw", "Operator", *(_dup("drawn (%s)" % d.draw["id"])), "No change.", None)
    # ---- Option A ---------------------------------------------------------
    if d.selected is None and d.auth in ("none", "declined", "released"):
        a = _option_a(d)
        add("select_a", "Record Option A: importer funds the Friday window", "Operator", a["status"] == "feasible",
            "Option A is %s: %s" % (a["status"], " ".join(a["disqualifiers"])),
            "Records that %s funds %s from its own cash. No advance is used." % (fx["importer"], fx["_cost"].text()),
            lambda: [_ev(d, "select_a", OPERATOR, id="SEL-A-01")])
    # ---- Delivery ---------------------------------------------------------
    funded = d.auth == "consumed" or d.selected == "A"
    if funded:
        cutoff = fx["windows"]["friday"]["_cutoff"] if d.selected == "A" else fac["_expiry"]
        if d.delivery == "none":
            ok = d.clock < cutoff
            add("instruct", "Instruct payout", "Operator", ok,
                "The payout cutoff %s has passed; a late instruction would miss the release." % _short(cutoff),
                "Sends one payout instruction to the provider. It is not supplier credit.",
                lambda: [_ev(d, "instruct", OPERATOR, id="PAY-NW-01",
                             funded_by="advance DRW-NW-01" if d.selected == "C" else "the importer's own cash (Option A)")])
        elif d.delivery == "returned":
            add("instruct", "Instruct payout", "Operator", False,
                "The payout was returned (%s). No second payment is sent automatically; a new instruction needs fresh review."
                % d.ret["id"], "No change.", None)
        else:
            add("instruct", "Instruct payout", "Operator",
                *(_dup("instructed (%s)" % d.instruct["id"])), "No change.", None)
        if d.delivery == "instructed":
            add("sim_accept", "Provider accepts payout", "Simulated event", True, None,
                "Records provider acceptance at the current clock. Acceptance is not beneficiary credit.",
                lambda: [_accept_event(d)])
        elif d.delivery in ("accepted", "credited", "returned"):
            add("sim_accept", "Provider accepts payout", "Simulated event",
                *(_dup("accepted by the provider (%s)" % d.accept["id"])), "No change.", None)
        cr, rt = fx["simulated_events"].get("credit"), fx["simulated_events"].get("return")
        if d.delivery == "accepted" and cr:
            known = max(d.clock, cr["_known"])
            add("sim_credit", "Record beneficiary credit", "Simulated event", True, None,
                "Adds the delivery record that %s was credited %s; moves the clock to %s." % (fx["supplier"], fx["_net"].text(), _short(known)),
                lambda: [_outcome_event(d)])
        elif d.delivery == "credited":
            add("sim_credit", "Record beneficiary credit", "Simulated event", *(_dup("beneficiary credit recorded (%s)" % d.credit["id"])),
                "No change.", None)
        if d.delivery == "accepted" and rt:
            known = max(d.clock, rt["_known"])
            add("sim_return", "Beneficiary bank returns the payout (%s)" % _short(rt["_eff"]), "Simulated event", True, None,
                "Records the return; the case stays open with a named recovery owner. Moves the clock to %s." % _short(known),
                lambda: [_outcome_event(d)])
        cf = fx["simulated_events"].get("conflict")
        if cf and d.delivery == "credited":
            # The supplier query arrives once nothing else is pending (end of the journey, before close).
            if d.conflict is None and d.conflict_resolved is None and d.total_out == 0 and not d.unmatched and not d.incoming:
                add("sim_conflict", "Supplier says the funds are not visible", "Simulated event", True, None,
                    "Adds conflicting evidence; the case goes to review and cannot close until resolved.",
                    lambda: [_ev(d, "conflict", "Supplier (Simulated)", id=cf["id"], text=cf["text"], source=cf["source"])])
            if d.conflict is not None:
                add("resolve_conflict", "Resolve conflict with beneficiary bank trace", "Reviewer", True, None,
                    "Records the trace %s confirming credit; the conflict no longer blocks close." % cf["resolve_id"],
                    lambda: [_ev(d, "resolve_conflict", SIM_REVIEWER, id=cf["resolve_id"], text=cf["resolve_text"],
                                 source="synthetic: beneficiary bank trace (Simulated)")])
    # ---- Customer receipt (importer's own account) and repayment ---------
    rc = fx["simulated_events"].get("customer_receipt")
    if rc and d.auth == "consumed" and d.clock >= rc["_known"]:  # never listed before it is known
        if d.receipts:
            add("sim_receipt", "Record customer receipt (importer's account)", "Simulated event",
                *(_dup("customer receipt recorded (%s)" % rc["id"])), "No change.", None)
        else:
            known = max(d.clock, rc["_known"])
            add("sim_receipt", "Record customer receipt (importer's account)", "Simulated event", d.clock >= rc["_known"],
                "No settled customer receipt is on record before %s (the forecast does not count)." % _short(rc["_known"]),
                "Records %s settled into %s's own account. This is the importer's cash, not a repayment." % (
                    rc["_money"].text(), fx["importer"]),
                lambda: [_ev(d, "receipt", SIM_IMPORTER, _at=rc["_eff"], _known=known, id=rc["id"], money=rc["amount"],
                             fact=rc["fact"], source=rc["source"])])
    if d.auth == "consumed":
        gate = None if _receipts(d) else ("Simulation: the importer pays the provider after its customer receipt is recorded; "
                                          "none is recorded yet.")
        n = d.counts.get("incoming", 0) + 1
        part, bal = fx["_repay_partial"], fx["_repay_balance"]

        def pay(aid, sub, money, label, extra_gate=None, source=None, actor=SIM_IMPORTER):
            if d.counts.get("incoming_" + sub):
                add(aid, label, "Simulated event", *(_dup("%s received" % money.text())), "No change.", None)
                return
            g = gate or extra_gate
            if g is None and d.incoming:
                g = "Match the payment already received (%s) first." % d.incoming[0]["id"]
            if g is None and d.total_out == 0:
                g = "Nothing is outstanding; a further payment would be excess."
            kw = {"source": source} if source else {}
            add(aid, label, "Simulated event", g is None, g,
                "The provider receives %s on the repayment reference. It is not allocated until the operator matches it."
                % money.text(),
                lambda: [_ev(d, "incoming", actor, id="RPY-NW-%02d" % n, money=money.raw(), sub=sub, **kw)])

        pay("sim_pay_partial", "partial", part, "Importer pays provider %s" % part.text())
        partial_done = bool(d.counts.get("incoming_partial")) and not any(
            i for i in d.incoming if i["money"].currency == "SGD" and i["money"].amount == part.amount)
        pay("sim_pay_balance", "balance", bal, "Importer pays provider %s (balance)" % bal.text(),
            extra_gate=None if partial_done else "The balance is paid after the %s payment is matched." % part.text())
        wc = fx["simulated_events"].get("wrong_currency")
        if wc:
            wm = Money.parse(wc["amount"])
            sgd_paid = any(r["money"].currency == "SGD" for r in d.repayments)
            pay("sim_pay_usd", "wrong", wm, "Importer pays provider %s" % wm.text(), source=wc["source"],
                extra_gate="Simulation: the wrong-currency payment arrives only before any SGD repayment." if sgd_paid else None)
        if d.incoming:
            add("match_repayment", "Match repayment", "Operator", True, None,
                "Allocates %s: fees first, then principal. Other currencies and any excess stay unmatched and block close."
                % ", ".join(i["money"].text() for i in d.incoming),
                lambda: [_ev(d, "match", OPERATOR, id="MAT-%02d" % (d.counts.get("match", 0) + 1))])
        elif d.repayments:
            add("match_repayment", "Match repayment", "Operator", False,
                "Nothing unallocated to match; every received payment is already matched.", "No change.", None)
    if d.open_unmatched:
        add("return_unmatched", "Return unmatched amount", "Reviewer", d.total_out == 0 and not d.incoming,
            "Unmatched amounts stay held until the advance is fully repaid and matched, then the reviewer returns them "
            "in one step; until then they block close.",
            "Returns %s to the payer; nothing is netted." % ", ".join(u["money"].text() for u in d.open_unmatched),
            lambda: [_ev(d, "return_unmatched", SIM_REVIEWER, id="RTN-UNM-%02d" % (d.counts.get("return_unmatched", 0) + 1))])
    # ---- Close ------------------------------------------------------------
    started = d.selected is not None or d.auth != "none"
    if started:
        blockers = _close_blockers(d)
        add("close", "Close case", "Operator", not blockers, "Cannot close yet: " + "; ".join(blockers) + ".",
            "Closes the case: supplier credited, nothing owed, nothing unmatched.",
            lambda: [_ev(d, "close", OPERATOR, id="CLS-NW-01")])
    # ---- Clock ------------------------------------------------------------
    step = _next_step(d)
    settled = d.delivery == "credited" and d.total_out == 0 and not d.open_unmatched and not d.incoming
    if step and not settled:  # nothing time-dependent remains once credited and settled: close instead
        add("advance_clock", step["label"], "Simulated event", True, None,
            "Moves the simulation clock to %s. Responses already due by then are recorded first; cutoffs and expiry "
            "are re-evaluated; records first known by then appear." % fmt_sgt(step["_at"]),
            lambda: _advance_events(d, step["_at"], _ev(d, "clock", "Simulation", _at=step["_at"], id="CLK-" + step["at"][:16])))
    return specs


def _close_blockers(d):
    b = []
    if d.delivery != "credited":
        b.append("supplier credit is not evidenced (delivery: %s)" % d.delivery)
    if d.principal_out != 0 or d.fees_out != 0:
        b.append("%s outstanding (principal %s, fees %s)" % (sgd(d.total_out), sgd(d.principal_out), sgd(d.fees_out)))
    if d.incoming:
        b.append("%d received payment(s) not yet matched" % len(d.incoming))
    if d.open_unmatched:
        b.append("%d unmatched item(s) held for review" % len(d.open_unmatched))
    if d.conflict:
        b.append("conflicting delivery evidence is unresolved")
    if d.selected is None:
        b.append("no funding route is in use")
    return b


def _spec_list(state, d=None):
    d = d or _derive(state)
    return d, _action_specs(d)


def apply(state, action_id):
    """Pure: returns a new state, or the same state (no-op) for a disabled, duplicate or unknown action."""
    d, specs = _spec_list(state)
    for spec, build in specs:
        if spec["id"] == action_id:
            if not spec["enabled"] or build is None:
                return state
            new = build()
            return {"case": state["case"], "events": state["events"] + new}
    return state


def available_actions(state):
    d, specs = _spec_list(state)
    sid = state_id(state)
    out = []
    for spec, _ in specs:
        a = dict(spec)
        a["next"] = state_id(apply(state, a["id"])) if a["enabled"] else sid
        if not a["enabled"]:
            a["consequence"] = "No change: " + (a["disabled_reason"] or "")
        out.append(a)
    return out


# --------------------------------------------------------------------------
# View
# --------------------------------------------------------------------------
def _evidence_json(d):
    out = []
    for e in sorted(_all_visible(d), key=lambda e: (e["_known"], e["_eff"], e["id"])):
        status = e["status"]
        if e["kind"] == "importer_balance":
            age = d.clock - e["_eff"]
            status = "settled; %s h old%s" % (_hours(age), " (stale)" if age > timedelta(hours=d.fx["balance_max_age_hours"]) else "")
        if e["kind"] == "forecast_receipt" and d.clock > e["_eff"] and not _receipts(d):
            status = "forecast; not evidenced as settled by %s" % _short(e["_eff"])
        out.append({"id": e["id"], "kind": e["kind"], "fact": e["fact"], "source": e["source"],
                    "effective_sgt": fmt_sgt(e["_eff"]), "known_sgt": fmt_sgt(e["_known"]), "status": status,
                    "_known": e["_known"]})
    return out


def _timeline_json(d):
    items = [{"_at": e["_eff"], "_known": e["_known"], "actor": e["source"], "text": "Record %s: %s" % (e["id"], e["fact"])}
             for e in _visible_fixture(d)]
    items += [t for t in d.timeline if t["_known"] <= d.clock]
    items.sort(key=lambda t: (t["_known"], t["_at"]))
    return [{"at_sgt": fmt_sgt(t["_at"]), "known_sgt": fmt_sgt(t["_known"]), "actor": t["actor"], "text": t["text"],
             "_known": t["_known"]} for t in items]


def _strip(items):
    return [{k: v for k, v in i.items() if not k.startswith("_")} for i in items]


def _facility_json(d):
    fac = d.fac
    if not fac:
        return None
    if d.rules_snapshot is not None:
        rules = [dict(r, detail="Checked at reservation %s: %s" % (fmt_sgt(_t(d.reservation["known_at"])), r["detail"]))
                 for r in d.rules_snapshot]
    else:
        rules = _rules_json(_rules(d))
    return {"id": fac["id"], "name": fac["name"], "policy_version": fac["policy_version"],
            "denomination": fac["denomination"], "status": fac["status"],
            "company_limit": sgd(fac["_limit"]), "company_available": sgd(_company_available(d)),
            "reserved": sgd(d.res_limit), "principal_outstanding": sgd(d.principal_out),
            "funding_account": d.fund["name"], "funding_start": sgd(d.fund["_start"]),
            "funding_available_cash": sgd(_funding_available(d)), "funding_reserved": sgd(_funding_reserved(d)),
            "funding_reserved_this_payout": sgd(d.res_cash), "funding_reserved_other_payouts": sgd(d.fund["_others"]),
            "fee": sgd(fac["_fee"]), "fees_outstanding": sgd(d.fees_out), "fees_collected": sgd(d.fees_repaid),
            "repayment_due_sgt": fmt_sgt(fac["_due"]),
            "reservation_expiry_sgt": fmt_sgt(fac["_expiry"]), "route_deadline_sgt": fmt_sgt(d.fx["_deadline"]),
            "committed_capacity": sgd(d.res_limit), "label": "Simulated facility — not a real credit line.",
            "rules": rules}


def _facts(d):
    fx, fac = d.fx, d.fac
    auth_labels = {"none": "No advance requested", "requested": "Requested — awaiting reviewer",
                   "evidence_requested": "Evidence requested", "reserved": "Reserved", "declined": "Declined",
                   "released": "Released unused", "consumed": "Consumed by draw"}
    if not fac:
        adetail = "No advance facility for this importer (Simulated)."
    elif d.auth == "reserved":
        adetail = "%s of limit and %s of funding cash reserved (%s), expires unused at %s." % (
            sgd(d.res_limit), sgd(d.res_cash), d.reservation["id"], _short(fac["_expiry"]))
    elif d.auth == "consumed":
        adetail = "Reservation %s consumed by draw %s." % (d.reservation["id"], d.draw["id"])
    elif d.auth == "released":
        adetail = d.release["text"]
    elif d.auth == "declined":
        adetail = "Declined by the reviewer (Simulated role) at %s. Nothing was reserved." % fmt_sgt(_t(d.decline["known_at"]))
    elif d.auth in ("requested", "evidence_requested"):
        adetail = "Requested at %s by the operator; reviewer is a Simulated role." % fmt_sgt(_t(d.request["known_at"]))
    else:
        adetail = "Nothing requested or reserved."
    if d.selected == "A":
        adetail += " Option A in use: the importer funds the payout itself."
    auth = {"status": d.auth, "label": auth_labels[d.auth], "detail": adetail}

    if d.draw:
        cash = {"status": "drawn", "label": "Drawn — principal %s outstanding" % sgd(d.principal_out),
                "detail": "Drawn %s at %s; repaid principal %s; principal outstanding %s. Fees are tracked separately." % (
                    sgd(d.drawn), fmt_sgt(_t(d.draw["known_at"])), sgd(d.principal_repaid), sgd(d.principal_out))}
    else:
        cash = {"status": "none", "label": "No advance drawn",
                "detail": "Committed capacity is not cash: nothing has left the provider funding account."
                if d.auth == "reserved" else ("Importer-funded (Option A); no provider cash moves." if d.selected == "A" else "No provider cash has moved.")}

    dl = {"none": "Not instructed", "instructed": "Instructed — not yet accepted", "accepted": "Accepted by provider — not credit",
          "credited": "Beneficiary credited", "returned": "Returned — recovery open"}
    if d.delivery == "none":
        last = "—"
        ddetail = "No payout instruction."
    elif d.delivery == "instructed":
        last = "%s: instruction %s sent to the provider." % (fmt_sgt(_t(d.instruct["known_at"])), d.instruct["id"])
        ddetail = "Instructed. The provider has not accepted it yet."
    elif d.delivery == "accepted":
        last = "%s: provider acceptance %s. Funds are with the provider, not yet credited to %s." % (
            fmt_sgt(_t(d.accept["known_at"])), d.accept["id"], fx["supplier"])
        ddetail = "Acceptance by the provider is not beneficiary credit."
    elif d.delivery == "credited":
        last = "%s: delivery record %s, %s credited to %s." % (fmt_sgt(_t(d.credit["effective_at"])), d.credit["id"], fx["_net"].text(), fx["supplier"])
        ddetail = "Beneficiary credit is evidenced by a delivery record."
        if d.conflict:
            ddetail += " A conflicting supplier message (%s) is under review." % d.conflict["id"]
    else:
        rt = fx["simulated_events"]["return"]
        last = "%s: %s returned to %s (%s)." % (fmt_sgt(_t(d.ret["effective_at"])), fx["_net"].text(), rt["money_location"], d.ret["id"])
        ddetail = "%s Recovery owner: %s. No second payment is sent automatically." % (d.ret["text"], rt["recovery_owner"])
    delivery = {"status": d.delivery, "label": dl[d.delivery], "detail": ddetail, "last_evidenced": last}

    if d.selected == "A":
        rstatus, rlabel = "not_applicable", "No advance — nothing to repay"
    elif not d.draw:
        rstatus, rlabel = "not_started", "Nothing drawn — nothing owed"
    elif d.total_out == 0:
        rstatus, rlabel = "repaid", "Repaid and matched"
    elif d.principal_repaid > 0 or d.fees_repaid > 0:
        rstatus, rlabel = "partially_repaid", "Partly repaid — %s outstanding" % sgd(d.total_out)
    else:
        rstatus, rlabel = "outstanding", "Outstanding — %s owed" % sgd(d.total_out)
    repayment = {"status": rstatus, "label": rlabel, "principal_outstanding": sgd(d.principal_out),
                 "fees_outstanding": sgd(d.fees_out), "due_sgt": fmt_sgt(fac["_due"]) if fac else "—",
                 "owner": "%s (importer) repays; Operator matches" % fx["importer"] if d.draw else "—",
                 "allocation_rule": ALLOCATION_RULE,
                 "unallocated": [{"id": i["id"], "amount": i["money"].text(), "received_sgt": fmt_sgt(i["_at"]),
                                  "note": "Received by the provider; not allocated until matched."} for i in d.incoming],
                 "matched": [{"id": r["id"], "amount": r["money"].text(), "received_sgt": fmt_sgt(r["received_at"]),
                              "at_sgt": fmt_sgt(r["_at"]), "fees": sgd(r["fees"]), "principal": sgd(r["principal"]),
                              "unmatched": r["money"].currency + " " + format(r["unmatched"], ",.2f")}
                             for r in d.repayments if r["fees"] + r["principal"] > 0],
                 "customer_receipts": [{"id": e["id"], "amount": e["_money"].text(), "at_sgt": fmt_sgt(e["_eff"]),
                                        "note": "Into the importer's own account — not a repayment."} for e in _receipts(d)],
                 "unmatched": [{"id": u["id"], "amount": u["money"].text(), "reason": u["reason"], "status": u["status"]}
                               for u in d.unmatched]}
    return {"authorization": auth, "cash": cash, "delivery": delivery, "repayment": repayment}


def _exposure(d):
    if not d.draw:
        return None
    if d.total_out > 0:
        ends = "When %s is repaid and matched (principal %s, fees %s), due %s." % (
            sgd(d.total_out), sgd(d.principal_out), sgd(d.fees_out), fmt_sgt(d.fac["_due"]))
    else:
        last = d.repayments[-1]["_at"] if d.repayments else d.clock
        ends = "Ended %s: principal and fees repaid and matched." % fmt_sgt(last)
    return {"status": "outstanding" if d.total_out > 0 else "ended",
            "amount": sgd(d.total_out), "principal": sgd(d.principal_out), "fees": sgd(d.fees_out), "currency": "SGD",
            "owner": ("Provider (Simulated facility %s) is owed by %s" % (d.fac["id"], d.fx["importer"]) if d.total_out > 0
                      else "Nothing owed: %s repaid the provider (Simulated facility %s)" % (d.fx["importer"], d.fac["id"])),
            "ends_when": ends}


def _decision(d, opts):
    fx, fac = d.fx, d.fac
    by = {o["key"]: o for o in opts}
    owe = "%s outstanding (principal %s + fees %s), due %s" % (
        sgd(d.total_out), sgd(d.principal_out), sgd(d.fees_out), _short(fac["_due"])) if fac and d.draw else ""

    def dec(tone, headline, binding, nxt, owner):
        return {"tone": tone, "headline": headline, "binding_constraint": binding, "next_action": nxt, "owner": owner}

    if d.closed:
        how = "advance repaid and matched" if d.selected == "C" else "importer-funded"
        return dec("closed", "Case closed — supplier credited, %s" % how, "None.", "Nothing further.", OPERATOR)
    if d.delivery == "returned":
        rt = fx["simulated_events"]["return"]
        extra = " The advance stays outstanding: %s." % owe if d.draw else ""
        return dec("failed", "Supplier payout returned — no second payment sent",
                   "Money last evidenced: %s returned to %s at %s (%s).%s" % (
                       fx["_net"].text(), rt["money_location"], _short(_t(d.ret["effective_at"])), d.ret["id"], extra),
                   "Confirm corrected beneficiary details with %s. Any new payment needs a fresh instruction and review; "
                   "nothing is resent automatically. Returned funds are not applied to the advance automatically." % fx["supplier"],
                   rt["recovery_owner"])
    if d.conflict:
        return dec("review", "Conflicting delivery evidence — review before closing",
                   "Delivery record %s says credited; %s says otherwise." % (d.credit["id"], d.conflict["id"]),
                   "Obtain the beneficiary bank trace and resolve the conflict.", SIM_REVIEWER)
    if d.open_unmatched:
        tot = {}
        for u in d.open_unmatched:
            tot.setdefault(u["money"].currency, []).append(u["money"].text())
        return dec("review", "Unmatched cash held for review — case cannot close",
                   "; ".join(u["reason"] for u in d.open_unmatched),
                   ("Collect and match the remaining %s from %s; the unmatched item(s) stay held and can be "
                    "returned to the payer once the advance is repaid and matched." % (sgd(d.total_out), fx["importer"])
                    if d.total_out > 0 else "Return the unmatched item(s) to the payer."),
                   OPERATOR if d.total_out > 0 else SIM_REVIEWER)
    if d.delivery == "credited" and d.incoming:
        return dec("decide", "Repayment received — match it to the advance",
                   "%s received and not yet allocated; %s." % (", ".join(i["money"].text() for i in d.incoming), owe),
                   "Match the repayment: fees first, then principal.", OPERATOR)
    if d.delivery == "credited":
        if d.selected == "C" and d.total_out > 0:
            if d.clock >= fac["_due"]:
                return dec("review", "Importer repayment overdue", owe + ".",
                           "Chase %s for %s and refer to the reviewer." % (fx["importer"], sgd(d.total_out)), SIM_REVIEWER)
            nxt = "Collect and match %s from %s by %s. A customer receipt into the importer's own account is not repayment." % (
                sgd(d.total_out), fx["importer"], _short(fac["_due"]))
            return dec("delivered_exposure", "Supplier credited; importer repayment outstanding", owe + ".", nxt,
                       "%s (importer) repays; Operator matches" % fx["importer"])
        what = "advance repaid and matched" if d.selected == "C" else "funded from the importer's own cash"
        return dec("decide", "Supplier credited, %s — ready to close" % what, "None.", "Close the case.", OPERATOR)
    if d.delivery in ("instructed", "accepted"):
        tail = (" The advance is outstanding: %s." % owe) if d.draw else ""
        if d.clock >= fx["_deadline"]:
            return dec("review", "Supplier deadline passed without evidenced credit",
                       "No delivery record of beneficiary credit by %s.%s" % (_short(fx["_deadline"]), tail),
                       "Ask the provider for a payment trace; do not send a second payment.", SIM_REVIEWER)
        if d.delivery == "instructed":
            return dec("unknown", "Payout instructed; provider acceptance not yet received",
                       "Instruction %s is not accepted yet.%s" % (d.instruct["id"], tail),
                       "Wait for provider acceptance. Do not instruct again.", "Provider (Simulated)")
        return dec("unknown", "Provider accepted the payout; supplier credit not yet evidenced",
                   "Acceptance by the provider is not beneficiary credit; release is %s.%s" % (
                       _short(_t(fx["release_checkpoint"])), tail),
                   "Wait for the delivery record of beneficiary credit before %s." % _short(fx["_deadline"]), "Provider (Simulated)")
    if d.auth == "consumed":
        if d.clock >= fac["_expiry"]:
            return dec("review", "Advance drawn but the payout cutoff was missed",
                       "Payout cutoff %s passed without an instruction; %s." % (_short(fac["_expiry"]), owe),
                       "Reviewer decides recovery. The drawn principal stays outstanding until repaid.", SIM_REVIEWER)
        return dec("decide", "Advance drawn — instruct the supplier payout",
                   "Instruct before %s; %s." % (_short(fac["_expiry"]), owe),
                   "Instruct the supplier payout of %s." % fx["_net"].text(), OPERATOR)
    if d.selected == "A":
        cut = fx["windows"]["friday"]["_cutoff"]
        if d.clock >= cut:
            return dec("blocked", "Friday cutoff missed — payout not instructed",
                       "Option A needed an instruction before %s." % _short(cut),
                       "Tell the importer and supplier now; agree a new route outside this desk.", OPERATOR)
        return dec("decide", "Importer funds the Friday window — instruct the supplier payout",
                   "Instruct before %s." % _short(cut), "Instruct the supplier payout of %s." % fx["_net"].text(), OPERATOR)
    if d.auth == "reserved":
        return dec("decide", "Advance reserved — draw before %s" % _short(fac["_expiry"]),
                   "Reservation %s expires unused at %s." % (d.reservation["id"], _short(fac["_expiry"])),
                   "Draw %s and instruct the payout." % sgd(d.res_cash), OPERATOR)
    if d.auth == "evidence_requested":
        return dec("unknown", "We need a newer bank balance before reviewing this advance",
                   _balance_check(d)[1], "Wait for the importer's newer bank balance.", "%s, then %s" % (SIM_IMPORTER, SIM_REVIEWER))
    if d.auth == "requested":
        rules = _rules(d)
        st = _rules_state(rules)
        failing = "; ".join(r["detail"] for r in rules if r["ok"] is not True)
        if st == "unknown":
            return dec("unknown", "We need a newer bank balance before reviewing this advance", failing,
                       "Reviewer requests a newer bank balance from the importer.", SIM_REVIEWER)
        if st == "fail":
            return _blocked_c(d, rules, failing, dec, by)
        return dec("decide", "Advance requested — awaiting reviewer approval",
                   "All %d policy rules pass at this clock." % len(rules),
                   "Reviewer approves and reserves %s, or declines." % sgd(fx["_cost"].amount), SIM_REVIEWER)
    # none / declined / released
    feasible = [o for o in opts if o["status"] == "feasible"]
    c = by["C"]
    prefix = ""
    tone_none = "blocked"
    if d.auth == "declined":
        w = fx["windows"]["friday"]
        a_ok = by["A"]["status"] == "feasible"
        binding = ("Nothing was reserved or drawn. The importer must fund at the original window (%s, cutoff %s) "
                   "or the payout does not go ahead." % (_short(w["_at"]), _short(w["_cutoff"]).split(" ", 3)[3]))
        if not a_ok:
            binding += " " + (by["A"]["disqualifiers"][0] if by["A"]["disqualifiers"] else "")
        nxt = ("Record Option A if the importer funds by %s; otherwise tell the importer and supplier the payout will not "
               "go ahead." % _short(w["_cutoff"]) if a_ok else
               "Tell the importer and supplier the payout will not go ahead through this desk.")
        return dec("declined", "Advance declined — nothing reserved", binding.strip(), nxt, OPERATOR)
    if d.auth == "released":
        prefix, tone_none = "Reservation released — ", "declined"
    if not feasible:
        if any(o["status"] == "unknown" for o in opts):
            return dec("unknown", "We need a newer bank balance before reviewing this advance",
                       _balance_check(d)[1],
                       "Request the advance; the reviewer will ask the importer for a newer bank balance.", OPERATOR)
        return dec(tone_none if prefix else "blocked", prefix + "No feasible option meets the %s deadline" % _short(fx["_deadline"]),
                   " ".join("%s: %s" % (o["key"], o["disqualifiers"][0]) for o in opts if o["disqualifiers"]),
                   "Tell the importer and supplier now; agree a new deadline or another route outside this desk.", OPERATOR)
    if prefix:
        keys = ", ".join(o["key"] for o in feasible)
        return dec(tone_none, prefix + "Option %s remains" % keys, c["disqualifiers"][0] if c["disqualifiers"] else "—",
                   "Record Option %s or let the case lapse." % feasible[0]["key"], OPERATOR)
    if c["status"] == "feasible":
        def route(o, ok_text):
            return "%s: %s" % (o["key"], ok_text if o["status"] == "feasible" else
                               (o["disqualifiers"][0] if o["disqualifiers"] else o["status"]))
        a, b = by["A"], by["B"]
        binding = " ".join([
            route(a, "the importer's cash leaves at %s." % a["committed_at"]),
            route(b, "the importer funds %s." % b["committed_at"]),
            route(c, "needs the reviewer to reserve capacity; draw and instruct by %s." % _short(fac["_expiry"]))])
        return dec("decide", "Decision needed: how does %s get paid by %s?" % (
            fx["supplier"].replace(" LLC", ""), _day(fx["_deadline"])), binding,
            "Compare the three routes; the reviewer decides whether to reserve capacity.", OPERATOR)
    if c["status"] == "unknown":
        return dec("unknown", "We need a newer bank balance before reviewing this advance", c["disqualifiers"][0],
                   "Request the advance; the reviewer will ask the importer for a newer bank balance.", OPERATOR)
    if not fx["contract"]["later_funding_permitted"] and c["status"] == "unavailable":
        return dec("decide", "Later funding unavailable",
                   "%s %s" % (by["B"]["disqualifiers"][0], c["disqualifiers"][0]),
                   "Record Option A: the importer funds %s by %s." % (fx["_cost"].text(), _short(fx["windows"]["friday"]["_cutoff"])),
                   OPERATOR)
    if fac and fac["status"] == "active":
        rules = _rules(d)
        return _blocked_c(d, rules, "; ".join(r["detail"] for r in rules if r["ok"] is not True), dec, by)
    return dec("decide", "Option %s is the only feasible route" % feasible[0]["key"], c["disqualifiers"][0] if c["disqualifiers"] else "—",
               "Record Option %s." % feasible[0]["key"], OPERATOR)


def _blocked_c(d, rules, failing, dec, by):
    alt = " or record Option A (importer funds Friday)" if by["A"]["status"] == "feasible" else ""
    if _cash_rule_failed(rules):
        if d.fund["_others"] > 0 and d.fund["_start"] >= d.fx["_cost"].amount:
            head = "Funding is already reserved for another payout — this advance cannot be reserved"
        else:
            head = "Credit headroom available, but no deployable cash to pay"
        if d.auth == "requested":
            nxt = "Refer to provider treasury (Simulated role), or the reviewer declines the request%s." % (
                " and the operator records Option A (importer funds Friday)" if alt else "")
        else:
            nxt = "Refer to provider treasury (Simulated role)%s." % alt
        return dec("blocked", head, failing, nxt, "Provider treasury (Simulated role)")
    return dec("blocked", "Advance not eligible at this clock", failing, "Decline the request%s." % alt, SIM_REVIEWER)


def _warnings(d):
    w = ["Simulated case: parties, facility, roles and events are fictional. %s" % DISCLAIMER_ROLES]
    for e in _visible_fixture(d):
        if e["kind"] == "forecast_receipt":
            if d.clock <= e["_eff"]:
                w.append("Forecast receipt %s (%s) is not counted as cash, cash support or repayment." % (e["_money"].text(), e["id"]))
            elif not _receipts(d):
                w.append("The %s receipt forecast for %s has not been evidenced as settled." % (e["_money"].text(), _short(e["_eff"])))
    if _receipts(d) and d.draw and d.total_out > 0:
        w.append("A customer receipt into the importer's own account is not a repayment; %s is still owed." % sgd(d.total_out))
    if d.delivery == "accepted":
        w.append("Provider acceptance is not beneficiary credit.")
    return w


def _visible_lists(d):
    return _evidence_json(d), _timeline_json(d)


def view(state):
    d = _derive(state)
    fx = d.fx
    opts, note = _options(d)
    evidence, timeline = _visible_lists(d)
    return {
        "label": LABEL,
        "case": case_meta(state["case"]),
        "state_id": state_id(state),
        "clock": {"sgt": fmt_sgt(d.clock), "ny": fmt_ny(d.clock), "label": "Simulated clock"},
        "header": {"importer": fx["importer"], "supplier": fx["supplier"], "amount": fx["_net"].text() + " net",
                   "deadline_sgt": fmt_sgt(fx["_deadline"]), "deadline_ny": fmt_ny(fx["_deadline"])},
        "decision": _decision(d, opts),
        "options": opts,
        "options_note": note,
        "facility": _facility_json(d),
        "facts": _facts(d),
        "exposure": _exposure(d),
        "evidence": _strip(evidence),
        "timeline": _strip(timeline),
        "actions": available_actions(state),
        "invariants": _invariants(d, evidence, timeline),
        "warnings": _warnings(d),
    }


# --------------------------------------------------------------------------
# Invariants
# --------------------------------------------------------------------------
def _invariants(d, evidence, timeline):
    out = []

    def inv(name, ok, detail):
        out.append({"name": name, "ok": bool(ok), "detail": detail})

    fac, fund = d.fac, d.fund
    if fac:
        avail = _company_available(d)
        inv("company_limit = available + reserved + principal_outstanding",
            fac["_limit"] == avail + d.res_limit + d.principal_out and avail >= 0,
            "%s = %s + %s + %s" % (sgd(fac["_limit"]), sgd(avail), sgd(d.res_limit), sgd(d.principal_out)))
        favail = _funding_available(d)
        inv("funding start = available_cash + reserved_cash + principal_outstanding",
            fund["_start"] == favail + _funding_reserved(d) + d.principal_out and (favail >= 0 or d.res_cash == 0),
            "%s = %s + %s + %s (fees are income, tracked separately: collected %s)" % (
                sgd(fund["_start"]), sgd(favail), sgd(_funding_reserved(d)), sgd(d.principal_out), sgd(d.fees_repaid)))
    inv("principal_outstanding = drawn − principal_repaid ≥ 0", d.principal_out == d.drawn - d.principal_repaid and d.principal_out >= 0,
        "%s = %s − %s" % (sgd(d.principal_out), sgd(d.drawn), sgd(d.principal_repaid)))
    inv("fees_outstanding = fees_charged − fees_repaid ≥ 0", d.fees_out == d.fees_charged - d.fees_repaid and d.fees_out >= 0,
        "%s = %s − %s" % (sgd(d.fees_out), sgd(d.fees_charged), sgd(d.fees_repaid)))
    alloc_ok = all(r["fees"] + r["principal"] + r["unmatched"] == r["money"].amount for r in d.repayments)
    alloc_ok = alloc_ok and all(r["fees"] + r["principal"] == 0 for r in d.repayments if r["money"].currency != "SGD")
    inv("every repayment allocated: fees + principal + unmatched = amount (SGD only matched)", alloc_ok,
        "%d repayment(s); rule: fees first, then principal; excess and other currencies unmatched." % len(d.repayments))
    sgd_in = sum((r["money"].amount for r in d.repayments if r["money"].currency == "SGD"), ZERO)
    sgd_unalloc = sum((i["money"].amount for i in d.incoming if i["money"].currency == "SGD"), ZERO)
    sgd_unm = sum((u["money"].amount for u in d.unmatched if u["money"].currency == "SGD"), ZERO)
    inv("SGD received = fees repaid + principal repaid + SGD unmatched + SGD not yet matched",
        sgd_in + sgd_unalloc == d.fees_repaid + d.principal_repaid + sgd_unm + sgd_unalloc,
        "%s = %s + %s + %s + %s" % (sgd(sgd_in + sgd_unalloc), sgd(d.fees_repaid), sgd(d.principal_repaid), sgd(sgd_unm),
                                    sgd(sgd_unalloc)))
    inv("a customer receipt never reduces what is owed",
        d.principal_repaid + d.fees_repaid == sum((r["fees"] + r["principal"] for r in d.repayments), ZERO),
        "%d customer receipt(s); only matched repayments reduce principal or fees" % len(d.receipts))
    once = all(d.counts.get(k, 0) <= 1 for k in ("request", "reserve", "draw", "instruct", "accept", "credit", "return", "close",
                                                   "decline", "release", "expire", "select_a", "receipt",
                                                   "incoming_partial", "incoming_balance", "incoming_wrong"))
    inv("each lifecycle step recorded at most once (no double reservation, draw, payout or credit)", once,
        ", ".join("%s×%d" % (k, v) for k, v in sorted(d.counts.items()) if not k.startswith("repayment_")) or "no events")
    order = {"none": 0, "instructed": 1, "accepted": 2, "credited": 3, "returned": 3}[d.delivery]
    funded = d.draw is not None or d.selected == "A"
    inv("delivery stages in order and funded (credit only via a delivery record)",
        (order == 0 or (funded and d.instruct)) and (order < 2 or d.accept) and (d.delivery != "credited" or d.credit),
        "delivery: %s" % d.delivery)
    inv("draw never exceeds the reservation", d.draw is None or (d.reservation is not None and d.drawn == Decimal(d.reservation["amount"])),
        "drawn %s" % sgd(d.drawn))
    if d.closed:
        inv("closed only when credited, nothing owed, nothing unmatched, no conflicts", not _close_blockers(d), "closed")
    clk = d.clock
    inv("evidence and timeline show only records known at or before the clock",
        all(e["_known"] <= clk for e in evidence) and all(t["_known"] <= clk for t in timeline),
        "clock %s" % fmt_sgt(clk))
    return out


def check_invariants(state):
    d = _derive(state)
    ev, tl = _visible_lists(d)
    return _invariants(d, ev, tl)


# --------------------------------------------------------------------------
# Reachability (used by the exporter and tests)
# --------------------------------------------------------------------------
def reachable(case_id, cap=STATE_CAP):
    """Breadth-first walk following only enabled actions. Returns {state_id: state}. Raises if over cap."""
    start = initial_state(case_id)
    seen = {state_id(start): start}
    queue = [start]
    while queue:
        st = queue.pop(0)
        for a in available_actions(st):
            if not a["enabled"]:
                continue
            nxt = apply(st, a["id"])
            sid = state_id(nxt)
            if sid not in seen:
                seen[sid] = nxt
                queue.append(nxt)
                if len(seen) > cap:
                    raise RuntimeError("Case %s exceeds %d reachable states" % (case_id, cap))
    return seen
