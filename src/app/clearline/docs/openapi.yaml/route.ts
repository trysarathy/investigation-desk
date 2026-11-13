/**
 * Serves docs/clearline/openapi.yaml (the v1 test-mode API description). The file is bundled as a
 * string at build time by the `asset/source` rule in next.config.mjs, so this works on Vercel
 * without reading the filesystem at runtime.
 */
import spec from "../../../../../docs/clearline/openapi.yaml";

export const dynamic = "force-static";

export function GET() {
  return new Response(spec, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Content-Disposition": 'inline; filename="clearline-openapi.yaml"',
      "Cache-Control": "public, max-age=300",
      "X-Clearline-Mode": "synthetic-test-only",
    },
  });
}
