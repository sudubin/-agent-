/** Keep generated coordination instructions available without flooding the chat. */
export function workflowMessageLabel(text: string): string | null {
 if (text.startsWith("请担任这个项目的主 agent，仅规划")) return "已请求主 agent 规划任务（查看详细记录）";
 if (text.startsWith("用户已在分阶段任务卡中确认以下计划，运行标识 ")) return "已确认任务卡，开始协调执行（查看详细记录）";
 return null;
}
