import {NextResponse} from 'next/server';
import {verifyPassword,verifyTotp} from '@/lib/auth/password';
import {signSession,type Role} from '@/lib/auth/session';
import {getDocument,putDocument,audit} from '@/lib/platform/store';
import {createHash} from 'node:crypto';
export async function POST(req:Request){
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'Origin rejected'},{status:403});
 const secret=process.env.SESSION_SECRET??'';if(secret.length<32||!process.env.DESK_USERS)return Response.json({error:'Authentication is not configured'},{status:503});
 const b=await req.json();if(typeof b.id!=='string'||typeof b.password!=='string'||typeof b.otp!=='string'||b.id.length>100)return Response.json({error:'Invalid credentials'},{status:400});
 const key=createHash('sha256').update(b.id).digest('hex'),attempt=getDocument<{count:number;until:number}>('login-attempt',key);
 if(attempt&&attempt.until>Date.now()&&attempt.count>=5)return Response.json({error:'Too many attempts. Try again in 15 minutes.'},{status:429});
 const users=JSON.parse(process.env.DESK_USERS) as {id:string;role:Role;salt:string;passwordHash:string;totpSecret:string}[],user=users.find(u=>u.id===b.id);
 let counter:number|null=null;try{if(user&&verifyPassword(b.password,user.salt,user.passwordHash))counter=verifyTotp(user.totpSecret,b.otp);}catch{/*invalid config fails closed*/}
 const last=getDocument<{counter:number}>('otp-used',key);
 if(!user||counter===null||last&&counter<=last.counter||!['analyst','lead','admin'].includes(user.role)){
 putDocument('login-attempt',key,{count:attempt&&attempt.until>Date.now()?attempt.count+1:1,until:Date.now()+900000});audit('login.failed',key,'anonymous');return Response.json({error:'Invalid credentials'},{status:401});}
 putDocument('otp-used',key,{counter});putDocument('login-attempt',key,{count:0,until:0});
 const token=await signSession({actor:user.id,role:user.role,expires:Date.now()+12*3600000},secret);audit('login.succeeded','session',user.id);
 const r=NextResponse.json({ok:true});r.cookies.set('desk.session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:12*3600});return r;
}
