import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { fireEvent,render,screen } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { ExecutionBoard } from "./ExecutionBoard";
const mocks=vi.hoisted(()=>({get:vi.fn(),open:vi.fn()}));
vi.mock("./api",()=>({apiClient:{GET:mocks.get},apiErrorMessage:()=>"读取失败"}));
vi.mock("./bridge",()=>({native:{openClient:mocks.open}}));
beforeEach(()=>{vi.clearAllMocks();mocks.open.mockResolvedValue(undefined);mocks.get.mockResolvedValue({data:{controller:"busy",messages:[],activities:[{id:"cmd",kind:"activity",sequence:1,revision:1,activityKind:"command",status:"running",summary:"运行检查",detail:{command:"npm test",output:"正在执行"}}]}});});
describe("execution board",()=>{
 function show(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ExecutionBoard members={[{key:"w",title:"实现页面",role:"实现",agent:"codex",session:{id:"worker",title:"实现页面",provider:"codex",kind:"worker",status:"active",isTerminated:false}}]} onOpen={vi.fn()}/></QueryClientProvider>);}
 it("shows live status and expands real command output",async()=>{
  show();expect(await screen.findByText("正在执行")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{expanded:false}));
  expect(await screen.findByText("npm test")).toBeInTheDocument();
 });
 it("opens a client without posting a handoff or pausing execution",async()=>{
  show();fireEvent.click(screen.getByRole("button",{name:"客户端入口"}));
  fireEvent.click(screen.getByRole("button",{name:/打开 Codex/}));
  expect(mocks.open).toHaveBeenCalledWith("codex");
  expect(screen.getByText(/打开客户端不会移交或暂停任务/)).toBeInTheDocument();
 });
});
