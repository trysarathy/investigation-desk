import { correctCase } from '@/lib/platform/store';
import { VERDICT_LABELS } from '@/lib/catalogue';
import type { Code } from '@/lib/types';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
  const origin=req.headers.get('origin'); if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'Cross-origin mutation refused'},{status:403});
  const body=await req.json();
  if(!Object.hasOwn(VERDICT_LABELS,body.actual)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)return Response.json({error:'Valid diagnosis and review reason required'},{status:400});
  try {return Response.json(correctCase((await params).id,body.actual as Code,body.reason,'local-analyst'));}catch{return Response.json({error:'Case not found'},{status:404});}
}
