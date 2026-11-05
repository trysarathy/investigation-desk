'use strict';
(() => {
 const q=s=>document.getElementById(s), el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text??'';return n;};
 let me; const cid=new URLSearchParams(location.search).get('case');
 const endpoint='/api/cases/'+encodeURIComponent(cid)+'/duplicate-review';
 async function api(path,payload){const response=await fetch(path,{cache:'no-store',credentials:'same-origin',method:payload?'POST':'GET',headers:payload?{'Content-Type':'application/json','X-CSRF-Token':me.csrf}:{},body:payload?JSON.stringify(payload):undefined});const data=await response.json();if(!response.ok)throw Error(data.error?.message||'Unable to load record.');return data}
 const labels={possible_duplicate:'Flag for review',confirmed_duplicate:'Confirm internal duplicate',distinct:'Resolve as distinct',reopen:'Reopen decision'};
 function draw(data){
   const out=q('body');out.replaceChildren(el('p',data.scope),el('h2',data.message));
   for(const p of data.candidates){
     const section=el('section');section.className='panel';const go=el('a',p.candidate.id);go.href='/#/case/'+encodeURIComponent(p.candidate.id);section.append(go,el('h3',p.candidate.reference||'No reference'),el('p',p.candidate.importer+' → '+p.candidate.supplier+' · '+p.candidate.payout),el('p',p.signals.join(' · ')),el('p','Disposition: '+p.disposition.replaceAll('_',' ')));
     for(const h of p.history)section.append(el('p',h.known_at+' · '+h.actor_role+' #'+h.actor_id+' · '+h.disposition.replaceAll('_',' ')+' · '+h.reason));
     const resolved=['distinct','confirmed_duplicate'].includes(p.disposition), actions=me.user.role==='reviewer'?(resolved?['reopen']:['distinct','confirmed_duplicate','possible_duplicate']):me.user.role==='operator'&&!resolved?['possible_duplicate']:[];
     if(actions.length){
       const f=el('form'), select=el('select'), note=el('textarea'), button=el('button','Record decision'), l1=el('label','Disposition '),l2=el('label','Reason ');
       for(const a of actions){const o=el('option',labels[a]);o.value=a;select.append(o);}
       l1.append(select);l2.append(note);note.required=true;note.maxLength=1000;button.type='submit';f.append(l1,l2,button);section.append(f);
       let key=crypto.randomUUID();f.oninput=()=>{key=crypto.randomUUID()};
       f.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{const next=await api(endpoint,{candidate_id:p.candidate.id,disposition:select.value,reason:note.value,version:p.version,idempotency_key:key});draw(next);q('notice').textContent='Disposition recorded. No financing action was taken.'}catch(e){q('notice').textContent=e.message;}finally{button.disabled=false;}};
     }
     out.append(section);
   }
 }
 (async()=>{if(!cid)throw Error('Open invoice review from a funding case.');q('back').href='/#/case/'+encodeURIComponent(cid);me=await api('/api/me');draw(await api(endpoint));})().catch(e=>q('notice').textContent=e.message);
})();
