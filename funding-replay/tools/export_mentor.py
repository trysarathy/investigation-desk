"""Export one synthetic funding walkthrough: python3 funding-replay/tools/export_mentor.py OUT.

The lifecycle engine computes every state, amount and refusal. This export only
limits the visible choices to the mentor journey; it does not change decisions.
"""
import argparse
import json
import shutil
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import lifecycle
from tools.export_site import _js, _stamp, source_build_id

JOURNEY = (
    'request_advance', 'approve_reserve', 'draw', 'instruct', 'sim_accept',
    'sim_credit', 'advance_clock', 'advance_clock', 'sim_receipt',
    'sim_pay_partial', 'match_repayment', 'sim_pay_balance', 'match_repayment', 'close',
)


def mentor_views():
    state = lifecycle.initial_state('reference')
    views = {}
    for action_id in JOURNEY:
        view = lifecycle.view(state)
        choices = {action_id}
        if action_id == 'approve_reserve':
            choices.add('decline')
        view['actions'] = [a for a in view['actions'] if a['id'] in choices]
        if {a['id'] for a in view['actions'] if a['enabled']} != choices:
            raise AssertionError('Mentor journey is no longer feasible: ' + action_id)
        if any(not i['ok'] for i in view['invariants']):
            raise AssertionError('Mentor journey failed a reconciliation check')
        views[view['state_id']] = view
        if 'decline' in choices:
            refusal = lifecycle.view(lifecycle.apply(state, 'decline'))
            refusal['actions'] = []
            views[refusal['state_id']] = refusal
        state = lifecycle.apply(state, action_id)
    final = lifecycle.view(state)
    final['actions'] = []
    views[final['state_id']] = final
    for view in views.values():
        for action in view['actions']:
            if action['next'] not in views:
                raise AssertionError('Missing mentor state: ' + action['next'])
    return views


def export(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError('Choose a new or empty output folder.')
    views = mentor_views()
    (out / 'states').mkdir()
    for sid, view in views.items():
        (out / 'states' / ('lc-reference-%s.js' % sid)).write_text(_js(view), encoding='utf8')
    case = lifecycle.case_meta('reference')
    case['start'] = lifecycle.state_id(lifecycle.initial_state('reference'))
    (out / 'lc-meta.js').write_text('window.lcMeta=' + json.dumps({
        'label': lifecycle.LABEL, 'cases': [case], 'mentor': True,
    }) + ';\n', encoding='utf8')
    static = ROOT / 'app/static'
    html = (static / 'lifecycle.html').read_text()
    html = html.replace('<a class="lc-link" href="replay/index.html">Importer view: Friday replay</a>', '')
    html = html.replace('<label class="lc-ctl-label" for="lc-case">Case</label>',
                        '<label class="lc-ctl-label" for="lc-case">Synthetic case</label>')
    html = html.replace('<main id="main" class="lc-main">', '''<main id="main" class="lc-main">
<section class="lc-panel" aria-labelledby="mentor-heading">
<h2 id="mentor-heading" class="lc-kicker">Review an advance. Track what is still owed.</h2>
<p>This fictional provider uses its own funding cash under a pre-agreed facility. Clearline records the review; it does not make a credit decision or lend money.</p>
<p>Request the advance, then choose Reserve capacity or Decline. Follow the simulated payout and match the repayment. Reset to try the refusal.</p>
<p>One guided example. Other routes and failure cases are outside this walkthrough.</p>
</section>''')
    build = source_build_id()
    (out / 'index.html').write_text(_stamp(html, build), encoding='utf8')
    for name in ('lifecycle.js', 'app.css', 'lifecycle.css'):
        shutil.copyfile(static / name, out / name)
    (out / 'build.txt').write_text('Clearline mentor simulation. Build %s\n' % build)
    return len(views)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    print('%d synthetic mentor states exported' % export(parser.parse_args().output))
