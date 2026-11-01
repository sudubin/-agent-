import { render,screen } from "@testing-library/react";
import { describe,expect,it } from "vitest";
import { ExecutionTimeline,latestExecution,type ConversationFeed } from "./ExecutionTimeline";

const activity=(id:string,sequence:number,activityKind:string,status:string,detail:Record<string,unknown>={},summary="")=>({id,sequence,activityKind,status,detail,summary,revision:1,kind:"activity",createdAt:"2026-11-01T10:00:00Z"});
const message=(id:string,sequence:number,text:string)=>({id,sequence,text,role:"assistant",revision:1,streaming:false});
function feed(activities:unknown[]=[],messages:unknown[]=[]){return {activities,messages,controller:"busy"} as ConversationFeed;}
describe("actual provider execution timeline",()=>{
 it("interleaves messages, commands and file changes in provider sequence",()=>{
  const f=feed([activity("cmd",2,"command","completed",{command:"npm test",output:"3 tests passed"},"检查测试"),activity("file",4,"file_change","completed",{files:[{path:"src/main.ts",status:"modified",patch:"+ new line"}]},"更新实现")],[message("m2",3,"检查通过"),message("m1",1,"开始检查")]);
  const {container}=render(<ExecutionTimeline feed={f}/>);
  expect(screen.getByText("npm test")).toBeInTheDocument();expect(screen.getByText("3 tests passed")).toBeInTheDocument();
  expect(screen.getByText(/src\/main.ts · modified/)).toBeInTheDocument();expect(screen.getByText(/new line/)).toBeInTheDocument();
  const text=container.textContent!;expect(text.indexOf("开始检查")).toBeLessThan(text.indexOf("检查测试"));expect(text.indexOf("检查测试")).toBeLessThan(text.indexOf("检查通过"));
 });
 it("updates a streaming item in place rather than appending a second log",()=>{
  const {rerender}=render(<ExecutionTimeline feed={feed([activity("cmd",1,"command","running",{output:"starting"},"运行测试")])}/>);
  rerender(<ExecutionTimeline feed={feed([{...activity("cmd",1,"command","completed",{output:"finished"},"运行测试"),revision:2}])}/>);
  expect(screen.queryByText("starting")).not.toBeInTheDocument();expect(screen.getAllByText("运行测试")).toHaveLength(1);expect(screen.getByText("finished")).toBeInTheDocument();
 });
 it("prioritizes an actual running operation and never equates idle with acceptance",()=>{
  const f=feed([activity("old",1,"command","running",{},"等待工具"),activity("new",3,"file_change","completed",{},"文件已更新")],[message("m",4,"仍在继续")]);
  expect(latestExecution(f)).toBe("等待工具");
  expect(latestExecution(feed([],[]))).toBe("尚无执行记录");
 });
});
