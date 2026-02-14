import { aiService } from '../aiService';
import { compressImage, extractTextFromDocx, IngestResult } from './fileUtils';
import { extractTextFromPdf, renderPdfPagesAsImages } from '../documentParsers';

const PLACEHOLDER_RE = /(某某|xxx|示例|样例|测试|待定|未知|北京某某|2024-xx-xx|合同编号|请填写)/i;

const isRetryable = (err: unknown) => {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return /overloaded|unavailable|503|quota|rate limit|429|timeout|timed out/.test(msg);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const hasUsefulText = (val: unknown) => {
  const text = String(val || '').trim();
  if (!text || text.length < 2) return false;
  return !PLACEHOLDER_RE.test(text);
};

const normalizeForMatch = (input: string) =>
  String(input || '')
    .toLowerCase()
    .replace(/[\s\r\n\t\u3000]/g, '')
    .replace(/[，。、“”‘’：:；;（）()【】[\]《》<>]/g, '');

const sanitizeNumber = (val: any) => {
  if (val === null || val === undefined || val === '') return '';
  const num = String(val).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(num);
  return Number.isFinite(parsed) ? parsed : '';
};

const sanitizeDate = (val: any) => {
  if (!val) return '';
  const dateStr = String(val).replace(/年|\./g, '-').replace(/月/g, '-').replace(/日/g, '');
  const timestamp = Date.parse(dateStr);
  if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString().split('T')[0];
  return '';
};

const appearsInSource = (sourceText: string, value: string) => {
  const s = String(sourceText || '').trim();
  const v = String(value || '').trim();
  if (!s || !v) return true;
  if (v.length < 3) return true;
  const sn = normalizeForMatch(s);
  const vn = normalizeForMatch(v);
  if (!vn) return false;
  return sn.includes(vn);
};

const hasEvidenceForField = (
  field: string,
  value: string,
  evidence: Record<string, unknown> | undefined,
  sourceText: string
) => {
  if (!hasUsefulText(value)) return false;
  if (appearsInSource(sourceText, value)) return true;
  const ev = String(evidence?.[field] || '').trim();
  if (!ev || PLACEHOLDER_RE.test(ev)) return false;
  if (value.length >= 3 && ev.includes(value.slice(0, Math.min(6, value.length)))) return true;
  return ev.length >= 8;
};

const heuristicExtractFromText = (rawText: string, fileName: string) => {
  const text = String(rawText || '');
  const out: any = {};

  const pick = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return String(m[1]).trim();
    }
    return '';
  };

  const title = pick(
    /(?:合同名称|协议名称|文件名称)\s*[:：]\s*([^\n]{4,80})/i,
    /([^\n]{2,40}(?:合同|协议))/i
  );
  if (hasUsefulText(title)) out.title = title;

  const contractNo = pick(
    /(?:合同编号|合同号|编号)\s*[:：]\s*([A-Za-z0-9\-\/_]{4,40})/i
  );
  if (hasUsefulText(contractNo)) out.contractNo = contractNo;

  const customerName = pick(
    /(?:甲方|委托方|需方|买方)\s*[:：]\s*([^\n，。,；;（）()]{4,80}(?:公司|集团|研究院|医院|中心|厂|店|有限公司|股份有限公司))/i,
    /([^\n，。,；;（）()]{4,80}(?:公司|集团|研究院|医院|中心|厂|店|有限公司|股份有限公司))/i
  );
  if (hasUsefulText(customerName)) out.customerName = customerName;

  const amountRaw = pick(
    /(?:合同(?:总)?金额|总价|总金额|金额)\s*[:：]?\s*([0-9][0-9,]{2,}(?:\.[0-9]{1,2})?)/i,
    /人民币\s*([0-9][0-9,]{2,}(?:\.[0-9]{1,2})?)\s*元/i
  );
  const amount = sanitizeNumber(amountRaw);
  if (amount && Number(amount) > 0) out.amount = amount;

  const signDate = sanitizeDate(pick(
    /(?:签订日期|签约日期|签订时间|签约时间|日期)\s*[:：]?\s*(20\d{2}[年\-\/\.]\d{1,2}[月\-\/\.]\d{1,2})/i
  ));
  if (signDate) out.signDate = signDate;

  if (!out.title) out.title = fileName.replace(/\.[^/.]+$/, '');
  return out;
};

const buildInstruction = () => `
你是合同信息抽取器。必须“只抽取可证据确认的信息”，禁止猜测、禁止样例填充。

严格规则：
1) 无法确认的字段必须留空（"" / null），不要编造默认值。
2) 不得输出“某某、XXX、示例、北京某某科技有限公司、2024-XX-XX-001”这类占位内容。
3) 如果文件不可读或信息不足，请返回 extractionStatus="unreadable" 或 "partial"。
4) 仅输出 JSON，不要 Markdown。

输出 JSON 结构：
{
  "extractionStatus": "success|partial|unreadable",
  "overallConfidence": 0.0,
  "data": {
    "title": "",
    "contractNo": "",
    "customerName": "",
    "contactPerson": "",
    "amount": null,
    "signDate": "",
    "serviceLine": "",
    "paymentMethod": "",
    "notes": "",
    "paymentPlan": [{"node":"","amount":null,"date":""}]
  },
  "evidence": {
    "title": "",
    "contractNo": "",
    "customerName": "",
    "amount": "",
    "signDate": ""
  }
}
`.trim();

const callExtract = async (promptParts: any[]) => {
  let result: any = null;
  let lastError: any = null;
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      result = await aiService.generateJSON('kimi-k2.5', promptParts as any);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxAttempts - 1) break;
      await sleep(800 * (attempt + 1));
    }
  }
  if (lastError) throw lastError;
  return result;
};

const normalizePaymentPlan = (paymentPlan: any[]): any[] => {
  if (!Array.isArray(paymentPlan)) return [];
  return paymentPlan
    .map((p: any, index: number) => {
      const nodeRaw = String(p?.node || p?.phase || '').trim();
      const node = hasUsefulText(nodeRaw) ? nodeRaw : `第${index + 1}期`;
      const amount = Number(sanitizeNumber(p?.amount)) || 0;
      const plannedDate = sanitizeDate(p?.date || p?.plannedDate);
      return { node, phase: node, amount, date: plannedDate, plannedDate };
    })
    .filter((item) => item.amount > 0);
};

const sumPaymentPlan = (paymentPlan: Array<{ amount: number }>): number => {
  return paymentPlan.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
};

export const processContract = async (file: File): Promise<IngestResult> => {
  try {
    let promptParts: any[] = [];
    let extractedPlainText = '';

    const isDocx = file.name.toLowerCase().endsWith('.docx')
      || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');

    if (isDocx) {
      extractedPlainText = await extractTextFromDocx(file);
      if (!extractedPlainText || extractedPlainText.length < 20) {
        throw new Error('DOCX 未提取到可读文本，请确认文件未加密且内容不是纯图片。');
      }
      promptParts = [{ text: extractedPlainText.slice(0, 30000) }];
    } else if (isPdf) {
      extractedPlainText = await extractTextFromPdf(file);
      if (extractedPlainText && extractedPlainText.length > 30) {
        promptParts = [{ text: extractedPlainText.slice(0, 30000) }];
      } else {
        const imagePages = await renderPdfPagesAsImages(file, 3);
        if (imagePages.length > 0) {
          promptParts = imagePages.map((data) => ({
            inlineData: { mimeType: 'image/jpeg', data }
          }));
        } else {
          throw new Error('PDF 未提取到可读内容（文本/OCR均失败）。请改用清晰扫描件或先转图片后上传。');
        }
      }
    } else if (isImage) {
      const base64 = await compressImage(file);
      promptParts = [{ inlineData: { mimeType: 'image/jpeg', data: base64.split(',')[1] } }];
    } else {
      const maybeText = await file.text().catch(() => '');
      extractedPlainText = String(maybeText || '').trim();
      if (!extractedPlainText) {
        throw new Error('当前文件类型无法识别，请上传 PDF/Word/图片格式合同。');
      }
      promptParts = [{ text: extractedPlainText.slice(0, 30000) }];
    }

    const hasUsablePrompt = promptParts.some((part) => {
      if (part?.text && String(part.text).trim().length >= 12) return true;
      const mt = String(part?.inlineData?.mimeType || '').toLowerCase();
      return mt.startsWith('image/');
    });
    if (!hasUsablePrompt) {
      throw new Error('未提取到可识别内容，已中止AI识别（避免空识别/乱填）。');
    }

    promptParts.push({ text: buildInstruction() });
    const extractedData = await callExtract(promptParts);
    const payload = (extractedData?.data && typeof extractedData.data === 'object')
      ? extractedData.data
      : extractedData;
    const evidence = (extractedData?.evidence && typeof extractedData.evidence === 'object')
      ? extractedData.evidence as Record<string, unknown>
      : undefined;
    const extractionStatus = String(extractedData?.extractionStatus || '').toLowerCase();
    const overallConfidence = Number(extractedData?.overallConfidence ?? extractedData?.confidence ?? 0);

    const candidateTitle = String(payload?.title || '').trim();
    const candidateContractNo = String(payload?.contractNo || '').trim();
    const candidateCustomer = String(payload?.customerName || '').trim();
    const candidateContact = String(payload?.contactPerson || '').trim();
    const candidateAmount = sanitizeNumber(payload?.amount);
    const candidateSignDate = sanitizeDate(payload?.signDate);
    const candidateServiceLine = String(payload?.serviceLine || '').trim();
    const candidatePaymentMethod = String(payload?.paymentMethod || '').trim();
    const candidateNotes = String(payload?.notes || '').trim();

    let finalTitle = hasEvidenceForField('title', candidateTitle, evidence, extractedPlainText) ? candidateTitle : '';
    let finalContractNo = hasEvidenceForField('contractNo', candidateContractNo, evidence, extractedPlainText) ? candidateContractNo : '';
    let finalCustomer = hasEvidenceForField('customerName', candidateCustomer, evidence, extractedPlainText) ? candidateCustomer : '';
    let finalContact = hasEvidenceForField('contactPerson', candidateContact, evidence, extractedPlainText) ? candidateContact : '';
    let finalAmount = (candidateAmount && candidateAmount > 0 && hasEvidenceForField('amount', String(candidateAmount), evidence, extractedPlainText)) ? candidateAmount : '';
    let finalSignDate = hasEvidenceForField('signDate', candidateSignDate, evidence, extractedPlainText) ? candidateSignDate : '';
    const finalServiceLine = hasUsefulText(candidateServiceLine) ? candidateServiceLine : '';
    const finalPaymentMethod = hasUsefulText(candidatePaymentMethod) ? candidatePaymentMethod : '';
    const finalNotes = hasUsefulText(candidateNotes) ? candidateNotes : '';

    const trustedKeyCount = [finalTitle, finalContractNo, finalCustomer, finalAmount, finalSignDate].filter(Boolean).length;
    const lowTrust = extractionStatus === 'unreadable' || (overallConfidence > 0 && overallConfidence < 0.5);

    if (trustedKeyCount === 0 || lowTrust) {
      const heuristic = heuristicExtractFromText(extractedPlainText, file.name);
      finalTitle = finalTitle || String(heuristic.title || '');
      finalContractNo = finalContractNo || String(heuristic.contractNo || '');
      finalCustomer = finalCustomer || String(heuristic.customerName || '');
      finalAmount = finalAmount || sanitizeNumber(heuristic.amount);
      finalSignDate = finalSignDate || sanitizeDate(heuristic.signDate);
    }

    const finalKeyCount = [finalTitle, finalContractNo, finalCustomer, finalAmount, finalSignDate].filter(Boolean).length;
    if (finalKeyCount === 0) {
      return {
        success: false,
        error: '未识别到有效字段：可能是扫描件质量低或文本不可读。建议上传更清晰PDF/图片，或先手动录入关键字段。',
        metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
      };
    }

    const normalizedPlan = normalizePaymentPlan(payload?.paymentPlan || payload?.paymentTerms || []);
    const planTotal = sumPaymentPlan(normalizedPlan);
    const modelAmount = Number(finalAmount || 0);
    let resolvedAmount = modelAmount;

    // Reconcile model amount with extracted payment plan:
    // 1) single-node plans should usually equal contract total;
    // 2) if amount gap is obvious (>20%), trust the payment plan sum.
    if (planTotal > 0) {
      if (resolvedAmount <= 0) {
        resolvedAmount = planTotal;
      } else {
        const diff = Math.abs(resolvedAmount - planTotal);
        const diffRatio = planTotal > 0 ? diff / planTotal : 0;
        if (diff > 0 && (normalizedPlan.length === 1 || diffRatio > 0.2)) {
          resolvedAmount = planTotal;
        }
      }
    }

    const finalData = {
      title: finalTitle || file.name.replace(/\.[^/.]+$/, ''),
      contractNo: finalContractNo || '',
      customerName: finalCustomer || '',
      contactPerson: finalContact || '',
      amount: Number(resolvedAmount || 0),
      signDate: finalSignDate || '',
      serviceLine: finalServiceLine || 'ISO 标准',
      paymentMethod: finalPaymentMethod || '',
      notes: finalNotes || '',
      paymentPlan: normalizedPlan
    };

    return {
      success: true,
      data: finalData,
      metadata: {
        fileType: file.type,
        size: file.size,
        processedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error || '');
    const friendlyMsg = /overloaded|unavailable|503|quota|rate limit|429/i.test(rawMsg)
      ? '模型繁忙，请稍后重试'
      : rawMsg || '识别失败';
    return {
      success: false,
      error: friendlyMsg,
      metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
    };
  }
};
