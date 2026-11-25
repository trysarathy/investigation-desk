/**
 * rc8: runs once when the Next server starts. A non-test build refuses to start when CLEARLINE_CHAIN_RECORDING is
 * set (src/server/test-build.ts): recorded chain data must never reach a live organisation. A demo build may start with
 * one (it refuses it per call for every non-demo organisation), but refuses to start with live chain reads or the
 * ledger pull on (src/server/demo-build.ts). v1: a demo or test build never starts as a staging or production
 * deployment (CLEARLINE_DEPLOY_ENV; src/server/deploy-guard.ts). v1 #165: with NODE_ENV=production (`next start`) the server
 * refuses to start when CLEARLINE_DEPLOY_ENV is unset (docs/runbooks/DEPLOY_ENV.md).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertNoChainRecordingOutsideTestBuild, ChainRecordingRefused } = await import("./server/test-build");
  const { assertDemoBuildOffline, DemoNetworkRefused } = await import("./server/demo-build");
  const { assertDeployableBuild, DeployBuildRefused } = await import("./server/deploy-guard");
  try {
    assertDeployableBuild();
    assertNoChainRecordingOutsideTestBuild();
    assertDemoBuildOffline();
  } catch (e) {
    if (!(e instanceof ChainRecordingRefused) && !(e instanceof DemoNetworkRefused) && !(e instanceof DeployBuildRefused)) throw e;
    console.error(JSON.stringify({ event: "server_refused", code: e.code, hint: e.message }));
    process.exit(1);
  }
}

/**
 * v1 phase 5.4: every error Next catches while rendering or handling a request goes to the logger and the error tracker
 * (src/server/ops). Only the route pattern (e.g. "/api/control/payments/[id]"), the router kind and the method are
 * kept: never the actual path (a payment link's path is its secret), a header, a cookie or the body.
 */
export async function onRequestError(err: unknown, request: { method?: string }, context: { routePath?: string; routerKind?: string; routeType?: string }) {
  // The import sits inside the runtime check so the edge bundle never includes the Node-only logger.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { log } = await import("./server/ops/log");
    const route = typeof context?.routePath === "string" && /^[A-Za-z0-9_\-/[\].]{1,200}$/.test(context.routePath) ? context.routePath : "unknown";
    const method = typeof request?.method === "string" && /^[A-Z]{3,7}$/.test(request.method) ? request.method : "unknown";
    log.error("request_error", err, { route, method, routeType: context?.routeType ?? "unknown" });
  }
}
