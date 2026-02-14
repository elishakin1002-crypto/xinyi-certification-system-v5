import { processCertificate } from './certificate';
import { processContract } from './contract';
import { processKnowledge } from './knowledge';
import { processLeadsExcel } from './leadsExcel';
import { IngestJob, IngestResult } from './fileUtils';

export const ingestService = {
  process: async (job: IngestJob): Promise<IngestResult> => {
    if (job.files.length === 0) {
      return { success: false, error: "无文件", metadata: { fileType: 'none', size: 0, processedAt: new Date().toISOString() } };
    }

    const file = job.files[0]; // Currently handling single file primarily

    switch (job.source) {
      case 'certificate':
        return processCertificate(file);
      case 'contract':
        return processContract(file);
      case 'knowledge':
        return processKnowledge(file, job.options);
      case 'lead_excel':
        return processLeadsExcel(file);
      default:
        return { success: false, error: "未知的任务类型", metadata: { fileType: 'unknown', size: 0, processedAt: new Date().toISOString() } };
    }
  }
};

export type { IngestJob, IngestResult };
