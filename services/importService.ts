import { ImportRecord, ImportRowRaw, Lead, Status, Customer } from '../types';
import { dataService } from './dataService';

// 内存中存储导入记录 (模拟数据库)
let IMPORT_RECORDS_DB: ImportRecord[] = dataService.get<ImportRecord[]>('importRecords_v1', []);

const persistImportRecords = () => {
  dataService.set('importRecords_v1', IMPORT_RECORDS_DB);
};

export interface ProcessResult {
  newLeads: Lead[];
  stats: {
    total: number;
    created: number;
    duplicated: number;
  };
}

// 辅助函数：模糊匹配表头
const findValue = (row: ImportRowRaw, possibleKeys: string[]): string => {
  const keys = Object.keys(row);
  for (const pKey of possibleKeys) {
    const match = keys.find(k => k.trim() === pKey || k.includes(pKey));
    if (match && row[match]) {
      return String(row[match]).trim();
    }
  }
  return '';
};

export const importService = {
  // 1. 创建导入批次 & 存储 Raw Data
  createImportBatch: (fileName: string, rawData: any[], operator: string): ImportRecord => {
    // 过滤空行
    const validRows = rawData.filter(r => Object.keys(r).length > 0);
    
    const record: ImportRecord = {
      id: `IMP-${Date.now()}`,
      fileName,
      importDate: new Date().toISOString(),
      totalRows: validRows.length,
      processedRows: 0,
      status: 'pending',
      rawContent: validRows, // 完整保留
      operator
    };
    
    IMPORT_RECORDS_DB = [record, ...IMPORT_RECORDS_DB];
    persistImportRecords();
    return record;
  },

  // 2. 获取所有导入记录
  getImportRecords: (): ImportRecord[] => {
    return IMPORT_RECORDS_DB;
  },

  // 3. 执行基础解析 (Minimum Viable Process)
  // 不做 AI，只做硬编码的模糊匹配，确保能跑通
  processBatch: (batchId: string, existingLeads: Lead[], existingCustomers: Customer[]): ProcessResult => {
    const record = IMPORT_RECORDS_DB.find(r => r.id === batchId);
    if (!record) return { newLeads: [], stats: { total: 0, created: 0, duplicated: 0 } };

    const newLeads: Lead[] = [];
    let duplicatedCount = 0;

    record.rawContent.forEach((row, index) => {
      // 核心字段映射逻辑
      const companyRaw = findValue(row, ['企业名称', '公司名称', '客户名称', 'Company']);
      // 扩展信用代码匹配关键字
      const creditCode = findValue(row, ['统一社会信用代码', '信用代码', '纳税人识别号', '社会信用代码', 'CreditCode', 'USCC']);
      
      // 如果没有公司名，视为无效数据跳过
      if (!companyRaw) return;
      const company = companyRaw.trim(); // 强制去空格

      // --- Deduplication Logic (Strict & Fallback) ---
      let isDuplicate = false;

      // 1. 优先使用统一社会信用代码 (强校验)
      if (creditCode) {
        const leadExists = existingLeads.some(l => l.unifiedSocialCreditCode === creditCode);
        const customerExists = existingCustomers.some(c => c.unifiedSocialCreditCode === creditCode);
        if (leadExists || customerExists) {
          isDuplicate = true;
        }
      } 
      
      // 2. 双重兜底：如果代码没命中（或者没有代码），继续检查公司名称
      // 这能防止“系统旧数据没有代码”导致的重复创建
      if (!isDuplicate) {
        const nameExists = existingLeads.some(l => l.company.trim() === company) || 
                           existingCustomers.some(c => c.name.trim() === company);
        if (nameExists) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        duplicatedCount++;
        return; // 禁止 new Lead
      }
      // ---------------------------

      const name = findValue(row, ['联系人', '法人', '法定代表人', '姓名', 'Name']) || '待定联系人';
      const mobile = findValue(row, ['联系方式', '手机', '企业手机', '电话', 'Mobile', 'Tel']);
      const position = findValue(row, ['职位', '职务', 'Position']);
      const industry = findValue(row, ['行业', '所属行业', 'Industry']) || '待 AI 分析';
      
      // 尝试提取更多信息
      const capital = findValue(row, ['注册资本']);
      const scope = findValue(row, ['经营范围']);
      const address = findValue(row, ['注册地址', '公司地址', '地址']);
      const legalRep = findValue(row, ['法人', '法定代表人', '经营者']);
      const foundingDate = findValue(row, ['成立日期']);
      const operationStatus = findValue(row, ['经营状态', '状态']);
      const companyType = findValue(row, ['企业类型', '公司类型']);
      const issuingBody = findValue(row, ['发证机构', '认证机构']);
      
      // 构造 Lead 对象
      const lead: Lead = {
        id: `L-IMP-${batchId}-${index}`,
        company,
        name,
        mobile,
        position,
        industry,
        source: `Excel导入-${record.fileName}`,
        status: Status.New,
        score: 0,
        potentialValue: 0,
        lastContact: new Date().toISOString().split('T')[0],
        probability: 0,
        intent: 'Medium',
        unifiedSocialCreditCode: creditCode, 
        
        // --- 核心映射：将 Excel 数据写入 Lead 字段 (强制 String 转换) ---
        registeredCapital: String(capital || ''),
        registeredAddress: String(address || ''),
        businessScope: String(scope || ''),
        legalRepresentative: String(legalRep || ''),
        foundingDate: String(foundingDate || ''),
        operationStatus: String(operationStatus || ''),
        companyType: String(companyType || ''),
        issuingBody: String(issuingBody || ''),
        // ----------------------------------------

        // 简单拼接扩展信息，保留在备注里
        followUpRecords: [
            {
                id: `F-INIT-${Date.now()}`,
                date: new Date().toISOString().split('T')[0],
                type: 'system',
                content: `原始数据摘要：注册资本=${capital || '无'}，地址=${address || '无'}，经营范围=${scope ? scope.slice(0, 50) + '...' : '无'}`,
                operator: 'System'
            }
        ]
      };
      
      newLeads.push(lead);
    });

    // 更新记录状态
    record.status = 'processed';
    record.processedRows = newLeads.length;
    persistImportRecords();
    
    return {
      newLeads,
      stats: {
        total: record.totalRows,
        created: newLeads.length,
        duplicated: duplicatedCount
      }
    };
  }
};
