import type { Metadata } from "next";

/** Per-page metadata with canonical URL and Open Graph/Twitter cards (image is the shared generated card). */
export function pageMeta(title: string, description: string, path: string): Metadata {
  const full = title + " | Clearline";
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Clearline",
      url: path,
      title: full,
      description,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Clearline. Money moves. Context gets lost." }],
    },
    twitter: { card: "summary_large_image", title: full, description, images: ["/opengraph-image"] },
  };
}
