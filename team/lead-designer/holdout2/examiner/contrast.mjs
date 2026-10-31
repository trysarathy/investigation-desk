// Examiner's own WCAG 2.x contrast measurement. Usage: node contrast.mjs
// Composites rgba / color-mix(in srgb, X p%, transparent) over the surface underneath.
const hex = h => { h = h.replace('#',''); return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); };
const lin = c => { c/=255; return c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const L = rgb => 0.2126*lin(rgb[0])+0.7152*lin(rgb[1])+0.0722*lin(rgb[2]);
export const ratio = (a,b) => { const [x,y]=[L(a),L(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
export const mix = (fg, p, bg) => fg.map((c,i)=>Math.round(c*p + bg[i]*(1-p)));
const r = (a,b) => ratio(typeof a==='string'?hex(a):a, typeof b==='string'?hex(b):b).toFixed(2);
const light = { canvas:'#f7f7f5', panel:'#ffffff', panel2:'#fafaf9', text:'#17181c', text2:'#5b5e66', text3:'#8a8d94', border:'#e4e4e0', borderStrong:'#d2d2cc', accent:'#3b5bdb', accentText:'#ffffff', accentSoft:'#edf1fd', green:'#1f7a3d', greenSoft:'#e9f5ec', amber:'#8a5a00', amberSoft:'#fdf3dc', red:'#b42318', redSoft:'#fdecea', focus:'#3b5bdb' };
const dark  = { canvas:'#111215', panel:'#18191d', panel2:'#1d1e23', text:'#ececee', text2:'#a4a7ae', text3:'#767982', border:'#2a2b31', borderStrong:'#383a41', accent:'#6b86f0', accentText:'#0d1020', accentSoft:'#1e2440', green:'#5cc98a', greenSoft:'#15291e', amber:'#e8b45a', amberSoft:'#2e2512', red:'#f1877d', redSoft:'#351a18', focus:'#8aa0f5' };
const surfaces = ['canvas','panel','panel2','accentSoft','amberSoft','greenSoft','redSoft'];
const fgs = ['text','text2','text3','accent','green','amber','red'];
for (const [name,t] of [['LIGHT',light],['DARK',dark]]) {
  console.log(`\n== ${name}: rows = foreground, cols = surface`);
  console.log('fg'.padEnd(10)+surfaces.map(s=>s.padStart(11)).join(''));
  for (const f of fgs) console.log(f.padEnd(10)+surfaces.map(s=>r(t[f],t[s]).padStart(11)).join(''));
  // composited cases
  const cited = mix(hex(t.accentSoft), 0.45, hex(t.panel));
  console.log(`timeline li.cited bg (accent-soft 45% over panel) = rgb(${cited}); text-3 on it ${r(t.text3,cited)}; text-2 ${r(t.text2,cited)}`);
  console.log(`btn-primary accent-text on accent ${r(t.accentText,t.accent)}`);
  console.log(`chip pressed: canvas on text ${r(t.canvas,t.text)}`);
  console.log(`UI: border on panel ${r(t.border,t.panel)}; border-strong on panel ${r(t.borderStrong,t.panel)}; border-strong on canvas ${r(t.borderStrong,t.canvas)}`);
  console.log(`focus on panel ${r(t.focus,t.panel)}; focus on canvas ${r(t.focus,t.canvas)}; focus on accent-soft ${r(t.focus,t.accentSoft)}; focus on accent (btn-primary ring offset sits on page) n/a`);
  console.log(`track: border bar on panel2 ${r(t.border,t.panel2)}; green bar on panel2 ${r(t.green,t.panel2)}; accent bar on panel2 ${r(t.accent,t.panel2)}`);
  console.log(`disabled btn opacity .5 text over panel: ${r(mix(hex(t.text),0.5,hex(t.panel)),t.panel)}`);
  console.log(`chip .count opacity .7 text on panel ${r(mix(hex(t.text),0.7,hex(t.panel)),t.panel)}`);
}
// Candidate "fixed" greys for --text-3 (light)
console.log('\n== Candidate --text-3 replacements (light)');
for (const g of ['#8a8d94','#767982','#737680','#6f727a','#6b6e76','#686b73','#5b5e66']) {
  console.log(g, ['canvas','panel','panel2','accentSoft','amberSoft','greenSoft','redSoft'].map(s=>`${s} ${r(g,light[s])}`).join(' | '), `| cited ${r(g, mix(hex(light.accentSoft),0.45,hex(light.panel)))}`);
}
// Website (dark, Tailwind @theme) tokens
const w = { ink:'#0a0c11', panel:'#11141b', panel2:'#161a23', fg:'#eceef4', muted:'#a3abba', faint:'#8a93a3', accent:'#8ea2ff', accentStrong:'#6e7df0', good:'#5fd3a0', warn:'#f5b85c', bad:'#f28b82' };
console.log('\n== WEBSITE (website-fixes globals.css @theme)');
for (const f of ['fg','muted','faint','accent','accentStrong','good','warn','bad']) console.log(f.padEnd(13), ['ink','panel','panel2'].map(s=>`${s} ${r(w[f],w[s])}`).join(' | '));
console.log('white on accent-strong', r('#ffffff',w.accentStrong), '| ink on accent', r(w.ink,w.accent), '| ink on accent-strong', r(w.ink, w.accentStrong));
const line = mix([255,255,255],0.08,hex(w.ink)), lineS = mix([255,255,255],0.14,hex(w.ink));
console.log('line(8% white) on ink', r(line,w.ink), '| line-strong(14%) on ink', r(lineS,w.ink), '| line-strong on panel', r(mix([255,255,255],0.14,hex(w.panel)),w.panel));
