import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { ProjectConversation } from "./ProjectConversation";

const mock=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),external:false,controller:"ready",messages:[] as Record<string,unknown>[]}));
vi.mock("./api",()=>({apiClient:{GET:mock.get,POST:mock.post},apiErrorMessage:(e:unknown,fallback="操作失败")=>e && typeof e==="object" && "message" in e ? String(e.message):fallback}));

beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();mock.external=false;mock.controller="ready";mock.messages=[];
 mock.get.mockImplementation(async(path:string)=>path.endsWith("native-client")?{data:{external:mock.external,harness:"codex",sessionId:"main",nativeId:"native-main",supported:true,title:"主 agent"}}:{data:{controller:mock.controller,messages:[...mock.messages],activities:[]}});
 mock.post.mockImplementation(async(path:string,request:{body?:{text:string}})=>{
  if(path.endsWith("resume-agent")){mock.controller="ready";return {data:{ok:true}};}
  const n=mock.messages.length+1;mock.messages.push({id:`reply-${n}`,sequence:n,revision:1,role:"assistant",text:`收到：${request.body?.text}`});
  return {data:{turnId:`turn-${n}`,duplicate:false,state:mock.controller==="busy"?"queued":"running"}};
 });
});

function show(sessionId="main",onOpen=vi.fn()){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return {...render(<QueryClientProvider client={client}><ProjectConversation sessionId={sessionId} onOpen={onOpen}/></QueryClientProvider>),client,onOpen};
}
async function send(text:string){
 fireEvent.change(screen.getByRole("textbox",{name:"继续和主 agent 讨论"}),{target:{value:text}});
 await waitFor(()=>expect(screen.getByRole("button",{name:"发送消息"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button",{name:"发送消息"}));
}

describe("persistent project conversation",()=>{
 it("sends successive rounds into the same main session and displays both replies",async()=>{
  show();await send("先讨论目标");await screen.findByText("收到：先讨论目标");
  await send("再调整配色");await screen.findByText("收到：再调整配色");
  expect(screen.getByText("收到：先讨论目标")).toBeInTheDocument();expect(mock.post).toHaveBeenCalledTimes(2);
  for(const [path,request]of mock.post.mock.calls){expect(path).toBe("/api/v1/sessions/{sessionId}/conversation/messages");expect(request.params.path.sessionId).toBe("main");expect(request.body).not.toHaveProperty("steer");}
  expect(mock.post.mock.calls[0][1].body.clientMessageId).not.toBe(mock.post.mock.calls[1][1].body.clientMessageId);
 });
 it("retains text and reuses durable identity after a network failure and reopening",async()=>{
  mock.post.mockRejectedValueOnce(new Error("网络中断"));const first=show();await send("保留这条消息");await screen.findByText("网络中断");
  expect(screen.getByRole("textbox")).toHaveValue("保留这条消息");const original=mock.post.mock.calls[0][1].body;
  first.unmount();show();expect(screen.getByRole("textbox")).toHaveValue("保留这条消息");
  await waitFor(()=>expect(screen.getByRole("button",{name:"重试发送"})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name:"重试发送"}));
  await screen.findByText("收到：保留这条消息");expect(mock.post.mock.calls[1][1].body).toEqual(original);expect(localStorage.getItem("coordinator:project-chat:main")).toBeNull();
 });
 it("assigns a new message identity when failed input is edited",async()=>{
  mock.post.mockRejectedValueOnce(new Error("网络中断"));show();await send("原消息");await screen.findByText("网络中断");
  const firstID=mock.post.mock.calls[0][1].body.clientMessageId;await send("修改后的新消息");await screen.findByText("收到：修改后的新消息");
  expect(mock.post.mock.calls[1][1].body.clientMessageId).not.toBe(firstID);expect(mock.post.mock.calls[1][1].body.text).toBe("修改后的新消息");
 });
 it("explains busy-message queuing without steering the running turn",async()=>{
  mock.controller="busy";show();await screen.findByText(/发送的新消息会依次排队/);await send("之后处理这条");
  await screen.findByText("已加入当前对话，主 agent 会按顺序处理。");expect(mock.post.mock.calls[0][0]).toBe("/api/v1/sessions/{sessionId}/conversation/messages");
 });
 it("resumes a stopped agent in the same session before sending",async()=>{
  mock.controller="stopped";show();await send("继续之前的项目");await screen.findByText("收到：继续之前的项目");
  expect(mock.post.mock.calls.map(call=>call[0])).toEqual(["/api/v1/sessions/{sessionId}/resume-agent","/api/v1/sessions/{sessionId}/conversation/messages"]);
  expect(mock.post.mock.calls[0][1].params.path.sessionId).toBe("main");
 });
 it("blocks sending when the native client owns the conversation",async()=>{
  mock.external=true;const {onOpen}=show();await screen.findByText(/当前对话已交给桌面客户端/);
  expect(screen.getByRole("textbox")).toBeDisabled();expect(screen.getByRole("button",{name:"发送消息"})).toBeDisabled();expect(mock.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"完整记录与审批"}));expect(onOpen).toHaveBeenCalledOnce();
 });
 it("fails closed when ownership cannot be determined",async()=>{
  mock.get.mockImplementation(async(path:string)=>path.endsWith("native-client")?{error:{message:"状态不可用"}}:{data:{controller:"ready",messages:[],activities:[]}});
  show();await screen.findByText("状态不可用");fireEvent.change(screen.getByRole("textbox"),{target:{value:"不能误发"}});
  expect(screen.getByRole("button",{name:"发送消息"})).toBeDisabled();expect(mock.post).not.toHaveBeenCalled();
 });
 it("rejects an ownership response without a boolean external fact",async()=>{
  mock.get.mockImplementation(async(path:string)=>path.endsWith("native-client")?{data:{reports:[]}}:{data:{controller:"ready",messages:[],activities:[]}});
  show();await screen.findByText("暂时无法确认会话状态，请稍后重试。");fireEvent.change(screen.getByRole("textbox"),{target:{value:"状态必须明确"}});
  expect(screen.getByRole("button",{name:"发送消息"})).toBeDisabled();expect(mock.post).not.toHaveBeenCalled();
 });
 it("pages older conversation without duplicating or downgrading a newer revision",async()=>{
  mock.get.mockImplementation(async(path:string,request?:{params?:{query?:{beforeSequence?:number}}})=>{
   if(path.endsWith("native-client"))return {data:{external:false}};
   const before=request?.params?.query?.beforeSequence;
   if(before===100)return {data:{controller:"ready",oldestSequence:10,hasMoreBefore:true,messages:[{id:"old",sequence:10,revision:1,role:"assistant",text:"第一阶段的讨论"},{id:"current",sequence:100,revision:1,role:"assistant",text:"已过期版本"}],activities:[]}};
   if(before===10)return {data:{controller:"ready",oldestSequence:1,hasMoreBefore:false,messages:[{id:"start",sequence:1,revision:1,role:"user",text:"项目最初的需求"}],activities:[]}};
   return {data:{controller:"ready",oldestSequence:100,hasMoreBefore:true,messages:[{id:"current",sequence:100,revision:2,role:"assistant",text:"当前最新回复"}],activities:[]}};
  });
  show();await screen.findByText("当前最新回复");fireEvent.click(screen.getByRole("button",{name:"加载更早对话"}));await screen.findByText("第一阶段的讨论");
  expect(screen.queryByText("已过期版本")).not.toBeInTheDocument();expect(screen.getAllByText("当前最新回复")).toHaveLength(1);
  await waitFor(()=>expect(screen.getByRole("button",{name:"加载更早对话"})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name:"加载更早对话"}));
  await screen.findByText("项目最初的需求");expect(screen.queryByRole("button",{name:"加载更早对话"})).not.toBeInTheDocument();expect(screen.getByText("当前最新回复")).toBeInTheDocument();
 });
});
