# ChatGPT Codex Orchestrator

[English](README.md) | [简体中文](README.zh-CN.md)

> **当前为开发预览版，还不能用于正式生产环境。**

ChatGPT Codex Orchestrator 的目标，是把你在 ChatGPT 里描述的需求变成一套更安全的自动编程流程。你告诉 ChatGPT 想做什么，ChatGPT 负责理解和规划；Codex 在独立分支里修改代码；自动检查验证结果；必要时再进行独立技术审查。除非你明确批准已经审查过的那个准确版本，否则主分支不会被修改。

## 适合谁

这个项目主要面向**会使用 ChatGPT、但不一定懂开发和配置的人**。

正常情况下，你不应该需要自己修改 JSON、PowerShell、Git 分支、runner 或配置文件。

推荐安装方式：

1. 把这个 GitHub 项目链接发给一个可以操作你电脑的 AI。
2. 告诉 AI：**“帮我安装这个。”**
3. AI 调用项目提供的正式安装程序。
4. 能自动完成的配置全部自动完成。
5. 只有必须由你本人登录或授权时，安装才会暂停。
6. AI 每次只告诉你**当前需要完成的一步**。
7. 你完成后回复，AI 验证成功再继续下一步。

Windows 用户也可以直接双击 **Install.cmd**。

## 安装前需要准备什么

v0.1 最终会需要：

- 一台 Windows 电脑；
- GitHub 账号；
- 有 Codex 使用权限的 ChatGPT 账号；
- 一个你希望 ChatGPT/Codex 帮你修改的 GitHub 项目；
- 安装过程中由你本人完成 GitHub / Codex 的登录和授权。

你**不需要提前自己安装 Git、Node.js 或 Codex**。安装程序会负责检查，并在支持的情况下自动安装。

## 让 AI 帮你安装

把这个 GitHub 链接发给 AI，然后告诉它：

> 帮我安装这个项目。请按照项目里的 AI 安装协议执行，每次只让我完成一个必须人工操作的步骤。

AI 应读取 [AI_INSTALL.md](AI_INSTALL.md)，并使用项目提供的正式 installer，而不是自己随意设计安装命令。

## Windows 自己安装

双击 **Install.cmd**。

安装向导会一步一步引导。正常情况下不需要使用 PowerShell 或理解 Git。

## 安装完成以后怎么用

以后只需要在对应的 ChatGPT Project 里正常描述需求，例如：

> 帮我增加一个可以把报告导出成 CSV 的页面。

后面的技术流程由 Orchestrator 处理，包括：独立开发分支、自动验证、技术审查、修复迭代、结果返回和精确版本的合并批准。

## 安全模式

默认开启 Safe Mode：

- Codex 不直接在 main 分支工作；
- Codex 不会自己合并代码；
- 正常流程不使用 force push；
- Code Review 是只读的；
- 自动验证使用结构化命令，而不是任意 shell 字符串；
- 最终合并必须由用户明确批准已经审查过的准确 commit。

## 常见问题：内容已经出现在 ChatGPT 输入框里，但没有发送

这种情况偶尔会发生，例如 ChatGPT 还在生成上一条回复时，自动化正好准备发送下一条消息。

如果输入框里的内容以类似下面的文字开头：

`[CODEX-AUTO callback_id=...]`

你可以直接手动按 **发送**。

callback_id 用来帮助系统识别这是同一条通知，避免故意重复启动相同任务。

**不要因为消息停在输入框里就重新运行 Codex。**

如果这个问题反复出现，请使用 Repair。Repair 应优先重新发送 pending callback，而不是重新跑代码任务。

## 怎么检查系统是否正常

Doctor/Status 的目标是让普通用户看到类似：

```
整体状态：正常

Git                    ✓
Codex                  ✓
GitHub                 ✓
自动化 Runner           ✓
Chat 回调               ✓
等待发送的消息           0
```

除非你主动要求，否则不会先展示复杂技术日志。

## 怎么报告问题

如果发生错误，系统应先尝试安全的自动修复。

修复失败后，可以生成一份**已经脱敏的诊断报告**。任何报告都不能默认自动上传。你可以先查看，再决定是否提交。

默认报告不得包含密码、access token、API key、cookies、ChatGPT session、`.env` 内容或项目源代码。

## 当前开发状态

v0.1 正在完全独立的 DEV / SANDBOX 环境里开发和测试，不会使用现有生产 Orchestrator 作为试验环境。

请参阅 [AI_INSTALL.md](AI_INSTALL.md)、[SECURITY.md](SECURITY.md) 和 [v0.1 Roadmap](docs/ROADMAP-v0.1.md)。
