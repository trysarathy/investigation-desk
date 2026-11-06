import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import lifecycle
from tools.export_mentor import export, mentor_views, JOURNEY


class MentorExportTests(unittest.TestCase):
    def test_export_matches_engine_and_has_no_unrelated_navigation(self):
        views = mentor_views()
        state = lifecycle.initial_state('reference')
        for action in JOURNEY:
            original = lifecycle.view(state)
            rendered = views[original['state_id']]
            for key in original:
                if key != 'actions':
                    self.assertEqual(rendered[key], original[key], key)
            self.assertTrue(all(i['ok'] for i in rendered['invariants']))
            self.assertTrue(all(a['enabled'] and a['next'] in views for a in rendered['actions']))
            state = lifecycle.apply(state, action)
        self.assertEqual(lifecycle.view(state)['exposure']['status'], 'ended')
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(export(folder), 16)
            html = (Path(folder) / 'index.html').read_text()
            for link in ('replay/index.html', 'trade.html', 'records.html'):
                self.assertNotIn(link, html)
            self.assertIn('Simulated', html)
            self.assertFalse((Path(folder) / 'replay').exists())
            meta = (Path(folder) / 'lc-meta.js').read_text()
            self.assertEqual(len(json.loads(meta.removeprefix('window.lcMeta=').strip().rstrip(';'))['cases']), 1)

    def test_supplier_credit_and_customer_receipt_do_not_clear_provider_exposure(self):
        state = lifecycle.initial_state('reference')
        for aid in JOURNEY:
            state = lifecycle.apply(state, aid)
            v = lifecycle.view(state)
            if aid in ('sim_credit', 'sim_receipt', 'sim_pay_partial'):
                self.assertEqual(v['exposure']['amount'], 'SGD 135,532.50')
                self.assertEqual(v['exposure']['status'], 'outstanding')
            if aid == 'sim_credit':
                self.assertEqual(v['facts']['delivery']['status'], 'credited')
        self.assertEqual(v['exposure']['status'], 'ended')

    def test_refusal_is_a_real_engine_state_with_no_funding(self):
        state = lifecycle.apply(lifecycle.initial_state('reference'), 'request_advance')
        state = lifecycle.apply(state, 'decline')
        view = mentor_views()[lifecycle.state_id(state)]
        self.assertEqual(view['actions'], [])
        self.assertEqual(view['facts'], lifecycle.view(state)['facts'])
        self.assertIsNone(view['exposure'])

    def test_does_not_overwrite_an_existing_export(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'keep.txt').write_text('keep')
            with self.assertRaises(ValueError):
                export(folder)
            self.assertEqual((Path(folder) / 'keep.txt').read_text(), 'keep')
