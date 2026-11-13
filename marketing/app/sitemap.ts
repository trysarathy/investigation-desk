import type {MetadataRoute} from "next";
export const dynamic = "force-static";
export default function sitemap():MetadataRoute.Sitemap{
 const site=process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")?process.env.NEXT_PUBLIC_SITE_URL:"https://clearline.example";
 return ["","/replay","/onchain","/privacy"].map((route)=>({url:site+route,changeFrequency:"monthly" as const,priority:route?0.65:1}));
}
