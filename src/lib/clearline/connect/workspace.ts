import type { Workspace } from "../types";
import { connectRoutes } from "./descriptors";

/**
 * A copy of `ws` with the fictional Connect providers' routes added (once). The sample workspace
 * does not include them, so rc3 workspaces and the sample are unchanged.
 */
export function withConnectRoutes(ws: Workspace): Workspace {
  const out = structuredClone(ws);
  for (const r of connectRoutes()) if (!out.routes.some((x) => x.id === r.id)) out.routes.push(r);
  return out;
}
