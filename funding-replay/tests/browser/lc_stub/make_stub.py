"""STUB ONLY — hand-written placeholder views for interface development, NOT engine output.

Writes lc-meta.js and states/lc-<case>-<id>.js shaped like LIFECYCLE_CONTRACT.md so the desk can be built
before engine/lifecycle.py and tools/export_site.py exist. Every number here is typed by hand; nothing is
computed or checked. Assemble a test site with:
  python3 tests/browser/lc_stub/make_stub.py <out-dir>   (copies app/static/lifecycle.* and app.css too)
"""
import json, shutil, sys, copy
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LABEL = "Simulated — no funds move."

def T(day, hm, ny=None):
    return f"{day} 2026, {hm} SGT"

HEADER = {"importer": "Northwind Foods SG Pte Ltd", "supplier": "Harbor Provisions LLC",
          "amount": "USD 100,000.00 net", "deadline_sgt": "Wed 18 Nov 2026, 23:00 SGT", "deadline_ny": "Wed 18 Nov 2026, 10:00 EST"}

EV_BASE = [
    {"id": "OBL-001", "kind": "Obligation", "fact": "USD 100,000.00 net to Harbor Provisions LLC by Wed 18 Nov 2026, 23:00 SGT", "source": "Supplier invoice (STUB)", "effective_sgt": "Mon 9 Nov 2026, 10:00 SGT", "known_sgt": "Mon 9 Nov 2026, 10:00 SGT", "status": "current"},
    {"id": "FC-RCV", "kind": "Forecast receipt", "fact": "Importer expects SGD 140,000.00 customer receipt on Tue 17 Nov", "source": "Importer cash forecast (STUB)", "effective_sgt": "Tue 17 Nov 2026, 10:00 SGT", "known_sgt": "Thu 12 Nov 2026, 11:00 SGT", "status": "forecast, not settled"},
    {"id": "BAL-NW", "kind": "Bank balance", "fact": "Importer settled balance SGD 60,000.00", "source": "Bank statement (STUB)", "effective_sgt": "Fri 13 Nov 2026, 09:00 SGT", "known_sgt": "Fri 13 Nov 2026, 09:05 SGT", "status": "current"},
    {"id": "FAC-NW-01", "kind": "Facility", "fact": "Supplier payment advance, limit SGD 300,000.00", "source": "Simulated facility terms (STUB)", "effective_sgt": "Sun 1 Nov 2026, 00:00 SGT", "known_sgt": "Sun 1 Nov 2026, 00:00 SGT", "status": "current"},
    {"id": "Q-MON", "kind": "FX quote", "fact": "SGD 1.35/USD + 25 bp for the Monday slot", "source": "Provider quote (STUB)", "effective_sgt": "Mon 16 Nov 2026, 15:00 SGT", "known_sgt": "Fri 13 Nov 2026, 14:00 SGT", "status": "indicative"},
]

FAC = {"id": "FAC-NW-01", "name": "Supplier payment advance", "policy_version": "POL-ADV v2026.11-1", "denomination": "SGD",
       "company_limit": "SGD 300,000.00", "company_available": "SGD 300,000.00", "reserved": "SGD 0.00", "principal_outstanding": "SGD 0.00",
       "funding_available_cash": "SGD 500,000.00", "funding_reserved": "SGD 0.00", "fee": "SGD 150.00 flat per advance",
       "repayment_due_sgt": "Fri 20 Nov 2026, 17:00 SGT", "reservation_expiry_sgt": "Mon 16 Nov 2026, 16:00 SGT", "route_deadline_sgt": "Wed 18 Nov 2026, 23:00 SGT",
       "rules": [{"rule": "Within company limit", "ok": True, "detail": "SGD 135,382.50 ≤ SGD 300,000.00 available"},
                 {"rule": "Provider cash covers the advance", "ok": True, "detail": "SGD 135,382.50 ≤ SGD 500,000.00"},
                 {"rule": "Importer balance fresh (≤ 24 h)", "ok": True, "detail": "BAL-NW known Fri 13 Nov 09:05"},
                 {"rule": "Draw before reservation expiry", "ok": None, "detail": "Not yet drawn"}]}

def facts(auth=("none", "No reservation", None), cash=("none", "No cash drawn", None), deliv=("none", "Not instructed", None, None),
          rep=("none", "Nothing to repay", "SGD 0.00", "SGD 0.00", [], [], [])):
    return {"authorization": {"status": auth[0], "label": auth[1], "detail": auth[2]},
            "cash": {"status": cash[0], "label": cash[1], "detail": cash[2]},
            "delivery": {"status": deliv[0], "label": deliv[1], "detail": deliv[2], "last_evidenced": deliv[3]},
            "repayment": {"status": rep[0], "label": rep[1], "principal_outstanding": rep[2], "fees_outstanding": rep[3],
                          "due_sgt": "Fri 20 Nov 2026, 17:00 SGT", "owner": "Northwind Foods SG Pte Ltd (importer)",
                          "matched": rep[4], "customer_receipts": rep[5], "unmatched": rep[6]}}

def opts(sel=None, a_status="feasible", b_status="feasible", c_status="infeasible", b_dq=None):
    o = [
        {"key": "A", "title": "Importer prefunds Fri 13 Nov", "status": a_status, "whose_money": "Importer's own cash", "committed_at": "Fri 13 Nov 2026, 15:00 SGT", "amount": "SGD 135,382.50", "duration": "5 days restricted", "modeled_cost": "SGD 0.00 funding cost (cash idle)", "risk_bearer": "Importer", "evidence": ["OBL-001", "BAL-NW"], "disqualifiers": []},
        {"key": "B", "title": "Provider advance, repaid Fri 20 Nov", "status": b_status, "whose_money": "Provider (FAC-NW-01)", "committed_at": "Mon 16 Nov 2026, 15:00 SGT", "amount": "SGD 135,382.50 + SGD 150.00 fee", "duration": "Up to 4 days drawn", "modeled_cost": "SGD 150.00 flat fee", "risk_bearer": "Provider until repaid", "evidence": ["FAC-NW-01", "FC-RCV", "Q-MON"], "disqualifiers": b_dq or []},
        {"key": "C", "title": "Importer funds Mon 16 Nov from receipt", "status": c_status, "whose_money": "Importer (expected receipt)", "committed_at": "Mon 16 Nov 2026, 15:00 SGT", "amount": "SGD 135,382.50", "duration": "2 days restricted", "modeled_cost": "SGD 0.00", "risk_bearer": "Supplier deadline if receipt slips", "evidence": ["FC-RCV"], "disqualifiers": ["Receipt is forecast for Tue 17 Nov, after the Monday funding cutoff"]},
    ]
    if sel:
        for x in o:
            x["status"] = "selected" if x["key"] == sel else "not_selected"
    return o

def inv(ok=True):
    return [{"name": "company_limit = available + reserved + principal_outstanding", "ok": True, "detail": "STUB"},
            {"name": "provider funding identity", "ok": True, "detail": "STUB"},
            {"name": "principal_outstanding = drawn − principal_repaid ≥ 0", "ok": True, "detail": "STUB"},
            {"name": "fees_outstanding = fees_charged − fees_repaid ≥ 0", "ok": ok, "detail": "STUB"}]

def act(id, label, role, nxt, consequence, enabled=True, reason=None):
    return {"id": id, "label": label, "role": role, "enabled": enabled, "disabled_reason": reason, "consequence": consequence, "next": nxt if enabled else None}

STATES = {}
def put(case, sid, clock, decision, **kw):
    v = {"label": LABEL, "case": {"id": case, "name": CASES[case][0], "description": CASES[case][1]}, "state_id": sid,
         "clock": {"sgt": clock[0], "ny": clock[1], "label": clock[2]}, "header": HEADER,
         "decision": dict(zip(["tone", "headline", "binding_constraint", "next_action", "owner"], decision)),
         "options": kw.get("options", opts()), "options_note": kw.get("note", "STUB: costs are not ranked; whose money and who bears the risk differ."),
         "facility": kw.get("facility", copy.deepcopy(FAC)), "facts": kw.get("facts", facts()), "exposure": kw.get("exposure"),
         "evidence": kw.get("evidence", EV_BASE), "timeline": kw.get("timeline", []), "actions": kw.get("actions", []),
         "invariants": kw.get("invariants", inv()), "warnings": kw.get("warnings", [])}
    STATES[(case, sid)] = v

CASES = {"reference": ("Reference: Thursday surprise", "STUB. Importer prefers to fund after its customer receipt."),
         "stale_balance": ("Stale importer balance", "STUB. Importer balance older than 24 h."),
         "fixed_terms": ("Fixed prefunding terms", "STUB. Contract fixes prefunding; no facility."),
         "no_cash": ("Provider cash insufficient", "STUB. Credit headroom but not enough provider cash."),
         "failed_payout": ("Payout returned", "STUB. The payout is returned by the beneficiary bank.")}
START = {"reference": "s0", "stale_balance": "s0", "fixed_terms": "s0", "no_cash": "s0", "failed_payout": "s0"}

FRI = ("Fri 13 Nov 2026, 15:00 SGT", "Fri 13 Nov 2026, 02:00 EST", "Friday decision")
MON = ("Mon 16 Nov 2026, 15:00 SGT", "Mon 16 Nov 2026, 02:00 EST", "Monday draw window")
WED = ("Wed 18 Nov 2026, 22:00 SGT", "Wed 18 Nov 2026, 09:00 EST", "Wednesday")
THU = ("Thu 19 Nov 2026, 10:00 SGT", "Wed 18 Nov 2026, 21:00 EST", "Thursday")
FRI2 = ("Fri 20 Nov 2026, 16:00 SGT", "Fri 20 Nov 2026, 03:00 EST", "Repayment due day")
TL0 = [{"at_sgt": "Fri 13 Nov 2026, 15:00 SGT", "known_sgt": "Fri 13 Nov 2026, 15:00 SGT", "actor": "Operator", "text": "Case opened for decision."}]
def tl(*items): return TL0 + [{"at_sgt": a, "known_sgt": a, "actor": b, "text": c} for a, b, c in items]

RES = ("reserved", "Capacity reserved: SGD 135,532.50", "Reserved by Reviewer; expires Mon 16 Nov 2026, 16:00 SGT")
CON = ("consumed", "Reservation consumed by draw", None)
DRAWN = ("drawn", "Drawn: SGD 135,382.50 principal", "Provider funding account → payout")
def fac(**k):
    f = copy.deepcopy(FAC); f.update(k); return f
FAC_RES = fac(company_available="SGD 164,617.50", reserved="SGD 135,382.50", funding_available_cash="SGD 364,617.50", funding_reserved="SGD 135,382.50")
FAC_DRAWN = fac(company_available="SGD 164,617.50", principal_outstanding="SGD 135,382.50", funding_available_cash="SGD 364,617.50")
OUT = ("outstanding", "Principal and fee outstanding", "SGD 135,382.50", "SGD 150.00", [], [], [])
EXP = {"amount": "SGD 135,532.50", "principal": "SGD 135,382.50", "fees": "SGD 150.00", "currency": "SGD", "owner": "Northwind Foods SG Pte Ltd (importer)", "ends_when": "Principal and fee repaid and matched"}

r = "reference"
put(r, "s0", FRI, ("decide", "Decide funding route for the Harbor Provisions payment", "Importer cash arrives Tue 17 Nov, after the Monday cutoff", "Reviewer: reserve facility capacity or decline", "Reviewer (simulated)"),
    timeline=TL0, actions=[act("reserve", "Reserve capacity", "Reviewer", "s1", "Holds SGD 135,382.50 of FAC-NW-01 until Mon 16 Nov 2026, 16:00 SGT. No cash moves."),
                           act("decline", "Decline", "Reviewer", "sd", "Option B is withdrawn; the importer must prefund Fri 13 Nov (option A)."),
                           act("draw", "Record simulated draw", "Operator", None, "", False, "Reserve capacity first.")])
put(r, "sd", FRI, ("declined", "Advance declined; importer prefunds Friday", "Reviewer declined option B", "Operator: ask the importer to fund by Fri 13 Nov 2026, 16:00 SGT", "Operator"),
    options=opts(sel="A"), facts=facts(auth=("declined", "Declined by Reviewer", None)), timeline=tl(("Fri 13 Nov 2026, 15:05 SGT", "Reviewer", "Declined the advance.")),
    actions=[act("reserve", "Reserve capacity", "Reviewer", None, "", False, "Declined; start again with Reset.")])
put(r, "s1", FRI, ("decide", "Capacity reserved; nothing drawn yet", "Reservation expires Mon 16 Nov 2026, 16:00 SGT", "Operator: record the draw at the Monday window", "Operator"),
    options=opts(sel="B"), facility=FAC_RES, facts=facts(auth=RES), timeline=tl(("Fri 13 Nov 2026, 15:05 SGT", "Reviewer", "Reserved capacity SGD 135,382.50.")),
    actions=[act("draw", "Record simulated draw", "Operator", "s2", "Moves the clock to Mon 16 Nov 15:00 and draws SGD 135,382.50 principal; fee SGD 150.00 becomes payable."),
             act("reserve", "Reserve capacity", "Reviewer", "s1", "Already reserved: no change.")])
TL2 = [("Fri 13 Nov 2026, 15:05 SGT", "Reviewer", "Reserved capacity."), ("Mon 16 Nov 2026, 15:00 SGT", "Operator", "Drew SGD 135,382.50.")]
put(r, "s2", MON, ("delivered_exposure", "Cash drawn; payout not yet instructed", "Instruct before Mon 16 Nov 2026, 16:00 SGT", "Operator: instruct the payout", "Operator"),
    options=opts(sel="B"), facility=FAC_DRAWN, facts=facts(auth=CON, cash=DRAWN, rep=OUT), exposure=EXP, timeline=tl(*TL2),
    actions=[act("instruct", "Instruct payout", "Operator", "s3", "Sends USD 100,000.00 to Harbor Provisions LLC on the simulated rail.")])
TL3 = TL2 + [("Mon 16 Nov 2026, 15:10 SGT", "Operator", "Instructed payout.")]
put(r, "s3", MON, ("delivered_exposure", "Payout instructed; awaiting provider acceptance", "Provider must accept before the route deadline", "Wait for the simulated acceptance", "Provider"),
    options=opts(sel="B"), facility=FAC_DRAWN, facts=facts(auth=CON, cash=DRAWN, deliv=("instructed", "Instructed", "USD 100,000.00 sent to rail", "Mon 16 Nov 2026, 15:10 SGT"), rep=OUT), exposure=EXP, timeline=tl(*TL3),
    actions=[act("accept", "Provider accepts payout", "Simulated event", "s4", "The provider confirms acceptance. This is not beneficiary credit.")])
TL4 = TL3 + [("Tue 17 Nov 2026, 09:00 SGT", "Simulated event", "Provider accepted the payout.")]
put(r, "s4", ("Tue 17 Nov 2026, 09:00 SGT", "Mon 16 Nov 2026, 20:00 EST", "Tuesday"), ("delivered_exposure", "Accepted by provider; supplier not yet credited", "Credit must land by Wed 18 Nov 2026, 23:00 SGT", "Wait for beneficiary credit evidence", "Provider"),
    options=opts(sel="B"), facility=FAC_DRAWN, facts=facts(auth=CON, cash=DRAWN, deliv=("accepted", "Accepted by provider — not credited", "Release is not supplier credit", "Tue 17 Nov 2026, 09:00 SGT"), rep=OUT), exposure=EXP, timeline=tl(*TL4),
    actions=[act("credit", "Beneficiary credited", "Simulated event", "s5", "Harbor's bank confirms USD 100,000.00 credited.")])
TL5 = TL4 + [("Wed 18 Nov 2026, 14:00 SGT", "Simulated event", "Beneficiary credited USD 100,000.00.")]
CRED = ("credited", "Beneficiary credited USD 100,000.00", "Harbor's bank confirmation", "Wed 18 Nov 2026, 14:00 SGT")
WEDDEC = ("delivered_exposure", "Supplier credited; importer repayment outstanding", "Importer repayment SGD 135,532.50 due Fri 20 Nov 2026, 17:00 SGT", "Operator: chase Northwind for repayment", "Northwind Foods SG Pte Ltd (importer)")
put(r, "s5", ("Wed 18 Nov 2026, 14:00 SGT", "Wed 18 Nov 2026, 01:00 EST", "Wednesday"), WEDDEC, options=opts(sel="B"), facility=FAC_DRAWN, facts=facts(auth=CON, cash=DRAWN, deliv=CRED, rep=OUT), exposure=EXP, timeline=tl(*TL5),
    actions=[act("advance_wed", "Advance to Wed 18 Nov 22:00", "Simulated event", "s6", "Moves the simulation clock; nothing else changes.")])
put(r, "s6", WED, WEDDEC, options=opts(sel="B"), facility=FAC_DRAWN, facts=facts(auth=CON, cash=DRAWN, deliv=CRED, rep=OUT), exposure=EXP, timeline=tl(*TL5),
    actions=[act("receipt", "Customer receipt settles", "Simulated event", "s7", "SGD 140,000.00 lands in the importer's own account. This is not repayment.")])
TL7 = TL5 + [("Thu 19 Nov 2026, 10:00 SGT", "Simulated event", "Customer receipt SGD 140,000.00 settled in importer account (late: forecast Tue 17 Nov).")]
REC = ["Thu 19 Nov 2026, 10:00 SGT · SGD 140,000.00 · importer account"]
put(r, "s7", THU, ("delivered_exposure", "Importer received its cash; debt still outstanding", "Receipt is in the importer's account, not a repayment", "Importer: repay SGD 135,532.50", "Northwind Foods SG Pte Ltd (importer)"),
    options=opts(sel="B"), facility=FAC_DRAWN, facts=facts(auth=CON, cash=DRAWN, deliv=CRED, rep=("outstanding", "Outstanding", "SGD 135,382.50", "SGD 150.00", [], REC, [])), exposure=EXP, timeline=tl(*TL7),
    evidence=EV_BASE + [{"id": "RCV-THU", "kind": "Customer receipt", "fact": "SGD 140,000.00 settled", "source": "Bank statement (STUB)", "effective_sgt": "Thu 19 Nov 2026, 10:00 SGT", "known_sgt": "Thu 19 Nov 2026, 10:00 SGT", "status": "settled"}],
    actions=[act("partial", "Match repayment", "Importer", "s8", "Matches SGD 50,000.00: fee SGD 150.00 first, then SGD 49,850.00 principal.")])
put(r, "s8", THU, ("delivered_exposure", "Partly repaid; SGD 85,532.50 outstanding", "Remaining principal SGD 85,532.50 due Fri 20 Nov 2026, 17:00 SGT", "Importer: repay the remaining principal", "Northwind Foods SG Pte Ltd (importer)"),
    options=opts(sel="B"), facility=fac(company_available="SGD 214,467.50", principal_outstanding="SGD 85,532.50", funding_available_cash="SGD 414,467.50"),
    facts=facts(auth=CON, cash=DRAWN, deliv=CRED, rep=("partial", "Partly repaid", "SGD 85,532.50", "SGD 0.00", ["SGD 50,000.00: fee SGD 150.00, principal SGD 49,850.00"], REC, [])),
    exposure=dict(EXP, amount="SGD 85,532.50", principal="SGD 85,532.50", fees="SGD 0.00"), timeline=tl(*(TL7 + [("Thu 19 Nov 2026, 11:00 SGT", "Importer", "Repaid SGD 50,000.00.")])),
    actions=[act("final", "Match final repayment", "Importer", "s9", "Matches SGD 85,532.50 to the remaining principal.")])
put(r, "s9", FRI2, ("review", "Repaid in full; ready to close", "All four facts settled", "Reviewer: close the case", "Reviewer"),
    options=opts(sel="B"), facility=fac(), facts=facts(auth=CON, cash=("repaid", "Principal returned", None), deliv=CRED, rep=("repaid", "Repaid in full", "SGD 0.00", "SGD 0.00", ["SGD 50,000.00", "SGD 85,532.50"], REC, [])),
    timeline=tl(*TL7), actions=[act("close", "Close case", "Reviewer", "s10", "Marks the case closed. No further actions.")])
put(r, "s10", FRI2, ("closed", "Closed: supplier credited, advance repaid", "None", "None", "—"),
    options=opts(sel="B"), facility=fac(), facts=facts(auth=CON, cash=("repaid", "Principal returned", None), deliv=CRED, rep=("repaid", "Repaid in full", "SGD 0.00", "SGD 0.00", ["SGD 50,000.00", "SGD 85,532.50"], REC, [])),
    timeline=tl(*TL7), actions=[])

put("stale_balance", "s0", FRI, ("unknown", "Need newer evidence: importer balance is 30 h old", "Balance must be ≤ 24 h old at reservation", "Request a fresh balance from the importer", "Operator"),
    options=opts(b_status="unknown", b_dq=["Importer balance BAL-NW is older than 24 h"]),
    facility=fac(rules=[{"rule": "Importer balance fresh (≤ 24 h)", "ok": False, "detail": "30 h old"}]),
    actions=[act("req", "Request evidence", "Operator", "s1", "Asks the importer's bank for a balance; a simulated fresh balance arrives."),
             act("reserve", "Reserve capacity", "Reviewer", None, "", False, "Importer balance is stale.")])
put("stale_balance", "s1", FRI, ("decide", "Fresh balance received; eligible", "Reservation expires Mon 16 Nov 2026, 16:00 SGT", "Reviewer: reserve capacity", "Reviewer"),
    actions=[act("reserve", "Reserve capacity", "Reviewer", None, "", False, "STUB ends here.")])
put("fixed_terms", "s0", FRI, ("blocked", "Later funding unavailable", "Contract fixes prefunding on Fri 13 Nov", "Importer prefunds option A", "Operator"),
    options=opts(b_status="unavailable", b_dq=["Contract requires prefunding"]), facility=None, actions=[])
put("no_cash", "s0", FRI, ("blocked", "Blocked: provider funding insufficient", "Provider cash SGD 90,000.00 < SGD 135,382.50", "Refer to treasury", "Operator"),
    options=opts(b_status="infeasible", b_dq=["Provider cash insufficient"]), facility=fac(funding_available_cash="SGD 90,000.00", rules=[{"rule": "Provider cash covers the advance", "ok": False, "detail": "SGD 90,000.00 < SGD 135,382.50"}]),
    actions=[act("reserve", "Reserve capacity", "Reviewer", None, "", False, "Provider funding insufficient.")])
put("failed_payout", "s0", MON, ("failed", "Payout returned; money last evidenced at provider", "Beneficiary bank returned the payout", "Recovery owner: Operator; no automatic resend", "Operator"),
    options=opts(sel="B"), facility=FAC_DRAWN, facts=facts(auth=CON, cash=DRAWN, deliv=("returned", "Returned by beneficiary bank", "Name mismatch", "Wed 18 Nov 2026, 12:00 SGT"), rep=OUT), exposure=EXP,
    actions=[act("close", "Close case", "Reviewer", None, "", False, "Cannot close: delivery not credited.")])

def main(out):
    out = Path(out); (out / "states").mkdir(parents=True, exist_ok=True)
    meta = {"label": LABEL, "cases": [{"id": c, "name": n, "description": d, "start": START[c]} for c, (n, d) in CASES.items()]}
    (out / "lc-meta.js").write_text("/* STUB */ window.lcMeta=" + json.dumps(meta) + ";\n")
    for (c, s), v in STATES.items():
        (out / "states" / f"lc-{c}-{s}.js").write_text("/* STUB */ document.currentScript.deliver(" + json.dumps(v) + ");")
    st = ROOT / "app/static"
    shutil.copyfile(st / "lifecycle.html", out / "index.html")
    for n in ("lifecycle.js", "lifecycle.css", "app.css"): shutil.copyfile(st / n, out / n)
    (out / "replay").mkdir(exist_ok=True); (out / "replay/index.html").write_text("<!doctype html><title>STUB replay</title><p>STUB")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else HERE / "site")
