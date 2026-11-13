/**
 * CHANGE 5 (QA R4): read a request body as UTF-8 text, stopping as soon as it exceeds `maxBytes`.
 * A chunked body (no Content-Length) is never buffered beyond the limit plus one chunk; the stream
 * is cancelled when the limit is crossed. Internal helper for the v1 test API (not part of the
 * public engine API).
 */
export type LimitedBody = { ok: true; text: string; bytes: number } | { ok: false; reason: "too_large"; bytesRead: number } | { ok: false; reason: "unreadable"; bytesRead: number };

export async function readBodyLimited(stream: ReadableStream<Uint8Array> | null | undefined, maxBytes: number): Promise<LimitedBody> {
  if (!stream) return { ok: true, text: "", bytes: 0 };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("body too large").catch(() => undefined);
        return { ok: false, reason: "too_large", bytesRead: bytes };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable", bytesRead: bytes };
  } finally {
    reader.releaseLock?.();
  }
  const all = new Uint8Array(bytes);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(all), bytes };
}
