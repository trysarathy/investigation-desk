// Usage: NODE_PATH=<playwright modules> node tests/browser/mentor.cjs EXPORT_DIR SHOT_DIR
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const assert = require('assert/strict');
const site = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3]);
const journey = ['request_advance','approve_reserve','draw','instruct','sim_accept','sim_credit',
  'advance_clock','advance_clock','sim_receipt','sim_pay_partial','match_repayment',
  'sim_pay_balance','match_repayment','close'];
function view(hash) {
  const [cid, sid] = hash.slice(1).split('/');
  const raw = fs.readFileSync(path.join(site, `states/lc-${cid}-${sid}.js`), 'utf8');
  return JSON.parse(raw.slice(raw.indexOf('deliver(') + 8, raw.lastIndexOf(')')));
}
(async () => {
  fs.mkdirSync(shots, {recursive:true});
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox']});
  try {
    for (const width of [1280,390]) {
      const page = await browser.newPage({viewport:{width,height:844}});
      await page.goto(pathToFileURL(path.join(site,'index.html')).href);
      await page.waitForSelector('#lc-headline');
      assert.equal(await page.locator('#lc-case option').count(), 1);
      assert.equal(await page.locator('a[href*="replay"],a[href*="trade"],a[href*="records"]').count(),0);
      for (const [i,id] of journey.entries()) {
        const current = view(new URL(page.url()).hash);
        const action = current.actions.find(a => a.id===id);
        assert.ok(action && action.enabled);
        assert.match(await page.locator('#lc-label').innerText(), /simulat/i);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
        if (i===0 || id==='sim_receipt') await page.screenshot({path:path.join(shots,`${width}-${i}.png`), fullPage:true});
        await page.getByRole('button',{name:action.label,exact:true}).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(s=>location.hash.endsWith('/'+s),action.next);
        const after = view(new URL(page.url()).hash);
        if (['sim_credit','sim_receipt','sim_pay_partial'].includes(id)) {
          assert.equal(after.exposure.amount,'SGD 135,532.50');
          assert.ok((await page.locator('body').innerText()).includes(after.exposure.amount));
        }
      }
      assert.equal(view(new URL(page.url()).hash).exposure.status,'ended');
      await page.getByRole('button',{name:'Reset',exact:true}).click();
      await page.getByRole('button',{name:'Request advance',exact:true}).click();
      await page.getByRole('button',{name:'Decline',exact:true}).click();
      await page.waitForSelector('#lc-no-actions');
      assert.equal(view(new URL(page.url()).hash).exposure,null);
      await page.screenshot({path:path.join(shots,`${width}-refusal.png`),fullPage:true});
      await page.close();
    }
    console.log('Mentor journey passes at 1280 and 390 px');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
