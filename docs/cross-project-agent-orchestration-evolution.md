# Spec2Flow 演进路线：跨项目 Agent 编排调度中心

- Status: active-design
- Source of truth: this document
- Related: `agent-orchestration-platform-design.md`, `project-workspace-autonomous-delivery-design.md`
- Created: 2026-04-09

## 核心问题

Synapse 生态有 6 个项目，每个项目需要不同类型的 Agent。当前各项目独立运作，缺乏跨项目协调能力。
Spec2Flow 已有持久化调度引擎（PostgreSQL + 租约 + 心跳 + 6 阶段 DAG），是天然的编排中心。

**设计目标：让 Spec2Flow 成为"一人公司"的 Agent 调度总控。**

---

## 1. 当前架构现状

```
你 (CTO)  ←─ 手动协调 ─→  各项目独立运行
│
├── Spec2Flow          → 6 阶段工程编排（需求→代码→测试→执行→缺陷→协作）
├── Growing            → 6 个营销 Agent（CrewAI crew）+ Ops Dashboard
├── Settlement         → Gateway + Admin + Frontend（纯服务，无 Agent）
├── Provider           → API 卖家运行时（纯服务，无 Agent）
├── SDK                → Python/TS SDK（纯服务，无 Agent）
└── Agents-Memory      → Agent 记忆运行时（共享基础设施）
```

**关键限制：**
- 各项目 Agent 无法互相发现和调用
- 跨项目任务（如"SEO Agent 产出关键词 → Spec2Flow 生成落地页"）只能人工串联
- Growing 的任务系统是单体 FastAPI，无 DAG、无租约、无自动修复

---

## 2. 目标架构：Spec2Flow 作为调度中心

```
┌──────────────────────────────────────────────────────┐
│               Spec2Flow (调度中心)                      │
│                                                        │
│  ┌──────────┐  ┌───────────┐  ┌───────────────────┐   │
│  │ Task DAG │  │ Scheduler │  │ Adapter Registry  │   │
│  │ Planner  │  │ (PG+Lease)│  │                   │   │
│  └────┬─────┘  └─────┬─────┘  │ ┌───────────────┐ │   │
│       │              │        │ │ copilot-cli    │ │   │
│       │              │        │ │ synapse-agent  │ │◄── 新增
│       │              │        │ │ mcp-tool       │ │   │
│       │              │        │ └───────────────┘ │   │
│       └──────────────┴────────┴───────────────────┘   │
│                         │                               │
│   ┌─────────────────────┼─────────────────────────┐    │
│   │    Agent Discovery   │    Task Dispatch         │    │
│   │   (Agent Card标准)    │   (claim → execute →    │    │
│   │                      │    report → next stage)  │    │
│   └──────────────────────┴─────────────────────────┘   │
└──────────────────┬──────────────────┬──────────────────┘
                   │                  │
     ┌─────────────▼──┐    ┌─────────▼──────────┐
     │   Growing       │    │   其他项目            │
     │   Agent Crew    │    │   Agent Crew         │
     │ ┌──────────────┐│    │ ┌──────────────────┐ │
     │ │ Agent Registry││    │ │ Agent Registry    │ │
     │ │ /api/agents   ││    │ │ (未来)            │ │
     │ │ /api/agents/  ││    │ └──────────────────┘ │
     │ │   match       ││    └──────────────────────┘
     │ └──────────────┘│
     └─────────────────┘
```

---

## 3. 每个项目需要什么 Agent

不同项目有不同的 Agent 需求，这是合理且必要的分工：

| 项目 | 需要的 Agent 类型 | 原因 |
|------|-------------------|------|
| **Growing** | 营销 Agent：SEO、CRO、Content、Growth Lead、Launch、DevRel | 增长运营是持续性工作，需要专业化分工 |
| **Settlement** | 工程 Agent：Backend Dev、Frontend Dev、Test Engineer、Security Reviewer | 核心交易系统需要严格的工程质量保障 |
| **Provider** | 工程 Agent：Backend Dev、API Designer、Test Engineer | 运行时服务开发和维护 |
| **SDK** | 工程 Agent：SDK Dev (Python)、SDK Dev (TS)、Doc Writer、Test Engineer | 多语言 SDK 开发和文档同步 |
| **Spec2Flow** | 平台 Agent：Planner、Evaluator、Repair Agent | 编排引擎自身的演进和自我维护 |
| **Agents-Memory** | 平台 Agent：Memory Architect、Standard Maintainer | 记忆/标准框架的演进 |

**设计原则：Agent 定义跟随项目（就近原则），调度权归 Spec2Flow（中心化调度）。**

每个项目维护自己的 `roles/` 目录和 Agent 定义（persona.md），Spec2Flow 通过标准协议发现并调度。

---

## 4. 开源 Agent 编排方案对比

### 4.1 主流框架横评

| 框架 | 定位 | 调度模型 | 持久化 | 跨项目能力 | 适合场景 |
|------|------|---------|--------|-----------|---------|
| **CrewAI** | 多 Agent 协作 | Flow → Crew → Agent，角色扮演式 | Flow 有状态管理 | ❌ 单进程内 | 单个 Crew 内的 Agent 协作 |
| **LangGraph** | 状态图工作流 | 有向图 + 节点 + 边 | 内置 checkpointer | ❌ 单图内 | 复杂推理链、分支循环 |
| **AutoGen** (Microsoft) | 对话式多 Agent | AgentChat + Core + gRPC 分布式 | Core 有 event-driven runtime | ⚠️ gRPC 分布式 Worker | 对话式协作、分布式场景 |
| **LlamaIndex Workflows** | 事件驱动工作流 | Event → Step → Event | DBOS durable execution | ❌ 单工作流内 | RAG、查询管道、Agent 工作流 |
| **A2A Protocol** (Google) | Agent 间通信协议 | 无——它是协议不是框架 | N/A | ✅ 这就是为此设计的 | 框架无关的 Agent 互操作 |
| **Temporal/Inngest** | 通用持久化工作流 | Activity + Workflow | ✅ 强持久化 | ✅ 微服务间 | 长时间运行的业务流程 |

### 4.2 关键洞察

**没有一个开源框架能直接满足"跨项目 Agent 编排"的完整需求。** 原因：

1. **CrewAI/LangGraph/LlamaIndex** 都是**单进程/单应用**内的 Agent 协作框架，不是分布式调度器
2. **AutoGen Core** 有 gRPC 分布式能力但偏重对话式交互，不适合持久化工程任务
3. **A2A Protocol** 是正确的**互操作层**但它是协议不是实现
4. **Temporal** 是最成熟的持久化调度引擎但没有 Agent 语义（不懂角色、技能、persona）

### 4.3 推荐组合

```
Spec2Flow (调度 + DAG + 持久化 + 工程语义)
  + A2A Protocol 风格的 Agent Card (发现 + 能力声明)
  + CrewAI (项目内 Agent 执行引擎)
  + MCP (Agent ↔ Tool 连接)
```

**理由：Spec2Flow 已有 Temporal 级别的调度基础设施（PostgreSQL、租约、心跳、自动修复），
再加上 Agent 发现和技能匹配语义，就是完整的 Agent 编排器。不需要引入外部调度引擎。**

---

## 5. 协议设计：Agent Card 标准

借鉴 A2A Protocol 的 Agent Card 概念，定义 Synapse 生态的 Agent 注册标准：

```yaml
# roles/seo_strategist/agent-card.yaml (每个 Agent 自带)
apiVersion: synapse/v1
kind: AgentCard

metadata:
  id: seo_strategist
  project: Synapse-Network-Growing
  version: "1.0"

identity:
  display_name: SEO Strategist
  type: agent           # agent | service | tool
  icon: "🔍"

capabilities:
  skills:
    - seo-audit
    - ai-seo
    - site-architecture
    - schema-markup
    - programmatic-seo
  input_types:
    - text/markdown
    - application/json
  output_types:
    - text/markdown
    - application/json

execution:
  runtime: crewai         # crewai | direct | mcp
  persona_path: roles/seo_strategist/prompts/persona.md
  endpoint: null          # 如有 HTTP API 则填入

constraints:
  max_concurrent: 1
  requires_approval: false
  cost_estimate: low      # low | medium | high
```

---

## 6. 渐进式演进路线

### Phase 0：人工编排（当前 ✅ 已完成）

```
你(CTO) → Growing Dashboard 派任务 → 手动拿结果 → 手动触发下一步
```
- Growing 有 `/api/agents/match` 技能匹配接口
- Org Chart 全局可视化

### Phase 1：Agent Card 标准化（下一步，2-3 天）

**目标：每个项目的 Agent 都有标准化的 Agent Card**

- [ ] 定义 `agent-card.yaml` schema（如上第 5 节）
- [ ] Growing: 为 6 个营销 Agent 生成 Agent Card
- [ ] Growing: `/api/agents/cards` 返回所有 Agent Card
- [ ] Growing: 更新 `/api/agents/match` 基于 Agent Card 匹配

### Phase 2：Spec2Flow Agent Adapter（1 周）

**目标：Spec2Flow 可以把任务路由给外部 Agent**

- [ ] 定义 `synapse-agent` adapter（对接 Growing 的 HTTP API）
- [ ] Spec2Flow 的任务可以指定 `executorType: synapse-agent`
- [ ] adapter 执行流程：
  1. 查询 `GET http://growing:9600/api/agents/match?skills={required_skills}`
  2. 选择最佳 Agent
  3. 创建 `POST http://growing:9600/api/tasks`
  4. 轮询 `GET /api/tasks/{id}` 等待完成
  5. 返回结果给 Spec2Flow 推进下一阶段

```typescript
// packages/cli/src/adapters/synapse-agent-adapter.ts
export const synapseAgentAdapter: ModelAdapterRuntime = {
  providerId: 'synapse-agent',
  async claimAndExecute(task: PlatformTaskRecord): Promise<TaskResult> {
    const agents = await fetch(`${GROWING_URL}/api/agents/match?skills=${task.requiredSkills.join(',')}`);
    const bestAgent = agents[0];
    const createdTask = await fetch(`${GROWING_URL}/api/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        agent_id: bestAgent.id,
        description: task.goal,
        requires_approval: task.riskLevel !== 'low',
      }),
    });
    return pollForCompletion(createdTask.id);
  },
};
```

### Phase 3：多项目 Agent Registry（2 周）

**目标：Spec2Flow 可以发现和调度所有项目的 Agent**

- [ ] Settlement/Provider/SDK 项目添加 `roles/` 目录和工程 Agent Card
- [ ] 每个项目运行轻量 Agent Registry sidecar（或嵌入主服务）
- [ ] Spec2Flow 维护 `agent-registry.yaml` 配置所有项目 endpoint
- [ ] Spec2Flow Planner 根据任务需求自动选择项目和 Agent

```yaml
# Spec2Flow 的 agent-registry.yaml
registries:
  - project: Synapse-Network-Growing
    url: http://localhost:9600
    capabilities: [marketing, seo, cro, content, growth]
  - project: Synapse-Network
    url: http://localhost:8100
    capabilities: [backend-dev, frontend-dev, smart-contract]
  - project: Synapse-Network-Provider
    url: http://localhost:8200
    capabilities: [api-design, backend-dev, testing]
```

### Phase 4：自动化闭环（长期）

**目标：端到端自动化——需求进来，代码 + 营销内容出去**

```
用户需求："为 Synapse 新功能做一个推广 campaign"
    │
    ▼
Spec2Flow Planner（分解任务 DAG）
    │
    ├── Stage 1: requirements-analysis
    │   └── adapter: copilot-cli → 分析需求、产出 PRD
    │
    ├── Stage 2: code-implementation
    │   └── adapter: copilot-cli → 实现功能代码
    │
    ├── Stage 3: test-design + execution
    │   └── adapter: copilot-cli → 写测试、跑 CI
    │
    ├── Stage 4: marketing-content        ← 新阶段，跨项目
    │   └── adapter: synapse-agent
    │       ├── SEO Agent → 关键词研究
    │       ├── Content Writer → 落地页文案
    │       └── CRO Optimizer → 转化优化建议
    │
    ├── Stage 5: review + approval
    │   └── evaluator: CTO 审批
    │
    └── Stage 6: publish
        ├── 代码 → governed PR
        └── 内容 → 发布到 CMS
```

---

## 7. 关键设计决策

### Q: 为什么不直接用 CrewAI / LangGraph 做总控？

CrewAI 和 LangGraph 是**执行层框架**（在一个进程内让多个 Agent 协作），
不是**调度层框架**（跨进程、跨项目、持久化、可恢复）。

类比：CrewAI = 一个团队的会议室，Spec2Flow = 公司的项目管理系统。
你需要项目管理系统来分配工作给不同团队，但每个团队内部可以用自己的方式协作。

### Q: 为什么不直接用 Temporal？

Temporal 是通用持久化工作流引擎，但它：
- 没有 Agent 语义（不懂角色、技能、persona）
- 没有工程语义（不懂 6 阶段、代码/测试/评审）
- 需要额外适配才能理解 Synapse 的领域逻辑

Spec2Flow 已经有 Temporal 级别的调度能力 + 工程领域语义，加上 Agent 发现就够了。

### Q: 为什么 Agent 定义跟随项目而不是集中管理？

**就近原则**：Agent 的 persona、skills、工具与它服务的代码库紧密耦合。
把 SEO Agent 定义放在 Growing 项目里，因为它需要读 Growing 的营销策略和内容模板。
集中管理会导致：更新延迟、上下文丢失、职责不清。

### Q: MCP 和 A2A 协议的关系？

```
MCP  = Agent ↔ Tool（Agent 调用工具）
A2A  = Agent ↔ Agent（Agent 之间互调）
Spec2Flow = Orchestrator ↔ Agent（编排器调度 Agent）
```

Spec2Flow 的 `synapse-agent` adapter 借鉴 A2A 的 Agent Card + Task 模式，
但不需要完全实现 A2A 协议（A2A 面向跨公司互操作，我们是内部生态）。

---

## 8. 成功标准

| 阶段 | 验收标准 |
|------|---------|
| Phase 1 | 所有 Growing Agent 都有标准 Agent Card，`/api/agents/cards` 可查询 |
| Phase 2 | Spec2Flow 能成功派发一个 SEO 分析任务给 Growing Agent 并拿回结果 |
| Phase 3 | Spec2Flow 能发现 3+ 项目的 Agent 并根据技能自动选择 |
| Phase 4 | 端到端自动化：一个需求 → 代码 PR + 营销内容全部产出 |
