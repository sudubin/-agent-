import { describe, expect, it } from "vitest";
import { nativeConversationUrl } from "./coordinator-clients";
const id = "00000000-0000-4000-8000-000000000001";
describe("native existing-conversation links",()=>{
 it("opens the same Codex or Copilot UUID without a new prompt",()=>{
  expect(nativeConversationUrl("codex",id)).toBe(`codex://threads/${id}`);
  expect(nativeConversationUrl("copilot",id)).toBe(`ghapp://sessions/${id}`);
 });
 it("only focuses DSH and refuses guessed routes or URL injection",()=>{
  expect(nativeConversationUrl("deepseek-harness",id)).toBe("dsh://open");
  for(const bad of ["project1-2",id+"?prompt=run", "../../new", ""]) expect(()=>nativeConversationUrl("codex",bad)).toThrow();
  expect(()=>nativeConversationUrl("agy",id)).toThrow();
  expect(()=>nativeConversationUrl("muse-desktop",id)).toThrow();
 });
});
