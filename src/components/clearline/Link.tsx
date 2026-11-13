"use client";
/**
 * next/link with prefetch off. Every console route is dynamic; with prefetch on, about 1 in 10
 * clicks in a production build (`next start`) fetched the route but never committed the
 * navigation (measured with Playwright, 2026-11-13). Without prefetch the click always navigates.
 */
import NextLink from "next/link";
import type { ComponentProps } from "react";
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
