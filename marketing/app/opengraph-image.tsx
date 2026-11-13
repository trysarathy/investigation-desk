import {ImageResponse} from "next/og";
export const dynamic="force-static";
export const alt="Clearline — Every payment. One clear answer.";
export const size={width:1200,height:630};
export const contentType="image/png";
export default function Image(){return new ImageResponse(
 <div style={{display:"flex",width:"100%",height:"100%",background:"#F5F6F4",color:"#1B1F1D",padding:"64px 72px",flexDirection:"column",justifyContent:"space-between",fontFamily:"sans-serif"}}>
 <div style={{display:"flex",alignItems:"center",gap:15}}><div style={{width:54,height:54,borderRadius:10,background:"#2E6B4F",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:44,fontStyle:"italic",fontFamily:"serif"}}>C</div><div style={{display:"flex",fontSize:31,fontWeight:700,letterSpacing:-1}}>clearline.</div></div>
 <div style={{display:"flex",flexDirection:"column",gap:22}}><div style={{color:"#2E6B4F",fontSize:14,letterSpacing:3,fontWeight:700}}>CROSS-BORDER PAYMENT OPERATIONS</div><div style={{display:"flex",fontWeight:700,fontSize:83,letterSpacing:-4,lineHeight:1.04}}>Every payment.<br/>One clear answer.</div><div style={{color:"#53675A",fontSize:24}}>Connect coordinates. Control explains.</div></div>
 <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #CED8CD",paddingTop:19,color:"#637367",fontSize:14}}><span>Working prototype · Fictional data only</span><span>Singapore</span></div>
 </div>,size);
}
