"""Tests for pilot.imports (synthetic data only).

Run from funding-replay/:  python3 -m unittest discover -s tests/pilot -p 'test_imports.py'
"""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from pilot import imports  # noqa: E402
from pilot.imports import COLUMNS, parse_cases_csv  # noqa: E402

HEADER = ",".join(COLUMNS)

BASE = {
    "importer": "Example Importer Pte Ltd (synthetic)",
    "supplier": "Example Supplier Ltd (synthetic)",
    "payout_amount": "1000.00",
    "payout_currency": "USD",
    "funding_amount": "1350.00",
    "funding_currency": "SGD",
    "quote_ref": "QT-T-1",
    "deadline_local": "2026-11-18 17:00",
    "deadline_tz": "Asia/Singapore",
    "window_a_local": "2026-11-13 15:00",
    "window_a_cutoff_local": "2026-11-13 16:00",
    "later_permitted": "no",
    "contract_ref": "",
    "window_b_local": "",
    "window_b_cutoff_local": "",
    "expected_receipt_amount": "",
    "expected_receipt_local": "",
    "balance_amount": "",
    "balance_as_of_local": "",
    "balance_source": "",
    "reference": "PO-1",
}


def q(v):
    return '"%s"' % v.replace('"', '""') if ("," in v or '"' in v) else v


def line(**over):
    d = dict(BASE)
    d.update(over)
    return ",".join(q(d[c]) for c in COLUMNS)


def csv_of(*lines, header=HEADER):
    return "\n".join([header] + list(lines)) + "\n"


class ValidImport(unittest.TestCase):
    def test_minimal_row(self):
        rows, errors = parse_cases_csv(csv_of(line()))
        self.assertEqual(errors, [])
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["deadline_at"], "2026-11-18T09:00:00Z")
        self.assertEqual(r["window_a_at"], "2026-11-13T07:00:00Z")
        self.assertEqual(r["window_a_cutoff_at"], "2026-11-13T08:00:00Z")
        self.assertEqual(r["deadline_tz"], "Asia/Singapore")
        self.assertIs(r["later_permitted"], False)
        self.assertIsNone(r["window_b_at"])
        self.assertEqual(r["observations"], [])
        self.assertEqual(r["payout_amount"], "1000.00")
        self.assertTrue(r["idempotency_key"].startswith("csv-import-"))
        for k in ("importer", "supplier", "payout_amount", "payout_currency", "funding_amount", "funding_currency",
                  "quote_ref", "deadline_at", "deadline_tz", "window_a_at", "window_a_cutoff_at", "later_permitted",
                  "contract_ref", "window_b_at", "window_b_cutoff_at", "reference", "observations",
                  "idempotency_key"):
            self.assertIn(k, r)

    def test_idempotency_key_is_stable(self):
        a, _ = parse_cases_csv(csv_of(line()))
        b, _ = parse_cases_csv(csv_of(line()))
        c, _ = parse_cases_csv(csv_of(line(reference="PO-2")))
        self.assertEqual(a[0]["idempotency_key"], b[0]["idempotency_key"])
        self.assertNotEqual(a[0]["idempotency_key"], c[0]["idempotency_key"])

    def test_quoted_thousands_separator_and_normalisation(self):
        rows, errors = parse_cases_csv(csv_of(line(payout_amount="48,250.00", funding_amount="1,234,567.5")))
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["payout_amount"], "48250.00")
        self.assertEqual(rows[0]["funding_amount"], "1234567.5")

    def test_unquoted_thousands_separator_is_column_count_error(self):
        text = csv_of(line().replace("1000.00", "1,000.00", 1))
        rows, errors = parse_cases_csv(text)
        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("Row 1", errors[0])
        self.assertIn("double quotes", errors[0])

    def test_bom_tolerated(self):
        rows, errors = parse_cases_csv("﻿" + csv_of(line()))
        self.assertEqual(errors, [])
        self.assertEqual(len(rows), 1)

    def test_bytes_input_and_crlf(self):
        text = csv_of(line()).replace("\n", "\r\n")
        rows, errors = parse_cases_csv(("﻿" + text).encode("utf-8"))
        self.assertEqual(errors, [])
        self.assertEqual(len(rows), 1)

    def test_header_order_and_case_free(self):
        cols = list(reversed(COLUMNS))
        header = ",".join(c.upper() for c in cols)
        d = dict(BASE)
        rows, errors = parse_cases_csv(header + "\n" + ",".join(q(d[c]) for c in cols) + "\n")
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["importer"], BASE["importer"])

    def test_yes_no_true_false(self):
        for word, val in (("yes", True), ("TRUE", True), ("no", False), ("False", False)):
            over = {"later_permitted": word}
            if val:
                over.update(window_b_local="2026-11-16 15:00", window_b_cutoff_local="2026-11-16 16:00")
            rows, errors = parse_cases_csv(csv_of(line(**over)))
            self.assertEqual(errors, [], word)
            self.assertIs(rows[0]["later_permitted"], val)

    def test_window_b_and_observations(self):
        rows, errors = parse_cases_csv(csv_of(line(
            later_permitted="yes", contract_ref="CT-9",
            window_b_local="2026-11-16 15:00", window_b_cutoff_local="2026-11-16 16:00",
            expected_receipt_amount="2,000.00", expected_receipt_local="2026-11-20 10:00",
            balance_amount="0", balance_as_of_local="2026-11-12 09:00", balance_source="Bank statement")))
        self.assertEqual(errors, [])
        r = rows[0]
        self.assertEqual(r["window_b_at"], "2026-11-16T07:00:00Z")
        self.assertEqual(r["window_b_cutoff_at"], "2026-11-16T08:00:00Z")
        self.assertEqual(r["contract_ref"], "CT-9")
        er = [o for o in r["observations"] if o["kind"] == "expected_receipt"][0]
        bal = [o for o in r["observations"] if o["kind"] == "balance"][0]
        self.assertEqual(er["amount"], "2000.00")
        self.assertEqual(er["currency"], "SGD")
        self.assertEqual(er["expected_at"], "2026-11-20T02:00:00Z")
        self.assertEqual(er["provenance"], "operator_entered")
        self.assertTrue(er["source"])
        self.assertEqual(bal, {"kind": "balance", "amount": "0", "currency": "SGD", "as_of": "2026-11-12T01:00:00Z",
                               "source": "Bank statement", "provenance": "operator_entered"})

    def test_balance_source_defaults(self):
        rows, errors = parse_cases_csv(csv_of(line(balance_amount="5.00", balance_as_of_local="2026-11-12 09:00")))
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["observations"][0]["source"], imports.DEFAULT_SOURCE)

    def test_jpy_whole_numbers(self):
        rows, errors = parse_cases_csv(csv_of(line(payout_amount="2,850,000", payout_currency="JPY")))
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["payout_amount"], "2850000")

    def test_funding_currency_default(self):
        rows, errors = parse_cases_csv(csv_of(line(funding_currency="")), funding_currency_default="SGD")
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["funding_currency"], "SGD")

    def test_shipped_sample_is_valid_and_not_northwind(self):
        with open(os.path.join(ROOT, "docs", "pilot", "sample_cases.csv"), encoding="utf-8") as fh:
            text = fh.read()
        rows, errors = parse_cases_csv(text)
        self.assertEqual(errors, [])
        self.assertEqual(len(rows), 3)
        self.assertNotIn("northwind", text.lower())

    def test_shipped_invalid_sample_fails(self):
        with open(os.path.join(ROOT, "docs", "pilot", "sample_cases_invalid.csv"), encoding="utf-8") as fh:
            rows, errors = parse_cases_csv(fh.read())
        self.assertEqual(rows, [])
        self.assertGreaterEqual(len(errors), 5)


class TimeZones(unittest.TestCase):
    def test_stockholm_across_dst_end(self):
        # CEST (UTC+2) until 25 Oct 2026 03:00, CET (UTC+1) after.
        rows, errors = parse_cases_csv(csv_of(line(
            deadline_tz="Europe/Stockholm", window_a_local="2026-10-23 15:00", window_a_cutoff_local="2026-10-23 16:00",
            deadline_local="2026-10-27 17:00", payout_currency="EUR", funding_currency="EUR")))
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["window_a_at"], "2026-10-23T13:00:00Z")
        self.assertEqual(rows[0]["deadline_at"], "2026-10-27T16:00:00Z")

    def test_stockholm_across_dst_start(self):
        # CET until 28 Mar 2027 02:00 -> CEST.
        rows, errors = parse_cases_csv(csv_of(line(
            deadline_tz="Europe/Stockholm", window_a_local="2027-03-26 15:00", window_a_cutoff_local="2027-03-26 16:00",
            deadline_local="2027-03-29 15:00")))
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["window_a_at"], "2027-03-26T14:00:00Z")
        self.assertEqual(rows[0]["deadline_at"], "2027-03-29T13:00:00Z")

    def test_nonexistent_local_time_rejected(self):
        rows, errors = parse_cases_csv(csv_of(line(
            deadline_tz="Europe/Stockholm", window_a_local="2027-03-26 15:00", window_a_cutoff_local="2027-03-26 16:00",
            deadline_local="2027-03-28 02:30")))
        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("Row 1, column deadline_local:"))
        self.assertIn("does not exist", errors[0])

    def test_ambiguous_local_time_rejected(self):
        rows, errors = parse_cases_csv(csv_of(line(
            deadline_tz="Europe/Stockholm", window_a_local="2026-10-23 15:00", window_a_cutoff_local="2026-10-23 16:00",
            deadline_local="2026-10-25 02:30")))
        self.assertEqual(rows, [])
        self.assertIn("happens twice", errors[0])

    def test_offset_or_bad_format_rejected(self):
        for bad in ("2026-11-18T17:00:00+08:00", "2026-11-18T09:00:00Z", "18/11/2026 17:00", "2026-02-30 10:00"):
            rows, errors = parse_cases_csv(csv_of(line(deadline_local=bad)))
            self.assertEqual(rows, [], bad)
            self.assertTrue(errors and errors[0].startswith("Row 1, column deadline_local:"), (bad, errors))

    def test_unknown_zone_reported_once(self):
        rows, errors = parse_cases_csv(csv_of(line(deadline_tz="Mars/Olympus")))
        self.assertEqual(rows, [])
        self.assertEqual(errors, ["Row 1, column deadline_tz: unknown time zone 'Mars/Olympus'; use an IANA name "
                                  "such as Asia/Singapore"])


class Invalid(unittest.TestCase):
    def errs(self, **over):
        rows, errors = parse_cases_csv(csv_of(line(**over)))
        self.assertEqual(rows, [])
        self.assertTrue(errors)
        return errors

    def test_amount_rules(self):
        cases = {
            "-5.00": "negative", "1e3": "exponent", "1.5E2": "exponent", "10.001": "at most 2",
            "abc": "not an exact", "1,00.00": "thousands", "+5": "'+'", "0": "greater than zero", "$5": "not an exact",
            " ": "required", "1 000": "not an exact", ".5": "not an exact",
        }
        for raw, frag in cases.items():
            errors = self.errs(payout_amount=raw)
            self.assertTrue(any("payout_amount" in e and frag in e for e in errors), (raw, errors))

    def test_jpy_decimal_rejected(self):
        errors = self.errs(payout_amount="100.0", payout_currency="JPY")
        self.assertIn("no minor unit", errors[0])

    def test_unknown_currency(self):
        errors = self.errs(funding_currency="BTC")
        self.assertTrue(errors[0].startswith("Row 1, column funding_currency: unknown currency"))

    def test_required_fields(self):
        for col in imports.REQUIRED:
            errors = self.errs(**{col: ""})
            self.assertIn("Row 1, column %s: required" % col, errors, col)

    def test_later_permitted_needs_window_b(self):
        errors = self.errs(later_permitted="yes")
        self.assertIn("Row 1, column window_b_local: required when later_permitted is true", errors)
        self.assertIn("Row 1, column window_b_cutoff_local: required when later_permitted is true", errors)

    def test_bad_boolean(self):
        self.assertIn("later_permitted", self.errs(later_permitted="maybe")[0])

    def test_ordering(self):
        e = self.errs(window_a_cutoff_local="2026-11-13 15:00")
        self.assertIn("Row 1, column window_a_cutoff_local: must be after window_a_local", e)
        e = self.errs(deadline_local="2026-11-13 14:00", window_a_local="2026-11-13 15:00")
        self.assertIn("Row 1, column deadline_local: must be after window_a_local", e)
        e = self.errs(later_permitted="yes", window_b_local="2026-11-19 15:00", window_b_cutoff_local="2026-11-19 14:00")
        self.assertIn("Row 1, column window_b_cutoff_local: must be after window_b_local", e)
        self.assertIn("Row 1, column deadline_local: must be after window_b_local", e)

    def test_half_given_observation(self):
        e = self.errs(balance_amount="10.00")
        self.assertIn("Row 1, column balance_as_of_local: required when a balance amount or source is given", e)
        e = self.errs(expected_receipt_local="2026-11-20 10:00")
        self.assertIn("Row 1, column expected_receipt_amount: required when expected_receipt_local is given", e)

    def test_negative_balance_rejected(self):
        e = self.errs(balance_amount="-1.00", balance_as_of_local="2026-11-12 09:00")
        self.assertIn("balance_amount", e[0])


class Header(unittest.TestCase):
    def test_unknown_and_missing(self):
        header = HEADER.replace("balance_source", "balance_src")
        rows, errors = parse_cases_csv(csv_of(line(), header=header))
        self.assertEqual(rows, [])
        self.assertIn("Header: unknown column 'balance_src'", errors)
        self.assertIn("Header: missing column 'balance_source'", errors)

    def test_duplicate_column(self):
        rows, errors = parse_cases_csv(csv_of(line() + ",PO-1", header=HEADER + ",reference"))
        self.assertEqual(rows, [])
        self.assertIn("Header: column 'reference' appears more than once", errors)

    def test_empty_file(self):
        self.assertEqual(parse_cases_csv(""), ([], ["File: the file is empty; the first line must be the header"]))
        self.assertEqual(parse_cases_csv(HEADER + "\n"), ([], ["File: no data rows below the header"]))

    def test_unbalanced_quotes(self):
        rows, errors = parse_cases_csv(csv_of(line(importer='Bad "quote')).replace('""', '"'))
        self.assertEqual(rows, [])
        self.assertTrue(errors)


class AllOrNothing(unittest.TestCase):
    def test_one_bad_row_drops_all(self):
        good = [line(reference="PO-%d" % i) for i in range(5)]
        rows, errors = parse_cases_csv(csv_of(*good))
        self.assertEqual((len(rows), errors), (5, []))
        bad = good[:3] + [line(reference="PO-X", payout_currency="ZZZ")] + good[3:]
        rows, errors = parse_cases_csv(csv_of(*bad))
        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("Row 4, column payout_currency:"))

    def test_errors_from_every_row(self):
        rows, errors = parse_cases_csv(csv_of(line(payout_amount="x"), line(reference="B"), line(funding_amount="y")))
        self.assertEqual(rows, [])
        self.assertTrue(errors[0].startswith("Row 1, column payout_amount"))
        self.assertTrue(errors[1].startswith("Row 3, column funding_amount"))

    def test_blank_lines_skipped_but_numbering_matches_file(self):
        rows, errors = parse_cases_csv(csv_of(line(reference="A"), "", line(reference="B", payout_currency="Q")))
        self.assertEqual(rows, [])
        self.assertTrue(errors[0].startswith("Row 3, "), errors)

    def test_duplicates_flagged(self):
        rows, errors = parse_cases_csv(csv_of(line(), line(payout_amount="1,000.00", importer=BASE["importer"].upper())))
        self.assertEqual(rows, [])
        self.assertEqual(errors, ["Row 2, column reference: duplicate of row 1 (same importer, supplier, payout, "
                                  "deadline and reference)"])

    def test_same_parties_different_reference_ok(self):
        rows, errors = parse_cases_csv(csv_of(line(), line(reference="PO-2")))
        self.assertEqual((len(rows), errors), (2, []))

    def test_max_rows(self):
        many = [line(reference="R%d" % i) for i in range(imports.MAX_ROWS)]
        rows, errors = parse_cases_csv(csv_of(*many))
        self.assertEqual((len(rows), errors), (imports.MAX_ROWS, []))
        rows, errors = parse_cases_csv(csv_of(*(many + [line(reference="extra")])))
        self.assertEqual(rows, [])
        self.assertIn("maximum is 500", errors[0])


if __name__ == "__main__":
    unittest.main()
