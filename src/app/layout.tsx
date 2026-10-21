import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { searchIndex } from "@/lib/view";

export const metadata: Metadata = {
  title: "Investigation desk",
  description: "Stablecoin payment investigation desk (prototype, sample data)",
};

// Applies the saved theme before first paint so dark mode never flashes light.
const themeScript = `try{var t=localStorage.getItem("desk.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Shell index={searchIndex()}>{children}</Shell>
      </body>
    </html>
  );
}
