"""Shared data model for Clearline GTM OS.

Every script reads the Master Sheet as CSV exports (one file per tab) so the same rules run
whether the data came from Google Sheets, Apollo or a local file. Column names match the Sheet.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

STAGES = [
    "Mapped", "Researched", "Approved", "In sequence", "Replied", "Call booked", "Call held",
    "Strong", "Weak", "None", "Design partner", "Paying", "Do not contact",
]

LEAD_COLS = [
    "id", "tier", "score", "stage", "priority", "company", "domain", "country", "region", "segment",
    "buyer_or_vendor", "website", "evidence_url", "contact_name", "contact_role", "email", "email_label",
    "linkedin_person", "channel", "first_line", "first_line_source", "first_line_date", "compliance_note",
    "check_before_sending", "last_touch", "next_action", "next_action_date", "notes",
]
TOUCH_COLS = [
    "date", "lead_id", "company", "domain", "email", "channel", "step", "subject", "status",
    "thread_id", "approved", "notes",
]
DNC_COLS = ["value", "kind", "reason", "date"]
QUEUE_COLS = [
    "queue_date", "lead_id", "company", "contact_name", "email", "step", "subject", "body",
    "first_line_source", "guard", "guard_reasons", "needs_approval", "APPROVE", "edited_body", "status",
]
LOG_COLS = ["timestamp", "agent", "action", "lead_id", "details"]

# Countries where first contact goes through LinkedIn or an introduction, never cold email.
# Source: per-region compliance notes in the lead research (see README "Compliance").
STRICT_COUNTRIES = {
    "germany", "austria", "italy", "spain", "netherlands", "vietnam", "south korea", "colombia",
    "south africa",
}
ROLE_LOCALS = {
    "info", "hello", "contact", "sales", "partners", "partnership", "partnerships", "team", "admin",
    "bd", "business", "press", "pr", "media", "marketing", "office", "finance", "accounts", "billing",
    "payments", "ops", "enquiries", "inquiries", "events", "tickets", "mail", "bookings", "ir",
    "collaboration", "payables",
}
SUPPORT_LOCALS = {"support", "help", "service", "cs", "helpdesk"}
SENDABLE_LABELS = {"VERIFIED-PUBLIC", "VERIFIED-TOOL"}


def read_csv(path: str | Path) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    with p.open(newline="", encoding="utf-8") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def write_csv(path: str | Path, rows: list[dict], cols: list[str]) -> None:
    with Path(path).open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def to_csv_text(rows: list[dict], cols: list[str]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in cols})
    return buf.getvalue()


def parse_date(s: str | None) -> date | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[: len(fmt) + 2].strip(), fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def domain_of(value: str) -> str:
    """Company domain from an email or a website, lower-case, without www."""
    v = (value or "").strip().lower()
    if not v:
        return ""
    if "@" in v and "/" not in v:
        v = v.split("@", 1)[1]
    v = re.sub(r"^[a-z]+://", "", v)
    v = v.split("/", 1)[0].split("?", 1)[0]
    return v[4:] if v.startswith("www.") else v


def email_local(email: str) -> str:
    return (email or "").split("@", 1)[0].strip().lower()


def truthy(v) -> bool:
    return str(v).strip().lower() in {"true", "yes", "1", "y", "on", "x", "✓", "✔"}


@dataclass
class Settings:
    pause: bool = False
    autonomy_level: int = 1
    daily_cap: int = 30
    current_send_cap: int = 5
    similar_30d_cap: int = 1000
    same_company_days: int = 7
    postal_address: str = ""
    booking_link: str = ""

    @property
    def effective_daily_cap(self) -> int:
        return max(0, min(self.daily_cap, self.current_send_cap or self.daily_cap))

    @classmethod
    def from_rows(cls, rows: list[dict]) -> "Settings":
        kv = {(r.get("key") or "").strip().upper(): (r.get("value") or "").strip() for r in rows}
        def num(k, d):
            try:
                return int(float(kv.get(k, d)))
            except ValueError:
                return d
        return cls(
            pause=truthy(kv.get("PAUSE", "false")),
            autonomy_level=num("AUTONOMY_LEVEL", 1),
            daily_cap=num("DAILY_CAP", 30),
            current_send_cap=num("CURRENT_SEND_CAP", 5),
            similar_30d_cap=num("SIMILAR_30D_CAP", 1000),
            same_company_days=num("SAME_COMPANY_DAYS", 7),
            postal_address=kv.get("POSTAL_ADDRESS", ""),
            booking_link=kv.get("BOOKING_LINK", ""),
        )
