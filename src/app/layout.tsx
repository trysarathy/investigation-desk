import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { searchIndex } from "@/lib/view";
import { loadWorkspace } from "@/lib/workspace/live";

export const metadata: Metadata = {
  title: "Investigation desk",
  description: "Stablecoin payment investigation desk (prototype, sample data)",
};

// Applies the saved theme before first paint so dark mode never flashes light.
const themeScript = `try{var t=localStorage.getItem("desk.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The sidebar must not call uploaded data "fabricated" (real-data test, 24 Oct 2026).
  const { data } = await loadWorkspace();
  const workspace = process.env.OFFLINE_REPLAY_DIR
    ? { name: "Replay mode", badge: "Recorded chain data", title: "Offline: chain answers are recorded real responses (24–25 Oct 2026), not live lookups. Files A and B are the uploaded files." }
    : data.demo || (!data.fileA && !data.fileB)
    ? { name: "Workspace", badge: "Sample deposit cases", title: "The deposit cases in the queue are fabricated samples. Payment requests carry their own label: demo ones say so on every page." }
    : { name: "Your workspace", badge: "Uploaded files", title: "Chain data is looked up live. Files A and B are the files uploaded in Settings → Data. The sample cases in the queue stay fabricated." };
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Shell index={searchIndex()} workspace={workspace}>{children}</Shell>
      </body>
    </html>
  );
}
