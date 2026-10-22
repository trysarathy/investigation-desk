// Fetchers for the demo workspace: recorded answers first, live lookups for anything else when
// keys are set. Server-only.

import "server-only";
import { fetchTransport } from "../chain/http";
import type { LiveDeps } from "../chain/investigate";
import { liveKeysPresent } from "../chain/live";
import { buildFetchers } from "../chain/sources";
import { MemoryStore } from "../chain/store";
import { RECORDINGS } from "./recordings";
import { demoTransport } from "./transport";

let deps: LiveDeps | undefined;

export function demoDeps(): LiveDeps {
  deps ??= buildFetchers({
    // The recorded answers need no key; the placeholders only satisfy the constructors.
    tronKey: process.env.TRONGRID_API_KEY || "demo",
    etherscanKey: process.env.ETHERSCAN_API_KEY || "demo",
    store: new MemoryStore(),
    transport: demoTransport(RECORDINGS, liveKeysPresent() ? fetchTransport : undefined),
  });
  return deps;
}
