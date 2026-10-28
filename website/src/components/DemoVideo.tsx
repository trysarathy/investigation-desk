"use client";
import { useRef, useState } from "react";

/** The 60-second film. Nothing downloads until someone presses play. Captions are burned into the film. */
export function DemoVideo({ className = "" }: { className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  function play() {
    setStarted(true);
    requestAnimationFrame(() => {
      const v = video.current;
      if (!v) return;
      v.load();
      v.play().catch(() => {});
      v.focus();
    });
  }

  return (
    <div className={`relative aspect-video overflow-hidden rounded-2xl border border-line-strong bg-panel ${className}`}>
      <video
        ref={video}
        className="h-full w-full"
        controls={started}
        playsInline
        preload="none"
        poster="/img/demo-poster-1280.webp"
        aria-label="Clearline demo film, 60 seconds, captions built in. All companies and amounts are fictional."
      >
        {started && <source src="/media/clearline-demo-60s.mp4" type="video/mp4" />}
        {started && <source src="/media/clearline-demo-60s.webm" type="video/webm" />}
      </video>
      {!started && (
        <button
          type="button"
          onClick={play}
          className="group absolute inset-0 grid place-items-center"
          aria-label="Play the 60-second demo film (with sound)"
        >
          <span className="grid h-20 w-20 place-items-center rounded-full bg-fg/95 text-ink shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition group-hover:scale-105 group-hover:bg-white sm:h-24 sm:w-24">
            <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></svg>
          </span>
        </button>
      )}
    </div>
  );
}
