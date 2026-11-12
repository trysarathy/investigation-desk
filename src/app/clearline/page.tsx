"use client";
import {useEffect,useMemo,useState} from "react";
import {approve,createPayment,freeCash,matchByReference,next,quote,routes,seeded,verdict,type Payment} from "@/lib/clearline/model";
import styles from "./clearline.module.css";
type View="payments"|"connect"|"reconciliation"|"liquidity"|"holds"|"investigation"|"funding"|"developers";
const nav:{key:View;name:string;group:string}[]=[
 {key:"payments",name:"Payments",group:"Workspace"},{key:"connect",name:"Create payment",group:"Connect"},
 {key:"developers",name:"Developer overview",group:"Connect"},{key:"reconciliation",name:"Reconciliation",group:"Control"},
 {key:"liquidity",name:"Liquidity",group:"Control"},{key:"holds",name:"Compliance holds",group:"Control"},
 {key:"investigation",name:"Investigations",group:"Control"},{key:"funding",name:"Funding exposure",group:"Control"}];
const fmt=(n:number)=>new Intl.NumberFormat("en-SG",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
export default function Clearline(){
 const [payments,setPayments]=useState<Payment[]>(()=>seeded());
 const [selected,setSelected]=useState("pi_8f3k200");
 const [view,setView]=useState<View>("payments");
 const [search,setSearch]=useState("");
 const [status,setStatus]=useState("all");
 const [beneficiary,setBeneficiary]=useState("");const [amount,setAmount]=useState("48215.37");
 const [reference,setReference]=useState("");const [scenario,setScenario]=useState("happy");
 const [notice,setNotice]=useState("");
 const [palette,setPalette]=useState(false);
 const [sortDesc,setSortDesc]=useState(true);
 const [page,setPage]=useState(0);
 const [ready,setReady]=useState(false);
 useEffect(()=>{try{setStatus(localStorage.getItem("clearline.filter")||"all");}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem("clearline.filter",status);}catch{}},[status,ready]);
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{
   const target=e.target as HTMLElement;
   if(target?.closest("input,textarea,select")){if(e.key==="Escape")setPalette(false);return;}
   if(e.key==="/"){e.preventDefault();setPalette(true);}
   if(e.key==="Escape")setPalette(false);
   if(e.key.toLowerCase()==="p"&&e.altKey){setView("payments");setPalette(false);}
  };
  window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
 },[]);
 const current=payments.find(p=>p.id===selected)||payments[0];
 const filtered=useMemo(()=>payments.filter(p=>(status==="all"||p.status===status)&&[p.id,p.beneficiary,p.reference,p.provider].join(" ").toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sortDesc?b.id.localeCompare(a.id):a.id.localeCompare(b.id)),[payments,search,status,sortDesc]);
 const update=(fn:(p:Payment)=>Payment)=>{try{const replacement=fn(current);setPayments(ps=>ps.map(p=>p.id===current.id?replacement:p));setNotice("Sandbox event recorded. No funds moved.");}catch(e){setNotice(e instanceof Error?e.message:"Action could not complete.");}};
 const create=()=>{try{const p=createPayment(beneficiary,Number(amount),reference,scenario);setPayments(ps=>[p,...ps]);setSelected(p.id);setView("payments");setNotice("Intent created in test mode. Request quotes to continue.");}catch(e){setNotice(e instanceof Error?e.message:"Invalid payment.");}};
 const info=verdict(current);
 const completed=payments.filter(p=>p.status==="completed").length;
 const held=payments.filter(p=>p.status==="on_hold").length;
 const broken=payments.filter(p=>p.status==="returned"||p.status==="failed").length;
 const statements=[{reference:"INV-SG-1847",amount:48215.37,source:"Northline statement"},{reference:"INV-SG-1848",amount:12608.49,source:"Receiving bank return"},{reference:"UNKNOWN-105",amount:48215.37,source:"Unassigned deposit"}];
 const cash=freeCash(271846.72,46280.19,93820.36,25000.41);
 return <div className={styles.root}>
  <aside className={styles.side}><div className={styles.brand}><span className={styles.mark}>C</span><span>Clearline</span><small>WORKSPACE / SANDBOX</small></div>
   {["Workspace","Connect","Control"].map(group=><div key={group} className={styles.navgroup}><div className={styles.navtitle}>{group}</div>
   {nav.filter(n=>n.group===group).map(n=><button key={n.key} className={view===n.key?styles.active:styles.nav} onClick={()=>{setView(n.key);setNotice("");}}>{n.name}</button>)}</div>)}
   <div className={styles.sidefoot}><a href="/mentor-demo">Open original Funding Desk ↗</a><span>All records fictional · no live rails</span></div>
  </aside>
  <div className={styles.workspace}>
   <header className={styles.top}><div className={styles.crumb}>Clearline <span>/</span> {nav.find(n=>n.key===view)?.name}</div><div className={styles.topright}><button onClick={()=>setPalette(true)} className={styles.searchbutton}>Search <kbd>/</kbd></button><span className={styles.test}>● TEST MODE</span><span className={styles.avatar}>CL</span></div></header>
   <main className={styles.main}>
    <div className={styles.heading}><div><div className={styles.eyebrow}>{view==="payments"?"PAYMENT OPERATIONS":view==="connect"?"CONNECT / INTENTS":"CLEARLINE / "+view.toUpperCase()}</div><h1>{nav.find(n=>n.key===view)?.name}</h1><p>One record of what happened, who confirmed it, and what needs attention.</p></div>
    {view==="payments"&&<button className={styles.primary} onClick={()=>setView("connect")}>+ Create payment</button>}</div>
    <div className={styles.banner}>Sandbox workspace — simulated providers, balances, events and decisions. No real payouts or network requests.</div>
    {notice&&<div className={styles.notice} role="status">{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss message">×</button></div>}
    {view==="payments"&&<>
     <div className={styles.metrics}><div><span>Total payments</span><strong>{payments.length}</strong><small>Simulated intents</small></div><div><span>Completed</span><strong>{completed}</strong><small>Provider reported</small></div><div><span>Needs attention</span><strong>{held+broken}</strong><small>Holds and returns</small></div><div><span>Pending finality</span><strong>{payments.filter(p=>p.scenario==="finality"&&p.status==="in_transit").length}</strong><small>Testnet only</small></div></div>
     <div className={styles.split}><section className={styles.panel}><div className={styles.panelheading}><strong>Payment ledger</strong><span>{filtered.length} records</span></div><div className={styles.toolbar}><input aria-label="Search payments" placeholder="Search reference, beneficiary or ID" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><select aria-label="Filter status" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="all">All states</option>{["completed","returned","on_hold","in_transit","created","quoted","approved","submitted","failed"].map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select><button onClick={()=>setSortDesc(x=>!x)}>Sort {sortDesc?"↓":"↑"}</button></div>
     <div className={styles.tablewrap}><table><thead><tr><th>Payment / reference</th><th>Beneficiary</th><th>Amount</th><th>State</th></tr></thead><tbody>{filtered.slice(page*8,page*8+8).map(p=><tr key={p.id} className={p.id===selected?styles.selected:""} onClick={()=>setSelected(p.id)}><td><b>{p.id}</b><small>{p.reference}</small></td><td>{p.beneficiary}</td><td className={styles.num}>SGD {fmt(p.amount)}</td><td><span className={styles.status} data-state={p.status}>{p.status.replaceAll("_"," ")}</span></td></tr>)}</tbody></table>{!filtered.length&&<p className={styles.empty}>No payments match those filters. Try another status or search.</p>}</div><div className={styles.pager}><span>Page {page+1} of {Math.max(1,Math.ceil(filtered.length/8))}</span><button disabled={page===0} onClick={()=>setPage(x=>x-1)}>Previous</button><button disabled={(page+1)*8>=filtered.length} onClick={()=>setPage(x=>x+1)}>Next</button></div></section>
     <section className={styles.panel}><div className={styles.panelheading}><strong>Payment record</strong><button onClick={()=>navigator.clipboard?.writeText(current.id)}>Copy ID</button></div><div className={styles.details}><span className={styles.eyebrow}>{current.id}</span><h2>{info[0]}</h2><p>{info[1]}</p><div className={styles.next}><b>Next action</b><p>{info[2]}</p></div>
     <dl><dt>Beneficiary</dt><dd>{current.beneficiary}</dd><dt>Reference</dt><dd>{current.reference}</dd><dt>Instruction amount</dt><dd>SGD {fmt(current.amount)}</dd><dt>Execution partner</dt><dd>{current.provider}</dd></dl>
     {current.status==="created"&&<button className={styles.primary} onClick={()=>update(quote)}>Request quotes</button>}
     {current.status==="quoted"&&<div className={styles.routes}>{routes.map(r=><button disabled={!r.eligible} onClick={()=>update(p=>approve(p,r.id))} key={r.id}><b>{r.name}</b><span>Fee SGD {fmt(r.fee)} · FX {r.fx} · {r.eta}</span>{!r.eligible&&<i>{r.reason}</i>}</button>)}</div>}
     {["approved","submitted","in_transit","on_hold"].includes(current.status)&&<button disabled={current.scenario==="finality"&&current.status==="in_transit"} className={styles.primary} onClick={()=>update(next)}>{current.status==="approved"?"Submit sandbox payout":current.status==="on_hold"?"Simulate partner release":"Advance sandbox event"}</button>}
     <h3>Evidence timeline</h3><ol className={styles.timeline}>{[...current.events].reverse().map((e,i)=><li key={i}><span className={styles.dot}/><div><b>{e.status.replaceAll("_"," ")}</b><p>{e.detail}</p><small>{e.source} · {new Date(e.at).toLocaleString("en-SG",{timeZone:"Asia/Singapore"})} SGT · synthetic</small></div></li>)}</ol></div></section></div>
    </>}
    {view==="connect"&&<div className={styles.formpanel}><h2>Create a payment intent</h2><p>Only a synthetic instruction will be recorded. No partner receives a request.</p><label>Beneficiary<input value={beneficiary} onChange={e=>setBeneficiary(e.target.value)} placeholder="Example: Ardent Manufacturing Ltd"/></label><label>Amount (SGD)<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Customer reference<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="INV-SG-1851"/></label><label>Scenario<select value={scenario} onChange={e=>setScenario(e.target.value)}><option value="happy">Successful payout</option><option value="returned">Beneficiary return</option><option value="hold">Compliance hold</option><option value="finality">Testnet finality delay</option></select></label><button className={styles.primary} onClick={create}>Create test intent</button></div>}
    {view==="reconciliation"&&<section className={styles.panel}><div className={styles.panelheading}><strong>Statement matching</strong><span>Reference first — never amount alone</span></div><div className={styles.tablewrap}><table><thead><tr><th>Source</th><th>Reference</th><th>Amount</th><th>Result</th></tr></thead><tbody>{statements.map(s=><tr key={s.reference}><td>{s.source}</td><td>{s.reference}</td><td>SGD {fmt(s.amount)}</td><td>{matchByReference(payments,s.reference,s.amount)?"Matched":"Unmatched — review"}</td></tr>)}</tbody></table></div></section>}
    {view==="liquidity"&&<><div className={styles.metrics}><div><span>Provider balance</span><strong>271,846.72</strong><small>SGD · synthetic</small></div><div><span>Safeguarded</span><strong>46,280.19</strong></div><div><span>Pending payouts</span><strong>93,820.36</strong></div><div><span>Free cash</span><strong>{fmt(cash)}</strong><small>After SGD 25,000.41 buffer</small></div></div><section className={styles.panel}><div className={styles.details}><h2>Liquidity calculation</h2><p>Free cash = balance − safeguarded − pending payouts − operating buffer. Balances are invented for this demonstration and are not connected to partner accounts.</p><p className={styles.next}>Review corridor availability before submitting any real instruction. Clearline does not control or hold these balances.</p></div></section></>}
    {view==="holds"&&<section className={styles.panel}><div className={styles.panelheading}><strong>Provider holds</strong><span>{held} open</span></div><div className={styles.tablewrap}><table><thead><tr><th>Payment</th><th>Partner</th><th>Reason</th><th>Owner</th></tr></thead><tbody>{payments.filter(p=>p.status==="on_hold").map(p=><tr key={p.id}><td>{p.id}</td><td>{p.provider}</td><td>Supporting documents requested</td><td>Operations review</td></tr>)}</tbody></table>{held===0&&<p className={styles.empty}>No active holds.</p>}</div></section>}
    {view==="investigation"&&<section className={styles.panel}><div className={styles.details}><h2>Case investigation</h2><p>Every case is anchored to its payment record, not a disconnected explanation.</p>{payments.filter(p=>p.status!=="completed").map(p=><button key={p.id} className={styles.case} onClick={()=>{setSelected(p.id);setView("payments");}}><span><b>{p.reference}</b> · {p.beneficiary}</span><span>{verdict(p)[0]} →</span></button>)}</div></section>}
    {view==="funding"&&<section className={styles.panel}><div className={styles.details}><h2>Funding Desk</h2><p>The original synthetic advance review and outstanding ledger remain available. Integration with the new Payment IDs is a later milestone; these views do not yet share data.</p><a className={styles.primary} href="/mentor-demo">Open existing Funding Desk ↗</a></div></section>}
    {view==="developers"&&<section className={styles.panel}><div className={styles.details}><h2>Connect API · planned</h2><p>Intents, eligible quotes, partner instructions and webhook events will share a typed, audited state machine. This milestone implements the sandbox model, not a publicly callable API.</p><div className={styles.next}><b>Contract preview</b><pre>{"POST /api/v1/payment_intents\nPOST /api/v1/payment_intents/:id/quotes\nPOST /api/v1/payment_intents/:id/submit\nGET  /api/v1/payment_intents/:id\nPOST /api/v1/webhooks/test"}</pre></div><p>Authentication, idempotency, signing, retries and request logs must be implemented and tested before these endpoints are advertised as working.</p></div></section>}
   </main><footer className={styles.footer}>Clearline · Internal prototype · 13 Nov 2026 · Singapore time · All data fictional</footer>
  </div>
  {palette&&<div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Navigation command palette"><div className={styles.palette}><div><b>Go to</b><button onClick={()=>setPalette(false)} aria-label="Close palette">Esc</button></div>{nav.map(n=><button key={n.key} onClick={()=>{setView(n.key);setPalette(false);}}>{n.name}<span>{n.group}</span></button>)}</div></div>}
 </div>;
}
