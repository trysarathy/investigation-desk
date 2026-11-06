"""No-login, disposable synthetic demonstration. Never opens an existing database.
Run from repository root: python3 funding-replay/tools/run_guest_demo.py
Visitors share fictional cases until this process stops. No live connectors.
"""
import argparse
import os
import re
from pathlib import Path
import secrets
import sys
import tempfile
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pilot import auth, cli, db, server

NOTICE = ('Shared fictional demo — changes are visible to other visitors and reset when '
          'this demo stops. Do not enter real customer data. No live payments.')


class GuestHandler(server.Handler):
    def _api(self, method, path):
        if method == 'GET' and path == '/api/me' and self._user(required=False) is None:
            token, csrf, user = auth.login(self.conn, 'operator@harbourline.test', 'pilot-dev-operator')
            org = db.one(self.conn, 'SELECT id, name FROM orgs WHERE id=?', (user['org_id'],))
            return self._json(200, self._me(user, org, csrf),
                              {'Set-Cookie': self._session_cookie(token)})
        return super()._api(method, path)

    def _me(self, user, org, csrf):
        result = super()._me(user, org, csrf)
        result['env'] = 'shared disposable demo'
        return result

    def _send(self, status, body, content_type, *args, **kwargs):
        if content_type.startswith('text/html') and isinstance(body, bytes):
            body = re.sub(br'(<body[^>]*>)', lambda m: m.group(0) + ('<p class="pd-banner" role="note">' + NOTICE + '</p>').encode(), body, count=1)
        return super()._send(status, body, content_type, *args, **kwargs)


def make_guest_server(folder, port=8766):
    # A caller cannot use this to expose an existing pilot database.
    folder = Path(folder)
    path = folder / 'guest.sqlite'
    if any(folder.iterdir()):
        raise ValueError('Guest demo requires an empty directory; existing data is never opened.')
    os.environ.update(PILOT_ENV='dev', PILOT_SECRET=secrets.token_hex(32), PILOT_DB=str(path))
    os.environ.pop('PILOT_CLOCK', None)
    os.environ.pop('PILOT_TRADE_BANK_KEYS_JSON', None)
    conn = db.connect(str(path))
    try:
        db.migrate(conn)
        cli.seed(conn)
    finally:
        conn.close()
    srv = ThreadingHTTPServer(('127.0.0.1', port), GuestHandler)
    srv.daemon_threads = True
    srv.db_path = str(path)
    srv.static_dir = server.STATIC_DIR
    return srv


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='clearline-guest-') as folder:
        srv = make_guest_server(folder, args.port)
        print(NOTICE, flush=True)
        print('Open forwarded port %d. No email or password required.' % args.port, flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            srv.server_close()


if __name__ == '__main__':
    main()
