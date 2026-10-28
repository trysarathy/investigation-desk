import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { site } from "@/lib/site";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { UtmCapture } from "@/components/UtmCapture";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}: get paid in digital dollars without the detective work`, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  openGraph: {
    type: "website",
    siteName: site.name,
    title: `${site.name}: get paid in digital dollars without the detective work`,
    description: site.description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Clearline: get paid in digital dollars without the detective work" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};

export const viewport: Viewport = { themeColor: "#0a0c11", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-fg focus:px-4 focus:py-2 focus:text-ink">
          Skip to content
        </a>
        {children}
        <UtmCapture />
        <SiteAnalytics />
      </body>
    </html>
  );
}
