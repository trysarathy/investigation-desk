'use client';
import { useState } from 'react';
import { VERDICT_LABELS } from '@/lib/catalogue';
import type { Code } from '@/lib/types';
export function CaseFeedback({id,predicted}:{id:string;predicted:Code}) {
  const [actual,setActual]=useState(predicted),[reason,setReason]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  async function submit(code:Code) {
    setBusy(true);setStatus('');
    try {const r=await fetch(`/api/cases/${id}/feedback`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actual:code,reason:reason||'Analyst confirmation'})});const data=await r.json();if(!r.ok)throw Error(data.error);setStatus('Saved with evidence. Pending lead adjudication; original prediction preserved.');}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="panel feedback-panel"><div><span className="eyebrow">Improve the evidence base</span><h2>Is this diagnosis right?</h2><p className="muted">Your review creates a reproducible regression candidate. It never silently changes the rules.</p></div><div className="form-row"><button className="btn primary" disabled={busy} onClick={()=>submit(predicted)}>Confirm diagnosis</button><label>Correct to <select className="input" value={actual} onChange={e=>setActual(e.target.value as Code)}>{Object.entries(VERDICT_LABELS).map(([c,l])=><option key={c} value={c}>{c} · {l}</option>)}</select></label><input className="input" aria-label="Correction evidence or reason" placeholder="Evidence supporting the correction" value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/><button className="btn" disabled={busy||!reason.trim()} onClick={()=>submit(actual)}>Save correction</button></div><p role="status" className="muted">{status}</p></section>;
}
