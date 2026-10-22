// Wires the live fetchers from environment variables. Keys are read here and nowhere else.

import "server-only";
import path from "node:path";
import type { LiveDeps } from "./investigate";
import { buildFetchers } from "./sources";
import { FileStore } from "./store";

export function liveKeysPresent(): boolean {
  return !!process.env.TRONGRID_API_KEY && !!process.env.ETHERSCAN_API_KEY;
}

let deps: LiveDeps | undefined;

export function liveDeps(): LiveDeps {
  deps ??= buildFetchers({
    tronKey: process.env.TRONGRID_API_KEY ?? "",
    etherscanKey: process.env.ETHERSCAN_API_KEY ?? "",
    store: new FileStore(path.join(process.cwd(), ".data")),
  });
  return deps;
}
