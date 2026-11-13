import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("every required marketing page exists",()=>{
 for(const p of ["app/page.tsx","app/replay/page.tsx","app/onchain/page.tsx","app/privacy/page.tsx"])assert.ok(fs.existsSync(path.join(root,p)),p);
});
test("current capabilities and onchain stage are distinct",()=>{
 const home=read("app/page.tsx"),onchain=read("app/onchain/page.tsx");
 assert.match(home,/FICTIONAL DEMO DATA/);assert.match(home,/IN DEVELOPMENT/);
 assert.match(onchain,/TESTNET/);assert.match(onchain,/Safe/);
});
test("contact form cannot submit without valid Formspree configuration",()=>{
 const form=read("components/ContactForm.tsx");
 assert.match(form,/id!==\"FORM_ID\"/);
 assert.match(form,/disabled=\{state===\"sending\"\|\|!enabled\}/);
});
test("all required metadata endpoints present",()=>{
 for(const p of ["app/sitemap.ts","app/robots.ts","app/opengraph-image.tsx","app/icon.svg"])assert.ok(fs.existsSync(path.join(root,p)),p);
});
test("no pretend production integrations",()=>{
 const files=["app/page.tsx","app/replay/page.tsx","app/onchain/page.tsx"];
 for(const file of files){const s=read(file);for(const phrase of ["trusted by 1000","audit-ready","AI-powered","guaranteed returns"])assert.equal(s.toLowerCase().includes(phrase),false,file+" contains "+phrase);}
});
