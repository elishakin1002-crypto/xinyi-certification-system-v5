# 线索模块现状契约

## 目标

线索模块后端化前，先固定现有 UI、字段和行为。迁移期间不得顺手改字段名、页面文案、DOM 结构、demo 数据或业务流程。

## 页面入口

- 路由：`/#/leads`
- 侧边栏入口：`线索管理`
- 页面标题：`线索公海`
- 副标题：`全渠道商机捕获与 AI 智能管理`

## 顶部动作

| 文案 | 当前行为 |
|---|---|
| `筛出重点线索（90天内到期）` | 标记 90 天内到期且未转化/未丢失线索为跟进中 |
| `导入 Excel 表格` | 读取 `.xlsx` / `.csv` 并批量导入线索 |
| `新增线索` | 打开新增线索弹窗 |

## 列表筛选与搜索

- 状态筛选按钮：`全部`、`新增`、`跟进中`、`已转化`
- 搜索框 placeholder：`搜索线索...`
- 默认不展示 `Converted` / `Lost` 线索，除非筛选或工作台焦点指定。

## 桌面列表列

| 列名 | 数据来源 |
|---|---|
| `客户名称 / 行业` | `lead.company` / `lead.industry` |
| `联系人` | `lead.name` / `lead.position` |
| `AI 评分` | `lead.score` |
| `商机挖掘 (Target)` | `lead.targetCertifications` |
| `最后跟进` | `lead.lastContact` |
| `状态` | `lead.status` |
| `操作` | 打开详情 |

## 新增线索弹窗

弹窗标题：`新增线索`

当前字段：

| UI 文案 | 字段 |
|---|---|
| `客户名称` | `company` |
| `联系人` | `name` |
| `手机号` | `mobile` |

提交按钮：`保存线索`

新增默认值：

- `status=New`
- `score=60`
- `potentialValue=0`
- `probability=20`
- `source=官网`
- `intent=Medium`
- `contacts[0]` 为主联系人
- `followUpRecords=[]`

## 详情弹窗

详情弹窗保留以下区块：

- 头部：公司名、联系人/职位、状态、`生成跟进项目`、`编辑`/`保存`
- `AI 商机洞察`
- `基本信息`
- `工商注册信息`
- `跟进记录`

基本信息字段：

- `联系电话` -> `mobile`
- `微信号` -> `wechat`
- `来源渠道` -> `source`
- `统一信用代码` -> `unifiedSocialCreditCode`
- `目标认证到期日（挖角）` -> `targetCertExpiryDate`

工商注册信息字段：

- `法定代表人`
- `注册资本`
- `注册地址`
- `成立日期`
- `经营状态`
- `企业类型`
- `发证机构`
- `经营范围`

跟进记录：

- 类型：`电话`、`拜访`、`微信`、`邮件`
- 输入 placeholder：`输入今日沟通重点...`
- 快捷标签：`价格敏感`、`需发资料`、`预约面谈`、`竞品比价`、`暂时无意向`

## 当前前端上下文 API

迁移后前端页面仍应获得同样能力：

- `leads`
- `addLead(lead)`
- `updateLead(id, updates)`
- `addLeadFollowUp(leadId, record)`
- `createFollowUpProjectFromLead(leadId, options)`

## 回归测试覆盖

当前 E2E 应至少覆盖：

- 打开线索页
- 新增线索
- 搜索线索
- 打开详情弹窗
- 编辑并保存公司名
- 添加跟进记录
- 生成跟进项目

后续后端化只能更换数据来源，不得破坏上述 UI 契约。
