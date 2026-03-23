# Synapse-Network 接入示例

这组文件展示 Spec2Flow 在复杂系统上的最小接入形态。

当前也可以直接作为最小运行时输入：

```bash
npm install
npm run validate:synapse-example
npm run generate:synapse-task-graph
npm run generate:synapse-task-graph:frontend-change
npm run generate:synapse-task-graph:withdrawal-change
```

生成结果默认写入：

- `docs/examples/synapse-network/generated/onboarding-validator-result.json`
- `docs/examples/synapse-network/generated/task-graph.json`
- `docs/examples/synapse-network/generated/task-graph-frontend-change.json`
- `docs/examples/synapse-network/generated/task-graph-withdrawal-change.json`

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

这些文件不是最终运行时实现，而是环境准备生成器应该产出的目标样例。

适用场景：

- polyglot monorepo
- frontend + backend + admin + provider + contracts
- 金融或高风险业务路径