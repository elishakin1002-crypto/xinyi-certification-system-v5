# 执行计划：线索/客户导入系统重构 V2 (基础地基版)

收到，我们将严格按照“结构正确 + 跑得通”的原则，仅实现 Raw Data Layer 的基础结构和最小闭环流程。

## 执行步骤

### 1. 数据结构定义 (Infrastructure)
*   **目标文件**: `types.ts`
*   **新增类型**:
    *   `ImportRecord`: 记录导入批次（文件名、时间、总行数、状态）。
    *   `ImportRowRaw`: 记录每一行的原始 JSON 数据（完整保留所有列）。

### 2. 核心服务实现 (Service Layer)
*   **目标文件**: `services/importService.ts` (新建)
*   **功能**:
    *   `createImportBatch`: 接收 Excel 解析后的 JSON 数组，创建批次记录。
    *   `saveRawData`: 将原始数据存入内存（模拟数据库存储）。
    *   `processBatch`: 执行一次基础解析，将 Raw Data 转换为 `Lead` 对象。
        *   *解析逻辑*：内置两套硬编码映射规则（适配您的两个模板），确保能跑通。

### 3. 状态管理集成 (State Management)
*   **目标文件**: `context/AppContext.tsx`
*   **功能**:
    *   添加 `importRecords` 状态。
    *   暴露 `importExcel` 方法供 UI 调用。

### 4. UI 接入 (Integration)
*   **目标文件**: `pages/Leads.tsx`
*   **修改**:
    *   替换原有的 `handleImport` 逻辑。
    *   改为调用 `importExcel`，上传后自动触发处理并刷新列表。
    *   (可选) 简单展示导入结果提示（如“导入成功，共解析 N 条数据”）。

我将立即开始执行。