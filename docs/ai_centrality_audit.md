# AI 是否成为系统“大脑中枢”审计报告（V5.x）

## 0. 结论摘要

本系统的 AI 目前处于“全局交互中枢”位置，但尚未成为“系统主链路与真相源（System of Record）的中枢”。

- 作为交互中枢：成立。AI 聊天挂件被全局注入到布局中，用户可从任意页面触发 AI，并通过动作协议直接写入客户/合同/提醒等核心业务数据。
- 作为系统中枢：不成立。核心业务仍由 AppContext + LocalStorage 驱动；AI 有后端/前端双路容灾，AI 不可用时业务仍可运行，AI 不是不可替代的核心引擎。

## 1. 判定标准（“中枢性”五维）

从系统架构角度，将“是否为大脑中枢”拆为 5 个可验证维度：

1) 入口统一性：是否被全局注入，是否成为主要交互入口  
2) 决策权与执行权：是否能触发写操作/推进流程/自动执行  
3) 状态持久化与真相源：AI 产出是否沉淀为系统的主状态，并被其它模块依赖  
4) 失败可用性：AI 不可用时系统是否可继续正常运行  
5) 治理能力：权限点、审计日志、幂等、错误码、数据脱敏、限流等是否到位

系统口径前提（写死）：

- AI、提醒、扫描、判断等执行类行为，只能从项目触发
- 线索、客户、合同只负责产生项目，不具备执行能力

关于“线索不到项目，AI 也能提醒，怎么做到的？”的人话版说明，见项目域文档的附录章节：docs/project_execution_domain.md。

## 2. 关键证据（代码与文档）

### 2.1 全局注入（AI 入口中枢）

- Layout 全局挂载 ChatWidget：components/Layout.tsx 中直接渲染 `<AIChatWidget />`  
- ChatWidget 文案定位“总控入口”：components/AIChatWidget.tsx `DEFAULT_WELCOME_MSG`

### 2.2 AI 可写入系统主数据（执行权）

- ChatWidget 支持 `<execute_action>{JSON}</execute_action>` 动作协议，解析后可写入客户/合同等主数据；提醒属于执行类行为，已收敛为“必须绑定项目”的强约束：components/AIChatWidget.tsx `executeSystemActions()`

### 2.3 AI 在“项目域”拥有决策中心能力（但仍是增强）

- AppContext 内置 `runProjectDiagnosis(projectId)`：调用 `aiService.analyzeProjectStatus()` 获取结构化建议，写入 `aiDecisionLogs` 与 `project.aiInsight`，并对高优先级提醒做自动执行：context/AppContext.tsx

### 2.4 AI 服务是可选增强（失败自动降级）

- 文档明确支持“纯前端演示模式与前后端分离生产模式”，并描述 AI 服务 Hybrid Failover：docs/system_architecture.md
- aiService 的路由策略：优先后端 `/api/ai/*`，失败自动切前端 SDK 直连：services/aiService.ts `routeRequest()`

### 2.5 项目域铁律（口径）

- “没有项目：系统不得提醒、判断、扫描、执行”“不允许绕过项目直接触发 AI 行为”：docs/project_execution_domain.md

### 2.6 自动提醒机制的真实来源（澄清）

系统的“自动化提醒/到期挖角”并不依赖 AI 扫描数据对象：

- 数据对象（线索/客户/认证字段）的阈值检查由规则层完成：命中阈值 → 自动立项（跟进项目）+ 自动生成核心任务
- 执行对象（项目/任务）的到期/逾期提醒由项目扫描器生成：扫描范围只包含进行中的项目与任务，提醒必须绑定项目
- AI 的边界：只允许读取项目/任务层（执行对象）用于诊断与建议，不得绕过项目对数据对象产生执行

## 3. 三条关键闭环（函数级调用链）

### 3.1 闭环 A：全局 ChatWidget 总控闭环（对话 -> 动作 -> 写回系统）

入口与编排：

1. components/Layout.tsx：全局渲染 `<AIChatWidget />`
2. components/AIChatWidget.tsx：用户输入触发 `handleSend()`
3. `handleSend()`：
   - 生成日期上下文 `dateContext`
   - RAG 注入：从 `knowledgeDocs` 过滤 `aiVisible===true`，拼接 `ragContext`（最多 10 篇，可能注入截断正文/摘要）
   - 构造 systemPrompt（包含“JSON Action”协议要求）
   - 组装 `chatHistory`（system + user/model）
4. 调用 AI：`aiService.chat('kimi-k2.5', chatHistory)`
5. 获得 `fullResponseText` 后：
   - UI 展示：过滤掉 `<execute_action>...</execute_action>` 块，得到 `displayableText`
   - 执行动作：`executeSystemActions(fullResponseText)`
6. `executeSystemActions()`：
   - 正则提取 `<execute_action>...</execute_action>`
   - `JSON.parse()` 得到 `actionData`
   - 按优先级执行写入：`addCustomer()` -> `addContract(..., create_project)` -> （仅当提醒绑定项目时）`addReminder()`
7. 最终结果：系统状态被更新（客户/合同/提醒），并在 UI 中标记“已自动同步至系统台账”

闭环性质判断：

- 该闭环赋予 AI “跨业务域写入权”，在交互层面具备“中枢”特征。
- 其中“执行类行为（提醒）”已统一收敛到项目执行域；但数据录入类写入（客户/合同）仍需要进一步补齐权限点、审计与幂等后，才能在生产口径下视为可治理。

### 3.2 闭环 B：Project AI 决策中心闭环（项目 -> 诊断 -> 审计日志 -> 自动提醒）

入口与执行：

1. pages/Projects.tsx：用户点击“立即深度诊断”（触发 `runProjectDiagnosis(projectId)`）
2. context/AppContext.tsx：`runProjectDiagnosis(projectId)`
3. `runProjectDiagnosis()`：
   - `aiService.analyzeProjectStatus(project)`：LLM 输出严格 JSON（riskLevel + suggestedActions）
   - 生成 `AIDecisionLog`：写入 `aiDecisionLogs`
   - 写回项目洞察：更新 `project.aiInsight`
   - 自动执行：遍历 `suggestedActions`，当 `ADD_REMINDER` 且 `priority=High` 时调用 `executeAIAction()`
4. `executeAIAction()`：将动作映射为 `addReminder()` 写入提醒，且强制 `linkType='project'`

闭环性质判断：

- 该闭环符合“项目域执行”口径：自动提醒绑定项目。
- 该闭环体现 AI 在项目域的“决策建议 + 部分自动执行”能力，可被视为“项目域大脑”雏形，但仍未成为全系统真相源。

### 3.3 闭环 C：结构化抽取闭环（文件/表格 -> JSON -> 回填/导入）

该类闭环在多个页面出现，基本范式一致：

1. 页面侧收集输入（合同文件、证照图片、Excel 结算表等）
2. 调用 aiService.generateJSON / aiService.chat / aiService.generateText 获取结构化结果
3. 将结构化结果回填到表单状态或调用导入函数写入系统

典型入口：

- pages/Customers.tsx：证照 OCR -> 结构化字段/审核计划回填
- pages/Finance.tsx：Excel 前 N 行 -> Settlement JSON -> `importSettlements()`
- pages/Contracts.tsx：合同抽取 -> 回款计划/风险分级 -> 写入合同与应收

闭环性质判断：

- 这类闭环把 AI 当作“解析器/助手”，增强业务效率，但不决定系统主链路；更多是“工具人”而非“中枢大脑”。

## 4. “中枢性”打分（当前实现）

评分：0-5 分，越高越接近“系统大脑中枢”。

| 维度 | 得分 | 证据要点 |
|---|---:|---|
| 入口统一性 | 5 | Layout 全局挂载 ChatWidget；AI Center 页面也存在 |
| 决策权/执行权 | 3 | ChatWidget 可写客户/合同；提醒等执行类行为已强制绑定项目；Project 诊断可自动执行高优先级项目提醒 |
| 状态持久化/真相源 | 2 | 主数据仍是 AppContext + LocalStorage；AI 输出只是写入的一部分来源 |
| 失败可用性 | 4 | aiService 后端不可用自动降级前端；即使 AI 不可用主业务仍可使用（但部分功能失效） |
| 治理能力 | 1 | 动作执行缺少权限点、审计一致性、幂等与限流；后端无鉴权与统一错误码契约 |

综合判断：

- AI 对用户体验与部分业务闭环的影响很大（像“强入口 + 强助手”）。
- 但从“系统必须依赖 AI 才能运行”的角度看，AI 目前不是系统的“唯一大脑”，更像一个“全局外挂 OS + 项目域决策模块”。

## 5. 口径差异与风险清单（需要对齐）

### 5.1 项目域铁律 vs ChatWidget 跨域写入

文档口径要求：

- “没有项目：系统不得提醒、判断、扫描、执行”
- “不允许绕过项目直接触发 AI 行为”

现状实现：

- ChatWidget 可直接创建客户/合同（数据录入类写入）。
- 提醒已收敛为“项目域强约束”：ChatWidget 仅允许创建绑定项目的提醒；非项目提醒会被拒绝或被收敛为项目提醒（必要时通过立项完成绑定）。

风险：

- 若允许 AI 在全局入口直接落库（即使不含提醒），仍需补齐权限点、审计、幂等与脱敏，否则在接入真实后端后仍是高风险入口。

### 5.2 权限、审计与幂等不足（治理能力短板）

关键缺口：

- 权限点：ChatWidget 动作执行不校验角色/权限（即使系统有 `hasPermission` 模型，也未在动作执行处统一检查）。
- 审计一致性：Project 诊断有 `aiDecisionLogs`，但 ChatWidget 动作没有统一的“AI 执行日志”。
- 幂等：动作协议没有幂等键；重复发送可能造成重复客户/提醒/合同。
- 限流：后端 `server/app.js` 没有针对 `/api/ai/*` 的限流/鉴权；容易被滥用（在生产场景尤甚）。
- 数据脱敏：提示词构造与日志打印可能泄露业务数据；RAG 注入直接拼接正文/摘要，缺少脱敏规则。

### 5.3 提示词与 RAG 注入的可控性与成本

- 当前 RAG 是“把允许文档直接注入 prompt”，没有向量检索与权限隔离分级，存在 token 成本/响应时间不可控问题。
- systemPrompt 明确要求“必须使用 webSearch 工具”，但当前工具注入与后端工具执行链路需要进一步确认与治理（否则是“口径有、执行未必可控”）。

## 6. 建议的下一步（不在本报告中直接改代码）

建议先定口径：你希望 AI 成为“系统中枢”，还是保持“强助手但不拥有默认执行权”。

对应的两套设计与影响评估见：docs/ai_governance_options.md
