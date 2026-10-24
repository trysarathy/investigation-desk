/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Request bodies pass through the middleware, which by default keeps only the first 10 MB:
    // a larger upload reached the route cut short. This matches REQUEST_MAX_BYTES in
    // src/lib/limits.ts (the 20 MB file limit plus the form around it); a test checks they match.
    middlewareClientMaxBodySize: 21 * 1024 * 1024,
  },
};
export default nextConfig;
