// Regenerates docs/design/screenshots deterministically (fixed viewports, DPR 1, reduced motion, fonts loaded).
// Usage, after `npx next build` in marketing/:
//   NODE_PATH=$(npm root -g) node docs/design/capture-screenshots.cjs marketing/out docs/design/screenshots
// then shrink each PNG to a 128-colour palette without dithering (Pillow: quantize(128, MEDIANCUT, dither NONE), optimize=True).
// Serves out/ on port 3484 and stops it when done. Chromium path: this environment's chromium-1194.
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const root=process.argv[2],dest=process.argv[3];
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split(/[?#]/)[0]);let f=path.join(root,u);
 if(u.endsWith('/'))f=path.join(f,'index.html'); else if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=f+'.html';
 if(!fs.existsSync(f)){r.writeHead(404);return r.end('nf')} const t={'.html':'text/html','.css':'text/css','.js':'application/javascript','.woff2':'font/woff2','.woff':'font/woff','.jpg':'image/jpeg','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'; r.writeHead(200,{'content-type':t});fs.createReadStream(f).pipe(r)}).listen(3484);
const shots=[['/',1440,900,'home-1440.png'],['/',390,844,'home-390.png'],['/developers',1440,900,'developers-1440.png'],['/developers',390,844,'developers-390.png'],['/',1440,900,'product-view-1440.png','.iv']];
(async()=>{const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
 for(const [pg,w,h,name,sel] of shots){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1,reducedMotion:'reduce'});
  await p.goto('http://127.0.0.1:3484'+pg,{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);
  if(sel) await p.locator(sel).first().screenshot({path:path.join(dest,name)}); else await p.screenshot({path:path.join(dest,name)});
  console.log(name);await p.close()}
 await b.close();srv.close()})();
