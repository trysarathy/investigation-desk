/**
 * rc8: runs once when the Next server starts. A non-test build refuses to start when CLEARLINE_CHAIN_RECORDING is
 * set (src/server/test-build.ts): recorded chain data must never reach a live organisation. A demo build may start with
 * one (it refuses it per call for every non-demo organisation), but refuses to start with live chain reads or the
 * ledger pull on (src/server/demo-build.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertNoChainRecordingOutsideTestBuild, ChainRecordingRefused } = await import("./server/test-build");
  const { assertDemoBuildOffline, DemoNetworkRefused } = await import("./server/demo-build");
  try {
    assertNoChainRecordingOutsideTestBuild();
    assertDemoBuildOffline();
  } catch (e) {
    if (!(e instanceof ChainRecordingRefused) && !(e instanceof DemoNetworkRefused)) throw e;
    console.error(JSON.stringify({ event: "server_refused", code: e.code, hint: e.message }));
    process.exit(1);
  }
}
