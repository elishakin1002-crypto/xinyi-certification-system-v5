# 字段对齐清单：Excel vs Lead vs Customer

收到指令。我已完全停止架构重构工作。
根据您提供的 Excel 模板内容（包含三体系名单与快启获客表）以及现有的前端代码结构，我整理了这份**严格对齐**的字段清单。

**核心结论**：目前前端 `Lead` (线索) 详情页缺失大量工商类字段，而 `Customer` (客户) 详情页虽然定义了字段但在 UI 上展示不全。必须先补齐这些“坑位”，数据才能“落座”。

## 字段对齐清单 (Field Alignment Matrix)

| 序号 | Excel 表头字段 (来源) | 线索 (Lead) 字段名 | 客户 (Customer) 字段名 | 前端详情页是否已有展示? | 备注 / 缺口分析 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **企业名称** / 公司名称 | `company` | `name` | ✅ (Lead/Cust) | 核心主键，已对齐 |
| **2** | **联系人** / 法人 / 姓名 | `name` | `contactPerson` | ✅ (Lead/Cust) | 需注意：Lead叫 `name`, Customer叫 `contactPerson`，语义需统一 |
| **3** | **联系方式** / 手机 / 电话 | `mobile` | `mobile` | ✅ (Lead/Cust) | 已对齐 |
| **4** | **职位** / 职务 | `position` | **(缺失)** | ✅ (Lead) / ❌ (Cust) | Customer 详情页目前没地方展示“职位” |
| **5** | **公司地址** / 注册地址 | **(缺失)** | `registeredAddress` | ❌ (Lead) / ✅ (Cust) | **严重缺口**：线索页完全没地方放地址 |
| **6** | **统一社会信用代码** | `unifiedSocialCreditCode` | `unifiedSocialCreditCode` | ✅ (Lead/Cust) | 已对齐 |
| **7** | **注册资本** | **(缺失)** | `registeredCapital` | ❌ (Lead) / ✅ (Cust) | **缺口**：线索页缺展示位 |
| **8** | **经营范围** | **(缺失)** | `businessScope` | ❌ (Lead) / ❌ (Cust) | Customer 有定义但详情页未展示 |
| **9** | **法定代表人** | **(缺失)** | `legalRepresentative` | ❌ (Lead) / ✅ (Cust) | **缺口**：线索页缺展示位 |
| **10** | **成立日期** | **(缺失)** | `foundingDate` | ❌ (Lead) / ✅ (Cust) | **缺口**：线索页缺展示位 |
| **11** | **经营状态** (存续/在业) | **(缺失)** | `operationStatus` | ❌ (Lead) / ❌ (Cust) | Customer 有定义但详情页未展示 |
| **12** | **企业类型** | **(缺失)** | `companyType` | ❌ (Lead) / ❌ (Cust) | Customer 有定义但详情页未展示 |
| **13** | **体系认证到期日期** | `targetCertExpiryDate` | `certificates[].expiryDate` | ✅ (Lead) / ✅ (Cust) | 线索页仅支持单日期，客户页支持多证书 |
| **14** | **发证机构** | **(缺失)** | `certificates[].issuingBody` | ❌ (Lead) / ✅ (Cust) | 线索页无法记录“谁发的证”，只能记日期 |

## 差距分析 (Gap Analysis)

**1. 线索 (Lead) 详情页“严重的工商信息缺失”**
*   Excel 里有大量的 `地址`、`法人`、`注册资本`、`经营范围`。
*   目前的 Lead 详情页完全没有这些字段的展示位。如果现在导入，这些信息只能被迫丢弃，或者塞进备注里（这不符合结构化要求）。

**2. 客户 (Customer) 详情页“有字段无展示”**
*   `types.ts` 里定义了 `businessScope` (经营范围)、`companyType` (企业类型)、`operationStatus` (经营状态)。
*   但在 `Customers.tsx` 的详情弹窗里，根本没有写这几行代码来渲染它们。

## 下一步行动建议 (Action Plan)

在恢复导入逻辑开发之前，必须先执行以下 **UI 补全任务**：

1.  **改造 `Lead` 接口与详情页**：
    *   新增字段：`address` (地址), `legalRep` (法人), `capital` (注册资本), `scope` (经营范围)。
    *   在详情页新增一个 **“工商信息” (Business Info)** 卡片，专门展示这些从 Excel 抓取来的硬核信息。

2.  **补全 `Customer` 详情页**：
    *   把隐藏在代码里但没画出来的 `businessScope`、`companyType`、`operationStatus` 字段画出来。

**请确认：这份对齐清单是否准确？是否同意先进行 UI 字段补全，再做导入？**