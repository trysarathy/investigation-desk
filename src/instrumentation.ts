/**
 * rc8: runs once when the Next server starts. A non-test build refuses to start when CLEARLINE_CHAIN_RECORDING is
 * set (src/server/test-build.ts): recorded chain data must never reach a live organisation.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertNoChainRecordingOutsideTestBuild, ChainRecordingRefused } = await import("./server/test-build");
  try {
    assertNoChainRecordingOutsideTestBuild();
  } catch (e) {
    if (!(e instanceof ChainRecordingRefused)) throw e;
    console.error(JSON.stringify({ event: "server_refused", code: e.code, hint: e.message }));
    process.exit(1);
  }
}
