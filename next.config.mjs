// Security headers for every route (QA L2). Next's App Router emits inline bootstrap scripts and the
// root layout has an inline theme script, so script-src keeps 'unsafe-inline' (a nonce-based CSP is a
// tracked follow-up). Dev mode additionally needs 'unsafe-eval' for React Refresh.
const isDev = process.env.NODE_ENV !== 'production';
export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
export const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  webpack(config) {
    // Existing CLI modules use Node-style .js specifiers for TypeScript sources.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    // YAML files are bundled as plain strings at build time (e.g. the OpenAPI document served at
    // /clearline/docs/openapi.yaml), so no route reads the filesystem at runtime.
    config.module.rules.push({ test: /\.ya?ml$/, type: 'asset/source' });
    return config;
  },
  experimental: {
    // Request bodies pass through the middleware, which by default keeps only the first 10 MB:
    // a larger upload reached the route cut short. This matches REQUEST_MAX_BYTES in
    // src/lib/limits.ts (the 20 MB file limit plus the form around it); a test checks they match.
    middlewareClientMaxBodySize: 21 * 1024 * 1024,
  },
};
export default nextConfig;
