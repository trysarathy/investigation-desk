import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import http.cookiejar
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('guest_demo', ROOT / 'tools/run_guest_demo.py')
guest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guest)


class GuestDemoTest(unittest.TestCase):
    def test_direct_entry_session_queue_and_csrf(self):
        with patch.dict(os.environ), tempfile.TemporaryDirectory() as folder:
            srv = guest.make_guest_server(folder, 0)
            thread = threading.Thread(target=srv.serve_forever, daemon=True)
            thread.start()
            try:
                base = 'http://127.0.0.1:%d' % srv.server_port
                opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                html = opener.open(base + '/').read().decode()
                self.assertIn(guest.NOTICE, html)
                me = json.load(opener.open(base + '/api/me'))
                self.assertEqual(me['user']['role'], 'operator')
                self.assertTrue(me['csrf'])
                self.assertEqual(json.load(opener.open(base + '/api/me'))['csrf'], me['csrf'])
                self.assertEqual(opener.open(base + '/api/cases').status, 200)
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    opener.open(urllib.request.Request(base + '/api/logout', data=b'{}', headers={'Content-Type': 'application/json'}))
                self.assertEqual(caught.exception.code, 403)
            finally:
                srv.shutdown()
                srv.server_close()
                thread.join()

    def test_refuses_existing_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'existing.sqlite').write_text('preserve')
            with self.assertRaises(ValueError):
                guest.make_guest_server(folder, 0)
            self.assertEqual((Path(folder) / 'existing.sqlite').read_text(), 'preserve')

    def test_normal_server_still_requires_login(self):
        with patch.dict(os.environ), tempfile.TemporaryDirectory() as folder:
            initial = guest.make_guest_server(folder, 0)
            path = initial.db_path
            initial.server_close()
            srv, thread = guest.server.serve_in_thread(path)
            try:
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen('http://127.0.0.1:%d/api/me' % srv.server_port)
                self.assertEqual(caught.exception.code, 401)
            finally:
                srv.shutdown()
                srv.server_close()
                thread.join()
