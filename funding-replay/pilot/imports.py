"""CSV case import for the pilot desk (DATA module; standard library only).

``parse_cases_csv(text)`` validates a whole file and returns ``(rows, errors)``.
It is all-or-nothing: if any error is found, ``rows`` is ``[]`` and nothing
should be created.  Each row dict has the keys of the ``POST /api/cases`` body
(PILOT_CONTRACT §11): times converted to UTC ISO-8601 ``...Z`` from local times in
``deadline_tz``; amounts as exact decimal strings (thousands separators removed).

Error strings are ``"Row N, column C: message"`` (N = 1-based data row, i.e. the
spreadsheet line minus the header), ``"Header: message"`` for header problems and
``"File: message"`` for whole-file problems (empty file, too many rows).

This module never touches the database and never moves money.
"""

import csv
import hashlib
import io
import json
import re
from datetime import datetime, timedelta, timezone

try:  # Python 3.9+
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception

__all__ = ["COLUMNS", "CURRENCY_EXPONENTS", "MAX_ROWS", "parse_cases_csv"]

COLUMNS = (
    "importer", "supplier", "payout_amount", "payout_currency", "funding_amount",
    "funding_currency", "quote_ref", "deadline_local", "deadline_tz", "window_a_local",
    "window_a_cutoff_local", "later_permitted", "contract_ref", "window_b_local",
    "window_b_cutoff_local", "expected_receipt_amount", "expected_receipt_local",
    "balance_amount", "balance_as_of_local", "balance_source", "reference",
)

REQUIRED = (
    "importer", "supplier", "payout_amount", "payout_currency", "funding_amount",
    "funding_currency", "quote_ref", "deadline_local", "deadline_tz", "window_a_local",
    "window_a_cutoff_local", "later_permitted",
)

# Kept local so the module stays importable on its own; must match money.py (§2).
CURRENCY_EXPONENTS = {"SGD": 2, "USD": 2, "EUR": 2, "GBP": 2, "HKD": 2, "JPY": 0}

MAX_ROWS = 500
MAX_TEXT = 200

TRUE_WORDS = {"true", "yes"}
FALSE_WORDS = {"false", "no"}

_PLAIN_AMOUNT = re.compile(r"^[0-9]+(\.[0-9]+)?$")
_GROUPED_AMOUNT = re.compile(r"^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$")
_LOCAL_TIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$"
)

DEFAULT_SOURCE = "CSV import"
PAYER_NOT_STATED = "Not stated in CSV import"


class _RowErrors:
    def __init__(self, row_no, sink):
        self.row_no = row_no
        self.sink = sink
        self.count = 0

    def add(self, column, message):
        self.sink.append("Row %d, column %s: %s" % (self.row_no, column, message))
        self.count += 1


def _parse_amount(raw, currency, column, errs, *, allow_zero):
    """Return the canonical decimal string (no separators) or None after reporting."""
    s = raw.strip()
    if s.startswith("-"):
        errs.add(column, "negative amounts are not allowed (%r)" % raw)
        return None
    if s.startswith("+"):
        errs.add(column, "remove the '+' sign (%r)" % raw)
        return None
    if re.search(r"[eE]", s):
        errs.add(column, "exponent notation is not allowed; write the amount in full (%r)" % raw)
        return None
    if _GROUPED_AMOUNT.match(s):
        s = s.replace(",", "")
    elif not _PLAIN_AMOUNT.match(s):
        if "," in s:
            errs.add(column, "thousands separators must group digits in threes, e.g. \"48,250.00\" (%r)" % raw)
        else:
            errs.add(column, "not an exact decimal amount (%r)" % raw)
        return None
    if currency in CURRENCY_EXPONENTS:
        exp = CURRENCY_EXPONENTS[currency]
        if "." in s:
            decimals = len(s.split(".", 1)[1])
            if exp == 0:
                errs.add(column, "%s has no minor unit; give a whole number (%r)" % (currency, raw))
                return None
            if decimals > exp:
                errs.add(column, "%s allows at most %d decimal places (%r)" % (currency, exp, raw))
                return None
    if not allow_zero and _to_minor(s, currency) == 0:
        errs.add(column, "amount must be greater than zero")
        return None
    return s


def _to_minor(s, currency):
    exp = CURRENCY_EXPONENTS.get(currency, 2)
    whole, _, frac = s.partition(".")
    frac = (frac + "0" * exp)[:exp] if exp else ""
    return int(whole + frac) if (whole + frac) else 0


def _parse_currency(raw, column, errs):
    s = raw.strip().upper()
    if s not in CURRENCY_EXPONENTS:
        errs.add(column, "unknown currency %r; use one of %s" % (raw, ", ".join(sorted(CURRENCY_EXPONENTS))))
        return None
    return s


def _parse_local(raw, tz, column, errs):
    """Local wall time in ``tz`` -> aware UTC datetime, or None after reporting."""
    s = raw.strip()
    m = _LOCAL_TIME.match(s)
    if not m:
        if re.search(r"(Z|[+-]\d{2}:?\d{2})$", s):
            errs.add(column, "give the local time without a UTC offset, e.g. 2026-11-18 15:00 (%r)" % raw)
        else:
            errs.add(column, "not a local date-time; use YYYY-MM-DD HH:MM (%r)" % raw)
        return None
    y, mo, d, h, mi, sec = (int(g) if g else 0 for g in m.groups())
    try:
        naive = datetime(y, mo, d, h, mi, sec)
    except ValueError:
        errs.add(column, "not a valid calendar date-time (%r)" % raw)
        return None
    if tz is None:
        return None  # zone error already reported once on deadline_tz
    first = naive.replace(tzinfo=tz, fold=0)
    second = naive.replace(tzinfo=tz, fold=1)
    if first.utcoffset() != second.utcoffset():
        # Either a repeated hour (clocks went back) or a skipped hour (clocks went forward).
        back = first.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)
        if back != naive:
            errs.add(column, "%s does not exist in %s (clocks go forward); give a time outside the skipped hour"
                     % (s, tz.key))
        else:
            errs.add(column, "%s happens twice in %s (clocks go back); give a time outside the repeated hour"
                     % (s, tz.key))
        return None
    return first.astimezone(timezone.utc)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_bool(raw, column, errs):
    s = raw.strip().lower()
    if s in TRUE_WORDS:
        return True
    if s in FALSE_WORDS:
        return False
    errs.add(column, "use true/false or yes/no (%r)" % raw)
    return None


def _check_header(header, errors):
    """Return column->index mapping or None after reporting."""
    names = [h.strip().lower() for h in header]
    mapping = {}
    ok = True
    for i, n in enumerate(names):
        if n == "":
            errors.append("Header: column %d has no name" % (i + 1))
            ok = False
        elif n in mapping:
            errors.append("Header: column %r appears more than once" % n)
            ok = False
        elif n not in COLUMNS:
            errors.append("Header: unknown column %r" % header[i].strip())
            ok = False
        else:
            mapping[n] = i
    for c in COLUMNS:
        if c not in mapping:
            errors.append("Header: missing column %r" % c)
            ok = False
    return mapping if ok else None


def _idempotency_key(row):
    material = json.dumps(row, sort_keys=True, separators=(",", ":"))
    return "csv-import-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


def parse_cases_csv(text, *, funding_currency_default=None):
    """Validate a case CSV. Returns ``(rows, errors)``; ``rows == []`` whenever ``errors``."""
    errors = []
    if isinstance(text, bytes):
        try:
            text = text.decode("utf-8")
        except UnicodeDecodeError:
            return [], ["File: the file is not UTF-8 text; save it as CSV UTF-8"]
    if text.startswith("﻿"):
        text = text[1:]
    if "\x00" in text:
        return [], ["File: the file contains binary data; save it as CSV UTF-8"]

    try:
        records = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error as exc:
        return [], ["File: could not read CSV (%s); check quotes are balanced" % exc]

    while records and not any(c.strip() for c in records[0]):
        records.pop(0)
    if not records:
        return [], ["File: the file is empty; the first line must be the header"]

    header, body = records[0], records[1:]
    mapping = _check_header(header, errors)
    if mapping is None:
        return [], errors

    numbered = [(i + 1, r) for i, r in enumerate(body) if any(c.strip() for c in r)]
    if len(numbered) == 0:
        return [], ["File: no data rows below the header"]
    if len(numbered) > MAX_ROWS:
        return [], ["File: %d data rows; the maximum is %d per import — split the file"
                    % (len(numbered), MAX_ROWS)]

    rows = []
    seen = {}
    ncols = len(header)
    for row_no, rec in numbered:
        errs = _RowErrors(row_no, errors)
        if len(rec) != ncols:
            hint = ""
            if len(rec) > ncols:
                hint = "; an amount with a thousands separator must be in double quotes, e.g. \"48,250.00\""
            errors.append("Row %d, column *: expected %d columns, found %d%s" % (row_no, ncols, len(rec), hint))
            continue
        v = {c: rec[mapping[c]].strip() for c in COLUMNS}

        for c in REQUIRED:
            if c == "funding_currency" and not v[c] and funding_currency_default:
                v[c] = funding_currency_default
            if not v[c]:
                errs.add(c, "required")
        for c in ("importer", "supplier", "quote_ref", "contract_ref", "reference", "balance_source"):
            if len(v[c]) > MAX_TEXT:
                errs.add(c, "longer than %d characters" % MAX_TEXT)

        pay_ccy = _parse_currency(v["payout_currency"], "payout_currency", errs) if v["payout_currency"] else None
        fund_ccy = _parse_currency(v["funding_currency"], "funding_currency", errs) if v["funding_currency"] else None
        pay_amt = (_parse_amount(v["payout_amount"], pay_ccy, "payout_amount", errs, allow_zero=False)
                   if v["payout_amount"] else None)
        fund_amt = (_parse_amount(v["funding_amount"], fund_ccy, "funding_amount", errs, allow_zero=False)
                    if v["funding_amount"] else None)

        tz = None
        if v["deadline_tz"]:
            try:
                if ZoneInfo is None:
                    raise ZoneInfoNotFoundError(v["deadline_tz"])
                tz = ZoneInfo(v["deadline_tz"])
            except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
                errs.add("deadline_tz", "unknown time zone %r; use an IANA name such as Asia/Singapore"
                         % v["deadline_tz"])

        def t(col):
            return _parse_local(v[col], tz, col, errs) if v[col] else None

        deadline = t("deadline_local")
        win_a = t("window_a_local")
        cut_a = t("window_a_cutoff_local")
        later = _parse_bool(v["later_permitted"], "later_permitted", errs) if v["later_permitted"] else None
        win_b = t("window_b_local")
        cut_b = t("window_b_cutoff_local")

        if later:
            for c in ("window_b_local", "window_b_cutoff_local"):
                if not v[c]:
                    errs.add(c, "required when later_permitted is true")
        if v["window_b_local"] and not v["window_b_cutoff_local"] and not later:
            errs.add("window_b_cutoff_local", "required when window_b_local is given")
        if v["window_b_cutoff_local"] and not v["window_b_local"] and not later:
            errs.add("window_b_local", "required when window_b_cutoff_local is given")

        if win_a and cut_a and not cut_a > win_a:
            errs.add("window_a_cutoff_local", "must be after window_a_local")
        if win_b and cut_b and not cut_b > win_b:
            errs.add("window_b_cutoff_local", "must be after window_b_local")
        if deadline and win_a and not deadline > win_a:
            errs.add("deadline_local", "must be after window_a_local")
        if deadline and win_b and not deadline > win_b:
            errs.add("deadline_local", "must be after window_b_local")

        observations = []
        er_amt_raw, er_at_raw = v["expected_receipt_amount"], v["expected_receipt_local"]
        if er_amt_raw or er_at_raw:
            if not er_amt_raw:
                errs.add("expected_receipt_amount", "required when expected_receipt_local is given")
            if not er_at_raw:
                errs.add("expected_receipt_local", "required when expected_receipt_amount is given")
            er_amt = (_parse_amount(er_amt_raw, fund_ccy, "expected_receipt_amount", errs, allow_zero=False)
                      if er_amt_raw else None)
            er_at = t("expected_receipt_local")
            if er_amt is not None and er_at is not None and fund_ccy:
                observations.append({
                    "kind": "expected_receipt", "amount": er_amt, "currency": fund_ccy,
                    "expected_at": _iso(er_at), "payer": PAYER_NOT_STATED,
                    "provenance": "operator_entered", "source": DEFAULT_SOURCE,
                })

        bal_amt_raw, bal_at_raw = v["balance_amount"], v["balance_as_of_local"]
        if bal_amt_raw or bal_at_raw or v["balance_source"]:
            if not bal_amt_raw:
                errs.add("balance_amount", "required when a balance date or source is given")
            if not bal_at_raw:
                errs.add("balance_as_of_local", "required when a balance amount or source is given")
            bal_amt = (_parse_amount(bal_amt_raw, fund_ccy, "balance_amount", errs, allow_zero=True)
                       if bal_amt_raw else None)
            bal_at = t("balance_as_of_local")
            if bal_amt is not None and bal_at is not None and fund_ccy:
                observations.append({
                    "kind": "balance", "amount": bal_amt, "currency": fund_ccy,
                    "as_of": _iso(bal_at), "source": v["balance_source"] or DEFAULT_SOURCE,
                    "provenance": "operator_entered",
                })

        if errs.count:
            continue

        out = {
            "importer": v["importer"],
            "supplier": v["supplier"],
            "payout_amount": pay_amt,
            "payout_currency": pay_ccy,
            "funding_amount": fund_amt,
            "funding_currency": fund_ccy,
            "quote_ref": v["quote_ref"],
            "deadline_at": _iso(deadline),
            "deadline_tz": tz.key,
            "window_a_at": _iso(win_a),
            "window_a_cutoff_at": _iso(cut_a),
            "later_permitted": later,
            "contract_ref": v["contract_ref"] or None,
            "window_b_at": _iso(win_b) if win_b else None,
            "window_b_cutoff_at": _iso(cut_b) if cut_b else None,
            "reference": v["reference"] or None,
            "observations": observations,
        }

        dup_key = (
            v["importer"].casefold(), v["supplier"].casefold(),
            _to_minor(pay_amt, pay_ccy), pay_ccy, out["deadline_at"], (v["reference"] or "").casefold(),
        )
        if dup_key in seen:
            errs.add("reference", "duplicate of row %d (same importer, supplier, payout, deadline and reference)"
                     % seen[dup_key])
            continue
        seen[dup_key] = row_no

        out["idempotency_key"] = _idempotency_key(out)
        rows.append(out)

    if errors:
        return [], errors
    return rows, []
