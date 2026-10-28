"""Merge and dedupe lead files by email AND company domain.

Rule: one row per company domain (one person per company first). If two rows share a domain, keep
the higher-priority one and fill its blank fields from the other. Rows already in `existing` are
dropped from `incoming` (by email or domain) and reported, never overwritten.
"""
from __future__ import annotations

from .model import domain_of


def key_domain(r: dict) -> str:
    return (r.get("domain") or domain_of(r.get("website", "")) or domain_of(r.get("email", ""))).lower()


def _prio(r: dict) -> int:
    try:
        return int(str(r.get("priority") or "0")[:1])
    except ValueError:
        return 0


def dedupe(rows: list[dict]) -> tuple[list[dict], list[tuple[str, str]]]:
    kept: dict[str, dict] = {}
    dropped: list[tuple[str, str]] = []
    no_domain: list[dict] = []
    for r in rows:
        d = key_domain(r)
        r = dict(r)
        r["domain"] = d
        if not d:
            no_domain.append(r)
            continue
        if d in kept:
            a, b = (r, kept[d]) if _prio(r) > _prio(kept[d]) else (kept[d], r)
            for k, v in b.items():
                if not a.get(k) and v:
                    a[k] = v
            kept[d] = a
            dropped.append((b.get("company", ""), f"duplicate domain {d}"))
        else:
            kept[d] = r
    # rows without a domain: dedupe by company name
    seen = {(r.get("company") or "").strip().lower() for r in kept.values()}
    for r in no_domain:
        n = (r.get("company") or "").strip().lower()
        if n in seen:
            dropped.append((r.get("company", ""), "duplicate company name"))
        else:
            seen.add(n)
            kept[f"name:{n}"] = r
    return list(kept.values()), dropped


def merge_new(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], list[tuple[str, str]]]:
    ex_emails = {(r.get("email") or "").lower() for r in existing if r.get("email")}
    ex_domains = {key_domain(r) for r in existing} - {""}
    ex_names = {(r.get("company") or "").strip().lower() for r in existing}
    fresh, dropped = [], []
    for r in incoming:
        e = (r.get("email") or "").lower()
        d = key_domain(r)
        n = (r.get("company") or "").strip().lower()
        if (e and e in ex_emails) or (d and d in ex_domains) or (not d and n in ex_names):
            dropped.append((r.get("company", ""), "already in Master"))
        else:
            fresh.append(r)
    fresh, dups = dedupe(fresh)
    return fresh, dropped + dups
