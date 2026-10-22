import {expect,it} from 'vitest';import {aggregateSignals,type Contribution} from '../src/lib/intelligence/signals';
const row=(workspace:string):Contribution=>({workspace,day:'2026-10-22',chain:'tron',pattern:'provider_outage'});
it('requires explicit viewer consent and three distinct OTHER companies',()=>{
 const rows=['a','a','b','c','d'].map(row),opt=new Set(['a','b','c','d']);
 expect(aggregateSignals(rows,'a',new Set(),'2026-10-22')).toEqual([]);
 expect(aggregateSignals(rows.slice(0,4),'a',opt,'2026-10-22')).toEqual([]);
 expect(aggregateSignals(rows,'a',opt,'2026-10-22')).toEqual([{day:'2026-10-22',chain:'tron',pattern:'provider_outage',otherCompanies:3}]);
 expect(aggregateSignals(rows,'a',new Set(['a','b','c']),'2026-10-22')).toEqual([]);
});
it('never exposes contributing workspace identifiers',()=>{
 const result=aggregateSignals(['private-a','private-b','private-c'].map(row),'viewer',new Set(['viewer','private-a','private-b','private-c']),'2026-10-22');
 expect(JSON.stringify(result)).not.toContain('private-');
});
