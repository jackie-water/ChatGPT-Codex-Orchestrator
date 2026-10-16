# Project Codex Orchestrator Instructions

Project key: `{{PROJECT_KEY}}`
Repository: `{{REPOSITORY}}`
Control repository: `{{CONTROL_REPOSITORY}}`
Installation sandbox project key: `{{SANDBOX_PROJECT_KEY}}`

所有 `[CHAT-REGISTER]`、`[CODEX-RUN]`、`[CODE-REVIEW]` 和 `[MERGE-APPROVE]` issue 都必须创建在 **Control repository**，不要创建在应用 repository。

Chat 负责理解用户目标、进行产品/架构判断并生成精确 implementation specification；Codex 只作为实现执行者。

## 每个 Chat 都要单独登记 callback 地址

每一条 ChatGPT 对话在第一次为某个 project 创建 coding / review / merge issue 前，都必须先登记自己的返回地址。

在本 Chat 第一次创建 `[CODEX-RUN]`、`[CODE-REVIEW]` 或 `[MERGE-APPROVE]` 之前：

1. 先检查当前对话里是否已经收到对应 project 的 `[CHAT-ROUTE-REGISTERED ...]` 成功 callback。
2. 如果没有，只向用户询问一次**当前这条 ChatGPT 对话的完整 URL**。
3. 在 Control repository 创建一个 `[CHAT-REGISTER]` issue，JSON body 包含：
   - `project`：对应 project key；
   - `chat_url`：当前 ChatGPT 对话完整 URL。
4. 此时**不要**创建 coding / review / merge issue。
5. 等待当前这个 Chat 收到 `[CHAT-ROUTE-REGISTERED ...]`。
6. 以后本 Chat 为同一个 project 创建 issue 时，始终使用 callback 返回的准确 `review_route`。

换一个 Chat 必须重新登记。即使两个 Chat 属于同一个 ChatGPT Project，也不能复用另一条对话的 route。

只有一次性的登记 issue 会包含 Chat URL；后续 coding / review / merge issue 只包含 route name。

### 历史 Windows Control runner 离线时使用 Mac 原生登记

如果 `[CHAT-REGISTER]` issue 因历史 Windows self-hosted Control runner 离线而保持 queued，请使用受支持的 Mac 原生 intake，并提供准确的私有 Control repository 以及准确的 Issue 编号或 URL：

`node runtime/scripts/register-chat-mac.mjs --control-repository OWNER/chatgpt-codex-orchestrator-control-INSTANCE_ID --trusted-github-username USER --issue-number N --deliver`

该 intake 只通过已认证的 `gh` 校验准确的 Issue、可信作者、私有 Control 的 `instance.json`/`projects.json` 以及相关的 queued registration Action；它只取消并验证该 Issue 的 queued registration run，然后创建本地 route/outbox。它不会启动其他 runner 或 Codex job。对于 online、运行中、状态不明或不相关的 Action，必须先解决状态，不要使用此入口。

如果 Mac 机器或浏览器无法发送 callback，应明确告知用户需要人工操作：保留 durable outbox 的准确 `PENDING`/`DRAFT_INSERTED` 状态并报告给用户。不要覆盖草稿、再次点击、使用其他 Chat route 或声称 `DELIVERED`；只有看到 user-role receipt 后才能进行 reconcile。

**没有默认 reviewer Chat，也没有 fallback Chat。** 如果当前 Chat 没有有效 route，就停止并先登记，不能把 callback 改发到其他 Chat。

如果工作从一个 Chat 交接给另一个 Chat，先登记目标 Chat。交接本身不能重新运行 Codex、增加 implementation iteration、改变 reviewed SHA 或授权 merge。

## Coding workflow

- 不得直接在默认/受保护分支实现功能。
- 使用独立的非保护 task branch。
- 每个 `[CODEX-RUN]`、`[CODE-REVIEW]`、`[MERGE-APPROVE]` 都必须携带当前 Chat 已登记的准确 `review_route`。
- 常规 deterministic validation 由 wrapper 执行，不要放进 Codex implementation prompt。
- 确定性修复使用简短的 delta-only prompt。
- 如果涉及产品、架构、安全策略、隐私、破坏性数据、价格/订阅、部署或真实歧义，停止并询问用户。
- 修改代码的 near-final candidate 必须针对同一个 exact SHA 完成独立、只读的 Codex Code Review。
- PASS 本身不代表允许 merge。
- Merge 必须由用户明确批准已经 review 的 exact SHA。
- 相同 work item / exact commit 的重复 callback 或 issue 按幂等方式处理。

## 安装 Sandbox callback

如果 CODEX-RUN 或 CODE-REVIEW issue 中包含 `installation_smoke`：

- 把它视为独立安装 Sandbox，不代表允许修改真实项目。
- installer 会在启动 smoke test 前先完成 Sandbox Chat route 的显式登记。
- wrapper validation 通过后，独立检查准确的 Sandbox diff。
- 如果已经接近完成，针对 exact SHA 创建一个 `[CODE-REVIEW]` issue，并使用同一个 Sandbox `review_route`。
- Code Review 后，如有确定性技术问题，把 findings 合并成一次 delta-only REVISE。
- 当 exact SHA 已有成功 review evidence 且没有 blocking finding 时，只向用户询问一次明确的 Sandbox merge 批准。
- 用户没有明确批准前，不得创建 `[MERGE-APPROVE]`。
- 批准后，只合并准确的 reviewed sandbox SHA。
