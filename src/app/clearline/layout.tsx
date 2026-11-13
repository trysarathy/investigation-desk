import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tokens.css";
import AppShell from "@/components/clearline/AppShell";
import { WorkspaceProvider } from "@/components/clearline/workspace";
import { ConsoleBoundary } from "@/components/clearline/ConsoleBoundary";

export const metadata: Metadata = {
  title: { default: "Clearline console — test mode", template: "%s · Clearline test mode" },
  description: "A fictional, test-mode preview of Clearline Connect and Control. No real payment execution.",
};

export default function ClearlineLayout({ children }: { children: ReactNode }) {
  return (
    <div className="cl">
      <ConsoleBoundary>
        <WorkspaceProvider>
          <AppShell>{children}</AppShell>
        </WorkspaceProvider>
      </ConsoleBoundary>
    </div>
  );
}
