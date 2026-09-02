import { aiService } from '../aiService';
import { extractTextFromDocx, readFileAsBase64, IngestResult } from './fileUtils';
import { KnowledgeDoc } from '../../types';

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
      sourceUrl: URL.createObjectURL(file),
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
