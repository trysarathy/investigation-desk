import Link from "next/link";
import {Tag} from "@/components/Shared";
const consoleUrl=process.env.NEXT_PUBLIC_PRODUCT_DEMO_URL?.startsWith("https://")?process.env.NEXT_PUBLIC_PRODUCT_DEMO_URL:"https://investigation-desk-git-preview-clearline-conne-737bd4-sarathyv2.vercel.app/clearline";
const products=[
 {title:"Clearline Connect",eyebrow:"THE MONEY-MOVEMENT INTERFACE",desc:"Create fictional payment intents, compare synthetic route quotes and trace partner-reported payment states.",items:["Payment intents and eligible quotes","Unified payment status and evidence","Test-mode API and example webhooks"],note:"Test-mode workflow. No licensed providers are connected."},
 {title:"Clearline Control",eyebrow:"THE FINANCIAL OPERATIONS DESK",desc:"Bring reconciliation, liquidity, funding exposure, holds and exceptions into one operational view.",items:["Reconciliation and exceptions","Funding exposure and repayment tracking","Evidence-led payment investigation"],note:"Synthetic records; Funding Desk remains a separate module."}
];
export default function ConnectControl(){return <section id="connect-control" className="border-y border-line bg-[#F0F4EF] py-[100px]"><div className="container-site">
 <Tag>THE PRODUCT DIRECTION</Tag><div className="mt-6 grid items-end gap-7 lg:grid-cols-[1.1fr_.9fr]"><h2 className="heading-section max-w-[770px]">One operational view across the payment lifecycle.</h2><p className="max-w-[570px] text-[15px] leading-8 text-quiet">Banks, payment providers and stablecoin networks each operate their own rails. Clearline is building the coordination and financial-control interface between them—not a bank or payment custodian.</p></div>
 <div className="mt-12 grid gap-4 md:grid-cols-2">{products.map(p=><article className="rounded-lg border border-[#D1DFD2] bg-white p-8" key={p.title}>
 <span className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-pine">{p.eyebrow}</span><h3 className="mt-5 text-[30px] font-semibold tracking-[-.05em]">{p.title}</h3><p className="mt-4 max-w-lg text-[14px] leading-8 text-quiet">{p.desc}</p>
 <ul className="mt-7 space-y-3 border-t border-line pt-6">{p.items.map(x=><li key={x} className="flex gap-3 text-[13px] text-[#475A4B]"><span className="text-pine">✓</span>{x}</li>)}</ul>
 <p className="mt-7 rounded bg-[#F5F7F3] px-3 py-3 text-[11px] leading-6 text-quiet">{p.note}</p></article>)}</div>
 <div className="mt-8 flex flex-wrap items-center gap-4"><a className="btn btn-primary" href={consoleUrl} target="_blank" rel="noopener noreferrer">Explore Connect + Control test mode ↗</a><Link className="btn btn-outline" href="/replay">Discuss a five-case evaluation →</Link></div>
 </div></section>;}
