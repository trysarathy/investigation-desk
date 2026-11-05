/* node tests/browser/offline.cjs /absolute/path/to/export */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('file:'))remote.push(r.url())});
 await page.goto(pathToFileURL(path.resolve(process.argv[2],'index.html')).href);
 const go=async(sel)=>{await page.click(sel);await wait()};
 const wait=async()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy')&&document.querySelector('#headline')?.textContent);
 await wait();assert.match(await page.locator('#headline').innerText(),/Keep Friday/);
 assert.ok(!await page.locator('#open-data').isVisible());
 for(const s of await page.locator('#scenario option').evaluateAll(xs=>xs.map(x=>x.value))){
  await page.selectOption('#scenario',s);await wait();
  for(const t of ['friday','monday','retro']){await go('#dt-'+t);
   for(const r of ['0','8']){await go('[data-rate="'+r+'"]');
    assert.ok(await page.locator('#headline').innerText());if(t==='friday')assert.ok(!(await page.content()).includes('78.77'));}
  }
 }
 await page.selectOption('#scenario','reference');await wait();await go('#dt-retro');
 assert.match(await page.locator('#comparison').innerText(),/78.77/);await go('#dt-friday');
 assert.ok(!(await page.content()).includes('78.77'));
 await page.selectOption('#scenario','delayed_receivable');await wait();await go('#dt-monday');assert.match(await page.locator('main').innerText(),/5,382.50/);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 console.log('Offline file:// tester: all 54 scenario/checkpoint/preset states passed; no remote requests or browser errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
