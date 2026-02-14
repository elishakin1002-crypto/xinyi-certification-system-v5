# 强化战略分析中文输出

## 1. 问题分析
用户反馈“输出都要中文”，且提供的截图显示核心建议和 SWOT 分析依然全是英文。这说明之前的 Prompt 约束力不足，或者模型受输入数据（可能是英文 key）或角色设定（英文 Role）的影响，倾向于输出英文。

## 2. 解决方案
我将对 `services/aiService.ts` 中的 `generateDeepStrategicInsight` 方法进行“强力汉化”改造：

1.  **角色汉化**：将 `Role` 定义直接改为中文“首席战略官 (CSO) - 专注于中国市场”，打破模型的英文回复惯性。
2.  **指令强化**：在 `Task` 和 `Requirements` 中使用更强烈的措辞（Critical Requirements, MUST be Simplified Chinese, Do NOT use English）。
3.  **结构体汉化**：在 JSON 结构定义的 Value 示例中，明确标注 `(必须中文)`，引导模型填充中文内容。

## 3. 修改文件
-   `services/aiService.ts`

此修改将确保下次点击“启动 Gemini 深度战略推演”时，生成的内容完全为简体中文。
