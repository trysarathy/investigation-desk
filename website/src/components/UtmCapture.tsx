"use client";
import { useEffect } from "react";

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
const STORE = "clearline.utm";

/** Remembers where a visitor first came from (e.g. ?utm_source=linkedin), so the form can say which channel brought each lead. */
export function UtmCapture() {
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const found = Object.fromEntries(UTM_KEYS.map((k) => [k, q.get(k) || ""]).filter(([, v]) => v));
      if (Object.keys(found).length && !sessionStorage.getItem(STORE)) {
        sessionStorage.setItem(STORE, JSON.stringify({ ...found, landing: window.location.pathname, referrer: document.referrer }));
      }
    } catch {
      /* storage blocked: the form still works, just without the source */
    }
  }, []);
  return null;
}

export function readUtm(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}
