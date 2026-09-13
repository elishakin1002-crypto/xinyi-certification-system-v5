import { aiService } from '../aiService';
import { extractTextFromDocx, readFileAsBase64, IngestResult } from './fileUtils';
import { KnowledgeDoc } from '../../types';

/**
 * 把文件真的存到服务器，返回稳定地址。失败返回空字符串。
 *
 * 不抛异常：识别流程本身还是有价值的（摘要、正文都提出来了），
 * 不该因为存盘失败就整个失败。但**地址必须诚实** ——
 * 存不上就是空，别拿一个假地址顶上。
 */
const storeFile = async (file: File): Promise<string> => {
  try {
    const form = new FormData();
    form.append('files', file);
    const res = await fetch('/api/uploads/knowledge', { method: 'POST', credentials: 'include', body: form });
    const body = await res.json();
    return String(body?.data?.files?.[0]?.url || '');
  } catch {
    return '';
  }
};

export const processKnowledge = async (file: File, options?: { aiVisible?: boolean }): Promise<IngestResult<Partial<KnowledgeDoc>>> => {
  try {
    let extractedText = "";
    let inlineData = undefined;

    if (file.name.endsWith('.docx')) {
      extractedText = await extractTextFromDocx(file);
    } else if (file.type === 'text/plain') {
      extractedText = await file.text();
    } else if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
      // For PDF/Images, we use AI to extract text/summary directly
      const base64 = await readFileAsBase64(file);
      inlineData = { data: base64.split(',')[1], mimeType: file.type };
    }

    // Determine basic metadata
    let detectedFormat = file.name.split('.').pop()?.toLowerCase() || 'file';
    if (file.type === 'application/pdf') detectedFormat = 'pdf';
    else if (file.type.startsWith('image/')) detectedFormat = 'image';

    // AI Processing for Summary & Content (if binary)
    let summary = "";
    let content = extractedText;

    if (!content && inlineData) {
      // Use AI to OCR/Summarize binary files
      const prompt = `
      请分析这份文档（图片或PDF）。
      1. 提取其中的核心文本内容（Markdown格式）。
      2. 生成一段简短的摘要（100字以内）。
      3. 提取 3-5 个关键标签。
      
      返回 JSON: { "content": "...", "summary": "...", "tags": ["..."] }
      `;
      const aiResult = await aiService.generateJSON('kimi-k2.5', prompt, { inlineData });
      content = aiResult.content || "";
      summary = aiResult.summary || "";
    } else if (content) {
      // Generate summary for text files
      const prompt = `请为以下文档内容生成摘要（100字内）：\n${content.slice(0, 2000)}`;
      summary = await aiService.generateText('kimi-k2.5', prompt);
    }

    const doc: Partial<KnowledgeDoc> = {
      title: file.name.replace(/\.[^/.]+$/, ""),
      format: detectedFormat,
      size: `${(file.size / 1024).toFixed(1)} KB`,
      updatedAt: new Date().toISOString().split('T')[0],
      content: content,
      summary: summary,
      /*
        ── 存盘，别造 blob（2026-09-13）──────────────────────────────

        原来是 URL.createObjectURL(file) —— 浏览器临时地址，
        刷新就失效、换个人永远打不开。
        体检发现知识中心 40 篇里 **7 篇就是这么变成死链的**：
        列表上看着正常，点开是空白。

        和合同附件是同一个 bug。这条路更隐蔽 ——
        页面那边只是原样接收 `doc.sourceUrl`，根在这里。
        存不上就返回空，由调用方决定要不要建这条记录；
        **宁可没有文件，也不要一条打不开的死链。**
      */
      sourceUrl: await storeFile(file),
      // 默认不开放给 AI：调用方明确需要时再显式传 true。
      // 反过来（默认 true）的话，任何新接入的自动归档都会悄悄进检索库（P0-13）
      aiVisible: options?.aiVisible ?? false
    };

    return {
      success: true,
      data: doc,
      metadata: {
        fileType: file.type,
        size: file.size,
        processedAt: new Date().toISOString()
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "处理失败",
      metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
    };
  }
};
