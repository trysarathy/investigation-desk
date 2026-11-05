"""Forward-only observations of the decision engine, sampled inside a material command transaction.

Sequence is the committed case version. No backfill: computing older
snapshots from live facility balances would give historically incorrect answers.
"""
import json
from . import db,domain

MODEL_VERSION = 'pilot-route-assessment/1'
WATCH = frozenset(('add_observation','supersede_observation','select_route','request_advance',
                   'approve_and_reserve','request_evidence','decline','release_reservation','authorize_draw'))
ROUTE_FIELDS = ('key','status','selected','missing','disqualifiers','evidence_ids','observation_ids','cash_ok','capacity_ok','cost')

def capture(state,routes,now):
    fac=state.facility or {}
    return {
        'policy_version':fac.get('policy_version'),
        'facility_id':fac.get('id'),
        'routes':[{k:r[k] for k in ROUTE_FIELDS if k in r} for r in routes],
        'decision':domain.decision(state,routes,now)
    }

def save(conn,user,case,cmd,reason,before,after):
    conn.execute('INSERT INTO funding_decision_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                 (user['org_id'],case['id'],case['version'],db.now_iso(),cmd,user['id'],user['role'],
                  reason if isinstance(reason,str) else None,MODEL_VERSION,
                  json.dumps(before,sort_keys=True),json.dumps(after,sort_keys=True)))

def history(conn,org_id,cid,stamp):
    rows=db.all_rows(conn,'''SELECT sequence,known_at,command,actor_id,role,reason,model_version,before_json,after_json
       FROM funding_decision_snapshots WHERE org_id=? AND case_id=? AND known_at<=? ORDER BY sequence''',
       (org_id,cid,stamp))
    for row in rows:
        for side in ('before','after'):
            row[side]=json.loads(row.pop(side+'_json'))
    return rows
