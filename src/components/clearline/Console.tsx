"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createIntent, explain, formatAmount, initialWorkspace, quoteFor, reconcile, transition, settlementEventFor, liquiditySnapshots,
 type Payment, type State, type Workspace, type Currency } from "@/lib/clearline/core";
import styles from "./Console.module.css";

type View = "overview"|"payments"|"connect"|"reconciliation"|"liquidity"|"holds"|"funding"|"api";
type Log = {id:string;at:string;method:string;path:string;status:number;description:string};
const groups:{title:string;links:{key:View;label:string;symbol:string}[]}[]=[
 {title:"WORKSPACE",links:[{key:"overview",label:"Overview",symbol:"▦"},{key:"payments",label:"Payments",symbol:"⇄"}]},
 {title:"CONNECT",links:[{key:"connect",label:"Payment intents",symbol:"↗"},{key:"api",label:"API request log",symbol:"⌘"}]},
 {title:"CONTROL",links:[{key:"reconciliation",label:"Reconciliation",symbol:"≡"},{key:"liquidity",label:"Liquidity",symbol:"◫"},{key:"holds",label:"Compliance holds",symbol:"⊟"},{key:"funding",label:"Funding desk",symbol:"▥"}]},
];
const tone=(status:string)=>status==="completed"?"green":status==="on_hold"||status==="in_transit"?"amber":status==="returned"||status==="failed"?"red":"neutral";
const names:Record<string,string>={created:"Created",quoted:"Quoted",approved:"Approved",submitted:"Submitted",in_transit:"In transit",completed:"Completed",returned:"Returned",failed:"Failed",on_hold:"On hold"};
const sgt=(date:string)=>new Date(date).toLocaleString("en-SG",{timeZone:"Asia/Singapore",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
const short=(id:string)=>id.length>17?id.slice(0,15)+"…":id;
const seed=initialWorkspace;
function fromStorage():Workspace{
 if(typeof window==="undefined")return seed();
 try{
  const raw=localStorage.getItem("clearline.preview.v1");
  if(!raw)return seed();
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object"||!("payments" in data)||!Array.isArray(data.payments)||
   data.payments.length>50||!("events" in data)||!Array.isArray(data.events))return seed();
  return data as Workspace;
 }catch{return seed();}
}
function Button({children,onClick,secondary=false,disabled=false}:{children:React.ReactNode;onClick:()=>void;secondary?:boolean;disabled?:boolean}){
 return <button className={secondary?styles.secondary:styles.primary} onClick={onClick} disabled={disabled} type="button">{children}</button>;
}
function Pill({status}:{status:string}){return <span className={styles.pill+" "+styles[tone(status)]}>{names[status]??status}</span>;}
function SectionHead({eyebrow,title,description,action}:{eyebrow:string;title:string;description?:string;action?:React.ReactNode}){
 return <div className={styles.sectionHead}><div><div className={styles.eyebrow}>{eyebrow}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</div>;
}
function Empty({text}:{text:string}){return <div className={styles.empty}>{text}</div>;}
function Label({children}:{children:React.ReactNode}){return <span className={styles.label}>{children}</span>;}

export default function Console(){
 const [data,setData]=useState<Workspace>(seed);
 const [hydrated,setHydrated]=useState(false);
 const [view,setView]=useState<View>("overview");
 const [selected,setSelected]=useState<string>("pi_3p6x92wa");
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState("all");
 const [sort,setSort]=useState<"recent"|"amount">("recent");
 const [page,setPage]=useState(1);
 const [palette,setPalette]=useState(false);
 const [logs,setLogs]=useState<Log[]>([]);
 const [toast,setToast]=useState("");
 const [amount,setAmount]=useState("48215.37");
 const [reference,setReference]=useState("INV-2026-153");
 const [beneficiary,setBeneficiary]=useState("Straits Industrial Supply");
 const [to,setTo]=useState<Currency>("PHP");
 const [draftId,setDraftId]=useState("");
 const [chosenQuote,setChosenQuote]=useState("");
 const [webhookType,setWebhookType]=useState("payout.completed");
 const search=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  setData(fromStorage());setHydrated(true);
  try{const l=localStorage.getItem("clearline.api.log");if(l){const parsed:unknown=JSON.parse(l);if(Array.isArray(parsed))setLogs(parsed.slice(0,40) as Log[]);}
   const f=localStorage.getItem("clearline.filter");if(f)setFilter(f);
  }catch{/* browser storage can be disabled */}
 },[]);
 useEffect(()=>{if(hydrated)try{localStorage.setItem("clearline.preview.v1",JSON.stringify(data));}catch{}},[data,hydrated]);
 useEffect(()=>{if(hydrated)try{localStorage.setItem("clearline.api.log",JSON.stringify(logs.slice(0,40)));}catch{}},[logs,hydrated]);
 useEffect(()=>{if(hydrated)try{localStorage.setItem("clearline.filter",filter);}catch{}},[filter,hydrated]);
 useEffect(()=>{
  let g=false;
  const key=(e:KeyboardEvent)=>{
   const target=e.target as HTMLElement;
   if(target?.closest("input,textarea,select,[contenteditable]")){if(e.key==="Escape")target.blur();return;}
   if(e.key==="/"&&!e.metaKey){e.preventDefault();setView("payments");setTimeout(()=>search.current?.focus(),0);}
   if((e.metaKey||e.ctrlKey)&&e.key==="k"){e.preventDefault();setPalette(x=>!x);}
   if(e.key==="g"){g=true;return;}
   if(g){g=false;if(e.key==="p"){setView("payments");setSelected("");}if(e.key==="c")setView("connect");}
   if(e.key==="Escape"){setSelected("");setPalette(false);}
  };
  window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
 },[]);
 const log=(method:string,path:string,status:number,description:string)=>{
  setLogs(x=>[{id:"req_"+Math.random().toString(36).slice(2,10),at:new Date().toISOString(),method,path,status,description},...x].slice(0,40));
 };
 const notify=(message:string)=>{setToast(message);setTimeout(()=>setToast(""),3200);};
 const navigate=(key:View)=>{setView(key);setSelected("");setPalette(false);setPage(1);};
 const current=data.payments.find(p=>p.id===selected);
 const pending=data.payments.filter(p=>p.status!=="completed"&&p.status!=="failed"&&p.status!=="returned");
 const holds=data.payments.filter(p=>p.status==="on_hold");
 const breaks=reconcile(data.payments,data.events);
 const balances=liquiditySnapshots(data.payments);
 const quoteInput={amountMinor:Math.round(Number(amount)*100)||4821537,currency:"SGD" as Currency,destinationCurrency:to,kycTier:2};
 const quotes=useMemo(()=>quoteFor(quoteInput),[amount,to]);
 const selectedDraft=data.payments.find(x=>x.id===draftId);
 const shown=useMemo(()=>{
  const q=query.toLowerCase().trim();
  return data.payments.filter(p=>(filter==="all"||p.status===filter)&&
  (!q||[p.id,p.reference,p.beneficiary,p.provider].some(v=>v.toLowerCase().includes(q))))
   .sort((a,b)=>sort==="amount"?b.amountMinor-a.amountMinor:b.createdAt.localeCompare(a.createdAt));
 },[data.payments,filter,sort,query]);
 const paginated=shown.slice((page-1)*8,page*8);
 const update=(p:Payment)=>setData(x=>({...x,payments:x.payments.map(v=>v.id===p.id?p:v)}));
 const progress=(p:Payment,step:State)=>{
  try{
   const next=transition(p,step,step==="completed"?"Sandbox partner reported completion":step==="submitted"?"Instruction accepted by sandbox partner":"Synthetic "+names[step].toLowerCase()+" event");
   setData(x=>({...x,payments:x.payments.map(v=>v.id===p.id?next:v),
    events:step==="completed"&& !x.events.some(e=>e.paymentId===p.id)?
      [...x.events,settlementEventFor(next)]:x.events}));
   log("POST","/api/clearline/test/transitions",200,p.id+" → "+step);
   setSelected(p.id);notify(names[step]+" · fictional event recorded");
  }catch(err){notify(err instanceof Error?err.message:"Transition blocked");}
 };
 const nextState=(p:Payment):State|undefined=>({created:"quoted",quoted:"approved",approved:"submitted",submitted:"in_transit",in_transit:"completed"} as Record<string,State>)[p.status];
 const create=()=>{
  try{
   const payment=createIntent({amount,currency:"SGD",destinationCurrency:to,beneficiary,purpose:"Supplier invoice",reference});
   setData(x=>({...x,payments:[payment,...x.payments]}));
   log("POST","/api/clearline/test/intents",201,"New intent "+payment.id);
   setDraftId(payment.id);setSelected(payment.id);setView("connect");
   notify("Test intent created. Compare routes to continue.");
  }catch(err){notify(err instanceof Error?err.message:"Check the input fields.");}
 };
 const accept=()=>{
  if(!selectedDraft||!chosenQuote)return notify("Choose an eligible route first.");
  const choice=quotes.find(q=>q.id===chosenQuote);
  if(!choice||!choice.eligible)return notify("Route not eligible.");
  let p:Payment={...selectedDraft,provider:choice.provider,quoteId:choice.id};
  try{
   p=transition(p,"quoted","Route quoted: "+choice.provider);
   update(p);log("POST","/api/clearline/test/quotes",200,choice.provider);
   setSelected(p.id);notify("Sandbox quote accepted. Human approval required.");
  }catch{notify("Cannot quote this state.");}
 };
 const testWebhook=async()=>{
  const path="/api/clearline/test/webhooks";
  try{
   const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer cl_test_demo"},
     body:JSON.stringify({type:webhookType,paymentId:current?.id??"pi_test_demo"})});
   const result=await response.json() as {data?:{id:string};error?:{message:string}};
   log("POST",path,response.status,"Test "+webhookType+" → "+(result.data?.id??"rejected"));
   notify(response.ok?"Signed test event generated and logged.":"Webhook rejected: "+(result.error?.message??"invalid"));
  }catch{log("POST",path,503,"Demo request could not reach server");notify("Test API unavailable. Try again.");}
 };
 const table=(rows:Payment[])=>rows.length?<div className={styles.tableScroll}><table className={styles.table}><thead><tr>
  <th>PAYMENT</th><th>BENEFICIARY</th><th>AMOUNT</th><th>ROUTE / PROVIDER</th><th>STATUS</th><th>UPDATED</th><th></th>
 </tr></thead><tbody>{rows.map(p=><tr key={p.id} onClick={()=>{setSelected(p.id);setView("payments");}} tabIndex={0}
 onKeyDown={e=>{if(e.key==="Enter"){setSelected(p.id);setView("payments");}}}>
  <td><strong className={styles.mono}>{short(p.id)}</strong><small>{p.reference}</small></td>
  <td>{p.beneficiary}</td><td className={styles.mono}>{formatAmount(p.amountMinor,p.from)}</td>
  <td>{p.provider}</td><td><Pill status={p.status}/></td>
  <td className={styles.muted}>{sgt(p.timeline.at(-1)?.at??p.createdAt)} SGT</td><td className={styles.arrow}>↗</td>
 </tr>)}</tbody></table></div>:<Empty text="No payments match this view. Clear the filters or create a test payment."/>;
 return <div className={styles.app}>
  <aside className={styles.sidebar}>
   <div className={styles.brand}><span className={styles.mark}>c<span>.</span></span><div><strong>clearline</strong><small>Operations infrastructure</small></div></div>
   <div className={styles.switcher}><span className={styles.sandboxDot}></span><div><strong>Clearline Sandbox</strong><small>Fictional workspace</small></div><span className={styles.chevron}>⌄</span></div>
   {groups.map(group=><div key={group.title} className={styles.navGroup}><span className={styles.navLabel}>{group.title}</span>
    {group.links.map(n=><button key={n.key} type="button" className={styles.navItem+(view===n.key?" "+styles.active:"")}
     onClick={()=>navigate(n.key)}><span className={styles.navIcon}>{n.symbol}</span>{n.label}
     {n.key==="holds"&&holds.length>0&&<span className={styles.navCount}>{holds.length}</span>}
    </button>)}</div>)}
   <div className={styles.sidebarBottom}><a href="/clearline/docs" className={styles.navItem}><span className={styles.navIcon}>{"</>"}</span>API documentation</a>
    <div className={styles.workspaceNotice}><strong>Test environment</strong><span>All records are fictional. No funds are transferred or held by Clearline.</span></div>
    <div className={styles.profile}><span className={styles.avatar}>CL</span><div><strong>Clearline Demo</strong><small>Sandbox operator</small></div></div>
   </div>
  </aside>
  <div className={styles.main}>
   <header className={styles.topbar}>
    <div className={styles.breadcrumb}>Clearline <span>/</span> {groups.flatMap(x=>x.links).find(x=>x.key===view)?.label}</div>
    <div className={styles.headerRight}>
     <button className={styles.command} onClick={()=>setPalette(true)} type="button">Search or jump to… <kbd>⌘ K</kbd></button>
     <span className={styles.testBadge}><i></i> TEST MODE</span><span className={styles.topDate}>13 Nov 2026 · SGT</span>
    </div>
   </header>
   <main className={styles.content}>
    {view==="overview"&&<>
     <SectionHead eyebrow="OPERATIONS / OVERVIEW" title="Money movement, in context." description="One synthetic workspace across routing, payment status and exception control."
      action={<Button onClick={()=>navigate("connect")}>+ New payment intent</Button>}/>
     <div className={styles.warning}>This is a fictional test environment. Provider reports are simulated and do not prove final settlement.</div>
     <div className={styles.metrics}>
      <div><Label>OPEN PAYMENT VALUE</Label><strong>SGD 48,215.37</strong><small>Illustrative exposure · 1 outstanding intent</small></div>
      <div><Label>PAYMENTS REQUIRING ACTION</Label><strong>{data.payments.filter(p=>["on_hold","returned"].includes(p.status)).length.toString().padStart(2,"0")}</strong><small>Holds and returned payouts</small></div>
      <div><Label>RECONCILIATION BREAKS</Label><strong>{breaks.filter(x=>x.status==="exception").length.toString().padStart(2,"0")}</strong><small>From fictional statement extract</small></div>
      <div><Label>PENDING TEST PAYOUTS</Label><strong>{pending.length.toString().padStart(2,"0")}</strong><small>Across sandbox providers</small></div>
     </div>
     <div className={styles.twoColumns}>
      <section className={styles.panel}><div className={styles.panelTitle}><h2>Needs attention</h2><button type="button" onClick={()=>navigate("holds")}>View queue ↗</button></div>
      {data.payments.filter(p=>p.status==="returned"||p.status==="on_hold"||p.scenario==="delay").map(p=><button key={p.id} type="button" className={styles.attention}
       onClick={()=>{setView("payments");setSelected(p.id);}}><Pill status={p.status}/><div><strong>{p.beneficiary}</strong><small>{p.nextAction??"Awaiting provider status"}</small></div><span>↗</span></button>)}</section>
      <section className={styles.panel}><div className={styles.panelTitle}><h2>Provider liquidity</h2><button type="button" onClick={()=>navigate("liquidity")}>All balances ↗</button></div>
       {balances.map(x=><div className={styles.liquidityMini} key={x.provider}>
        <strong>{x.provider}</strong><span><small>FREE CASH</small>{formatAmount(x.freeMinor,x.currency)}</span>
       </div>)}
      </section>
     </div>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Recent payments</h2><button type="button" onClick={()=>navigate("payments")}>All payments ↗</button></div>{table(data.payments.slice(0,5))}</section>
    </>}
    {view==="payments"&&<>
     <SectionHead eyebrow="CONTROL / PAYMENT OPERATIONS" title="Payments" description="Follow each instruction from intent to partner-reported outcome. All activity is simulated."
      action={<Button onClick={()=>navigate("connect")}>+ Create intent</Button>}/>
     <div className={styles.panel}><div className={styles.toolbar}>
      <input ref={search} className={styles.search} aria-label="Search payments" placeholder="Search reference, ID or provider…" value={query}
       onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
      <select aria-label="Filter payment status" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}>
       <option value="all">All statuses</option>{Object.keys(names).map(v=><option value={v} key={v}>{names[v]}</option>)}
      </select>
      <select aria-label="Sort payments" value={sort} onChange={e=>setSort(e.target.value as "recent"|"amount")}>
       <option value="recent">Latest activity</option><option value="amount">Highest amount</option>
      </select><span className={styles.muted}>{shown.length} records</span></div>
      {table(paginated)}
      <div className={styles.pagination}><span>{shown.length?Math.min((page-1)*8+1,shown.length):0}–{Math.min(page*8,shown.length)} of {shown.length}</span>
       <div><button type="button" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button><button type="button" disabled={page*8>=shown.length} onClick={()=>setPage(p=>p+1)}>Next</button></div></div>
     </div>
     {current&&<section className={styles.detail}>
      <div className={styles.detailHead}><div><Label>PAYMENT RECORD / {current.reference}</Label><h2>{current.id}</h2></div>
       <button type="button" aria-label="Close payment detail" onClick={()=>setSelected("")}>×</button></div>
      <div className={styles.detailBody}>
       <div className={styles.statusLine}><Pill status={current.status}/><strong>{formatAmount(current.amountMinor,current.from)}</strong></div>
       <h3>What happened?</h3><p className={styles.explanation}>{explain(current)}</p>
       <div className={styles.factGrid}>{[["BENEFICIARY",current.beneficiary],["CORRIDOR",current.from+" → "+current.to],
        ["PROVIDER",current.provider],["REFERENCE",current.reference],
        ["SOURCE",current.scenario==="delay"?"Base Sepolia (testnet)":"Fictional provider feed"],["SETTLEMENT","Not independently verified"]
       ].map(([k,v])=><div key={k}><Label>{k}</Label><strong>{v}</strong></div>)}</div>
       <div className={styles.detailTitle}><h3>Evidence timeline</h3><span>{current.timeline.length} events</span></div>
       <div className={styles.timeline}>{current.timeline.map((ev,i)=><div className={styles.timelineItem} key={ev.id}>
        <span className={styles.timelineDot}></span><div><strong>{ev.label}</strong><small>{ev.source} · {sgt(ev.at)} SGT</small><span>{ev.evidence}</span></div>
       </div>)}</div>
       {current.nextAction&&<div className={styles.nextAction}><Label>NEXT HUMAN ACTION</Label><p>{current.nextAction}</p></div>}
       <div className={styles.detailButtons}><Button secondary onClick={()=>{navigator.clipboard?.writeText(current.id);notify("Payment ID copied");}}>Copy payment ID</Button>
       {nextState(current)&&<Button onClick={()=>progress(current,nextState(current)!)}>Simulate {names[nextState(current)!]}</Button>}
       </div>
      </div></section>}
    </>}
    {view==="connect"&&<>
     <SectionHead eyebrow="CONNECT / PAYMENT INTENTS" title="Create a payment" description="Test the full instruction lifecycle without connecting a bank, wallet or payment provider."
      action={<a className={styles.docLink} href="/clearline/docs">Developer quickstart ↗</a>}/>
     <div className={styles.warning}>Simulation only. Quotes are illustrative and instructions never reach a licensed provider.</div>
     <div className={styles.connectGrid}>
      <section className={styles.panel}><div className={styles.panelTitle}><h2>New test intent</h2><Pill status="created"/></div>
       <div className={styles.form}>
        <label>Amount <div className={styles.fieldRow}><span>SGD</span><input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/></div></label>
        <label>Send to <select value={to} onChange={e=>setTo(e.target.value as Currency)}><option value="PHP">PHP · Philippine peso</option><option value="USD">USD · US dollar</option><option value="SGD">SGD · Singapore dollar</option></select></label>
        <label>Beneficiary (fictional) <input value={beneficiary} onChange={e=>setBeneficiary(e.target.value)} maxLength={120}/></label>
        <label>Invoice reference <input value={reference} onChange={e=>setReference(e.target.value)} maxLength={48}/></label>
        <label>Purpose <input value="Supplier invoice" readOnly/></label>
        <Button onClick={create}>Create test intent</Button><p>Creating an intent does not authorize a payout.</p>
       </div>
      </section>
      <section className={styles.panel}><div className={styles.panelTitle}><h2>Eligible routes</h2><span className={styles.muted}>Illustrative quote comparison</span></div>
       <div className={styles.quoteList}>{quotes.map(q=><button type="button" key={q.id} disabled={!q.eligible||!selectedDraft||selectedDraft.status!=="created"}
       className={styles.quote+(chosenQuote===q.id?" "+styles.chosen:"")} onClick={()=>setChosenQuote(q.id)}>
        <div className={styles.quoteTop}><strong>{q.provider}</strong><span>{q.eligible?"Eligible":"Ineligible"}</span></div>
        <small>{q.route}</small>{q.eligible?<div className={styles.quoteFacts}><span>FX <b>{q.rate}</b></span><span>FEE <b>{q.fee}</b></span><span>ETA <b>{q.eta}</b></span></div>:<p>{q.reason}</p>}
       </button>)}</div>
       <div className={styles.quoteFooter}>{selectedDraft?<><span className={styles.mono}>{selectedDraft.id} · {names[selectedDraft.status]}</span>
        {selectedDraft.status==="created"&&<Button onClick={accept} disabled={!chosenQuote}>Accept selected quote</Button>}
        {nextState(selectedDraft)&&selectedDraft.status!=="created"&&<Button onClick={()=>progress(selectedDraft,nextState(selectedDraft)!)}>Simulate {names[nextState(selectedDraft)!]}</Button>}
        {selectedDraft.status==="completed"&&<span className={styles.goodText}>Sandbox reports complete. No real funds moved.</span>}
       </>:<span className={styles.muted}>Create an intent to select and approve a route.</span>}</div>
      </section>
     </div>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Problem path testing</h2><span className={styles.muted}>Select any seeded case to inspect its whole timeline</span></div>
      <div className={styles.scenarioRow}>{[
       ["Returned payout","returned" as const,"Beneficiary details rejected"],
       ["Compliance hold","hold" as const,"Invoice evidence requested"],
       ["Stablecoin delay","delay" as const,"Awaiting Base Sepolia finality"]
      ].map(([label,key,sub])=><button type="button" className={styles.scenario} key={key} onClick={()=>{
       const p=data.payments.find(x=>x.scenario===key);if(p){setSelected(p.id);setView("payments");}
      }}><strong>{label}</strong><small>{sub}</small><span>View case ↗</span></button>)}</div></section>
    </>}
    {view==="reconciliation"&&<>
     <SectionHead eyebrow="CONTROL / RECONCILIATION" title="Reconciliation" description="Compare fictional provider event exports with payment references. Amount alone is never sufficient to match a payment."/>
     <div className={styles.notice}>Source events are synthetic. A matched amount is not independent confirmation of settlement.</div>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Statement comparison</h2><span className={styles.muted}>{data.events.length} fictional source records</span></div>
      <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>REFERENCE</th><th>PAYMENT</th><th>AMOUNT</th><th>RESULT</th><th>REASON</th></tr></thead><tbody>
      {breaks.map(x=><tr key={x.reference}><td className={styles.mono}>{x.reference}</td><td className={styles.mono}>{short(x.paymentId)}</td><td className={styles.mono}>{formatAmount(x.amountMinor,"SGD")}</td>
       <td><span className={x.status==="matched"?styles.goodText:styles.badText}>{x.status==="matched"?"Match (unverified)":"Exception"}</span></td><td>{x.reason}</td></tr>)}
      </tbody></table></div></section>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Matching hierarchy</h2></div>
      <div className={styles.policy}><div><strong>01</strong><span>Exact payment reference and provider event ID</span><Pill status="completed"/></div>
       <div><strong>02</strong><span>Currency and amount equality (additional check only)</span><Pill status="completed"/></div>
       <div><strong>03</strong><span>Source authenticity and settlement evidence</span><span className={styles.badText}>Not verified</span></div></div></section>
    </>}
    {view==="liquidity"&&<>
     <SectionHead eyebrow="CONTROL / TREASURY" title="Liquidity" description="Illustrative provider balances and pending instructions by currency. These values are not connected to banks or on-chain wallets."/>
     <div className={styles.metrics}>{[
      ["TOTAL SGD BALANCE",balances[0].balanceMinor],["RESERVED AMOUNT",balances[0].safeguardedMinor],
      ["PENDING INSTRUCTIONS",balances[0].pendingMinor],["FREE CASH",balances[0].freeMinor]
     ].map(([k,v])=><div key={k}><Label>{k}</Label><strong className={styles.smallMetric}>{formatAmount(v,"SGD")}</strong></div>)}</div>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Provider balances</h2><span className={styles.muted}>Synthetic snapshots · 13 Nov 2026</span></div>
      <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>PROVIDER</th><th>CURRENCY</th><th>BALANCE</th><th>SAFEGUARDED</th><th>PENDING</th><th>BUFFER</th><th>FREE CASH</th></tr></thead><tbody>
       {balances.map(x=><tr key={x.provider}>
        <td>{x.provider}</td><td>{x.currency}</td>
        {[x.balanceMinor,x.safeguardedMinor,x.pendingMinor,x.bufferMinor,x.freeMinor].map((v,i)=>
          <td key={i} className={styles.mono}>{formatAmount(v,x.currency)}</td>)}
       </tr>)}
      </tbody></table></div></section>
     <div className={styles.notice}>Free cash = balance − safeguarded funds − pending payouts − buffer. These are illustrative balances, not a treasury control or payment authorization.</div>
    </>}
    {view==="holds"&&<>
     <SectionHead eyebrow="CONTROL / COMPLIANCE" title="Compliance holds" description="Track partner-reported holds and requested evidence. Your team and providers make all compliance decisions."/>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Open holds</h2><span className={styles.muted}>Provider decisions · fictional records</span></div>
     {holds.length?holds.map(p=><div className={styles.hold} key={p.id}><div><strong>{p.beneficiary}</strong><small className={styles.mono}>{p.id} · {p.reference}</small></div><Pill status={p.status}/><div><Label>REASON</Label><strong>Supporting invoice requested</strong></div><div><Label>OWNER</Label><strong>Operations review</strong></div><button type="button" onClick={()=>{setView("payments");setSelected(p.id);}}>Investigate ↗</button></div>):<Empty text="No active holds in this fictional workspace."/>}
     </section><div className={styles.notice}>Clearline records the partner-reported hold; it does not decide whether to release or reject payments.</div>
    </>}
    {view==="funding"&&<>
     <SectionHead eyebrow="CONTROL / FUNDING EXPOSURE" title="Funding desk" description="The existing mentor Funding Desk is preserved as a separate test-mode module."/>
     <div className={styles.panel}><div className={styles.fundingPanel}><div><Label>EXISTING PRODUCT MODULE</Label><h2>Advance review & outstanding ledger</h2><p>Review funding advances, five operating checks, maker–checker approvals, outstanding balances and repayments matched to reference. Sandbox data only.</p></div>
     <a href="/mentor-demo" target="_blank" rel="noopener noreferrer" className={styles.primary}>Open Funding Desk ↗</a></div></div>
     <div className={styles.notice}>The Funding Desk remains its own isolated dataset in this preview. A shared ledger and single sign-on are not implemented yet.</div>
    </>}
    {view==="api"&&<>
     <SectionHead eyebrow="CONNECT / DEVELOPER TOOLS" title="API request log" description="Test requests recorded in this browser. The public test API is stateless and does not execute payouts."
      action={<a className={styles.docLink} href="/clearline/docs">Read API docs ↗</a>}/>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Webhook sandbox</h2><span className={styles.muted}>HMAC-SHA256 · Example signing secret</span></div>
      <div className={styles.webhookControls}><select aria-label="Test webhook type" value={webhookType} onChange={e=>setWebhookType(e.target.value)}>
       {["intent.created","quote.accepted","payout.submitted","payout.completed","payout.failed","payout.returned"].map(v=><option value={v} key={v}>{v}</option>)}</select>
       <Button onClick={()=>void testWebhook()}>Send test webhook</Button></div>
      <p className={styles.footnote}>A simulated delivery is generated; no outbound HTTP delivery or retry worker runs in this preview.</p></section>
     <section className={styles.panel}><div className={styles.panelTitle}><h2>Recent test requests</h2><button type="button" onClick={()=>setLogs([])}>Clear local log</button></div>
      {logs.length?<div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>TIME (SGT)</th><th>METHOD</th><th>PATH</th><th>STATUS</th><th>DETAIL</th></tr></thead><tbody>
       {logs.map(x=><tr key={x.id}><td className={styles.mono}>{sgt(x.at)}</td><td className={styles.mono}>{x.method}</td><td className={styles.mono}>{x.path}</td>
       <td><span className={x.status<400?styles.goodText:styles.badText}>{x.status}</span></td><td>{x.description}</td></tr>)}</tbody></table></div>:<Empty text="No test requests yet. Create an intent or send a test webhook to populate the log."/>}
     </section>
    </>}
    <footer className={styles.footer}><span>Clearline test mode · Fictional sandbox records only</span><span>No custody · No live partner execution · No independently verified settlement</span></footer>
   </main>
  </div>
  {palette&&<div className={styles.paletteBackdrop} onClick={()=>setPalette(false)} role="presentation"><div className={styles.paletteBox} onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Navigate Clearline">
    <header>Jump to a workspace <button type="button" onClick={()=>setPalette(false)}>Esc ×</button></header>
    {groups.flatMap(x=>x.links).map(x=><button type="button" key={x.key} onClick={()=>navigate(x.key)}>{x.label}<span>↗</span></button>)}
  </div></div>}
  {toast&&<div role="status" aria-live="polite" className={styles.toast}>{toast}</div>}
 </div>;
}
