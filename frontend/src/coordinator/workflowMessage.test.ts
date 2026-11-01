import { describe, expect, it } from "vitest";
import { workflowMessageLabel } from "./workflowMessage";
import { planningPrompt, executionPrompt } from "../renderer/lib/collaboration-plan";
describe("human-readable workflow messages", () => {
 it("collapses real generated planning and execution instructions", () => {
  expect(workflowMessageLabel(planningPrompt("创建网站", [{agent: "codex", responsibility: "素材"}], "plan.json"))).toContain("规划任务");
  expect(workflowMessageLabel(executionPrompt({title: "计划", tasks: []}, "run"))).toContain("已确认任务卡");
 });
 it("preserves normal user and assistant content", () => {
  expect(workflowMessageLabel("请把页面背景改成蓝色")).toBeNull();
  expect(workflowMessageLabel("任务已完成，文件位于项目目录")).toBeNull();
 });
});
