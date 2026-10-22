import {database,getDocument,putDocument,audit,workspaceId,atomic} from './store';
export function retentionDays(){return getDocument<{days:number}>('retention','current')?.days??90;}
export function setRetention(days:number,actor:string){if(![7,30,90].includes(days))throw Error('Choose 7, 30 or 90 days');putDocument('retention','current',{days});audit('retention.changed',String(days),actor);}
/** Removes expired evidence documents. Audit metadata is kept separately; backups require operator deletion. */
export function sweepRetention(now=Date.now(),actor='system'){
 return atomic(()=>{
 const cutoff=now-retentionDays()*86400000;
 const rows=database().prepare("SELECT kind,id,body FROM documents WHERE workspace=? AND kind IN ('case','regression','scan','alert','slack-request','intelligence-contribution')").all(workspaceId()) as {kind:string;id:string;body:string}[];
 let deleted=0;
 for(const row of rows){const body=JSON.parse(row.body);const timestamp=body.createdAt??body.startedAt??body.label?.at??body.day;const expired=timestamp&&Date.parse(timestamp)<cutoff;
 // Slack replay responses hold no evidence but have no timestamp: discard at each sweep.
 if(expired||row.kind==='slack-request'){database().prepare('DELETE FROM documents WHERE workspace=? AND kind=? AND id=?').run(workspaceId(),row.kind,row.id);deleted++;}}
 audit('retention.swept',String(deleted),actor);return {deleted,cutoff:new Date(cutoff).toISOString(),remainingScope:'Legacy CSV, bulk files, raw cache and external backups require operator lifecycle deletion. Do not claim complete erasure.'};
 });
}
