# 协作台 0.5.0

本地多 agent 项目协作桌面应用，基于 [Agent Orchestrator](https://github.com/OrchestratorInc/agent-orchestrator) 改造。使用独立的 Electron + React 界面和从本仓库编译的协作引擎。

## 使用方式

1. 选择共享项目文件夹、主 agent 和执行者，填写各自职责。
2. 可以先与主 agent 多轮讨论，或直接生成分阶段任务卡。
3. 编辑每张卡的执行 agent、任务说明、验收条件和依赖；确认后才派单。
4. 在执行现场展开各 agent 的实际消息、工具调用、命令输出和文件修改，处理提问与审批。
5. 主 agent 收取真实报告、检查结果并整合交付。仅当执行者、完成报告和主 agent 验收匹配时，任务卡才显示已验收。
6. 本轮验收后点击“追加下一轮”，继续沿用项目与主会话；通过“协作轮次”查看旧任务卡，历史卡片只读。

主页“和主 agent 持续沟通”支持追问、追加要求、加载较早消息，以及发送失败后的原消息重试。底部“继续和主 agent 对话”可以直接定位输入框。关闭重开后，对话和各轮计划仍保留。

执行者使用独立工作树开发。主 agent 将交付文件、计划和汇总归档至注册项目的 `outputs/agent-collaboration/<runId>/`，各轮分别保存 `plan.json`、`SUMMARY.md` 及任务交付物。

## Agent 与客户端支持边界

可选择 AGY、Codex、DeepSeek Harness 和 GitHub Copilot；需要各自已安装且账户就绪。Claude 已从新任务选项移除，历史记录保留。

- **Codex**：可创建或复用注册目录对应的原生项目，将不同工作树的任务会话归组。本机验收已验证原生项目归属和同会话连续回复。
- **AGY**：使用官方 ACP 组件调度；ACP 后台与 Antigravity 桌面历史不同，尚未打通桌面同会话续聊。
- **DeepSeek Harness**：可参与任务；原生会话可在客户端的“未分组”中选择，原生 Workspace 自动归组尚未完成。
- **GitHub Copilot**：已兼容原生账户配置的不同格式；存在会话入口不代表桌面同会话全流程已验收。
- **Muse**：指 Meta Muse 桌面应用，仅保留打开入口，自动派单尚未接通，未冒用 Muse Code CLI。

打开客户端入口不会暂停任务。如需在客户端继续同一会话，应在完整记录中显式移交；协作台随后禁止向该会话写入。收回时须先释放客户端写入占用，恢复失败会继续保留移交状态，不强行抢锁。

绘图能力取决于执行 agent 实际可用的工具；尚未验证专用 Codex 栅格生图后端，不能将代码生成或 SVG 交付当作该能力已接通。

## 从源码构建

当前打包目标为 **Apple Silicon Mac（macOS arm64）**。需要 Node.js 22 或更新版本、npm、Xcode Command Line Tools，以及 `backend/go.mod` 指定的 Go 版本（当前为 1.27.1）。首次构建会下载 Go 依赖、ACP Node 运行时、tmux 构建依赖和 AGY 官方组件。

```sh
cd frontend
npm ci
npm run build:coordinator
```

产物：`frontend/out/协作台-darwin-arm64/协作台.app`。无需安装原版 Agent Orchestrator；默认使用仓库中的固定版本准备脚本构建 tmux 与 ACP 运行资源。只有显式设置 `AO_VENDOR_RESOURCES` 时，才允许从指定资源目录复用第三方运行资源；本地协作引擎始终从本仓库编译。

### AGY 官方组件

构建会自动调用 [`prepare-coordinator-agy.mjs`](frontend/scripts/prepare-coordinator-agy.mjs)，准备官方 **1.4.5 darwin-arm64** 配套组件。二进制不放进 Git，下载后位于 `frontend/resources/agy-acp/`。

- 官方压缩包：https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.4.5-darwin-arm64.zip
- 压缩包 SHA-256：`886fff7767d08994ca39eb02c3d01a7532c7325a94aa33aaf52d52068733284f`
- 必须同时包含同版 `agy_acp_server.par` 和 `localharness_external`；脚本还校验两个文件各自的指纹。已有完整匹配组件时不会重复下载。

```sh
# 在 frontend 目录，只检查本地组件，不联网
node scripts/prepare-coordinator-agy.mjs --check

# 已有官方压缩包时离线校验并准备
node scripts/prepare-coordinator-agy.mjs --archive /path/to/official.zip
```

路径不存在、不是普通文件或校验失败时会报错，现有组件保持不变。下载、校验、解压及配套文件验证完成后才替换目录；替换失败会尝试恢复原目录，若恢复也失败则保留并报告备份位置。

## 本地数据与开发

本产品配置默认存于 `~/.ao/coordinator/`，服务端口为 `3310`。测试新实例时使用独立的 `AO_COORDINATOR_HOME` 和 `AO_COORDINATOR_PORT`，不要复用上游应用的数据库。轮次草稿和未发消息保存在本产品的 Electron 配置中，真实会话、运行和验收事实由协作引擎保存。

关闭窗口会隐藏应用；退出桌面窗口后，本地引擎继续运行。再次打开同一应用可以继续查看与沟通。

主要源码：

- `frontend/src/coordinator-main.ts`、`coordinator-preload.ts`：独立桌面入口与安全桥接。
- `frontend/src/coordinator/`：项目、任务卡、持续对话、轮次历史和执行现场。
- `frontend/src/renderer/lib/collaboration-plan.ts`：计划校验及派发协议。
- `backend/internal/service/chat/native_client.go`：原生客户端移交与收回。
- `backend/internal/adapters/chatdriver/codexappserver/project.go`：Codex 原生项目关联。
- `backend/internal/httpd/coordinator_surface.go`：精简产品的功能边界。
- `design-system/coordinator/MASTER.md`：简洁 macOS 风格的界面规范。

生成的 OpenAPI、前端 API 类型、sqlc 文件与迁移一并保留；更改接口或存储时遵循 [AGENTS.md](AGENTS.md)。

## 验证范围

0.5.0 的 **69 项相关前端测试及类型检查已在本机通过**，覆盖计划确认、多轮发送、幂等重试、历史分页、轮次保存、重开及原生客户端写入门禁。运行方式：

```sh
cd frontend
npm run typecheck
npm test -- src/coordinator src/main/coordinator-clients.test.ts src/renderer/lib/collaboration-plan.test.ts src/renderer/components/CollaborationPlanner.test.tsx src/main/coordinator-profile.test.ts
```

本机实际完成过 Codex 主 agent 规划 → Codex 与 DSH 依赖执行 → 报告、验收和归档。连续两条对话中，第二条正确复述第一条要求；原生会话标识未变，重开后仍保留回复和旧轮次。仓库不包含个人运行日志、真实项目、客户端账户或安装包。

完整后端测试不能笼统标为全部通过：已有 SessionManager 测试中存在本机模拟 tmux 路径前提不满足的用例。AGY、Copilot、Muse 的桌面同会话和原生项目归组也未全部验收。

本机安装包仅为本地 ad-hoc 签名测试包。完整性与 ACP Node 权限检查通过，但未获 Apple Developer ID 公证，`spctl` / stapling 检查未通过；未修改 Gatekeeper。仓库中新增的组件准备流程已做本地指纹、错误路径与校验失败检查，尚未声称在全新机器完成完整构建。

## 上游与许可证

基于 Agent Orchestrator 上游提交 `c0b351a31eccaf1ac55f8e5015fd21ab414545ca`。上游源码随仓库保留的 [`LICENSE`](LICENSE) 为 **Apache-2.0**，本产品的自定义打包声明与 About 文案与其保持一致。各供应商组件及其他第三方依赖受各自许可与条款约束，不能视为由上游源码许可证统一覆盖。
