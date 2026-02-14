# UI 字段补全 V1.0 执行方案

收到，严格按照【字段对齐清单】执行。以下是直接可落地的操作步骤：

## 一、Lead 详情页 (Pages/Leads.tsx)

**目标**：在详情页中补齐缺失的工商信息展示位。

### 1. 确认数据结构 (Types)
*   *状态确认*：`Lead` 接口已在上一轮补全了 `registeredAddress`, `legalRepresentative` 等 8 个扩展字段。

### 2. UI 修改点
*   **组件位置**：详情弹窗 (Modal) -> `LEFT COLUMN` (左侧栏) -> 位于 `基本信息` 卡片下方。
*   **新增 Card**：`【工商注册信息】` (Business Info)
*   **Card 内字段布局** (Grid 2列布局)：
    1.  **法定代表人** (`legalRepresentative`)
    2.  **注册资本** (`registeredCapital`)
    3.  **成立日期** (`foundingDate`)
    4.  **经营状态** (`operationStatus`)
    5.  **企业类型** (`companyType`)
    6.  **发证机构** (`issuingBody`)
    7.  **注册地址** (`registeredAddress`) - *跨两列 (col-span-2)*
    8.  **经营范围** (`businessScope`) - *跨两列 (col-span-2)，支持多行文本截断*

## 二、Customer 详情页 (Pages/Customers.tsx)

**目标**：将已存在于数据结构但未显示的字段“画”出来。

### 1. 确认数据结构 (Types)
*   *状态确认*：`Customer` 接口原生包含所有目标字段。

### 2. UI 修改点
*   **组件位置**：详情弹窗 (Modal) -> `LEFT COLUMN` (左侧栏) -> 位于 `工商主体信息` (Business Info) 区域。
*   **现有字段**：`法定代表人`, `注册资本`, `成立日期`, `信用代码`。
*   **需补全字段** (追加在现有列表后)：
    1.  **注册地址** (`registeredAddress`)
    2.  **企业类型** (`companyType`)
    3.  **经营状态** (`operationStatus`)
    4.  **经营范围** (`businessScope`) - *作为单独块展示，支持滚动查看*

---

**执行总结**：
本次只修改 `Leads.tsx` 和 `Customers.tsx` 的渲染部分 (JSX)，确保 Excel 里能抓到的这 8 个核心字段在两个页面都有“座位”。不涉及任何逻辑变更。