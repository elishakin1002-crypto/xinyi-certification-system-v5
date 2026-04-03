/**
 * Demo Data Seeder
 * 
 * 为工作台概览提供示例数据，仅操作本地存储，不触碰 UI/字段结构
 * 调用方式：在 AppContext 初始化后执行 seedDemoData()
 */

import { dataService } from './dataService';
import { Lead, Customer, Contract, Project, Status, ProjectWorkLog, Settlement, Reminder, KnowledgeDoc } from '../types';

const now = new Date();
const thisMonth = now.toISOString().slice(0, 7);
const monthToken = thisMonth.replace('-', '');
const lastWeek = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
const yesterday = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

const demoLeads: any[] = [
  {
    id: 'LEAD-DEMO-001',
    name: '温州宏远包装有限公司',
    company: '温州宏远包装有限公司',
    contactPerson: '王经理',
    mobile: '13805771234',
    intent: 'High',
    status: Status.Active,
    lastContact: yesterday,
    followUpRecords: [
      {
        id: 'FOLLOW-001',
        date: yesterday,
        method: '电话',
        content: '客户咨询 ISO 9001 认证流程和周期',
        operator: '老板（示例）',
        result: '有意向，需后续跟进'
      }
    ],
    tags: ['食品包装', '温州'],
    source: '电话营销'
  },
  {
    id: 'LEAD-DEMO-002',
    name: '浙江金田机械有限公司',
    company: '浙江金田机械有限公司',
    contactPerson: '李总',
    mobile: '13905881234',
    intent: 'Medium',
    status: Status.Active,
    lastContact: lastWeek,
    followUpRecords: [],
    tags: ['机械制造', '台州'],
    source: '转介绍'
  },
  {
    id: 'LEAD-DEMO-003',
    name: '温州康美食品有限公司',
    company: '温州康美食品有限公司',
    contactPerson: '陈厂长',
    mobile: '13705771234',
    intent: 'High',
    status: Status.Converted,
    lastContact: thisMonth + '-05',
    followUpRecords: [
      {
        id: 'FOLLOW-003',
        date: thisMonth + '-05',
        method: '面谈',
        content: '现场调研，确定 HACCP 认证需求',
        operator: '老板（示例）',
        result: '已签约'
      }
    ],
    tags: ['食品生产', '温州'],
    source: '展会'
  }
];

const demoCustomers: any[] = [
  {
    id: 'CUST-DEMO-001',
    name: '温州宏远包装有限公司',
    contactPerson: '王经理',
    mobile: '13805771234',
    totalValue: 85000,
    riskStatus: 'low',
    activeContracts: 1,
    followUpRecords: [
      {
        id: 'CUST-FOLLOW-001',
        date: yesterday,
        method: '微信',
        content: '发送认证资料清单',
        operator: '老板（示例）',
        result: '客户已接收'
      }
    ],
    serviceCount: 2,
    cooperationCount: 1,
    industry: '食品包装',
    region: '温州',
    tags: ['老客户', '食品包装']
  },
  {
    id: 'CUST-DEMO-002',
    name: '浙江金田机械有限公司',
    contactPerson: '李总',
    mobile: '13905881234',
    totalValue: 120000,
    riskStatus: 'medium',
    activeContracts: 2,
    followUpRecords: [],
    serviceCount: 3,
    cooperationCount: 2,
    industry: '机械制造',
    region: '台州',
    tags: ['VIP客户', '机械制造']
  },
  {
    id: 'CUST-DEMO-003',
    name: '温州康美食品有限公司',
    contactPerson: '陈厂长',
    mobile: '13705771234',
    totalValue: 150000,
    riskStatus: 'low',
    activeContracts: 1,
    followUpRecords: [
      {
        id: 'CUST-FOLLOW-003',
        date: thisMonth + '-10',
        method: '电话',
        content: '项目启动会议安排',
        operator: '老板（示例）',
        result: '已确定时间'
      }
    ],
    serviceCount: 1,
    cooperationCount: 1,
    industry: '食品生产',
    region: '温州',
    tags: ['新客户', '食品生产']
  }
];

const demoCertificateCustomers: any[] = [
  {
    id: 'cust-cert-001',
    name: '温州华信包装有限公司',
    contactPerson: '陈总',
    mobile: '13857760001',
    industry: '包装印刷',
    totalValue: 268000,
    riskStatus: 'low',
    activeContracts: 1,
    existingCertifications: ['ISO9001'],
    certificates: [
      {
        id: 'cert-001',
        name: 'ISO9001 质量管理体系认证',
        number: '00126Q31245R0M/3300',
        issueDate: '2023-05-17',
        expiryDate: '2026-05-16',
        issuingBody: '中质协质量保证中心',
        scope: '纸制品包装、塑料包装袋的生产与销售',
        status: 'Expiring',
        cycleRule: '3年一换证，每年监督审核1次',
        auditPlan: [
          { id: 'audit-001', type: 'Surveillance 1', plannedDate: '2024-05-10', status: 'Completed', actualDate: '2024-05-12' },
          { id: 'audit-002', type: 'Surveillance 2', plannedDate: '2025-05-09', status: 'Completed', actualDate: '2025-05-11' },
          { id: 'audit-003', type: 'Re-certification', plannedDate: '2026-04-20', status: 'Pending' }
        ]
      }
    ]
  },
  {
    id: 'cust-cert-002',
    name: '龙港市新味食品科技有限公司',
    contactPerson: '林经理',
    mobile: '13857760002',
    industry: '食品加工',
    totalValue: 186000,
    riskStatus: 'medium',
    activeContracts: 0,
    existingCertifications: ['HACCP'],
    certificates: [
      {
        id: 'cert-002',
        name: 'HACCP 食品安全管理体系认证',
        number: 'HACCP-330382-2023-118',
        issueDate: '2023-03-21',
        expiryDate: '2026-03-20',
        issuingBody: '方圆标志认证集团',
        scope: '休闲食品的生产与销售',
        status: 'Expired',
        cycleRule: '3年一换证，每年监督审核1次',
        auditPlan: [
          { id: 'audit-004', type: 'Surveillance 1', plannedDate: '2024-03-15', status: 'Completed', actualDate: '2024-03-16' },
          { id: 'audit-005', type: 'Surveillance 2', plannedDate: '2025-03-15', status: 'Completed', actualDate: '2025-03-17' },
          { id: 'audit-006', type: 'Re-certification', plannedDate: '2026-03-10', status: 'Overdue' }
        ]
      }
    ]
  },
  {
    id: 'cust-cert-003',
    name: '瑞安精工泵业有限公司',
    contactPerson: '周厂长',
    mobile: '13857760003',
    industry: '机械制造',
    totalValue: 320000,
    riskStatus: 'low',
    activeContracts: 1,
    existingCertifications: ['ISO14001'],
    certificates: [
      {
        id: 'cert-003',
        name: 'ISO14001 环境管理体系认证',
        number: '04126E20458R1M',
        issueDate: '2024-01-01',
        expiryDate: '2026-12-31',
        issuingBody: '中国船级社质量认证公司',
        scope: '工业泵、阀门及配件的设计与制造',
        status: 'Valid',
        cycleRule: '3年一换证，每年监督审核1次',
        auditPlan: [
          { id: 'audit-007', type: 'Surveillance 1', plannedDate: '2025-12-15', status: 'Completed', actualDate: '2025-12-16' },
          { id: 'audit-008', type: 'Annual Review', plannedDate: '2026-06-20', status: 'Scheduled' }
        ]
      }
    ]
  }
];

const demoContracts: any[] = [
  {
    id: 'CONT-DEMO-001',
    title: 'ISO 9001 质量管理体系认证服务合同',
    contractNo: 'XY-2025-001',
    customerName: '温州宏远包装有限公司',
    amount: 85000,
    signDate: thisMonth + '-15',
    status: Status.Active,
    serviceLine: 'ISO 9001 质量管理体系认证',
    riskLevel: 'Low',
    archiveStatus: 'active',
    owner: '老板（示例）',
    receivables: [
      {
        id: 'REC-001',
        node: '签约首款',
        amount: 25500,
        dueDate: thisMonth + '-20',
        status: 'paid'
      },
      {
        id: 'REC-002',
        node: '文件完成',
        amount: 34000,
        dueDate: thisMonth + '-25',
        status: 'unpaid'
      },
      {
        id: 'REC-003',
        node: '认证通过',
        amount: 25500,
        dueDate: '2025-12-15',
        status: 'unpaid'
      }
    ],
    attachments: []
  },
  {
    id: 'CONT-DEMO-002',
    title: 'IATF 16949 汽车质量管理体系认证服务合同',
    contractNo: 'XY-2025-002',
    customerName: '浙江金田机械有限公司',
    amount: 120000,
    signDate: thisMonth + '-10',
    status: Status.Active,
    serviceLine: 'IATF 16949 汽车质量管理体系认证',
    riskLevel: 'Medium',
    archiveStatus: 'active',
    owner: '老板（示例）',
    receivables: [
      {
        id: 'REC-004',
        node: '签约首款',
        amount: 36000,
        dueDate: thisMonth + '-15',
        status: 'paid'
      },
      {
        id: 'REC-005',
        node: '阶段审核',
        amount: 48000,
        dueDate: '2025-11-30',
        status: 'unpaid'
      },
      {
        id: 'REC-006',
        node: '认证通过',
        amount: 36000,
        dueDate: '2025-12-31',
        status: 'unpaid'
      }
    ],
    attachments: []
  },
  {
    id: 'CONT-DEMO-003',
    title: 'HACCP 食品安全管理体系认证服务合同',
    contractNo: 'XY-2025-003',
    customerName: '温州康美食品有限公司',
    amount: 150000,
    signDate: thisMonth + '-05',
    status: Status.Active,
    serviceLine: 'HACCP 食品安全管理体系认证',
    riskLevel: 'Low',
    archiveStatus: 'active',
    owner: '老板（示例）',
    receivables: [
      {
        id: 'REC-007',
        node: '签约首款',
        amount: 45000,
        dueDate: thisMonth + '-10',
        status: 'paid'
      },
      {
        id: 'REC-008',
        node: '体系文件完成',
        amount: 60000,
        dueDate: '2025-11-25',
        status: 'unpaid'
      },
      {
        id: 'REC-009',
        node: '认证通过',
        amount: 45000,
        dueDate: '2025-12-20',
        status: 'unpaid'
      }
    ],
    attachments: []
  }
];

const demoProjects: any[] = [
  {
    id: 'PROJ-DEMO-001',
    name: '温州宏远包装 ISO 9001 认证项目',
    contractRef: 'XY-2025-001',
    manager: '老板（示例）',
    progress: 35,
    status: Status.Active,
    paymentStatus: 'partial',
    deadline: '2025-12-31',
    duration: 90,
    projectCategory: 'Delivery',
    projectType: 'Self-Operated',
    projectAmount: 85000,
    costStatus: '已确认',
    serviceItems: [
      {
        id: 'SI-001',
        name: 'ISO 9001 质量管理体系认证',
        category: '体系认证',
        deliveryMode: 'Self',
        status: 'InProgress'
      }
    ],
    tasks: [
      {
        id: 'TASK-001',
        title: '现状调研与差距分析',
        deadline: thisMonth + '-20',
        status: 'Completed',
        priority: 'High',
        category: 'Core',
        owner: '老板（示例）'
      },
      {
        id: 'TASK-002',
        title: '质量手册编制',
        deadline: thisMonth + '-25',
        status: 'InProgress',
        priority: 'High',
        category: 'Core',
        owner: '老板（示例）'
      },
      {
        id: 'TASK-003',
        title: '程序文件编写',
        deadline: '2025-11-10',
        status: 'Pending',
        priority: 'High',
        category: 'Core',
        owner: '老板（示例）'
      },
      {
        id: 'TASK-004',
        title: '内部审核实施',
        deadline: '2025-11-20',
        status: 'Pending',
        priority: 'Medium',
        category: 'Core',
        owner: '老板（示例）'
      },
      {
        id: 'TASK-005',
        title: '管理评审',
        deadline: '2025-11-25',
        status: 'Pending',
        priority: 'Medium',
        category: 'Core',
        owner: '老板（示例）'
      },
      {
        id: 'TASK-006',
        title: '认证审核申请',
        deadline: '2025-12-01',
        status: 'Pending',
        priority: 'High',
        category: 'Core',
        owner: '老板（示例）'
      }
    ],
    settlementConfig: { rule: 'Ratio', value: 8, base: 'Revenue' },
    aiInsight: {
      riskLevel: 'Low',
      summary: '项目进展正常，按计划推进',
      suggestions: ['关注文件编制进度', '提前联系认证机构']
    }
  },
  {
    id: 'PROJ-DEMO-002',
    name: '浙江金田机械 IATF 16949 认证项目',
    contractRef: 'XY-2025-002',
    manager: '交付负责人（示例）',
    progress: 15,
    status: Status.Active,
    paymentStatus: 'partial',
    deadline: '2025-12-15',
    duration: 120,
    projectCategory: 'Delivery',
    projectType: 'Self-Operated',
    projectAmount: 120000,
    costStatus: '已确认',
    serviceItems: [
      {
        id: 'SI-002',
        name: 'IATF 16949 汽车质量管理体系认证',
        category: '体系认证',
        deliveryMode: 'Self',
        status: 'InProgress'
      }
    ],
    tasks: [
      {
        id: 'TASK-007',
        title: '体系现状评估',
        deadline: thisMonth + '-22',
        status: 'InProgress',
        priority: 'High',
        category: 'Core',
        owner: '交付负责人（示例）'
      },
      {
        id: 'TASK-008',
        title: '过程方法培训',
        deadline: '2025-11-05',
        status: 'Pending',
        priority: 'High',
        category: 'Core',
        owner: '交付负责人（示例）'
      },
      {
        id: 'TASK-009',
        title: '质量手册更新',
        deadline: '2025-11-15',
        status: 'Pending',
        priority: 'High',
        category: 'Core',
        owner: '交付负责人（示例）'
      }
    ],
    settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' },
    aiInsight: {
      riskLevel: 'Medium',
      summary: '项目刚开始，需关注客户配合度',
      suggestions: ['加强客户培训', '建立定期沟通机制']
    }
  },
  {
    id: 'PROJ-DEMO-003',
    name: '温州康美食品 HACCP 认证项目',
    contractRef: 'XY-2025-003',
    manager: '咨询顾问1（示例）',
    progress: 45,
    status: Status.Active,
    paymentStatus: 'partial',
    deadline: '2025-12-20',
    duration: 100,
    projectCategory: 'Delivery',
    projectType: 'Self-Operated',
    projectAmount: 150000,
    costStatus: '已确认',
    serviceItems: [
      {
        id: 'SI-003',
        name: 'HACCP 食品安全管理体系认证',
        category: '体系认证',
        deliveryMode: 'Self',
        status: 'InProgress'
      }
    ],
    tasks: [
      {
        id: 'TASK-010',
        title: '食品安全小组成立',
        deadline: thisMonth + '-18',
        status: 'Completed',
        priority: 'High',
        category: 'Core',
        owner: '咨询顾问1（示例）'
      },
      {
        id: 'TASK-011',
        title: '危害分析实施',
        deadline: thisMonth + '-28',
        status: 'InProgress',
        priority: 'High',
        category: 'Core',
        owner: '咨询顾问1（示例）'
      },
      {
        id: 'TASK-012',
        title: '关键控制点确定',
        deadline: '2025-11-10',
        status: 'Pending',
        priority: 'High',
        category: 'Core',
        owner: '咨询顾问1（示例）'
      }
    ],
    settlementConfig: { rule: 'Ratio', value: 12, base: 'Revenue' },
    aiInsight: {
      riskLevel: 'Low',
      summary: '项目进展顺利，客户配合良好',
      suggestions: ['继续按计划推进', '关注关键控制点验证']
    }
  },
  {
    id: 'PROJ-DEMO-004',
    name: '温州康美食品 HACCP 复评签约项目',
    contractRef: 'LEAD:LEAD-DEMO-003',
    sourceType: 'lead',
    sourceRef: 'LEAD-DEMO-003',
    projectMode: 'delivery',
    manager: '老板（示例）',
    progress: 100,
    status: Status.Completed,
    paymentStatus: 'paid',
    deadline: thisMonth + '-22',
    duration: 30,
    projectCategory: 'Delivery',
    projectType: 'Self-Operated',
    projectAmount: 98000,
    costStatus: '已确认',
    serviceItems: [
      {
        id: 'SI-004',
        name: 'HACCP 复评认证',
        category: '体系认证',
        deliveryMode: 'Self',
        status: 'Completed'
      }
    ],
    tasks: [
      {
        id: 'TASK-013',
        title: '复评资料预审',
        deadline: thisMonth + '-08',
        status: 'Completed',
        priority: 'High',
        category: 'Core',
        owner: '老板（示例）'
      },
      {
        id: 'TASK-014',
        title: '现场复评陪审',
        deadline: thisMonth + '-15',
        status: 'Completed',
        priority: 'High',
        category: 'Core',
        owner: '老板（示例）'
      },
      {
        id: 'TASK-015',
        title: '复评整改与闭环',
        deadline: thisMonth + '-22',
        status: 'Completed',
        priority: 'High',
        category: 'Core',
        owner: '老板（示例）'
      }
    ],
    settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' },
    completionRecord: {
      eventId: 'EVT-DEMO-004',
      completedAt: `${thisMonth}-22T10:30:00.000Z`,
      actualEndDate: thisMonth + '-22',
      duration: 28,
      passRate: true,
      taskCompletionRate: 100,
      delayedTasksCount: 0,
      rating: 'A',
      autoCompleted: false
    },
    aiInsight: {
      riskLevel: 'Low',
      summary: '项目已在本月完成并进入复盘阶段',
      suggestions: ['沉淀交付模板', '推动复购机会']
    }
  }
];

const demoProjectWorkLogs: any[] = [
  {
    id: 'LOG-001',
    projectId: 'PROJ-DEMO-001',
    operatorUserId: 'U-001',
    operatorName: '老板（示例）',
    logDate: yesterday,
    workContent: '完成现状调研报告编写',
    actualHours: 4,
    source: 'manual',
    createdAt: yesterday,
    updatedAt: yesterday
  },
  {
    id: 'LOG-002',
    projectId: 'PROJ-DEMO-001',
    operatorUserId: 'U-001',
    operatorName: '老板（示例）',
    logDate: thisMonth + '-19',
    workContent: '质量手册框架设计',
    actualHours: 6,
    source: 'manual',
    createdAt: thisMonth + '-19',
    updatedAt: thisMonth + '-19'
  },
  {
    id: 'LOG-003',
    projectId: 'PROJ-DEMO-002',
    operatorUserId: 'U-002',
    operatorName: '交付负责人（示例）',
    logDate: thisMonth + '-20',
    workContent: '体系现状评估报告',
    actualHours: 8,
    source: 'manual',
    createdAt: thisMonth + '-20',
    updatedAt: thisMonth + '-20'
  },
  {
    id: 'LOG-004',
    projectId: 'PROJ-DEMO-003',
    operatorUserId: 'U-004',
    operatorName: '咨询顾问1（示例）',
    logDate: thisMonth + '-18',
    workContent: '食品安全小组培训',
    actualHours: 3,
    source: 'manual',
    createdAt: thisMonth + '-18',
    updatedAt: thisMonth + '-18'
  }
];

const demoSettlements: any[] = [
  {
    id: 'SETTLE-001',
    projectId: 'PROJ-DEMO-001',
    contractId: 'CONT-DEMO-001',
    customerName: '温州宏远包装有限公司',
    serviceName: 'ISO 9001 质量管理体系认证',
    amount: 25500,
    status: 'paid',
    invoiced: true,
    invoiceNo: 'FP2025001',
    createdAt: thisMonth + '-20',
    updatedAt: thisMonth + '-20'
  },
  {
    id: 'SETTLE-002',
    projectId: 'PROJ-DEMO-002',
    contractId: 'CONT-DEMO-002',
    customerName: '浙江金田机械有限公司',
    serviceName: 'IATF 16949 汽车质量管理体系认证',
    amount: 36000,
    status: 'paid',
    invoiced: true,
    invoiceNo: 'FP2025002',
    createdAt: thisMonth + '-16',
    updatedAt: thisMonth + '-16'
  },
  {
    id: 'SETTLE-003',
    projectId: 'PROJ-DEMO-003',
    contractId: 'CONT-DEMO-003',
    customerName: '温州康美食品有限公司',
    serviceName: 'HACCP 食品安全管理体系认证',
    amount: 45000,
    status: 'paid',
    invoiced: true,
    invoiceNo: 'FP2025003',
    createdAt: thisMonth + '-12',
    updatedAt: thisMonth + '-12'
  }
];

const demoReminders: any[] = [
  {
    id: 'REMIND-001',
    title: '温州宏远包装质量手册编制进度提醒',
    content: '项目任务"质量手册编制"即将到期，请跟进完成进度',
    severity: 'medium',
    forUserIds: ['U-001'],
    linkType: 'project',
    linkId: 'PROJ-DEMO-001',
    linkTitle: '温州宏远包装 ISO 9001 认证项目',
    dueDate: thisMonth + '-25',
    isRead: false,
    createdAt: thisMonth + '-22',
    channels: ['system']
  },
  {
    id: 'REMIND-002',
    title: '浙江金田机械合同回款提醒',
    content: '合同"IATF 16949 汽车质量管理体系认证服务合同"阶段审核款即将到期',
    severity: 'high',
    forRole: ['FINANCE'],
    linkType: 'contract',
    linkId: 'CONT-DEMO-002',
    linkTitle: 'IATF 16949 汽车质量管理体系认证服务合同',
    dueDate: '2025-11-30',
    isRead: false,
    createdAt: thisMonth + '-20',
    channels: ['system']
  },
  {
    id: 'REMIND-003',
    title: '温州康美食品危害分析任务提醒',
    content: '项目任务"危害分析实施"需要客户配合提供相关资料',
    severity: 'medium',
    forUserIds: ['U-004'],
    linkType: 'project',
    linkId: 'PROJ-DEMO-003',
    linkTitle: '温州康美食品 HACCP 认证项目',
    dueDate: thisMonth + '-28',
    isRead: false,
    createdAt: thisMonth + '-21',
    channels: ['system']
  }
];

const demoCertificateProjects: any[] = [
  {
    id: 'proj-cert-001',
    customerId: 'cust-cert-001',
    name: '温州华信包装 ISO9001 续证跟进',
    contractRef: 'CUSTCERT:cust-cert-001:cert-001',
    sourceType: 'customer',
    sourceRef: 'cust-cert-001',
    projectMode: 'followup',
    projectCategory: 'FollowUp',
    manager: '老板（示例）',
    progress: 35,
    status: Status.Active,
    paymentStatus: 'unpaid',
    deadline: '2026-05-16',
    duration: 45,
    projectType: 'Self-Operated',
    tasks: [
      { id: 'task-cert-001', title: '确认客户续证意向', deadline: '2026-04-03', status: 'Completed', priority: 'High', category: 'Core', owner: '老板（示例）' },
      { id: 'task-cert-002', title: '收集复评审核资料', deadline: '2026-04-08', status: 'Pending', priority: 'High', category: 'Core', owner: '咨询顾问1（示例）' },
      { id: 'task-cert-003', title: '锁定认证机构排期', deadline: '2026-04-12', status: 'Pending', priority: 'High', category: 'Core', owner: '交付负责人（示例）' }
    ],
    settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
  },
  {
    id: 'proj-cert-002',
    customerId: 'cust-cert-002',
    name: '新味食品 HACCP 证书抢救续证项目',
    contractRef: 'CUSTCERT:cust-cert-002:cert-002',
    sourceType: 'customer',
    sourceRef: 'cust-cert-002',
    projectMode: 'followup',
    projectCategory: 'FollowUp',
    manager: '老板（示例）',
    progress: 20,
    status: Status.Active,
    paymentStatus: 'unpaid',
    deadline: '2026-04-15',
    duration: 20,
    projectType: 'Self-Operated',
    tasks: [
      { id: 'task-cert-004', title: '立即联系客户确认现状', deadline: '2026-04-01', status: 'Pending', priority: 'High', category: 'Core', owner: '老板（示例）' },
      { id: 'task-cert-005', title: '确认是否已有竞对介入', deadline: '2026-04-02', status: 'Pending', priority: 'High', category: 'Core', owner: '咨询顾问1（示例）' },
      { id: 'task-cert-006', title: '补审计划与资料清单', deadline: '2026-04-05', status: 'Pending', priority: 'High', category: 'Core', owner: '交付负责人（示例）' }
    ],
    settlementConfig: { rule: 'Ratio', value: 12, base: 'Revenue' }
  }
];

const demoCertificateReminders: any[] = [
  {
    id: 'rem-cert-001',
    title: 'ISO9001证书45天后到期',
    content: '请尽快联系客户确认续证安排，避免被竞对切入。',
    date: '2026-04-01',
    type: 'expire',
    isRead: false,
    linkType: 'project',
    linkId: 'proj-cert-001',
    channels: ['system', 'wechat']
  },
  {
    id: 'rem-cert-002',
    title: '续证审核资料待收集',
    content: '需补齐管理评审、内审记录、顾客满意度资料。',
    date: '2026-04-03',
    type: 'task',
    isRead: false,
    linkType: 'project',
    linkId: 'proj-cert-001',
    channels: ['system']
  },
  {
    id: 'rem-cert-003',
    title: 'HACCP证书已过期',
    content: '客户证书已过期12天，请立即联系，避免竞对趁机切入。',
    date: '2026-04-01',
    type: 'expire',
    isRead: false,
    linkType: 'project',
    linkId: 'proj-cert-002',
    channels: ['system', 'wechat']
  },
  {
    id: 'rem-cert-004',
    title: '客户回访未完成',
    content: '需确认客户是否已接触其他咨询机构。',
    date: '2026-04-01',
    type: 'risk',
    isRead: false,
    linkType: 'customer',
    linkId: 'cust-cert-002',
    channels: ['system']
  },
  {
    id: 'rem-cert-005',
    title: '补审计划待确认',
    content: '尽快与认证机构锁定补审时间。',
    date: '2026-04-02',
    type: 'task',
    isRead: false,
    linkType: 'project',
    linkId: 'proj-cert-002',
    channels: ['system']
  },
  {
    id: 'rem-cert-006',
    title: 'ISO14001年度监督审核临近',
    content: '请提前30天准备环保合规资料及运行记录。',
    date: '2026-05-20',
    type: 'task',
    isRead: false,
    linkType: 'customer',
    linkId: 'cust-cert-003',
    channels: ['system']
  }
];

const demoCertificateKnowledgeDocs: KnowledgeDoc[] = [
  {
    id: 'doc-cert-001',
    title: '证书档案｜温州华信包装有限公司｜ISO9001 质量管理体系认证',
    category: '证书档案',
    format: 'PDF',
    size: '2.3 MB',
    updatedAt: '2026-04-01',
    summary: '手动上传原件：ISO9001 质量管理体系认证（编号 00126Q31245R0M/3300），用于客户证书原件与版本留存。',
    aiVisible: false,
    source: 'manual',
    autoGenerated: false,
    originalFileName: '温州华信包装-ISO9001-证书原件.pdf',
    linkType: 'customer',
    linkId: 'cust-cert-001',
    linkTitle: '温州华信包装有限公司',
    tags: ['证书档案', 'ISO9001 质量管理体系认证', 'certificate:cert-001'],
    accessRoles: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
  },
  {
    id: 'doc-cert-002',
    title: '证书档案｜温州华信包装有限公司｜ISO9001 OCR识别归档',
    category: '证书档案',
    format: 'JPG',
    size: '860 KB',
    updatedAt: '2026-04-01',
    summary: 'OCR识别后自动归档，用于保留证书图片与识别来源。',
    aiVisible: false,
    source: 'ai',
    autoGenerated: true,
    originalFileName: 'iso9001-cert-photo.jpg',
    linkType: 'customer',
    linkId: 'cust-cert-001',
    linkTitle: '温州华信包装有限公司',
    tags: ['证书档案', 'ISO9001 质量管理体系认证', 'certificate:cert-001', 'OCR导入'],
    accessRoles: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
  },
  {
    id: 'doc-cert-003',
    title: '证书档案｜龙港市新味食品科技有限公司｜HACCP 食品安全管理体系认证',
    category: '证书档案',
    format: 'PDF',
    size: '1.8 MB',
    updatedAt: '2026-04-01',
    summary: '历史证书扫描件，用于过期追溯与补审资料准备。',
    aiVisible: false,
    source: 'manual',
    autoGenerated: false,
    originalFileName: '新味食品-HACCP-证书.pdf',
    linkType: 'customer',
    linkId: 'cust-cert-002',
    linkTitle: '龙港市新味食品科技有限公司',
    tags: ['证书档案', 'HACCP 食品安全管理体系认证', 'certificate:cert-002'],
    accessRoles: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
  },
  {
    id: 'doc-cert-004',
    title: '证书档案｜瑞安精工泵业有限公司｜ISO14001 环境管理体系认证',
    category: '证书档案',
    format: 'PDF',
    size: '2.0 MB',
    updatedAt: '2026-04-01',
    summary: '证书正本扫描归档，用于年度监管与后续检索。',
    aiVisible: false,
    source: 'manual',
    autoGenerated: false,
    originalFileName: '瑞安精工-ISO14001-证书正本.pdf',
    linkType: 'customer',
    linkId: 'cust-cert-003',
    linkTitle: '瑞安精工泵业有限公司',
    tags: ['证书档案', 'ISO14001 环境管理体系认证', 'certificate:cert-003'],
    accessRoles: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
  }
];

/**
 * 检查并补充示例数据
 * 仅当本地存储中对应数据为空时才会写入
 */
export const seedDemoData = () => {
  try {
    const existingLeads = dataService.get<Lead[]>('leads_v8', []);
    const existingCustomers = dataService.get<Customer[]>('customers_v8', []);
    const existingContracts = dataService.get<Contract[]>('contracts_v8', []);
    const existingProjects = dataService.get<Project[]>('projects_v8', []);
    const existingWorkLogs = dataService.get<ProjectWorkLog[]>('project_work_logs_v1', []);
    const existingSettlements = dataService.get<Settlement[]>('settlements_v8', []);
    const existingReminders = dataService.get<Reminder[]>('reminders_v8', []);
    const existingKnowledgeDocs = dataService.get<KnowledgeDoc[]>('knowledge_docs_v8', []);

    const mergeById = <T extends { id?: string }>(existing: T[], incoming: T[]): T[] => {
      const used = new Set(existing.map(item => String(item?.id || '')));
      const append = incoming.filter(item => {
        const id = String(item?.id || '');
        return id && !used.has(id);
      });
      return append.length > 0 ? [...append, ...existing] : existing;
    };

    const toMonthKey = (value?: string) => String(value || '').slice(0, 7);
    const isLeadInMonth = (lead: any, monthKey: string) => {
      const idRaw = String(lead?.id || '');
      const idTs = Number(idRaw.split('-')[1]);
      if (Number.isFinite(idTs) && idTs > 0) {
        return new Date(idTs).toISOString().slice(0, 7) === monthKey;
      }
      return toMonthKey(String(lead?.lastContact || '')) === monthKey;
    };
    const isRevenueProject = (project: any) => {
      const projectMode = String(project?.projectMode || '').toLowerCase();
      if (projectMode !== 'delivery') return false;
      if (project?.status !== Status.Completed) return false;
      if (project?.isRevenueProject === false) return false;
      return true;
    };
    const isLeadRevenueProjectInMonth = (project: any, monthKey: string, monthLeadIds: Set<string>) => {
      if (!isRevenueProject(project)) return false;
      const sourceType = String(project?.sourceType || '').toLowerCase();
      if (sourceType !== 'lead') return false;
      const sourceRef = String(project?.sourceRef || '').trim();
      if (!sourceRef || !monthLeadIds.has(sourceRef)) return false;
      const endMonth = toMonthKey(String(project?.completionRecord?.actualEndDate || project?.completionRecord?.completedAt || ''));
      return endMonth === monthKey;
    };

    const seedLeadsBase = mergeById(existingLeads, demoLeads);
    const seedProjectsBase = mergeById(mergeById(existingProjects, demoProjects), demoCertificateProjects);
    const monthLeadIds = new Set(seedLeadsBase.filter(lead => isLeadInMonth(lead, thisMonth)).map(lead => String(lead?.id || '')).filter(Boolean));
    const existingMonthLeadRevenueCount = seedProjectsBase.filter(project => isLeadRevenueProjectInMonth(project, thisMonth, monthLeadIds)).length;
    const targetRate = 0.18;
    const denominator = monthLeadIds.size;
    const numerator = existingMonthLeadRevenueCount;
    const needBoost = denominator > 0 ? Math.max(0, Math.ceil((targetRate * denominator - numerator) / (1 - targetRate))) : 0;

    const boostedLeads: any[] = [];
    const boostedProjects: any[] = [];
    for (let i = 0; i < needBoost; i += 1) {
      const index = i + 1;
      const suffix = `${String(index).padStart(3, '0')}`;
      const leadId = `LEAD-DEMO-BOOST-${monthToken}-${suffix}`;
      const projectId = `PROJ-DEMO-BOOST-${monthToken}-${suffix}`;
      boostedLeads.push({
        id: leadId,
        name: `示例成交线索客户${suffix}`,
        company: `示例成交线索客户${suffix}`,
        contactPerson: `联系人${suffix}`,
        mobile: `1390000${String(1000 + index).slice(-4)}`,
        intent: 'High',
        status: Status.Converted,
        lastContact: `${thisMonth}-18`,
        followUpRecords: [
          {
            id: `FOLLOW-BOOST-${monthToken}-${suffix}`,
            date: `${thisMonth}-18`,
            method: '电话',
            content: '完成方案确认并进入签约',
            operator: '老板（示例）',
            result: '已转化为收入项目'
          }
        ],
        tags: ['转化样例'],
        source: '示例补量'
      });
      boostedProjects.push({
        id: projectId,
        name: `示例成交交付项目${suffix}`,
        contractRef: `LEAD:${leadId}`,
        sourceType: 'lead',
        sourceRef: leadId,
        projectMode: 'delivery',
        manager: '老板（示例）',
        progress: 100,
        status: Status.Completed,
        paymentStatus: 'paid',
        deadline: `${thisMonth}-22`,
        duration: 20,
        projectCategory: 'Delivery',
        projectType: 'Self-Operated',
        projectAmount: 28000 + index * 300,
        costStatus: '已确认',
        serviceItems: [
          {
            id: `SI-BOOST-${monthToken}-${suffix}`,
            name: 'ISO 体系认证交付',
            category: '体系认证',
            deliveryMode: 'Self',
            status: 'Completed'
          }
        ],
        tasks: [
          {
            id: `TASK-BOOST-${monthToken}-${suffix}`,
            title: '交付闭环完成',
            deadline: `${thisMonth}-22`,
            status: 'Completed',
            priority: 'High',
            category: 'Core',
            owner: '老板（示例）'
          }
        ],
        settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' },
        completionRecord: {
          eventId: `EVT-BOOST-${monthToken}-${suffix}`,
          completedAt: `${thisMonth}-22T10:30:00.000Z`,
          actualEndDate: `${thisMonth}-22`,
          duration: 20,
          passRate: true,
          taskCompletionRate: 100,
          delayedTasksCount: 0,
          rating: 'A',
          autoCompleted: false
        },
        aiInsight: {
          riskLevel: 'Low',
          summary: '示例转化补量项目已完结'
        }
      });
    }

    const nextLeads = mergeById(seedLeadsBase, boostedLeads);
    const nextCustomers = mergeById(mergeById(existingCustomers, demoCustomers), demoCertificateCustomers);
    const nextContracts = mergeById(existingContracts, demoContracts);
    const nextProjects = mergeById(seedProjectsBase, boostedProjects);
    const nextWorkLogs = mergeById(existingWorkLogs, demoProjectWorkLogs);
    const nextSettlements = mergeById(existingSettlements, demoSettlements);
    const nextReminders = mergeById(mergeById(existingReminders, demoReminders), demoCertificateReminders);
    const nextKnowledgeDocs = mergeById(existingKnowledgeDocs, demoCertificateKnowledgeDocs);

    if (nextLeads !== existingLeads) dataService.set('leads_v8', nextLeads);
    if (nextCustomers !== existingCustomers) dataService.set('customers_v8', nextCustomers);
    if (nextContracts !== existingContracts) dataService.set('contracts_v8', nextContracts);
    if (nextProjects !== existingProjects) dataService.set('projects_v8', nextProjects);
    if (nextWorkLogs !== existingWorkLogs) dataService.set('project_work_logs_v1', nextWorkLogs);
    if (nextSettlements !== existingSettlements) dataService.set('settlements_v8', nextSettlements);
    if (nextReminders !== existingReminders) dataService.set('reminders_v8', nextReminders);
    if (nextKnowledgeDocs !== existingKnowledgeDocs) dataService.set('knowledge_docs_v8', nextKnowledgeDocs);

    console.log('[DemoDataSeeder] 示例数据补充完成');
  } catch (error) {
    console.error('[DemoDataSeeder] 补充示例数据失败:', error);
  }
};

/**
 * 清理示例数据（用于测试或重置）
 */
export const clearDemoData = () => {
  const demoDataKeys = [
    'leads_v8',
    'customers_v8',
    'contracts_v8',
    'projects_v8',
    'project_work_logs_v1',
    'settlements_v8',
    'reminders_v8',
    'knowledge_docs_v8'
  ];

  demoDataKeys.forEach(key => {
    dataService.remove(key);
  });

  console.log('[DemoDataSeeder] 示例数据已清理');
};
