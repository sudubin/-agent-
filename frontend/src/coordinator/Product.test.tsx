import { fireEvent, render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Product } from "./Product";
const state = vi.hoisted(() => ({ home: () => {} }));
vi.mock("./bridge", () => ({ native: { onHome: (handler: () => void) => { state.home = handler; return () => {}; } } }));
vi.mock("./App", () => ({ CoordinatorApp: ({ openSettings, openSession }: { openSettings: () => void; openSession: (p: string, s: string) => void }) => <div><input aria-label="草稿" defaultValue="我的项目需求" /><button onClick={openSettings}>设置</button><button onClick={() => openSession("p", "s")}>查看任务</button></div> }));
vi.mock("./Panels", () => ({ SettingsPanel: ({ onClose }: { onClose: () => void }) => <section role="dialog"><button onClick={onClose}>返回项目</button></section>, ConversationPanel: ({ onClose }: { onClose: () => void }) => <section role="dialog"><button onClick={onClose}>返回项目</button></section> }));
describe("independent product navigation", () => {
 it("returns from settings and conversations to the same draft", () => {
  render(<Product />);
  fireEvent.change(screen.getByLabelText("草稿"), { target: { value: "已编辑的需求" } });
  for (const name of ["设置", "查看任务"]) {
   fireEvent.click(screen.getByRole("button", { name }));
   expect(screen.getByRole("dialog")).toBeInTheDocument();
   fireEvent.click(screen.getByRole("button", { name: "返回项目" }));
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(screen.getByLabelText("草稿")).toHaveValue("已编辑的需求");
  }
 });
 it("native Home always closes secondary panels", () => {
  render(<Product />);fireEvent.click(screen.getByRole("button", { name: "设置" }));
  act(() => state.home());expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 });
});
