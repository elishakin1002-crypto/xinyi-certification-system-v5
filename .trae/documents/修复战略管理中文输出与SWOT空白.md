## 问题原因定位

1. **核心建议是英文**

* `aiService.generateDeepStrategicInsight` 的 prompt 目前是英文（Role/Task/Data/Output JSON），模型会自然返回英文建议。

* 页面 [Strategy.tsx](file:///Users/jinxiansheng/Downloads/%E4%BF%A1%E4%B9%89%E8%AE%A4%E8%AF%81%E7%B3%BB%E7%BB%9F-v5.0-ai%E7%BB%BC%E5%90%88%E7%89%88%20\(1\)/pages/Strategy.tsx#L171-L180) 直接展示 `strategicInsight.keyRecommendation`，所以看起来就是英文。

1. **SWOT 没有内容（有圆点但空）**

* 页面目前写死读取 `strategicInsight.swot.strengths.map(s => s.content)`（同理弱点/机会/威胁）

  * 见 [Strategy.tsx](file:///Users/jinxiansheng/Downloads/%E4%BF%A1%E4%B9%89%E8%AE%A4%E8%AF%81%E7%B3%BB%E7%BB%9F-v5.0-ai%E7%BB%BC%E5%90%88%E7%89%88%20\(1\)/pages/Strategy.tsx#L77-L88)

* 但 AI prompt 没有强约束 SWOT item 的结构，模型经常返回 `string[]` 或 `{text:...}[]`，导致 `s.content` 为 `undefined`，渲染就变成“有项目符号但无文本”。

## 解决思路（小步可回滚）

### 方案选择：先止血（前端归一化）+ 再固化契约（AI prompt 约束）

* 先保证**任何结构**都能展示（兼容 `string[]` / `{content}` / `{text}` 等），让 SWOT 立刻不空。

* 再把 AI 输出契约写死为中文 + 固定 schema，避免后续再次漂移。

## 具体改动

### 1) 强化 AI 输出契约（中文 + 严格结构）

修改 [aiService.ts](file:///Users/jinxiansheng/Downloads/%E4%BF%A1%E4%B9%89%E8%AE%A4%E8%AF%81%E7%B3%BB%E7%BB%9F-v5.0-ai%E7%BB%BC%E5%90%88%E7%89%88%20\(1\)/services/aiService.ts) 的 `generateDeepStrategicInsight` prompt：

* 明确要求：**所有自然语言内容用中文**。

* 明确要求 JSON 结构：

  * `keyRecommendation`: 中文一句话（不超过 120 字）

  * `swot`: `strengths/weaknesses/opportunities/threats` 均为 `[{"content": "..."}]`

  * `bcg`: 明确四象限字段（与前端匹配），例如：

    * `marketGrowthHigh` / `marketGrowthLow` / `marketShareHigh` / `marketShareLow` 均为 `string[]`

* 要求：**只输出 JSON**，不带 \`\`\`json 代码块。

### 2) 前端 SWOT 归一化兜底（兼容历史数据）

修改 [Strategy.tsx](file:///Users/jinxiansheng/Downloads/%E4%BF%A1%E4%B9%89%E8%AE%A4%E8%AF%81%E7%B3%BB%E7%BB%9F-v5.0-ai%E7%BB%BC%E5%90%88%E7%89%88%20\(1\)/pages/Strategy.tsx) ：

* 增加 `normalizeSwotItems`：

  * 输入：`unknown`（可能是 `string[]`、`{content}`、`{text}`、混合数组）

  * 输出：`string[]`（过滤空字符串）

* 用归一化后的数组构建 `swotData`，避免出现“圆点但无内容”。

### 3) BCG 字段兼容（避免也出现空）

* Strategy 页面现在读取 `strategicInsight.marketGrowthHigh` 等顶层字段；而 AI prompt 目前写的是 `bcg` 对象。

* 将 Strategy 页面改为：优先读 `strategicInsight.bcg.xxx`，否则回退到 `strategicInsight.xxx`，保证不空。

### 4) UX 提示

* 如果 `keyRecommendation` 看起来仍是英文（简单字母占比判定），在卡片下方提示“建议重新运行战略推演以生成中文输出”。

## 验证方式

* 进入 战略管理 → 点击“启动 Gemini 深度战略推演”

* 预期：

  * 核心建议为中文

  * SWOT 四象限均能显示文本（不再出现空圆点）

  * BCG 四象限能显示数组标签

* 本地构建：`npm run build` 通过

## 回滚方式

* 回滚仅涉及 `Strategy.tsx` 与 `aiService.ts`：

  * 删除归一化函数与兼容读取逻辑即可恢复旧行为

  * prompt 回退不会影响其它模块

