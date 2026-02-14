import { IngestResult } from './fileUtils';
import { Lead, Status } from '../../types';

export const processLeadsExcel = async (file: File): Promise<IngestResult<Partial<Lead>[]>> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        // Check if XLSX is available globally
        if (!(window as any).XLSX) {
            reject({
                success: false,
                error: "Excel 解析组件未加载，请刷新页面重试",
                metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
            });
            return;
        }
        
        const XLSX = (window as any).XLSX;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        const leads: Partial<Lead>[] = [];
        // Skip header row
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (row.length === 0) continue;
          
          // Mapping: [0]Company, [1]Contact, [2]Phone, [3]Position
          const company = row[0];
          if (!company) continue;

          leads.push({
            company: String(company).trim(),
            // @ts-ignore - Lead type might strict check, but Partial allows flexibility
            contactPerson: row[1] ? String(row[1]).trim() : "未知",
            mobile: row[2] ? String(row[2]).trim() : "",
            position: row[3] ? String(row[3]).trim() : "",
            status: Status.New,
            source: 'Excel Import',
            createdAt: new Date().toISOString(),
            score: 0,
            industry: '待 AI 分析',
            intent: 'Medium',
            targetCertifications: '待挖掘...',
            // @ts-ignore
            notes: `导入自: ${file.name}`
          });
        }

        resolve({
          success: true,
          data: leads,
          metadata: {
            fileType: 'xlsx',
            size: file.size,
            processedAt: new Date().toISOString()
          }
        });
      } catch (error) {
        reject({
          success: false,
          error: "Excel 解析失败",
          metadata: { fileType: file.type, size: file.size, processedAt: new Date().toISOString() }
        });
      }
    };
    reader.readAsBinaryString(file);
  });
};
