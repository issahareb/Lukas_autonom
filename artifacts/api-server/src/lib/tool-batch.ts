/** Only audited, stateless reads may overlap. Unknown tools are write barriers. */
const PARALLEL_READS = new Set([
  "query_memory", "web_search", "fetch_url", "github_list_repos", "github_read_path",
  // email_read records provenance for its links: it must precede URL fetches.
  "github_search_code", "email_search", "telefon_status", "telefon_kontakte",
  "rueckruf_status", "lese_anfragen", "lese_website_kennzahlen", "read_diagnostics", "read_usage", "list_subagents",
  "get_trading_stats", "get_moltbook_activity", "mcp_find_tool",
]);

export function isParallelRead(name: string): boolean { return PARALLEL_READS.has(name); }

/** Results retain call order, even if reads finish in reverse order. */
export async function runToolBatch<C extends { name: string }, R>(
  calls: C[], execute: (call: C) => Promise<R>,
  opts: { signal?: AbortSignal; stopped?: () => boolean; concurrency?: number } = {},
): Promise<R[]> {
  const configured = Number(opts.concurrency ?? process.env.LUKAS_TOOL_CONCURRENCY ?? 4);
  const limit = Number.isFinite(configured) ? Math.min(8, Math.max(1, Math.floor(configured))) : 4;
  const results: R[] = [];
  let index = 0;
  while (index < calls.length) {
    opts.signal?.throwIfAborted();
    if (opts.stopped?.()) break;
    const batch: C[] = [calls[index++]];
    if (isParallelRead(batch[0].name)) {
      while (index < calls.length && batch.length < limit && isParallelRead(calls[index].name)) batch.push(calls[index++]);
    }
    // Drain siblings before propagating failure; no background callback can
    // mutate a conversation after its caller has closed the turn.
    const outcomes = await Promise.allSettled(batch.map(async call => {
      opts.signal?.throwIfAborted();
      if (opts.stopped?.()) return { skipped: true as const };
      return { skipped: false as const, result: await execute(call) };
    }));
    opts.signal?.throwIfAborted();
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") throw outcome.reason;
      if (!outcome.value.skipped) results.push(outcome.value.result);
    }
  }
  return results;
}
