/**
 * Persistent pause for self-started work. Read at execution time as well as
 * scheduler startup; user-requested chat and telephone turns remain available.
 */
export function backgroundPaused(): boolean {
  return (process.env.LUKAS_BACKGROUND_PAUSED ?? "false").trim().toLowerCase() === "true";
}
