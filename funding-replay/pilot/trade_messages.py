"""Read-only trade message previews; deliberately NOT wire-format certification.

MT700 accepts a restricted tag body (one part, no FIN envelope). The independent
ISO profile reads selected payment-instruction fields; no MT-to-MX translation.
Neither verifies a sender, creates an instrument, or changes a payment.
"""
import datetime as dt
import hashlib
import re
from xml.etree import ElementTree as ET

from . import money

LIMIT = 32 * 1024
KINDS = ("mt700", "pacs.008.001.08")
NS = "urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"
TAGS = ("27", "40A", "20", "31C", "40E", "31D", "50", "59", "32B", "41D", "46A", "49")
REQUIRED = tuple(k for k in TAGS if k != "46A")


def _exact_amount(currency, text, *, mt=False):
    if mt:
        if len(text) > 15 or not re.fullmatch(r"[0-9]+,[0-9]*", text):
            raise ValueError("MT amount requires a decimal comma in this profile.")
        text = text.rstrip(",") if text.endswith(",") else text.replace(",", ".")
    elif not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", text):
        raise ValueError("Expected a positive decimal amount.")
    return money.parse(text, currency, allow_zero=False).to_json()


def _date(value):
    if not re.fullmatch(r"[0-9]{6}", value):
        raise ValueError("Expected YYMMDD.")
    # The century is an explicit simulation convention, not a SWIFT rule.
    try:
        return dt.date(2000 + int(value[:2]), int(value[2:4]), int(value[4:])).isoformat()
    except ValueError:
        raise ValueError("Invalid calendar date.") from None


def _mt(raw):
    tags = {}
    key = None
    for line in raw.replace("\r\n", "\n").strip("\n").split("\n"):
        if not line or len(line) > 90 or any(not (" " <= x <= "~") for x in line):
            raise ValueError("Invalid MT tag-body line.")
        match = re.match(r"^:([0-9]{2}[A-Z]?):(.*)$", line)
        if match:
            key, value = match.groups()
            if key in tags or key not in TAGS:
                raise ValueError("Duplicate or unsupported MT field.")
            tags[key] = value
        elif key in {"50", "59", "41D", "46A"} and not line.startswith((":", "{", "-}")):
            tags[key] += "\n" + line
        else:
            raise ValueError("Expected a supported MT field.")
    if any(not tags.get(k, "").strip() for k in REQUIRED):
        raise ValueError("Missing or blank mandatory sandbox MT field.")
    if list(tags) != sorted(tags, key=TAGS.index):
        raise ValueError("MT fields are out of order.")
    if tags["27"] != "1/1" or tags["40A"] != "IRREVOCABLE":
        raise ValueError("Only a single-part irrevocable credit is supported.")
    if tags["49"] not in {"CONFIRM", "MAY ADD", "WITHOUT"}:
        raise ValueError("Unsupported confirmation instruction.")
    ref = tags["20"]
    if not re.fullmatch(r"[A-Za-z0-9 /?:().'\-+,]{1,16}", ref) or ref.startswith("/") or ref.endswith("/") or "//" in ref:
        raise ValueError("Invalid credit reference.")
    expiry = tags["31D"]
    if not expiry[6:].strip() or len(expiry[6:]) > 29:
        raise ValueError("Expiry place is missing or too long.")
    issue, expiry_date = _date(tags["31C"]), _date(expiry[:6])
    if expiry_date < issue:
        raise ValueError("Expiry precedes issue.")
    amount = _exact_amount(tags["32B"][:3], tags["32B"][3:], mt=True)
    return {
        "reference": ref, "issue_date": issue, "expiry_date": expiry_date,
        "expiry_place": expiry[6:], "applicant": tags["50"], "beneficiary": tags["59"],
        "amount": amount, "stated_rules": tags["40E"], "available_with_by": tags["41D"],
        "document_terms": tags.get("46A", ""), "confirmation_instruction": tags["49"],
    }


def _iso(raw):
    if "<!" in raw or "<?" in re.sub(r"^<\?xml [^?]*\?>", "", raw, count=1):
        raise ValueError("DTD, entities, comments and processing instructions are unsupported.")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise ValueError("Malformed XML.") from None
    ns = "{%s}" % NS
    if root.tag != ns + "Document":
        raise ValueError("Expected the exact pacs.008.001.08 Document namespace.")
    nodes = list(root.iter())
    if len(nodes) > 240 or any(not x.tag.startswith(ns) for x in nodes):
        raise ValueError("Unsupported XML namespace or document complexity.")
    def child(node, key):
        matches = node.findall(ns + key)
        if len(matches) != 1:
            raise ValueError("Expected exactly one %s." % key)
        return matches[0]
    def scalar(node, key, limit=35):
        el = child(node, key)
        v = (el.text or "").strip()
        if len(el) or not 0 < len(v) <= limit:
            raise ValueError("Invalid %s." % key)
        return v
    if len(root) != 1:
        raise ValueError("One message per document is required.")
    message = child(root, "FIToFICstmrCdtTrf")
    grp = child(message, "GrpHdr")
    if scalar(grp, "NbOfTxs") != "1":
        raise ValueError("Only a single transfer is supported.")
    tx = child(message, "CdtTrfTxInf")
    instru_amount = child(tx, "IntrBkSttlmAmt")
    if len(instru_amount):
        raise ValueError("Invalid settlement amount.")
    amount = _exact_amount(instru_amount.get("Ccy"), (instru_amount.text or "").strip())
    return {"message_reference": scalar(grp, "MsgId"), "end_to_end_id": scalar(child(tx, "PmtId"), "EndToEndId"),
            "interbank_settlement_amount": amount}


def parse_message(kind, raw):
    if kind not in KINDS:
        raise ValueError("Supported kinds: mt700, pacs.008.001.08.")
    if not isinstance(raw, str) or not raw.strip() or len(raw) > LIMIT:
        raise ValueError("Expected non-empty message text, up to 32 KiB.")
    try:
        data = raw.encode("utf-8")
    except UnicodeError:
        raise ValueError("Message must be valid UTF-8.") from None
    if len(data) > LIMIT or any(ord(c) < 32 and c not in "\t\n\r" for c in raw):
        raise ValueError("Oversized message or illegal control character.")
    is_mt = kind == "mt700"
    return {
        "kind": kind, "profile": "clearline-sandbox-v1", "simulation": True,
        "authenticated": False, "effect": "none", "sha256": hashlib.sha256(data).hexdigest(),
        "interpretation": "credit_terms_preview" if is_mt else "payment_instruction_preview",
        "fields": _mt(raw) if is_mt else _iso(raw),
        "warnings": [
            "Unverified operator input; not executable and not standards-certified.",
            ("Selected tag-body profile, dates assumed 2000-2099; not evidence of issuance."
             if is_mt else "Selected fields only; no XSD/market-practice validation. Not LC issuance or beneficiary credit."),
        ],
    }
