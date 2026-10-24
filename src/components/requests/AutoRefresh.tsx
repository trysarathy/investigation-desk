"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page's server data every `ms` while the tab is visible, so status changes appear by themselves. */
export function AutoRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, ms);
    return () => clearInterval(id);
  }, [router, ms]);
  return null;
}
