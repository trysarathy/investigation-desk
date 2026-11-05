'use strict';
(() => {
const $=id=>document.getElementById(id), base='/api/trade/instruments';
let me, items=[], selected=null, seq=0, inFlight=false;
const el=(tag,txt,cls)=>{const n=document.createElement(tag);if(txt!=null)n.textContent=txt;if(cls)n.className=cls;return n;};
const key=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
const fmt=v=>v==null?'—':typeof v==='object'?v.display||JSON.stringify(v):String(v);
const plain=s=>String(s||'').replaceAll('_',' ');
function notice(msg='',bad=false){$('notice').textContent=msg;$('notice').classList.toggle('error',bad);}
function error(e){notice(e.message||'Request unsuccessful.',true);}
async function request(path,body){
 const opt={credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
 if(body!==undefined){opt.method='POST';opt.headers['Content-Type']='application/json';opt.headers['X-CSRF-Token']=me.csrf;opt.body=JSON.stringify(body);}
 const response=await fetch(path,opt);let result={};try{result=await response.json();}catch{}
 if(!response.ok){if(response.status===401){$('tools').hidden=true;$('space').hidden=true;selected=null;$('register').replaceChildren();$('detail').replaceChildren();$('identity').textContent='';}
 throw new Error(result.error?.message||'Request failed ('+response.status+').');}return result;
}
function btn(s,cb,quiet=false){let b=el('button',s,'btn'+(quiet?' btn-quiet':''));b.type='button';b.onclick=cb;return b;}
function show(title,desc){let box=$('detail');box.replaceChildren(el('h2',title));if(desc)box.append(el('p',desc,'muted'));return box;}
function facts(rows){let dl=el('dl');for(const [k,v] of rows){dl.append(el('dt',k),el('dd',fmt(v)));}return dl;}
function field(grid,label,name,type='text',options={}){
 let l=el('label',null,'lc-field'+(options.wide?' lc-wide':''));l.append(el('span',label));let inp;
 if(Array.isArray(type)){inp=el('select');for(const v of type){let o=el('option',v);o.value=v;inp.append(o);}}
 else if(type==='area')inp=el('textarea');else{inp=el('input');inp.type=type;}
 inp.name=name;inp.required=options.optional!==true;if(options.placeholder)inp.placeholder=options.placeholder;if(options.value!=null)inp.value=options.value;
 l.append(inp);grid.append(l);return inp;
}
function form(box,label,go){let f=el('form'), grid=el('div',null,'lc-fields'), s=el('button',label,'btn');s.type='submit';f.append(grid,s);box.append(f);
 let idem=key(), prior=null;f.onsubmit=async e=>{e.preventDefault();if(inFlight||!f.reportValidity())return;const data=Object.fromEntries(new FormData(f).entries()),encoded=JSON.stringify(data);if(prior!==null&&prior!==encoded)idem=key();prior=encoded;inFlight=true;s.disabled=true;notice();
 try{await go(data,idem);}catch(err){error(err);}finally{s.disabled=false;inFlight=false;}};return grid;}
function registry(){let r=$('register');r.replaceChildren();if(!items.length){r.append(el('p','No credits in this organization yet.','lc-empty muted'));return;}
 for(const i of items){let b=el('button',null,'lc-instrument');b.type='button';b.setAttribute('aria-current',String(i.id===selected?.id));b.append(el('strong',i.reference||i.id),el('small',plain(i.state||i.status)));b.onclick=()=>open(i.id).catch(error);r.append(b);}}
async function refresh(){items=(await request(base)).instruments;registry();}
async function open(id){let epoch=++seq, data=await request(base+'/'+encodeURIComponent(id));if(epoch!==seq)return;selected=data;registry();detail();}
function clearSelection(){seq++;selected=null;registry();notice();}
function preview(){clearSelection();let box=show('Preview a message','Read-only sandbox parser. A documentary credit and a payment instruction are different instruments; no message is sent or executed.');
 let grid=form(box,'Preview fields',async d=>{const value=await request('/api/trade/messages/preview',{kind:d.kind,raw:d.raw});out.textContent=JSON.stringify(value,null,2);notice('Preview complete. Nothing was issued or sent.');});
 field(grid,'Profile','kind',['mt700','pacs.008.001.08']);field(grid,'Message body','raw','area',{wide:true});let out=el('pre');box.append(out);}
const currencies=['USD','SGD','EUR','GBP','HKD','JPY'];
const labels={open_funding_case:'Open funding assessment',issue:'Issue simulated credit',present:'Record presentation',examine:'Run structural checks',accept:'Record reviewer acceptance',request_waiver:'Request applicant waiver',record_waiver:'Record waiver evidence',accept_waiver:'Accept with waiver',refuse:'Record refusal',request_financing_review:'Hand off financing review'};
const notes={open_funding_case:'Copy the accepted supplier terms into a new case. Supply a separate quote, contract and funding window. This does not approve an advance.',issue:'Record issuance in this sandbox only; no undertaking is sent.',present:'Enter the time on the record. Deadline checks use server receipt time, not this reported time. Document references do not establish authenticity or title.',examine:'Check the dates, amount, currency and required document types. A bank reviewer must still examine the documents.',accept:'Record the reviewer’s decision. No payment is initiated.',request_waiver:'Open a waiver request; this does not resolve any finding.',record_waiver:'Identify the applicant response. The reviewer makes the acceptance decision.',accept_waiver:'Record the reviewer’s separate acceptance based on waiver evidence.',refuse:'Record simulated refusal with reasons; no authenticated notice is sent.',request_financing_review:'Hand off the pending review task created on acceptance. No approval, draw or discount is recorded.'};
function create(){clearSelection();let box=show('New documentary credit','Create a draft for another reviewer. Enter fixed UTC cutoffs from the agreed terms.');
 let grid=form(box,'Create draft',async(d,idem)=>{d.required_documents=d.required_documents.split(',').map(s=>s.trim()).filter(Boolean);if(!d.presentation_deadline_at)delete d.presentation_deadline_at;const result=await request(base,{...d,idempotency_key:idem});await refresh();await open(result.id);notice('Draft created.');});
 field(grid,'Credit reference','reference');field(grid,'Currency','currency',currencies);field(grid,'Applicant','applicant');field(grid,'Beneficiary','beneficiary');field(grid,'Issuing bank','issuing_bank');field(grid,'Advising bank','advising_bank');field(grid,'Credit amount (major units)','amount','text',{placeholder:'12500.00'});
 field(grid,'Expiry (ISO timestamp with offset)','expires_at','text',{placeholder:'2030-06-30T17:00:00+08:00'});field(grid,'Presentation deadline (optional; defaults to expiry)','presentation_deadline_at','text',{optional:true,placeholder:'2030-06-25T17:00:00+08:00'});field(grid,'Required document types, comma-separated','required_documents','text',{value:'invoice, bill_of_lading'});}
function valueAmt(r){return r.amount?.text||r.amount?.display||r.currency+' '+r.amount_minor+' (minor units)';}
function detail(){
 let r=selected, box=show(r.reference), tag=el('p',plain(r.status),'lc-tag');box.append(tag,facts([['Applicant',r.applicant],['Beneficiary',r.beneficiary],['Issuing bank',r.issuing_bank],['Advising bank',r.advising_bank],['Credit amount',valueAmt(r)],['Presentation deadline',r.presentation_deadline_at],['Credit expiry',r.expires_at],['Required records',r.required_documents.join(', ')]]));
 if(r.presentation){box.append(el('h3','Presentation'),facts([['Presented',r.presentation.presented_at],['Recorded',r.presentation.recorded_at],['Claimed amount',valueAmt(r.presentation)]]));for(const doc of r.presentation.documents)box.append(el('p',plain(doc.kind)+' · '+doc.reference+(doc.issuer?' · '+doc.issuer:''),'lc-evidence'));}
 if(r.findings.length){box.append(el('h3','Discrepancies'));for(const f of r.findings)box.append(el('p',plain(f.code)+' · '+f.field+': expected '+fmt(f.expected)+'; observed '+fmt(f.observed),'lc-feedback'));}
 if(r.financing_review)box.append(el('h3','Financing review'),facts([['Review task',plain(r.financing_review.status)],['Created',r.financing_review.created_at],['Funds moved','No']]));
 if(r.funding_case){const a=el('a','Open funding case '+r.funding_case.id);a.href='/#/case/'+encodeURIComponent(r.funding_case.id);box.append(a);}
 box.append(el('h3','Next action'));if(!r.actions.length)box.append(el('p','No action is available for your role at this stage.','muted'));const row=el('div',null,'btn-row');for(const a of r.actions)row.append(btn(labels[a]||plain(a),()=>action(a)));box.append(row,el('h3','Decision history'));
 for(const ev of r.events){let line=el('details',null,'lc-evidence');line.append(el('summary',plain(ev.action)+' · '+ev.known_at),facts([['Actor',ev.actor_id],['Role',ev.role],['Effective at',ev.effective_at],['Result',plain(ev.status)]]));if(ev.payload?.reason)line.append(el('p',ev.payload.reason));box.append(line);}
 box.append(btn('Refresh instrument',()=>open(r.id).catch(error),true));}
function action(a){const r=selected;let box=show(labels[a],notes[a]);const grid=form(box,labels[a],async(d,idem)=>{
 if(a==='examine'){const manual={};let has=false;for(const k of ['field','expected','observed','evidence_ref']){manual[k]=d[k].trim();if(manual[k])has=true;delete d[k];}if(has){if(Object.values(manual).some(v=>!v))throw new Error('To record a manual finding, complete all four observation fields.');d.manual_findings=[manual];}}
 if(a==='present'){d.documents=d.documents.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{const [kind,reference,issuer,sha256,...extra]=s.split('|').map(x=>x.trim());if(!reference||extra.length)throw new Error('Use: kind | reference | optional issuer | optional digest.');return {kind,reference,...(issuer?{issuer}:{}),...(sha256?{sha256}:{})};});}
 await request(base+'/'+encodeURIComponent(r.id)+'/commands',{action:a,payload:d,version:r.version,idempotency_key:idem});await refresh();await open(r.id);notice(labels[a]+' recorded.');});
 if(a==='open_funding_case'){for(const [k,l] of Object.entries({funding_amount:'Amount required in funding currency',funding_currency:'Funding currency',quote_ref:'Quote reference',contract_ref:'Funding agreement reference',deadline_at:'Supplier deadline (ISO with offset)',deadline_tz:'Supplier deadline time zone',window_a_at:'Funding window opens (ISO with offset)',window_a_cutoff_at:'Funding cutoff (ISO with offset)'}))field(grid,l,k,k==='funding_currency'?currencies:'text',k==='deadline_tz'?{value:'Asia/Singapore'}:{});}
 if(a==='present'){field(grid,'Presentation currency','currency',currencies,{value:r.currency});field(grid,'Presented amount (major units)','amount');field(grid,'Presented at (ISO timestamp with offset)','presented_at','text',{placeholder:'2030-06-23T14:00:00+08:00'});field(grid,'Document metadata: one line per item. Enter type | reference | optional issuer | optional SHA-256.','documents','area',{wide:true,optional:true,placeholder:'invoice | INV-001 | Seller\nbill_of_lading | BL-010 | Carrier'});}
 if(a==='examine'){field(grid,'Optional examiner observation: field','field','text',{optional:true});field(grid,'Expected value','expected','text',{optional:true});field(grid,'Observed value','observed','text',{optional:true});field(grid,'Evidence reference','evidence_ref','text',{optional:true});}
 if(['accept','refuse','request_waiver','accept_waiver'].includes(a))field(grid,'Reviewer rationale','reason','area',{wide:true});if(a==='record_waiver')field(grid,'Waiver evidence reference','evidence_ref');box.append(btn('Back to instrument',()=>open(r.id).catch(error),true));}
$('new').onclick=create;$('preview').onclick=preview;
(async()=>{try{me=await request('/api/me');$('identity').textContent=me.user.name+' · '+me.user.role;$('tools').hidden=false;$('new').hidden=me.user.role!=='operator';$('space').hidden=false;await refresh();const requested=new URLSearchParams(location.search).get('id');if(requested)await open(requested);else if(items.length)await open(items[0].id);else show('No instrument selected','Create a draft to start a new documentary credit, or preview an incoming message.');}
 catch(e){error(e);if(!me)$('notice').append(' ',Object.assign(el('a','Sign in to the funding desk'),{href:'/'}));}})();
})();
