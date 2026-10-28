/** Static export: the whole site is plain HTML/CSS/JS, so it can be hosted anywhere (Vercel free tier). */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_ON_VERCEL: process.env.VERCEL ? "1" : "" },
};
export default nextConfig;
