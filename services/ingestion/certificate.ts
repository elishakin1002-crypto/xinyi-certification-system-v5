/*
  证书识别。

  ══════════════════════════════════════════════════════════════
  2026-09-19：传 PDF 上去什么都识别不出来
  ══════════════════════════════════════════════════════════════

  金恩来传了一份温州德匠包装的 ISO 9001 证书（PDF，第一页就是证书，
  而且是文字版不是扫描件），结果「没有识别到任何东西」。

  真因不在 AI，在这里：原来的代码是

      if (file.type.startsWith('image/')) base64 = 压缩图片
      else                                 base64 = 整个文件转 base64
      → 丢给 aiService，mimeType 写 application/pdf

  而 aiService.toOpenAIContent 对**非图片**的附件是这么处理的：

      rich.push({ type: 'text', text: `[附件已提供: ${mimeType}] …` })

  ——**文件内容整个被丢掉**，换成一句"有个附件"。
  AI 收到的只有提示词和这句话，当然返回空数组。

  没有报错、没有警告，界面上就是"传了，然后什么也没有"。
  这正是这个项目反复栽的那种坑：看起来支持（提示词里都写着"图片或PDF"），
  其实那条路从来没通过。

  ── 怎么改的 ──────────────────────────────────────────────────

  合同识别（services/ingestion/contract.ts）早就把这条路走通了：
  先抽 PDF 的文字层 → 抽不到再把前几页转成图 → 都不行就**明确报错**。
  证书这边直接复用同一套，不再自己发明一份。

  另外两条同样重要：
  · **识别不出东西要报错，不能 success: true 配一个空数组。**
    原来空数组也算成功，界面于是安安静静什么都不显示。
  · **种类猜不出来不瞎归类**，交给 certification.ts 的 guessCertType，
    猜不出就留空让人选 —— 归错种类会让有效期、监督节点、提醒全套错掉。
*/
import { aiService } from '../aiService';
import { compressImage, extractTextFromDocx, IngestResult } from './fileUtils';
import { extractTextFromPdf, renderPdfPagesAsImages, getLastParseFailure } from '../documentParsers';
import { CertificateDetail } from '../../types';
import { guessCertType, certTypeOf } from '../../src/modules/certification';

const PROMPT = `
你是一个专业的认证证书识别助手。下面给你的是一份证书的文字内容或图片。
请提取其中的证书信息。如果有多张证书，返回数组。

请严格按照以下 JSON 格式返回（不要包含 Markdown 代码块标记）：
[
  {
    "name": "证书名称，照证书上写的（如 质量管理体系认证证书 ISO 9001:2015）",
    "number": "证书编号/注册号",
    "issuingBody": "发证机构",
    "issueDate": "发证日期 (YYYY-MM-DD)",
    "expiryDate": "有效期至 (YYYY-MM-DD)",
    "status": "Valid",
    "scope": "认证范围摘要",
    "companyName": "获证企业全称",
    "uscc": "统一社会信用代码（有就填，没有留空）"
  }
]

注意：
· 日期要转成 YYYY-MM-DD。证书上常写成「2024 年 08 月 16 日」。
· 只提取你真的看到的内容，**看不到的字段留空字符串，不要猜**。
· 如果这份文件里没有证书，返回空数组 []。
`;

/** 证书上的日期常写成「2024 年 08 月 16 日」，统一成 YYYY-MM-DD */
const normalizeDate = (raw: unknown): string => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const cn = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cn) return `${cn[1]}-${cn[2].padStart(2, '0')}-${cn[3].padStart(2, '0')}`;
  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return '';
};

export const processCertificate = async (file: File): Promise<IngestResult<CertificateDetail[]>> => {
  try {
    const isDocx = file.name.toLowerCase().endsWith('.docx')
      || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');

    /** 发给 AI 的第二个参数：要么一段文字，要么一张图 */
    let payload: { text?: string; inlineData?: { mimeType: string; data: string } } | null = null;

    if (isPdf) {
      const text = await extractTextFromPdf(file);
      if (text && text.trim().length > 30) {
        payload = { text };
      } else {
        // 扫描件没有文字层，只能转成图让 AI 看。
        // 只转前 2 页：证书基本都在第一页，而 78 页的文件全转会又慢又贵。
        const pages = await renderPdfPagesAsImages(file, 2, { scale: 1.15, quality: 0.7, maxWidth: 1360 });
        if (pages.length === 0) {
          throw new Error(
            `这份 PDF 没读出内容。${getLastParseFailure() || '文字层和转图都没拿到东西'}\n\n`
            + '如果是清晰的电子版证书还是失败，多半是系统这边的问题，把这句话发给技术。'
          );
        }
        payload = { inlineData: { mimeType: 'image/jpeg', data: String(pages[0]).split(',')[1] } };
      }
    } else if (isDocx) {
      const text = await extractTextFromDocx(file);
      if (!text || text.trim().length < 20) throw new Error('这份 Word 里没读到文字，可能内容是图片或文件被加密了。');
      payload = { text };
    } else if (isImage) {
      const base64 = await compressImage(file, 0.7, 1360);
      payload = { inlineData: { mimeType: 'image/jpeg', data: base64.split(',')[1] } };
    } else {
      throw new Error('这个格式读不了。证书请传 PDF、Word 或者照片。');
    }

    const result = await aiService.generateJSON(
      'kimi-k2.5',
      payload.text ? `${PROMPT}\n\n===== 证书文字内容 =====\n${payload.text}` : PROMPT,
      payload.inlineData ? { inlineData: payload.inlineData } : undefined
    );

    const raw = Array.isArray(result) ? result : (result ? [result] : []);
    const certs = raw
      .filter((c: any) => c && (c.name || c.number || c.expiryDate))
      .map((cert: any) => {
        const name = String(cert.name || '').trim();
        const typeId = guessCertType(name);
        const meta = certTypeOf(typeId);
        return {
          ...cert,
          id: `CERT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          issueDate: normalizeDate(cert.issueDate),
          expiryDate: normalizeDate(cert.expiryDate),
          /*
            种类猜不出来就留空，由界面请人选一下。
            老代码在这里按名字里有没有 IATF/CCC/FDA 猜 cycleRule，
            猜不中就默认 'Annual' —— 一个默认值决定了后面三年的
            监督节点和提醒，而且错了没人看得出来。
          */
          typeId: typeId || '',
          cycleRule: typeId || '',
          /*
            从证书原件上读出来的，算已核实 —— 不能落到默认的「客户自己说的」。
            2026-09-19 传真证书试出来的：识别成功了，可信度那一栏却写着
            「未核实（按此安排前先确认）」，等于把这个字段作废。
          */
          source: 'certFile',
          typeHint: meta ? '' : '没认出是哪一类证书，请在下拉里选一下（决定有效期和提醒时间）',
          auditPlan: []
        } as unknown as CertificateDetail;
      });

    if (certs.length === 0) {
      // **空结果必须报错。** 原来这里返回 success:true + []，
      // 界面于是什么都不显示，人只能猜是不是自己传错了。
      throw new Error(
        '这份文件里没读到证书信息。\n\n'
        + '常见原因：传的不是证书本身（比如是体系文件或审核报告）、'
        + '或者扫描件太模糊。\n'
        + '也可以直接点「手工录入」把关键信息填进去 —— 只要企业名和有效期至就够了。'
      );
    }

    return {
      success: true,
      data: certs,
      metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
    };
  } catch (error) {
    console.error('Certificate processing failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '识别失败',
      metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
    };
  }
};
