import {
  setRetention,
  sweepRetention,
  sweepLegacyFiles,
} from "@/lib/platform/retention";
import { actor } from "@/lib/auth/actor";
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  const b = await req.json();
  if (![7, 30, 90].includes(b.days))
    return Response.json({ error: "Choose 7, 30 or 90 days" }, { status: 400 });
  try {
    setRetention(b.days, await actor());
    if (b.sweep) {
      const result = sweepRetention(Date.now(), await actor());
      const files = await sweepLegacyFiles(
        process.cwd() + "/.data",
        Date.parse(result.cutoff),
      );
      return Response.json({
        ...result,
        ...files,
        remainingScope:
          "External backups and disk-level secure erasure require operator controls.",
      });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Retention operation failed; check server storage" },
      { status: 500 },
    );
  }
}
