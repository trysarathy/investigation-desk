"""One-command localhost synthetic desk. Never point this launcher at a customer database."""
import argparse
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pilot import cli, db, server

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--directory', type=Path, default=Path.home()/'.clearline-synthetic-desk')
    args = parser.parse_args()
    folder = args.directory.expanduser().resolve()
    os.umask(0o077)
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    marker = folder/'SYNTHETIC-WORKSPACE'
    if not marker.exists() and any(folder.iterdir()):
        parser.error('Use a new directory or a previously initialized synthetic workspace.')
    marker.write_text('Local fictional records only. Never store customer documents here.\n')
    sec = folder/'session-secret'
    if not sec.exists():
        sec.write_text(secrets.token_hex(32))
    os.environ.update(PILOT_ENV='dev', PILOT_DB=str(folder/'desk.sqlite'), PILOT_SECRET=sec.read_text().strip())
    os.environ.pop('PILOT_CLOCK',None)
    os.environ.pop('PILOT_TRADE_BANK_KEYS_JSON',None)
    conn=db.connect()
    try:
        db.migrate(conn)
        cli.seed(conn)
    finally:
        conn.close()
    print('Clearline synthetic desk: http://127.0.0.1:%s/'%args.port, flush=True)
    print('Operator: operator@harbourline.test / pilot-dev-operator')
    print('Reviewer (second browser profile): reviewer@harbourline.test / pilot-dev-reviewer')
    print('Data persists in %s. Press Ctrl+C to stop.'%folder, flush=True)
    server.run(str(folder/'desk.sqlite'),host='127.0.0.1',port=args.port)

if __name__=='__main__':
    main()
