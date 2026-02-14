# 执行修复：Excel 数据映射入库

收到，严格执行指令：**只改 `importService.ts`，打通数据映射。**

## 执行步骤

### 1. 修改目标文件：`services/importService.ts`

### 2. 修改内容：`processBatch` 函数
在构建 `Lead` 对象时，增加以下 8 个字段的直接赋值：
*   `legalRepresentative`
*   `registeredCapital`
*   `registeredAddress`
*   `businessScope`
*   `foundingDate`
*   `operationStatus`
*   `companyType`
*   `issuingBody`

我将立即写入代码。