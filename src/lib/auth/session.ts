export type Role='analyst'|'lead'|'admin';
export interface Session {actor:string;role:Role;expires:number;}
const bytes=(s:string)=>new TextEncoder().encode(s);
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
export async function signSession(session:Session,secret:string){const payload=btoa(JSON.stringify(session));const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return payload+'.'+hex(await crypto.subtle.sign('HMAC',key,bytes(payload)));}
export async function verifySession(token:string|undefined,secret:string,now=Date.now()):Promise<Session|null>{
 if(!token||secret.length<32)return null;try{const [payload,sig]=token.split('.');if(!payload||!sig||!/^[a-f0-9]{64}$/.test(sig))return null;const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);const valid=await crypto.subtle.verify('HMAC',key,Uint8Array.from(sig.match(/../g)!,h=>parseInt(h,16)),bytes(payload));if(!valid)return null;const s=JSON.parse(atob(payload));return typeof s.actor==='string'&&['analyst','lead','admin'].includes(s.role)&&Number.isFinite(s.expires)&&s.expires>now&&s.expires<=now+12*3600000?s:null;}catch{return null;}
}
export function requiredRole(path:string,method:string):Role{
 if(path.startsWith('/api/uploads')||path.startsWith('/api/security')||path==='/security'||path.startsWith('/settings')||path.startsWith('/api/intelligence')&&method!=='GET')return 'admin';
 if(path.startsWith('/bulk')||path.startsWith('/api/bulk')||path.startsWith('/api/regressions')||path.endsWith('/adjudicate')||path.endsWith('/pdf'))return 'lead';
 return 'analyst';
}
export function permitted(role:Role,required:Role){return ['analyst','lead','admin'].indexOf(role)>=['analyst','lead','admin'].indexOf(required);}
