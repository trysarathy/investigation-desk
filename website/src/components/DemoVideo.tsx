"use client";
import { useEffect, useRef, useState } from "react";

/** The 60-second film. Nothing is downloaded until the player is near the screen. Captions are burned into the film. */
export function DemoVideo({ className = "" }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <div ref={box} className={`relative aspect-video overflow-hidden rounded-2xl border border-line-strong bg-panel ${className}`}>
      <video
        className="h-full w-full"
        controls
        playsInline
        preload="none"
        poster="/img/demo-poster-1280.webp"
        aria-label="Clearline demo film, 60 seconds, captions built in. All companies and amounts are fictional."
      >
        {near && <source src="/media/clearline-demo-60s.mp4" type="video/mp4" />}
      </video>
    </div>
  );
}
