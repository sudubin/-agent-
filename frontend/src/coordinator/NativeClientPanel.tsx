import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { native } from "./bridge";
import { apiClient, apiErrorMessage } from "./api";

export function NativeClientPanel({sessionId, onOwnership}: {sessionId:string; onOwnership:(external:boolean)=>void}) {
 const cache = useQueryClient();
 const [busy,setBusy] = useState(false);
 const [error,setError] = useState("");
 const [confirmReturn,setConfirmReturn] = useState(false);
 const state = useQuery({queryKey:["coordinator","native-client",sessionId],refetchInterval:2000,queryFn:async()=>{
  const {data,error} = await apiClient.GET("/api/v1/sessions/{sessionId}/conversation/native-client",{params:{path:{sessionId}}});
  if(error || !data) throw new Error(apiErrorMessage(error));
  onOwnership(data.external);
  return data;
 }});
 const info=state.data;
 async function transfer(action:"handoff"|"reclaim") {
  setBusy(true);setError("");
  try {
   if(action === "handoff") {
    const local = await native.clientStatus(info!.harness);
    if(!local.installed) throw new Error("未找到对应桌面客户端，请先安装。");
   }
   const {data,error} = await apiClient.POST("/api/v1/sessions/{sessionId}/conversation/native-client",{params:{path:{sessionId}},body:{action,desktopStopped:action === "reclaim" && confirmReturn}});
   if(error || !data) throw new Error(apiErrorMessage(error));
   onOwnership(data.external);
   await cache.invalidateQueries({queryKey:["coordinator"]});
   if(action === "handoff") await native.openNativeSession(sessionId);
   setConfirmReturn(false);
  } catch(e) {setError(e instanceof Error ? e.message : String(e));await state.refetch();}
  finally {setBusy(false);}
 }
 if(!info) return state.error ? <p className="co-panel-intro">客户端状态暂时不可用：{state.error.message}</p> : null;
 return <section className="co-native-client"><strong>{info.external ? "桌面客户端已接管" : "在桌面客户端继续"}</strong>
  <p>{info.external ? "协作台已暂停向此会话发送任务。收回时会重新读取原生历史；需先关闭该会话并退出对应客户端。" : "接管会先暂停此会话的调度，再打开同一段原生对话。执行中或有未处理请求时需先完成处理。"}</p>
  {info.harness === "deepseek-harness" && <p>DSH 需在客户端“未分组”历史中手动选择。此按钮只打开客户端。</p>}
  <div className="coordinator-button-row">{info.external ? <><button disabled={busy} className="coordinator-secondary" onClick={()=>void native.openNativeSession(sessionId).catch((e)=>setError(String(e)))}>再次打开客户端</button><label><input type="checkbox" checked={confirmReturn} onChange={(e)=>setConfirmReturn(e.target.checked)}/>我已关闭该会话并退出对应客户端</label><button disabled={busy || !confirmReturn} className="coordinator-primary" onClick={()=>void transfer("reclaim")}>收回协作台</button></> : <button className="coordinator-secondary" disabled={busy || !info.supported} onClick={()=>void transfer("handoff")}>{busy ? "正在移交…" : info.supported ? "暂停调度并在客户端接管" : "此客户端的同会话接管尚未接通"}</button>}</div>
  {info.nativeId && <details><summary>原生会话编号</summary><code>{info.nativeId}</code></details>}
  {error && <p className="coordinator-alert" role="alert">{error}</p>}
 </section>;
}
