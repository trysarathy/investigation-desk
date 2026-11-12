import {describe,it,expect} from "vitest";
import {createIntent,initialWorkspace,settlementEventFor,liquiditySnapshots,reconcile,transition} from "@/lib/clearline/core";
describe("Clearline Control derives from Connect payment events",()=>{
 it("records a fictional provider event only after reported completion",()=>{
  let p=createIntent({amount:"48215.37",currency:"SGD",destinationCurrency:"PHP",
   beneficiary:"Fictional Supplier",purpose:"Supplier invoice",reference:"INV-2026-153"});
  p={...p,provider:"Northline Payments (sandbox)"};
  for(const s of ["quoted","approved","submitted","in_transit","completed"] as const)p=transition(p,s,"Sandbox state");
  const event=settlementEventFor(p);
  expect(event.paymentId).toBe(p.id);
  expect(event.reference).toBe(p.reference);
  expect(event.amountMinor).toBe(4821537);
  expect(reconcile([p],[event])[0].status).toBe("matched");
 });
 it("refuses settlement evidence for uncompleted instructions",()=>{
  expect(()=>settlementEventFor(initialWorkspace().payments[0])).toThrow();
 });
 it("new sandbox payout is reflected in the provider free-cash calculation",()=>{
  const state=initialWorkspace();
  const original=liquiditySnapshots(state.payments).find(x=>x.provider==="Northline Payments (sandbox)")!;
  let p=createIntent({amount:"48215.37",currency:"SGD",destinationCurrency:"PHP",
   beneficiary:"Fictional Supplier",purpose:"Supplier invoice",reference:"INV-2026-153"});
  p={...p,provider:"Northline Payments (sandbox)"};
  for(const s of ["quoted","approved","submitted"] as const)p=transition(p,s,"Synthetic");
  const after=liquiditySnapshots([...state.payments,p]).find(x=>x.provider===p.provider)!;
  expect(after.pendingMinor-original.pendingMinor).toBe(4821537);
  expect(original.freeMinor-after.freeMinor).toBe(4821537);
 });
 it("the sandbox never presents a partner event as independently verified settlement",()=>{
  const p=initialWorkspace().payments.find(p=>p.status==="completed")!;
  const event=settlementEventFor(p);
  expect(event.source).toMatch(/fictional/i);
 });
});