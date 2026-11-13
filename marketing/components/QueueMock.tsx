const rows=[
 {id:"ADV-001",entity:"C-001 / S-014",amount:"48,215.37",status:"Awaiting review",tone:"review"},
 {id:"ADV-002",entity:"C-002 / S-008",amount:"12,608.49",status:"Partly repaid",tone:"partial"},
 {id:"ADV-003",entity:"C-003 / S-021",amount:"73,194.28",status:"Overdue",tone:"overdue"},
 {id:"ADV-004",entity:"C-004 / S-011",amount:"9,384.62",status:"Unmatched cash",tone:"neutral"}
];
export default function QueueMock(){return <div className="relative" aria-label="Illustrative Clearline Funding Desk work queue with fictional data">
 <div className="relative overflow-hidden rounded-[12px] border border-[#D9E2D9] bg-white shadow-panel">
  <div className="flex items-center justify-between border-b border-line px-4 py-3 text-[10px] font-mono tracking-[.08em] text-quiet sm:px-5"><span>CLEARLINE / FUNDING DESK</span><span className="rounded bg-sage px-2 py-1 text-pine">OPERATOR MODE</span></div>
  <div className="flex border-b border-line bg-[#FAFCFA] px-5 py-4"><div><div className="text-[17px] font-semibold tracking-tight">Work queue</div><div className="mt-1 text-[11px] text-quiet">Cases that need a person</div></div><div className="ml-auto rounded-md border border-line bg-white px-3 py-1.5 font-mono text-[10px] text-quiet">4 OPEN</div></div>
  <div className="overflow-x-auto"><table className="w-full min-w-[470px] text-left"><thead><tr className="border-b border-line bg-[#F9FBF9] font-mono text-[9px] uppercase tracking-wider text-quiet"><th className="px-4 py-3 font-medium">Case</th><th className="px-2 py-3 font-medium">Reference</th><th className="px-2 py-3 text-right font-medium">Outstanding (SGD)</th><th className="px-4 py-3 font-medium">State</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-b border-[#EEF0EC] last:border-0"><td className="px-4 py-4 font-mono text-[11px] font-semibold">{r.id}</td><td className="px-2 py-4 font-mono text-[10px] text-quiet">{r.entity}</td><td className="px-2 py-4 text-right font-mono text-[11px] tabular-nums">{r.amount}</td><td className="px-4 py-4"><span className={"whitespace-nowrap rounded-[4px] px-2 py-1 text-[10px] font-medium "+(r.tone==="overdue"?"bg-[#F9E9E7] text-brick":r.tone==="review"?"bg-[#FFF0D5] text-[#895A16]":r.tone==="partial"?"bg-sage text-pine":"bg-[#EEF0EE] text-[#58655B]")}>{r.status}</span></td></tr>)}</tbody></table></div>
  <div className="flex items-center justify-between border-t border-line bg-[#FBFCFB] px-4 py-3 font-mono text-[9px] uppercase tracking-wide text-quiet"><span>As of · fictional dataset</span><span>References, not amount alone</span></div>
 </div>
 <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[.08em] text-quiet">Illustrative interface · Not live provider records</p>
 </div>;}
