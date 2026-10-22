import 'server-only';
import { randomUUID } from 'node:crypto';
import { audit, putDocument } from '../platform/store';
import { historyPage } from './history';
import type { ScanReport,ScanTransfer } from './types';
export function newScan(company:string,addresses:ScanReport['addresses'],days:number,demo=false):ScanReport {
 const report:ScanReport={id:randomUUID(),company,addresses,days,startedAt:new Date().toISOString(),status:'running',demo,pages:0,completedAddresses:0,transfers:[],errors:[],coverage:['Incoming indexed USDT/USDC-symbol transfer observations only. No mempool or failed-call coverage.','Credit, holds, minimums, intended network and customer ownership require company records.','BNB tokens are bridged; issuer-native authenticity and freeze checks are not assessed.','History may omit event indices. Observations are not exact ledger join keys.']};
 putDocument('scan',report.id,report);audit('scan.started',report.id);return report;
}
export async function runScan(report:ScanReport,fetchPage=historyPage) {
 const end=Date.parse(report.startedAt),start=end-report.days*86400000,deadline=Date.now()+50000;
 try {
  if(report.demo){report.transfers=demoTransfers(report);report.completedAddresses=report.addresses.length;report.pages=1;report.status='complete';}
  else for(const item of report.addresses){
   let cursor:string|undefined;const cursors=new Set<string>();let complete=false;
   try {
    do {
      if(Date.now()>deadline||report.pages>=30)throw Error('Scan budget reached; unscanned history remains');
      const page=await fetchPage(item.chain,item.address,start,end,cursor);report.pages++;
      report.transfers.push(...page.rows);cursor=page.next;complete=page.complete;
      putDocument('scan',report.id,report);
      if(cursor&&cursors.has(cursor))throw Error('Provider repeated a pagination cursor');if(cursor)cursors.add(cursor);
    }while(cursor&&!complete);
    if(complete)report.completedAddresses++;
   }catch(e){report.errors.push(`${item.chain}: ${(e as Error).message}`);}
   putDocument('scan',report.id,report);
  }
  if(!report.demo)report.status=report.completedAddresses===report.addresses.length?'complete':report.transfers.length?'partial':'unavailable';
 }catch{report.status='unavailable';report.errors.push('Scan interrupted');}
 report.finishedAt=new Date().toISOString();putDocument('scan',report.id,report);audit('scan.finished',report.id);return report;
}
function demoTransfers(r:ScanReport):ScanTransfer[]{return Array.from({length:48},(_,i)=>({id:`fictional-${i}`,hash:`fictional-transfer-${String(i+1).padStart(3,'0')}`,chain:'ethereum',from:`Fictional sender ${i+1}`,to:'Fictional Acorn Payments wallet',contract:i<4?'Fictional look-alike token':'Fictional USDC contract',symbol:'USDC',amount:i<4?'0':i<7?'0':String(125+i*23),at:new Date(Date.parse(r.startedAt)-i*3600000).toISOString(),source:'',evidenceHash:'fictional-no-chain-proof',signal:i<4?'contract_mismatch':i<7?'zero_value':'none'}));}
export function scanSummary(r:ScanReport){
 const signals=r.transfers.filter(t=>t.signal!=='none');
 return {observations:r.transfers.length,signals:signals.length,contractMismatch:signals.filter(t=>t.signal==='contract_mismatch').length,zeroValue:signals.filter(t=>t.signal==='zero_value').length,confirmedProblems:null,creditStatus:'not assessed' as const};
}
