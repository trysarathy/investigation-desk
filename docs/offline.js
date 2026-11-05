'use strict';
window.clearlineDemoAPI = async function(path,body){
 const ok=data=>({ok:true,status:200,data});
 if(path==='/api/meta')return ok(window.demoMeta);
 if(path!=='/api/evaluate')throw Error('Samples only');
 const q=JSON.parse(body);
 if(!window.demoMeta.scenarios.some(s=>s.id===q.scenario)||!['friday','monday','retro'].includes(q.decision_time)||!['0','8'].includes(q.funding_rate_pct))throw Error('Unavailable sample');
 return new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.deliver=data=>resolve(ok(data));
   script.onload=()=>script.remove();script.onerror=()=>{script.remove();reject(Error('Extract the entire ZIP before opening.'));};
   script.src='states/'+q.scenario+'-'+q.decision_time+'-'+q.funding_rate_pct+'.js';
   document.head.append(script);
 });
};
