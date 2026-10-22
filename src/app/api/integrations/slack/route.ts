import {verifySlack} from '@/lib/integrations/verify';
import {documents,getDocument,putDocument,audit,type CaseRecord} from '@/lib/platform/store';
import {createHash} from 'node:crypto';
import {normaliseInput} from '@/lib/normalise';
export const runtime='nodejs';
export async function POST(req:Request){
 const body=await req.text();if(body.length>16000)return Response.json({error:'Too large'},{status:413});
 if(!verifySlack(body,req.headers.get('x-slack-request-timestamp'),req.headers.get('x-slack-signature'),process.env.SLACK_SIGNING_SECRET??''))return Response.json({error:'Invalid signature'},{status:401});
 const p=new URLSearchParams(body);
 if(!process.env.SLACK_TEAM_ID||p.get('team_id')!==process.env.SLACK_TEAM_ID)return Response.json({error:'Workspace not installed'},{status:403});
 const origin=process.env.PUBLIC_APP_URL;if(!origin?.startsWith('https://'))return Response.json({response_type:'ephemeral',text:'Secure app URL is not configured.'});
 const key=createHash('sha256').update(body).digest('hex');const cached=getDocument('slack-request',key);if(cached)return Response.json(cached);
 const q=(p.get('text')??'').trim();if(q.length>128)return Response.json({response_type:'ephemeral',text:'Paste one transaction hash, public address or customer reference.'});
 const input=normaliseInput(q),record=documents<CaseRecord>('case').find(c=>c.facts.input.value===input.value);
 const url=new URL(record?`/library/${record.id}`:'/investigate',origin);if(!record)url.searchParams.set('q',q);
 // Keep private company verdicts behind authenticated app access, even inside Slack.
 const response={response_type:'ephemeral',text:record?`Saved evidence is available. Open the authenticated investigation: ${url}`:`Open an investigation: ${url}. No diagnosis has been inferred from the command.`};
 putDocument('slack-request',key,response);audit('slack.investigate',record?.id??'new',p.get('user_id')??'slack');return Response.json(response);
}
