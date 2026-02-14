# 统一导入/识别/上传框架 (Ingestion Framework)

## 1. 设计目标
- **统一底座**：所有业务模块（线索、客户、合同、知识）复用同一套文件读取、压缩、AI 识别与错误处理逻辑。
- **就地入口**：不改变用户习惯，在各自业务页面保留上传入口，但底层调用统一服务。
- **智能增强**：集中实现去重、审计、失败重试与格式标准化。

## 2. 核心架构

### 2.1 统一任务接口 (IngestJob)
```typescript
interface IngestJob {
  source: 'lead_excel' | 'certificate' | 'contract' | 'knowledge';
  files: File[];
  options?: {
    targetId?: string; // 关联的实体ID (如 customerId)
    autoCreateProject?: boolean;
    aiVisible?: boolean; // 知识库专用
  };
}
```

### 2.2 统一结果 Schema (IngestResult)
```typescript
interface IngestResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata: {
    fileType: string;
    size: number;
    processedAt: string;
    confidence?: number; // AI 置信度
  };
  deduplication?: {
    isDuplicate: boolean;
    existingId?: string;
    strategy: string; // 'contractNo' | 'fingerprint' | 'certificateNo'
  };
}
```

### 2.3 领域模型定义
- **证书 (Certificate)**:
  - `name`: 证书名称
  - `number`: 证书编号
  - `issuingBody`: 发证机构
  - `issueDate`: 发证日期 (YYYY-MM-DD)
  - `expiryDate`: 到期日期 (YYYY-MM-DD)
  - `auditPlan`: 推算的年审计划

- **合同 (Contract)**:
  - `title`: 合同标题
  - `contractNo`: 合同编号
  - `customerName`: 客户名称
  - `amount`: 金额 (Number)
  - `signDate`: 签订日期
  - `paymentPlan`: 回款计划数组

## 3. 去重策略
| 业务对象 | 优先键 (Primary Key) | 兜底键 (Fingerprint) | 冲突处理 |
| :--- | :--- | :--- | :--- |
| **证书** | 证书编号 (`number`) | 客户ID + 证书名 + 到期日 | 提示更新或跳过 |
| **合同** | 合同编号 (`contractNo`) | 客户名 + 标题 + 金额 + 日期 | 拦截并定位旧记录 |
| **知识** | 文件哈希 (MD5/SHA) | 标题 + 字节大小 | 提示已存在 |

## 4. 目录结构
```
src/
  services/
    ingestion/
      index.ts          # 统一入口
      fileUtils.ts      # 文件读取/压缩/格式判断
      certificate.ts    # 证书识别逻辑
      contract.ts       # 合同识别逻辑
      knowledge.ts      # 知识抽取逻辑
      leadsExcel.ts     # Excel 解析逻辑
  components/
    IngestionUploader.tsx # 统一 UI 组件 (支持拖拽/移动端/进度条)
```

## 5. 迁移路线
1. **Phase 1 (底座)**: 建立 services 与 components，不影响现有功能。
2. **Phase 2 (替换)**:
   - 线索页：替换 mock 识别 -> 真识别
   - 客户页：替换内联 OCR -> 统一服务
   - 合同页：替换内联识别 -> 统一服务
   - 知识页：替换简单上传 -> 统一服务 (加 PDF 抽取)
3. **Phase 3 (增强)**: 添加审计日志与“导入中心”聚合视图 (Optional)。
