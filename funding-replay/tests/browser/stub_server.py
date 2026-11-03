#!/usr/bin/env python3
"""STUB SERVER — interface development only. NOT the engine.

Returns hand-written sample responses shaped like the CONTRACT.md evaluation JSON so the interface
can be built before app/server.py exists. Every response is marked "engine": "STUB". Numbers for the
reference / preagreed / delayed_receivable cases are copied from CONTRACT.md and the whitepaper; other
scenarios return a thin placeholder. Rate-dependent strings are hand-written for 0% and 8% only.

Usage: python3 tests/browser/stub_server.py --port 8799
"""
import argparse
import copy
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATIC = os.path.join(ROOT, "app", "static")
LABEL = "Synthetic replay — no funds move."

SCENARIOS = [
    ("reference", "Reference week", "Monday becomes feasible only after Friday."),
    ("preagreed", "Pre-agreed Monday terms", "Forward terms, reserved capacity and fallback documented on Friday."),
    ("delayed_receivable", "Delayed receivable", "Customer receipt forecast for Tuesday; settled cash short."),
    ("concurrent_payout", "Concurrent payout", "A second payout competes for the same cash."),
    ("stale_quote", "Stale Monday quote", "Monday quote expires before Monday instruction."),
    ("closed_day", "Monday closed", "Monday is not a business day for the slot."),
    ("low_capacity", "Low Monday capacity", "Monday capacity USD 60,000.00 only."),
    ("slow_credit", "Slow last mile", "Simulated 9 h last-mile bound."),
]
DT = {
    "friday": ("Friday funding decision", "Fri 13 Nov 2026, 15:00 SGT", "Fri 13 Nov 2026, 02:00 EST"),
    "monday": ("Monday checkpoint", "Mon 16 Nov 2026, 15:00 SGT", "Mon 16 Nov 2026, 02:00 EST"),
    "retro": ("Retrospective comparison", "Thu 19 Nov 2026, 09:00 SGT", "Wed 18 Nov 2026, 20:00 EST"),
}
state = {"imported": False}

PAYMENT = {"net_usd": "100,000.00", "deadline_sgt": "Wed 18 Nov 2026, 23:00 SGT",
           "deadline_ny": "Wed 18 Nov 2026, 10:00 EST", "release_sgt": "Wed 18 Nov 2026, 15:00 SGT",
           "release_ny": "Wed 18 Nov 2026, 02:00 EST", "beneficiary_credit": "not observed"}

EV_FRIDAY = [
    ("OBL-1", "obligation", "", "USD 100,000.00 net spendable by deadline", "Wed 18 Nov 2026, 23:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "—", "", ["friday: obligation", "monday: obligation"]),
    ("REL-1", "release_checkpoint", "", "Common provider release checkpoint", "Wed 18 Nov 2026, 15:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "—", "", ["friday: release", "monday: release"]),
    ("SLOT-F", "funding_slot", "friday", "Friday instruction 15:00, cutoff 16:00 SGT", "Fri 13 Nov 2026, 15:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "Fri 13 Nov 2026, 16:00 SGT", "", ["friday: cutoff"]),
    ("CAL-F", "calendar", "friday", "Friday is a business day", "Fri 13 Nov 2026, 00:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "—", "open", ["friday: calendar"]),
    ("Q-F", "quote", "friday", "SGD 1.35 per USD, 25 bp spread", "Fri 13 Nov 2026, 09:00 SGT", "Fri 13 Nov 2026, 09:00 SGT", "Fri 13 Nov 2026, 16:00 SGT", "", ["friday: quote"]),
    ("FEE-RAIL", "fee", "", "Rail fixed charge SGD 20.00", "Thu 12 Nov 2026, 09:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "—", "", ["friday: fees"]),
    ("FEE-PROC-F", "fee", "friday", "Processing SGD 15.00", "Thu 12 Nov 2026, 09:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "—", "", ["friday: fees"]),
    ("CASH-1", "cash_snapshot", "", "Settled balance SGD 200,000.00", "Fri 13 Nov 2026, 09:00 SGT", "Fri 13 Nov 2026, 09:30 SGT", "—", "settled", ["friday: cash"]),
    ("FLOOR-1", "cash_floor", "", "Policy cash floor SGD 50,000.00", "Thu 12 Nov 2026, 09:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "—", "", ["friday: cash"]),
    ("CAP-F", "capacity", "friday", "Reserved payout capacity USD 100,000.00", "Fri 13 Nov 2026, 09:00 SGT", "Fri 13 Nov 2026, 09:00 SGT", "—", "reserved", ["friday: capacity"]),
    ("SB-1", "service_bound", "", "Simulated last-mile bound 7.5 h (not observed delivery)", "Thu 12 Nov 2026, 09:00 SGT", "Thu 12 Nov 2026, 09:00 SGT", "—", "", ["friday: last mile"]),
]
EV_MONDAY = [
    ("SLOT-M", "funding_slot", "monday", "Monday instruction 15:00, cutoff 16:00 SGT", "Mon 16 Nov 2026, 15:00 SGT", "Mon 16 Nov 2026, 09:00 SGT", "Mon 16 Nov 2026, 16:00 SGT", "", ["monday: cutoff"]),
    ("Q-M", "quote", "monday", "SGD 1.35 per USD, 25 bp spread", "Mon 16 Nov 2026, 09:00 SGT", "Mon 16 Nov 2026, 09:00 SGT", "Mon 16 Nov 2026, 16:00 SGT", "", ["monday: quote"]),
    ("FEE-PROC-M", "fee", "monday", "Processing SGD 25.00", "Mon 16 Nov 2026, 09:00 SGT", "Mon 16 Nov 2026, 09:00 SGT", "—", "", ["monday: fees"]),
    ("CAP-M", "capacity", "monday", "Reserved payout capacity USD 100,000.00", "Mon 16 Nov 2026, 09:00 SGT", "Mon 16 Nov 2026, 09:00 SGT", "—", "reserved", ["monday: capacity"]),
]


def ev(rows):
    return [{"record_id": r[0], "kind": r[1], "slot": r[2], "fact": r[3], "effective_sgt": r[4],
             "known_sgt": r[5], "expires_sgt": r[6], "status": r[7], "used_by": r[8]} for r in rows]


def ok(name, detail, ids):
    return {"name": name, "state": "ok", "detail": detail, "record_ids": ids}


def friday_option(rate, status="feasible", headroom="SGD 14,627.50"):
    cost = {"8": "SGD 147.95", "0": "SGD 0.00"}.get(rate, "SGD 147.95")
    return {"slot": "friday", "label": "Fund Fri 13 Nov 15:00 SGT", "status": status,
            "checks": [ok("Calendar", "Friday is open", ["CAL-F"]), ok("Cutoff", "Instruction 15:00 before 16:00 cutoff", ["SLOT-F"]),
                       ok("Quote", "Live until 16:00", ["Q-F"]),
                       ok("Cash", "Usable SGD 150,000.00 covers SGD 135,372.50", ["CASH-1", "FLOOR-1"])
                       if status == "feasible" else
                       {"name": "Cash", "state": "fail", "detail": "Usable SGD 130,000.00 < required SGD 135,372.50", "record_ids": ["CASH-1", "FLOOR-1"]},
                       ok("Capacity", "Reserved USD 100,000.00", ["CAP-F"]),
                       ok("Last mile", "Release 15:00 + 7.5 h = 22:30 SGT ≤ 23:00 (simulated)", ["SB-1", "REL-1"])],
            "required_sgd": "SGD 135,372.50", "principal_sgd": "SGD 135,000.00", "restricted_days": 5,
            "sgd_days": "675,000", "avg_restricted_30d": "SGD 22,500.00", "funding_cost_sgd": cost,
            "fees_sgd": "SGD 372.50", "cash_headroom_sgd": headroom}


def monday_option(rate, status="feasible", headroom="SGD 14,617.50", checks=None):
    cost = {"8": "SGD 59.18", "0": "SGD 0.00"}.get(rate, "SGD 59.18")
    return {"slot": "monday", "label": "Fund Mon 16 Nov 15:00 SGT", "status": status,
            "checks": checks or [ok("Quote", "Live until 16:00", ["Q-M"]), ok("Capacity", "Reserved USD 100,000.00", ["CAP-M"])],
            "required_sgd": "SGD 135,382.50", "principal_sgd": "SGD 135,000.00", "restricted_days": 2,
            "sgd_days": "270,000", "avg_restricted_30d": "SGD 9,000.00", "funding_cost_sgd": cost,
            "fees_sgd": "SGD 382.50", "cash_headroom_sgd": headroom}


def null_option(slot, label, status, detail):
    return {"slot": slot, "label": label, "status": status,
            "checks": [{"name": "Evidence", "state": "unknown", "detail": detail, "record_ids": []}],
            "required_sgd": None, "principal_sgd": None, "restricted_days": None, "sgd_days": None,
            "avg_restricted_30d": None, "funding_cost_sgd": None, "fees_sgd": None, "cash_headroom_sgd": None}


def comparison(rate, framing, reservation=None):
    if rate == "0":
        carry, net, formula = "SGD 0.00", "SGD −10.00", "135,000.00 × 0% × (5 − 2) / 365 = 0.00; 0.00 − 10.00 = −10.00"
    else:
        carry, net, formula = "SGD 88.77", "SGD 78.77", "135,000.00 × 8% × (5 − 2) / 365 = 88.77; 88.77 − 10.00 = 78.77"
    c = {"available": True, "withheld_reason": "", "days": {"friday": 5, "monday": 2}, "sgd_days_less": "405,000",
         "avg_restricted_less_30d": "SGD 13,500.00", "carry_reduction": carry, "extra_processing": "SGD 10.00",
         "net_benefit_before_subscription": net, "formula": formula, "framing": framing,
         "zero_rate_note": "If retained cash earns nothing and avoids no borrowing, waiting costs SGD 10.00 more."}
    if reservation:
        c["reservation_cost"] = reservation
    return c


def base(scenario, dt, rate):
    sid = [s for s in SCENARIOS + [("imported", "Imported file", "Imported CSV")] if s[0] == scenario][0]
    lbl, sgt, ny = DT[dt]
    return {"label": LABEL, "engine": "STUB", "scenario": {"id": sid[0], "name": sid[1], "description": sid[2], "synthetic": True},
            "decision_time": {"id": dt, "label": lbl, "as_of_sgt": sgt, "as_of_ny": ny}, "payment": copy.deepcopy(PAYMENT),
            "options": [], "comparison": None,
            "assumption": {"funding_rate_pct": rate, "kind": "assumption",
                           "text": "Hypothetical annual rate on retained cash (avoided borrowing or incremental return). Not historical evidence."},
            "evidence": ev(EV_FRIDAY), "warnings": ["STUB response — not the reconstructed engine."]}


def decision(st, headline, reason, binding, cash, missing, actions, actionable=True):
    return {"state": st, "headline": headline, "reason": reason, "binding_constraint": binding,
            "cash_after_commitments": cash, "missing_evidence": missing, "next_actions": actions,
            "actionable_on_friday": actionable}


CASH_REF = {"amount": "SGD 150,000.00", "explain": "settled 200,000.00 − floor 50,000.00 − commitments 0.00"}


def evaluate(scenario, dt, rate):
    r = base(scenario, dt, rate)
    if scenario == "reference":
        if dt == "friday":
            r["decision"] = decision("KEEP_FRIDAY", "Keep Friday’s funding window",
                                     "No binding Monday terms, reserved Monday capacity or documented fallback is known at Friday 15:00, so waiting is not an evidenced option.",
                                     "Friday 16:00 SGT cutoff is the last evidenced safe funding time.", CASH_REF,
                                     ["Binding Monday funding terms", "Reserved Monday payout capacity", "Documented fallback route if Monday fails"],
                                     ["Fund through your existing provider before the Friday 16:00 SGT cutoff.",
                                      "Ask your provider for binding Monday terms and reserved capacity before relying on a later slot."])
            r["options"] = [friday_option(rate), null_option("monday", "Fund Mon 16 Nov 15:00 SGT", "not_evidenced", "No Monday quote, capacity or terms known at Friday 15:00")]
        elif dt == "monday":
            r["decision"] = decision("MONDAY_FEASIBLE", "Monday slot is feasible", "Quote, capacity and settled cash cover the Monday instruction.",
                                     "Monday 16:00 SGT cutoff.", CASH_REF, [], ["Instruct through your existing provider before Monday 16:00 SGT."])
            r["options"] = [null_option("friday", "Fund Fri 13 Nov 15:00 SGT", "passed", "Friday cutoff has passed"), monday_option(rate)]
            r["evidence"] = ev(EV_FRIDAY + EV_MONDAY)
        else:
            r["decision"] = decision("HINDSIGHT", "Friday’s decision stands", "Monday became feasible only on evidence first known on Monday.",
                                     "Friday 16:00 SGT cutoff (Monday not evidenced on Friday).", CASH_REF, [],
                                     ["Ask for binding later-slot terms before the next Friday decision."], actionable=False)
            r["options"] = [friday_option(rate), monday_option(rate)]
            r["comparison"] = comparison(rate, "Hindsight only. Not available to the operator on Friday; the Friday decision stands.")
            r["evidence"] = ev(EV_FRIDAY + EV_MONDAY)
    elif scenario == "preagreed" and dt == "friday":
        r["decision"] = decision("MANUAL_REVIEW", "Manual review before waiting",
                                 "Forward terms, reserved Monday capacity and a fallback are documented on Friday; verify enforceability and cost before relying on them.",
                                 "Enforceability of the agreed Monday terms.", CASH_REF,
                                 ["Confirmation that the Monday forward terms are binding"],
                                 ["Ask your provider to confirm the forward terms in writing.", "Keep the Friday instruction ready if verification fails."])
        r["options"] = [friday_option(rate), monday_option(rate)]
        r["comparison"] = comparison(rate, "Conditional on verifying the forward terms; not a recommendation.", reservation="SGD 25.00 (STUB)")
    elif scenario == "delayed_receivable":
        cash = {"amount": "SGD 130,000.00", "explain": "settled 180,000.00 − floor 50,000.00 − commitments 0.00; forecast receipt not counted"}
        r["decision"] = decision("INSUFFICIENT_CASH", "Insufficient settled cash",
                                 "Usable SGD 130,000.00 vs required SGD 135,382.50, short SGD 5,382.50; the Tuesday forecast receipt cannot fund Monday's instruction." if dt != "friday"
                                 else "Usable SGD 130,000.00 is below required SGD 135,372.50; the forecast receipt is not counted.",
                                 "Settled cash after floor.", cash, [], ["Draw an existing committed facility through your bank, or report the shortfall."])
        r["options"] = [friday_option(rate, "infeasible", "SGD −5,372.50"),
                        monday_option(rate, "infeasible", "SGD −5,382.50",
                                      [{"name": "Cash", "state": "fail", "detail": "Usable SGD 130,000.00 vs required SGD 135,382.50, short SGD 5,382.50", "record_ids": ["CASH-1"]}])]
        if dt != "friday":
            r["comparison"] = {"available": False, "withheld_reason": "Tuesday receipt cannot finance Monday’s instruction."}
    else:
        r["decision"] = decision("NO_DECISION", "Stub placeholder", "This scenario is not hand-written in the stub.", "—", None, ["Engine not available"], [])
        r["options"] = [null_option("friday", "Fund Fri 13 Nov 15:00 SGT", "unknown", "Stub"), null_option("monday", "Fund Mon 16 Nov 15:00 SGT", "unknown", "Stub")]
    return r


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/meta":
            sc = [{"id": s[0], "name": s[1], "description": s[2], "synthetic": True} for s in SCENARIOS]
            if state["imported"]:
                sc.append({"id": "imported", "name": "Imported file", "description": "Imported CSV", "synthetic": True})
            return self.send_json(200, {"label": LABEL, "scenarios": sc,
                                        "decision_times": [{"id": k, "label": v[0], "as_of_sgt": v[1]} for k, v in DT.items()],
                                        "default_rate_pct": "8", "current_dataset": "imported" if state["imported"] else "sample"})
        f = "index.html" if p == "/" else p[len("/static/"):] if p.startswith("/static/") else None
        fp = os.path.normpath(os.path.join(STATIC, f)) if f else None
        if not fp or not fp.startswith(STATIC) or not os.path.isfile(fp):
            return self.send_json(404, {"ok": False, "error": "not found"})
        ctype = {"html": "text/html", "js": "text/javascript", "css": "text/css"}.get(fp.rsplit(".", 1)[-1], "application/octet-stream")
        with open(fp, "rb") as fh:
            b = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode("utf-8")
        if self.path == "/api/evaluate":
            req = json.loads(body or "{}")
            return self.send_json(200, evaluate(req.get("scenario", "reference"), req.get("decision_time", "friday"), str(req.get("funding_rate_pct", "8"))))
        if self.path == "/api/import":
            need = {"record_id", "kind", "slot", "effective_at", "known_at", "expires_at", "amount", "currency", "rate", "bp", "status", "source", "establishes"}
            if body and need <= set(c.strip() for c in body.splitlines()[0].split(",")):
                state["imported"] = True
                return self.send_json(200, {"ok": True, "scenario": "imported"})
            return self.send_json(400, {"ok": False, "errors": [{"row": 1, "column": "record_id", "message": "missing required column (STUB)"}]})
        if self.path == "/api/reset":
            state["imported"] = False
            return self.send_json(200, {"ok": True})
        self.send_json(404, {"ok": False})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8799)
    a = ap.parse_args()
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
