import type { DepositChain } from '../types';
export interface ScanTransfer {
 id:string; hash:string; chain:DepositChain; from:string; to:string; contract:string; symbol:string; amount:string; at:string;
 source:string; evidenceHash:string; signal:'contract_mismatch'|'zero_value'|'none';
}
export interface ScanReport {
 id:string; company:string; addresses:{chain:DepositChain;address:string}[]; days:number; startedAt:string; finishedAt?:string;
 status:'running'|'complete'|'partial'|'unavailable'; demo:boolean; pages:number; completedAddresses:number;
 transfers:ScanTransfer[]; errors:string[]; coverage:string[];
}
