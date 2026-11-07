import type { ToolStep } from "@workspace/db";
const MAX = 4000;
const bounded = (value: string) => value.length > MAX ? `${value.slice(0, MAX)}\n\n[… ${value.length - MAX} weitere Zeichen]` : value;
export function toolStep(tool: string, input: Record<string, unknown>, result: string, ok: boolean, ms: number): ToolStep {
  return { tool, input: bounded(JSON.stringify(input, null, 2)), result: bounded(result), ok, ms };
}
