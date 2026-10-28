"""Lead score 0-100 = fit (0-40) + evidence (0-30) + reachability (0-15) + engagement (0-15).

Fit: BUYER that receives stablecoins directly scores highest; vendors are useful for insight only.
Evidence: a dated, sourced reason to believe they handle USDT/USDC, recent first line.
Reachability: a named person with a verified email beats a shared inbox; LinkedIn-only scores low.
Engagement: replies and calls (from Touches/Calls) move a lead up.
Tier: 1 = score >=70, 2 = 50-69, 3 = below 50.
"""
from __future__ import annotations

import re

from .model import ROLE_LOCALS, SUPPORT_LOCALS, email_local

GATEWAY_HINTS = ("via gateway", "not direct", "converts", "local currency")
LARGE_HINTS = ("large listed", "large company", "large exchange", "low reply odds")
# Evidence that doesn't actually show stablecoin receipt: the lead can't be Tier 1 on it.
WEAK_EVIDENCE_HINTS = ("no public evidence", "acceptance not confirmed", "not named", "evidence weak",
                       "evidence from third-party", "evidence is outbound", "no page states", "confirm whether it receives")


def is_personal(email: str, contact_name: str) -> bool:
    """True when the address belongs to the named person (their name appears in it)."""
    local = email_local(email)
    if not local or local in ROLE_LOCALS or local in SUPPORT_LOCALS:
        return False
    parts = [p.lower() for p in re.split(r"[^A-Za-z]+", contact_name or "") if len(p) >= 3]
    return any(p in local for p in parts) or (len(parts) >= 2 and local[:1] == parts[0][:1] and parts[-1] in local)


def score(lead: dict, engagement: str = "") -> int:
    bv = (lead.get("buyer_or_vendor") or "").upper()
    notes = (lead.get("check_before_sending") or "").lower()
    fit = 30 if bv == "BUYER" else 12
    if bv == "BUYER" and not any(h in notes for h in GATEWAY_HINTS):
        fit += 10  # paid directly into their own wallet: the core gap Clearline fills
    if any(h in notes for h in LARGE_HINTS):
        fit -= 8

    evidence = 0
    weak = any(h in notes for h in WEAK_EVIDENCE_HINTS)
    if (lead.get("evidence_url") or "").startswith("http") and not weak:
        evidence += 15
    if (lead.get("first_line_source") or "").startswith("http"):
        evidence += 8
    if "older than 12 months" not in notes and "not confirmed" not in notes:
        evidence += 7

    email = lead.get("email") or ""
    local = email_local(email)
    label = (lead.get("email_label") or "").upper()
    if email and label.startswith("VERIFIED") and is_personal(email, lead.get("contact_name", "")):
        reach = 15
    elif email and label.startswith("VERIFIED") and local not in SUPPORT_LOCALS:
        reach = 9
    elif lead.get("linkedin_person"):
        reach = 6
    elif email:
        reach = 4
    else:
        reach = 2

    eng = {"call held": 15, "call booked": 13, "replied": 10, "positive": 12}.get(engagement.lower(), 0)
    return max(0, min(100, fit + evidence + reach + eng))


def tier(s: int) -> str:
    return "1" if s >= 70 else ("2" if s >= 50 else "3")
