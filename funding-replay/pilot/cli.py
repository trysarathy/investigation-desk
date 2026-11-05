"""Command line: python3 -m pilot.cli migrate|seed|create-org|create-user|serve|check|backup|restore."""

import argparse
import getpass
import logging
import os
import secrets
import sys

from . import auth, commands, db, domain

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


def create_facility(conn, org_id, f):
    conn.execute(
        "INSERT INTO facilities(id, org_id, name, currency, limit_minor, fee_flat_minor, fee_bps, allocation, status, "
        "suspension_policy, policy_version, funding_account_start_minor, balance_max_age_hours, repayment_days, "
        "reservation_hours, payout_lead_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (f["id"], org_id, f["name"], f["currency"], f["limit_minor"], f.get("fee_flat_minor", 0), f.get("fee_bps", 0),
         f.get("allocation", "fees_first"), f.get("status", "active"), f.get("suspension_policy", "unset"),
         f["policy_version"], f["funding_account_start_minor"], f.get("balance_max_age_hours", 24),
         f.get("repayment_days", 3), f.get("reservation_hours", 72), f.get("payout_lead_hours", 8)))


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
