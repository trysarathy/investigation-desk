/** A request the server understood and refused for a business or control reason (never an internal error). */
export class RequestRefused extends Error {
  /** rc7: what the person may choose from to retry (e.g. the lists of a JSON file); names only, never cell values. */
  readonly choices?: string[];
  constructor(readonly status: 400 | 409 | 422, readonly code: string, message: string, choices?: string[]) { super(message); if (choices) this.choices = choices; }
}
