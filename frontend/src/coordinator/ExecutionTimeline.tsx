import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { components } from "../api/schema";
import { apiClient, apiErrorMessage } from "./api";
import { workflowMessageLabel } from "./workflowMessage";

export type ConversationFeed = components["schemas"]["ConversationSnapshotResponse"];
type Activity = components["schemas"]["ConversationActivityResponse"];
const activityNames: Record<string,string> = {command:"执行命令",file_change:"修改文件",plan:"任务计划",reasoning:"工作摘要",approval:"等待审批",user_input:"等待回答",mcp_tool:"调用工具",ao_action:"协调任务",error:"运行出错",system:"运行记录",auto_review:"自动检查"};
const statuses: Record<string,string> = {running:"进行中",completed:"已结束",recovered:"已恢复",failed:"失败",cancelled:"已取消",pending:"待处理",resolved:"已处理"};
const text = (value: unknown) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value,null,2);
export function activityTitle(activity: Activity) {return activity.summary || activityNames[activity.activityKind] || "运行记录";}
export function latestExecution(feed?: ConversationFeed) {
 const activities=(feed?.activities??[]).filter(a=>a.activityKind!=="usage");
 const running=activities.filter(a=>["running","pending"].includes(a.status)).sort((a,b)=>b.sequence-a.sequence)[0];
 if(running) return activityTitle(running);
 const activity=activities.toSorted((a,b)=>b.sequence-a.sequence)[0];
 const message=(feed?.messages??[]).filter(m=>m.role==="assistant").toSorted((a,b)=>b.sequence-a.sequence)[0];
 return message && (!activity || message.sequence>activity.sequence) ? message.text : activity ? activityTitle(activity) : "尚无执行记录";
}
export function useConversationFeed(sessionId: string, expanded = false) {
 return useQuery({queryKey:["coordinator","execution-feed",sessionId,expanded?"full":"preview"],enabled:Boolean(sessionId),refetchInterval:q=>q.state.data?.controller==="busy"?1200:3000,queryFn:async()=>{
  const {data,error}=await apiClient.GET("/api/v1/sessions/{sessionId}/conversation",{params:{path:{sessionId},query:{limit:expanded?80:8}}});
  if(error || !data)throw new Error(apiErrorMessage(error));return data;
 }});
}
export function ExecutionTimeline({feed, skipPendingRequests=false}: {feed?:ConversationFeed;skipPendingRequests?:boolean}) {
 const viewport=useRef<HTMLDivElement>(null);
 const [follow,setFollow]=useState(true);
 const messages=(feed?.messages??[]).map(value=>({kind:"message" as const,value}));
 const activities=(feed?.activities??[]).filter(a=>a.activityKind!=="usage" && !(skipPendingRequests && a.status==="pending" && ["approval","user_input"].includes(a.activityKind))).map(value=>({kind:"activity" as const,value}));
 const entries=[...messages,...activities].sort((a,b)=>a.value.sequence-b.value.sequence || a.value.id.localeCompare(b.value.id));
 const revision=entries.map(e=>`${e.value.id}:${e.value.revision}`).join("|");
 useEffect(()=>{if(follow && viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;},[revision,follow]);
 return <><div className="co-execution-toolbar"><span>{feed?.hasMoreBefore?"显示最近的执行过程":"执行记录"}</span><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>跟随新消息</label></div><div className="co-execution-timeline" ref={viewport} onScroll={()=>{const v=viewport.current;if(v && v.scrollHeight-v.scrollTop-v.clientHeight>80)setFollow(false);}}>
  {!entries.length && <p className="co-feed-empty">执行开始后，这里会显示 agent 的消息、工具调用、命令输出和文件修改。</p>}
  {entries.map(entry=>entry.kind==="message"?<article className={`co-feed-message ${entry.value.role}`} key={`message-${entry.value.id}`}><div className="co-feed-meta"><span>{entry.value.role==="assistant"?"Agent":entry.value.origin==="automation"?entry.value.senderDisplayName||"任务协调":"你"}</span>{entry.value.streaming&&<span className="co-live-indicator">正在输出</span>}</div>{workflowMessageLabel(entry.value.text)?<details><summary>{workflowMessageLabel(entry.value.text)}</summary><pre>{entry.value.text}</pre></details>:<pre>{entry.value.text}</pre>}</article>:<ActivityEntry activity={entry.value} key={`activity-${entry.value.id}`}/>)}
 </div></>;
}
function ActivityEntry({activity}:{activity:Activity}) {
 const d=activity.detail??{};
 const command=text(d.command||d.rawCommand);
 const output=text(d.output);
 const files=Array.isArray(d.files)?d.files.filter(f=>f && typeof f==="object") as Record<string,unknown>[]:[];
 return <article className={`co-feed-activity ${activity.status}`}><div className="co-feed-meta"><span>{activityNames[activity.activityKind]||"运行记录"}</span><span>{statuses[activity.status]||activity.status}</span></div><p>{activityTitle(activity)}</p>
  {command&&<code className="co-command-line">{command}</code>}
  {files.length>0&&<ul>{files.map((f,i)=><li key={i}>{text(f.path)}{f.status?` · ${text(f.status)}`:""}</li>)}</ul>}
  {output&&<details open={activity.status==="running"}><summary>命令输出{d.outputTruncated?"（提供方已截断）":""}</summary><pre className="co-command-output">{output}</pre></details>}
  {activity.activityKind==="reasoning"&&text(d.text)&&<pre>{text(d.text)}</pre>}
  {activity.activityKind==="mcp_tool"&&<details><summary>工具输入与结果</summary><pre>{text(d.arguments)}{d.result!==undefined?`\n\n${text(d.result)}`:""}{d.error?`\n${text(d.error)}`:""}</pre></details>}
  {activity.activityKind==="plan"&&Array.isArray(d.steps)&&<ol>{(d.steps as Record<string,unknown>[]).map((step,i)=><li key={i}>{text(step.text)}{step.status?` · ${text(step.status)}`:""}</li>)}</ol>}
  {files.some(f=>f.patch)&&<details><summary>查看文件修改</summary>{files.filter(f=>f.patch).map((f,i)=><pre className="co-command-output" key={i}>{text(f.path)}{"\n"}{text(f.patch)}</pre>)}</details>}
 </article>;
}
