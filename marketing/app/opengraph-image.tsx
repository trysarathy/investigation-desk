import {ImageResponse} from "next/og";
export const dynamic="force-static";
export const alt="Clearline — Money moves. Context gets lost.";
export const size={width:1200,height:630};
export const contentType="image/png";
export default function Image(){return new ImageResponse(
 <div style={{display:"flex",width:"100%",height:"100%",background:"#17212D",color:"#F5F1E8",padding:"64px 72px",flexDirection:"column",justifyContent:"space-between",fontFamily:"sans-serif"}}>
 <div style={{display:"flex",alignItems:"center",gap:15}}><div style={{width:54,height:54,borderRadius:10,background:"#E96647",color:"#17212D",display:"flex",alignItems:"center",justifyContent:"center",fontSize:44,fontStyle:"italic",fontFamily:"serif"}}>C</div><div style={{display:"flex",fontSize:31,fontWeight:700,letterSpacing:-1}}>clearline.</div></div>
 <div style={{display:"flex",flexDirection:"column",gap:22}}><div style={{color:"#F7A182",fontSize:14,letterSpacing:3,fontWeight:700}}>CROSS-BORDER PAYMENT OPERATIONS</div><div style={{display:"flex",fontWeight:700,fontSize:75,letterSpacing:-4,lineHeight:1.04}}>Money moves.<br/>Context gets lost.</div><div style={{color:"#D5CAC1",fontSize:24}}>Follow the evidence. Understand the outcome.</div></div>
 <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #53616A",paddingTop:19,color:"#CBD2D4",fontSize:14}}><span>Working prototype · Fictional data only</span><span>Singapore</span></div>
 </div>,size);
}
