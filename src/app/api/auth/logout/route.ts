import {NextResponse} from 'next/server';
export async function POST(req:Request){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'Origin rejected'},{status:403});const r=NextResponse.json({ok:true});r.cookies.set('desk.session','',{httpOnly:true,path:'/',maxAge:0});return r;}
