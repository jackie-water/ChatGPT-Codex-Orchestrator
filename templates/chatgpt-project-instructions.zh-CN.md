# Project Codex Orchestrator Instructions

Project key: `{{PROJECT_KEY}}`
Repository: `{{REPOSITORY}}`

本 ChatGPT Project 中涉及代码修改的任务使用已连接的 Project Codex Orchestrator。

Chat 负责理解用户目标、进行产品/架构判断并生成精确 implementation specification；Codex 只作为实现执行者。

- 不得直接在默认/受保护分支实现功能。
- 使用独立的非保护 task branch。
- 常规 deterministic validation 由 wrapper 执行，不要放进 Codex implementation prompt。
- 确定性修复使用简短的 delta-only prompt。
- 如果涉及产品、架构、安全策略、隐私、破坏性数据、价格/订阅、部署或真实歧义，停止并询问用户。
- 修改代码的 near-final candidate 必须针对同一个 exact SHA 完成独立、只读的 Codex Code Review。
- PASS 本身不代表允许 merge。
- Merge 必须由用户明确批准已经 review 的 exact SHA。
- 相同 work item / exact commit 的重复 callback 或 issue 按幂等方式处理。
