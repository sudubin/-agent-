import { useState } from "react";
import { ChevronDown, ExternalLink, Monitor, Radio } from "lucide-react";
import { native } from "./bridge";
import { ExecutionTimeline, latestExecution, useConversationFeed } from "./ExecutionTimeline";
import type { WorkspaceSession } from "./data";
import { collaborationAgents } from "../renderer/lib/collaboration-plan";

export type ExecutionMember = {key:string; title:string; role:string; agent:string; session?:WorkspaceSession; waiting?:string};
const controllerNames:Record<string,string>={connecting:"正在连接",ready:"等待消息",busy:"正在执行",recovering:"正在恢复",hibernated:"已暂停",stopped:"已退出"};
export function ExecutionBoard({members,onOpen}:{members:ExecutionMember[];onOpen:(id:string)=>void}) {
 const [mode,setMode]=useState<"embedded"|"clients">("embedded");
 if(!members.length)return null;
 return <section className="co-execution-board" aria-label="Agent 执行现场"><header><div><h2><Radio size={16}/>执行现场</h2><p>每个 agent 的实际执行记录，随运行更新。</p></div><div className="co-segmented" role="group" aria-label="执行过程查看方式"><button aria-pressed={mode==="embedded"} onClick={()=>setMode("embedded")}><Monitor size={14}/>协作台内</button><button aria-pressed={mode==="clients"} onClick={()=>setMode("clients")}><ExternalLink size={14}/>客户端入口</button></div></header>
  {mode==="clients"&&<p className="co-client-view-note">打开客户端不会移交或暂停任务。客户端能否展示执行中的同一会话，取决于其原生能力；继续对话请在运行记录中使用“接管”。</p>}
  <div className="co-execution-members">{members.map(member=><ExecutionCard member={member} mode={mode} onOpen={onOpen} key={member.key}/>)}</div>
 </section>;
}
function ExecutionCard({member,mode,onOpen}:{member:ExecutionMember;mode:"embedded"|"clients";onOpen:(id:string)=>void}) {
 const [expanded,setExpanded]=useState(false);
 const [error,setError]=useState("");
 const feed=useConversationFeed(member.session?.id??"",expanded);
 const label=collaborationAgents.find(a=>a.id===member.agent)?.label??member.agent;
 const status=member.session?.isTerminated?"会话已结束":member.session?controllerNames[feed.data?.controller??""]??"读取状态中":member.waiting??"等待分配";
 return <article className={`co-execution-member ${feed.data?.controller==="busy"?"busy":""}`}><button className="co-execution-member-heading" aria-expanded={expanded} disabled={!member.session} onClick={()=>setExpanded(!expanded)}><span className={`co-agent-monogram ${member.agent}`}>{label.slice(0,1)}</span><span className="co-execution-member-name"><strong>{member.title}</strong><small>{member.role} · {label}</small></span><span className="co-execution-state">{status}</span><ChevronDown size={15}/></button>
  {mode==="embedded"&&<p className="co-execution-preview">{member.session?latestExecution(feed.data):member.waiting??"主 agent 分配后显示执行过程"}</p>}
  <div className="co-execution-member-actions"><span>{feed.dataUpdatedAt?`更新于 ${new Date(feed.dataUpdatedAt).toLocaleTimeString("zh-CN",{hour12:false})}`:""}{feed.error?" · 更新失败":""}</span>{mode==="clients"?<button onClick={()=>void native.openClient(member.agent).catch(e=>setError(String(e)))}>打开 {label}<ExternalLink size={12}/></button>:member.session&&<button onClick={()=>onOpen(member.session!.id)}>完整记录与审批</button>}</div>
  {expanded&&<ExecutionTimeline feed={feed.data}/>}
  {feed.error&&<p className="coordinator-alert" role="alert">{feed.error.message}</p>}{error&&<p className="coordinator-alert" role="alert">{error}</p>}
 </article>;
}
