export type Status = "created"|"quoted"|"approved"|"submitted"|"in_transit"|"completed"|"failed"|"returned"|"on_hold";
export type Event = { at:string; status:Status; detail:string; source:string };
export type Payment = { id:string; reference:string; beneficiary:string; amount:number; currency:string; provider:string; status:Status; scenario:string; events:Event[] };
export const transitions: Record<Status,Status[]> = {
 created:["quoted"],quoted:["approved"],approved:["submitted","on_hold"],submitted:["in_transit","failed","on_hold"],
 in_transit:["completed","failed","returned","on_hold"],on_hold:["in_transit","failed","returned"],
 completed:[],failed:[],returned:[]
};
export const routes = [
 {id:"northline",name:"Northline Payments (sandbox)",fee:18.37,fx:0.7712,eta:"1–2 business days",eligible:true},
 {id:"harbour",name:"Harbour FX (sandbox)",fee:24.83,fx:0.7731,eta:"Under 2 hours",eligible:true},
 {id:"base",name:"USDC on Base Sepolia (testnet)",fee:3.16,fx:0.7704,eta:"Pending testnet finality",eligible:true},
 {id:"restricted",name:"Meridian Corridor (sandbox)",fee:13.77,fx:0.7752,eta:"Same day",eligible:false,reason:"KYC tier insufficient for this route"}
];
export function move(p:Payment,status:Status,detail:string,source="Clearline"):Payment {
 if(!transitions[p.status].includes(status))throw new Error("Forbidden transition: "+p.status+" → "+status);
 return {...p,status,events:[...p.events,{at:new Date().toISOString(),status,detail,source}]};
}
export function createPayment(beneficiary:string,amount:number,reference:string,scenario="happy"):Payment{
 if(!beneficiary.trim()||!reference.trim()||!Number.isFinite(amount)||amount<=0)throw new Error("Enter valid beneficiary, reference and positive amount.");
 const id="pi_"+Math.random().toString(36).slice(2,10);
 return {id,beneficiary,reference,amount,currency:"SGD",provider:"Not selected",status:"created",scenario,
 events:[{at:new Date().toISOString(),status:"created",detail:"Payment intent recorded in test mode.",source:"Clearline"}]};
}
export function quote(p:Payment){return move(p,"quoted","Three eligible quotes available; one route excluded by KYC tier.");}
export function approve(p:Payment,route:string){const r=routes.find(x=>x.id===route);
 if(p.status!=="quoted"||!r?.eligible)throw new Error("Choose an eligible quote.");
 return move({...p,provider:r.name},"approved","Operator selected "+r.name+" and approved the instruction.","Operator");
}
export function next(p:Payment):Payment{
 if(p.status==="approved")return move(p,"submitted","Sandbox partner accepted the instruction.","Provider");
 if(p.status==="submitted")return move(p,p.scenario==="hold"?"on_hold":"in_transit",p.scenario==="hold"?"Documents requested by partner.":p.scenario==="finality"?"Testnet transfer observed; not final.":"Provider acknowledged processing.","Provider");
 if(p.status==="on_hold")return move(p,"in_transit","Simulated partner released hold after human review.","Operator");
 if(p.status==="in_transit"&&p.scenario!=="finality")return move(p,p.scenario==="returned"?"returned":"completed",p.scenario==="returned"?"Receiving bank rejected beneficiary details.":"Provider reported payout completed.","Provider");
 return p;
}
export function verdict(p:Payment){
 if(p.status==="returned")return ["Payout returned","Beneficiary details were rejected by the simulated receiving bank.","Verify the beneficiary before retrying."];
 if(p.status==="on_hold")return ["Documents requested","The sandbox partner paused this payment; no compliance decision was made by Clearline.","Ask the account owner to supply the requested evidence."];
 if(p.scenario==="finality"&&p.status==="in_transit")return ["Waiting for finality","A synthetic Base Sepolia event was observed. No confirmed settlement evidence exists.","Wait for the testnet confirmation policy."];
 if(p.status==="completed")return ["Provider confirmed completion","The sandbox execution partner reported completion. Clearline did not hold or transfer funds.","Match the provider confirmation to a statement."];
 return ["Payment "+p.status.replaceAll("_"," "),p.provider==="Not selected"?"No route is selected yet.":p.provider+" is the executing sandbox partner.",p.status==="created"?"Request quotes.":p.status==="quoted"?"Choose a route.":p.status==="approved"?"Submit the instruction.":"Review the latest event."];
}
export function seeded():Payment[]{
 const values:[string,number,string,string][]=[
 ["Vela Trading Pte Ltd",48215.37,"INV-SG-1847","happy"],
 ["Estuary Equipment Co",12608.49,"INV-SG-1848","returned"],
 ["Portside Components Ltd",73194.28,"INV-SG-1849","hold"],
 ["Kestrel Parts GmbH",9382.61,"INV-SG-1850","finality"]];
 return values.map(([name,amount,ref,scenario],i)=>{
 let p=createPayment(name,amount,ref,scenario);
 p={...p,id:"pi_8f3k20"+i};p=quote(p);p=approve(p,scenario==="finality"?"base":scenario==="hold"?"harbour":"northline");
 p=next(p);p=next(p);
 if(scenario==="happy"||scenario==="returned")p=next(p);
 return p;
 });
}
export function matchByReference(ps:Payment[],reference:string,amount:number){
 const candidates=ps.filter(p=>p.reference===reference);
 return candidates.length===1&&candidates[0].amount===amount?candidates[0]:null;
}
export function freeCash(balance:number,safeguarded:number,pending:number,buffer:number){return balance-safeguarded-pending-buffer;}
