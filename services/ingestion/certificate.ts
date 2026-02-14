import { aiService } from '../aiService';
import { compressImage, readFileAsBase64, IngestResult } from './fileUtils';
import { CertificateDetail } from '../../types';

export const processCertificate = async (file: File): Promise<IngestResult<CertificateDetail[]>> => {
  try {
    let base64Data = "";
    if (file.type.startsWith('image/')) {
      base64Data = await compressImage(file);
    } else {
      base64Data = await readFileAsBase64(file);
    }

    const prompt = `
    你是一个专业的认证证书识别助手。请分析上传的图片或PDF文件，提取其中的证书信息。
    如果是多张证书，请返回数组。
    
    请严格按照以下 JSON 格式返回（不要包含 Markdown 代码块标记）：
    [
      {
        "name": "证书名称 (如 ISO 9001 质量管理体系认证)",
        "number": "证书编号",
        "issuingBody": "发证机构",
        "issueDate": "发证日期 (YYYY-MM-DD)",
        "expiryDate": "到期日期 (YYYY-MM-DD)",
        "status": "Valid",
        "scope": "认证范围摘要"
      }
    ]

    如果无法识别，请返回空数组 []。
    `;

    const result = await aiService.generateJSON(
      'kimi-k2.5',
      prompt,
      { inlineData: { data: base64Data.split(',')[1], mimeType: file.type } }
    );

    // Post-process: Add auditPlan logic
    const certs = (Array.isArray(result) ? result : [result]).map((cert: any) => {
      let cycleRule = 'Annual';
      let auditPlan = [];
      
      // Auto-detect cycle rule
      if (cert.name?.toUpperCase().includes('IATF')) cycleRule = 'Annual';
      else if (cert.name?.toUpperCase().includes('CCC')) cycleRule = 'Annual';
      else if (cert.name?.toUpperCase().includes('FDA')) cycleRule = 'Biennial';
      
      // Generate mock audit plan if dates exist
      if (cert.issueDate && cert.expiryDate) {
        const start = new Date(cert.issueDate);
        const end = new Date(cert.expiryDate);
        const diffYears = end.getFullYear() - start.getFullYear();
        for(let i=1; i<diffYears; i++) {
          const auditDate = new Date(start);
          auditDate.setFullYear(start.getFullYear() + i);
          auditPlan.push({
            year: i,
            plannedDate: auditDate.toISOString().split('T')[0],
            status: 'Pending'
          });
        }
      }
      
      return {
        ...cert,
        id: `CERT-${Date.now()}-${Math.random().toString(36).substr(2,5)}`,
        cycleRule,
        auditPlan
      };
    });

    return {
      success: true,
      data: certs,
      metadata: {
        fileType: file.type,
        size: file.size,
        processedAt: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error("Certificate processing failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "识别失败",
      metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
    };
  }
};
