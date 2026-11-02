// The demo slices (/demo/*) exist only in demo mode, and can be switched off there with DEMO_SLICES=off.
// In live mode the routes are a 404: no watcher, no previews, nothing a customer could point at a real address.

import { isDemoMode } from "../mode";

export const demoSlicesOn = () => isDemoMode() && !/^(off|0|false|no)$/i.test((process.env.DEMO_SLICES ?? "on").trim());
