/** Clearline test-mode orchestration. Fictional data, NO real partner execution. */
export type State = "created" | "quoted" | "approved" | "submitted" | "in_transit" | "completed" | "failed" | "returned" | "on_hold";
export type Scenario = "happy" | "returned" | "hold" | "delay";
export type Currency = "SGD" | "USD" | "PHP" | "USDC";
export type TimelineEntry = { id: string; state: State; at: string; label: string; source: string; evidence: string };
export type Payment = {
 id: string; reference: string; beneficiary: string; purpose: string; from: Currency; to: Currency;
 amountMinor: number; status: State; scenario: Scenario; provider: string; quoteId?: string;
 createdAt: string; timeline: TimelineEntry[]; owner?: string; nextAction?: string;
};
export type Quote = { id:string; provider:string; route:string; rate:string; fee:string; eta:string; expiresAt:string; eligible:boolean; reason?:string };
export type LedgerEvent = {paymentId:string;reference:string;amountMinor:number;currency:Currency;source:string};
export type Workspace = {payments:Payment[]; events:LedgerEvent[]};
const allowed: Record<State,State[]> = {
 created:["quoted","failed"],quoted:["approved","failed"],approved:["submitted","on_hold","failed"],
 submitted:["in_transit","on_hold","failed"],in_transit:["completed","failed","returned","on_hold"],
 on_hold:["submitted","in_transit","failed","returned"],completed:[],failed:[],returned:[]
};
export const allowedTransition=(from:State,to:State)=>allowed[from].includes(to);
export function transition(p:Payment,to:State,label:string):Payment{
 if(!allowedTransition(p.status,to))throw Error("Invalid payment transition: "+p.status+" to "+to);
 const n=p.timeline.length;
 return {...p,status:to,timeline:[...p.timeline,{id:"ev_"+p.id.slice(3)+"_"+(n+1),
  state:to,at:new Date(Date.parse(p.createdAt)+(n+1)*143000).toISOString(),
  label,source:to==="submitted"||to==="in_transit"||to==="completed"?"Partner sandbox":"Clearline test mode",
  evidence:"Synthetic event · not independent settlement proof"}]};
}
const safeText=(v:string,n=120)=>typeof v==="string"&&v.length>=2&&v.length<=n&&/^[a-zA-Z0-9 ()/.,:_\-]+$/.test(v);
let seed=0;
export function createIntent(input:{amount:string;currency:Currency;destinationCurrency:Currency;beneficiary:string;purpose:string;reference:string}):Payment{
 if(!/^(?:[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(input.amount)||
  !["SGD","USD","PHP","USDC"].includes(input.currency)||
  !["SGD","USD","PHP","USDC"].includes(input.destinationCurrency)||
  !safeText(input.beneficiary)||!safeText(input.purpose)||!safeText(input.reference,48))
  throw Error("Use a positive amount, supported currency and fictional text-only references.");
 seed=(seed+1)%100000;
 const now=new Date().toISOString();
 return {id:"pi_test_"+Math.random().toString(36).slice(2,10)+seed.toString(36),
  reference:input.reference,beneficiary:input.beneficiary,purpose:input.purpose,
  amountMinor:Math.round(Number(input.amount)*100),from:input.currency,to:input.destinationCurrency,
  status:"created",scenario:"happy",provider:"Unassigned",createdAt:now,
  timeline:[{id:"evt_create",state:"created",at:now,label:"Payment intent created",
   source:"Clearline test mode",evidence:"Synthetic request accepted"}]};
}
const base="2026-11-12T08:46:18.000Z";
function sample(id:string,reference:string,beneficiary:string,amountMinor:number,from:Currency,to:Currency,
 status:State,scenario:Scenario,provider:string,note:string):Payment{
 const sequence:State[]=status==="returned"?["created","quoted","approved","submitted","in_transit","returned"]:
 status==="on_hold"?["created","quoted","approved","submitted","on_hold"]:
 status==="in_transit"?["created","quoted","approved","submitted","in_transit"]:
 status==="completed"?["created","quoted","approved","submitted","in_transit","completed"]:["created"];
 return {id,reference,beneficiary,amountMinor,from,to,status,scenario,provider,purpose:"Supplier invoice",
 createdAt:base,timeline:sequence.map((state,i)=>({id:"evt_"+id+"_"+i,state,
 at:new Date(Date.parse(base)+i*540000).toISOString(),label:i===sequence.length-1?note:
 ({created:"Intent created",quoted:"Eligible routes priced",approved:"Approved in sandbox",submitted:"Instruction sent to sandbox partner",
 in_transit:"Partner reports payout in progress",completed:"Partner reports completion",returned:"Payout returned",on_hold:"Partner compliance hold",failed:"Payout failed"} as Record<State,string>)[state],
 source:i===0?"Clearline Connect":i<3?"Clearline test mode":"Sandbox provider",
 evidence:i>=3?"Partner-reported sandbox event; not independent settlement proof":"Synthetic test-mode event"})),
 nextAction:scenario==="returned"?"Check beneficiary details before reissuing the payment.":scenario==="hold"?"Your compliance team must review the document request.":scenario==="delay"?"Wait for additional testnet block confirmations.":undefined};
}
export function initialWorkspace():Workspace{
 const payments=[
  sample("pi_8f3k2t90","INV-2026-137","Maya Components Pte Ltd",4821537,"SGD","PHP","created","happy","Unassigned","Payment intent created"),
  sample("pi_3p6x92wa","INV-2026-141","Redwood Supplies Ltd",1278490,"USD","SGD","returned","returned","Harbour FX (sandbox)","Returned: beneficiary account details rejected"),
  sample("pi_6q1m5y48","INV-2026-145","Eastport Trading",883950,"SGD","USD","on_hold","hold","Northline Payments (sandbox)","On hold: supporting invoice requested"),
  sample("pi_2d8b9x71","INV-2026-149","Stonebridge Exports",642783,"USDC","USD","in_transit","delay","USDC on Base Sepolia (testnet)","Awaiting testnet finality"),
  sample("pi_7j4e8n20","INV-2026-126","Oakwell Engineering",2465137,"SGD","PHP","completed","happy","Northline Payments (sandbox)","Partner reports payout completed")
 ];
 const events:LedgerEvent[]=[
  {paymentId:payments[4].id,reference:payments[4].reference,amountMinor:2465137,currency:"SGD",source:"Northline settlement export (fictional)"},
  {paymentId:"unmatched",reference:"INV-2026-008",amountMinor:14893,currency:"SGD",source:"Harbour statement (fictional)"}
 ];
 return {payments,events};
}
export function quoteFor(input:{amountMinor:number;currency:Currency;destinationCurrency:Currency;kycTier:number}):Quote[]{
 if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0)throw Error("Invalid amount");
 const exp="2026-11-13T10:15:00+08:00";
 const list:Quote[]=[
 {id:"qt_nl91",provider:"Northline Payments (sandbox)",route:"Fiat · local payout",rate:"42.1738",fee:"SGD 18.45",eta:"Within 2 hours",expiresAt:exp,eligible:true},
 {id:"qt_hf28",provider:"Harbour FX (sandbox)",route:"Fiat · correspondent",rate:"42.1651",fee:"SGD 12.75",eta:"Next business day",expiresAt:exp,eligible:true},
 {id:"qt_us67",provider:"USDC on Base Sepolia (testnet)",route:"Stablecoin · testnet",rate:"42.1284",fee:"SGD 7.92",eta:"After confirmation",expiresAt:exp,eligible:true},
 {id:"qt_ex01",provider:"Eastern Corridor (sandbox)",route:"Fiat · restricted",rate:"—",fee:"—",eta:"—",expiresAt:exp,eligible:false,reason:"KYC tier 3 required"}
 ];
 return list.map(q=>(input.kycTier<2&&q.eligible)?{...q,eligible:false,reason:"KYC tier 2 required"}:q);
}
export function reconcile(payments:Payment[],events:LedgerEvent[]){
 const byRef=new Map(payments.map(p=>[p.reference,p]));
 const rows=events.map(e=>{
  const p=byRef.get(e.reference);
  const match=Boolean(p&&p.id===e.paymentId&&p.amountMinor===e.amountMinor&&p.from===e.currency);
  return {reference:e.reference,paymentId:p?.id??"—",status:match?"matched":"exception",
   reason:!p?"Unmatched reference":p.id!==e.paymentId?"Payment ID mismatch":
    p.from!==e.currency?"Currency mismatch":p.amountMinor!==e.amountMinor?"Amount discrepancy":"Reference and source amount agree (unverified)",
   amountMinor:e.amountMinor,source:e.source};
 });
 return rows;
}
export const liquidity=(x:{balanceMinor:number;safeguardedMinor:number;pendingMinor:number;bufferMinor:number})=>
 x.balanceMinor-x.safeguardedMinor-x.pendingMinor-x.bufferMinor;
export function explain(p:Payment){
 if(p.status==="returned")return "Harbour FX reported the payout returned. Beneficiary details were rejected. Your operations team should verify the account details before reissuing.";
 if(p.status==="on_hold")return "Northline Payments placed this payout on hold and requested supporting invoice documents. Your compliance team decides how to respond.";
 if(p.scenario==="delay")return "The testnet transfer has been reported but is waiting for finality confirmations. No independent bank settlement has been verified.";
 if(p.status==="completed")return "The sandbox provider reported completion. A settlement statement has not been independently verified.";
 if(p.status==="created")return "Payment intent created. No quote has been accepted and no payout instruction has been sent.";
 return "The sandbox partner is processing the instruction. Await its next status event; Clearline does not hold or settle funds.";
}
async function hmac(payload:string,key:string){
 const enc=new TextEncoder(),cryptoKey=await crypto.subtle.importKey("raw",enc.encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("HMAC",cryptoKey,enc.encode(payload));
 return [...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function signWebhook(payload:string,secret:string,at:number){
 if(!Number.isSafeInteger(at)||!secret.startsWith("test_"))throw Error("Test webhook signing only");
 return "t="+at+",v1="+await hmac(at+"."+payload,secret);
}
export async function verifyWebhook(payload:string,secret:string,header:string,at:number){
 const expected=await signWebhook(payload,secret,at);
 if(expected.length!==header.length)return false;
 let diff=0;for(let i=0;i<header.length;i++)diff|=expected.charCodeAt(i)^header.charCodeAt(i);
 return diff===0;
}
export const formatAmount=(minor:number,currency:Currency)=>new Intl.NumberFormat("en-SG",{style:"currency",currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(minor/100);

export function settlementEventFor(p:Payment):LedgerEvent{
 if(p.status!=="completed")throw Error("No completion observation exists");
 return {paymentId:p.id,reference:p.reference,amountMinor:p.amountMinor,
  currency:p.from,source:"Fictional sandbox provider completion export (unverified)"};
}
export type LiquidityRow={
 provider:string;currency:Currency;balanceMinor:number;safeguardedMinor:number;
 pendingMinor:number;bufferMinor:number;freeMinor:number;
};
export function liquiditySnapshots(payments:Payment[]):LiquidityRow[]{
 const base:Omit<LiquidityRow,"freeMinor">[]=[
  {provider:"Northline Payments (sandbox)",currency:"SGD",balanceMinor:11248673,
   safeguardedMinor:1854217,pendingMinor:982338,bufferMinor:480000},
  {provider:"Harbour FX (sandbox)",currency:"USD",balanceMinor:6427843,
   safeguardedMinor:1100000,pendingMinor:1723634,bufferMinor:450000},
  {provider:"USDC on Base Sepolia (testnet)",currency:"USDC",balanceMinor:1756282,
   safeguardedMinor:0,pendingMinor:83057,bufferMinor:100000}
 ];
 return base.map(row=>{
  const newPending=payments.filter(p=>p.provider===row.provider&&p.from===row.currency&&
   p.createdAt!=="2026-11-12T08:46:18.000Z"&&
   ["submitted","in_transit","on_hold"].includes(p.status))
   .reduce((sum,p)=>sum+p.amountMinor,0);
  const pendingMinor=row.pendingMinor+newPending;
  return {...row,pendingMinor,
   freeMinor:liquidity({...row,pendingMinor})};
 });
}
