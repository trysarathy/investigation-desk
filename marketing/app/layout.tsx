import type { Metadata, Viewport } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/500.css";
import "./tokens.css";
import "./globals.css";
import Header from "@/components/Header";
import { Footer } from "@/components/Shared";
import { SITE_URL } from "@/lib/site";

const description = "Clearline connects payment instructions, provider events and financial evidence, so operations teams can understand what happened and what needs attention. Early product with a fictional-data sandbox.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Clearline | Every payment. One clear answer.", template: "%s | Clearline" },
  description,
  applicationName: "Clearline",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", siteName: "Clearline", url: "/", title: "Clearline | Every payment. One clear answer.", description,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Clearline. Money moves. Context gets lost." }],
  },
  twitter: { card: "summary_large_image", title: "Clearline | Every payment. One clear answer.", description, images: ["/opengraph-image"] },
};
export const viewport: Viewport = { themeColor: "#101827", width: "device-width", initialScale: 1 };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-SG">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
