/** A request the server understood and refused for a business or control reason (never an internal error). */
export class RequestRefused extends Error {
  constructor(readonly status: 400 | 409 | 422, readonly code: string, message: string) { super(message); }
}
