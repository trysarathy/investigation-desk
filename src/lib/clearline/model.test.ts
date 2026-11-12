import {describe,it,expect} from "vitest";
import {transitions,move,createPayment,quote,approve,next,seeded,matchByReference,freeCash} from "./model";
describe("Clearline transitions",()=>{
 it("rejects every forbidden edge and permits every allowed edge",()=>{
 const states=Object.keys(transitions) as (keyof typeof transitions)[];
 for(const from of states)for(const to of states){
 const p={...createPayment("A",1.43,"R"),status:from};
 if(transitions[from].includes(to))expect(move(p,to,"test").status).toBe(to);
 else expect(()=>move(p,to,"test")).toThrow();
 }
 });
 it("simulates the four payment outcomes",()=>expect(seeded().map(p=>p.status)).toEqual(["completed","returned","on_hold","in_transit"]));
 it("does not match on amount alone",()=>{
 const ps=seeded();
 expect(matchByReference(ps,"WRONG",48215.37)).toBeNull();
 expect(matchByReference(ps,"INV-SG-1847",48215.37)?.id).toBe(ps[0].id);
 });
 it("computes free cash after restrictions",()=>expect(freeCash(90001.35,10200.12,18743.81,5000.43)).toBeCloseTo(56056.99));
 it("requires valid amount",()=>expect(()=>createPayment("A",0,"R")).toThrow());
 it("keeps eligibility enforced",()=>{
 const p=quote(createPayment("A",10,"R"));
 expect(()=>approve(p,"restricted")).toThrow();
 expect(next(next(next(approve(p,"northline")))).status).toBe("completed");
 });
});
