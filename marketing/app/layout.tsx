import type {Metadata,Viewport} from "next";
import "@fontsource/inter/400.css";import "@fontsource/inter/500.css";import "@fontsource/inter/600.css";import "@fontsource/inter/700.css";import "@fontsource/jetbrains-mono/400.css";import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import {Header,Footer} from "@/components/Shared";
const site=process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")?process.env.NEXT_PUBLIC_SITE_URL:"https://clearline.example";
export const metadata:Metadata={
 metadataBase:new URL(site),
 title:{default:"Clearline | Every advance. Traceable. Explainable. Controlled.",template:"%s | Clearline"},
 description:"Operational control for cross-border payment providers. Review advances, record treasury decisions, reconcile repayments and see what needs attention.",
 applicationName:"Clearline",
 robots:{index:true,follow:true},
 openGraph:{type:"website",siteName:"Clearline",title:"Every advance. Traceable. Explainable. Controlled.",description:"Clearline prepares. Treasury decides.",images:[{url:"/opengraph-image",width:1200,height:630,alt:"Clearline — Every advance. Traceable. Explainable. Controlled."}]},
 twitter:{card:"summary_large_image",title:"Clearline | Treasury controls for supplier advances",description:"Clearline prepares. Treasury decides."}
};
export const viewport:Viewport={themeColor:"#F5F6F4",width:"device-width",initialScale:1};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-white focus:p-3">Skip to content</a><Header/>{children}<Footer/></body></html>;}
