import "server-only";
import { headers } from "next/headers";
export async function actor() {
  const h = await headers();
  return h.get("x-desk-actor") ?? "system";
}
