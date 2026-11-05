"""Command line: python3 -m pilot.cli migrate|seed|create-org|create-user|serve|check|backup|restore."""

import argparse
import getpass
import logging
import os
import secrets
import sys

import json

from . import auth, commands, db, domain
from . import money as M

SEED_ORGS = [
    {"id": "ORG-HL", "name": "Harbourline Payments (Synthetic)",
     "users": [("operator@harbourline.test", "Olivia Tan", "operator"),
               ("reviewer@harbourline.test", "Ravi Menon", "reviewer"),
               ("reviewer2@harbourline.test", "Grace Okafor", "reviewer"),
               ("viewer@harbourline.test", "Vera Lim", "viewer")],
     "facility": {"id": "FAC-HL-01", "name": "Supplier payment advance (Synthetic)", "currency": "SGD",
                  "limit_minor": 50000000, "funding_account_start_minor": 60000000, "fee_flat_minor": 15000,
                  "policy_version": "POL-HL v2026.12-1"}},
    {"id": "ORG-MR", "name": "Meridian Remit (Synthetic)",
     "users": [("operator@meridian.test", "Marcus Hale", "operator"),
               ("reviewer@meridian.test", "Nadia Rahman", "reviewer")],
     "facility": {"id": "FAC-MR-01", "name": "Supplier payment advance (Synthetic)", "currency": "SGD",
                  "limit_minor": 30000000, "funding_account_start_minor": 35000000, "fee_flat_minor": 12000,
                  "policy_version": "POL-MR v2026.12-1"}},
]


def _conn(args):
    return db.connect(args.db)


TERMS = ("name", "currency", "limit_minor", "fee_flat_minor", "fee_bps", "allocation", "status", "suspension_policy",
         "policy_version", "funding_account_start_minor", "balance_max_age_hours", "repayment_days",
         "reservation_hours", "payout_lead_hours", "required_evidence")


class CliError(Exception):
    pass


def facility_terms(row):
    return {k: row[k] for k in TERMS}


def record_facility_version(conn, fac_id, changed_by):
    row = db.one(conn, "SELECT * FROM facilities WHERE id=?", (fac_id,))
    cur = conn.execute("INSERT INTO facility_versions(facility_id, org_id, policy_version, terms, changed_at, changed_by) "
                       "VALUES (?,?,?,?,?,?)", (fac_id, row["org_id"], row["policy_version"],
                                                json.dumps(facility_terms(row), sort_keys=True), db.now_iso(),
                                                changed_by))
    return cur.lastrowid


def _check_required_evidence(value):
    kinds = [k.strip() for k in str(value).split(",") if k.strip()]
    bad = [k for k in kinds if k not in domain.OBS_KINDS]
    if bad:
        raise CliError("Unknown evidence kind(s) %s; use %s." % (", ".join(bad), ", ".join(domain.OBS_KINDS)))
    return ",".join(dict.fromkeys(kinds))


def create_facility(conn, org_id, f, changed_by="cli create-facility"):
    conn.execute(
        "INSERT INTO facilities(id, org_id, name, currency, limit_minor, fee_flat_minor, fee_bps, allocation, status, "
        "suspension_policy, policy_version, funding_account_start_minor, balance_max_age_hours, repayment_days, "
        "reservation_hours, payout_lead_hours, required_evidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (f["id"], org_id, f["name"], f["currency"], f["limit_minor"], f.get("fee_flat_minor", 0), f.get("fee_bps", 0),
         f.get("allocation", "fees_first"), f.get("status", "active"), f.get("suspension_policy", "unset"),
         f["policy_version"], f["funding_account_start_minor"], f.get("balance_max_age_hours", 24),
         f.get("repayment_days", 3), f.get("reservation_hours", 72), f.get("payout_lead_hours", 8),
         _check_required_evidence(f.get("required_evidence", "balance"))))
    return record_facility_version(conn, f["id"], changed_by)


_INT_OPTS = (("fee_bps", "fee_bps"), ("balance_max_age_hours", "balance_max_age_hours"),
             ("repayment_days", "repayment_days"), ("reservation_hours", "reservation_hours"),
             ("payout_lead_hours", "payout_lead_hours"))


def facility_fields(args, currency):
    """argparse namespace -> facility column dict (only options that were given). Money parsed exactly."""
    out = {}
    for opt, col in (("limit", "limit_minor"), ("fee_flat", "fee_flat_minor"), ("funding_cash", "funding_account_start_minor")):
        v = getattr(args, opt, None)
        if v is not None:
            try:
                out[col] = M.parse(v, currency, allow_zero=True).minor
            except M.MoneyError as e:
                raise CliError("--%s: %s" % (opt.replace("_", "-"), e))
    for opt, col in _INT_OPTS:
        v = getattr(args, opt, None)
        if v is not None:
            if v < 0 or (col in ("reservation_hours", "balance_max_age_hours") and v == 0):
                raise CliError("--%s must be a positive whole number." % opt.replace("_", "-"))
            out[col] = v
    for opt in ("name", "allocation", "suspension_policy", "status", "policy_version"):
        v = getattr(args, opt, None)
        if v is not None:
            out[opt] = v
    if getattr(args, "required_evidence", None) is not None:
        out["required_evidence"] = _check_required_evidence(args.required_evidence)
    return out


def cli_create_facility(conn, args):
    try:
        M.check_currency(args.currency)
    except M.MoneyError as e:
        raise CliError("--currency: %s" % e)
    if not db.one(conn, "SELECT id FROM orgs WHERE id=?", (args.org,)):
        raise CliError("Unknown org %s." % args.org)
    if db.one(conn, "SELECT id FROM facilities WHERE id=?", (args.id,)):
        raise CliError("Facility %s already exists; use update-facility." % args.id)
    f = facility_fields(args, args.currency)
    f.update(id=args.id, currency=args.currency)
    with db.tx(conn):
        vid = create_facility(conn, args.org, f, changed_by=args.by or "cli create-facility")
    return vid


def cli_update_facility(conn, args):
    fac = db.one(conn, "SELECT * FROM facilities WHERE id=?", (args.id,))
    if not fac:
        raise CliError("Unknown facility %s." % args.id)
    if not args.policy_version:
        raise CliError("Every facility change needs a new --policy-version.")
    if args.policy_version == fac["policy_version"] or db.one(
            conn, "SELECT id FROM facility_versions WHERE facility_id=? AND policy_version=?", (args.id, args.policy_version)):
        raise CliError("Policy version %r was already used for %s; give a new one." % (args.policy_version, args.id))
    f = facility_fields(args, fac["currency"])
    changes = {k: v for k, v in f.items() if k != "policy_version" and fac.get(k) != v}
    if not changes:
        raise CliError("No term changes given; nothing to version.")
    f = dict(changes, policy_version=args.policy_version)
    names = sorted(f)
    with db.tx(conn):
        conn.execute("UPDATE facilities SET %s WHERE id=?" % ", ".join("%s=?" % n for n in names),
                     [f[n] for n in names] + [args.id])
        vid = record_facility_version(conn, args.id, args.by or "cli update-facility")
        problems = [p for p in check(conn) if p.startswith("facility %s" % args.id)]
        if problems:
            raise CliError("Refused: %s" % "; ".join(problems))
    return vid, sorted(changes)


def seed(conn, synthetic=False):
    """Create the synthetic orgs, users and facilities (no cases). Idempotent. Returns created emails."""
    env = commands.env()
    if env == "pilot" and not synthetic:
        raise SystemExit("Refusing to seed synthetic users in PILOT_ENV=pilot without --synthetic.")
    created = []
    db.migrate(conn)
    with db.tx(conn):
        for o in SEED_ORGS:
            if not db.one(conn, "SELECT id FROM orgs WHERE id=?", (o["id"],)):
                auth.create_org(conn, o["id"], o["name"])
            if not db.one(conn, "SELECT id FROM facilities WHERE id=?", (o["facility"]["id"],)):
                create_facility(conn, o["id"], o["facility"])
            for email, name, role in o["users"]:
                if db.one(conn, "SELECT id FROM users WHERE email=?", (email,)):
                    continue
                if env in ("dev", "test"):
                    pw = "pilot-dev-%s" % role
                else:
                    pw = secrets.token_urlsafe(18)
                    print("%s initial password: %s" % (email, pw))
                auth.create_user(conn, o["id"], email, name, role, pw)
                created.append(email)
    return created


def list_facilities(conn, org=None):
    rows = db.all_rows(conn, "SELECT * FROM facilities %s ORDER BY org_id, id" % ("WHERE org_id=?" if org else ""),
                       (org,) if org else ())
    out = []
    for f in rows:
        s = commands.facility_summary(conn, f)
        s["org_id"] = f["org_id"]
        s["versions"] = [dict(v, terms=json.loads(v["terms"])) for v in db.all_rows(
            conn, "SELECT id, policy_version, terms, changed_at, changed_by FROM facility_versions WHERE facility_id=? "
                  "ORDER BY id", (f["id"],))]
        out.append(s)
    return out


def list_users(conn, org=None):
    return db.all_rows(conn, "SELECT id, org_id, email, name, role, disabled, created_at FROM users %s ORDER BY org_id, "
                             "email" % ("WHERE org_id=?" if org else ""), (org,) if org else ())


def disable_user(conn, email):
    email = auth.normalize_email(email)
    u = db.one(conn, "SELECT id FROM users WHERE email=?", (email,))
    if not u:
        raise CliError("No user with email %s." % email)
    with db.tx(conn):
        conn.execute("UPDATE users SET disabled=1 WHERE id=?", (u["id"],))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (u["id"],))
    return u["id"]


def check(conn):
    """Integrity check + identities across every facility and case. Returns list of problems."""
    problems = []
    r = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if r != "ok":
        problems.append("integrity_check: %s" % r)
    files = [v for v, _ in db.migration_files()]
    missing = sorted(set(files) - set(db.applied_migrations(conn)))
    if missing:
        problems.append("pending migrations: %s" % ", ".join(missing))
    for fac in db.all_rows(conn, "SELECT * FROM facilities"):
        fi = domain.facility_identity(fac, commands.table_totals(conn, fac["id"]), commands.event_totals(conn, fac))
        if not fi["ok"]:
            problems.append("facility %s: %s" % (fac["id"], fi["name"]))
    for case in db.all_rows(conn, "SELECT * FROM cases"):
        st = commands.build_state(conn, case)
        draw = db.one(conn, "SELECT * FROM draws WHERE case_id=?", (case["id"],))
        for i in domain.case_identities(st, draw):
            if not i["ok"]:
                problems.append("case %s: %s" % (case["id"], i["name"]))
    return problems


def main(argv=None):
    logging.basicConfig(level=os.environ.get("PILOT_LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    ap = argparse.ArgumentParser(prog="python3 -m pilot.cli")
    ap.add_argument("--db", default=None, help="SQLite file (default: $PILOT_DB)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    sp = sub.add_parser("seed")
    sp.add_argument("--synthetic", action="store_true")
    sp = sub.add_parser("create-org")
    sp.add_argument("--id", default=None)
    sp.add_argument("--name", required=True)
    sp = sub.add_parser("create-user")
    sp.add_argument("--org", required=True)
    sp.add_argument("--email", required=True)
    sp.add_argument("--name", required=True)
    sp.add_argument("--role", required=True, choices=auth.ROLES)
    sp.add_argument("--password-env", default="PILOT_NEW_PASSWORD",
                    help="environment variable holding the password (else prompt)")
    sp = sub.add_parser("serve")
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8765)
    sub.add_parser("check")
    for name in ("create-facility", "update-facility"):
        sp = sub.add_parser(name)
        create = name == "create-facility"
        if create:
            sp.add_argument("--org", required=True)
        sp.add_argument("--id", required=True)
        sp.add_argument("--name", required=create)
        if create:
            sp.add_argument("--currency", required=True)
        sp.add_argument("--limit", required=create, help="exact amount, e.g. 120,000.00")
        sp.add_argument("--fee-flat", dest="fee_flat", default="0" if create else None)
        sp.add_argument("--fee-bps", dest="fee_bps", type=int, default=0 if create else None)
        sp.add_argument("--allocation", choices=("fees_first", "principal_first"),
                        default="fees_first" if create else None)
        sp.add_argument("--funding-cash", dest="funding_cash", required=create)
        sp.add_argument("--policy-version", dest="policy_version", required=True)
        sp.add_argument("--required-evidence", dest="required_evidence", default="balance" if create else None,
                        help="comma list of observation kinds, e.g. invoice,balance")
        sp.add_argument("--balance-max-age-hours", dest="balance_max_age_hours", type=int)
        sp.add_argument("--repayment-days", dest="repayment_days", type=int)
        sp.add_argument("--reservation-hours", dest="reservation_hours", type=int)
        sp.add_argument("--payout-lead-hours", dest="payout_lead_hours", type=int)
        sp.add_argument("--suspension-policy", dest="suspension_policy",
                        choices=("block_draws", "honour_existing", "unset"))
        if not create:
            sp.add_argument("--status", choices=("active", "suspended"))
        sp.add_argument("--by", default=None, help="who made the change (recorded in facility_versions)")
    sp = sub.add_parser("list-facilities")
    sp.add_argument("--org", default=None)
    sp = sub.add_parser("list-users")
    sp.add_argument("--org", default=None)
    sp = sub.add_parser("disable-user")
    sp.add_argument("--email", required=True)
    sp = sub.add_parser("backup")
    sp.add_argument("dest")
    sp = sub.add_parser("restore")
    sp.add_argument("src")
    args = ap.parse_args(argv)
    try:
        path = db.db_path(args.db)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2

    if args.cmd in ("backup", "restore"):
        try:
            from . import ops
        except ImportError:
            print("Backup/restore module (pilot.ops) is not installed.", file=sys.stderr)
            return 2
        try:
            out = ops.backup(path, args.dest) if args.cmd == "backup" else ops.restore(args.src, path)
        except (ops.OpsError, OSError) as e:
            print("%s refused: %s" % (args.cmd, e), file=sys.stderr)
            return 1
        print(out)
        return 0
    if args.cmd == "serve":
        if commands.env() == "pilot" and not os.environ.get("PILOT_SECRET"):
            print("PILOT_SECRET is required in PILOT_ENV=pilot.", file=sys.stderr)
            return 2
        from . import server
        server.run(path, args.host, args.port)
        return 0
    conn = db.connect(path)
    try:
        if args.cmd == "migrate":
            done = db.migrate(conn)
            print("applied: %s" % (", ".join(done) or "nothing (up to date)"))
        elif args.cmd == "seed":
            created = seed(conn, args.synthetic)
            print("seeded users: %d (no cases created)" % len(created))
        elif args.cmd == "create-org":
            db.migrate(conn)
            oid = args.id or "ORG-" + secrets.token_hex(3).upper()
            with db.tx(conn):
                auth.create_org(conn, oid, args.name)
            print(oid)
        elif args.cmd == "create-user":
            db.migrate(conn)
            pw = os.environ.get(args.password_env) or getpass.getpass("Password: ")
            with db.tx(conn):
                uid = auth.create_user(conn, args.org, args.email, args.name, args.role, pw)
            print("user id %d" % uid)
        elif args.cmd in ("create-facility", "update-facility", "list-facilities", "list-users", "disable-user"):
            db.migrate(conn)
            try:
                if args.cmd == "create-facility":
                    vid = cli_create_facility(conn, args)
                    print("facility %s created (policy %s, version record %d)" % (args.id, args.policy_version, vid))
                elif args.cmd == "update-facility":
                    vid, changed = cli_update_facility(conn, args)
                    print("facility %s updated: %s (policy %s, version record %d)" % (
                        args.id, ", ".join(changed), args.policy_version, vid))
                elif args.cmd == "list-facilities":
                    print(json.dumps(list_facilities(conn, args.org), indent=2, sort_keys=True))
                elif args.cmd == "list-users":
                    for u in list_users(conn, args.org):
                        print("%s\t%s\t%s\t%s\t%s" % (u["id"], u["org_id"], u["email"], u["role"],
                                                       "disabled" if u["disabled"] else "active"))
                else:
                    uid = disable_user(conn, args.email)
                    print("user id %d disabled; sessions ended" % uid)
            except CliError as e:
                print(str(e), file=sys.stderr)
                return 1
        elif args.cmd == "check":
            db.migrate(conn)
            problems = check(conn)
            for p in problems:
                print("FAIL %s" % p)
            print("check: %s" % ("ok" if not problems else "%d problem(s)" % len(problems)))
            return 1 if problems else 0
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
