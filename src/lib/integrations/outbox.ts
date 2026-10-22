import { randomUUID } from "node:crypto";
import { documents, putDocument, audit } from "../platform/store";
export interface Alert {
  id: string;
  eventId: string;
  caseId: string;
  channel: "slack";
  state: "pending" | "sent" | "failed";
  attempts: number;
  createdAt: string;
}
/** Durable, idempotent intent. Delivery needs an explicitly configured worker and destination. */
export function enqueueAlert(eventId: string, caseId: string) {
  const existing = documents<Alert>("alert").find((a) => a.eventId === eventId);
  if (existing) return existing;
  const a: Alert = {
    id: randomUUID(),
    eventId,
    caseId,
    channel: "slack",
    state: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  putDocument("alert", a.id, a);
  audit("alert.queued", caseId);
  return a;
}
export async function deliverAlert(
  a: Alert,
  send: (message: { text: string }) => Promise<void>,
  origin: string,
) {
  if (a.state === "sent") return a;
  a.attempts++;
  try {
    await send({
      text: `Investigation requires review: ${new URL(`/library/${a.caseId}`, origin)}`,
    });
    a.state = "sent";
  } catch {
    a.state = "failed";
  }
  putDocument("alert", a.id, a);
  audit(`alert.${a.state}`, a.caseId);
  return a;
}
