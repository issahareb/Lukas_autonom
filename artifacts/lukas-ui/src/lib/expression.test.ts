import { describe,it,expect } from "vitest";
import { expressionFromSteps, expressions } from "./expression";
const step = (expression: string, ok = true) => ({ tool:"set_expression", input:"{}", result:JSON.stringify({ok:true,expression,surface:"lukas-web-chat"}),ok,ms:1 });
describe("Lukas expressions",()=>{
 it("restores all expressions from persisted tool results",()=>{for(const expression of expressions) expect(expressionFromSteps([step(expression)])).toBe(expression);});
 it("ignores failures, arbitrary tools and unsupported expressions",()=>{expect(expressionFromSteps([step("angry",false),step("invalid"),{...step("sad"),tool:"fetch_url"}],"happy")).toBe("happy");});
 it("last successful expression wins",()=>expect(expressionFromSteps([step("angry"),step("wink")])).toBe("wink"));
});
