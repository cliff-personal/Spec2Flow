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

如果在真实接入仓库里运行，也可以直接从 `git diff` 自动读取 changed files：

```bash
node packages/cli/src/spec2flow.mjs generate-task-graph \
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

现在的风险判定会同时结合：

- `risk.yaml` 里的 `paths`
- `workflowNames`
- `serviceKinds`
- 实际传入的 changed files

并且只会提升受影响 route 的风险等级，不会把一次局部前端改动扩散成全局高风险任务图。

包含：

- `project.yaml`：项目接入与命令入口
- `topology.yaml`：服务依赖与工作流路由
- `risk.yaml`：自动化等级与高风险保护策略
- `model-adapter-capability.json`：模型适配器能力与限制示例
- `model-adapter-runtime.json`：如何调用真实外部 adapter command 的运行时契约

`model-adapter-runtime.json` 现在调用 `example-command-adapter.mjs` 这个真实 Copilot CLI adapter。它会读取 claim，执行 `gh copilot -p`，然后返回结构化结果，由 CLI 写回状态。

运行前至少需要满足：

- `gh` 已安装
- `gh copilot -- --help` 可运行
- `gh copilot login` 已完成

可选设置：

- `SPEC2FLOW_COPILOT_MODEL`
- `SPEC2FLOW_COPILOT_ADAPTER_NAME`
- `SPEC2FLOW_COPILOT_CWD`

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
node packages/cli/src/spec2flow.mjs run-task-with-adapter \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--claim docs/examples/synapse-network/generated/task-claim.json \
	--adapter-runtime docs/examples/synapse-network/model-adapter-runtime.json \
	--skip-preflight
```

这个 adapter 按文档采用了以下做法：

- 用 `-p` 执行一次性、可脚本化 prompt
- 保留 `.github/copilot-instructions.md` 作为仓库级指令
- 用 `--model` 固定模型
- 用 `--no-ask-user` 做非交互运行
- 用 `--available-tools view,grep,glob` 收缩工具面
- 用 `--disable-builtin-mcps` 避免不必要的远程能力

它不直接依赖 VS Code 里的 Copilot Chat 会话，而是走官方文档里的 Copilot CLI 命令面。

这些文件不是最终运行时实现，而是环境准备生成器应该产出的目标样例。

适用场景：

- polyglot monorepo
- frontend + backend + admin + provider + contracts
- 金融或高风险业务路径