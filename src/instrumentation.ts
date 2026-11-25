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
