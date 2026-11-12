import type {Metadata} from "next";
export const metadata:Metadata={title:"Connect API — Clearline test mode",description:"The developer API for fictional payment intents, routes and event timelines."};
const examples=[
 {title:"Create intent",path:"POST /api/clearline/test/intents",summary:"Draft a fictional payment instruction. No partner is contacted.",body:'{"amount":"48215.37","currency":"SGD","destinationCurrency":"PHP","beneficiary":"Supplier Alpha","purpose":"Invoice","reference":"INV-2026-137"}'},
 {title:"Request quotes",path:"POST /api/clearline/test/quotes",summary:"Three illustrated eligible routes and one excluded route with the reason.",body:'{"amountMinor":4821537,"currency":"SGD","destinationCurrency":"PHP","kycTier":2}'},
 {title:"Advance state",path:"POST /api/clearline/test/transitions",summary:"Include the complete synthetic payment object from the previous response and an allowed target state.",body:'{"payment":{"id":"pi_test_example","status":"created","timeline":[],"reference":"INV-2026-137","beneficiary":"Supplier Alpha","purpose":"Invoice","from":"SGD","to":"PHP","amountMinor":4821537,"scenario":"happy","provider":"Unassigned","createdAt":"2026-11-13T00:00:00Z"},"to":"quoted"}'},
 {title:"Create signed test event",path:"POST /api/clearline/test/webhooks",summary:"Returns a sample HMAC signature and simulated delivery outcome. Nothing is sent outside the server.",body:'{"type":"payout.completed","paymentId":"pi_test_example"}'}
];
const dark={background:"#1b1f1d",color:"#dff2e4",borderRadius:5,padding:19,overflowX:"auto" as const,fontSize:11,lineHeight:1.8};
export default function Docs(){
 return <div style={{background:"#f5f6f4",minHeight:"100vh",color:"#1b1f1d",fontFamily:"Inter,system-ui,sans-serif",fontSize:13}}>
 <header style={{background:"#fff",borderBottom:"1px solid #e0e6df",padding:"18px max(22px, calc((100vw - 1080px)/2))",display:"flex",justifyContent:"space-between"}}>
  <a href="/clearline" style={{fontWeight:800,fontSize:19,textDecoration:"none",color:"#2e6b4f"}}>clearline.</a>
  <span style={{background:"#e3efe8",color:"#2e6b4f",fontSize:10,padding:"6px 10px",borderRadius:4}}>TEST MODE / API REFERENCE</span>
 </header>
 <main style={{maxWidth:1080,margin:"0 auto",padding:"45px 22px 70px"}}>
 <div style={{fontSize:10,letterSpacing:1.4,color:"#79847d",fontWeight:800}}>DEVELOPERS / CONNECT</div>
 <h1 style={{fontSize:31,letterSpacing:-1,margin:"8px 0"}}>Build on one payment lifecycle.</h1>
 <p style={{maxWidth:720,color:"#68766b",lineHeight:1.7}}>Create a payment intent, compare eligible routes, simulate partner status updates and inspect the timeline. These endpoints are public synthetic examples, not a payment service.</p>
 <p><a href="/clearline" style={{color:"#2e6b4f",fontWeight:700}}>← Back to Clearline Console</a></p>
 <div style={{background:"#fff9ec",border:"1px solid #eaddc6",padding:16,borderRadius:6,margin:"25px 0"}}><strong>No real execution.</strong> Do not send confidential customer or beneficiary details. The test key is public; requests are stateless, illustrative and not persisted on the server.</div>
 <section style={{background:"#fff",border:"1px solid #e1e7df",padding:22,borderRadius:6,marginBottom:18}}>
  <h2>Quickstart</h2><p>Send Authorization: Bearer cl_test_demo and Content-Type: application/json.</p>
  <pre style={dark}>{'curl -X POST "$BASE/api/clearline/test/intents" \\\n -H "Authorization: Bearer cl_test_demo" \\\n -H "Content-Type: application/json" \\\n -d ' + "'"+examples[0].body+"'"}</pre>
 </section>
 <section style={{background:"#fff",border:"1px solid #e1e7df",padding:22,borderRadius:6,marginBottom:18}}>
 <h2>Payment states</h2>
 <pre style={{...dark,background:"#f6f8f5",color:"#1b1f1d"}}>{"created → quoted → approved → submitted → in_transit → completed\n                                      ↘ on_hold / failed / returned"}</pre>
 <p>Only the allowed transitions are accepted. A partner-reported completion is not independently verified settlement.</p>
 </section>
 {examples.map(e=><section key={e.path} style={{background:"#fff",border:"1px solid #e1e7df",padding:22,borderRadius:6,marginBottom:18}}>
 <h2 style={{margin:"0 0 8px"}}>{e.title}</h2><code style={{color:"#2e6b4f"}}>{e.path}</code><p style={{color:"#68766b"}}>{e.summary}</p>
 <pre style={{...dark,background:"#f6f8f5",color:"#1b1f1d"}}>{e.body}</pre>
 </section>)}
 <section style={{background:"#fff",border:"1px solid #e1e7df",padding:22,borderRadius:6}}>
 <h2>Webhooks and errors</h2><p>Signature: HMAC-SHA256 of timestamp + "." + exact payload, format t=timestamp,v1=hex. Example signing secret is public; no real outbound delivery, retry queue or replay protection is provided.</p>
 <p>401: missing test key. 404: unknown endpoint. 422: invalid fields or forbidden transition. Errors include a short message and a suggested fix.</p>
 <p style={{color:"#68766b"}}>Clearline does not hold funds, make compliance decisions or perform payout execution in this preview.</p>
 </section></main></div>;
}