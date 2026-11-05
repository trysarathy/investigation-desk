"""A bank-local examination planning aid, never a compliance determination.

Sources: ICC UCP 600 articles 2, 14(b), 16(b)/(d);
https://library.iccwbo.org/content/tfb/RULES/tfb-ucp600-rules.htm .
The reviewer supplies this bank's operative presentation time and its actual
open/closed dates. Another bank/place may have a different receipt and calendar.
No holiday inference, notice dispatch, automated refusal or credit amendment.
"""
from datetime import date, datetime, time, timedelta, timezone
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

INPUT_KEYS = {"bank_place", "timezone", "presented_at", "calendar", "close_times", "waiver_requested"}


def _date_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Dates must use YYYY-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError("Invalid calendar date.") from None


def _close_clock(day, value, zone):
    # Require one real local instant: local times may be absent or repeated at DST.
    hh, mm = map(int, value.split(":"))
    wall = datetime.combine(day, time(hh, mm))
    values = []
    for fold in (0, 1):
        instant = wall.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
        if instant.astimezone(zone).replace(tzinfo=None) == wall and instant not in values:
            values.append(instant)
    return values[0] if len(values) == 1 else None


def preview_calendar(payload):
    if not isinstance(payload, dict) or payload.keys() - INPUT_KEYS:
        raise ValueError("Expected only bank_place, timezone, presented_at, calendar, close_times and waiver_requested.")
    place, zone_name = payload.get("bank_place"), payload.get("timezone")
    if not isinstance(place, str) or not (0 < len(place.strip()) <= 160) or any(ord(c) < 32 for c in place):
        raise ValueError("Supply a bank place of presentation.")
    if not isinstance(zone_name, str) or not zone_name or len(zone_name) > 100:
        raise ValueError("Supply an IANA time zone.")
    try:
        zone = ZoneInfo(zone_name)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Unknown or invalid IANA time zone.") from None
    raw_time = payload.get("presented_at")
    if not isinstance(raw_time, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,6})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})", raw_time):
        raise ValueError("presented_at requires an ISO instant with offset.")
    try:
        received = datetime.fromisoformat(raw_time.replace("Z", "+00:00")).astimezone(zone)
    except (ValueError, OverflowError):
        raise ValueError("Invalid presentation instant.") from None
    coverage, closings = payload.get("calendar"), payload.get("close_times", {})
    if not isinstance(coverage, dict) or not isinstance(closings, dict) or max(len(coverage), len(closings)) > 400:
        raise ValueError("Use date maps, up to 400 days.")
    for key, is_open in coverage.items():
        _date_key(key)
        if type(is_open) is not bool:
            raise ValueError("Coverage must explicitly declare each date true or false.")
    for key, value in closings.items():
        if coverage.get(key) is not True or not isinstance(value, str) or not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value):
            raise ValueError("Closing times must be HH:MM on declared open dates.")
    waiver = payload.get("waiver_requested", False)
    if type(waiver) is not bool:
        raise ValueError("waiver_requested must be a boolean.")
    day = received.date()
    result = {
        "simulation": True, "effect": "none", "status": "needs_review",
        "bank_place": place.strip(), "timezone": zone_name, "presentation_local": received.isoformat(),
        "banking_days": [], "fifth_banking_date": None, "deadline_local": None,
        "deadline_utc": None, "missing_date": None, "waiver_requested": waiver,
        "waiver_extends_window": False, "reason": "",
        "scope": "Bank-local preview under an assumed unmodified UCP 600 profile. Verify operative receipt, applicable terms, bank hours and place; no notice is sent.",
    }
    if coverage.get(day.isoformat()) is not True:
        result["reason"] = "Opening on the asserted local presentation date is not established."
        result["missing_date"] = day.isoformat() if day.isoformat() not in coverage else None
        return result
    if day.isoformat() in closings:
        received_close = _close_clock(day, closings[day.isoformat()], zone)
        if received_close is None or received.astimezone(timezone.utc) >= received_close:
            result["reason"] = "Asserted receipt is at/after or cannot be compared with the stated close; confirm operative presentation."
            return result
    while len(result["banking_days"]) < 5:
        if day == date.max:
            result["reason"] = "Date range exhausted."
            return result
        day += timedelta(days=1)
        key = day.isoformat()
        if key not in coverage:
            result.update(missing_date=key, reason="Calendar coverage is incomplete before the fifth banking day.")
            return result
        if coverage[key]:
            result["banking_days"].append(key)
    result["fifth_banking_date"] = key
    if key not in closings:
        result["reason"] = "Fifth banking date known; local close not supplied. Do not infer a timestamp."
        return result
    utc_close = _close_clock(day, closings[key], zone)
    if utc_close is None:
        result["reason"] = "Fifth-day close is ambiguous or nonexistent in the stated time zone."
        return result
    result.update(status="planned", reason="Fifth declared banking-day close; manual confirmation required.",
                  deadline_utc=utc_close.isoformat().replace("+00:00", "Z"),
                  deadline_local=utc_close.astimezone(zone).isoformat())
    return result
