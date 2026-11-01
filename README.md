# 协作台 · Agent Coordinator

一个面向 macOS 的本地多 agent 项目协作桌面应用。选择共享项目和主 agent，通过多轮对话明确需求，确认阶段任务卡及执行 agent，由主 agent 分工、验收并整合。

当前本地版本：**0.5.0**。项目基于 [Agent Orchestrator](https://github.com/OrchestratorInc/agent-orchestrator)，保留上游源码与 Apache-2.0 许可证，使用独立桌面入口、界面和数据目录。

## 已实现

- 中文桌面界面、自定义图标与项目侧栏。
- 主 agent 持续多轮对话、较早消息加载、消息草稿与幂等重试。
- 可编辑的阶段任务卡、每卡指定 agent、依赖与真实验收。
- 多轮协作记录，查看历史任务卡，沿用主会话追加下一轮。
- 展开查看各 agent 的消息、命令输出与文件修改。
- Codex 原生项目归组，以及支持范围内的客户端会话移交和收回。

AGY、Codex、DeepSeek Harness 与 GitHub Copilot 的执行接入已纳入产品；Muse 桌面仍待自动派单适配。各客户端的项目/会话桥接能力存在差异，详见[开发与使用说明](README.coordinator.zh-CN.md)。

## 开发入口

先阅读 [README.coordinator.zh-CN.md](README.coordinator.zh-CN.md) 中的环境、构建及验证步骤；界面规范见 [design-system/coordinator/MASTER.md](design-system/coordinator/MASTER.md)。原版项目说明保存在 [README.upstream.md](README.upstream.md)。

```sh
cd frontend
npm ci
npm run typecheck
npm run build:coordinator
```

构建需要指定版本的 Go 和 macOS 开发工具；大型第三方运行组件由准备脚本获取，不纳入 Git。成品输出到 `frontend/out/`，运行数据保存在 `~/.ao/coordinator/`，均不上传。

## 来源与许可证

上游基准提交：`c0b351a31eccaf1ac55f8e5015fd21ab414545ca`。本仓库为独立产品迭代使用，并非上游官方发行版。保留原 [LICENSE](LICENSE)；第三方运行组件遵循各自来源的许可证与条款。
