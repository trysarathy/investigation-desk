import { after } from 'next/server';
import { newScan,runScan } from '@/lib/scan/run';
import { normaliseInput } from '@/lib/normalise';
import { tronToHex } from '@/lib/address';
import type { ScanReport } from '@/lib/scan/types';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(req:Request){
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'Cross-origin mutation refused'},{status:403});
 let b;try{b=await req.json();}catch{return Response.json({error:'Invalid JSON'},{status:400});}
 if(typeof b.company!=='string'||!b.company.trim()||b.company.length>80||![7,14,30].includes(b.days)||!Array.isArray(b.addresses)||b.addresses.length<1||b.addresses.length>5)return Response.json({error:'Provide a company label, 1–5 addresses and a 7, 14 or 30 day window'},{status:400});
 const addresses:ScanReport['addresses']=[];
 for(const a of b.addresses){
   if(!['tron','ethereum','bsc'].includes(a.chain)||typeof a.address!=='string')return Response.json({error:'Invalid address entry'},{status:400});
   const kind=normaliseInput(a.address).kind;
   if(!b.demo&&kind!==(a.chain==='tron'?'tron_address':'evm_address'))return Response.json({error:'Address does not match chain'},{status:400});
   if(!b.demo&&a.chain==='tron')try{tronToHex(a.address);}catch{return Response.json({error:'Invalid Tron checksum'},{status:400});}
   if(!addresses.some(x=>x.chain===a.chain&&x.address.toLowerCase()===a.address.toLowerCase()))addresses.push(a);
 }
 const report=newScan(b.company.trim(),addresses,b.days,b.demo===true);after(()=>runScan(report));return Response.json(report,{status:202});
}
