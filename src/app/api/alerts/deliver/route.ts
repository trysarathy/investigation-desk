import { documents } from "@/lib/platform/store";
import { deliverAlert, type Alert } from "@/lib/integrations/outbox";
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host"))
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  const token = process.env.SLACK_BOT_TOKEN,
    channel = process.env.SLACK_ALERT_CHANNEL,
    originUrl = process.env.PUBLIC_APP_URL;
  if (
    !token ||
    !channel ||
    !originUrl?.startsWith("https://") ||
    process.env.SLACK_ALERTS_ENABLED !== "1"
  )
    return Response.json(
      { error: "Slack delivery is not enabled and configured" },
      { status: 409 },
    );
  const pending = documents<Alert>("alert")
    .filter((a) => a.state !== "sent" && a.attempts < 3)
    .slice(0, 10);
  const results = [];
  for (const a of pending)
    results.push(
      await deliverAlert(
        a,
        async (message) => {
          const r = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              channel,
              text: message.text,
              unfurl_links: false,
              unfurl_media: false,
            }),
            signal: AbortSignal.timeout(8000),
          });
          const body = await r.json();
          if (!r.ok || !body.ok) throw Error("Slack delivery failed");
        },
        originUrl,
      ),
    );
  return Response.json({
    sent: results.filter((a) => a.state === "sent").length,
    failed: results.filter((a) => a.state === "failed").length,
  });
}
