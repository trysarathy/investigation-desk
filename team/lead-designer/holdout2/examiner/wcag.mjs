// WCAG 2.x relative-luminance contrast helpers (examiner's own).
export const hex = h => { h = h.replace('#',''); return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); };
const lin = c => { c/=255; return c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const L = rgb => 0.2126*lin(rgb[0])+0.7152*lin(rgb[1])+0.0722*lin(rgb[2]);
export const ratio = (a,b) => { const [x,y]=[L(a),L(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
export const mix = (fg, p, bg) => fg.map((c,i)=>Math.round(c*p + bg[i]*(1-p)));
export const r = (a,b) => ratio(typeof a==='string'?hex(a):a, typeof b==='string'?hex(b):b).toFixed(2);
