/** Static export: the whole site is plain HTML/CSS/JS, so it can be hosted anywhere (Vercel free tier). */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Analytics script only when hosted on Vercel: a Git build there sets VERCEL; a direct CLI deploy sets CLEARLINE_ON_VERCEL=1.
  env: { NEXT_PUBLIC_ON_VERCEL: process.env.VERCEL || process.env.CLEARLINE_ON_VERCEL ? "1" : "" },
};
export default nextConfig;
