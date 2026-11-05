"""Pure domain rules: fold events into CaseState, assess routes A/B/C, allocation, identities, decision, actions.

No database access here. Times are aware UTC datetimes; money is pilot.money.Money (integer minor units).
"""

import datetime as _dt

from . import money as M
from .db import iso, parse_iso

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

UTC = _dt.timezone.utc
SANDBOX_LABEL = "Sandbox — not a live payment"

# ---------------------------------------------------------------- roles
OPERATOR_AND_REVIEWER = {"add_observation", "supersede_observation", "add_note", "assign_owner", "add_evidence",
                         "create_case", "import_cases", "log_work", "record_baseline"}
OPERATOR_ONLY = {"select_route", "request_advance", "record_prefunding", "record_draw", "instruct_payout",
                 "record_delivery", "query_payout_status", "record_customer_receipt", "record_repayment",
                 "match_repayment", "resolve_duplicate", "close_case"}
REVIEWER_ONLY = {"approve_and_reserve", "decline", "request_evidence", "release_reservation", "authorize_draw",
                 "return_unmatched", "reverse_match", "close_with_exception", "authorize_reinstruction", "reopen_case",
                 "resolve_duplicate_check", "declare_default"}
COMMANDS = OPERATOR_AND_REVIEWER | OPERATOR_ONLY | REVIEWER_ONLY
DISPOSITIONS = ("write_off_referred", "supplier_paid_outside", "cancelled_before_payout", "duplicate_case",
                "other_documented")
DELIVERY_STATUSES = ("accepted", "credited", "failed", "returned", "unknown")
OBS_KINDS = ("balance", "commitment", "cash_support", "expected_receipt", "terms", "invoice")
OBS_SCOPES = ("case", "importer")
# Commands allowed on a closed case: they change no money and no status (measurement happens after close).
CLOSED_ALLOWED = ("add_note", "log_work", "record_baseline")
REVIEW_COMMANDS = ("approve_and_reserve", "decline", "request_evidence", "resolve_duplicate_check", "declare_default",
                   "release_reservation", "authorize_draw", "close_with_exception")
NO_MATCH_TEXT = "No matching record in this provider's book."
OVERDUE_LABEL = "Overdue — not a default determination"
MONEY_KINDS = ("balance", "commitment", "cash_support", "expected_receipt", "invoice")
KIND_TIME_KEY = {"balance": "as_of", "commitment": "due_at", "cash_support": "effective_at",
                 "expected_receipt": "expected_at", "invoice": "issued_at"}


def norm_ref(text):
    """Normalise a reference for matching: case-folded, letters and digits only."""
    return "".join(ch for ch in (text or "").casefold() if ch.isalnum())


def required_kinds(fac):
    raw = (fac or {}).get("required_evidence")
    if raw is None:
        raw = "balance"
    return [k.strip() for k in str(raw).split(",") if k.strip()]


def role_for(cmd):
    if cmd in REVIEWER_ONLY:
        return "reviewer"
    return "operator"


def allowed(role, cmd):
    if cmd in OPERATOR_AND_REVIEWER:
        return role in ("operator", "reviewer")
    if cmd in OPERATOR_ONLY:
        return role == "operator"
    if cmd in REVIEWER_ONLY:
        return role == "reviewer"
    return False


class DomainError(Exception):
    def __init__(self, status, code, message, field=None):
        Exception.__init__(self, message)
        self.status, self.code, self.message, self.field = status, code, message, field


# ---------------------------------------------------------------- time display
_ABBR = {"Asia/Singapore": "SGT", "Asia/Kuala_Lumpur": "MYT", "Asia/Manila": "PHT", "Asia/Jakarta": "WIB",
         "Asia/Bangkok": "ICT", "Asia/Ho_Chi_Minh": "ICT", "Asia/Dubai": "GST", "Asia/Kolkata": "IST"}


def zone(tz):
    if ZoneInfo is None:
        return UTC
    try:
        return ZoneInfo(tz)
    except Exception:
        return UTC


def local_text(value, tz):
    if value is None:
        return None
    dt = parse_iso(value).astimezone(zone(tz))
    ab = dt.strftime("%Z")
    if not ab or ab[0] in "+-":
        ab = _ABBR.get(tz, ab or "UTC")
    return "%s, %s %s" % (dt.strftime("%a %d %b %Y").replace(" 0", " "), dt.strftime("%H:%M"), ab)


def time_json(value, tz):
    if value is None:
        return None
    return {"utc": iso(value), "local": local_text(value, tz)}


def age_text(td):
    mins = int(td.total_seconds() // 60)
    neg = mins < 0
    mins = abs(mins)
    h, m = divmod(mins, 60)
    txt = "%d h %d min" % (h, m) if m else "%d h" % h
    return ("-" if neg else "") + txt


def mtext(minor, ccy):
    return M.format_money(M.Money(minor, ccy))


# ---------------------------------------------------------------- state
class CaseState(object):
    def __init__(self, case, facility):
        self.case = case
        self.facility = facility
        self.id = case["id"]
        self.payout = M.Money(case["payout_minor"], case["payout_currency"])
        self.funding = M.Money(case["funding_minor"], case["funding_currency"])
        self.tz = case["deadline_tz"]
        self.deadline = parse_iso(case["deadline_at"])
        self.events = []
        self.observations = {}
        self.obs_order = []
        self.evidence = {}
        self.route = None
        self.route_reason = None
        self.auth = "none"
        self.request = None
        self.evidence_request = None
        self.approval = None
        self.decline_info = None
        self.release_info = None
        self.draw = None
        self.draw_referred = False
        self.draw_authorized = False
        self.prefunding = None
        self.payouts = []
        self.reinstruction_authorized = False
        self.customer_receipts = []
        self.repayments = {}
        self.matches = {}
        self.unmatched = {}
        self.fees_charged = 0
        self.fees_repaid = 0
        self.principal_repaid = 0
        self.notes = []
        self.owner_user_id = case.get("owner_user_id")
        self.closed = None
        self.post_close = []             # provider events recorded after the case was closed
        self.timeline = []
        self.dup_check = None            # latest same-provider duplicate check {status, matches, text, ...}
        self.dup_history = []
        self.checkpoints = []            # eligibility_evaluated events (decision record)
        self.judgments = []              # reviewer decisions with reasons (never rewritten)
        self.last_fact_seq = 0           # seq of the latest observation/evidence event
        self.decline_seq = None
        self.default_declared = None
        self.work_logs = []
        self.baselines = []

    # -- derived
    @property
    def fac_ccy(self):
        return self.facility["currency"] if self.facility else self.funding.currency

    @property
    def principal_outstanding(self):
        return (self.draw["principal"] if self.draw else 0) - self.principal_repaid

    @property
    def fees_outstanding(self):
        return self.fees_charged - self.fees_repaid

    @property
    def owed(self):
        return self.principal_outstanding + self.fees_outstanding

    @property
    def reserved_minor(self):
        return self.approval["amount_minor"] if self.auth == "reserved" and self.approval else 0

    def latest_payout(self):
        return self.payouts[-1] if self.payouts else None

    def funded(self):
        return self.draw is not None or self.prefunding is not None

    def committed(self):
        return self.route is not None or self.auth in ("reserved", "consumed")

    def open_unmatched(self):
        return [u for u in self.unmatched.values() if u["status"] == "open"]

    def unallocated(self):
        return [r for r in self.repayments.values() if r["status"] == "unallocated"]

    def duplicates_pending(self):
        return [r for r in self.repayments.values() if r["status"] == "possible_duplicate"]

    def open_items(self):
        return len(self.open_unmatched()) + len(self.unallocated()) + len(self.duplicates_pending())

    def due_at(self):
        return parse_iso(self.approval["due_at"]) if self.approval else None

    def overdue(self, now):
        due = self.due_at()
        return bool(self.draw and due and now >= due and self.owed > 0)

    def active_observations(self, now, kind=None):
        out = []
        for oid in self.obs_order:
            o = self.observations[oid]
            if o["known_at"] > now:
                continue
            if o["superseded_by"] is not None and self.observations[o["superseded_by"]]["known_at"] <= now:
                continue
            if kind is None or o["kind"] == kind:
                out.append(o)
        return out

    def later_permitted(self, now):
        terms = self.active_observations(now, "terms")
        if terms:
            t = max(terms, key=lambda o: (o["known_at"], o["seq"]))
            return bool(t["data"].get("later_permitted")), t
        return bool(self.case.get("later_permitted")), None


def _money_of(d):
    return M.Money(int(d["amount_minor"]), d["currency"])


def obs_data(kind, payload):
    """Parse stored observation payload into typed fields."""
    d = {}
    if kind in MONEY_KINDS:
        d["money"] = _money_of(payload)
    for k in ("as_of", "due_at", "effective_at", "expected_at", "issued_at"):
        if payload.get(k):
            d[k] = parse_iso(payload[k])
    for k in ("source", "description", "document_ref", "payer", "contract_ref", "invoice_ref", "issuer",
              "record_ref"):
        if payload.get(k) is not None:
            d[k] = payload[k]
    if kind == "terms":
        d["later_permitted"] = bool(payload.get("later_permitted"))
    return d


def fold(case, events, facility):
    """Fold the ordered event log into a CaseState."""
    s = CaseState(case, facility)
    for ev in events:
        _apply(s, ev)
    return s


def _apply(s, ev):
    t = ev["type"]
    p = ev.get("payload") or {}
    known = parse_iso(ev["known_at"])
    s.events.append(ev)
    h = _HANDLERS.get(t)
    text = h(s, ev, p, known) if h else t.replace("_", " ").capitalize()
    s.timeline.append({"seq": ev["seq"], "event_id": ev["id"], "type": t, "text": text,
                       "effective_at": ev["effective_at"], "known_at": ev["known_at"],
                       "actor_user_id": ev.get("actor_user_id"), "actor_role": ev.get("actor_role"),
                       "provenance": ev["provenance"], "reason": ev.get("reason"),
                       "corrects_event_id": ev.get("corrects_event_id")})


def _h_created(s, ev, p, known):
    s.owner_user_id = p.get("owner_user_id") or s.owner_user_id or ev.get("actor_user_id")
    return "Case created: %s to %s, payout %s, funding %s (quote %s)." % (
        s.case["importer"], s.case["supplier"], s.payout, s.funding, s.case["quote_ref"])


def _obs_text(kind, d):
    if kind == "balance":
        return "Importer balance %s as of %s (%s)" % (d["money"], iso(d["as_of"]), d.get("source", "no source"))
    if kind == "commitment":
        return "Commitment %s due %s (%s)" % (d["money"], iso(d["due_at"]), d.get("description", ""))
    if kind == "cash_support":
        return "Cash support %s effective %s (%s)" % (d["money"], iso(d["effective_at"]), d.get("document_ref", ""))
    if kind == "expected_receipt":
        return "Expected receipt (forecast, not cash) %s at %s from %s" % (
            d["money"], iso(d["expected_at"]), d.get("payer", "payer not stated"))
    if kind == "terms":
        return "Contract terms %s: later funding %s" % (
            d.get("contract_ref") or "(no ref)", "permitted" if d["later_permitted"] else "not permitted")
    if kind == "invoice":
        return "Supplier invoice %s for %s issued %s by %s" % (
            d.get("invoice_ref"), d["money"], iso(d["issued_at"]), d.get("issuer") or "issuer not stated")
    return kind


def _add_obs(s, ev, p, known):
    kind = p["kind"]
    d = obs_data(kind, p)
    s.observations[ev["id"]] = {"id": ev["id"], "seq": ev["seq"], "kind": kind, "data": d, "payload": p,
                                "provenance": ev["provenance"], "evidence_id": p.get("evidence_id"),
                                "known_at": known, "effective_at": parse_iso(ev["effective_at"]),
                                "superseded_by": None, "corrects": ev.get("corrects_event_id"),
                                "reason": ev.get("reason"), "issuer": p.get("issuer"),
                                "record_ref": p.get("record_ref"), "scope": p.get("scope") or "case"}
    s.obs_order.append(ev["id"])
    s.last_fact_seq = ev["seq"]
    return _obs_text(kind, d)


def _h_obs(s, ev, p, known):
    return "Observation: " + _add_obs(s, ev, p, known) + "."


def _h_supersede(s, ev, p, known):
    old = s.observations.get(ev.get("corrects_event_id"))
    txt = _add_obs(s, ev, p, known)
    if old is not None:
        old["superseded_by"] = ev["id"]
    return "Correction of event %s: %s." % (ev.get("corrects_event_id"), txt)


def _h_evidence(s, ev, p, known):
    s.last_fact_seq = ev["seq"]
    s.evidence[p["evidence_id"]] = {"id": p["evidence_id"], "filename": p["filename"],
                                    "content_type": p["content_type"], "size": p["size"], "sha256": p["sha256"],
                                    "known_at": ev["known_at"], "provenance": ev["provenance"],
                                    "event_id": ev["id"]}
    return "Evidence file %s added (%s, %d bytes)." % (p["filename"], p["content_type"], p["size"])


def _h_route(s, ev, p, known):
    s.route = p["route"]
    s.route_reason = ev.get("reason")
    return "Route %s selected: importer funds from its own cash (no advance)." % p["route"]


def _h_request(s, ev, p, known):
    s.auth = "requested"
    s.decline_seq = None
    s.request = {"by": ev.get("actor_user_id"), "at": ev["known_at"], "snapshot": p.get("snapshot"),
                 "evidence_ids": p.get("evidence_ids", [])}
    return "Advance requested (route C) for %s." % s.funding


def _h_evreq(s, ev, p, known):
    s.auth = "evidence_requested"
    s.evidence_request = {"what": p.get("what"), "by": ev.get("actor_user_id")}
    _judge(s, ev, "evidence_requested", p.get("what"))
    return "Reviewer requested evidence: %s. Nothing reserved." % p.get("what")


def _h_decline(s, ev, p, known):
    s.auth = "declined"
    s.decline_info = {"by": ev.get("actor_user_id"), "at": ev["known_at"], "seq": ev["seq"]}
    s.decline_seq = ev["seq"]
    _judge(s, ev, "declined", ev.get("reason"))
    return "Advance declined. Nothing reserved."


def _h_approve(s, ev, p, known):
    s.auth = "reserved"
    s.approval = dict(p, by=ev.get("actor_user_id"), at=ev["known_at"])
    _judge(s, ev, "approved", ev.get("reason"), policy_version=p.get("policy_version"))
    return "Approved and reserved %s of capacity on %s (policy %s); fee %s; repayment due %s; reservation expires %s. Not a draw." % (
        mtext(p["amount_minor"], s.fac_ccy), p["facility_id"], p["policy_version"], mtext(p["fee_minor"], s.fac_ccy),
        p["due_at"], p["expires_at"])


def _h_release(s, ev, p, known):
    s.auth = "released"
    s.release_info = {"by": ev.get("actor_user_id"), "at": ev["known_at"], "kind": "released"}
    return "Reservation released unused; capacity returned to the facility."


def _h_expire(s, ev, p, known):
    s.auth = "expired"
    s.release_info = {"by": None, "at": ev["known_at"], "kind": "expired"}
    return "Reservation expired unused at %s; capacity returned to the facility." % p.get("expires_at")


def _h_referred(s, ev, p, known):
    s.draw_referred = True
    return "Draw referred: facility is suspended and its suspension policy is unset. A reviewer must authorize the draw."


def _h_draw_auth(s, ev, p, known):
    s.draw_authorized = True
    return "Reviewer authorized the draw under a suspended facility."


def _h_draw(s, ev, p, known):
    s.auth = "consumed"
    s.draw = {"principal": p["principal_minor"], "fee": p["fee_minor"], "effective_at": ev["effective_at"],
              "reference": p.get("reference")}
    s.fees_charged += p["fee_minor"]
    return "Draw recorded: principal %s plus fee %s now owed by the importer (reference %s)." % (
        mtext(p["principal_minor"], s.fac_ccy), mtext(p["fee_minor"], s.fac_ccy), p.get("reference"))


def _h_prefund(s, ev, p, known):
    s.prefunding = {"money": _money_of(p), "effective_at": ev["effective_at"], "reference": p.get("reference")}
    return "Importer prefunding %s received by the provider (reference %s)." % (_money_of(p), p.get("reference"))


def _h_instruct(s, ev, p, known):
    s.payouts.append({"attempt": p["attempt"], "route": p["route"], "external_ref": p["external_ref"],
                      "provider_ref": p.get("provider_ref"), "status": "instructed",
                      "amount": _money_of(p), "instructed_at": ev["effective_at"],
                      "last_evidenced": ev["known_at"], "location": "Provider: payout instructed",
                      "provenance": ev["provenance"], "history": []})
    s.reinstruction_authorized = False
    return "Payout attempt %d instructed via %s (%s) for %s. Instruction is not credit." % (
        p["attempt"], "sandbox — not a live payment" if p["route"] == "sandbox" else "manual route",
        p["external_ref"], _money_of(p))


def delivery_applies(cur, new):
    """Monotonic delivery rule. Credited beats accepted; terminal states stay terminal; unknown never overrides."""
    if new == "unknown":
        return cur == "instructed"
    if cur in ("failed", "returned"):
        return False
    if new == "failed":
        return cur in ("instructed", "unknown", "accepted")
    if new == "returned":
        return cur in ("instructed", "unknown", "accepted", "credited")
    rank = {"instructed": 0, "unknown": 0, "accepted": 1, "credited": 2}
    return rank[new] > rank[cur]


_LOC = {"accepted": "With the payout provider (accepted, not yet credited)", "credited": "Beneficiary account",
        "failed": "Not delivered: payout failed", "returned": "Returned by the beneficiary bank",
        "unknown": "Unknown: provider has not confirmed"}


def _payout_for(s, p):
    for po in s.payouts:
        if po["attempt"] == p.get("attempt"):
            return po
    return s.latest_payout()


def _set_delivery(s, po, status, ev, p):
    applied = delivery_applies(po["status"], status)
    po["history"].append({"status": status, "applied": applied, "effective_at": ev["effective_at"],
                          "known_at": ev["known_at"], "provenance": ev["provenance"]})
    if applied:
        po["status"] = status
        po["last_evidenced"] = ev["effective_at"]
        po["location"] = p.get("location") or _LOC.get(status, status)
        po["provenance"] = ev["provenance"]
    return applied


def _h_submitted(s, ev, p, known):
    po = _payout_for(s, p)
    po["provider_ref"] = p.get("provider_ref") or po.get("provider_ref")
    status = {"accepted": "accepted", "timeout": "unknown", "rejected": "failed"}.get(p.get("result"), "unknown")
    _set_delivery(s, po, status, ev, p)
    return {"accepted": "Sandbox provider accepted the instruction (not a credit). %s." % SANDBOX_LABEL,
            "timeout": "Sandbox provider did not answer in time: delivery status unknown. Timeout is not failure; "
                       "do not re-submit. %s." % SANDBOX_LABEL,
            "rejected": "Sandbox provider rejected the instruction; nothing was sent. %s." % SANDBOX_LABEL}.get(
        p.get("result"), "Sandbox submission result recorded.")


def _h_delivery(s, ev, p, known):
    po = _payout_for(s, p)
    st = p["status"]
    if s.closed:
        s.post_close.append({"status": st, "attempt": po["attempt"] if po else 0, "at": ev["known_at"],
                             "provenance": ev["provenance"]})
    applied = _set_delivery(s, po, st, ev, p) if po else False
    label = {"accepted": "provider acceptance (not credit)", "credited": "beneficiary credit",
             "failed": "payout failure", "returned": "payout return", "unknown": "delivery status unknown"}[st]
    src = " %s." % SANDBOX_LABEL if ev["provenance"] == "sandbox_simulation" else ""
    if applied:
        return "Recorded %s for attempt %d.%s" % (label, po["attempt"], src)
    return "Recorded %s for attempt %d out of order; stored, not applied (status stays %s).%s" % (
        label, po["attempt"] if po else 0, po["status"] if po else "none", src)


def _h_queried(s, ev, p, known):
    return "Queried payout status with the same reference %s (no re-submission); %d new provider event(s)." % (
        p.get("provider_ref"), p.get("new_events", 0))


def _h_reinstruct(s, ev, p, known):
    s.reinstruction_authorized = True
    return "Reviewer authorized a new payout attempt after the previous one %s." % p.get("after_status")


def _h_receipt(s, ev, p, known):
    rid = p["receipt_id"]
    s.customer_receipts.append({"id": rid, "money": _money_of(p), "effective_at": ev["effective_at"],
                                "reference": p.get("reference")})
    return "Customer receipt %s into the importer's own account (%s). This is not a repayment and does not reduce what is owed." % (
        _money_of(p), p.get("reference"))


def _h_repay(s, ev, p, known):
    rid = p["repayment_id"]
    s.repayments[rid] = {"id": rid, "money": _money_of(p), "effective_at": ev["effective_at"],
                         "bank_ref": p.get("bank_ref"), "status": p["initial_status"],
                         "duplicate_of": p.get("duplicate_of"), "match_id": None, "known_at": ev["known_at"]}
    if p["initial_status"] == "possible_duplicate":
        return "Repayment %s received by the provider (bank ref %s): possible duplicate of %s; not counted until resolved." % (
            _money_of(p), p.get("bank_ref"), p.get("duplicate_of"))
    return "Repayment %s received by the provider (bank ref %s); unallocated until matched." % (
        _money_of(p), p.get("bank_ref"))


def _h_dup(s, ev, p, known):
    r = s.repayments[p["repayment_id"]]
    if p["resolution"] == "duplicate":
        r["status"] = "void_duplicate"
        return "%s confirmed as a duplicate record of %s; it is not counted." % (r["id"], r["duplicate_of"])
    r["status"] = "unallocated"
    return "%s confirmed as a separate payment; now unallocated." % r["id"]


def _h_match(s, ev, p, known):
    r = s.repayments[p["repayment_id"]]
    r["status"] = "matched"
    r["match_id"] = p["match_id"]
    ccy = r["money"].currency
    s.matches[p["match_id"]] = {"id": p["match_id"], "repayment_id": r["id"], "fees": p["fees_minor"],
                                "principal": p["principal_minor"], "unmatched": p["unmatched_minor"],
                                "unmatched_id": p.get("unmatched_id"), "reversed": False, "currency": ccy}
    s.fees_repaid += p["fees_minor"]
    s.principal_repaid += p["principal_minor"]
    if p["unmatched_minor"] > 0:
        s.unmatched[p["unmatched_id"]] = {"id": p["unmatched_id"], "money": M.Money(p["unmatched_minor"], ccy),
                                          "reason_code": p["unmatched_reason"], "reason": p["unmatched_text"],
                                          "status": "open", "repayment_id": r["id"], "match_id": p["match_id"]}
    txt = "Matched %s (%s): fees %s, principal %s" % (r["id"], r["money"], mtext(p["fees_minor"], ccy),
                                                      mtext(p["principal_minor"], ccy))
    if p["unmatched_minor"]:
        txt += "; %s held as unmatched (%s)" % (mtext(p["unmatched_minor"], ccy), p["unmatched_text"])
    return txt + "."


def _h_return(s, ev, p, known):
    iid = p["item_id"]
    if iid in s.unmatched:
        s.unmatched[iid]["status"] = "returned"
        m = s.unmatched[iid]["money"]
    else:
        s.repayments[iid]["status"] = "returned"
        m = s.repayments[iid]["money"]
    return "Returned %s (%s) to the payer (reference %s). Returning never reduces what is owed." % (
        iid, m, p.get("reference"))


def _h_reverse(s, ev, p, known):
    mt = s.matches[p["match_id"]]
    mt["reversed"] = True
    s.fees_repaid -= mt["fees"]
    s.principal_repaid -= mt["principal"]
    if mt.get("unmatched_id") in s.unmatched:
        s.unmatched[mt["unmatched_id"]]["status"] = "reversed"
    r = s.repayments[mt["repayment_id"]]
    r["status"] = "unallocated"
    r["match_id"] = None
    return "Match %s reversed: fees %s and principal %s restored as owed; %s is unallocated again." % (
        mt["id"], mtext(mt["fees"], mt["currency"]), mtext(mt["principal"], mt["currency"]), r["id"])


def _h_note(s, ev, p, known):
    s.notes.append({"text": p["text"], "by": ev.get("actor_user_id"), "at": ev["known_at"]})
    return "Note: %s" % p["text"]


def _h_owner(s, ev, p, known):
    s.owner_user_id = p["user_id"]
    return "Handed off to %s%s" % (p.get("user_name") or ("user %s" % p["user_id"]),
                                   (": " + p["note"]) if p.get("note") else ".")


def _h_reopen(s, ev, p, known):
    s.closed = None
    s.post_close = []
    return "Reviewer reopened the case after a provider event arrived post-close."


def _h_close(s, ev, p, known):
    s.closed = {"kind": "closed", "at": ev["known_at"], "by": ev.get("actor_user_id")}
    return "Case closed: supplier credited, nothing owed, no open cash items."


def _h_close_exc(s, ev, p, known):
    s.closed = {"kind": "exception", "disposition": p["disposition"], "at": ev["known_at"],
                "by": ev.get("actor_user_id"), "owed": s.owed}
    _judge(s, ev, "closed_with_exception:%s" % p["disposition"], ev.get("reason"))
    extra = (" Still owed and kept on record: %s." % mtext(s.owed, s.fac_ccy)) if s.owed else ""
    return "Closed with exception (%s).%s" % (p["disposition"], extra)


def _judge(s, ev, decision, reason, **extra):
    j = {"seq": ev["seq"], "event_id": ev["id"], "decision": decision, "reason": reason,
         "by": ev.get("actor_user_id"), "by_role": ev.get("actor_role"), "at": ev["known_at"]}
    j.update(extra)
    s.judgments.append(j)


def _h_dup_check(s, ev, p, known):
    s.dup_check = {"status": p["status"], "matches": list(p.get("matches") or []), "text": p.get("text"),
                   "trigger": p.get("trigger"), "at": ev["known_at"], "seq": ev["seq"], "reason": None}
    s.dup_history.append(dict(s.dup_check))
    return "Same-provider duplicate check (%s): %s" % (p.get("trigger") or "intake", p.get("text"))


def _h_dup_check_resolved(s, ev, p, known):
    st = "overridden" if p["decision"] == "not_duplicate" else "duplicate"
    prev = s.dup_check or {"matches": []}
    text = ("Reviewer judged this not a duplicate of %s: %s" % (", ".join(prev["matches"]) or "the match", ev.get("reason"))
            if st == "overridden" else
            "Reviewer confirmed a duplicate of %s: this case may only be closed with exception duplicate_case."
            % (", ".join(prev["matches"]) or "another case"))
    s.dup_check = {"status": st, "matches": list(prev["matches"]), "text": text, "trigger": "review",
                   "at": ev["known_at"], "seq": ev["seq"], "reason": ev.get("reason"),
                   "by": ev.get("actor_user_id")}
    s.dup_history.append(dict(s.dup_check))
    _judge(s, ev, "duplicate_check:%s" % p["decision"], ev.get("reason"))
    return text


def _h_eligibility(s, ev, p, known):
    cp = dict(p)
    cp["seq"] = ev["seq"]
    cp["at"] = ev["known_at"]
    s.checkpoints.append(cp)
    cl, ad = p.get("blockers_cleared") or [], p.get("blockers_added") or []
    txt = "Eligibility evaluated (%s): route C %s → %s" % (p.get("trigger"), p.get("route_c_before") or "—",
                                                          p.get("route_c_after"))
    if cl:
        txt += "; cleared: %s" % "; ".join(b["text"] for b in cl)
    if ad:
        txt += "; added: %s" % "; ".join(b["text"] for b in ad)
    return txt + "."


def _h_default(s, ev, p, known):
    s.default_declared = {"at": ev["known_at"], "by": ev.get("actor_user_id"), "reason": ev.get("reason"),
                          "owed_minor": p.get("owed_minor")}
    _judge(s, ev, "default_declared", ev.get("reason"))
    return "Reviewer declared a default (judgment): %s. Amounts owed stay on record." % ev.get("reason")


def _h_work(s, ev, p, known):
    s.work_logs.append({"minutes": p["minutes"], "activity": p.get("activity"), "by": ev.get("actor_user_id"),
                        "at": ev["known_at"], "provenance": p.get("provenance", "operator_reported")})
    return "Work logged: %d min (%s), operator-reported." % (p["minutes"], p.get("activity"))


def _h_baseline(s, ev, p, known):
    s.baselines.append(dict(p, at=ev["known_at"], by=ev.get("actor_user_id")))
    return "Baseline recorded (%s): %s" % (p.get("provenance"), p.get("source_note"))


_HANDLERS = {
    "duplicate_check_run": _h_dup_check, "duplicate_check_resolved": _h_dup_check_resolved,
    "eligibility_evaluated": _h_eligibility, "default_declared": _h_default, "work_logged": _h_work,
    "baseline_recorded": _h_baseline,
    "case_created": _h_created, "observation_added": _h_obs, "observation_superseded": _h_supersede,
    "evidence_added": _h_evidence, "route_selected": _h_route, "advance_requested": _h_request,
    "evidence_requested": _h_evreq, "advance_declined": _h_decline, "advance_approved": _h_approve,
    "reservation_released": _h_release, "reservation_expired": _h_expire, "draw_referred": _h_referred,
    "draw_authorized": _h_draw_auth, "draw_recorded": _h_draw, "prefunding_recorded": _h_prefund,
    "payout_instructed": _h_instruct, "payout_submitted": _h_submitted, "delivery_recorded": _h_delivery,
    "payout_status_queried": _h_queried, "reinstruction_authorized": _h_reinstruct,
    "customer_receipt_recorded": _h_receipt, "repayment_recorded": _h_repay, "duplicate_resolved": _h_dup,
    "repayment_matched": _h_match, "unmatched_returned": _h_return, "match_reversed": _h_reverse,
    "note_added": _h_note, "owner_assigned": _h_owner, "case_closed": _h_close,
    "case_closed_with_exception": _h_close_exc, "case_reopened": _h_reopen,
}


# ---------------------------------------------------------------- facility arithmetic
def fee_minor(facility, funding_minor):
    return facility["fee_flat_minor"] + (funding_minor * facility["fee_bps"] + 5000) // 10000


def reservation_expiry(facility, case, now):
    lead = _dt.timedelta(hours=facility["payout_lead_hours"])
    return min(now + _dt.timedelta(hours=facility["reservation_hours"]), parse_iso(case["deadline_at"]) - lead)


def repayment_due(facility, case):
    """Due at 17:00 local, repayment_days after the supplier deadline's local date."""
    tz = zone(case["deadline_tz"])
    dl = parse_iso(case["deadline_at"]).astimezone(tz)
    day = dl.date() + _dt.timedelta(days=facility["repayment_days"])
    return _dt.datetime(day.year, day.month, day.day, 17, 0, tzinfo=tz).astimezone(UTC)


def capacity(facility, reserved_minor, principal_out_minor):
    headroom = facility["limit_minor"] - reserved_minor - principal_out_minor
    cash = facility["funding_account_start_minor"] - reserved_minor - principal_out_minor
    return {"limit": facility["limit_minor"], "reserved": reserved_minor, "principal_outstanding": principal_out_minor,
            "headroom": headroom, "funding_cash": cash, "funding_start": facility["funding_account_start_minor"]}


# ---------------------------------------------------------------- route assessment
def _latest(obs, key):
    return max(obs, key=lambda o: (o["data"][key], o["known_at"], o["seq"])) if obs else None


def fact_statuses(s, fac, now):
    """Mark every observation known at `now`: fresh | stale | superseded | conflicting (§13.3).

    Returns (status_by_event_id, conflicts_by_event_id). Two active records of the same kind conflict when they are
    in the same currency with different amounts and the same as-of instant (an invoice: the same invoice reference).
    """
    out = {}
    for oid in s.obs_order:
        o = s.observations[oid]
        if o["known_at"] > now:
            continue
        sup = o["superseded_by"]
        out[oid] = "superseded" if (sup is not None and s.observations[sup]["known_at"] <= now) else "fresh"
    active = s.active_observations(now)
    conflicts = {}
    for i, a in enumerate(active):
        for b in active[i + 1:]:
            if _conflict(a, b):
                conflicts.setdefault(a["id"], []).append(b["id"])
                conflicts.setdefault(b["id"], []).append(a["id"])
    for oid in conflicts:
        out[oid] = "conflicting"
    max_age = _dt.timedelta(hours=(fac or {}).get("balance_max_age_hours", 24))
    for o in active:
        if out[o["id"]] == "fresh" and o["kind"] == "balance" and now - o["data"]["as_of"] > max_age:
            out[o["id"]] = "stale"
    return out, conflicts


def _conflict(a, b):
    if a["kind"] != b["kind"] or a["kind"] not in MONEY_KINDS:
        return False
    ma, mb = a["data"]["money"], b["data"]["money"]
    if ma.currency != mb.currency or ma.minor == mb.minor:
        return False
    if a["kind"] == "invoice":
        return norm_ref(a["data"].get("invoice_ref")) == norm_ref(b["data"].get("invoice_ref"))
    key = KIND_TIME_KEY[a["kind"]]
    return a["data"].get(key) is not None and a["data"].get(key) == b["data"].get(key)


def _conflict_text(s, o, conflicts):
    group = sorted([o] + [s.observations[x] for x in conflicts.get(o["id"], [])], key=lambda g: g["seq"])
    key = KIND_TIME_KEY.get(o["kind"])
    when = (" as of %s" % local_text(o["data"][key], s.tz)) if key and o["data"].get(key) and o["kind"] != "invoice" \
        else (" for invoice %s" % o["data"].get("invoice_ref") if o["kind"] == "invoice" else "")
    return "Conflicting records: %s %s%s (events %s). Correct or supersede one of them." % (
        o["kind"].replace("_", " "), " vs ".join(str(g["data"]["money"]) for g in group), when,
        ", ".join(str(g["id"]) for g in group))


def assess(s, facility, cap, now):
    """Assess routes A, B, C at `now` using only records known at `now`. `cap` = capacity() excluding this case."""
    facts = fact_statuses(s, facility, now)
    return [_route_a(s, facility, now, facts), _route_b(s, facility, now, facts), _route_c(s, facility, cap, now, facts)]


def _base(key, title, s, needed_at, whose, risk, cost):
    return {"key": key, "title": title, "status": "feasible", "whose_money": whose,
            "needed_at": time_json(needed_at, s.tz) if needed_at else None, "amount": str(s.funding),
            "cost": cost, "risk_bearer": risk, "missing": [], "disqualifiers": [], "evidence_ids": [],
            "observation_ids": [], "selected": False, "blockers": []}


def _blk(r, bucket, code, kind, text, evidence_ids=()):
    """Record one blocker: `missing` makes the route unknown, `disqualifiers` infeasible (§13.4)."""
    r[bucket].append(text)
    r["blockers"].append({"code": code, "kind": kind, "text": text, "evidence_ids": [e for e in evidence_ids if e],
                          "effect": "unknown" if bucket == "missing" else "infeasible"})


def _finish(r):
    r["status"] = "infeasible" if r["disqualifiers"] else ("unknown" if r["missing"] else "feasible")
    return r


def _route_a(s, fac, now, facts):
    c = s.case
    status, conflicts = facts
    win, cut = parse_iso(c["window_a_at"]), parse_iso(c["window_a_cutoff_at"])
    r = _base("A", "Importer funds at window A", s, win, "Importer's own cash", "Importer",
              "Not modelled — importer's cost of cash")
    if now >= cut:
        _blk(r, "disqualifiers", "a_cutoff_passed", "time", "Window A cutoff %s has passed." % local_text(cut, s.tz))
    max_age = (fac or {}).get("balance_max_age_hours", 24)
    bals = s.active_observations(now, "balance")
    same = [o for o in bals if o["data"]["money"].currency == s.funding.currency]
    bal = _latest(same, "as_of")
    if bal is None:
        other = _latest(bals, "as_of")
        if other is not None:
            _blk(r, "missing", "balance_other_currency", "evidence",
                 "Importer balance is in %s; it cannot be counted against a %s need. Add a %s balance."
                 % (other["data"]["money"].currency, s.funding.currency, s.funding.currency), [other["evidence_id"]])
            r["observation_ids"].append(other["id"])
        else:
            _blk(r, "missing", "balance_missing", "evidence",
                 "No importer balance on record. Add a balance observation (with evidence).")
        return _finish(r)
    r["observation_ids"].append(bal["id"])
    if bal["evidence_id"]:
        r["evidence_ids"].append(bal["evidence_id"])
    if status.get(bal["id"]) == "conflicting":
        _blk(r, "missing", "conflicting_balance", "evidence", _conflict_text(s, bal, conflicts), [bal["evidence_id"]])
        return _finish(r)
    age = win - bal["data"]["as_of"]
    if age > _dt.timedelta(hours=max_age):
        _blk(r, "missing", "balance_stale", "evidence",
             "Importer balance as of %s is %s old at the window (limit %d h): unknown, not short. "
             "Add a newer balance." % (local_text(bal["data"]["as_of"], s.tz), age_text(age), max_age),
             [bal["evidence_id"]])
        return _finish(r)
    usable = bal["data"]["money"]
    for o in s.active_observations(now, "commitment"):
        due = o["data"]["due_at"]
        if due <= bal["data"]["as_of"] or due > cut:
            continue
        if o["data"]["money"].currency != usable.currency:
            _blk(r, "missing", "commitment_other_currency", "evidence",
                 "Commitment %s is in %s and cannot be netted against the %s balance." % (
                     o["data"]["money"], o["data"]["money"].currency, usable.currency), [o["evidence_id"]])
            continue
        usable = usable - o["data"]["money"]
        r["observation_ids"].append(o["id"])
    r["usable_balance"] = str(usable)
    if not r["missing"] and usable < s.funding:
        _blk(r, "disqualifiers", "usable_balance_short", "cash",
             "Usable importer balance %s (after commitments due by the cutoff) is below the %s needed."
             % (usable, s.funding), [bal["evidence_id"]])
    return _finish(r)


def _route_b(s, fac, now, facts):
    c = s.case
    status, conflicts = facts
    win = parse_iso(c["window_b_at"]) if c.get("window_b_at") else None
    cut = parse_iso(c["window_b_cutoff_at"]) if c.get("window_b_cutoff_at") else None
    r = _base("B", "Importer funds later at window B", s, win, "Importer's own cash, later",
              "Importer; supplier deadline if the later window slips", "Not modelled — importer's cost of cash")
    later, terms = s.later_permitted(now)
    if terms is not None:
        r["observation_ids"].append(terms["id"])
        if terms["evidence_id"]:
            r["evidence_ids"].append(terms["evidence_id"])
    if not later:
        _blk(r, "disqualifiers", "contract_fixed_date", "contract",
             "Contract fixes the funding date (%s): later funding is not permitted." % (
                 (terms and terms["data"].get("contract_ref")) or c.get("contract_ref") or "no contract ref"),
             [terms and terms["evidence_id"]])
        return _finish(r)
    if win is None or cut is None:
        _blk(r, "disqualifiers", "no_window_b", "contract", "No later funding window (window B) on record.")
        return _finish(r)
    if now >= cut:
        _blk(r, "disqualifiers", "b_cutoff_passed", "time", "Window B cutoff %s has passed." % local_text(cut, s.tz))
    lead = (fac or {}).get("payout_lead_hours", 8)
    if win + _dt.timedelta(hours=lead) > s.deadline:
        _blk(r, "disqualifiers", "b_after_deadline", "time",
             "Window B plus %d h payout lead time is after the supplier deadline %s." % (
                 lead, local_text(s.deadline, s.tz)))
    good, problems = None, []
    for o in s.active_observations(now, "cash_support"):
        m, eff = o["data"]["money"], o["data"]["effective_at"]
        if m.currency != s.funding.currency:
            problems.append(("cash_support_currency", "evidence", o,
                             "Cash support %s is in %s; it cannot count against a %s need." % (m, m.currency, s.funding.currency)))
        elif m < s.funding:
            problems.append(("cash_support_short", "cash", o, "Cash support %s covers less than the %s needed." % (m, s.funding)))
        elif eff > win:
            problems.append(("cash_support_late", "time", o,
                             "Cash support is effective only from %s, after window B." % local_text(eff, s.tz)))
        else:
            good = o
            break
    if good is not None:
        r["observation_ids"].append(good["id"])
        if good["evidence_id"]:
            r["evidence_ids"].append(good["evidence_id"])
        if status.get(good["id"]) == "conflicting":
            _blk(r, "missing", "conflicting_cash_support", "evidence", _conflict_text(s, good, conflicts),
                 [good["evidence_id"]])
    else:
        fc = s.active_observations(now, "expected_receipt")
        txt = "No documented cash support for window B."
        if fc:
            txt += " The expected receipt (%s) is a forecast and never counts." % fc[-1]["data"]["money"]
        if problems:
            for code, kind, o, t in problems:
                _blk(r, "disqualifiers", code, kind, t, [o["evidence_id"]])
        else:
            _blk(r, "disqualifiers", "cash_support_missing", "evidence", txt)
    return _finish(r)


def _policy_fact(s, fac, kind, now, facts, r):
    """§13.4: every kind in the facility's required evidence must be active, non-stale, non-conflicting."""
    status, conflicts = facts
    pol = fac["policy_version"]
    cands = s.active_observations(now, kind)
    if kind == "invoice" and s.case.get("invoice_ref"):
        want = norm_ref(s.case["invoice_ref"])
        match = [o for o in cands if norm_ref(o["data"].get("invoice_ref")) == want]
        if cands and not match:
            o = cands[-1]
            _blk(r, "missing", "invoice_ref_mismatch", "evidence",
                 "Policy %s requires invoice: the invoice on record (%s) does not match the case invoice reference %s."
                 % (pol, o["data"].get("invoice_ref"), s.case["invoice_ref"]), [o["evidence_id"]])
            r["observation_ids"].append(o["id"])
            return
        cands = match
    if not cands:
        _blk(r, "missing", "policy_requires_%s" % kind, "evidence",
             "Policy %s requires %s: not on record" % (pol, kind.replace("_", " ")))
        return
    key = KIND_TIME_KEY.get(kind)
    o = max(cands, key=lambda x: ((x["data"].get(key) or x["known_at"]) if key else x["known_at"], x["known_at"], x["seq"]))
    r["observation_ids"].append(o["id"])
    if o["evidence_id"]:
        r["evidence_ids"].append(o["evidence_id"])
    if status.get(o["id"]) == "conflicting":
        _blk(r, "missing", "conflicting_%s" % kind, "evidence", _conflict_text(s, o, conflicts), [o["evidence_id"]])
        return
    if kind == "balance":
        age = now - o["data"]["as_of"]
        if age > _dt.timedelta(hours=fac["balance_max_age_hours"]):
            _blk(r, "missing", "policy_stale_balance", "evidence",
                 "Policy %s requires balance: the importer balance on record is %s old (limit %d h): unknown, not "
                 "insufficient. Add a newer one." % (pol, age_text(age), fac["balance_max_age_hours"]),
                 [o["evidence_id"]])


def _route_c(s, fac, cap, now, facts):
    r = _base("C", "Provider advance (route C)", s, None, "Provider's funding account",
              "Provider, until repaid and matched", "—")
    r["capacity_ok"] = None
    r["cash_ok"] = None
    if not fac:
        _blk(r, "disqualifiers", "no_facility", "facility", "No advance facility on record for this case.")
        return _finish(r)
    lead = _dt.timedelta(hours=fac["payout_lead_hours"])
    r["needed_at"] = time_json(s.deadline - lead, s.tz)
    fee = fee_minor(fac, s.funding.minor) if fac["currency"] == s.funding.currency else fac["fee_flat_minor"]
    r["cost"] = "%s facility fee (policy %s)" % (mtext(fee, fac["currency"]), fac["policy_version"])
    r["fee"] = mtext(fee, fac["currency"])
    r["policy_version"] = fac["policy_version"]
    r["required_evidence"] = required_kinds(fac)
    r["whose_money"] = "Provider's funding account (facility %s)" % fac["id"]
    if s.auth in ("reserved", "consumed"):
        r["selected"] = True
        r["capacity_ok"] = r["cash_ok"] = True
        return _finish(r)
    if fac["status"] != "active":
        _blk(r, "disqualifiers", "facility_suspended", "facility",
             "Facility %s is suspended: unavailable for new advances." % fac["id"])
    if fac["currency"] != s.funding.currency:
        _blk(r, "disqualifiers", "facility_currency", "facility", "Facility lends in %s; this funding amount is in %s." % (
            fac["currency"], s.funding.currency))
        return _finish(r)
    r["capacity_ok"] = cap["headroom"] >= s.funding.minor
    r["cash_ok"] = cap["funding_cash"] >= s.funding.minor
    r["headroom"] = mtext(cap["headroom"], fac["currency"])
    r["funding_cash"] = mtext(cap["funding_cash"], fac["currency"])
    if not r["capacity_ok"]:
        _blk(r, "disqualifiers", "headroom_short", "credit",
             "Facility headroom %s is below the %s needed." % (r["headroom"], s.funding))
    if not r["cash_ok"]:
        _blk(r, "disqualifiers", "funding_cash_short", "cash",
             "Provider funding cash %s is below the %s needed." % (r["funding_cash"], s.funding))
    if now + lead > s.deadline:
        _blk(r, "disqualifiers", "too_late", "time",
             "Too late: the payout needs %d h lead time before the supplier deadline %s." % (
                 fac["payout_lead_hours"], local_text(s.deadline, s.tz)))
    elif reservation_expiry(fac, s.case, now) <= now:
        _blk(r, "disqualifiers", "reservation_would_expire", "time",
             "A reservation would expire before it could be drawn.")
    req = required_kinds(fac)
    for kind in req:
        _policy_fact(s, fac, kind, now, facts, r)
    if "balance" not in req:
        bal = _latest(s.active_observations(now, "balance"), "as_of")
        if bal is None:
            _blk(r, "missing", "balance_missing", "evidence",
                 "No importer balance on record; add one (with evidence) before requesting an advance.")
        else:
            r["observation_ids"].append(bal["id"])
            if bal["evidence_id"]:
                r["evidence_ids"].append(bal["evidence_id"])
            age = now - bal["data"]["as_of"]
            if age > _dt.timedelta(hours=fac["balance_max_age_hours"]):
                _blk(r, "missing", "balance_stale", "evidence",
                     "Importer balance is %s old (limit %d h): unknown, not insufficient. Add a newer one."
                     % (age_text(age), fac["balance_max_age_hours"]), [bal["evidence_id"]])
    if s.auth == "declined" and s.last_fact_seq <= (s.decline_seq or 0):
        _blk(r, "disqualifiers", "declined", "evidence",
             "The advance was declined by a reviewer; add new evidence before requesting again.")
    return _finish(r)


def mark_selected(s, routes):
    for r in routes:
        if (s.route and r["key"] == s.route) or (r["key"] == "C" and s.auth in ("reserved", "consumed")):
            r["selected"] = True
    return routes


# ---------------------------------------------------------------- allocation
def allocate(s, item):
    """Allocate one repayment item per the facility rule. Returns dict of minor amounts + unmatched reason."""
    m = item["money"]
    alloc = (s.facility or {}).get("allocation", "fees_first")
    if m.currency != s.fac_ccy:
        return {"fees": 0, "principal": 0, "unmatched": m.minor, "reason": "wrong_currency",
                "text": "Wrong currency: %s received; repayments are matched in %s only. Return it to the payer."
                        % (m.currency, s.fac_ccy)}
    left = m.minor
    order = ("fees", "principal") if alloc == "fees_first" else ("principal", "fees")
    out = {"fees": 0, "principal": 0}
    for k in order:
        owed = s.fees_outstanding if k == "fees" else s.principal_outstanding
        take = min(left, max(owed, 0))
        out[k] = take
        left -= take
    out["unmatched"] = left
    out["reason"] = "excess" if left else None
    out["text"] = ("Excess: %s more than was owed; held for review, never netted." % mtext(left, m.currency)) if left else None
    return out


# ---------------------------------------------------------------- identities
def case_identities(s, draw_row=None):
    ccy = s.fac_ccy
    out = []
    drawn = s.draw["principal"] if s.draw else 0
    po = s.principal_outstanding
    ok = po >= 0 and drawn == s.principal_repaid + po
    if draw_row is not None:
        ok = ok and draw_row["principal_minor"] == drawn and draw_row["principal_repaid_minor"] == s.principal_repaid
    elif s.draw:
        ok = False
    out.append({"name": "drawn = principal_repaid + principal_outstanding", "ok": ok,
                "detail": "%s = %s + %s" % (mtext(drawn, ccy), mtext(s.principal_repaid, ccy), mtext(po, ccy))})
    fo = s.fees_outstanding
    out.append({"name": "fees_charged = fees_repaid + fees_outstanding",
                "ok": fo >= 0 and s.fees_charged == s.fees_repaid + fo,
                "detail": "%s = %s + %s" % (mtext(s.fees_charged, ccy), mtext(s.fees_repaid, ccy), mtext(fo, ccy))})
    ccys = sorted({r["money"].currency for r in s.repayments.values()}) or [ccy]
    for c in ccys:
        items = [r for r in s.repayments.values() if r["money"].currency == c and r["status"] != "void_duplicate"]
        received = sum(r["money"].minor for r in items)
        mf = sum(mt["fees"] for mt in s.matches.values() if not mt["reversed"] and mt["currency"] == c)
        mp = sum(mt["principal"] for mt in s.matches.values() if not mt["reversed"] and mt["currency"] == c)
        um = sum(u["money"].minor for u in s.unmatched.values() if u["status"] == "open" and u["money"].currency == c)
        ret = sum(u["money"].minor for u in s.unmatched.values() if u["status"] == "returned" and u["money"].currency == c)
        ret += sum(r["money"].minor for r in items if r["status"] == "returned")
        ua = sum(r["money"].minor for r in items if r["status"] == "unallocated")
        dp = sum(r["money"].minor for r in items if r["status"] == "possible_duplicate")
        total = mf + mp + um + ua + ret + dp
        out.append({"name": "repayments received (%s) = matched fees + matched principal + unmatched + unallocated + returned + duplicates pending" % c,
                    "ok": received == total,
                    "detail": "%s = %s + %s + %s + %s + %s + %s (customer receipts excluded)" % tuple(
                        mtext(x, c) for x in (received, mf, mp, um, ua, ret, dp))})
    if s.auth == "consumed" and s.approval and s.draw:
        out.append({"name": "draw equals the reservation", "ok": s.draw["principal"] == s.approval["amount_minor"],
                    "detail": "%s drawn against %s reserved" % (mtext(s.draw["principal"], ccy),
                                                                 mtext(s.approval["amount_minor"], ccy))})
    if s.closed and s.closed["kind"] == "closed" and not s.post_close:
        out.append({"name": "closed ⇒ credited, nothing owed, no open items",
                    "ok": bool(s.latest_payout() and s.latest_payout()["status"] == "credited" and s.owed == 0
                               and s.open_items() == 0),
                    "detail": "owed %s, open items %d" % (mtext(s.owed, ccy), s.open_items())})
    return out


def facility_identity(fac, tbl, ev):
    """tbl/ev = {'reserved', 'principal_outstanding'} from constraint tables vs. the event log."""
    ccy = fac["currency"]
    avail = fac["limit_minor"] - tbl["reserved"] - tbl["principal_outstanding"]
    ok = avail >= 0 and tbl == ev
    detail = "%s = %s available + %s reserved + %s principal outstanding" % (
        mtext(fac["limit_minor"], ccy), mtext(avail, ccy), mtext(tbl["reserved"], ccy),
        mtext(tbl["principal_outstanding"], ccy))
    if tbl != ev:
        detail += " (event log says reserved %s, outstanding %s)" % (mtext(ev["reserved"], ccy),
                                                                     mtext(ev["principal_outstanding"], ccy))
    return {"name": "limit = available + reserved + principal_outstanding (%s)" % fac["id"], "ok": ok, "detail": detail}


# ---------------------------------------------------------------- preconditions
def _need_reason(params, field="reason"):
    v = (params or {}).get(field)
    if not isinstance(v, str) or not v.strip():
        raise DomainError(422, "validation_failed", "Give a %s." % field.replace("_", " "), field)


def precheck(s, cmd, params, now, actor=None, routes=None, connector_ok=True):
    """Raise DomainError when `cmd` is not allowed in this state. `params` may be partial (action listing)."""
    params = params or {}
    if cmd == "reopen_case":
        if not (s.closed and s.post_close):
            raise DomainError(409, "not_reopenable", "Only a closed case that received a provider event after closing can be reopened.")
        return
    if cmd in ("log_work", "record_baseline"):
        return
    if s.closed and cmd not in CLOSED_ALLOWED:
        raise DomainError(409, "case_closed", "The case is closed; only notes and pilot measurements can be added.")
    lp = s.latest_payout()
    dup = (s.dup_check or {}).get("status")
    if dup == "duplicate" and cmd not in CLOSED_ALLOWED + ("add_observation", "supersede_observation", "add_evidence",
                                                           "assign_owner", "close_with_exception"):
        raise DomainError(409, "duplicate_case", "A reviewer confirmed this case is a duplicate; it may only be "
                          "closed with exception duplicate_case.")
    if cmd == "resolve_duplicate_check":
        if dup != "potential_match":
            raise DomainError(409, "no_potential_match", "There is no potential duplicate match awaiting review.")
        d = params.get("decision")
        if d is not None and d not in ("not_duplicate", "duplicate"):
            raise DomainError(422, "validation_failed", "Decision is not_duplicate or duplicate.", "decision")
        return
    if cmd == "declare_default":
        if s.default_declared:
            raise DomainError(409, "already_declared", "A default was already declared on this case.")
        if not s.overdue(now):
            raise DomainError(409, "not_overdue", "A default can be declared only after the repayment due date with "
                              "money still owed; nothing becomes a default automatically.")
        return

    def route(key):
        return next(r for r in (routes or []) if r["key"] == key) if routes else None

    if cmd in ("add_observation", "add_note", "assign_owner", "add_evidence"):
        return
    if cmd == "supersede_observation":
        if not s.observations:
            raise DomainError(409, "nothing_to_correct", "There is no observation to correct.")
        eid = params.get("event_id")
        if eid is not None:
            o = s.observations.get(eid)
            if o is None:
                raise DomainError(404, "not_found", "Observation %s is not on this case." % eid, "event_id")
            if o["superseded_by"] is not None:
                raise DomainError(409, "already_superseded", "That observation was already corrected; correct the latest version.", "event_id")
        return
    if cmd == "select_route":
        if s.committed() or s.auth in ("requested", "evidence_requested"):
            raise DomainError(409, "route_committed", "A route is already selected or an advance is in progress.")
        key = params.get("route")
        if key is not None:
            if key not in ("A", "B"):
                raise DomainError(422, "validation_failed", "Route must be A or B (route C is requested as an advance).", "route")
            r = route(key)
            if r and r["status"] != "feasible":
                raise DomainError(409, "route_not_feasible", "Route %s is %s: %s" % (
                    key, r["status"], " ".join(r["disqualifiers"] + r["missing"])))
        return
    if cmd == "request_advance":
        if s.committed() or s.auth in ("requested", "consumed"):
            raise DomainError(409, "route_committed", "A route is already selected or an advance is already requested.")
        if s.auth == "declined" and s.last_fact_seq <= (s.decline_seq or 0):
            raise DomainError(409, "declined", "The advance was declined; add new evidence before requesting again, "
                              "select route A/B, or close with an exception.")
        if dup == "potential_match":
            raise DomainError(409, "potential_duplicate", "Possible duplicate of %s in this provider's book: a reviewer "
                              "must resolve the duplicate check first." % ", ".join(s.dup_check["matches"]))
        r = route("C")
        if r and r["status"] != "feasible":
            raise DomainError(409, "route_not_feasible", "Route C is %s: %s" % (
                r["status"], " ".join(r["disqualifiers"] + r["missing"])))
        return
    if cmd in ("approve_and_reserve", "decline", "request_evidence"):
        if s.auth != "requested":
            raise DomainError(409, "not_requested", "No advance request is awaiting review.")
        if cmd == "approve_and_reserve":
            if actor is not None and s.request and s.request["by"] == actor:
                raise DomainError(403, "four_eyes", "You requested this advance; a different reviewer must approve it.")
            r = route("C")
            if r and (r.get("capacity_ok") is False or r.get("cash_ok") is False):
                raise DomainError(409, "insufficient_capacity", "Insufficient capacity: %s Nothing was reserved." % " ".join(
                    d for d in r["disqualifiers"] if "headroom" in d or "funding cash" in d))
            if r and r["status"] != "feasible":
                raise DomainError(409, "route_not_feasible", "Route C is no longer feasible: %s" % " ".join(
                    r["disqualifiers"] + r["missing"]))
        return
    if cmd == "release_reservation":
        if s.auth != "reserved":
            raise DomainError(409, "no_reservation", "There is no active reservation to release.")
        return
    if cmd == "authorize_draw":
        if s.auth != "reserved" or not s.draw_referred or s.draw_authorized:
            raise DomainError(409, "not_referred", "No draw is waiting for reviewer authorization.")
        return
    if cmd == "record_draw":
        if s.draw:
            raise DomainError(409, "already_drawn", "Already drawn; a case has at most one draw.")
        if s.auth != "reserved":
            raise DomainError(409, "no_reservation", "Record a draw only against an active reservation (approve and reserve first).")
        fac = s.facility
        if fac and fac["status"] == "suspended":
            pol = fac["suspension_policy"]
            if pol == "block_draws":
                raise DomainError(409, "facility_suspended", "Facility %s is suspended and its policy blocks draws. Release the reservation." % fac["id"])
            if pol == "unset" and not s.draw_authorized:
                if s.draw_referred:
                    raise DomainError(409, "referred", "Draw referred to a reviewer: facility suspended with no suspension policy. Wait for Authorize draw.")
                return "refer"
        return
    if cmd == "record_prefunding":
        if s.route not in ("A", "B"):
            raise DomainError(409, "no_route", "Prefunding applies to routes A/B; select a route first.")
        if s.prefunding:
            raise DomainError(409, "already_prefunded", "Prefunding is already recorded.")
        return
    if cmd == "instruct_payout":
        if not s.funded():
            raise DomainError(409, "not_funded", "Instruct a payout only after the draw (route C) or importer prefunding (A/B).")
        if lp:
            if lp["status"] == "instructed":
                raise DomainError(409, "payout_live", "Attempt %d is instructed and awaiting the provider; only one live attempt is allowed. Never re-submit." % lp["attempt"])
            if lp["status"] == "unknown":
                raise DomainError(409, "delivery_unknown", "Attempt %d has no confirmed outcome; query its status with the same reference. Never re-submit." % lp["attempt"])
            if lp["status"] in ("accepted", "credited"):
                raise DomainError(409, "payout_live", "Attempt %d is %s; only one live payout attempt is allowed." % (lp["attempt"], lp["status"]))
            if not s.reinstruction_authorized:
                raise DomainError(409, "reinstruction_needed", "Attempt %d %s; a reviewer must authorize reinstruction first." % (lp["attempt"], lp["status"]))
        if params.get("route") == "sandbox" and not connector_ok:
            raise DomainError(409, "sandbox_unavailable", "The sandbox connector is not installed on this server; use the manual route.")
        return
    if cmd == "record_delivery":
        if not lp:
            raise DomainError(409, "no_payout", "No payout has been instructed.")
        if lp["route"] != "manual":
            raise DomainError(409, "sandbox_route", "Sandbox deliveries come only from provider events; use Query payout status.")
        st = params.get("status")
        if st is not None and st not in DELIVERY_STATUSES:
            raise DomainError(422, "validation_failed", "Status must be one of %s." % ", ".join(DELIVERY_STATUSES), "status")
        return
    if cmd == "query_payout_status":
        if not lp or lp["route"] != "sandbox":
            raise DomainError(409, "no_sandbox_payout", "Only a sandbox payout can be queried.")
        if not connector_ok:
            raise DomainError(409, "sandbox_unavailable", "The sandbox connector is not installed on this server.")
        return
    if cmd == "authorize_reinstruction":
        if not lp or lp["status"] not in ("failed", "returned"):
            raise DomainError(409, "not_failed", "Reinstruction is possible only after a failed or returned payout (never after unknown).")
        if s.reinstruction_authorized:
            raise DomainError(409, "already_authorized", "Reinstruction is already authorized.")
        return
    if cmd in ("record_customer_receipt", "record_repayment"):
        return
    if cmd == "match_repayment":
        if not s.unallocated():
            raise DomainError(409, "nothing_to_match", "No unallocated repayment is waiting to be matched.")
        rid = params.get("repayment_id")
        if rid is not None:
            r = s.repayments.get(rid)
            if r is None:
                raise DomainError(404, "not_found", "Repayment %s is not on this case." % rid, "repayment_id")
            if r["status"] != "unallocated":
                raise DomainError(409, "not_unallocated", "Repayment %s is %s, not unallocated." % (rid, r["status"].replace("_", " ")), "repayment_id")
        return
    if cmd == "resolve_duplicate":
        if not s.duplicates_pending():
            raise DomainError(409, "no_duplicate", "No possible duplicate is pending.")
        rid = params.get("repayment_id")
        if rid is not None and (rid not in s.repayments or s.repayments[rid]["status"] != "possible_duplicate"):
            raise DomainError(409, "no_duplicate", "%s is not a pending possible duplicate." % rid, "repayment_id")
        return
    if cmd == "return_unmatched":
        cands = [u["id"] for u in s.open_unmatched()] + [r["id"] for r in s.unallocated()]
        if not cands:
            raise DomainError(409, "nothing_to_return", "There is no unmatched or unallocated amount to return.")
        iid = params.get("item_id")
        if iid is not None and iid not in cands:
            raise DomainError(409, "not_returnable", "%s is not an open unmatched or unallocated item." % iid, "item_id")
        return
    if cmd == "reverse_match":
        live = [m for m in s.matches.values() if not m["reversed"]]
        if not live:
            raise DomainError(409, "nothing_to_reverse", "There is no match to reverse.")
        mid = params.get("match_id")
        if mid is not None:
            m = s.matches.get(mid)
            if m is None or m["reversed"]:
                raise DomainError(409, "not_reversible", "%s is not an active match." % mid, "match_id")
            u = s.unmatched.get(m.get("unmatched_id"))
            if u and u["status"] == "returned":
                raise DomainError(409, "not_reversible", "The excess from %s was already returned; it cannot be reversed." % mid, "match_id")
        return
    if cmd == "close_case":
        why = close_blockers(s)
        if why:
            raise DomainError(409, "cannot_close", "Cannot close: " + "; ".join(why) + ".")
        return
    if cmd == "close_with_exception":
        d = params.get("disposition")
        if d is not None and d not in DISPOSITIONS:
            raise DomainError(422, "validation_failed", "Disposition must be one of %s." % ", ".join(DISPOSITIONS), "disposition")
        if s.open_items():
            raise DomainError(409, "cash_held", "Return or resolve the payer's held cash first (%d open item(s)); "
                              "a closed case could no longer return it." % s.open_items())
        if lp and lp["status"] in ("instructed", "accepted", "unknown"):
            raise DomainError(409, "payout_outcome_open", "Attempt %d is %s; get the provider's final outcome (credited, "
                              "failed or returned) before closing." % (lp["attempt"], lp["status"]))
        if dup == "duplicate" and d is not None and d != "duplicate_case":
            raise DomainError(409, "duplicate_case", "A confirmed duplicate may only be closed with exception "
                              "duplicate_case.", "disposition")
        if d == "cancelled_before_payout" and s.payouts:
            raise DomainError(409, "payout_exists", "A payout was instructed on this case; it was not cancelled before payout.", "disposition")
        return
    raise DomainError(400, "unknown_command", "Unknown command %r." % cmd, "type")


def close_blockers(s):
    out = []
    lp = s.latest_payout()
    if not lp or lp["status"] != "credited":
        out.append("beneficiary credit is not evidenced")
    if s.owed > 0:
        out.append("%s is still owed" % mtext(s.owed, s.fac_ccy))
    if s.unallocated():
        out.append("%d repayment(s) unallocated" % len(s.unallocated()))
    if s.open_unmatched():
        out.append("%d unmatched item(s) open" % len(s.open_unmatched()))
    if s.duplicates_pending():
        out.append("%d possible duplicate(s) pending" % len(s.duplicates_pending()))
    return out


# ---------------------------------------------------------------- read model pieces
def status_key(s, now):
    if s.closed and s.post_close:
        return "post_close_review"
    if s.closed:
        return "closed" if s.closed["kind"] == "closed" else "closed_exception"
    lp = s.latest_payout()
    if lp:
        if lp["status"] == "credited":
            if s.overdue(now):
                return "overdue"
            return "credited_outstanding" if (s.owed > 0 or s.open_items()) else "ready_to_close"
        return {"instructed": "delivery_pending", "unknown": "delivery_unknown", "accepted": "provider_accepted",
                "failed": "delivery_failed", "returned": "delivery_returned"}[lp["status"]]
    if s.funded():
        return "funded"
    if s.auth == "reserved":
        return "draw_referred" if (s.draw_referred and not s.draw_authorized) else "reserved"
    if s.route:
        return "route_selected"
    return {"requested": "awaiting_review", "evidence_requested": "evidence_requested", "declined": "declined",
            "released": "released", "expired": "expired"}.get(s.auth, "assessing")


def supplier_panel(s):
    lp = s.latest_payout()
    if not lp:
        loc = "Provider funding account (not instructed)" if s.funded() else "Not funded"
        return {"status": "none", "label": "Payout not instructed", "last_evidenced": None, "location": loc,
                "provenance": None, "attempt": None, "sandbox": False}
    labels = {"instructed": "Payout instructed — no provider response yet",
              "unknown": "Delivery status unknown — query the provider; do not re-submit",
              "accepted": "Accepted by the provider — not yet credited to the beneficiary",
              "credited": "Credited to the beneficiary",
              "failed": "Payout failed — not delivered", "returned": "Payout returned — not delivered"}
    label = labels[lp["status"]]
    sandbox = lp["route"] == "sandbox"
    if sandbox:
        label += " (%s)" % SANDBOX_LABEL
    return {"status": lp["status"], "label": label, "last_evidenced": time_json(lp["last_evidenced"], s.tz),
            "location": lp["location"], "provenance": lp["provenance"], "attempt": lp["attempt"],
            "route": lp["route"], "external_ref": lp["external_ref"], "provider_ref": lp.get("provider_ref"),
            "sandbox": sandbox, "sandbox_label": SANDBOX_LABEL if sandbox else None,
            "history": [dict(h) for h in lp["history"]]}


def exposure_panel(s, now):
    ccy = s.fac_ccy
    if s.draw:
        st = "outstanding" if s.owed > 0 else "ended"
    elif s.auth == "reserved":
        st = "reserved"
    else:
        st = "none"
    due = s.due_at()
    od = s.overdue(now)
    if s.default_declared:
        label = "Default declared by a reviewer (judgment, %s) — amounts owed stay on record" % (
            local_text(s.default_declared["at"], s.tz))
    elif s.closed and s.closed.get("disposition") == "write_off_referred":
        label = "Write-off referred by a reviewer (default judgment) — amounts owed stay on record"
    elif od:
        label = OVERDUE_LABEL
    else:
        label = {"outstanding": "Outstanding — owed to the provider", "reserved": "Reserved capacity — not a draw",
                 "ended": "Repaid and matched", "none": "No provider exposure"}[st]
    return {"status": st, "currency": ccy, "status_label": label,
            "default_declared": dict(s.default_declared) if s.default_declared else None,
            "reserved": mtext(s.reserved_minor, ccy),
            "principal_outstanding": mtext(s.principal_outstanding, ccy),
            "fees_outstanding": mtext(s.fees_outstanding, ccy),
            "total_outstanding": mtext(s.owed, ccy),
            "drawn": mtext(s.draw["principal"] if s.draw else 0, ccy),
            "principal_repaid": mtext(s.principal_repaid, ccy), "fees_repaid": mtext(s.fees_repaid, ccy),
            "due_at_local": local_text(due, s.tz) if due and st in ("reserved", "outstanding") else None,
            "due_at_utc": iso(due) if due else None,
            "overdue": s.overdue(now),
            "owed_by": s.case["importer"] if s.draw else None,
            "owed_to": ("Provider (facility %s)" % s.facility["id"]) if (s.draw and s.facility) else None,
            "allocation_rule": ("Fees first, then principal; excess held as unmatched"
                                if (s.facility or {}).get("allocation", "fees_first") == "fees_first"
                                else "Principal first, then fees; excess held as unmatched")}


def collections(s, now):
    er = s.active_observations(now, "expected_receipt")
    exp = None
    if er:
        o = er[-1]
        exp = {"amount": str(o["data"]["money"]), "expected_at": time_json(o["data"]["expected_at"], s.tz),
               "payer": o["data"].get("payer"), "label": "Forecast — not cash, never counted"}
    reps = []
    for r in s.repayments.values():
        mt = s.matches.get(r["match_id"]) if r["match_id"] else None
        c = r["money"].currency
        reps.append({"id": r["id"], "amount": str(r["money"]), "status": r["status"], "bank_ref": r["bank_ref"],
                     "effective_at": time_json(r["effective_at"], s.tz), "duplicate_of": r["duplicate_of"],
                     "match_id": r["match_id"],
                     "allocation": {"fees": mtext(mt["fees"], c), "principal": mtext(mt["principal"], c),
                                    "unmatched": mtext(mt["unmatched"], c)} if mt else None})
    return {"expected_receipt": exp,
            "customer_receipts": [{"id": c["id"], "amount": str(c["money"]), "reference": c["reference"],
                                   "effective_at": time_json(c["effective_at"], s.tz),
                                   "label": "Importer's own account — not a repayment"} for c in s.customer_receipts],
            "repayments": reps,
            "matches": [{"id": m["id"], "repayment_id": m["repayment_id"], "fees": mtext(m["fees"], m["currency"]),
                         "principal": mtext(m["principal"], m["currency"]),
                         "unmatched": mtext(m["unmatched"], m["currency"]), "reversed": m["reversed"]}
                        for m in s.matches.values()],
            "unmatched": [{"id": u["id"], "amount": str(u["money"]), "reason": u["reason"], "reason_code": u["reason_code"],
                           "status": u["status"], "repayment_id": u["repayment_id"]} for u in s.unmatched.values()
                          if u["status"] != "reversed"]}


def decision(s, routes, now):
    """{headline, tone, binding_constraint, next_action, owner_role}."""
    def dec(tone, headline, binding, nxt, role):
        return {"tone": tone, "headline": headline, "binding_constraint": binding, "next_action": nxt,
                "owner_role": role}
    ccy = s.fac_ccy
    if s.closed and s.post_close:
        last = s.post_close[-1]
        return dec("review", "Closed case received a provider event after closing: payout attempt %d %s." % (
            last["attempt"], last["status"]), "The provider reported this after the case was closed; the closing record may no longer be true.",
            {"label": "Reopen case (provider event after close)", "command": "reopen_case", "role": "reviewer"}, "reviewer")
    if s.closed:
        if s.closed["kind"] == "closed":
            return dec("closed", "Closed: supplier credited, repaid and matched.", None, None, None)
        owed = (" %s remains owed and stays on record." % mtext(s.owed, ccy)) if s.owed else ""
        return dec("closed", "Closed with exception (%s).%s" % (s.closed["disposition"], owed), None, None, None)
    lp = s.latest_payout()
    dup = (s.dup_check or {}).get("status")
    if dup == "duplicate":
        return dec("blocked", "Confirmed duplicate of %s: close this case with exception duplicate_case." % ", ".join(
            s.dup_check["matches"]), "Reviewer confirmed a duplicate in this provider's book",
            {"label": "Close with exception", "command": "close_with_exception", "role": "reviewer",
             "params": {"disposition": "duplicate_case"}}, "reviewer")
    if dup == "potential_match" and not s.committed() and s.auth not in ("requested", "consumed") and not lp:
        return dec("review", "Possible duplicate in this provider's book (%s): a reviewer must resolve the duplicate "
                   "check before an advance can be requested." % ", ".join(s.dup_check["matches"]),
                   "Same-provider duplicate check", {"label": "Resolve duplicate check",
                                                     "command": "resolve_duplicate_check", "role": "reviewer"},
                   "reviewer")
    if s.auth == "requested":
        return dec("decide", "Advance requested — awaiting a different reviewer.",
                   "Reviewer approval (four-eyes) and facility capacity at approval time",
                   {"label": "Approve and reserve capacity", "command": "approve_and_reserve", "role": "reviewer"}, "reviewer")
    if s.auth == "evidence_requested":
        return dec("unknown", "Reviewer requested evidence: %s" % (s.evidence_request or {}).get("what"),
                   "Evidence the reviewer asked for",
                   {"label": "Add the evidence, then Request advance", "command": "add_observation", "role": "operator"}, "operator")
    if s.auth == "reserved" and s.draw_referred and not s.draw_authorized:
        return dec("review", "Draw referred: facility %s is suspended and has no suspension policy." % s.facility["id"],
                   "Suspension policy unset",
                   {"label": "Authorize draw", "command": "authorize_draw", "role": "reviewer"}, "reviewer")
    if lp:
        st = lp["status"]
        if st in ("instructed", "unknown"):
            nxt = ({"label": "Query payout status", "command": "query_payout_status", "role": "operator"}
                   if lp["route"] == "sandbox" else
                   {"label": "Record provider acceptance", "command": "record_delivery", "role": "operator"})
            return dec("unknown", "Payout attempt %d: delivery %s. Do not re-submit." % (
                lp["attempt"], "unknown — no provider confirmation" if st == "unknown" else "awaiting provider response"),
                "Provider confirmation of the instruction", nxt, "operator")
        if st == "accepted":
            nxt = ({"label": "Query payout status", "command": "query_payout_status", "role": "operator"}
                   if lp["route"] == "sandbox" else
                   {"label": "Record beneficiary credit", "command": "record_delivery", "role": "operator"})
            return dec("unknown", "Provider accepted the payout; beneficiary credit is not yet evidenced.",
                       "Beneficiary credit evidence", nxt, "operator")
        if st in ("failed", "returned"):
            if s.reinstruction_authorized:
                return dec("failed", "Payout %s; reinstruction authorized." % st, "New payout attempt",
                           {"label": "Instruct payout", "command": "instruct_payout", "role": "operator"}, "operator")
            return dec("failed", "Payout %s. Funds last evidenced: %s. No automatic resend." % (st, lp["location"]),
                       "Reviewer decision on reinstruction",
                       {"label": "Authorize reinstruction", "command": "authorize_reinstruction", "role": "reviewer"}, "reviewer")
        # credited
        if s.duplicates_pending():
            return dec("review", "Supplier credited; a possible duplicate repayment needs resolving.", "Possible duplicate",
                       {"label": "Resolve possible duplicate", "command": "resolve_duplicate", "role": "operator"}, "operator")
        if s.unallocated():
            return dec("review" if s.overdue(now) else "delivered_exposure",
                       "Supplier credited; a repayment is waiting to be matched (%s owed)." % mtext(s.owed, ccy),
                       "Unallocated repayment", {"label": "Match repayment", "command": "match_repayment", "role": "operator"}, "operator")
        if s.open_unmatched():
            return dec("review", "Supplier credited; unmatched cash must be returned before closing.", "Unmatched cash",
                       {"label": "Return unmatched amount", "command": "return_unmatched", "role": "reviewer"}, "reviewer")
        if s.owed > 0:
            due = s.due_at()
            if s.overdue(now):
                return dec("review", "Repayment overdue (not a default determination): %s owed by %s since %s." % (
                    mtext(s.owed, ccy), s.case["importer"], local_text(due, s.tz)), "Importer repayment",
                    {"label": "Record repayment to provider", "command": "record_repayment", "role": "operator"}, "operator")
            return dec("delivered_exposure", "Supplier credited; %s owes the provider %s, due %s." % (
                s.case["importer"], mtext(s.owed, ccy), local_text(due, s.tz) if due else "—"), "Importer repayment",
                {"label": "Record repayment to provider", "command": "record_repayment", "role": "operator"}, "operator")
        return dec("decide", "Supplier credited and nothing is owed: ready to close.", None,
                   {"label": "Close case", "command": "close_case", "role": "operator"}, "operator")
    if s.funded():
        return dec("decide", "Funded (%s); instruct the payout." % ("draw recorded" if s.draw else "importer prefunding received"),
                   "Payout before %s" % local_text(s.deadline, s.tz),
                   {"label": "Instruct payout", "command": "instruct_payout", "role": "operator"}, "operator")
    if s.auth == "reserved":
        return dec("decide", "Capacity reserved (not a draw); record the draw before %s." % local_text(s.approval["expires_at"], s.tz),
                   "Reservation expiry %s" % local_text(s.approval["expires_at"], s.tz),
                   {"label": "Record draw", "command": "record_draw", "role": "operator"}, "operator")
    if s.route:
        return dec("decide", "Route %s selected: the importer funds from its own cash." % s.route,
                   "Importer prefunding by the window cutoff",
                   {"label": "Record importer prefunding", "command": "record_prefunding", "role": "operator"}, "operator")
    if s.auth == "declined" and s.last_fact_seq > (s.decline_seq or 0):
        rc = next((r for r in routes if r["key"] == "C"), None)
        hl = ("Advance declined earlier (that judgment stays on record); new evidence has been added since, so the "
              "operator may request again.")
        if rc and rc["status"] != "feasible" and rc["blockers"]:
            hl += " Route C is %s: %s" % (rc["status"], rc["blockers"][0]["text"])
        return dec("declined", hl, rc["blockers"][0]["text"] if rc and rc["blockers"] else None,
                   _route_next(routes) or {"label": "Add observation", "command": "add_observation",
                                           "role": "operator"}, "operator")
    if s.auth == "declined":
        return dec("declined", "Advance declined: nothing reserved. The importer funds itself or the case closes with an exception.",
                   None, _route_next(routes) or {"label": "Close with exception", "command": "close_with_exception",
                                                  "role": "reviewer"}, "operator")
    if s.auth in ("released", "expired"):
        hl = "Reservation %s unused: nothing reserved now." % s.auth
        return dec("declined", hl, None, _route_next(routes), "operator")
    feas = [r for r in routes if r["status"] == "feasible"]
    if feas:
        keys = " and ".join(r["key"] for r in feas)
        hl = ("Route %s is feasible on the evidence known now." % keys if len(feas) == 1 else
              "Routes %s are feasible on the evidence known now; costs are different kinds and are not ranked." % keys)
        unk = [r["key"] for r in routes if r["status"] == "unknown"]
        if unk:
            hl += " Route %s cannot be confirmed yet (evidence missing or stale)." % " and ".join(unk)
        return dec("decide", hl, "Supplier deadline %s" % local_text(s.deadline, s.tz), _route_next(routes), "operator")
    rc = next((r for r in routes if r["key"] == "C"), None)
    if rc and rc["status"] == "infeasible" and not rc["missing"]:
        money = [b for b in rc["blockers"] if b["kind"] in ("cash", "credit")]
        if money:
            # Evidence cannot create money: the next step is outside the tool (provider treasury / credit).
            short = []
            for bl in money:
                if bl["code"] == "funding_cash_short":
                    short.append("funding cash %s is below %s" % (rc.get("funding_cash"), s.funding))
                elif bl["code"] == "headroom_short":
                    short.append("facility headroom %s is below %s" % (rc.get("headroom"), s.funding))
                else:
                    short.append(bl["text"])
            nxt = {"label": "Refer to provider treasury: %s; or record Option A/B if feasible" % "; ".join(short),
                   "command": None, "role": "reviewer", "outside_tool": True}
            return dec("blocked", "No feasible route: route C is blocked even with complete evidence — %s" % " ".join(
                b["text"] for b in money), money[0]["text"], nxt, "reviewer")
    unknown = [r for r in routes if r["status"] == "unknown"]
    if unknown:
        miss = unknown[0]["missing"][0]
        return dec("unknown", "No route can be confirmed yet: %s" % miss, miss,
                   {"label": "Add observation", "command": "add_observation", "role": "operator"}, "operator")
    return dec("blocked", "No feasible route on the evidence known now.", _binding(s, routes),
               {"label": "Close with exception", "command": "close_with_exception", "role": "reviewer"}, "reviewer")


def _route_next(routes):
    for r in routes or []:
        if r["status"] == "feasible":
            if r["key"] == "C":
                return {"label": "Request advance", "command": "request_advance", "role": "operator"}
            return {"label": "Select route %s" % r["key"], "command": "select_route", "role": "operator",
                    "params": {"route": r["key"]}}
    return None


def _binding(s, routes):
    for r in routes:
        if r["disqualifiers"]:
            return "%s: %s" % (r["key"], r["disqualifiers"][0])
    return "Supplier deadline %s" % local_text(s.deadline, s.tz)


_PARAMS = {
    "add_observation": ["kind", "amount", "currency", "as_of", "source", "due_at", "description", "effective_at",
                        "document_ref", "expected_at", "payer", "later_permitted", "contract_ref", "evidence_id",
                        "invoice_ref", "issuer", "issued_at", "record_ref", "scope"],
    "supersede_observation": ["event_id", "reason", "...replacement fields"],
    "add_note": ["text"], "assign_owner": ["user_id", "note"],
    "select_route": ["route", "reason"], "request_advance": ["reason"], "approve_and_reserve": ["reason"],
    "decline": ["reason"], "request_evidence": ["what"], "release_reservation": ["reason"],
    "authorize_draw": ["reason"], "record_draw": ["effective_at", "reference"],
    "record_prefunding": ["amount", "currency", "effective_at", "reference"],
    "instruct_payout": ["route", "external_ref", "evidence_id", "scenario"],
    "record_delivery": ["status", "effective_at", "reference", "location", "evidence_id"],
    "query_payout_status": [], "authorize_reinstruction": ["reason"],
    "record_customer_receipt": ["amount", "currency", "effective_at", "reference"],
    "record_repayment": ["amount", "currency", "effective_at", "bank_ref"],
    "match_repayment": ["repayment_id"], "resolve_duplicate": ["repayment_id", "resolution"],
    "return_unmatched": ["item_id", "reason", "reference"], "reverse_match": ["match_id", "reason"],
    "close_case": [], "close_with_exception": ["disposition", "reason"], "reopen_case": ["reason"],
    "resolve_duplicate_check": ["decision", "reason"], "declare_default": ["reason"],
    "log_work": ["minutes", "activity", "provenance"],
    "record_baseline": ["provenance", "operator_minutes", "touchpoints", "evidence_requests", "decision_hours",
                        "deadline_met", "outcome", "source_note"],
}

_LABELS = {
    "add_observation": "Add observation", "supersede_observation": "Correct an observation", "add_note": "Add note",
    "assign_owner": "Assign owner / hand off", "request_advance": "Request advance",
    "approve_and_reserve": "Approve and reserve capacity", "decline": "Decline", "request_evidence": "Request evidence",
    "release_reservation": "Release reservation", "authorize_draw": "Authorize draw", "record_draw": "Record draw",
    "record_prefunding": "Record importer prefunding", "instruct_payout": "Instruct payout",
    "query_payout_status": "Query payout status", "authorize_reinstruction": "Authorize reinstruction",
    "record_customer_receipt": "Record customer receipt (importer's account)",
    "record_repayment": "Record repayment to provider", "match_repayment": "Match repayment",
    "resolve_duplicate": "Resolve possible duplicate", "return_unmatched": "Return unmatched amount",
    "reverse_match": "Reverse match", "close_case": "Close case", "close_with_exception": "Close with exception",
    "reopen_case": "Reopen case (provider event after close)",
    "resolve_duplicate_check": "Resolve duplicate check", "declare_default": "Declare default (reviewer judgment)",
    "log_work": "Log work time", "record_baseline": "Record baseline",
}
_DELIVERY_LABELS = {"accepted": "Record provider acceptance", "credited": "Record beneficiary credit",
                    "failed": "Record payout failure", "returned": "Record payout return",
                    "unknown": "Record delivery status unknown"}


def actions(s, routes, now, user, connector_ok=True):
    """Every action relevant to this state, with enabled/disabled_reason for this user."""
    out = []
    role = user["role"] if user else None

    def add(cmd, label=None, preset=None):
        reason = None
        if not allowed(role, cmd):
            reason = "%s only." % ("Reviewer" if role_for(cmd) == "reviewer" else
                                   "Operator or reviewer" if cmd in OPERATOR_AND_REVIEWER else "Operator")
        else:
            try:
                precheck(s, cmd, preset or {}, now, actor=user["id"], routes=routes, connector_ok=connector_ok)
            except DomainError as e:
                reason = e.message
        a = {"type": cmd, "label": label or _LABELS.get(cmd, cmd), "enabled": reason is None,
             "disabled_reason": reason, "role": role_for(cmd) if cmd not in OPERATOR_AND_REVIEWER else "operator",
             "params": list(_PARAMS.get(cmd, []))}
        if cmd in OPERATOR_AND_REVIEWER:
            a["roles"] = ["operator", "reviewer"]
        if preset:
            a["preset"] = dict(preset)
        out.append(a)

    if s.closed:
        if s.post_close:
            add("reopen_case")
        add("add_note")
        add("log_work")
        add("record_baseline")
        return out
    lp = s.latest_payout()
    if not s.committed() and s.auth not in ("requested", "evidence_requested", "consumed"):
        for k, lbl in (("A", "Select route A (importer funds at window A)"), ("B", "Select route B (importer funds later)")):
            add("select_route", lbl, {"route": k})
    if not s.committed() and s.auth not in ("requested", "consumed"):
        add("request_advance")
    if (s.dup_check or {}).get("status") == "potential_match":
        add("resolve_duplicate_check")
    if s.overdue(now) and not s.default_declared:
        add("declare_default")
    if s.auth == "requested":
        add("approve_and_reserve")
        add("decline")
        add("request_evidence")
    if s.auth == "reserved":
        add("record_draw")
        add("release_reservation")
        if s.draw_referred:
            add("authorize_draw")
    if s.route and not s.prefunding:
        add("record_prefunding")
    if s.funded():
        if not lp or lp["status"] in ("failed", "returned"):
            add("instruct_payout")
        if lp and lp["route"] == "manual" and lp["status"] not in ("failed", "returned"):
            for st in ("accepted", "credited", "failed", "returned", "unknown"):
                if delivery_applies(lp["status"], st):
                    add("record_delivery", _DELIVERY_LABELS[st], {"status": st})
        if lp and lp["route"] == "sandbox" and lp["status"] not in ("credited", "failed", "returned"):
            add("query_payout_status")
        if lp and lp["status"] in ("failed", "returned"):
            add("authorize_reinstruction")
    add("record_customer_receipt")
    if s.draw or s.repayments:
        add("record_repayment")
    for r in s.unallocated():
        add("match_repayment", "Match repayment %s (%s)" % (r["id"], r["money"]), {"repayment_id": r["id"]})
    for r in s.duplicates_pending():
        add("resolve_duplicate", "Resolve possible duplicate %s" % r["id"], {"repayment_id": r["id"]})
    for u in s.open_unmatched():
        add("return_unmatched", "Return unmatched amount %s (%s)" % (u["id"], u["money"]), {"item_id": u["id"]})
    for m in s.matches.values():
        if not m["reversed"]:
            add("reverse_match", "Reverse match %s" % m["id"], {"match_id": m["id"]})
    if lp and lp["status"] == "credited":
        add("close_case")
    add("close_with_exception")
    add("add_observation")
    if s.observations:
        add("supersede_observation")
    add("add_note")
    add("assign_owner")
    add("log_work")
    add("record_baseline")
    return out


# ---------------------------------------------------------------- decision record (§13.5)
def route_snapshot(routes):
    """{key: {status, blockers:[{code, kind, text}]}} — what a checkpoint compares."""
    return {r["key"]: {"status": r["status"],
                       "blockers": [{"code": b["code"], "kind": b["kind"], "text": b["text"],
                                     "evidence_ids": list(b.get("evidence_ids") or [])} for b in r.get("blockers", [])]}
            for r in routes}


def _sig(snap):
    return {k: (v["status"], tuple(sorted(b["code"] for b in v["blockers"]))) for k, v in (snap or {}).items()}


def snapshot_changed(before, after):
    return _sig(before) != _sig(after)


def checkpoint_facts(s, fac, routes, now):
    status, _ = fact_statuses(s, fac, now)
    observed = []
    for o in s.active_observations(now):
        observed.append({"event_id": o["id"], "kind": o["kind"], "text": _obs_text(o["kind"], o["data"]),
                         "provenance": o["provenance"], "evidence_id": o["evidence_id"], "issuer": o.get("issuer"),
                         "record_ref": o.get("record_ref"), "scope": o.get("scope"),
                         "fact_status": status.get(o["id"]), "known_at": iso(o["known_at"])})
    for e in s.evidence.values():
        observed.append({"evidence_id": e["id"], "kind": "evidence_file", "text": "Evidence file %s (sha256 %s)" % (
            e["filename"], e["sha256"][:12]), "provenance": e["provenance"], "known_at": e["known_at"]})
    policy = []
    pv = (fac or {}).get("policy_version")
    rc = next((r for r in routes if r["key"] == "C"), None)
    if fac:
        codes = {b["code"]: b for b in (rc or {}).get("blockers", [])}
        for kind in required_kinds(fac):
            bad = [b for c, b in codes.items() if c in ("policy_requires_%s" % kind, "conflicting_%s" % kind)
                   or (kind == "balance" and c == "policy_stale_balance")
                   or (kind == "invoice" and c == "invoice_ref_mismatch")]
            policy.append({"rule": "required_evidence:%s" % kind, "policy_version": pv,
                           "result": "not met" if bad else "met", "text": bad[0]["text"] if bad else
                           "Policy %s requires %s: on record" % (pv, kind)})
        for code, rule in (("headroom_short", "capacity:headroom"), ("funding_cash_short", "capacity:funding_cash")):
            if rc and rc.get("capacity_ok") is not None:
                b = codes.get(code)
                policy.append({"rule": rule, "policy_version": pv, "result": "not met" if b else "met",
                               "text": b["text"] if b else "%s %s ≥ %s needed" % (
                                   "Headroom" if "headroom" in code else "Funding cash",
                                   rc.get("headroom" if "headroom" in code else "funding_cash"), s.funding)})
    for r in routes:
        policy.append({"rule": "route_%s" % r["key"], "policy_version": pv if r["key"] == "C" else None,
                       "result": r["status"], "text": "; ".join(b["text"] for b in r.get("blockers", [])) or
                       "No blockers"})
    judgment = [dict(j) for j in s.judgments]
    return {"observed": observed, "policy": policy, "judgment": judgment}


def eligibility_payload(s, fac, before, after_routes, trigger, trigger_seq, now):
    """Payload of an `eligibility_evaluated` event, or None when no route's status or blockers changed."""
    after = route_snapshot(after_routes)
    if before is not None and not snapshot_changed(before, after):
        return None
    bc = {(k, b["code"]): b for k, v in (before or {}).items() for b in v["blockers"]}
    ac = {(k, b["code"]): b for k, v in after.items() for b in v["blockers"]}
    cleared = [dict(b, route=k) for (k, c), b in bc.items() if (k, c) not in ac]
    added = [dict(b, route=k) for (k, c), b in ac.items() if (k, c) not in bc]
    return {"trigger": trigger, "trigger_event_seq": trigger_seq,
            "route_c_before": (before or {}).get("C", {}).get("status"), "route_c_after": after["C"]["status"],
            "routes_before": before, "routes_after": after, "blockers_cleared": cleared, "blockers_added": added,
            "policy_version": (fac or {}).get("policy_version"),
            "facts": checkpoint_facts(s, fac, after_routes, now)}


def decision_record(s, routes, now):
    status, conflicts = fact_statuses(s, s.facility, now)
    cps = []
    for cp in s.checkpoints:
        cps.append({"at": cp["at"], "seq": cp["seq"], "trigger_event_seq": cp.get("trigger_event_seq"),
                    "trigger": cp.get("trigger"), "route_c_before": cp.get("route_c_before"),
                    "route_c_after": cp.get("route_c_after"), "blockers_cleared": cp.get("blockers_cleared") or [],
                    "blockers_added": cp.get("blockers_added") or [], "policy_version": cp.get("policy_version"),
                    "facts": cp.get("facts") or {"observed": [], "policy": [], "judgment": []}})
    waiting = []
    for r in routes:
        if r["status"] != "feasible":
            for b in r.get("blockers", []):
                waiting.append(dict(b, route=r["key"]))
    last = cps[-1] if cps else None
    changed = ([dict(x, change="cleared", at=last["at"], trigger=last["trigger"]) for x in last["blockers_cleared"]]
               + [dict(x, change="added", at=last["at"], trigger=last["trigger"]) for x in last["blockers_added"]]
               if last else [])
    uncertain = []
    for oid, st in status.items():
        if st in ("stale", "conflicting"):
            o = s.observations[oid]
            uncertain.append({"kind": st, "event_id": oid, "text": "%s record %s: %s" % (
                st.capitalize(), oid, _obs_text(o["kind"], o["data"]))})
    lp = s.latest_payout()
    if lp and lp["status"] in ("unknown", "instructed", "accepted"):
        uncertain.append({"kind": "delivery_unknown", "text": "Payout attempt %d: beneficiary credit not evidenced "
                          "(status %s)." % (lp["attempt"], lp["status"])})
    for u in s.open_unmatched():
        uncertain.append({"kind": "unmatched_cash", "text": "Unmatched cash %s (%s)." % (u["money"], u["reason"])})
    for r in s.unallocated():
        uncertain.append({"kind": "unmatched_cash", "text": "Unallocated repayment %s %s." % (r["id"], r["money"])})
    for r in s.duplicates_pending():
        uncertain.append({"kind": "unmatched_cash", "text": "Possible duplicate repayment %s." % r["id"]})
    if (s.dup_check or {}).get("status") == "potential_match":
        uncertain.append({"kind": "potential_duplicate", "text": s.dup_check["text"]})
    return {"checkpoints": cps, "waiting_for": waiting, "changed": changed, "uncertain": uncertain,
            "judgments": [dict(j) for j in s.judgments]}
