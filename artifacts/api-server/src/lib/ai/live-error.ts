/** Shared without importing the session manager or tool runtime. */
export class LiveSessionError extends Error {
  constructor(message: string, readonly accepted = false) {
    super(message);
    this.name = "LiveSessionError";
  }
}
