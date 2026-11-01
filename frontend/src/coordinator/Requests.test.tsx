import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestCard } from "./Panels";
import type { components } from "../api/schema";
const mock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("./api", () => ({ apiClient: { POST: mock.post }, apiErrorMessage: () => "操作失败", getApiBaseUrl: () => "http://127.0.0.1:3310" }));
vi.mock("./bridge", () => ({ native: { openExternal: vi.fn() } }));
type Activity = components["schemas"]["ConversationActivityResponse"];
function show(detail: Record<string, unknown>, kind = "approval") { const activity = { id: "event", activityKind: kind, requestId: "request", status: "pending", summary: "需要确认", detail } as Activity; return render(<RequestCard activity={activity} sessionId="worker" onResolved={vi.fn()} />); }
beforeEach(() => { vi.clearAllMocks();mock.post.mockResolvedValue({data: {state: "accepted"}}); });
describe("native user decisions", () => {
 it("never auto-approves and submits only the server's exact offered decision", async () => {
  show({ decisions: [{id:"provider-permit-42",label:"允许本次"}, {id:"provider-deny-19",label:"拒绝"}] });
  expect(mock.post).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"允许本次"}));
  await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
  expect(mock.post.mock.calls[0][1]).toEqual({params:{path:{sessionId:"worker",requestId:"request"}},body:{decisionId:"provider-permit-42"}});
 });
 it("does not submit missing required answers", async () => {
  show({schema:{required:["branch"],properties:{branch:{type:"string",title:"分支"}}}}, "user_input");
  fireEvent.click(screen.getByRole("button",{name:"提交回答并继续"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("必填");expect(mock.post).not.toHaveBeenCalled();
 });
 it("preserves unchecked false and numeric enum answers", async () => {
  show({schema:{required:["enabled","count"],properties:{enabled:{type:"boolean",title:"启用"},count:{type:"integer",title:"数量",enum:[1,2]}}}}, "user_input");
  fireEvent.change(screen.getByRole("combobox"),{target:{value:"2"}});fireEvent.click(screen.getByRole("button",{name:"提交回答并继续"}));
  await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));expect(mock.post.mock.calls[0][1].body.content).toEqual({enabled:false,count:2});
 });
});
