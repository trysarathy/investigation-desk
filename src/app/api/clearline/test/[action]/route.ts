import { NextRequest, NextResponse } from "next/server";
import { createIntent, initialWorkspace, quoteFor, transition, signWebhook, type Currency, type Payment, type State } from "@/lib/clearline/core";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const headers={"Cache-Control":"no-store","X-Clearline-Mode":"synthetic-test-only"};
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers});
const error=(message:string,status=422)=>respond({error:{type:"invalid_request",message,help:"Use fictional test data. See /clearline/docs."}},status);
function check(request:NextRequest){
 return request.headers.get("authorization")==="Bearer cl_test_demo" && request.headers.get("content-type")?.startsWith("application/json");
}
async function body(request:NextRequest):Promise<Record<string,unknown>>{
 const text=await request.text();
 if(text.length>12000)throw Error("Test payload exceeds 12 KB");
 const value:unknown=JSON.parse(text);
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("JSON object required");
 return value as Record<string,unknown>;
}
const statusSet=new Set<State>(["quoted","approved","submitted","in_transit","completed","failed","returned","on_hold"]);
export async function GET(request:NextRequest,{params}:{params:Promise<{action:string}>}){
 const {action}=await params;
 if(action!=="payments"&&action!=="health")return error("Unknown endpoint",404);
 if(action==="health")return respond({mode:"test",canMoveMoney:false,service:"Clearline Connect sandbox"});
 if(request.headers.get("authorization")!=="Bearer cl_test_demo")return error("Missing test API key",401);
 return respond({data:initialWorkspace().payments,mode:"synthetic",persistence:"read-only fixtures"});
}
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}){
 const {action}=await params;
 if(!["intents","quotes","transitions","webhooks"].includes(action))return error("Unknown endpoint",404);
 if(!check(request))return error("Use Authorization: Bearer cl_test_demo and application/json",401);
 try{
  const input=await body(request);
  if(action==="intents"){
   if(Object.keys(input).sort().join(",")!=="amount,beneficiary,currency,destinationCurrency,purpose,reference")return error("Exact intent fields required");
   const item=createIntent(input as Parameters<typeof createIntent>[0]);
   return respond({data:item,mode:"synthetic",persisted:false},201);
  }
  if(action==="quotes"){
   if(typeof input.amountMinor!=="number"||typeof input.currency!=="string"||typeof input.destinationCurrency!=="string"||
      typeof input.kycTier!=="number")return error("amountMinor, currency, destinationCurrency, kycTier required");
   const choices=quoteFor(input as {amountMinor:number;currency:Currency;destinationCurrency:Currency;kycTier:number});
   return respond({data:choices,mode:"synthetic",validUntil:"2026-11-13T10:15:00+08:00"});
  }
  if(action==="transitions"){
   if(!input.payment||typeof input.payment!=="object"||!statusSet.has(input.to as State))return error("payment object and allowed to state required");
   const payment=input.payment as Payment;
   if(typeof payment.id!=="string"||!payment.id.startsWith("pi_")||
    !Array.isArray(payment.timeline)||payment.timeline.length>50||
    !["created","quoted","approved","submitted","in_transit","completed","failed","returned","on_hold"].includes(payment.status))return error("Invalid test payment object");
   const updated=transition(payment,input.to as State,"Synthetic "+String(input.to)+" event");
   return respond({data:updated,mode:"synthetic",persisted:false,partnerExecuted:false});
  }
  if(typeof input.type!=="string"||!["intent.created","quote.accepted","payout.submitted","payout.completed","payout.failed","payout.returned"].includes(input.type))return error("Unknown webhook event type");
  const event={id:"evt_test_"+Math.random().toString(36).slice(2,10),type:input.type,
   createdAt:new Date().toISOString(),data:{object:"synthetic_event",paymentId:input.paymentId??"pi_test_8f3k2"}};
  const payload=JSON.stringify(event);
  const signature=await signWebhook(payload,"test_webhook_secret_example_only",Math.floor(Date.now()/1000));
  return respond({data:event,payload,signature,delivery:{attempt:1,result:"synthetic_200",retries:0},persisted:false});
 }catch(e){return error(e instanceof Error?e.message:"Invalid test request");}
}
