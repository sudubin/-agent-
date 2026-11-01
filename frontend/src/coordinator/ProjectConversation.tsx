import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send } from "lucide-react";
import { apiClient, apiErrorMessage } from "./api";
import { ExecutionTimeline, useConversationFeed, type ConversationFeed } from "./ExecutionTimeline";

type Props = { sessionId: string; onOpen: () => void };
type ComposerDraft = { text: string; clientMessageId: string };
const draftKey = (sessionId: string) => `coordinator:project-chat:${sessionId}`;
function readDraft(sessionId: string): ComposerDraft {
 try {
  const value: unknown = JSON.parse(localStorage.getItem(draftKey(sessionId)) || "null");
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
   return {text:value.text,clientMessageId:"clientMessageId" in value && typeof value.clientMessageId === "string" ? value.clientMessageId : ""};
  }
 } catch { /* An invalid unsent draft cannot replace the provider's real history. */ }
 return {text:"",clientMessageId:""};
}

function mergeItems<T extends {id:string;sequence:number;revision?:number}>(first:T[],second:T[]):T[] {
 const values=new Map<string,T>();
 for(const value of [...first,...second]){
  const existing=values.get(value.id);
  if(!existing || (value.revision??0)>=(existing.revision??0))values.set(value.id,value);
 }
 return [...values.values()].sort((a,b)=>a.sequence-b.sequence || a.id.localeCompare(b.id));
}
function mergeFeeds(first?:ConversationFeed,second?:ConversationFeed):ConversationFeed|undefined{
 if(!first)return second;if(!second)return first;
 if(first.activeBranchId && second.activeBranchId && first.activeBranchId!==second.activeBranchId)return second;
 const a=first.oldestSequence??0,b=second.oldestSequence??0;
 const earlier=a>0 && (b===0 || a<b) ? first:second;
 return {...first,...second,oldestSequence:earlier.oldestSequence,hasMoreBefore:earlier.hasMoreBefore,
  messages:mergeItems(first.messages??[],second.messages??[]),activities:mergeItems(first.activities??[],second.activities??[])};
}

// A different main session must never inherit the previous main's pending input.
export function ProjectConversation(props: Props) {
 return <ProjectConversationSession key={props.sessionId} {...props}/>;
}

function ProjectConversationSession({sessionId,onOpen}: Props) {
 const client = useQueryClient();
 const feed = useConversationFeed(sessionId,true);
 const [history,setHistory]=useState<ConversationFeed>();
 const [showDetails,setShowDetails]=useState(false);
 const [loadingOlder,setLoadingOlder]=useState(false);
 const [olderError,setOlderError]=useState("");
 const [pageCount,setPageCount]=useState(0);
 const timeline=useRef<HTMLDivElement>(null);
 const loadingPage=useRef(false);
 const combined=mergeFeeds(history,feed.data);
 useEffect(()=>{if(feed.data)setHistory(previous=>mergeFeeds(previous,feed.data));},[feed.data]);
 useEffect(()=>{
  // Keep older messages readable when the child follows a freshly updated feed.
  if(pageCount){const viewport=timeline.current?.querySelector<HTMLElement>(".co-execution-timeline");if(viewport)viewport.scrollTop=0;}
 },[pageCount]);
 const ownership = useQuery({queryKey:["coordinator","native-client",sessionId],refetchInterval:2000,queryFn:async()=>{
  const {data,error}=await apiClient.GET("/api/v1/sessions/{sessionId}/conversation/native-client",{params:{path:{sessionId}}});
  if(error || !data || typeof data.external!=="boolean")throw new Error(apiErrorMessage(error,"暂时无法确认会话状态，请稍后重试。"));
  return data;
 }});
 const [draft,setDraft]=useState(()=>readDraft(sessionId));
 const request=useRef<ComposerDraft|null>(draft.clientMessageId ? draft : null);
 const submitting=useRef(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const external=ownership.data?.external;
 const ownershipKnown=typeof ownership.data?.external==="boolean";
 const pending=feed.data?.activities.filter(a=>a.status==="pending" && ["approval","user_input"].includes(a.activityKind)) ?? [];

 async function loadOlder(){
  if(loadingPage.current || !combined?.hasMoreBefore || !combined.oldestSequence)return;
  loadingPage.current=true;setLoadingOlder(true);setOlderError("");
  try{
   const {data,error}=await apiClient.GET("/api/v1/sessions/{sessionId}/conversation",{params:{path:{sessionId},query:{limit:80,beforeSequence:combined.oldestSequence}}});
   if(error || !data)throw new Error(apiErrorMessage(error,"暂时无法读取更早的对话。"));
   const oldest=data.oldestSequence??0;
   if(data.hasMoreBefore && (oldest<=0 || oldest>=combined.oldestSequence))throw new Error("较早记录暂时未更新，请稍后重试。");
   setHistory(previous=>mergeFeeds(data,previous));setPageCount(count=>count+1);
  }catch(cause){setOlderError(cause instanceof Error ? cause.message:String(cause));}
  finally{loadingPage.current=false;setLoadingOlder(false);}
 }

 function updateText(text: string) {
  const next={text,clientMessageId:""};request.current=null;setDraft(next);setError("");setNotice("");
  try {localStorage.setItem(draftKey(sessionId),JSON.stringify(next));}
  catch {setError("暂时无法保存消息草稿，请稍后重试。");}
 }
 async function send() {
  if(submitting.current || !ownershipKnown || ownership.error || external || !draft.text.trim())return;
  submitting.current=true;setBusy(true);setError("");setNotice("");
  const payload=request.current?.text===draft.text ? request.current : {text:draft.text,clientMessageId:`project-chat-${crypto.randomUUID()}`};
  request.current=payload;
  try {
   // Persist identity before any network request: retrying after reopening is
   // the same durable message, even if the first response never reached us.
   localStorage.setItem(draftKey(sessionId),JSON.stringify(payload));
   if(feed.data?.controller==="stopped") {
    const resumed=await apiClient.POST("/api/v1/sessions/{sessionId}/resume-agent",{params:{path:{sessionId}}});
    if(resumed.error)throw new Error(apiErrorMessage(resumed.error,"主 agent 暂时无法恢复，请打开完整记录检查。"));
   }
   const {data,error}=await apiClient.POST("/api/v1/sessions/{sessionId}/conversation/messages",{params:{path:{sessionId}},body:payload});
   if(error)throw new Error(apiErrorMessage(error,"消息暂时未确认送达，可重试发送。"));
   localStorage.removeItem(draftKey(sessionId));request.current=null;setDraft({text:"",clientMessageId:""});
   setNotice(data?.state==="queued"?"已加入当前对话，主 agent 会按顺序处理。":"消息已发送，回复会保留在当前项目中。");
   void client.invalidateQueries({queryKey:["coordinator"]});
  } catch(cause) {setError(cause instanceof Error ? cause.message : String(cause));}
  finally {submitting.current=false;setBusy(false);}
 }

 return <section className="co-project-conversation" aria-label="项目主对话">
  <header className="co-project-chat-header"><div><h2><MessageCircle size={16} aria-hidden="true"/>和主 agent 持续沟通</h2><p>讨论需求、补充修改，沿用这个项目的同一段对话。</p></div><button className="coordinator-text-button" onClick={onOpen}>完整记录与审批</button></header>
  {feed.error && <p className="coordinator-alert" role="alert">{feed.error.message}</p>}
  {feed.isLoading && <p className="co-project-chat-status">正在读取项目对话…</p>}
  <div className="co-project-chat-history-actions">{combined?.hasMoreBefore && <button className="coordinator-text-button" disabled={loadingOlder} onClick={()=>void loadOlder()}>{loadingOlder?"正在读取…":"加载更早对话"}</button>}<label><input type="checkbox" checked={showDetails} onChange={event=>setShowDetails(event.target.checked)}/>显示执行细节</label></div>
  {olderError && <p className="coordinator-alert" role="alert">{olderError}</p>}
  <div className="co-project-chat-timeline" ref={timeline}><ExecutionTimeline feed={combined && (showDetails?combined:{...combined,activities:[]})} skipPendingRequests/></div>
  {pending.length>0 && <div className="co-project-chat-status"><span>主 agent 有 {pending.length} 项提问或审批需要处理。</span><button className="coordinator-text-button" onClick={onOpen}>去处理</button></div>}
  {external && <p className="co-project-chat-status">当前对话已交给桌面客户端。请在那里继续，或打开完整记录收回协作台。</p>}
  {ownership.error && <p className="coordinator-alert" role="alert">{ownership.error.message}</p>}
  {!external && feed.data?.controller==="busy" && <p className="co-project-chat-status">主 agent 正在处理，发送的新消息会依次排队。</p>}
  <form className="co-project-chat-composer" onSubmit={event=>{event.preventDefault();void send();}}>
   <label className="coordinator-label" htmlFor={`project-chat-${sessionId}`}>继续和主 agent 讨论<textarea id={`project-chat-${sessionId}`} rows={3} placeholder="补充需求、讨论方案，或告诉主 agent 下一步要修改什么…" value={draft.text} disabled={busy || Boolean(external)} onChange={event=>updateText(event.target.value)}/></label>
   <div className="co-project-chat-actions"><span>对话会持续保留；任务分工仍可在任务卡中确认。</span><button className="coordinator-primary" type="submit" disabled={busy || !ownershipKnown || Boolean(ownership.error) || Boolean(external) || !draft.text.trim()}><Send size={14} aria-hidden="true"/>{busy?"发送中…":request.current?"重试发送":"发送消息"}</button></div>
  </form>
  {error && <p className="coordinator-alert" role="alert">{error}</p>}
  {notice && <p className="coordinator-notice" role="status">{notice}</p>}
 </section>;
}
