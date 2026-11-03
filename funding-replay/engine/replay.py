"""Funding decision replay -- reconstructed engine.

The original replay.py / events.csv / test_replay.py described in the Funding
Decision Whitepaper were not supplied. This module is a reconstruction from
the whitepaper text, the founder memo and CONTRACT.md. All fixtures are
synthetic. Nothing here moves money, contacts a bank or calls a network.

Public API
    load_events(text) -> (events, errors)
    evaluate(events, decision_time, funding_rate_pct, scenario=None) -> dict
    SCENARIOS, DECISION_TIMES, LABEL

Rules worth repeating:
  * All money and rates are decimal.Decimal. Rounding (ROUND_HALF_UP, 2 dp)
    happens only when a number is formatted for output.
  * A record is visible at as_of T iff known_at <= T. Everything in the output
    is derived from visible records only.
  * The funding rate is an assumption. It only feeds funding_cost_sgd and the
    comparison's carry / net / formula. It never touches a check or a state.
"""

import csv
import io
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Dict, List, Optional, Tuple

LABEL = "Synthetic replay — no funds move."
ENGINE = "reconstructed"
MINUS = "−"
RSQUO = "’"

COLUMNS = (
    "record_id", "kind", "slot", "effective_at", "known_at", "expires_at",
    "amount", "currency", "rate", "bp", "status", "source", "establishes",
)
SLOTS = ("friday", "monday")
SLOT_NAMES = {"friday": "Friday", "monday": "Monday"}

KINDS = (
    "obligation", "release_checkpoint", "funding_slot", "calendar", "quote",
    "fee", "cash_snapshot", "receivable", "commitment", "cash_floor",
    "capacity", "forward_terms", "reservation_cost", "fallback",
    "service_bound", "beneficiary_credit",
    "cash_support", "commitment_list", "lead_business_days",
)

# Fields each kind must carry.
REQUIRED = {
    "obligation": ("effective_at", "amount", "currency"),
    "release_checkpoint": ("effective_at",),
    "funding_slot": ("slot", "effective_at", "expires_at"),
    "calendar": ("slot", "effective_at", "status"),
    "quote": ("slot", "rate", "bp", "expires_at"),
    "fee": ("amount", "currency", "status"),
    "cash_snapshot": ("effective_at", "amount", "currency", "status"),
    "receivable": ("effective_at", "amount", "currency", "status"),
    "commitment": ("amount", "currency"),
    "cash_floor": ("amount", "currency"),
    "capacity": ("slot", "amount", "currency", "status", "expires_at"),
    "forward_terms": ("slot", "rate", "status", "expires_at"),
    "reservation_cost": ("slot", "amount", "currency"),
    "fallback": ("status", "amount", "currency", "expires_at"),
    "service_bound": ("amount",),
    "beneficiary_credit": ("effective_at",),
    "cash_support": ("slot", "amount", "currency", "status", "expires_at"),
    "commitment_list": ("effective_at", "status"),
    "lead_business_days": ("slot", "amount"),
}
STATUSES = {
    "calendar": ("open", "closed"),
    "fee": ("rail", "processing", "other"),
    "cash_snapshot": ("settled",),
    "receivable": ("forecast", "settled"),
    "capacity": ("reserved", "confirmed", "indicative"),
    "forward_terms": ("agreed", "proposed"),
    "fallback": ("documented",),
    "cash_support": ("documented",),
    "commitment_list": ("complete",),
}
CURRENCIES = {
    "obligation": "USD", "capacity": "USD",
    "fee": "SGD", "cash_snapshot": "SGD", "receivable": "SGD",
    "commitment": "SGD", "cash_floor": "SGD", "reservation_cost": "SGD",
    "fallback": "USD", "cash_support": "SGD",
}

# ASCII digits only; at most 18 integer digits and 6 decimal places.
_DECIMAL_RE = re.compile(r"^[0-9]{1,18}(\.[0-9]{1,6})?$")
_ASCII_TS_RE = re.compile(r"^[0-9T:+\-.Z ]+$")

# --------------------------------------------------------------------------
# Time zones and formatting
# --------------------------------------------------------------------------
SGT = timezone(timedelta(hours=8), "SGT")  # Singapore has been UTC+08:00 since 1982
_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_DAYS_LONG = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

try:  # zoneinfo data can be missing (e.g. some macOS Pythons); fall back below.
    from zoneinfo import ZoneInfo
    _NY_ZONE = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - depends on host tz data
    _NY_ZONE = None


def _nth_sunday_utc(year, month, n, hour_utc):
    first = datetime(year, month, 1, tzinfo=timezone.utc)
    first_sunday = 1 + (6 - first.weekday()) % 7
    return datetime(year, month, first_sunday + 7 * (n - 1), hour_utc, tzinfo=timezone.utc)


def _to_ny(dt):
    """Return (local datetime, 'EST'|'EDT'). Uses zoneinfo, else the US DST rule."""
    if _NY_ZONE is not None:
        local = dt.astimezone(_NY_ZONE)
        return local, local.tzname()
    utc = dt.astimezone(timezone.utc)
    start = _nth_sunday_utc(utc.year, 3, 2, 7)   # 02:00 EST second Sunday of March
    end = _nth_sunday_utc(utc.year, 11, 1, 6)    # 02:00 EDT first Sunday of November
    if start <= utc < end:
        return utc.astimezone(timezone(timedelta(hours=-4))), "EDT"
    return utc.astimezone(timezone(timedelta(hours=-5))), "EST"


def _fmt_parts(local):
    return "%s %d %s %d" % (_DAYS[local.weekday()], local.day, _MONTHS[local.month - 1], local.year)


def fmt_sgt(dt):
    if dt is None:
        return "—"
    local = dt.astimezone(SGT)
    return "%s, %02d:%02d SGT" % (_fmt_parts(local), local.hour, local.minute)


def fmt_ny(dt):
    if dt is None:
        return "—"
    local, abbr = _to_ny(dt)
    return "%s, %02d:%02d %s" % (_fmt_parts(local), local.hour, local.minute, abbr)


def _fmt_slot_label(dt):
    local = dt.astimezone(SGT)
    return "%s %d %s %02d:%02d SGT" % (_DAYS[local.weekday()], local.day, _MONTHS[local.month - 1],
                                      local.hour, local.minute)


def _fmt_clock(dt):
    local = dt.astimezone(SGT)
    return "%02d:%02d SGT" % (local.hour, local.minute)


def _weekday_long(dt):
    return _DAYS_LONG[dt.astimezone(SGT).weekday()]


_Q2 = Decimal("0.01")


def r2(value):
    return value.quantize(_Q2, rounding=ROUND_HALF_UP)


def fmt_num(value, dp=2):
    q = value.quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)
    sign = MINUS if q < 0 else ""
    return sign + format(abs(q), ",.%df" % dp)


def fmt_money(currency, value):
    if value is None:
        return None
    q = r2(value)
    sign = MINUS if q < 0 else ""
    return "%s %s%s" % (currency, sign, format(abs(q), ",.2f"))


def fmt_count(value):
    """Integer-looking quantities (SGD-days): no decimals when integral."""
    if value == value.to_integral_value():
        return fmt_num(value, 0)
    return fmt_num(value, 2)


def fmt_plain(value):
    """Rates, bp, hours, percentages: shortest exact decimal text."""
    text = format(value.normalize(), "f")
    return text


def _days_value(days):
    if days is None:
        return None
    if days == days.to_integral_value():
        return int(days)
    return fmt_plain(days)


def _td_seconds(td):
    return td.days * 86400 + td.seconds  # integer seconds only


# --------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Event:
    record_id: str
    kind: str
    slot: str
    effective_at: Optional[datetime]
    known_at: datetime
    expires_at: Optional[datetime]
    amount: Optional[Decimal]
    currency: str
    rate: Optional[Decimal]
    bp: Optional[Decimal]
    status: str
    source: str
    establishes: str


def _err(row, column, message):
    return {"row": row, "column": column, "message": message}


def _parse_ts(text):
    if not _ASCII_TS_RE.match(text):
        raise ValueError("must use ASCII digits only (e.g. 2026-11-13T09:00:00+08:00)")
    raw = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        raise ValueError("is not an ISO 8601 timestamp (e.g. 2026-11-13T09:00:00+08:00)")
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("has no UTC offset; add one, e.g. +08:00")
    return dt


def load_events(text):
    """Parse and validate CSV text. Returns (events, errors).

    errors = [{row, column, message}], row = 1-based CSV line (header = 1).
    If there are any errors, events is empty: a file is accepted whole or not at all.
    """
    errors = []  # type: List[dict]
    if text is None:
        return [], [_err(1, "", "No CSV text supplied.")]
    if text.startswith("﻿"):
        text = text[1:]
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        return [], [_err(1, "", "The file is empty. Expected a header row.")]
    except csv.Error as exc:
        return [], [_err(1, "", "Could not read the header row: %s" % exc)]
    names = [h.strip().lower() for h in header]
    seen_cols = set()
    for name in names:
        if name in seen_cols and name:
            errors.append(_err(1, name, "Column '%s' appears more than once." % name))
        seen_cols.add(name)
    for col in COLUMNS:
        if col not in seen_cols:
            errors.append(_err(1, col, "Missing required column '%s'." % col))
    if errors:
        return [], errors
    index = {name: i for i, name in enumerate(names)}

    events = []
    first_row = {}  # record_id -> (row, raw tuple)
    while True:
        try:
            row = next(reader)
        except StopIteration:
            break
        except csv.Error as exc:
            errors.append(_err(reader.line_num, "", "Malformed CSV: %s" % exc))
            break
        line = reader.line_num
        if not any(cell.strip() for cell in row):
            continue
        if len(row) != len(names):
            errors.append(_err(line, "", "Expected %d fields, found %d." % (len(names), len(row))))
            continue
        raw = {col: row[index[col]].strip() for col in COLUMNS}
        rid = raw["record_id"]
        if not rid:
            errors.append(_err(line, "record_id", "record_id is empty."))
            continue
        key = tuple(raw[c] for c in COLUMNS)
        if rid in first_row:
            prev_line, prev_key = first_row[rid]
            if prev_key == key:
                continue  # identical duplicate: dropped
            diff = [c for c, a, b in zip(COLUMNS, prev_key, key) if a != b]
            errors.append(_err(line, diff[0],
                               "record_id '%s' conflicts with row %d: %s differs. "
                               "Use a new record_id for a different fact." % (rid, prev_line, ", ".join(diff))))
            continue
        first_row[rid] = (line, key)
        event, row_errors = _validate_row(line, raw)
        if row_errors:
            errors.extend(row_errors)
        else:
            events.append(event)
    if not errors and not events:
        errors.append(_err(1, "", "The file has a header but no records."))
    if errors:
        return [], errors
    return events, []


def _validate_row(line, raw):
    errs = []
    kind = raw["kind"]
    if kind not in KINDS:
        errs.append(_err(line, "kind", "Unknown kind '%s'." % kind))
        return None, errs
    slot = raw["slot"]
    if slot not in ("", "friday", "monday"):
        errs.append(_err(line, "slot", "Unknown slot '%s' (use friday, monday or empty)." % slot))
    for col in REQUIRED[kind]:
        if not raw[col]:
            errs.append(_err(line, col, "%s is required for kind '%s'." % (col, kind)))
    times = {}
    for col in ("effective_at", "known_at", "expires_at"):
        value = raw[col]
        if not value:
            if col == "known_at":
                errs.append(_err(line, col, "known_at is required (when the fact was first known)."))
            times[col] = None
            continue
        try:
            times[col] = _parse_ts(value)
        except ValueError as exc:
            errs.append(_err(line, col, "%s '%s' %s" % (col, value, exc)))
    nums = {}
    for col in ("amount", "rate", "bp"):
        value = raw[col]
        if not value:
            nums[col] = None
            continue
        if not _DECIMAL_RE.match(value):
            errs.append(_err(line, col, "%s '%s' is not a plain decimal (ASCII digits, at most 18 before and 6 "
                                        "after the point, no commas or signs, e.g. 1350.00)." % (col, value)))
            continue
        nums[col] = Decimal(value)
    # Sane ranges keep every product exact (no silent rounding of absurd inputs).
    if nums.get("rate") is not None and not (Decimal(0) < nums["rate"] <= Decimal(1000)):
        errs.append(_err(line, "rate", "rate '%s' must be above 0 and at most 1000 (SGD per USD)." % raw["rate"]))
    if nums.get("bp") is not None and nums["bp"] > Decimal(10000):
        errs.append(_err(line, "bp", "bp '%s' must be at most 10000 basis points." % raw["bp"]))
    status = raw["status"]
    allowed = STATUSES.get(kind, ())
    if status and status not in allowed:
        if allowed:
            errs.append(_err(line, "status", "Unknown status '%s' for kind '%s' (use %s)."
                             % (status, kind, " | ".join(allowed))))
        else:
            errs.append(_err(line, "status", "Kind '%s' takes no status; found '%s'." % (kind, status)))
    currency = raw["currency"]
    expected = CURRENCIES.get(kind, "")
    if currency not in ("", "USD", "SGD"):
        errs.append(_err(line, "currency", "Unknown currency '%s' (use USD, SGD or empty)." % currency))
    elif currency and currency != expected:
        if expected:
            errs.append(_err(line, "currency", "Kind '%s' must be in %s, found %s." % (kind, expected, currency)))
        else:
            errs.append(_err(line, "currency", "Kind '%s' takes no currency; found %s." % (kind, currency)))
    if kind == "obligation" and nums.get("amount") is not None and nums["amount"] <= 0:
        errs.append(_err(line, "amount", "The obligation amount must be greater than zero."))
    if kind == "service_bound" and nums.get("amount") is not None and nums["amount"] > Decimal(240):
        errs.append(_err(line, "amount", "service_bound is in hours and must be at most 240."))
    if errs:
        return None, errs
    return Event(
        record_id=raw["record_id"], kind=kind, slot=slot,
        effective_at=times["effective_at"], known_at=times["known_at"], expires_at=times["expires_at"],
        amount=nums["amount"], currency=currency, rate=nums["rate"], bp=nums["bp"],
        status=status, source=raw["source"], establishes=raw["establishes"],
    ), []


# --------------------------------------------------------------------------
# Decision times and sample scenarios
# --------------------------------------------------------------------------
def _ts(text):
    return datetime.fromisoformat(text)


DECISION_TIMES = (
    {"id": "friday", "label": "Friday funding decision", "as_of": _ts("2026-11-13T15:00:00+08:00")},
    {"id": "monday", "label": "Monday checkpoint", "as_of": _ts("2026-11-16T15:00:00+08:00")},
    {"id": "retro", "label": "Retrospective comparison", "as_of": _ts("2026-11-19T09:00:00+08:00")},
)
_DT_BY_ID = {d["id"]: d for d in DECISION_TIMES}
FRIDAY_AS_OF = _DT_BY_ID["friday"]["as_of"]


def decision_times_json():
    return [{"id": d["id"], "label": d["label"], "as_of_sgt": fmt_sgt(d["as_of"]),
             "as_of_ny": fmt_ny(d["as_of"])} for d in DECISION_TIMES]


FIXTURES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")


def _load_scenarios():
    path = os.path.join(FIXTURES_DIR, "scenarios.json")
    with open(path, encoding="utf-8") as handle:
        listing = json.load(handle)
    out = {}
    for item in listing:
        with open(os.path.join(FIXTURES_DIR, item["id"] + ".csv"), encoding="utf-8") as handle:
            text = handle.read()
        events, errors = load_events(text)
        if errors:
            raise RuntimeError("fixture %s is invalid: %r" % (item["id"], errors[:3]))
        out[item["id"]] = {"id": item["id"], "name": item["name"], "description": item["description"],
                           "synthetic": True, "events": events, "csv": text}
    return out


SCENARIOS = _load_scenarios()


def scenario_meta(scenario):
    return {"id": scenario["id"], "name": scenario["name"], "description": scenario["description"],
            "synthetic": True}


# --------------------------------------------------------------------------
# Evaluation helpers
# --------------------------------------------------------------------------
class Check:
    __slots__ = ("key", "name", "state", "detail", "records", "reason", "missing_label")

    def __init__(self, key, name, state, detail, records=(), reason=None, missing_label=None):
        self.key = key
        self.name = name
        self.state = state          # ok | fail | unknown
        self.detail = detail
        self.records = list(records)
        self.reason = reason        # for unknown: missing | stale | contradictory | derived
        self.missing_label = missing_label

    def to_json(self):
        return {"name": self.name, "state": self.state, "detail": self.detail,
                "record_ids": [r.record_id for r in self.records]}


def _ids(records):
    return ", ".join(r.record_id for r in records)


def _live(record, at):
    return record.expires_at is None or record.expires_at > at


def _pick(records, value, at=None):
    """Select one record. Returns (record, problem, related_records).

    problem: None | 'missing' | 'stale' | 'contradictory'.
    """
    if not records:
        return None, "missing", []
    pool = records
    if at is not None:
        pool = [r for r in records if _live(r, at)]
        if not pool:
            latest = max(records, key=lambda r: (r.known_at, r.record_id))
            return latest, "stale", list(records)
    values = {value(r) for r in pool}
    if len(values) > 1:
        return None, "contradictory", sorted(pool, key=lambda r: r.record_id)
    return max(pool, key=lambda r: (r.known_at, r.record_id)), None, [max(pool, key=lambda r: (r.known_at, r.record_id))]


class _View:
    def __init__(self, events, as_of):
        self.as_of = as_of
        self.visible = sorted((e for e in events if e.known_at <= as_of),
                              key=lambda e: (e.known_at, e.record_id))

    def kind(self, kind, slot=None):
        out = [e for e in self.visible if e.kind == kind]
        if slot is not None:
            out = [e for e in out if e.slot in ("", slot)]
        return out


class _Common:
    """Facts shared by both slots: obligation, release checkpoint, service bound."""

    def __init__(self, view):
        self.obl, self.obl_problem, self.obl_recs = _pick(
            view.kind("obligation"), lambda r: (r.amount, r.effective_at))
        self.rel, self.rel_problem, self.rel_recs = _pick(
            view.kind("release_checkpoint"), lambda r: r.effective_at)
        self.svc, self.svc_problem, self.svc_recs = _pick(
            view.kind("service_bound"), lambda r: r.amount)
        credits = view.kind("beneficiary_credit")
        self.credit = max(credits, key=lambda r: (r.effective_at, r.record_id)) if credits else None

    @property
    def net_usd(self):
        return self.obl.amount if self.obl_problem is None else None

    @property
    def deadline(self):
        return self.obl.effective_at if self.obl_problem is None else None

    @property
    def release(self):
        return self.rel.effective_at if self.rel_problem is None else None


def _problem_text(problem, what, recs, at=None):
    if problem == "missing":
        return "No %s on file." % what
    if problem == "stale":
        r = recs[-1] if recs else None
        when = ", before it was needed at %s" % fmt_sgt(at) if at is not None else ""
        if r is not None and r.expires_at is not None:
            return "The %s on file (%s) expired %s%s, so it is stale." % (what, _ids(recs), fmt_sgt(r.expires_at), when)
        return "The %s on file (%s) is stale." % (what, _ids(recs))
    if problem == "contradictory":
        return "Contradictory %s records (%s) disagree, so this is unknown." % (what, _ids(recs))
    return ""


class _Option:
    def __init__(self, slot):
        self.slot = slot
        self.checks = []  # type: List[Check]
        self.status = "unknown"
        self.instr = None
        self.cutoff = None
        self.label = "Fund %s slot" % SLOT_NAMES[slot]
        self.principal = None
        self.fees = None
        self.required = None
        self.usable = None
        self.days = None
        self.forward = False
        self.passed = False
        self.pricing = None   # the quote / forward_terms record used
        self.reservation = []  # reservation_cost records
        self.cash_explain = None
        self.cash_notes = []
        self.late_receipts = []
        self.warnings = []
        self.balance = None  # set when the bank balance is stale or missing for this slot

    def check(self, key):
        for c in self.checks:
            if c.key == key:
                return c
        return None

    def failed(self):
        return [c for c in self.checks if c.state == "fail"]

    def unknown(self):
        return [c for c in self.checks if c.state == "unknown" and c.reason != "derived"]


REQUIRED_FEE_TYPES = {"rail", "processing"}


def _lead_check(view, opt, slot, sname, local, all_cals, common, day, day_recs):
    """Open business dates after the instruction date through the release date in New York."""
    leads = view.kind("lead_business_days", slot)
    lead, problem, lrecs = _pick(leads, lambda r: r.amount)
    if problem is not None:
        opt.checks.append(Check("calendar", "Business days", "unknown",
                                _problem_text(problem, "%s lead business-day requirement" % sname, lrecs),
                                day_recs + lrecs, problem, "%s lead business-day requirement" % sname))
        return
    if common.release is None:
        opt.checks.append(Check("calendar", "Business days", "unknown",
                                "The release checkpoint is unknown, so business days cannot be counted.",
                                day_recs + lrecs, "derived"))
        return
    payout = _to_ny(common.release)[0].date()
    closed = {}
    for c in all_cals:
        if c.status == "closed" and c.effective_at is not None:
            closed[c.effective_at.astimezone(SGT).date()] = c
    open_days, recs, d = 0, list(day_recs) + lrecs, local.date()
    while d < payout:
        d = d + timedelta(days=1)
        if d.weekday() < 5 and d not in closed:
            open_days += 1
        elif d in closed:
            recs.append(closed[d])
    if payout.weekday() >= 5 or payout in closed:
        opt.checks.append(Check("calendar", "Business days", "fail",
                                "The payout date %s is not a business day, so the %s slot cannot meet the release."
                                % (payout.isoformat(), sname), recs))
    elif open_days < lead.amount:
        opt.checks.append(Check("calendar", "Business days", "fail",
                                "%s is a business day, but only %d open business date(s) remain through the %s "
                                "payout date; %s required (weekends and recorded closures excluded)." % (
                                    day, open_days, payout.isoformat(), fmt_plain(lead.amount)), recs))
    else:
        opt.checks.append(Check("calendar", "Business day", "ok",
                                "%s is a business day; %d open business date(s) through the %s payout date "
                                "(%s required)." % (day, open_days, payout.isoformat(), fmt_plain(lead.amount)), recs))


def _evaluate_option(view, common, slot, hindsight):
    as_of = view.as_of
    opt = _Option(slot)
    sname = SLOT_NAMES[slot]
    net = common.net_usd

    # 1. Obligation
    if common.obl_problem is None:
        opt.checks.append(Check("obligation", "Supplier obligation", "ok",
                                "USD %s net must be spendable by %s (%s)." % (
                                    fmt_num(net), fmt_sgt(common.deadline), fmt_ny(common.deadline)),
                                common.obl_recs))
    else:
        opt.checks.append(Check("obligation", "Supplier obligation", "unknown",
                                _problem_text(common.obl_problem, "supplier obligation", common.obl_recs),
                                common.obl_recs, common.obl_problem,
                                "Supplier obligation (net USD amount and deadline)"))

    # 2. Funding window
    slots = [e for e in view.kind("funding_slot") if e.slot == slot]
    rec, problem, recs = _pick(slots, lambda r: (r.effective_at, r.expires_at))
    if problem is None:
        opt.instr, opt.cutoff = rec.effective_at, rec.expires_at
        opt.label = "Fund %s" % _fmt_slot_label(opt.instr)
        if not hindsight and as_of > opt.cutoff:
            opt.passed = True
            opt.checks.append(Check("window", "Funding window", "fail",
                                    "The %s cutoff (%s) passed before this checkpoint." % (sname, fmt_sgt(opt.cutoff)),
                                    recs))
        elif opt.instr >= opt.cutoff:
            opt.checks.append(Check("window", "Funding window", "fail",
                                    "Instruction at %s is at or after the %s cutoff %s; the cutoff is exclusive." % (
                                        fmt_sgt(opt.instr), sname, _fmt_clock(opt.cutoff)), recs))
        elif common.release is not None and opt.instr >= common.release:
            opt.checks.append(Check("window", "Funding window", "fail",
                                    "Instruction at %s is not before the release checkpoint %s." % (
                                        fmt_sgt(opt.instr), fmt_sgt(common.release)), recs))
        else:
            opt.checks.append(Check("window", "Funding window", "ok",
                                    "Instruct at %s; cutoff %s." % (fmt_sgt(opt.instr), _fmt_clock(opt.cutoff)),
                                    recs))
    else:
        opt.checks.append(Check("window", "Funding window", "unknown",
                                _problem_text(problem, "%s funding slot" % sname, recs), recs, problem,
                                "%s funding slot and cutoff" % sname))
    instr = opt.instr
    opt.forward = (not hindsight) and instr is not None and as_of < instr
    if instr is None:
        # Without an instruction time nothing slot-specific can be judged as live.
        for key, name, label in (("calendar", "Business day", "%s business-day calendar" % sname),
                                 ("pricing", "FX pricing", "%s quote or binding forward terms" % sname),
                                 ("fees", "Fees", "%s fee schedule" % sname),
                                 ("cash", "Cash after floor and commitments", None),
                                 ("capacity", "Payout capacity", "Reserved or confirmed %s payout capacity" % sname),
                                 ("delivery", DELIVERY_NAME, None)):
            opt.checks.append(Check(key, name, "unknown", "Depends on the %s funding slot." % sname, (),
                                    "derived" if label is None else "missing", label))
        _set_status(opt)
        return opt

    # 3. Business day: the instruction date must be an open weekday; then enough open business dates
    #    after it, through the release date in New York (weekends and recorded closures excluded).
    local = instr.astimezone(SGT)
    all_cals = view.kind("calendar", slot)
    cals = [e for e in all_cals if e.effective_at is not None and e.effective_at.astimezone(SGT).date() == local.date()]
    rec, problem, recs = _pick(cals, lambda r: r.status)
    if problem is None:
        day = "%s %d %s" % (_DAYS[local.weekday()], local.day, _MONTHS[local.month - 1])
        if local.weekday() >= 5:
            opt.checks.append(Check("calendar", "Business day", "fail",
                                    "%s is a weekend, so the %s slot is lost." % (day, sname), recs))
        elif rec.status != "open":
            opt.checks.append(Check("calendar", "Business day", "fail",
                                    "%s is closed (known %s), so the %s slot is lost." % (
                                        day, fmt_sgt(rec.known_at), sname), recs))
        else:
            _lead_check(view, opt, slot, sname, local, all_cals, common, day, recs)
    else:
        opt.checks.append(Check("calendar", "Business day", "unknown",
                                _problem_text(problem, "%s calendar" % sname, recs), recs, problem,
                                "%s business-day calendar" % sname))

    # 4. FX pricing: a live quote, else agreed forward terms.
    quotes = view.kind("quote", slot)
    q_rec, q_problem, q_recs = _pick(quotes, lambda r: (r.rate, r.bp), at=instr)
    agreed = [e for e in view.kind("forward_terms", slot) if e.status == "agreed"]
    forwards = [e for e in agreed if e.rate is not None and e.bp is not None]
    incomplete = [e for e in agreed if e not in forwards]  # no spread: never assume 0 bp
    f_rec, f_problem, f_recs = _pick(forwards, lambda r: (r.rate, r.bp), at=instr)
    if q_problem is None:
        opt.pricing = q_rec
        opt.checks.append(Check("pricing", "FX quote", "ok",
                                "SGD %s per USD, %s bp spread, valid to %s." % (
                                    fmt_plain(q_rec.rate), fmt_plain(q_rec.bp), fmt_sgt(q_rec.expires_at)),
                                q_recs))
    elif f_problem is None:
        opt.pricing = f_rec
        valid = " valid to %s" % fmt_sgt(f_rec.expires_at) if f_rec.expires_at else ""
        opt.checks.append(Check("pricing", "Forward terms", "ok",
                                "Agreed forward terms: SGD %s per USD, %s bp spread,%s. Enforceability still to verify." % (
                                    fmt_plain(f_rec.rate), fmt_plain(f_rec.bp), valid),
                                f_recs))
    else:
        # Report the most informative problem: contradictory > stale > missing.
        order = {"contradictory": 0, "stale": 1, "missing": 2}
        candidates = [(q_problem, q_recs, "%s quote" % sname), (f_problem, f_recs, "%s forward terms" % sname)]
        problem, recs, what = min(candidates, key=lambda c: order[c[0]])
        if problem == "missing" and incomplete:
            recs = incomplete
            detail = "%s forward terms %s have no FX spread (bp), so pricing is unknown." % (sname, _ids(incomplete))
        elif problem == "missing":
            detail = "No %s quote or binding forward terms on file." % sname
        else:
            detail = _problem_text(problem, what, recs, at=instr)
        opt.checks.append(Check("pricing", "FX quote", "unknown", detail, recs, problem,
                                "%s quote or binding forward terms" % sname))
        if problem == "stale":
            opt.warnings.append("%s quote %s expired %s, before the %s instruction at %s; treated as unknown." % (
                sname, _ids(recs), fmt_sgt(recs[-1].expires_at), sname, fmt_sgt(instr)))
        if problem == "contradictory":
            opt.warnings.append("Contradictory %s pricing records (%s); treated as unknown." % (sname, _ids(recs)))

    # 5. Fees
    fees_all = view.kind("fee", slot)
    fees_live = [f for f in fees_all if _live(f, instr)]
    fee_sum = None
    by_type = {}
    for f in fees_live:
        by_type.setdefault(f.status, []).append(f)
    clash = [group for group in by_type.values() if len(group) > 1]
    if clash:
        recs = sorted((f for g in clash for f in g), key=lambda r: r.record_id)
        types = ", ".join(sorted({f.status for f in recs}))
        opt.checks.append(Check("fees", "Fees", "unknown",
                                "More than one live %s fee of the same type (%s: %s), so the fee is contradictory."
                                % (sname, types, _ids(recs)), recs, "contradictory", "%s fee schedule" % sname))
        opt.warnings.append("Contradictory %s fees (%s); fees treated as unknown." % (sname, _ids(recs)))
    elif fees_live and not REQUIRED_FEE_TYPES <= set(by_type):
        absent = sorted(REQUIRED_FEE_TYPES - set(by_type))
        opt.checks.append(Check("fees", "Fees", "unknown",
                                "No live %s %s fee on file, so the cost of this slot is incomplete." % (
                                    sname, " and ".join(absent)), fees_live, "missing", "%s %s fee" % (
                                    sname, " and ".join(absent))))
    elif fees_live:
        fee_sum = sum((f.amount for f in fees_live), Decimal(0))
        opt.checks.append(Check("fees", "Fees", "ok",
                                "Charges SGD %s (%s) plus FX spread." % (
                                    fmt_num(fee_sum), "; ".join("%s %s SGD %s" % (f.status, f.record_id,
                                                                                  fmt_num(f.amount))
                                                                for f in fees_live)),
                                fees_live))
    else:
        problem = "stale" if fees_all else "missing"
        opt.checks.append(Check("fees", "Fees", "unknown",
                                _problem_text(problem, "%s fee schedule" % sname, fees_all, at=instr),
                                fees_all, problem, "%s fee schedule" % sname))

    # Money for this slot (full precision; rounded only at output)
    if opt.pricing is not None and net is not None and fee_sum is not None:
        opt.principal = net * opt.pricing.rate
        spread = opt.principal * opt.pricing.bp / Decimal(10000)
        opt.fees = spread + fee_sum
        opt.required = opt.principal + opt.fees
    if common.release is not None and instr < common.release:
        opt.days = Decimal(_td_seconds(common.release - instr)) / Decimal(86400)
    opt.reservation = [e for e in view.kind("reservation_cost", slot) if e.slot == slot]

    # 6. Cash after floor and commitments
    _cash_check(view, opt, sname)

    # 7. Capacity
    caps = [e for e in view.kind("capacity", slot) if e.slot == slot]
    rec, problem, recs = _pick(caps, lambda r: (r.amount, r.status), at=instr)
    if problem is None:
        if rec.status == "indicative":
            opt.checks.append(Check("capacity", "Payout capacity", "unknown",
                                    "Only indicative capacity USD %s (%s); it is not reserved or confirmed." % (
                                        fmt_num(rec.amount), rec.record_id), recs, "missing",
                                    "Reserved or confirmed %s payout capacity" % sname))
        elif net is None:
            opt.checks.append(Check("capacity", "Payout capacity", "unknown",
                                    "Capacity USD %s is %s, but the obligation is unknown." % (
                                        fmt_num(rec.amount), rec.status), recs, "derived"))
        elif (rec.expires_at is not None and common.release is not None
              and rec.expires_at < common.release):
            opt.checks.append(Check("capacity", "Payout capacity", "unknown",
                                    "%s capacity %s is only confirmed until %s, before the release checkpoint %s; "
                                    "capacity through release is not evidenced." % (
                                        sname, rec.record_id, fmt_sgt(rec.expires_at), fmt_sgt(common.release)),
                                    recs, "stale", "%s payout capacity confirmed through release" % sname))
        elif rec.amount < net:
            opt.checks.append(Check("capacity", "Payout capacity", "fail",
                                    "%s capacity USD %s is below the USD %s obligation." % (
                                        sname, fmt_num(rec.amount), fmt_num(net)), recs))
        else:
            opt.checks.append(Check("capacity", "Payout capacity", "ok",
                                    "USD %s %s for the %s slot." % (fmt_num(rec.amount), rec.status, sname), recs))
    else:
        opt.checks.append(Check("capacity", "Payout capacity", "unknown",
                                _problem_text(problem, "%s payout capacity" % sname, recs, at=instr),
                                recs, problem, "Reserved or confirmed %s payout capacity" % sname))

    # 8. Delivery by deadline: an observed beneficiary credit overrides the simulated bound.
    if common.credit is not None and common.obl_problem is None:
        credit = common.credit
        if credit.effective_at <= common.deadline:
            opt.checks.append(Check("delivery", OBSERVED_NAME, "ok",
                                    "Usable credit observed %s (%s), within the %s deadline." % (
                                        fmt_sgt(credit.effective_at), credit.record_id, fmt_sgt(common.deadline)),
                                    [credit] + common.obl_recs))
        else:
            opt.checks.append(Check("delivery", OBSERVED_NAME, "fail",
                                    "Usable credit observed late: %s (%s), after the %s deadline." % (
                                        fmt_sgt(credit.effective_at), credit.record_id, fmt_sgt(common.deadline)),
                                    [credit] + common.obl_recs))
    elif common.rel_problem is None and common.svc_problem is None and common.obl_problem is None:
        hours = common.svc.amount
        arrival = common.release + timedelta(seconds=int(hours * 3600))
        recs = common.rel_recs + common.svc_recs + common.obl_recs
        base = "Release %s + %s h simulated bound = %s" % (fmt_sgt(common.release), fmt_plain(hours), fmt_sgt(arrival))
        if arrival <= common.deadline:
            opt.checks.append(Check("delivery", DELIVERY_NAME, "ok",
                                    "%s, within the %s deadline. Simulated bound, not observed delivery." % (
                                        base, fmt_sgt(common.deadline)), recs))
        else:
            opt.checks.append(Check("delivery", DELIVERY_NAME, "fail",
                                    "%s, after the %s deadline. Simulated bound, not observed delivery." % (
                                        base, fmt_sgt(common.deadline)), recs))
    else:
        parts = []
        recs = []
        problem = None
        for p, r, what in ((common.rel_problem, common.rel_recs, "release checkpoint"),
                           (common.svc_problem, common.svc_recs, "last-mile service bound")):
            if p is not None:
                parts.append(_problem_text(p, what, r))
                recs += r
                problem = problem if problem in ("contradictory", "stale") else p
        if not parts:
            opt.checks.append(Check("delivery", DELIVERY_NAME, "unknown",
                                    "The supplier deadline is unknown.", recs, "derived"))
        else:
            opt.checks.append(Check("delivery", DELIVERY_NAME, "unknown", " ".join(parts), recs, problem,
                                    "Release checkpoint and last-mile service bound"))

    # 9. Fallback: only when deciding to wait before the slot is reached.
    if opt.forward:
        fbs = [e for e in view.kind("fallback", slot) if e.status == "documented"]
        live = [f for f in fbs if _live(f, instr)
                and (common.deadline is None or f.expires_at is None or f.expires_at >= common.deadline)
                and (net is None or f.amount is None or f.amount >= net)]
        if live:
            opt.checks.append(Check("fallback", "Fallback route", "ok",
                                    "Documented fallback if the %s slot fails (%s)." % (sname, _ids(live)), live))
        else:
            problem = "stale" if fbs else "missing"
            opt.checks.append(Check("fallback", "Fallback route", "unknown",
                                    _problem_text(problem, "fallback route", fbs, at=instr), fbs, problem,
                                    "Documented fallback route if %s fails" % sname))

    _set_status(opt)
    return opt


# Demo policy (not an industry rule): a settled balance more than 24 h older than the funding slot being
# judged is stale. Exactly 24 h is accepted. An earlier expires_at on the snapshot still applies.
MAX_SNAPSHOT_AGE = timedelta(hours=24)
BALANCE_LIMIT_TEXT = "24 h before the funding slot (demo policy)"


def _settled_evidence(record):
    """Settled only if the record was dated no later than when it was first known."""
    return record.status == "settled" and record.effective_at <= record.known_at


def _fmt_age(td):
    minutes = int(_td_seconds(td) // 60)
    return "%d h %02d min" % (minutes // 60, minutes % 60)


def _cash_support_check(view, opt, sname):
    """Judging a later slot before it arrives: today's balance is not evidence of that day's cash.
    Only a documented cash-support attestation (after floor and all commitments) known now can be used."""
    sups = [e for e in view.kind("cash_support", opt.slot) if e.slot == opt.slot and e.status == "documented"]
    label = "Documented cash support for the %s slot (a balance known today is not %s cash)" % (sname, sname)
    rec, problem, recs = _pick(sups, lambda r: r.amount, at=opt.instr)
    if problem is not None:
        opt.checks.append(Check("cash", "Cash support", "unknown",
                                _problem_text(problem, "documented %s cash support" % sname, recs, at=opt.instr)
                                if problem != "missing" else
                                "No documented cash support for the %s slot on file; a balance known today does "
                                "not show %s's cash." % (sname, sname),
                                recs, problem, label))
        return
    if opt.required is None:
        opt.checks.append(Check("cash", "Cash support", "unknown",
                                "Documented cash support SGD %s; the required amount is not known yet." % fmt_num(
                                    rec.amount), recs, "derived"))
        return
    reservation = sum((r.amount for r in opt.reservation), Decimal(0))
    need = opt.required + reservation
    if rec.amount >= need:
        opt.usable = rec.amount
        opt.cash_explain = "documented %s cash support %s (%s), after floor and all commitments; an attestation, " \
                           "not a bank balance" % (sname, fmt_num(rec.amount), rec.record_id)
        opt.checks.append(Check("cash", "Cash support", "ok",
                                "Documented cash support SGD %s (%s, valid to %s) covers required SGD %s%s. It is an "
                                "attestation to verify, not a bank balance." % (
                                    fmt_num(rec.amount), rec.record_id, fmt_sgt(rec.expires_at),
                                    fmt_num(opt.required),
                                    " plus the SGD %s reservation cost" % fmt_num(reservation) if reservation else ""),
                                recs + list(opt.reservation)))
    else:
        opt.checks.append(Check("cash", "Cash support", "unknown",
                                "Documented cash support SGD %s (%s) is below required SGD %s." % (
                                    fmt_num(rec.amount), rec.record_id, fmt_num(need)),
                                recs, "missing", "Adequate documented cash support for the %s slot" % sname))


def _cash_check(view, opt, sname):
    instr = opt.instr
    opt.balance = None
    if opt.forward:
        _cash_support_check(view, opt, sname)
        return
    all_snaps = view.kind("cash_snapshot")
    receivables = view.kind("receivable")
    for r in all_snaps + receivables:
        if r.status == "settled" and r.effective_at > r.known_at:
            opt.warnings.append("%s %s is marked settled but dated %s, after it was first known %s; treated as a "
                                "forecast, not usable cash." % (
                                    "Cash snapshot" if r.kind == "cash_snapshot" else "Receipt", r.record_id,
                                    fmt_sgt(r.effective_at), fmt_sgt(r.known_at)))
    settled = [e for e in all_snaps if _settled_evidence(e) and e.effective_at <= instr]
    dated = [e for e in settled if _live(e, instr)]
    floors = view.kind("cash_floor")
    floor, f_problem, f_recs = _pick(floors, lambda r: r.amount)
    commitments = view.kind("commitment")
    label = "Settled bank balance within %s" % BALANCE_LIMIT_TEXT
    if not dated:
        if settled:  # every settled balance expired before the slot
            latest = max(settled, key=lambda r: r.effective_at)
            opt.balance = {"problem": "stale", "record": latest, "age": instr - latest.effective_at,
                           "expired": True}
            opt.checks.append(Check("cash", "Cash after floor and commitments", "unknown",
                                    "The newest settled balance (%s, %s) expired %s, before the %s slot at %s, so "
                                    "cash availability is unknown." % (
                                        latest.record_id, fmt_sgt(latest.effective_at), fmt_sgt(latest.expires_at),
                                        sname, fmt_sgt(instr)), [latest], "stale", label))
        else:
            opt.balance = {"problem": "missing", "record": None, "age": None, "expired": False}
            opt.checks.append(Check("cash", "Cash after floor and commitments", "unknown",
                                    "No settled bank balance dated before the %s slot at %s is on file, so cash "
                                    "availability is unknown." % (sname, fmt_sgt(instr)), all_snaps, "missing", label))
        return
    newest = max(e.effective_at for e in dated)
    if instr - newest > MAX_SNAPSHOT_AGE:
        latest = max((e for e in dated if e.effective_at == newest), key=lambda r: (r.known_at, r.record_id))
        age = instr - latest.effective_at
        opt.balance = {"problem": "stale", "record": latest, "age": age, "expired": False}
        opt.checks.append(Check("cash", "Cash after floor and commitments", "unknown",
                                "The newest settled balance (%s, %s) is %s old at the %s slot (%s); the limit is %s. "
                                "Cash availability is unknown; this does not show the account is short." % (
                                    latest.record_id, fmt_sgt(latest.effective_at), _fmt_age(age), sname,
                                    fmt_sgt(instr), BALANCE_LIMIT_TEXT), [latest], "stale", label))
        return
    snaps = [e for e in dated if e.effective_at == newest]
    # The commitment list must be attested complete for this slot (same freshness rule as the balance).
    lists = [e for e in view.kind("commitment_list") if e.status == "complete" and e.effective_at <= instr
             and instr - e.effective_at <= MAX_SNAPSHOT_AGE and _live(e, instr)]
    if not lists:
        old = view.kind("commitment_list")
        opt.checks.append(Check("cash", "Cash after floor and commitments", "unknown",
                                "No attestation within %s that the list of competing commitments is complete, so "
                                "cash after commitments is unknown." % BALANCE_LIMIT_TEXT, old,
                                "stale" if old else "missing", "Complete commitment list for the %s slot" % sname))
        return
    clist = max(lists, key=lambda r: (r.effective_at, r.record_id))
    latest_time = max(s.effective_at for s in snaps)
    at_latest = [s for s in snaps if s.effective_at == latest_time]
    if len({s.amount for s in at_latest}) > 1:
        recs = sorted(at_latest, key=lambda r: r.record_id)
        opt.checks.append(Check("cash", "Cash after floor and commitments", "unknown",
                                _problem_text("contradictory", "cash snapshot", recs), recs, "contradictory",
                                "Settled cash snapshot"))
        opt.warnings.append("Contradictory cash snapshots (%s); cash treated as unknown." % _ids(recs))
        return
    snap = max(at_latest, key=lambda r: (r.known_at, r.record_id))
    if f_problem is not None:
        opt.checks.append(Check("cash", "Cash after floor and commitments", "unknown",
                                _problem_text(f_problem, "cash floor policy", f_recs), f_recs, f_problem,
                                "Cash floor policy"))
        return
    reflected = [c for c in commitments if c.effective_at is not None and c.effective_at <= snap.effective_at]
    commitments = [c for c in commitments if c not in reflected]
    receipts = [r for r in receivables if _settled_evidence(r) and snap.effective_at < r.effective_at <= instr]
    late = [r for r in receivables if _settled_evidence(r) and r.effective_at > instr]
    forecasts = [r for r in receivables if not _settled_evidence(r)]
    receipt_sum = sum((r.amount for r in receipts), Decimal(0))
    commit_sum = sum((c.amount for c in commitments), Decimal(0))
    usable = snap.amount + receipt_sum - floor.amount - commit_sum
    opt.usable = usable
    explain = "settled %s" % fmt_num(snap.amount)
    if receipts:
        explain += " + settled receipts %s" % fmt_num(receipt_sum)
    explain += " %s floor %s %s commitments %s" % (MINUS, fmt_num(floor.amount), MINUS, fmt_num(commit_sum))
    notes = []
    for r in forecasts:
        notes.append("forecast %s not counted" % fmt_num(r.amount))
    for r in late:
        notes.append("%s settled %s is after this slot, not counted" % (fmt_num(r.amount), fmt_sgt(r.effective_at)))
    for c in reflected:
        notes.append("%s %s due %s is already reflected in the balance, not deducted again" % (
            c.record_id, fmt_num(c.amount), fmt_sgt(c.effective_at)))
    if notes:
        explain += "; " + "; ".join(notes)
    opt.cash_explain = explain
    opt.late_receipts = late
    recs = [snap, clist] + receipts + f_recs + commitments + reflected + forecasts + late
    sentences = []
    for r in forecasts:
        sentences.append("Forecast receipt SGD %s (%s) is not counted; only settled cash can fund an instruction." % (
            fmt_num(r.amount), r.record_id))
        opt.warnings.append("Forecast receipt SGD %s (%s) is not counted as usable cash." % (
            fmt_num(r.amount), r.record_id))
    for r in late:
        sentences.append("SGD %s settled %s (%s), after the %s instruction, so a %s receipt cannot finance it." % (
            fmt_num(r.amount), fmt_sgt(r.effective_at), r.record_id, sname, _weekday_long(r.effective_at)))
    if instr.astimezone(SGT).date() != snap.effective_at.astimezone(SGT).date():
        opt.warnings.append("%s cash uses the latest settled snapshot (%s, %s); no later balance was supplied." % (
            sname, snap.record_id, fmt_sgt(snap.effective_at)))
    extra = (" " + " ".join(sentences)) if sentences else ""
    if opt.required is None:
        opt.checks.append(Check("cash", "Cash after floor and commitments", "unknown",
                                "Usable SGD %s; the required amount is not known yet.%s" % (fmt_num(usable), extra),
                                recs, "derived"))
    elif usable >= opt.required:
        opt.checks.append(Check("cash", "Cash after floor and commitments", "ok",
                                "Usable SGD %s covers required SGD %s (headroom SGD %s).%s" % (
                                    fmt_num(usable), fmt_num(opt.required), fmt_num(usable - opt.required), extra),
                                recs))
    else:
        opt.checks.append(Check("cash", "Cash after floor and commitments", "fail",
                                "Usable SGD %s vs required SGD %s: short SGD %s.%s" % (
                                    fmt_num(usable), fmt_num(opt.required), fmt_num(opt.required - usable), extra),
                                recs))


def _set_status(opt):
    if opt.passed:
        opt.status = "passed"
    elif opt.failed():
        opt.status = "infeasible"
    elif any(c.reason in ("stale", "contradictory") for c in opt.unknown()):
        opt.status = "unknown"
    elif opt.unknown() or any(c.state == "unknown" for c in opt.checks):
        opt.status = "not_evidenced" if opt.forward else "unknown"
    else:
        opt.status = "feasible"


def _option_json(opt, rate):
    if opt.status == "not_evidenced":
        # A later option that is not yet evidenced shows only its status and checks: no numbers.
        return {"slot": opt.slot, "label": opt.label, "status": opt.status,
                "checks": [c.to_json() for c in opt.checks],
                "required_sgd": None, "principal_sgd": None, "restricted_days": None, "sgd_days": None,
                "avg_restricted_30d": None, "funding_cost_sgd": None, "funding_cost_formula": None,
                "fees_sgd": None, "cash_headroom_sgd": None}
    money = opt.principal is not None
    funding_cost = None
    formula = None
    if money and opt.days is not None:
        funding_cost = opt.principal * rate / Decimal(100) * opt.days / Decimal(365)
        formula = "%s \u00d7 %s%% \u00d7 %s / 365 = %s" % (fmt_num(opt.principal), fmt_plain(rate),
                                                        fmt_plain(opt.days), fmt_num(funding_cost))
    return {
        "slot": opt.slot,
        "label": opt.label,
        "status": opt.status,
        "checks": [c.to_json() for c in opt.checks],
        "required_sgd": fmt_money("SGD", opt.required),
        "principal_sgd": fmt_money("SGD", opt.principal),
        "restricted_days": _days_value(opt.days),
        "sgd_days": fmt_count(opt.principal * opt.days) if money and opt.days is not None else None,
        "avg_restricted_30d": fmt_money("SGD", opt.principal * opt.days / Decimal(30))
        if money and opt.days is not None else None,
        "funding_cost_sgd": fmt_money("SGD", funding_cost),
        "funding_cost_formula": formula,
        "fees_sgd": fmt_money("SGD", opt.fees),
        "cash_headroom_sgd": fmt_money("SGD", opt.usable - opt.required)
        if opt.usable is not None and opt.required is not None else None,
    }


# --------------------------------------------------------------------------
# Decisions
# --------------------------------------------------------------------------
DELIVERY_NAME = "Simulated delivery bound (not observed)"
OBSERVED_NAME = "Observed beneficiary credit"
_FAIL_ORDER_MONDAY = ("calendar", "window", "delivery", "cash", "capacity")


def _first_fail(opt, order=None):
    fails = opt.failed()
    if not fails:
        return None
    if order:
        for key in order:
            for c in fails:
                if c.key == key:
                    return c
    return fails[0]


def _missing_list(*opts):
    out = []
    for opt in opts:
        for c in opt.unknown():
            label = c.missing_label or c.name
            if c.reason == "stale":
                label += " (the record on file is stale)"
            elif c.reason == "contradictory":
                label += " (records on file contradict each other)"
            if label not in out:
                out.append(label)
    return out


def _join_and(items):
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _cash_block(opt):
    if opt is None or opt.usable is None:
        return None
    return {"amount": fmt_money("SGD", opt.usable), "explain": opt.cash_explain}


def _decision(state, headline, reason, binding, cash_opt, missing, actions, actionable, balance_check=None):
    return {"state": state, "headline": headline, "reason": reason, "binding_constraint": binding,
            "cash_after_commitments": _cash_block(cash_opt), "missing_evidence": missing,
            "next_actions": actions, "actionable_on_friday": actionable, "balance_check": balance_check}


def _balance_check_json(opt):
    b = opt.balance
    rec = b["record"]
    return {"slot": SLOT_NAMES[opt.slot], "slot_sgt": fmt_sgt(opt.instr),
            "problem": b["problem"],
            "balance_id": rec.record_id if rec else None,
            "balance_sgt": fmt_sgt(rec.effective_at) if rec else None,
            "balance_known_sgt": fmt_sgt(rec.known_at) if rec else None,
            "age_at_slot": _fmt_age(b["age"]) if b["age"] is not None else None,
            "expired_sgt": fmt_sgt(rec.expires_at) if rec is not None and b.get("expired") else None,
            "limit": BALANCE_LIMIT_TEXT}


def _needs_balance(opt):
    """True when the only thing standing between this slot and an answer is a stale or missing balance."""
    return (opt.balance is not None and not opt.failed()
            and all(c.key == "cash" for c in opt.unknown()))


def _balance_decision(opt, actionable, extra_actions=()):
    sname = SLOT_NAMES[opt.slot]
    b = opt.balance
    if b["problem"] == "missing":
        headline = "We need a bank balance to assess %s%ss funding." % (sname, RSQUO)
        reason = ("No settled bank balance dated before the %s slot (%s) is on file, so cash availability is "
                  "unknown." % (sname, fmt_sgt(opt.instr)))
    else:
        headline = "We need a newer bank balance to assess %s%ss funding." % (sname, RSQUO)
        rec = b["record"]
        if b.get("expired"):
            reason = ("The newest settled balance (%s, %s) expired %s, before the %s slot at %s. Cash availability "
                      "is unknown; this does not show the account is short." % (
                          rec.record_id, fmt_sgt(rec.effective_at), fmt_sgt(rec.expires_at), sname,
                          fmt_sgt(opt.instr)))
        else:
            reason = ("The newest settled balance (%s) is from %s: %s old at the %s slot (%s). The limit is "
                      "%s. Cash availability is unknown; this does not show the account is short." % (
                          rec.record_id, fmt_sgt(rec.effective_at), _fmt_age(b["age"]), sname, fmt_sgt(opt.instr),
                          BALANCE_LIMIT_TEXT))
    actions = ["Ask your bank for a settled balance dated within 24 hours of the %s %s instruction, then re-run "
               "this replay." % (sname, _fmt_clock(opt.instr)),
               "Until then, do not treat %s as feasible or as short; its cash position is unknown." % sname]
    return _decision("NEED_NEWER_BALANCE", headline, reason,
                     "Bank balance freshness: %s." % BALANCE_LIMIT_TEXT, None, _missing_list(opt),
                     list(extra_actions) + actions, actionable, _balance_check_json(opt))


def _cash_short_actions(opt, sname):
    short = fmt_money("SGD", opt.required - opt.usable)
    actions = ["Report the %s shortfall for the %s slot to the controller." % (short, sname),
               "Ask your bank whether an existing committed facility covers %s before the %s cutoff." % (short, sname)]
    if any("Forecast receipt" in w for w in opt.warnings):
        actions.append("Do not count the forecast customer receipt until your bank shows it settled.")
    return actions


def _deadline_actions(common):
    return ["Ask your provider for an earlier release or confirmed alternate capacity that meets %s." % fmt_sgt(
        common.deadline),
            "Ask the supplier whether the %s deadline can move." % fmt_ny(common.deadline),
            "Record this as a deadline risk; the last-mile bound is simulated, not observed delivery."]


def _decide_friday(fri, mon, common, as_of, actionable):
    if fri.failed():
        fail = _first_fail(fri, ("delivery", "cash"))
        if fail.key == "delivery":
            return _decision(
                "DEADLINE_AT_RISK", "Supplier deadline at risk",
                "Even Friday funding misses the deadline. %s" % fail.detail,
                "Last-mile time after the common release checkpoint.", fri, _missing_list(fri),
                _deadline_actions(common), actionable)
        if fail.key == "cash":
            reason = "Settled cash after the floor and commitments does not cover Friday%ss requirement: %s" % (
                RSQUO, _cash_short(fri))
            if any("Forecast receipt" in w for w in fri.warnings):
                reason += " The forecast customer receipt is not settled, so it is not counted."
            return _decision(
                "INSUFFICIENT_CASH", "Not enough usable cash for Friday%ss funding" % RSQUO, reason,
                "Usable cash after the cash floor and competing commitments.", fri, _missing_list(fri),
                _cash_short_actions(fri, "Friday"), actionable)
        return _decision(
            "NO_DECISION", "No decision: the Friday route is not usable",
            fail.detail, fail.name, fri, _missing_list(fri),
            ["Confirm the Friday route with your bank or provider before %s." % _fmt_clock(fri.cutoff)
             if fri.cutoff else "Confirm the Friday route with your bank or provider."], actionable)
    if fri.status != "feasible" and _needs_balance(fri):
        return _balance_decision(fri, actionable)
    if fri.status != "feasible":
        missing = _missing_list(fri)
        return _decision(
            "NO_DECISION", "No decision: Friday evidence incomplete",
            "Friday cannot be shown feasible: %s" % _join_and(missing) + " is not established.",
            "Missing or unreliable Friday evidence.", fri, missing,
            ["Obtain the missing Friday evidence from your bank or provider: %s." % _join_and(missing)],
            actionable)
    if mon.status == "feasible":
        terms = []
        if mon.pricing is not None:
            kind = "forward terms" if mon.pricing.kind == "forward_terms" else "quote"
            terms.append("Verify with your provider that the Monday %s (SGD %s per USD, %s bp, %s) are binding for "
                         "USD %s net." % (kind, fmt_plain(mon.pricing.rate), fmt_plain(mon.pricing.bp or Decimal(0)),
                                          mon.pricing.record_id, fmt_num(common.net_usd)))
        cap = mon.check("capacity")
        if cap is not None and cap.records:
            terms.append("Verify the Monday capacity (%s) is reserved for this payment and cannot be withdrawn."
                         % _ids(cap.records))
        fb = mon.check("fallback")
        if fb is not None and fb.records:
            terms.append("Verify the documented fallback route (%s) can still meet %s." % (
                _ids(fb.records), fmt_sgt(common.deadline)))
        if mon.reservation:
            res = sum((r.amount for r in mon.reservation), Decimal(0))
            terms.append("Confirm the reservation cost %s (%s) and when it is charged." % (
                fmt_money("SGD", res), _ids(mon.reservation)))
        terms.append("Until review is complete, keep the existing Friday instruction with your bank or provider.")
        return _decision(
            "MANUAL_REVIEW", "Manual review before waiting",
            "Monday terms, capacity and a fallback were on file before Friday%ss cutoff, but they must be verified "
            "before relying on them." % RSQUO,
            "Friday %s cutoff: the Monday terms must be verified before it." % _fmt_clock(fri.cutoff),
            fri, _missing_list(fri), terms, actionable)
    # Keep Friday
    if mon.status == "infeasible":
        fail = _first_fail(mon, _FAIL_ORDER_MONDAY)
        reason = "Monday cannot be used. %s" % fail.detail
        binding = "%s for the Monday slot." % fail.name
    elif mon.status == "unknown":
        bad = [c for c in mon.unknown() if c.reason in ("stale", "contradictory")]
        reason = "Monday evidence is not reliable. %s" % bad[0].detail
        binding = "Friday %s cutoff: Monday is not evidenced before it closes." % _fmt_clock(fri.cutoff)
    else:
        missing = [c.missing_label or c.name for c in mon.unknown()]
        reason = "Monday is not evidenced by %s. Missing: %s." % (fmt_sgt(as_of), "; ".join(missing))
        binding = "Friday %s cutoff: Monday is not evidenced before it closes." % _fmt_clock(fri.cutoff)
    actions = ["Keep the existing Friday instruction with your bank or provider.",
               "To consider waiting next time, ask your provider before Friday%ss cutoff for binding Monday terms, "
               "reserved capacity and a documented fallback." % RSQUO]
    return _decision("KEEP_FRIDAY", "Keep Friday%ss funding window" % RSQUO, reason, binding, fri,
                     _missing_list(mon), actions, actionable)


NO_DOUBLE = "If the Friday instruction was kept, do not instruct the same payment again on Monday."


def _add_no_double(decision):
    decision["next_actions"].append(NO_DOUBLE)
    return decision


def _decide_monday(mon, common, actionable, fri_state):
    """The Monday checkpoint is a counterfactual: it assumes the SGD had been held after Friday."""
    reviewed = fri_state == "MANUAL_REVIEW"
    lead = ("If you held the funds after review: confirm the Monday position with your provider before %s."
            % _fmt_clock(mon.cutoff) if mon.cutoff else
            "If you held the funds after review: confirm the Monday position with your provider.")
    prefix = [lead] if reviewed else []
    if mon.failed():
        fail = _first_fail(mon, _FAIL_ORDER_MONDAY)
        if fail.key == "delivery":
            return _decision("DEADLINE_AT_RISK", "Supplier deadline would have been at risk",
                             "Had the SGD been held, Monday funding would have missed the deadline. %s" % fail.detail,
                             "Last-mile time after the common release checkpoint.", mon, _missing_list(mon),
                             prefix + _deadline_actions(common) + [NO_DOUBLE], actionable)
        if fail.key == "cash":
            short = fmt_money("SGD", mon.required - mon.usable)
            reason = "Had the SGD been held, Monday would have had %s" % _cash_short(mon)
            actions = prefix + ["Report the counterfactual Monday shortfall of %s to the controller." % short,
                                "Before relying on waiting, ask your bank whether an existing committed facility "
                                "would cover %s." % short]
            if any("Forecast receipt" in w for w in mon.warnings):
                reason += " The forecast customer receipt is not settled, so it is not counted."
                actions.append("Do not count the forecast customer receipt until your bank shows it settled.")
            return _decision("INSUFFICIENT_CASH", "Monday would have been short of usable cash", reason,
                             "Usable cash after the cash floor and competing commitments.", mon,
                             _missing_list(mon), actions + [NO_DOUBLE], actionable)
        return _decision("MONDAY_UNAVAILABLE", "Monday funding slot would have been unavailable",
                         "Had the SGD been held, the Monday slot would have been lost. %s" % fail.detail,
                         "%s for the Monday slot." % fail.name, mon, _missing_list(mon),
                         prefix + ["Record why waiting would have lost the Monday slot.", NO_DOUBLE], actionable)
    if mon.status != "feasible" and _needs_balance(mon):
        return _add_no_double(_balance_decision(mon, actionable, prefix))
    if mon.status != "feasible":
        missing = _missing_list(mon)
        bad = mon.unknown()
        reason = bad[0].detail if bad else "Monday evidence is incomplete."
        return _decision("NO_DECISION", "No decision: Monday evidence would have been incomplete", reason,
                         "Missing or unreliable Monday evidence.", mon, missing,
                         prefix + (["Record which Monday evidence was missing: %s." % "; ".join(missing)]
                                   if missing else []) + [NO_DOUBLE], actionable)
    reason = ("Had the SGD been held, Monday%ss evidence would have covered the same USD %s net by the same "
              "deadline." % (RSQUO, fmt_num(common.net_usd)))
    if reviewed:
        actions = ["If you held the funds after review: confirm the Monday terms and capacity with your provider "
                   "before %s." % _fmt_clock(mon.cutoff), NO_DOUBLE,
                   "Track beneficiary credit separately: provider release is not supplier credit."]
    else:
        actions = ["No Monday action: this checkpoint is a counterfactual and Friday%ss decision stands." % RSQUO,
                   NO_DOUBLE,
                   "Next time, ask your provider before Friday%ss cutoff whether Monday terms and capacity can be "
                   "agreed in advance." % RSQUO]
    return _decision("MONDAY_FEASIBLE", "Monday funding would have been feasible on Monday%ss evidence" % RSQUO,
                     reason, "Monday %s cutoff." % _fmt_clock(mon.cutoff), mon, [], actions, actionable)


def _cash_short(opt):
    return "usable SGD %s vs required SGD %s, short SGD %s." % (
        fmt_num(opt.usable), fmt_num(opt.required), fmt_num(opt.required - opt.usable))


def _withheld_reason(fri, mon):
    parts = []
    for opt, sname in ((mon, "Monday"), (fri, "Friday")):
        if opt.status == "feasible":
            continue
        also = " either" if parts else ""
        fail = _first_fail(opt, _FAIL_ORDER_MONDAY)
        if fail is not None and fail.key == "cash":
            if opt.slot == "monday" and opt.late_receipts:
                r = opt.late_receipts[0]
                parts.append("%s receipt cannot finance Monday%ss instruction: SGD %s settled %s, after it. "
                             "Monday had %s" % (_weekday_long(r.effective_at), RSQUO, fmt_num(r.amount),
                                                fmt_sgt(r.effective_at), _cash_short(opt)))
            else:
                parts.append("%s was not feasible%s: %s" % (sname, also, _cash_short(opt)))
        elif fail is not None:
            parts.append("%s was not feasible%s. %s" % (sname, also, fail.detail))
        else:
            bad = opt.unknown() or [c for c in opt.checks if c.state == "unknown"]
            parts.append("%s was unknown%s. %s" % (sname, also, bad[0].detail if bad else "Evidence incomplete."))
    return "Comparison withheld. " + " ".join(parts)


RATES_DIFFER = ("FX rates or spreads differ between slots; the difference would mix a market move or a pricing "
                "difference with timing.")
RISK_NOTE = "A missed deadline can swamp either figure."


def _comparison(fri, mon, rate, framing):
    """Like-for-like only: same net amount, deadline, FX rate and principal. Extra cost is fees only."""
    if (fri.pricing.rate != mon.pricing.rate or fri.pricing.bp != mon.pricing.bp
            or fri.principal != mon.principal):
        return _withheld("Comparison withheld. " + RATES_DIFFER)
    principal = fri.principal
    df, dm = fri.days, mon.days
    capital_days = principal * (df - dm)
    carry = rate / Decimal(100) * capital_days / Decimal(365)
    extra = mon.fees - fri.fees
    reservation = sum((r.amount for r in mon.reservation), Decimal(0))
    net = carry - extra - reservation
    zero_cost = extra + reservation
    lhs = "%s × %s%% × (%s %s %s) / 365" % (fmt_num(principal), fmt_plain(rate), fmt_plain(df), MINUS,
                                                     fmt_plain(dm))
    formula = "%s = %s; %s %s %s" % (lhs, fmt_num(carry), fmt_num(carry), MINUS, fmt_num(extra))
    if reservation:
        formula += " %s %s" % (MINUS, fmt_num(reservation))
    formula += " = %s" % fmt_num(net)
    if zero_cost >= 0:
        note = "If retained cash earns nothing and avoids no borrowing, waiting costs %s more." % fmt_money(
            "SGD", zero_cost)
        if reservation:
            note = note[:-1] + " (%s extra processing + %s reservation)." % (
                fmt_money("SGD", extra), fmt_money("SGD", reservation))
    else:
        note = ("If retained cash earns nothing and avoids no borrowing, Monday%ss fees are %s lower; that is a fee "
                "difference, not a timing benefit." % (RSQUO, fmt_money("SGD", -zero_cost)))
    return {
        "available": True, "withheld_reason": None,
        "days": {"friday": _days_value(df), "monday": _days_value(dm)},
        "sgd_days_less": fmt_count(capital_days),
        "avg_restricted_less_30d": fmt_money("SGD", capital_days / Decimal(30)),
        "carry_reduction": fmt_money("SGD", carry),
        "extra_processing": fmt_money("SGD", extra),
        "reservation_cost": fmt_money("SGD", reservation) if mon.reservation else None,
        "net_benefit_before_subscription": fmt_money("SGD", net),
        "formula": formula, "framing": framing, "zero_rate_note": note, "risk_note": RISK_NOTE,
    }


def _withheld(reason):
    return {"available": False, "withheld_reason": reason, "days": None, "sgd_days_less": None,
            "avg_restricted_less_30d": None, "carry_reduction": None, "extra_processing": None,
            "reservation_cost": None, "net_benefit_before_subscription": None, "formula": None,
            "framing": None, "zero_rate_note": None, "risk_note": None}


def _comparable(fri, mon, common):
    return (fri.status == "feasible" and mon.status == "feasible" and common.net_usd is not None
            and common.deadline is not None and fri.days is not None and mon.days is not None)


_LATE_NAMES = {"quote": "quote", "capacity": "capacity", "forward_terms": "forward terms",
               "calendar": "calendar", "fallback": "fallback"}


def _late_kinds(mon):
    """[(kind name, first known_at)] for Monday evidence first known after the Friday decision time."""
    first = {}
    order = []
    for c in mon.checks:
        if c.state != "ok":
            continue
        for r in c.records:
            if r.known_at > FRIDAY_AS_OF and r.kind in _LATE_NAMES:
                name = _LATE_NAMES[r.kind]
                if name not in first:
                    order.append(name)
                    first[name] = r.known_at
                elif r.known_at < first[name]:
                    first[name] = r.known_at
    return [(name, first[name]) for name in order]


def _late_sentence(late):
    if not late:
        return ""
    times = {t for _, t in late}
    if len(times) == 1:
        names = [n for n, _ in late]
        return "Monday%ss %s %s first known %s." % (RSQUO, _join_and(names), "was" if len(names) == 1 else "were",
                                                    fmt_sgt(late[0][1]))
    parts = ["%s was first known %s" % (n, fmt_sgt(t)) for n, t in late]
    return "Monday%ss %s." % (RSQUO, "; ".join(parts))


# --------------------------------------------------------------------------
# evaluate
# --------------------------------------------------------------------------
def _as_rate(value):
    if isinstance(value, float):
        raise TypeError("funding_rate_pct must be a Decimal or a decimal string, never a float")
    if isinstance(value, Decimal):
        rate = value
    elif isinstance(value, (int, str)) and not isinstance(value, bool):
        text = str(value).strip()
        if not re.match(r"^[0-9]{1,3}(\.[0-9]{1,6})?$", text):
            raise ValueError("funding_rate_pct must be a non-negative decimal, e.g. 8 or 2.5")
        rate = Decimal(text)
    else:
        raise TypeError("funding_rate_pct must be a Decimal")
    if not rate.is_finite() or rate < 0 or rate > 100:
        raise ValueError("funding_rate_pct must be between 0 and 100")
    return rate


def _friday_view(events):
    """The Friday decision exactly as it was available on Friday (records known by Fri 15:00 only)."""
    view = _View(events, FRIDAY_AS_OF)
    common = _Common(view)
    fri = _evaluate_option(view, common, "friday", False)
    mon = _evaluate_option(view, common, "monday", False)
    actionable = _comparable(fri, mon, common)
    decision = _decide_friday(fri, mon, common, FRIDAY_AS_OF, actionable)
    return view, common, fri, mon, decision, actionable


def _hindsight_option(events, rview, rcommon, slot):
    """Retro: judge a slot only on records known by that slot's own instruction time."""
    slots = [e for e in rview.kind("funding_slot") if e.slot == slot]
    rec, problem, _ = _pick(slots, lambda r: (r.effective_at, r.expires_at))
    if problem is not None:
        return _evaluate_option(rview, rcommon, slot, True), rview
    view = _View(events, rec.effective_at)
    common = _Common(view)
    common.credit = rcommon.credit  # an observed outcome overrides the simulated bound
    opt = _evaluate_option(view, common, slot, True)
    late = [r for r in rview.kind("receivable") if _settled_evidence(r) and r.effective_at > rec.effective_at]
    opt.late_receipts = opt.late_receipts + [r for r in late if r not in opt.late_receipts]
    return opt, view


def evaluate(events, decision_time, funding_rate_pct, scenario=None):
    """Pure, deterministic evaluation of one decision time. Returns the contract JSON dict."""
    with localcontext() as ctx:
        ctx.prec = 100  # 18-digit amounts x rates x days stay exact
        return _evaluate(events, decision_time, funding_rate_pct, scenario)


def _evaluate(events, decision_time, funding_rate_pct, scenario):
    if decision_time not in _DT_BY_ID:
        raise ValueError("unknown decision_time %r (use %s)" % (decision_time, ", ".join(_DT_BY_ID)))
    rate = _as_rate(funding_rate_pct)
    dt = _DT_BY_ID[decision_time]
    as_of = dt["as_of"]
    view = _View(events, as_of)
    common = _Common(view)
    _, _, _, _, fri_decision, actionable = _friday_view(events)
    note = None

    comparison = None
    if decision_time == "friday":
        fri = _evaluate_option(view, common, "friday", False)
        mon = _evaluate_option(view, common, "monday", False)
        decision = _decide_friday(fri, mon, common, as_of, actionable)
        # No economic figure on Friday, even under manual review: the terms are unverified (as in the original).
    elif decision_time == "monday":
        fri = _evaluate_option(view, common, "friday", False)
        mon = _evaluate_option(view, common, "monday", False)
        note = ("Counterfactual: assumes the SGD had been held after Friday. On Friday%ss evidence the decision "
                "was: %s." % (RSQUO, fri_decision["headline"]))
        decision = _decide_monday(mon, common, actionable, fri_decision["state"])
    else:
        fri, fview = _hindsight_option(events, view, common, "friday")
        mon, mview = _hindsight_option(events, view, common, "monday")
        times = [(SLOT_NAMES[o.slot], o.instr) for o in (fri, mon) if o.instr is not None]
        note = ("Hindsight: each slot is judged only on records known by its own instruction time (%s)." %
                "; ".join("%s %s" % (n, fmt_sgt(t)) for n, t in times)) if times else \
            "Hindsight: each slot is judged only on records known by its own instruction time."
        mcommon = _Common(mview)
        if _comparable(fri, mon, mcommon):
            late = _late_kinds(mon)
            if actionable:
                framing = ("Hindsight. A reviewed option existed on Friday: Monday terms, reserved capacity and a "
                           "documented fallback were known before Friday%ss cutoff. Waiting still needed manual "
                           "review; this is not a recommendation." % RSQUO)
                headline = "Hindsight comparison: a reviewed Monday option existed on Friday"
            else:
                known = (" " + _late_sentence(late)) if late else ""
                framing = ("Hindsight only. Not available to the operator on Friday.%s The Friday decision stands; "
                           "the difference was not actionable on Friday." % known)
                headline = ("In hindsight, Monday tied up cash for fewer days — waiting was not supported on "
                            "Friday")
            comparison = _comparison(fri, mon, rate, framing)
        if comparison is not None and comparison["available"]:
            reason = ("Each slot was feasible on the records known by its own instruction time, for the same USD %s "
                      "net and deadline." % fmt_num(mcommon.net_usd))
            if not actionable and late:
                reason += " " + _late_sentence(late)
            decision = _decision(
                "HINDSIGHT", headline, reason,
                "The common release checkpoint %s ends the carry for both slots." % fmt_sgt(common.release),
                mon, [],
                ["Use this as a hindsight record only; it does not change the Friday decision.",
                 "Ask the controller what the retained cash would actually have earned or repaid.",
                 "Ask the supplier%ss bank for available-balance evidence; provider release is not credit."
                 % RSQUO], actionable)
        else:
            if comparison is not None:
                reason = comparison["withheld_reason"]
                binding = "FX rate differs between the two slots."
            else:
                reason = _withheld_reason(fri, mon)
                comparison = _withheld(reason)
                fail = _first_fail(mon, _FAIL_ORDER_MONDAY) or _first_fail(fri, _FAIL_ORDER_MONDAY)
                binding = ("%s (%s slot)." % (fail.name, SLOT_NAMES[mon.slot if mon.failed() else fri.slot])
                           if fail else "Missing or unreliable evidence.")
            decision = _decision(
                "HINDSIGHT", "Hindsight comparison withheld", reason, binding, mon, _missing_list(fri, mon),
                ["Keep the Friday decision as the record; no like-for-like Monday alternative is shown.",
                 "Ask the supplier%ss bank for available-balance evidence; provider release is not credit."
                 % RSQUO], actionable)

    # Evidence register (visible records only)
    used = {}
    for opt in (fri, mon):
        for c in opt.checks:
            tag = "%s: %s" % (opt.slot, c.name.lower())
            for r in c.records:
                used.setdefault(r.record_id, [])
                if tag not in used[r.record_id]:
                    used[r.record_id].append(tag)
        for r in opt.reservation:
            used.setdefault(r.record_id, []).append("%s: reservation cost" % opt.slot)
    evidence = [{
        "record_id": e.record_id, "kind": e.kind, "slot": e.slot, "fact": e.establishes,
        "effective_sgt": fmt_sgt(e.effective_at), "known_sgt": fmt_sgt(e.known_at),
        "expires_sgt": fmt_sgt(e.expires_at), "status": e.status or "—",
        "used_by": used.get(e.record_id, []),
    } for e in view.visible]

    warnings = []
    if common.svc_problem is None:
        warnings.append("The %s h last-mile bound is simulated, not observed delivery." % fmt_plain(common.svc.amount))
    if common.credit is None:
        warnings.append("Provider release is not beneficiary credit; beneficiary credit is not observed.")
    for opt in (fri, mon):
        for w in opt.warnings:
            if w not in warnings:
                warnings.append(w)

    if common.credit is not None:
        credit_text = "observed %s (%s)" % (fmt_sgt(common.credit.effective_at), common.credit.record_id)
    else:
        credit_text = "not observed"

    meta = scenario_meta(scenario) if scenario else {
        "id": "custom", "name": "Custom events", "description": "Events supplied directly to the engine.",
        "synthetic": True}
    return {
        "label": LABEL,
        "engine": ENGINE,
        "scenario": meta,
        "decision_time": {"id": dt["id"], "label": dt["label"], "as_of_sgt": fmt_sgt(as_of),
                          "as_of_ny": fmt_ny(as_of), "note": note},
        "payment": {
            "net_usd": fmt_num(common.net_usd) if common.net_usd is not None else None,
            "deadline_sgt": fmt_sgt(common.deadline) if common.deadline else None,
            "deadline_ny": fmt_ny(common.deadline) if common.deadline else None,
            "release_sgt": fmt_sgt(common.release) if common.release else None,
            "release_ny": fmt_ny(common.release) if common.release else None,
            "beneficiary_credit": credit_text,
        },
        "decision": decision,
        "options": [_option_json(fri, rate), _option_json(mon, rate)],
        "comparison": comparison,
        "assumption": {"funding_rate_pct": fmt_plain(rate), "kind": "assumption",
                       "text": "Hypothetical annual rate on retained cash (avoided borrowing or incremental "
                               "return). Not historical evidence."},
        "evidence": evidence,
        "warnings": warnings,
    }


if __name__ == "__main__":  # pragma: no cover - convenience CLI
    import sys
    sc = sys.argv[1] if len(sys.argv) > 1 else "reference"
    t = sys.argv[2] if len(sys.argv) > 2 else "friday"
    r = sys.argv[3] if len(sys.argv) > 3 else "8"
    print(json.dumps(evaluate(SCENARIOS[sc]["events"], t, Decimal(r), SCENARIOS[sc]), indent=1,
                     ensure_ascii=False))
