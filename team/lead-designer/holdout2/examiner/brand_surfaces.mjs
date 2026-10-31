// Examiner: contrast of the deck (pitch/src/deck_style.py on origin/pitch-deck) and whitepaper
// (whitepaper/style.tex on origin/whitepaper) colours, plus candidate dark --text-3 values for the product.
import { r } from './wcag.mjs';
const deck = { INK:'#0B0E14', CARD:'#151A24', LINE:'#2A3140', WHITE:'#F2F4F7', MUTED:'#A3AAB6', FAINT:'#767E8C', ACC:'#8EA2FF', ACC2:'#B9C6FF', RED:'#FF8A7F' };
console.log('\n== DECK');
for (const f of ['WHITE','MUTED','FAINT','ACC','ACC2','RED','LINE']) console.log(f.padEnd(6), `INK ${r(deck[f],deck.INK)} | CARD ${r(deck[f],deck.CARD)}`);
const wp = { white:'#FFFFFF', ink:'#0A0C11', accent:'#6E7DF0', accentbg:'#F4F5FF', muted:'#5B6272', rule:'#C9CDD6', vgreen:'#2F7D5B', aamber:'#A8670F', gred:'#B23A30' };
console.log('\n== WHITEPAPER (print, white page)');
for (const f of ['ink','accent','muted','rule','vgreen','aamber','gred']) console.log(f.padEnd(8), `white ${r(wp[f],wp.white)} | accentbg ${r(wp[f],wp.accentbg)}`);
console.log('\n== Candidate dark --text-3 (product)');
const dk = { canvas:'#111215', panel:'#18191d', panel2:'#1d1e23', accentSoft:'#1e2440', amberSoft:'#2e2512', greenSoft:'#15291e', redSoft:'#351a18' };
for (const g of ['#767982','#80838c','#868991','#8b8e96','#8f929a','#a4a7ae']) console.log(g, Object.entries(dk).map(([k,v])=>`${k} ${r(g,v)}`).join(' | '));
console.log('\n== Light --text-3 minimum that clears 4.5 on every light surface');
const lt = { canvas:'#f7f7f5', panel:'#ffffff', panel2:'#fafaf9', accentSoft:'#edf1fd', amberSoft:'#fdf3dc', greenSoft:'#e9f5ec', redSoft:'#fdecea' };
for (const g of ['#6b6e76','#6a6d75','#696c74','#686b73','#676a72','#65686f']) { const vals = Object.values(lt).map(v=>+r(g,v)); console.log(g, 'min', Math.min(...vals).toFixed(2), '| vs text-2 #5b5e66 luminance step', r(g,'#5b5e66')); }
console.log('\n== Print link/accent candidates (whitepaper: white page and statusbox accentbg #F4F5FF)');
for (const g of ['#6E7DF0','#5865E0','#4F5BD5','#4A56CF','#3B5BDB']) console.log(g, `white ${r(g,'#FFFFFF')} | accentbg ${r(g,'#F4F5FF')}`);
console.log('\n== Deck FAINT candidates (INK #0B0E14 / CARD #151A24)');
for (const g of ['#767E8C','#7E8694','#838B99','#8A93A3']) console.log(g, `INK ${r(g,'#0B0E14')} | CARD ${r(g,'#151A24')}`);
console.log('\n== Product chip .count: accent at opacity .7 on panel (a.chip inherits a{color:accent})');
import { hex, mix } from './wcag.mjs';
console.log('light', r(mix(hex('#3b5bdb'),0.7,hex('#ffffff')),'#ffffff'), '| dark', r(mix(hex('#6b86f0'),0.7,hex('#18191d')),'#18191d'));
