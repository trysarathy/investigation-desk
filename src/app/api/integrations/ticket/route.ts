import {equalSecret} from '@/lib/integrations/verify';
import {documents,audit,type CaseRecord} from '@/lib/platform/store';
export async function GET(req:Request){
 const token=process.env.TICKET_API_TOKEN;
 if(!token||!equalSecret(req.headers.get('authorization')??'',`Bearer ${token}`))return Response.json({error:'Unauthorized installation'},{status:401});
 const q=new URL(req.url).searchParams.get('q')?.trim();if(!q||q.length>128)return Response.json({error:'One exact case ID or transaction hash required'},{status:400});
 const matches=documents<CaseRecord>('case').filter(c=>c.id===q||c.facts.input.value===q.replace(/^0x/,'').toLowerCase());
 if(matches.length!==1)return Response.json({error:matches.length?'Multiple customers share this transaction. Use an exact case ID.':'No stored investigation. Open the desk to investigate.'},{status:matches.length?409:404});
 const r=matches[0],v=r.view.verdicts.at(-1)!;audit('ticket.evidence_viewed',r.id,'ticket-installation');
 return Response.json({caseId:r.id,code:v.code,verdict:v.label,confidence:v.confidence,checkedAt:v.checkedAt,nextStep:v.nextStep,evidence:v.evidence.filter(e=>v.evidenceIds.includes(e.id)),replyDraft:v.confidence==='High'?v.reply?.text:null,reviewRequired:v.confidence!=='High',demo:r.view.demo??false},{headers:{'Cache-Control':'no-store'}});
}
