import {ImageResponse} from "next/og";
export const dynamic = "force-static";
export const alt="Clearline — Every advance. Traceable. Explainable. Controlled.";
export const size={width:1200,height:630};
export const contentType="image/png";
export default function Image(){return new ImageResponse(
 <div style={{display:"flex",width:"100%",height:"100%",background:"#F5F6F4",color:"#1B1F1D",padding:"66px 75px",flexDirection:"column",justifyContent:"space-between",fontFamily:"sans-serif"}}>
  <div style={{display:"flex",alignItems:"center",gap:18}}><div style={{display:"flex",alignItems:"center",justifyContent:"center",width:58,height:58,borderRadius:12,background:"#2E6B4F",color:"white",fontFamily:"serif",fontSize:47,fontStyle:"italic"}}>C</div><div style={{display:"flex",fontSize:36,fontWeight:700,letterSpacing:-1}}>Clearline</div></div>
  <div style={{display:"flex",flexDirection:"column",gap:24}}><div style={{fontSize:14,letterSpacing:3,color:"#2E6B4F",fontWeight:700}}>OPERATIONAL CONTROL FOR CROSS-BORDER PROVIDERS</div><div style={{display:"flex",fontSize:68,fontWeight:700,letterSpacing:-3,lineHeight:1.07,maxWidth:1030}}>Every advance.<br/>Traceable. Explainable.<br/>Controlled.</div><div style={{display:"flex",fontSize:26,color:"#2E6B4F"}}>Clearline prepares. Treasury decides.</div></div>
  <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #CAD8CD",paddingTop:19,fontSize:14,color:"#66736B"}}><span>Working prototype · Fictional data</span><span>Singapore</span></div>
 </div>,size);
}
