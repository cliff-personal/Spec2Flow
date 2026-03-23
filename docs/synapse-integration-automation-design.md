# Spec2Flow 复杂系统接入与自动化设计方案（以 Synapse-Network 为例）

## 1. 文档目标

这份文档回答四个问题：

1. Spec2Flow 当前整体流程架构设计有没有问题。
2. 当前架构是否足以跑通复杂系统。
3. Synapse-Network 这类同时包含前端、后端、管理后台、合约、Python 服务的系统，应该如何接入 Spec2Flow。
4. 从“接入系统”到“自动化完成需求分析、代码实现、测试设计、自动执行、缺陷反馈、协作流程”的中间流程是什么，以及要补哪些能力，才能尽量减少人工参与。

本文同时参考了 `obra/superpowers` 这类自动化项目的关键思路：

- 先有计划，再执行任务，而不是直接乱改代码
- 任务拆小，按任务逐个执行与验证
- 每个任务执行后都需要 review loop，而不是一次性大提交
- 工作流必须可测试，不能只靠概念描述
- 自动化系统本身也要有自己的“自验证路径”

## 2. 结论先说

### 2.1 当前架构没有方向性错误

Spec2Flow 目前的六阶段主线是对的：

1. 需求分析
2. 代码实现
3. 测试设计
4. 自动执行
5. 缺陷反馈
6. 协作流程

它解决的是“AI 如何参与整个工程闭环”，而不只是“AI 写代码”。这个方向没有问题。

### 2.2 但当前架构还不足以跑通复杂系统

对于一个像 Synapse-Network 这样的系统，当前 Spec2Flow 文档架构还缺 6 个关键能力：

1. **接入层缺失**
当前只定义了 workflow，没有定义“目标系统如何声明自己”。复杂系统需要一份正式的接入契约。

2. **环境编排层缺失**
现在只有“start service / run Playwright”的概念，但复杂系统需要启动多服务、多数据库、多端口、多密钥、多 runtime。

3. **任务控制层缺失**
没有定义 plan 如何转成可执行 DAG，也没有定义不同任务类型如何调度不同执行器。

4. **观察与状态层缺失**
没有统一的任务状态、运行状态、证据状态、工件状态存储模型。

5. **风险与审批层缺失**
像支付、账本、提现、签名、风控这类金融路径，不能默认允许“完全无人值守自动提交到主分支”。

6. **复杂仓库适配层缺失**
缺少针对 monorepo、多语言、多服务、多测试入口的 adapter 机制。

结论很明确：

- **简单项目**：当前架构经过补充后可以很快跑通
- **复杂系统**：当前架构只能跑通局部闭环，无法直接实现高可信无人值守

## 3. 为什么 Synapse-Network 是一个合适的接入样板

根据仓库现状，Synapse-Network 已经具备复杂系统的典型特征：

- 前端控制台：`apps/frontend`
- 管理后台前端：`admin/admin-front`
- 结算网关后端：`gateway`
- 管理后台后端：`admin/gateway-admin`
- Provider 服务：`provider_service`
- 合约与链上工具：`contracts`
- Python SDK：`sdk/python`
- 现成 CI 入口：`npm run ci:pr`
- 现成本地环境脚本：`scripts/local/setup_local_env.sh`

这意味着它不是一个单体 Web App，而是一个典型的多边界系统：

- UI 边界
- 管理边界
- API 边界
- 账本边界
- 签名边界
- 合约边界
- Provider 集成边界

如果 Spec2Flow 能稳定接入 Synapse-Network，那么它对其他复杂系统的适配能力就会非常有说服力。

## 4. 当前 Spec2Flow 架构的主要问题

### 4.1 把“工作流”写出来了，但没有把“接入协议”定义出来

现在的文档主要在描述：

- 我们希望做什么
- 我们希望输出什么
- 我们希望串起哪些工具

但还没有定义：

- 目标仓库如何声明自己的服务边界
- 哪些命令用于启动系统
- 哪些命令用于跑测试
- 哪些 URL 用于健康检查
- 哪些路径属于产品文档、架构文档、API 文档、用例文档
- 哪些变更属于高风险路径

没有这一层，自动化系统就只能靠临时猜测。

### 4.2 当前执行层默认“一个系统 = 一个应用”

现在的描述更接近：

- 启动应用
- 跑 Playwright
- 生成 bug draft

但 Synapse 这类系统实际上是：

- 启动数据库和 Redis
- 启动本地链
- 部署合约
- 启动 gateway
- 启动 frontend
- 启动 admin front
- 启动 admin backend
- 启动 provider_service
- 初始化环境变量
- 校验 contract-config 和 runtime env

这不是“run one app”，而是“编排一个系统拓扑”。

### 4.3 没有把代码任务与验证任务分离成独立执行器

复杂系统中至少会出现 5 类任务：

1. 文档理解任务
2. 代码修改任务
3. 单元/集成测试任务
4. 端到端验证任务
5. 缺陷归因与报告任务

这些任务不应该全部由同一个 agent 直接串行完成。需要有任务控制器，把任务分发给不同执行器。

### 4.4 缺少正式的“自动化等级”定义

不是所有任务都应该默认无人参与。

对于 Synapse 这类金融系统，至少要区分：

- 低风险：文档更新、普通 UI 文案、测试补充
- 中风险：普通前端功能、非资金路径后端逻辑
- 高风险：结算、提现、签名、账本、一致性、风控

没有自动化等级和风险分级，就无法决定哪些任务可以全自动执行，哪些必须保留人工 gate。

## 5. 面向复杂系统的目标架构

对于复杂系统，Spec2Flow 应该从现在的三层，扩展为六层。

## 5.1 接入层（Onboarding Layer）

职责：

- 让目标系统声明自己的结构和规则
- 不再依赖 agent 临时猜路径、猜命令、猜模块

这一层需要的核心产物：

- `project adapter config`
- `system topology config`
- `risk policy config`
- `workflow entrypoints config`

### 5.1.1 环境准备层应该成为正式阶段

如果接入的项目没有 Spec2Flow 所需的文档、配置或脚本，完全应该增加一个独立的“环境准备”阶段。

这是必要设计，不是可选优化。

原因很直接：

- 大多数项目没有现成的 requirement summary 模板
- 很多项目没有统一的启动脚本
- 很多项目没有标准化 smoke flow
- 很多项目没有 bug draft 模板
- 如果这些前置条件不存在，后续自动化就会退化成临时猜测

因此，复杂项目接入应从 7 个阶段扩展为 8 个阶段：

1. 环境准备
2. 需求分析
3. 代码实现
4. 测试设计
5. 自动执行
6. 缺陷反馈
7. 协作流程
8. 策略收敛与持续优化

其中“环境准备”要先于所有自动化执行。

### 5.1.2 环境准备阶段应该做什么

环境准备阶段的职责不是直接改业务代码，而是补齐自动化运行所需的骨架。

建议执行以下动作：

1. 识别项目类型
  - monorepo / single app / polyglot repo
  - web / api / mobile backend / contract repo

2. 识别现有资产
  - 是否已有 docs
  - 是否已有 CI
  - 是否已有 e2e
  - 是否已有本地启动脚本
  - 是否已有 issue template

3. 生成最小模板
  - `.spec2flow/project.yaml`
  - `.spec2flow/topology.yaml`
  - `.spec2flow/policies/risk.yaml`
  - `.spec2flow/workflows/smoke.yaml`
  - `docs/spec2flow/requirement-template.md`
  - `docs/spec2flow/bug-template.md`

4. 生成接入报告
  - 缺失项列表
  - 自动生成项列表
  - 仍需人工确认项列表

### 5.1.3 这样设计对使用者更容易维护吗

答案是：**是的，但前提是模板生成遵守“最小可维护原则”。**

正确做法：

- 生成少量、清晰、稳定的模板文件
- 让模板只声明项目事实，不埋复杂逻辑
- 模板只作为配置层，不作为隐藏规则层

错误做法：

- 一次性生成几十个文件
- 生成大段难以读懂的 agent prompt
- 把项目逻辑写死在模板里

对使用者更容易维护的关键，不是“自动生成得越多越好”，而是：

- 生成的内容少
- 文件职责单一
- 能人工读懂
- 变更点可追踪

建议坚持一个原则：

**模板负责声明，运行时负责推理。**

也就是说：

- 模板里写“服务在哪里、怎么启动、什么是高风险”
- 不要把“完整执行逻辑”硬编码进模板

建议新增接入文件，例如：

```yaml
spec2flow:
  project:
    name: synapse-network
    type: polyglot-monorepo

  docs:
    requirements:
      - docs/01_Product_Vision
      - docs/01_Product_Frontend
    architecture:
      - docs/02_System_Architecture
      - docs/03_Core_Workflows
    database:
      - docs/04_Database_Design
    operations:
      - docs/05_DevOps_Deployment

  services:
    frontend:
      path: apps/frontend
      start: cd apps/frontend && yarn dev
      health: http://localhost:3000
    gateway:
      path: gateway
      start: sh scripts/local/restart_gateway.sh
      health: http://localhost:8000/health
    provider_service:
      path: provider_service
      start: cd provider_service && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8100
      health: http://localhost:8100/health
    admin_front:
      path: admin/admin-front
      start: cd admin/admin-front && yarn dev
      health: http://localhost:3001
    admin_gateway:
      path: admin/gateway-admin
      start: cd admin/gateway-admin && sh scripts/ops/start-local.sh
      health: http://localhost:8010/health

  infrastructure:
    bootstrap: sh scripts/local/setup_local_env.sh
    stop: sh scripts/local/stop_local_env.sh
    compose: docker-compose/docker-compose.yml

  tests:
    repo_ci: npm run ci:pr
    frontend_ci: npm run ci:frontend
    gateway_ci: npm run ci:gateway
    provider_ci: npm run ci:provider-service
    contracts_ci: npm run ci:contracts

  risk:
    high:
      - contracts/**
      - gateway/src/services/finance/**
      - gateway/src/api/routers/provider_withdraw*.py
      - docs/03_Core_Workflows/03_Billing_Settlement_and_Audit.md
      - docs/03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md
    medium:
      - apps/frontend/**
      - admin/**
      - provider_service/**
    low:
      - docs/**
      - tests/**
```

## 5.2 计划层（Planning Layer）

职责：

- 读取需求和目标系统上下文
- 生成结构化 plan
- 将需求拆成可执行任务

参考 `superpowers` 的经验，这一层不能只有“一个大计划”，而要输出：

- 目标说明
- 架构影响面
- 任务列表
- 每个任务的 verify 命令
- 每个任务的风险等级
- 每个任务的依赖关系

建议输出形式：

- requirement summary
- implementation plan
- task DAG
- verification matrix

## 5.3 任务控制层（Task Orchestration Layer）

职责：

- 把 plan 转成可执行任务图
- 为不同任务选择不同执行器
- 串联 review loop

这里建议至少拆出 5 类执行器：

1. `spec-analyzer`
2. `code-implementer`
3. `test-designer`
4. `system-runner`
5. `defect-reporter`

复杂系统中最关键的是：

- 任务不是一个 agent 干到底
- 而是 controller 调度多个专职 agent

### 5.3.1 多 agent 编排建议

要支持复杂系统，Spec2Flow 不应该只有一个大 agent，而应该采用 controller + specialists 的模型。

建议的最小多 agent 拓扑如下：

1. `controller-agent`
  - 负责读取任务图
  - 负责任务分发
  - 负责汇总状态

2. `requirements-agent`
  - 负责需求分析
  - 负责输出 requirement summary

3. `implementation-agent`
  - 负责代码实现
  - 负责按任务粒度执行修改

4. `test-design-agent`
  - 负责生成测试矩阵与测试用例

5. `execution-agent`
  - 负责启动环境与执行测试
  - 负责工件收集

6. `defect-agent`
  - 负责失败归因
  - 负责生成 bug draft

7. `review-agent`
  - 负责 plan review、spec compliance review、quality review

这个模型和 `superpowers` 的核心经验是一致的：

- 计划与执行分开
- 执行与 review 分开
- review 形成循环，而不是一次性放行

### 5.3.2 多 agent 之间如何协作

多 agent 不能靠自然语言随意传话，必须靠结构化上下文协作。

建议所有 agent 通过统一任务对象交接：

```yaml
task:
  id: task-frontend-smoke-001
  stage: automated-execution
  goal: validate login and dashboard flow
  inputs:
   requirementSummary: outputs/requirements/req-001.json
   changedFiles:
    - apps/frontend/src/app/login/page.tsx
   topologyRef: .spec2flow/topology.yaml
  verify:
   - npm run ci:frontend
   - npx playwright test playwright/tests/login.spec.ts
  risk: medium
  artifactsDir: spec2flow/outputs/execution/task-frontend-smoke-001
```

这样做的价值是：

- agent 不需要反复重读整个仓库
- controller 能精确重试单个任务
- review agent 能独立复核

## 5.7 模型抽象层（Model Abstraction Layer）

如果要支持不同大模型，以及为后续接入 OpenClaw 做准备，必须把“工作流能力”和“模型能力”解耦。

不要把 Spec2Flow 设计成“只适合某一个模型 API 的框架”。

### 5.7.1 这一层要解决什么

它要解决 4 个问题：

1. 不同模型的上下文长度不同
2. 不同模型的工具调用能力不同
3. 不同模型的稳定性和格式遵循度不同
4. 不同宿主平台的 agent 生命周期不同

### 5.7.2 建议采用三层抽象

#### A. Workflow Contract
定义 Spec2Flow 自己的任务和产物契约，例如：

- requirement summary schema
- task graph schema
- execution report schema
- bug draft schema

这一层与模型无关。

#### B. Agent Capability Interface
定义 agent 需要具备哪些能力，而不是绑定某个具体模型：

- `analyze_documents`
- `plan_tasks`
- `edit_code`
- `design_tests`
- `summarize_failures`
- `draft_bug_report`

这一层是能力接口层。

#### C. Provider Adapter
针对不同模型或宿主实现适配器，例如：

- `copilot-adapter`
- `openclaw-adapter`
- `openai-adapter`
- `anthropic-adapter`
- `local-oss-adapter`

这一层只负责把统一能力接口映射到底层模型平台。

### 5.7.3 为 OpenClaw 做准备时要注意什么

如果未来要接入 OpenClaw，建议提前保证以下设计：

1. **不要把工具调用协议写死在 Copilot 风格上**
  - 工具能力应抽象成内部统一接口

2. **不要把 prompt 直接硬编码到某个平台特性里**
  - prompt 要与平台注入层分离

3. **允许不同 adapter 声明能力差异**
  - 是否支持工具调用
  - 是否支持 JSON 模式
  - 是否支持多 agent
  - 是否支持长上下文

4. **把任务状态与执行状态存在模型外部**
  - 不能依赖单轮会话记忆作为系统状态来源

### 5.7.4 推荐能力协商格式

可以为不同 adapter 定义统一能力声明，例如：

```yaml
adapter:
  name: openclaw-adapter
  supports:
   toolCalling: true
   jsonMode: true
   longContext: false
   multiAgentDispatch: true
   codeEditing: true
   browserAutomation: false
  limits:
   maxContextTokens: 64000
   maxParallelAgents: 4
```

controller 再根据能力决定：

- 哪些任务能并行
- 哪些任务必须降级
- 哪些任务必须交给其他 provider

## 5.4 环境与执行层（Environment And Execution Layer）

职责：

- 启动多服务环境
- 运行测试矩阵
- 运行浏览器自动化
- 采集证据

对于 Synapse-Network，这一层至少要支持：

1. repo bootstrap
2. local env bootstrap
3. service health verification
4. chain + database + backend + frontend 联合启动
5. smoke path 执行
6. test matrix 执行

这层不是单一的 Playwright runner，而是“系统级 runtime orchestrator”。

## 5.5 观察与证据层（Observation Layer）

职责：

- 存储执行状态
- 统一保存 artifacts
- 统一汇总失败原因

需要标准化的证据类型：

- command logs
- service health snapshots
- Playwright traces
- screenshots
- API request and response excerpts
- CI links
- failing commit / branch metadata

## 5.6 协作与策略层（Collaboration And Policy Layer）

职责：

- 将结果写回 GitHub Actions / GitHub Issues / PR
- 控制是否允许继续自动执行
- 在高风险任务上插入审批 gate

这一层决定“无人参与”的边界。

## 6. Synapse-Network 如何接入 Spec2Flow

## 6.1 接入目标

让 Synapse-Network 能在 Spec2Flow 中完成如下闭环：

1. 读取 docs 与 issue，完成需求分析
2. 识别受影响模块，生成实施任务
3. 生成测试设计与测试矩阵
4. 启动系统并自动执行验证
5. 失败时生成缺陷反馈
6. 将结果沉淀到 PR / CI / GitHub Issues

## 6.2 第一步不是“自动写代码”，而是“建立接入契约”

Synapse 接入 Spec2Flow 的第一步，不是让 agent 直接改仓库。

而是先建立三份契约：

### 契约 A：系统拓扑契约
回答：

- 系统有哪些服务
- 服务间依赖关系是什么
- 每个服务怎么启动
- 每个服务怎么判断 ready

### 契约 B：验证契约
回答：

- 哪些测试命令是 canonical
- 哪些 smoke flow 是最重要的
- 哪些变更必须跑哪些测试

### 契约 C：风险契约
回答：

- 哪些目录和流程属于高风险
- 哪些任务允许无人参与
- 哪些任务必须停在 PR 或 issue 草稿阶段

## 6.3 Synapse 的推荐接入方式

建议为 Synapse 新增一组 Spec2Flow 接入文件，例如：

```text
.spec2flow/
├─ project.yaml
├─ topology.yaml
├─ workflows/
│  ├─ smoke.yaml
│  ├─ billing-regression.yaml
│  ├─ withdrawal-risk.yaml
│  └─ provider-onboarding.yaml
├─ policies/
│  ├─ risk.yaml
│  └─ approvals.yaml
└─ prompts/
   ├─ requirements.md
   ├─ implementation.md
   ├─ testing.md
   └─ bug-report.md
```

### `project.yaml`
用于定义：

- docs 根入口
- 服务边界
- 启动命令
- 测试命令
- artifact 目录

### `topology.yaml`
用于定义：

- gateway 依赖 postgres/redis/anvil
- frontend 依赖 gateway
- admin front 依赖 admin gateway
- provider service 被 gateway 依赖

### `workflows/*.yaml`
用于定义系统级业务流程：

- 充值
- quote / invoke
- 计费结算
- provider 注册
- 提现审批

### `policies/risk.yaml`
用于定义无人执行边界。

## 7. 从接入系统到自动化完成任务，中间流程应该是什么

这里给出一条完整流程。

在进入正式工作流之前，应该先增加 `阶段 -1：环境准备与模板生成`。

## 7.0 阶段 -1：环境准备与模板生成

输入：

- 仓库路径
- 现有 docs / scripts / CI / tests

系统动作：

1. 扫描仓库结构
2. 检测已有文档、启动脚本、测试入口、CI 入口
3. 自动生成最小 `.spec2flow/` 配置模板
4. 自动生成 requirement / bug / workflow 模板
5. 输出接入缺口报告

输出：

- onboarding templates
- gap report
- baseline config

这一阶段完成后，才进入正式的需求分析与执行闭环。

## 7.1 阶段 0：项目接入

输入：

- 仓库路径
- docs 入口
- 启动命令
- 测试入口
- 风险策略

系统动作：

1. 读取接入配置
2. 验证所有路径、命令、health check 是否可用
3. 执行一次 baseline bootstrap
4. 执行一次 baseline test
5. 生成 onboarding report

输出：

- 项目已接入
- baseline 可运行
- 风险分区已建立

## 7.2 阶段 1：需求分析

输入：

- GitHub Issue / 产品文档 / 设计文档

系统动作：

1. 读取 docs 入口
2. 读取相关模块代码
3. 生成 requirement summary
4. 生成 affected systems
5. 生成 open questions
6. 根据风险策略确定自动化级别

输出：

- requirement summary
- impacted components
- automation level

## 7.3 阶段 2：实现计划与任务拆分

系统动作：

1. 生成 implementation plan
2. 将计划拆成任务
3. 给每个任务分配：
   - 目标文件
   - verify 命令
   - 风险等级
   - 依赖任务
4. 建立任务图

输出：

- task DAG
- verification matrix

## 7.4 阶段 3：代码实现

系统动作：

1. 在隔离分支或 worktree 中执行任务
2. 每个任务完成后运行对应 verify
3. 对关键任务执行 review loop
4. 将结果写入 execution state

这里要借鉴 `superpowers` 的核心思想：

- 不要一次性实现全部变更
- 每个任务必须有自己的验证命令
- 每个任务结束都要有 review loop

输出：

- 原子任务级代码变更
- 任务级验证结果

## 7.5 阶段 4：测试设计

系统动作：

1. 根据 requirement summary 和 changed files 生成测试矩阵
2. 自动决定：
   - unit
   - integration
   - API
   - Playwright smoke
   - domain regression
3. 把测试任务加入 DAG

对于 Synapse，至少要自动区分：

- UI 变更
- API 变更
- 账本与提现变更
- 合约变更

输出：

- structured test plan
- regression scope

## 7.6 阶段 5：自动执行

系统动作：

1. 编排环境启动
2. 执行 component test
3. 执行 system smoke
4. 执行 Playwright
5. 采集 artifacts

对于 Synapse，建议至少有 4 组自动化流：

1. `frontend-smoke`
2. `gateway-api-smoke`
3. `provider-registration-flow`
4. `withdrawal-risk-regression`

注意：

- 第 4 组属于高风险流，不建议一开始就完全无人执行到 merge

## 7.7 阶段 6：缺陷反馈

系统动作：

1. 汇总失败测试
2. 关联失败任务、失败 commit、失败环境
3. 生成 bug draft
4. 附上 artifacts
5. 自动分类 severity 与 area

输出：

- bug markdown
- GitHub Issue draft payload

## 7.8 阶段 7：协作流程

系统动作：

1. 汇总本次任务状态
2. 生成 PR summary
3. 生成 CI report
4. 对失败项自动创建 issue draft 或 comment
5. 根据 policy 决定是否自动推进下一步

输出：

- PR summary
- CI artifacts
- issue drafts

## 8. 要做到“自动化执行任务不需要人工参与”，中间还缺什么

这是最关键的问题。

## 8.1 先说现实结论

对于 Synapse 这种金融类多系统仓库：

- **完全不需要人工参与** 不是一个默认安全目标
- **分级无人执行** 才是合理目标

建议定义 4 级自动化：

### L0：辅助模式
- AI 只分析、建议、生成文档
- 不自动提交代码

### L1：受控执行模式
- 自动改代码
- 自动跑测试
- 自动生成 PR
- 人工审核后合并

### L2：低风险无人执行模式
- 对低风险路径允许自动提交、自动合并
- 前提是全部验证通过且策略允许

### L3：高可信自治模式
- 仅对经过长期验证的低风险任务类型开放
- 仍然对金融关键路径保留人工 gate

对 Synapse 这种系统，现实可落地目标是：

- 文档、普通前端、部分测试补充：做到 L2
- 常规后端非资金路径：做到 L1 或有限 L2
- 资金、签名、提现、账本、风控：长期维持 L1

## 8.2 要达到高自动化，必须补的能力

### 能力 1：标准接入配置
没有接入配置，就不可能稳定自动化。

### 能力 2：标准任务计划格式
没有结构化任务，就无法做 task-level orchestration。

### 能力 3：系统拓扑感知执行器
必须知道谁依赖谁，谁先启动，谁健康后再继续。

### 能力 4：风险策略引擎
必须知道什么时候继续，什么时候停下来等审批。

### 能力 5：工件和状态存储
必须把：

- 当前阶段
- 当前任务
- 任务结果
- artifacts
- 失败原因

记录下来。

### 能力 6：工作流自测试
Spec2Flow 自己也要像 `superpowers` 一样，给自己的工作流做 integration test。

例如：

- 给一个样例仓库
- 给一个样例需求
- 自动生成 plan
- 自动执行部分任务
- 验证结果是否符合预期

否则“工作流能跑通”永远只是口头描述。

## 9. 面向 Synapse-Network 的推荐自动化落地顺序

不要试图一步到位。

建议按 5 步落地。

## 9.1 第一步：建立 Synapse 的接入契约

交付物：

- `.spec2flow/project.yaml`
- `.spec2flow/topology.yaml`
- `.spec2flow/policies/risk.yaml`
- `.spec2flow/workflows/smoke.yaml`

目标：

- 让 Spec2Flow 能正确理解 Synapse，不再靠猜。

## 9.2 第二步：建立 baseline bootstrap 检查器

交付物：

- onboarding validator
- health check runner
- baseline report generator

目标：

- 确认本地环境可拉起
- 确认健康检查可通过
- 确认 canonical test commands 可运行

## 9.3 第三步：先打通一个低风险闭环

建议先选：

- 普通 frontend 控制台需求
- 或 provider_service 的非资金路径接口

目标：

1. 需求分析
2. 代码实现
3. 测试设计
4. 自动执行
5. 缺陷反馈
6. PR/Issue 协作

先完成这一条完整闭环。

## 9.4 第四步：再打通一个跨服务闭环

建议选：

- provider registration flow
- quote + invoke flow

目标：

- 证明 Spec2Flow 可以处理多服务联动，而不仅是单模块修改。

## 9.5 第五步：最后才进入高风险资金路径

建议最后接入：

- deposit idempotency
- billing settlement
- withdrawal risk gates

原因：

- 这些路径对一致性、签名、账本、审计要求最高
- 一上来全自动风险太大

## 10. Spec2Flow 自己需要增加什么模块

为了支撑上面的方案，Spec2Flow 需要新增以下模块：

### 模块 A：Project Adapter
职责：读取目标项目接入配置。

### 模块 B：System Topology Engine
职责：管理服务依赖、启动顺序、健康检查。

### 模块 C：Environment Preparation Generator
职责：扫描仓库、生成最小模板、输出接入缺口报告。

### 模块 D：Task Graph Engine
职责：将需求计划转为任务图。

### 模块 E：Policy Engine
职责：根据风险等级决定是否允许自动推进。

### 模块 F：Execution State Store
职责：保存阶段状态、任务状态、工件元数据。

### 模块 G：Model Provider Adapter Layer
职责：适配 Copilot、OpenClaw 与其他模型平台。

### 模块 H：Multi-Agent Controller
职责：调度 specialist agents，管理上下文交接、重试与 review loop。

### 模块 I：Workflow Integration Tests
职责：验证 Spec2Flow 的工作流本身可以跑通。

## 11. 最终建议

### 11.1 对架构的判断

当前 Spec2Flow 架构：

- 主流程方向正确
- 作为复杂系统自动化框架还不完整
- 最大问题不是“理念错了”，而是“接入协议、任务编排、环境编排、风险控制”还没正式设计出来

### 11.2 对 Synapse 接入的判断

Synapse-Network 完全可以作为 Spec2Flow 的首个复杂系统接入样板。

因为它同时覆盖：

- 前端
- 后端
- 管理后台
- Provider 服务
- 合约
- CI
- 金融高风险链路

它能帮助 Spec2Flow 提前暴露真实问题，而不是只在简单 demo 项目里自我证明。

### 11.3 对“无人参与”的判断

如果目标是：

- 从接入系统到自动化完成整套流程
- 且完全不需要人工参与

那么答案是：

- **技术上可以逐步逼近，但不应该作为金融复杂系统的默认目标**
- 合理目标应该是：
  - 低风险任务尽量无人化
  - 中风险任务自动执行到 PR
  - 高风险任务自动执行到验证和草稿，但保留人工批准

这才是对复杂支付系统真正负责的设计。

## 12. 下一步落地建议

如果基于这份设计继续推进，建议下一批工作是：

1. 为 Spec2Flow 定义统一的 `project adapter` 配置 schema
2. 定义 `environment preparation generator` 的输出规范
3. 为 Synapse-Network 编写第一版 `.spec2flow/project.yaml` 与 `topology.yaml`
4. 定义 Spec2Flow 的 task graph schema
5. 定义 risk policy schema
6. 定义 model adapter capability schema，为 OpenClaw 预留适配层
7. 先拿 Synapse 的一个低风险前端需求打通第一条自动化闭环

只有先把这些基础契约补齐，Spec2Flow 才能真正从“流程设想”进入“复杂系统可执行框架”。