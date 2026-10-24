// Upload size limits, shared by the routes and next.config.mjs (which caps request bodies before a
// route sees them; a body over that cap arrives cut short). Keep REQUEST_MAX_BYTES in step with
// next.config.mjs: a test checks they match.

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** The file plus the multipart form around it (field names, boundaries, the other fields). */
export const REQUEST_MAX_BYTES = UPLOAD_MAX_BYTES + 1024 * 1024;

export const TOO_LARGE = "This file is larger than the 20 MB upload limit. Split it into smaller files and import each one.";

/** 413 before the body is read, when the request says it is larger than the limit. */
export function requestTooLarge(req: Request, max = REQUEST_MAX_BYTES): boolean {
  const n = Number(req.headers.get("content-length"));
  return Number.isFinite(n) && n > max;
}
