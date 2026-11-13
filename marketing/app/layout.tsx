import type {Metadata,Viewport} from "next";
import "@fontsource/inter/400.css";import "@fontsource/inter/500.css";import "@fontsource/inter/600.css";import "@fontsource/inter/700.css";import "@fontsource/jetbrains-mono/400.css";import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import {Header,Footer} from "@/components/Shared";
const site=process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")?process.env.NEXT_PUBLIC_SITE_URL:"https://clearline-marketing.vercel.app";
export const metadata:Metadata={
 metadataBase:new URL(site),
 title:{default:"Clearline — Know what happened to every payment.",template:"%s | Clearline"},
 description:"Clearline is building the coordination and operations layer for cross-border payments. Explore Connect, Control and a fictional test-mode payment journey.",
 applicationName:"Clearline",
 robots:{index:true,follow:true},
 openGraph:{type:"website",siteName:"Clearline",title:"Clearline — Every payment. One clear answer.",description:"Payment orchestration and financial operations, with evidence at the centre. Explore the fictional test-mode product.",images:[{url:"/opengraph-image",width:1200,height:630,alt:"Clearline — Every payment. One clear answer."}]},
 twitter:{card:"summary_large_image",title:"Clearline — Every payment. One clear answer.",description:"An operational view across cross-border payment rails."}
};
export const viewport:Viewport={themeColor:"#F5F1E8",width:"device-width",initialScale:1};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-white focus:p-3">Skip to content</a><Header/>{children}<Footer/></body></html>;}
