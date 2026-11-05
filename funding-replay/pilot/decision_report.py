"""Decision replay and explicitly sourced comparisons, scoped to one provider and one case."""
import json
from . import db,decision_snapshots
from .commands import CommandError

SIDES = ('baseline','pilot')
METRICS = ('active_minutes','elapsed_minutes','touchpoints','repeated_requests')
FIELDS = set(METRICS) | {'side','basis','source_ref','service_comparable','deadline_met','idempotency_key'}


def _timestamp(text):
    if text is None:
        return db.now_iso()
    try:
        stamp = db.iso(text)
    except (ValueError,TypeError,OverflowError):
        raise CommandError(422,'invalid_as_of','Supply a timezone-aware historical checkpoint.')
    if stamp > db.now_iso():
        raise CommandError(422,'future_checkpoint','Choose a checkpoint no later than now.')
    return stamp


def _case(conn,user,cid,stamp):
    r=db.one(conn,'SELECT id,created_at FROM cases WHERE id=? AND org_id=? AND created_at<=?',(cid,user['org_id'],stamp))
    if r is None:
        raise CommandError(404,'not_found','Case unavailable at this checkpoint.')


def read(conn,user,cid,as_of=None):
    stamp=_timestamp(as_of)
    _case(conn,user,cid,stamp)
    args=(user['org_id'],cid,stamp)
    events=db.all_rows(conn,'SELECT seq,type,payload,provenance,reason,known_at,effective_at FROM events WHERE org_id=? AND case_id=? AND known_at<=? ORDER BY seq',args)
    for ev in events:
        ev['payload']=json.loads(ev['payload'])
    evidence=db.all_rows(conn,'SELECT id,sha256,known_at,provenance FROM evidence WHERE org_id=? AND case_id=? AND known_at<=? ORDER BY id',args)
    rows=db.all_rows(conn,'SELECT side,known_at,body FROM pilot_measurements WHERE org_id=? AND case_id=? AND known_at<=? ORDER BY id',args)
    latest={side:None for side in SIDES}
    for r in rows:
        latest[r['side']]=dict(json.loads(r['body']),known_at=r['known_at'])
    a,b=[latest[s] for s in SIDES]
    results={}
    if not a or not b:
        state='not measured'
    elif not (a['service_comparable'] and b['service_comparable']) or None in (a['deadline_met'],b['deadline_met']) or a['deadline_met'] != b['deadline_met']:
        state='not comparable'
    else:
        state='synthetic' if 'synthetic' in (a['basis'],b['basis']) else 'estimated' if 'estimated' in (a['basis'],b['basis']) else 'recorded'
        for m in METRICS:
            results[m]=None if None in (a[m],b[m]) else a[m]-b[m]
        for v in (a,b):
            v['other_elapsed_minutes']=None if None in (v['active_minutes'],v['elapsed_minutes']) else v['elapsed_minutes']-v['active_minutes']
        results['other_elapsed_minutes']=None if None in (a['other_elapsed_minutes'],b['other_elapsed_minutes']) else a['other_elapsed_minutes']-b['other_elapsed_minutes']
    return dict(case_id=cid,as_of=stamp,decision_snapshots=decision_snapshots.history(conn,user["org_id"],cid,stamp),events=events,evidence=evidence,measurements=latest,comparison={'basis':state,'baseline_minus_pilot':results},
                scope='Recorded evidence and events known at the checkpoint. No reconstructed eligibility or financial savings.')


def record(conn,user,cid,body):
    if user['role'] not in ('operator','reviewer'):
        raise CommandError(403,'forbidden','Requires an operator or reviewer.')
    if not isinstance(body,dict) or set(body)-FIELDS:
        raise CommandError(422,'invalid_measurement','Unrecognized measurement fields.')
    side,basis=body.get('side'),body.get('basis')
    source,key=body.get('source_ref'),body.get('idempotency_key')
    if side not in SIDES or basis not in ('recorded','estimated','synthetic') or type(body.get('service_comparable')) is not bool:
        raise CommandError(422,'invalid_measurement','Specify side, basis and explicit service comparability.')
    for s,n in [(source,240),(key,128)]:
        if not isinstance(s,str) or not s.strip() or len(s)>n or not s.isprintable():
            raise CommandError(422,'invalid_measurement','A source reference and retry key are required.')
    norm=dict(side=side,basis=basis,source_ref=source.strip(),service_comparable=body['service_comparable'],deadline_met=body.get('deadline_met'))
    if norm['deadline_met'] is not None and type(norm['deadline_met']) is not bool:
        raise CommandError(422,'invalid_measurement','Deadline met must be true, false, or unknown.')
    for m in METRICS:
        v=body.get(m)
        if v is not None and (type(v) is not int or not 0<=v<=10000000):
            raise CommandError(422,'invalid_measurement','Metrics are non-negative whole numbers or unknown.')
        norm[m]=v
    if not any(norm[m] is not None for m in METRICS):
        raise CommandError(422,'invalid_measurement','Supply at least one measured or estimated metric.')
    if None not in (norm['active_minutes'],norm['elapsed_minutes']) and norm['active_minutes']>norm['elapsed_minutes']:
        raise CommandError(422,'invalid_measurement','Use single-operator active minutes within the measured elapsed interval.')
    data=json.dumps(norm,sort_keys=True,ensure_ascii=True)
    with db.tx(conn):
        now=db.now_iso()
        _case(conn,user,cid,now)
        old=db.one(conn,'SELECT body,case_id FROM pilot_measurements WHERE org_id=? AND actor=? AND request_key=?',(user['org_id'],user['id'],key))
        if old and (old['body']!=data or old['case_id']!=cid):
            raise CommandError(409,'key_reuse','Retry key belongs to a different measurement.')
        if not old:
            conn.execute('INSERT INTO pilot_measurements(org_id,case_id,actor,side,known_at,body,request_key) VALUES (?,?,?,?,?,?,?)',(user['org_id'],cid,user['id'],side,now,data,key))
    return read(conn,user,cid)
