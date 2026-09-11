import { MOCK_CUSTOMERS, MOCK_CONTRACTS, MOCK_PROJECTS, MOCK_LEADS, MOCK_DOCS } from '../../../constants';
// 这些对象只传给 SampleList 的 render，不加入 Context 或任何持久化数据集。
export const SAMPLE_CUSTOMER = {...MOCK_CUSTOMERS[0], id: 'sample-customer', name: '示例包装有限公司', contactPerson: '示例联系人', phone: '138****0000', contacts: [], riskStatus: 'low' as const};
export const SAMPLE_CONTRACT = {...MOCK_CONTRACTS[0], id: 'sample-contract', customerId: 'sample-customer', customerName: '示例包装有限公司', contactPerson: '示例联系人', title: '咨询服务合同书', contractNo: 'XY-SAMPLE-001', amount: 30000, receivables: []};
export const SAMPLE_PROJECT = {...MOCK_PROJECTS[0], id: 'sample-project', customerId: 'sample-customer', customerName: '示例包装有限公司', name: '示例企业 ISO9001 服务', manager: '示例顾问', tasks: [], contractRef: 'XY-SAMPLE-001'};
export const SAMPLE_LEAD = {...MOCK_LEADS[0], id: 'sample-lead', company: '示例包装有限公司', name: '示例联系人', phone: '138****0000'};
export const SAMPLE_DOC = {...MOCK_DOCS[0], id: 'sample-doc', title: '示例｜项目资料核对清单', summary: '核对项目所需资料、负责人和交付要求。此内容仅用于展示文档卡片，不作为业务依据。', linkId: undefined, linkTitle: undefined, sourceUrl: undefined};

export const SAMPLE_AUDIT_LOG = {id: 'sample-audit-log', action: 'PASSWORD_RESET', actorName: '示例管理员', actorUserId: 'sample-admin', targetName: '示例员工', targetUserId: 'sample-user', createdAt: '2026-09-09T09:00:00+08:00', metadata: {sample: true}};
