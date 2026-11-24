import type { Principal } from "@/server/tenant";

/**
 * Demo build only: the demo controls next to the data label ("Reset demo", the role switcher). Everything demo-only
 * is imported INSIDE the inlined build-constant branch, so a real build drops it (scripts/build/check-chain-recording.mjs
 * --marker demo). Rendered only for an organisation whose data mode is 'demo'; the switcher also needs every
 * organisation of the signed-in user to be a demo one, which its route checks again.
 */
export async function DemoBar({ dataMode, who }: { dataMode: string; who: Principal }) {
  if (process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false) {
    if (dataMode !== "demo") return null;
    const [{ ResetDemoButton }, { DemoSwitcher }, sw] = await Promise.all([import("./ResetDemoButton"), import("./DemoSwitcher"), import("@/server/demo-switch")]);
    const allowed = await sw.demoSwitchAllowed(who);
    return (
      <>
        <ResetDemoButton />
        {allowed ? <DemoSwitcher users={await sw.demoSwitchUsers()} current={who.email} /> : null}
      </>
    );
  }
  return null;
}
