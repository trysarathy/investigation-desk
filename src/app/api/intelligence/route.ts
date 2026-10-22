import {intelligence,setConsent,contribute} from '@/lib/intelligence/service';
import {PATTERNS} from '@/lib/intelligence/signals';
export async function GET(){return Response.json(intelligence(),{headers:{'Cache-Control':'no-store'}});}
export async function POST(req:Request){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'Cross-origin mutation refused'},{status:403});const b=await req.json();
 if(typeof b.enabled==='boolean')setConsent(b.enabled,'local-admin');
 else if(PATTERNS.includes(b.pattern)&&['tron','ethereum','bsc'].includes(b.chain)){try{contribute(b.pattern,b.chain,'local-admin');}catch{return Response.json({error:'Opt in first'},{status:409});}}
 else return Response.json({error:'Only enumerated public patterns accepted; no free text or addresses'},{status:400});
 return Response.json(intelligence());}
