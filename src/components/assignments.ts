"use client";

import { useCallback, useEffect, useState } from "react";

// Prototype only: assignments live in this browser. Real ownership lands with auth in week 5.
export const ME = "Me";
const KEY = "desk.assignments";

export function useAssignments() {
  const [owners, setOwners] = useState<Record<string, string>>({});
  useEffect(() => {
    try { setOwners(JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch {}
  }, []);
  const assign = useCallback((id: string) => {
    setOwners((o) => {
      const next = { ...o, [id]: ME };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return { owners, assign };
}
