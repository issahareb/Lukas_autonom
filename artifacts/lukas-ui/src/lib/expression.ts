import type { ToolStep } from "@/components/tool-steps";
export const expressions = ["neutral", "happy", "sad", "angry", "frustrated", "surprised", "curious", "sleepy", "wink"] as const;
export type Expression = typeof expressions[number];
export function expressionFromSteps(steps: ToolStep[], fallback: Expression = "neutral"): Expression {
  let current = fallback;
  for (const step of steps) {
    if (!step.ok || !["set_expression", "mcp_call"].includes(step.tool)) continue;
    try {
      const result = JSON.parse(step.result);
      if (result.ok === true && result.surface === "lukas-web-chat" && expressions.includes(result.expression)) current = result.expression;
    } catch { /* Other tool outputs are not expression commands. */ }
  }
  return current;
}
