# Synapse-Network 接入示例

这组文件展示 Spec2Flow 在复杂系统上的最小接入形态。

当前也可以直接作为最小运行时输入：

```bash
npm install
npm run validate:synapse-example
npm run generate:synapse-task-graph
npm run generate:synapse-execution-state
npm run preflight:copilot-cli
npm run claim:synapse-next-task
npm run submit:synapse-task-result
npm run simulate:synapse-model-run
npm run run:synapse-task-with-adapter
npm run run:synapse-copilot-cli-loop
npm run run:synapse-workflow-loop
npm run generate:synapse-task-graph:frontend-change
npm run generate:synapse-task-graph:withdrawal-change
```

如果是“在对话中先提出需求，再让 Spec2Flow 自动派发后续任务”，优先直接传 requirement 文本：

```bash
npm run spec2flow -- generate-task-graph \
	--project .spec2flow/project.yaml \
	--topology .spec2flow/topology.yaml \
	--risk .spec2flow/policies/risk.yaml \
	--requirement "服务商注册流程增加 KYC 校验，并补充网关接口校验与回归验证" \
	--output .spec2flow/task-graph.requirement.json
```

如果需求内容较长，改用文件：

```bash
npm run spec2flow -- generate-task-graph \
	--project .spec2flow/project.yaml \
	--topology .spec2flow/topology.yaml \
	--risk .spec2flow/policies/risk.yaml \
	--requirement-file .spec2flow/requirements/current-request.md \
	--output .spec2flow/task-graph.requirement.json
```

如果在真实接入仓库里运行，也仍然可以直接从 `git diff` 自动读取 changed files：

```bash
npm run spec2flow -- generate-task-graph \
	--project .spec2flow/project.yaml \
	--topology .spec2flow/topology.yaml \
	--risk .spec2flow/policies/risk.yaml \
	--changed-files-from-git \
	--git-diff-repo /path/to/synapse-network \
	--git-base origin/main \
	--git-head HEAD
```

如果不传 `--git-base` 和 `--git-head`，默认读取当前仓库的 `git diff --name-only HEAD`；如果只想读取暂存区变化，可以改用 `--git-staged`。

生成结果默认写入：

- `docs/examples/synapse-network/generated/onboarding-validator-result.json`
- `docs/examples/synapse-network/generated/task-graph.json`
- `docs/examples/synapse-network/generated/execution-state.json`
- `docs/examples/synapse-network/generated/task-claim.json`
- `docs/examples/synapse-network/generated/task-result.json`
- `docs/examples/synapse-network/generated/simulated-model-run.json`
- `docs/examples/synapse-network/generated/adapter-run.json`
- `docs/examples/synapse-network/generated/copilot-cli-preflight.json`
- `docs/examples/synapse-network/generated/workflow-loop-summary.json`
- `docs/examples/synapse-network/generated/command-workflow-loop-summary.json`
- `docs/examples/synapse-network/generated/task-graph-frontend-change.json`
- `docs/examples/synapse-network/generated/task-graph-withdrawal-change.json`

如果命令参数里要传 `--add-artifacts` 或 `--add-errors` 这类带 `|` 的值，必须用引号包起来，避免 shell 把它当成管道。

变更文件样例：

- `docs/examples/synapse-network/changes/frontend-change.txt`
- `docs/examples/synapse-network/changes/withdrawal-change.txt`

现在的 route 选择优先级是：

- 有 `--requirement` 或 `--requirement-file` 时，按 requirement 命中 route
- 否则如果有 changed files，按 changed files 命中 route
- 两者都没有时，默认生成全部 route

现在的风险判定会同时结合：

- `risk.yaml` 里的 `paths`
- `workflowNames`
- `serviceKinds`
- 实际传入的 changed files

并且只会提升已选中 route 的风险等级，不会把一次局部需求扩散成全局高风险任务图。

包含：

- `project.yaml`：项目接入与命令入口
- `topology.yaml`：服务依赖与工作流路由
- `risk.yaml`：自动化等级与高风险保护策略
- `model-adapter-capability.json`：模型适配器能力与限制示例
- `model-adapter-runtime.json`：如何调用真实外部 adapter command 的运行时契约

`model-adapter-runtime.json` 现在调用 `example-command-adapter.mjs` 这个真实 Copilot CLI adapter。它会读取 claim，执行 `gh copilot -p`，并在配置了 session key 时自动用 `--resume` 复用已有 Copilot CLI session，然后返回结构化结果，由 CLI 写回状态。

`model-adapter-runtime.json` 的字段说明现在统一收口在 [docs/runtime-config-reference.md](../../runtime-config-reference.md)。这里不再重复维护整套字段解释。

你可以把它当成这几个问题的统一答案：

- 顶层 `adapterRuntime` 每个字段是干什么的
- 哪些字段是默认值，通常不需要动
- 哪些字段只在 override 默认行为时才应该改
- 自用 runtime 里的 `cwd`、`timeoutMs`、`stageRuntimeRefs` 分别是什么意思

运行前至少需要满足：

- `gh` 已安装
- `gh copilot -- --help` 可运行
- `gh copilot login` 已完成

环境变量也统一收口到 [docs/runtime-config-reference.md](../../runtime-config-reference.md)。那里已经把 provider 配置、session 配置、控制器注入变量、权限开关拆开写清楚了。

如果不设置 `SPEC2FLOW_COPILOT_MODEL`，adapter 会直接使用 Copilot CLI 当前账户的默认模型。这通常比硬编码 `gpt-5` 更稳，因为不同账户可用模型并不完全一致。

更推荐的做法是直接在 `model-adapter-runtime.json` 里设置 `adapterRuntime.model`。如果不设置这个字段，就回退到 Copilot CLI 默认模型。

正式执行前先跑一次：

```bash
npm run preflight:copilot-cli
```

它会检查：

- `gh copilot` 命令是否可用
- `gh auth status` 是否成功
- `gh copilot -p` 在当前配置模型或默认模型下是否能返回最小 JSON 探活结果

现在只要 `run-task-with-adapter` 或 `run-workflow-loop` 使用的是 `github-copilot-cli` runtime，Spec2Flow 就会在执行前自动跑这组 preflight。

如果你明确要跳过，可以手动加上：

```bash
npm run spec2flow -- run-task-with-adapter \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--claim docs/examples/synapse-network/generated/task-claim.json \
	--adapter-runtime docs/examples/synapse-network/model-adapter-runtime.json \
	--skip-preflight
```

这个 adapter 按文档采用了以下做法：

- 用 `-p` 执行一次性、可脚本化 prompt
- 用 `--resume=<sessionId>` 复用 session，但只在 runtime 提供稳定 session key 时启用
- 保留 `.github/copilot-instructions.md` 作为仓库级指令
- 用 `--model` 固定模型
- 用 `--no-ask-user` 做非交互运行
- 用 `--available-tools view,grep,glob` 收缩工具面
- 用 `--disable-builtin-mcps` 避免不必要的远程能力

现在仓库里的默认 runtime 把 session 作用域设为 specialist agent 名称，也就是 `requirements-agent`、`implementation-agent`、`test-design-agent`、`execution-agent`、`defect-agent`、`collaboration-agent` 这六类固定 session。这样同一个 agent 会跨 run 复用同一条会话，不会每次新 run 都再创建一组新 session。

同时，这个 adapter 的内建默认行为就是 cleanup-safe 的 `auto` 模式，不需要额外配置。固定 specialist key 会落盘复用；如果 runtime 还在传动态多段 key，adapter 也会自动收敛回对应的 specialist session，而不是继续制造新的 run-scoped session。

默认情况下不需要改 session 粒度。只有当你明确要覆盖默认 specialist 复用策略时，adapter template context 才需要用到这些 key：

- `${specialistSessionKey}`: `specialist agent name`
- `${runSessionKey}`: `runId`
- `${routeSessionKey}`: `runId + routeName`
- `${stageSessionKey}`: `runId + stage`
- `${executorSessionKey}`: `runId + executorType`
- `${routeExecutorSessionKey}`: `runId + routeName + executorType`
- `${taskSessionKey}`: `runId + taskId`

其中，覆盖默认值时建议这样理解：

- `${specialistSessionKey}` 是当前默认值。大多数仓库保持这个值就够了
- `${executorSessionKey}` 只有在你显式设置 `SPEC2FLOW_COPILOT_SESSION_PERSIST_MODE=always` 时才适合按 run 做 specialist 隔离；默认 `auto` 会把它收敛回稳定 specialist session
- `${routeExecutorSessionKey}` 只有在你显式设置 `SPEC2FLOW_COPILOT_SESSION_PERSIST_MODE=always` 时才适合强隔离；默认 `auto` 同样会把它收敛回稳定 specialist session
- `${taskSessionKey}` 会产生最多 session，默认也只建议临时使用

另外，自动 preflight 现在会把成功结果按 runtime 指纹缓存 15 分钟，缓存窗口内重复执行 `run-task-with-adapter` 或 `run-workflow-loop` 不会重复触发那条 `pwd` probe，也就不会再往 Copilot session 列表里继续灌相同的探测会话。

如果你要清理旧版本遗留下来的 run-scoped session 文件，可以运行：

```bash
npm run migrate:copilot-sessions
```

它会把可迁移的旧记录归并到固定 specialist key，并删除旧的 run-scoped 文件，同时生成 `.spec2flow/runtime/copilot-session-migration-report.json` 报告。

它不直接依赖 VS Code 里的 Copilot Chat 会话，而是走官方文档里的 Copilot CLI 命令面。

这些文件不是最终运行时实现，而是环境准备生成器应该产出的目标样例。

适用场景：

- polyglot monorepo
- frontend + backend + admin + provider + contracts
- 金融或高风险业务路径