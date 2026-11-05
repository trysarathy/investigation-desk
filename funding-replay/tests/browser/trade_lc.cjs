#!/usr/bin/env node
// Run from funding-replay: node tests/browser/trade_lc.cjs
// Set CHROME_BIN to a compatible executable if Playwright's bundled browser is unavailable.
'use strict';
const {chromium}=require('playwright');
const {spawn,spawnSync}=require('child_process'), fs=require('fs'), os=require('os'), path=require('path'), net=require('net'), assert=require('assert/strict');
const cwd=path.resolve(__dirname,'../..'), now='2030-05-01T09:00:00Z';
async function port(){const s=net.createServer();await new Promise((ok,fail)=>s.once('error',fail).listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
async function seek(p,tag){await p.locator('.lc-tag').filter({hasText:new RegExp('^'+tag+'$')}).waitFor();}
async function clickAction(p,label,fields,status){await p.getByRole('button',{name:label,exact:true}).click();for(const [k,v] of Object.entries(fields)){await p.locator('form [name="'+k+'"]').fill(v);}await p.locator('form button[type=submit]').click();await seek(p,status);}
async function main(){
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'clearline-trade-ui-')),env={...process.env,PILOT_ENV:'test',PILOT_SECRET:'synthetic-trade-suite',PILOT_DB:path.join(tmp,'pilot.sqlite'),PILOT_CLOCK:now};
let server, browser;try{
for(const cmd of ['migrate','seed']){const proc=spawnSync('python3',['-m','pilot.cli',cmd],{cwd,env,encoding:'utf8'});assert.equal(proc.status,0,proc.stderr);}
const n=await port(),base='http://127.0.0.1:'+n;server=spawn('python3',['-m','pilot.cli','serve','--port',String(n)],{cwd,env,stdio:'ignore'});let ready=false;for(let i=0;i<45;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'pilot failed to start');
browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const errors=[];async function signed(role){const context=await browser.newContext(),p=await context.newPage();p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/');await p.locator('#login-email').fill(role+'@harbourline.test');await p.locator('#login-password').fill('pilot-dev-'+role);await p.locator('#login-submit').click();await p.locator('#pd-user:not([hidden])').waitFor();await p.goto(base+'/trade.html');await p.locator('#space:not([hidden])').waitFor();return p;}
const op=await signed('operator'), rev=await signed('reviewer');assert(await rev.locator('#new').isHidden());await op.locator('#new').click();
const fields={reference:'UI-LC-01',applicant:'Local Buyer',beneficiary:'Seller',issuing_bank:'Issuer',advising_bank:'Adviser',amount:'2500.25',expires_at:'2030-06-25T17:00:00Z',required_documents:'invoice, bill_of_lading'};
for(const [k,v] of Object.entries(fields))await op.locator('form [name="'+k+'"]').fill(v);await op.getByRole('button',{name:'Create draft'}).click();await seek(op,'draft');
await rev.reload();await seek(rev,'draft');await clickAction(rev,'Issue simulated credit',{},'issued');await op.reload();await seek(op,'issued');
await clickAction(op,'Record presentation',{amount:'2500.25',presented_at:now,documents:'invoice | INV-001 | Seller\nbill_of_lading | BL-001 | Carrier'},'presented');
await rev.reload();await seek(rev,'presented');await clickAction(rev,'Run structural checks',{},'examined');await clickAction(rev,'Record reviewer acceptance',{reason:'Reviewed both identified documents in this simulation.'},'accepted');assert((await rev.locator('#detail').innerText()).includes('awaiting handoff'));
await op.reload();await seek(op,'accepted');await clickAction(op,'Hand off financing review',{},'financing review requested');assert((await op.locator('#detail').innerText()).includes('handed off'));
await op.setViewportSize({width:390,height:844});assert.equal(await op.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);console.log('PASS: two-role LC browser journey: create, issue, present, examine, accept, finance handoff, phone overflow.');
}finally{if(browser)await browser.close();if(server){let exit=new Promise(resolve=>server.once('exit',resolve));server.kill();await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,2000))]);}fs.rmSync(tmp,{recursive:true,force:true});}}
main().catch(e=>{console.error(e);process.exitCode=1;});
