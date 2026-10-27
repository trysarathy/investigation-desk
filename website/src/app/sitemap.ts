import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "demo/", "privacy/"].map((p) => ({ url: `${site.url}/${p}`, changeFrequency: "monthly", priority: p ? 0.5 : 1 }));
}
