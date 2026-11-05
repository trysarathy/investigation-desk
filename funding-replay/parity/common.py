"""Common scenarios for the parity harness, defined once as plain economic facts.

Nothing here knows either engine's CSV schema. `to_original.py` and `to_rebuild.py` translate these facts
into each engine's records and say, in a printed `notes` list, every choice they had to make.

The reference week starts from the ORIGINAL's own facts (events.csv in the supplied zip):
USD 100,000 net; SGD 1.35 per USD; 25 bp spread; fixed charges SGD 35 Friday / SGD 45 Monday (rail 20 +
processing 15 / 25); SGD 150,000 settled own cash less SGD 10,000 pre-existing reservation, balances taken at
14:00 on each instruction day; instruction Fri 13 / Mon 16 at 15:00 SGT, exclusive cutoff 16:00 SGT; provider
release Wed 18 Nov 15:00 SGT; spendable deadline 23:00 SGT; 8 h release-to-spendable bound; lead business days
3 / 2; payout capacity USD 100,000 through Thu 19 09:00 (after release); SGD 200,000 forecast receipt (never cash).

Money and rates are Decimal. Times are ISO 8601 strings with an explicit +08:00 offset (SGT).
"""
from copy import deepcopy
from decimal import Decimal as D

SLOTS = ("friday", "monday")
SLOT_DAY = {"friday": 13, "monday": 16}


def T(day, hm):
    """T(13, "15:00") -> '2026-11-13T15:00:00+08:00' (SGT)."""
    return "2026-11-%02dT%s:00+08:00" % (day, hm)


START = T(12, "09:00")          # the invoice and standing facts are first known Thu 12 Nov 09:00 SGT
HORIZON = T(19, "09:00")        # standing validity used by the original for capacity, SLA and rate
RELEASE = T(18, "15:00")
DEADLINE = T(18, "23:00")


def fact(fid, kind, slot=None, effective=None, known=None, until=None, **values):
    f = {"id": fid, "kind": kind, "slot": slot, "effective": effective, "known": known, "until": until}
    f.update(values)
    return f


def reference_facts():
    facts = [
        fact("INV", "invoice", effective=RELEASE, known=START, until=DEADLINE,
             usd=D("100000"), release=RELEASE, deadline=DEADLINE,
             desc="USD 100,000 net owed to a US supplier; provider release Wed 18 15:00 SGT; spendable by 23:00 SGT"),
        fact("RATE", "funding_rate", effective=START, known=START, until=HORIZON, amount=D("0.08"),
             desc="assumed annual funding hurdle 8% (an assumption, not evidence)"),
        fact("RES-1", "reservation", effective=START, known=START, until=HORIZON, amount=D("10000"),
             desc="pre-existing SGD 10,000 earmark inside the gross settled balance"),
        fact("FC-1", "forecast", effective=T(16, "09:00"), known=START, until=HORIZON, amount=D("200000"),
             desc="SGD 200,000 unsettled customer receipt forecast for Mon 09:00; never usable cash"),
    ]
    for slot, day, proc, lead in (("friday", 13, "15", 3), ("monday", 16, "25", 2)):
        S = slot[:3].upper()
        d14, d16 = T(day, "14:00"), T(day, "16:00")
        facts += [
            fact("QUOTE-" + S, "quote", slot, d14, d14, d16, rate=D("1.35"), bp=D("25"),
                 desc="reference SGD 1.35 per USD, 25 bp one-way spread, valid to 16:00"),
            fact("FEE-" + S, "fee", slot, d14, d14, d16, rail=D("20"), processing=D(proc),
                 desc="fixed charges: rail SGD 20 + processing SGD %s" % proc),
            # The original fixes instruction times in code (D-5 / D-2 at the release's 15:00), so the schedule is
            # known from the start; its cutoff record is first known at 14:00 on the instruction day.
            fact("SLOT-" + S, "slot", slot, d14, d14, d16, instruction=T(day, "15:00"), cutoff=d16,
                 schedule_known=START, desc="instruct 15:00 SGT; exclusive cutoff 16:00 SGT"),
            fact("LEAD-" + S, "lead_days", slot, d14, d14, d16, days=D(lead),
                 desc="%d open business dates after the instruction date through the NY payout date" % lead),
            fact("CAP-" + S, "capacity", slot, d14, d14, HORIZON, usd=D("100000"), status="confirmed",
                 desc="USD 100,000 payout capacity confirmed for this invoice through Thu 19 09:00"),
            fact("DEST-" + S, "delivery_bound", slot, d14, d14, HORIZON, hours=D("8"),
                 desc="release-to-spendable bound 8 h (simulated)"),
            fact("BANK-" + S, "balance", None, d14, d14, d16, amount=D("150000"),
                 desc="gross settled own SGD 150,000 at 14:00, valid to 16:00"),
            fact("CLIST-" + S, "commitment_list", None, d14, d14, d16,
                 desc="attestation: the reservation/commitment list is complete at 14:00"),
        ]
    return facts


# --------------------------------------------------------------------------- scenario edits
def _find(facts, fid):
    for f in facts:
        if f["id"] == fid:
            return f
    raise KeyError(fid)


def change(facts, fid, **values):
    _find(facts, fid).update(values)
    return facts


def drop(facts, *fids):
    for fid in fids:
        facts.remove(_find(facts, fid))
    return facts


def add(facts, *new):
    facts.extend(new)
    return facts


def _preagreed(facts, standing_terms=False):
    eff, known = T(13, "14:00"), T(13, "14:05")
    add(facts,
        fact("FWD-RATE", "forward_rate", "monday", eff, known, HORIZON, rate=D("1.35"),
             desc="binding forward reference rate for the later slot"),
        fact("FWD-SPREAD", "forward_spread", "monday", eff, known, HORIZON, bp=D("25"), desc="binding 25 bp"),
        fact("FWD-FEE", "forward_fee", "monday", eff, known, HORIZON, rail=D("20"), processing=D("25"),
             desc="binding fixed charge SGD 45 (rail 20 + processing 25)"),
        fact("FWD-SLOT", "reserved_capacity", "monday", eff, known, HORIZON, usd=D("100000"),
             desc="reserved post-release USD capacity for the later slot"),
        fact("FWD-CASH", "own_cash_floor", "monday", eff, known, HORIZON, amount=D("140000"),
             desc="documented own-cash floor SGD 140,000 after all obligations, held for the later slot"),
        fact("FWD-FALLBACK", "fallback", "monday", eff, known, HORIZON, usd=D("100000"),
             desc="independent documented late fallback for USD 100,000; deadline preserved"))
    if standing_terms:
        # Monday route terms (lead business days) are standing terms known from Thu 12, not first known Monday.
        change(facts, "LEAD-MON", effective=START, known=START)
    return facts


SCENARIOS = [
    {"id": "reference", "case": "reference",
     "title": "Reference week (original events.csv)", "edit": lambda f: f},
    {"id": "stale_monday_balance", "case": None,
     "title": "Stale Monday balance: newest balance Fri 14:00 (stated valid to Mon 16:00); everything else fresh",
     "edit": lambda f: change(drop(f, "BANK-MON"), "BANK-FRI", until=T(16, "16:00"))},
    {"id": "balance_exactly_24h", "case": None,
     "title": "Monday balance taken Sun 15 15:00: exactly 24 h before the Monday slot",
     "edit": lambda f: change(f, "BANK-MON", effective=T(15, "15:00"), known=T(15, "15:00"))},
    {"id": "balance_24h_1min", "case": None,
     "title": "Monday balance taken Sun 15 14:59: 24 h + 1 min before the Monday slot",
     "edit": lambda f: change(f, "BANK-MON", effective=T(15, "14:59"), known=T(15, "14:59"))},
    {"id": "missing_balance", "case": None,
     "title": "No settled balance on file at all (Friday or Monday)",
     "edit": lambda f: drop(f, "BANK-FRI", "BANK-MON")},
    {"id": "late_monday_balance", "case": None,
     "title": "Backdated Monday balance: dated Mon 14:00 but first known Tue 17 12:00",
     "edit": lambda f: change(f, "BANK-MON", known=T(17, "12:00"))},
    {"id": "late_data_friday", "case": "late-data",
     "title": "Original's late-data: SGD 999,999 balance backdated to Fri 14:59, first known Wed 18 14:59",
     "edit": lambda f: add(f, fact("BANK-LATE", "balance", None, T(13, "14:59"), T(18, "14:59"), T(13, "16:00"),
                                   amount=D("999999"), desc="backdated balance first known Wednesday"))},
    {"id": "delayed_receivable", "case": "delayed-receivable",
     "title": "Delayed receivable: Monday balance 140,000; 340,000 only settles Tue 17 12:00",
     "edit": lambda f: add(change(f, "BANK-MON", amount=D("140000")),
                           fact("BANK-TUE", "balance", None, T(17, "12:00"), T(17, "12:00"), T(17, "16:00"),
                                amount=D("340000"), desc="receipt settled Tuesday; unusable Monday"))},
    {"id": "concurrent_payout", "case": "cash-shock",
     "title": "Concurrent payout: extra SGD 5,000 reservation from Mon 14:00, first known Mon 13:00",
     "edit": lambda f: add(f, fact("RES-2", "reservation", None, T(16, "14:00"), T(16, "13:00"), HORIZON,
                                   amount=D("5000"), desc="concurrent payout earmark"))},
    {"id": "tuesday_closure", "case": "holiday",
     "title": "Tuesday 17 Nov closed for the later route (known from Thu 12)",
     "edit": lambda f: add(f, fact("CLOSE-TUE", "closure", "monday", START, START, DEADLINE, date="2026-11-17",
                                   desc="route closure Tue 17 Nov"))},
    {"id": "low_capacity", "case": "offramp",
     "title": "Low Monday capacity: off-ramp USD 90,000 < 100,000",
     "edit": lambda f: change(f, "CAP-MON", usd=D("90000"))},
    {"id": "slow_credit_monday", "case": "slow-credit",
     "title": "Slow credit on the Monday route only: 9 h bound (Friday stays 8 h)",
     "edit": lambda f: change(f, "DEST-MON", hours=D("9"))},
    {"id": "slow_credit_both", "case": None,
     "title": "Slow credit on both routes: 9 h bound",
     "edit": lambda f: change(change(f, "DEST-MON", hours=D("9")), "DEST-FRI", hours=D("9"))},
    {"id": "stale_quote", "case": "stale-quote",
     "title": "Stale Monday quote: expires Mon 14:59, before the 15:00 instruction",
     "edit": lambda f: change(f, "QUOTE-MON", until=T(16, "14:59"))},
    {"id": "preagreed", "case": "preagreed",
     "title": "Pre-agreed later slot: binding terms known Fri 14:05 (rate, 25 bp, fee 45, reserved capacity, "
              "own-cash floor 140,000, fallback 100k)",
     "edit": _preagreed},
    {"id": "preagreed_standing_terms", "case": None,
     "title": "Pre-agreed later slot + Monday lead-day term known from Thu 12 (standing route term)",
     "edit": lambda f: _preagreed(f, standing_terms=True)},
    {"id": "instruction_at_cutoff", "case": None,
     "title": "Friday instruction exactly at the cutoff (cutoff 15:00 = instruction 15:00; exclusive)",
     "edit": lambda f: change(f, "SLOT-FRI", cutoff=T(13, "15:00"))},
    {"id": "capacity_expires_before_release", "case": None,
     "title": "Monday capacity confirmed only until Wed 18 14:59, one minute before release",
     "edit": lambda f: change(f, "CAP-MON", until=T(18, "14:59"))},
    # Probe: the strictly literal slot translation (Monday cutoff first known Mon 14:00 in BOTH engines).
    {"id": "probe_monday_slot_unknown_friday", "case": None,
     "title": "Probe: Monday slot/cutoff first known Mon 14:00 in both engines (strict literal translation)",
     "edit": lambda f: change(f, "SLOT-MON", schedule_known=T(16, "14:00"))},
]


def build(scenario):
    return scenario["edit"](deepcopy(reference_facts()))


AS_OF = (
    ("friday", T(13, "15:00"), "Fri 13 15:00"),
    ("monday", T(16, "15:00"), "Mon 16 15:00"),
    ("retro", T(19, "09:00"), "Thu 19 09:00 (retro)"),
)
ORIGINAL_RETRO_ALT = T(18, "15:00")  # the original's default as-of; checked equal to Thu 19 09:00
FUNDING_RATE_PCT = D("8")
