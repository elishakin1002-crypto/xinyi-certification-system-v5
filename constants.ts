

import { Lead, Customer, Contract, Project, Status, Role, TaskTemplate, Vendor, StrategicTask, RoleID, PermissionCode, UserProfile, RoleCapability, ServiceCatalogItem, ServiceWorkflowTemplate, ServiceCategory, ServiceDeliveryMode } from './types';

// --- 权限能力矩阵 (Capability Matrix) ---
export const ROLE_CAPABILITIES: Record<RoleID, RoleCapability> = {
  ADMIN: {
    actions: [
      'PROJECT_CREATE', 'PROJECT_EDIT_INFO', 'PROJECT_ASSIGN_MANAGER', 'PROJECT_PAUSE',
      'TASK_CREATE', 'TASK_COMPLETE', 'TASK_DELETE',
      'CONTRACT_CREATE', 'CONTRACT_VIEW_AMOUNT',
      'CUSTOMER_CREATE', 'LEAD_CONVERT'
    ],
    dataScope: 'ALL'
  },
  MANAGER: {
    actions: [
      'PROJECT_CREATE', 'PROJECT_EDIT_INFO', 'PROJECT_ASSIGN_MANAGER', 'PROJECT_PAUSE',
      'TASK_CREATE', 'TASK_COMPLETE', 'TASK_DELETE',
      'CONTRACT_CREATE', 'CONTRACT_VIEW_AMOUNT',
      'CUSTOMER_CREATE', 'LEAD_CONVERT'
    ],
    dataScope: 'DEPARTMENT' // 实际业务中通常指交付部范围
  },
  CONSULTANT: {
    actions: [
      'TASK_CREATE', 'TASK_COMPLETE',
      'CONTRACT_CREATE',
      'CUSTOMER_CREATE'
    ],
    dataScope: 'OWN'
  },
  FINANCE: {
    actions: [
      'CONTRACT_VIEW_AMOUNT',
      'PAYMENT_CONFIRM'
    ],
    dataScope: 'ALL' // 财务通常看所有合同回款
  }
};

export const SYSTEM_ROLES: Role[] = [
  { id: 'ADMIN', name: '老板', description: '全局视野，关注风险与利润' },
  { id: 'MANAGER', name: '交付负责人', description: '关注资源分配与项目节点' },
  { id: 'CONSULTANT', name: '咨询顾问', description: '具体执行任务与客户沟通' },
  { id: 'FINANCE', name: '财务', description: '关注回款、开票与结算' },
];

export const ROLE_PERMISSIONS: Record<RoleID, PermissionCode[]> = {
  ADMIN: ['NAV_CRM', 'NAV_DELIVERY', 'NAV_FINANCE', 'NAV_AUDIT', 'NAV_KNOWLEDGE', 'NAV_INTEL', 'NAV_STRATEGY', 'NAV_AI_CENTER'],
  MANAGER: ['NAV_CRM', 'NAV_DELIVERY', 'NAV_AUDIT', 'NAV_KNOWLEDGE', 'NAV_INTEL', 'NAV_STRATEGY', 'NAV_AI_CENTER'],
  CONSULTANT: ['NAV_CRM', 'NAV_DELIVERY', 'NAV_AUDIT', 'NAV_KNOWLEDGE', 'NAV_INTEL', 'NAV_AI_CENTER'],
  FINANCE: ['NAV_CRM', 'NAV_DELIVERY', 'NAV_FINANCE', 'NAV_KNOWLEDGE', 'NAV_INTEL', 'NAV_AI_CENTER']
};

export const INTEL_REGIONS = ['温州', '苍南', '平阳', '龙港'] as const;
export const INTEL_INDUSTRIES = ['塑料编织制品制造业', '食包', '药材', '印刷', '食品', '餐饮'] as const;

export const DEFAULT_USER_PROFILE: UserProfile = {
  id: 'U-LOCAL',
  name: '系统管理员',
  roles: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'],
  activeRole: 'ADMIN'
};

export const DEFAULT_USER_PROFILES: UserProfile[] = [
  { id: 'U-001', name: '老板（示例）', roles: ['ADMIN', 'CONSULTANT'], activeRole: 'ADMIN', positionTags: ['公司负责人', '销售'] },
  { id: 'U-002', name: '交付负责人（示例）', roles: ['MANAGER'], activeRole: 'MANAGER', positionTags: ['交付管理'] },
  { id: 'U-003', name: '财务（示例）', roles: ['FINANCE'], activeRole: 'FINANCE', positionTags: ['对公财务'] },
  { id: 'U-004', name: '咨询顾问1（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['食品包装认证指导负责人'] },
  { id: 'U-005', name: '咨询顾问2（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['体系认证'] },
  { id: 'U-006', name: '咨询顾问3（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['食品认证'] },
  { id: 'U-007', name: '咨询顾问4（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['项目交付'] },
  { id: 'U-008', name: '咨询顾问5（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['项目交付'] },
  { id: 'U-009', name: '咨询顾问6（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['项目交付'] },
  { id: 'U-010', name: '咨询顾问7（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['项目交付'] },
  { id: 'U-011', name: '台账指导兼职1（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['台账指导兼职'], reportsToUserId: 'U-004' },
  { id: 'U-012', name: '台账指导兼职2（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['台账指导兼职'], reportsToUserId: 'U-004' },
  { id: 'U-013', name: '台账指导兼职3（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['台账指导兼职'], reportsToUserId: 'U-004' },
  { id: 'U-014', name: '台账指导兼职4（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['台账指导兼职'], reportsToUserId: 'U-004' },
  { id: 'U-015', name: '台账指导兼职5（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['台账指导兼职'], reportsToUserId: 'U-004' },
  { id: 'U-016', name: '台账指导兼职6（示例）', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['台账指导兼职'], reportsToUserId: 'U-004' },
  { id: 'AI-WORKER', name: 'AI 助手', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: ['自动化执行', '数字员工'] }
];

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'TEMPLATE_FOLLOWUP',
    name: '跟进项目标准模版（最小闭环）',
    isBuiltIn: true,
    createdByName: '系统',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    archived: false,
    usageCount: 0,
    tasks: [
      { title: '认证信息确认', priority: 'High', category: 'Core' },
      { title: '到期前联系跟进', priority: 'High', category: 'Core' },
      { title: '成交判断', priority: 'High', category: 'Core' }
    ]
  },
  {
    id: 'TEMPLATE_DELIVERY',
    name: '交付项目通用模版',
    isBuiltIn: true,
    createdByName: '系统',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    archived: false,
    usageCount: 0,
    tasks: [
      { title: '资料收集', priority: 'High', category: 'Core' },
      { title: '文件编制', priority: 'High', category: 'Core' },
      { title: '内审/管评', priority: 'Medium', category: 'Core' },
      { title: '认证审核配合', priority: 'High', category: 'Core' },
      { title: '取证确认', priority: 'High', category: 'Core' }
    ]
  },
  {
    id: 'TEMPLATE_SYSTEM',
    name: '体系认证标准模版（旧版）',
    isBuiltIn: true,
    createdByName: '系统',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    archived: false,
    usageCount: 0,
    tasks: [
      { title: '现场辅导', priority: 'High', category: 'Core' },
      { title: '文件编制', priority: 'High', category: 'Core' },
      { title: '内审', priority: 'Medium', category: 'Core' },
      { title: '管评', priority: 'Medium', category: 'Core' },
      { title: '认证审核', priority: 'High', category: 'Core' },
    ]
  },
  {
    id: 'TEMPLATE_HIGHTECH',
    name: '高新申报模版',
    isBuiltIn: true,
    createdByName: '系统',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    archived: false,
    usageCount: 0,
    tasks: [
      { title: '摸底评价', priority: 'High', category: 'Core' },
      { title: '知识产权规划', priority: 'High', category: 'Core' },
      { title: '研发费用核算', priority: 'High', category: 'Core' },
      { title: '申报书编写', priority: 'High', category: 'Core' },
      { title: '系统提交', priority: 'High', category: 'Core' },
    ]
  }
];

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  '体系认证',
  '产品认证',
  '政府项目申报',
  '管理培训/顾问服务',
  '生产许可类',
  '其他'
];

export const SERVICE_CATEGORY_DELIVERY_MODE: Record<ServiceCategory, ServiceDeliveryMode> = {
  '体系认证': 'Self',
  '产品认证': 'Partner',
  '政府项目申报': 'Self',
  '管理培训/顾问服务': 'Partner',
  '生产许可类': 'Self',
  '其他': 'Partner'
};

export const SERVICE_WORKFLOW_TEMPLATES: ServiceWorkflowTemplate[] = [
  {
    id: 'WF_SYSTEM_CERT',
    name: '体系认证标准流程',
    steps: [
      { title: '需求确认与资料清单', offsetDays: 0, category: 'Core', priority: 'High' },
      { title: '资料收集与现场辅导', offsetDays: 7, category: 'Core', priority: 'High' },
      { title: '文件编制与完善', offsetDays: 14, category: 'Core', priority: 'High' },
      { title: '内审与整改', offsetDays: 21, category: 'Core', priority: 'Medium' },
      { title: '管评与审核准备', offsetDays: 28, category: 'Core', priority: 'Medium' },
      { title: '认证审核配合与取证', offsetDays: 35, category: 'Core', priority: 'High' }
    ]
  },
  {
    id: 'WF_GOV_PROJECT',
    name: '政府项目申报流程',
    steps: [
      { title: '条件评估与申报路径确认', offsetDays: 0, category: 'Core', priority: 'High' },
      { title: '资料清单与收集', offsetDays: 7, category: 'Core', priority: 'High' },
      { title: '申报书编写与材料整合', offsetDays: 14, category: 'Core', priority: 'High' },
      { title: '系统提交与材料递交', offsetDays: 21, category: 'Core', priority: 'High' },
      { title: '评审/答辩跟踪', offsetDays: 28, category: 'Core', priority: 'Medium' },
      { title: '结果归档与项目复盘', offsetDays: 35, category: 'Core', priority: 'Medium' }
    ]
  },
  {
    id: 'WF_PRODUCTION_LICENSE',
    name: '生产许可交付流程',
    steps: [
      { title: '许可要求解读与资料准备', offsetDays: 0, category: 'Core', priority: 'High' },
      { title: '现场整改辅导', offsetDays: 7, category: 'Core', priority: 'High' },
      { title: '许可申报与材料提交', offsetDays: 14, category: 'Core', priority: 'High' },
      { title: '现场核查配合', offsetDays: 21, category: 'Core', priority: 'High' },
      { title: '取证归档与持续合规建议', offsetDays: 28, category: 'Core', priority: 'Medium' }
    ]
  },
  {
    id: 'WF_PRODUCT_CERT',
    name: '产品认证协同流程',
    steps: [
      { title: '需求确认与资料清单', offsetDays: 0, category: 'Core', priority: 'High' },
      { title: '资料准备与送检安排', offsetDays: 7, category: 'Core', priority: 'High' },
      { title: '对接机构与测试执行', offsetDays: 14, category: 'ThirdParty', priority: 'Medium' },
      { title: '测试报告跟踪', offsetDays: 21, category: 'ThirdParty', priority: 'Medium' },
      { title: '证书获取与交付', offsetDays: 28, category: 'ThirdParty', priority: 'High' },
      { title: '归档结项与经验沉淀', offsetDays: 35, category: 'Core', priority: 'Low' }
    ]
  },
  {
    id: 'WF_TRAINING',
    name: '管理培训/顾问服务流程',
    steps: [
      { title: '需求调研与目标确认', offsetDays: 0, category: 'Core', priority: 'High' },
      { title: '方案制定与计划排期', offsetDays: 7, category: 'Core', priority: 'High' },
      { title: '培训/辅导实施', offsetDays: 14, category: 'Core', priority: 'High' },
      { title: '效果评估与复盘', offsetDays: 21, category: 'Core', priority: 'Medium' },
      { title: '交付归档与后续建议', offsetDays: 28, category: 'Core', priority: 'Medium' }
    ]
  },
  {
    id: 'WF_OTHER_PARTNER',
    name: '合作交付通用流程',
    steps: [
      { title: '需求确认与资源对接', offsetDays: 0, category: 'Core', priority: 'High' },
      { title: '方案制定与费用确认', offsetDays: 7, category: 'Core', priority: 'High' },
      { title: '实施/对接执行', offsetDays: 14, category: 'ThirdParty', priority: 'Medium' },
      { title: '验收归档与结项', offsetDays: 21, category: 'Core', priority: 'Medium' }
    ]
  }
];

export const DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY: Record<ServiceCategory, string> = {
  '体系认证': 'WF_SYSTEM_CERT',
  '产品认证': 'WF_PRODUCT_CERT',
  '政府项目申报': 'WF_GOV_PROJECT',
  '管理培训/顾问服务': 'WF_TRAINING',
  '生产许可类': 'WF_PRODUCTION_LICENSE',
  '其他': 'WF_OTHER_PARTNER'
};

const SERVICE_CATALOG_GROUPS: Array<{
  category: ServiceCategory;
  deliveryMode: ServiceDeliveryMode;
  workflowTemplateId: string;
  items: Array<{ name: string; code?: string; aliases?: string[]; workflowTemplateId?: string }>;
}> = [
  {
    category: '体系认证',
    deliveryMode: 'Self',
    workflowTemplateId: 'WF_SYSTEM_CERT',
    items: [
      { name: 'ISO 9001 质量管理体系认证', code: 'ISO9001' },
      { name: 'GB/T 19001 质量管理体系认证', code: 'GBT19001', aliases: ['ISO19001', 'ISO 19001'] },
      { name: 'ISO 14001 环境管理体系认证', code: 'ISO14001' },
      { name: 'ISO 45001 职业健康安全管理体系认证', code: 'ISO45001' },
      { name: 'ISO 22000 食品安全管理体系认证', code: 'ISO22000' },
      { name: 'HACCP（危害分析与关键控制点）认证', code: 'HACCP', aliases: ['HAP'] },
      { name: 'ISO/IEC 27001 信息安全管理体系认证', code: 'ISOIEC27001', aliases: ['ISO27001'] },
      { name: 'ISO 20000 信息技术管理体系认证', code: 'ISO20000' },
      { name: 'ISO 50001 能源管理体系认证', code: 'ISO50001' },
      { name: 'GB/T 23331 能源管理体系认证', code: 'GBT23331' },
      { name: 'SA 8000 社会责任国际标准认证', code: 'SA8000' },
      { name: 'TL 9000 电信业质量管理体系认证', code: 'TL9000' },
      { name: 'IATF 16949 汽车行业质量管理体系认证', code: 'IATF16949', aliases: ['ISO/TS16949', 'ISOTS16949'] },
      { name: 'AS 9100 航空航天质量管理体系认证', code: 'AS9100' },
      { name: 'ISO/TS 16949 认证', code: 'ISOTS16949', aliases: ['IATF16949'] },
      { name: '测量管理体系', code: 'MEASURE' },
      { name: '标准化良好行为企业', code: 'STANDARDIZATION' },
      { name: '知识产权贯标', code: 'IPMS' }
    ]
  },
  {
    category: '产品认证',
    deliveryMode: 'Partner',
    workflowTemplateId: 'WF_PRODUCT_CERT',
    items: [
      { name: 'CCC 认证', code: 'CCC' },
      { name: 'CE 认证', code: 'CE' },
      { name: 'FCC 认证', code: 'FCC' },
      { name: 'FDA 认证', code: 'FDA' },
      { name: 'CS 认证', code: 'CS' },
      { name: 'RoHS 认证', code: 'ROHS' },
      { name: 'REACH 认证', code: 'REACH' },
      { name: 'E-Mark 认证', code: 'EMARK', aliases: ['E-MARK', 'EMARK'] },
      { name: 'CSA 认证', code: 'CSA' },
      { name: 'PSE 认证', code: 'PSE' },
      { name: 'KC 认证', code: 'KC' },
      { name: 'SAA 认证', code: 'SAA' },
      { name: 'GCC 认证', code: 'GCC' },
      { name: 'HALAL 清真认证', code: 'HALAL' },
      { name: '绿色产品认证', code: 'GREENPRODUCT' }
    ]
  },
  {
    category: '政府项目申报',
    deliveryMode: 'Self',
    workflowTemplateId: 'WF_GOV_PROJECT',
    items: [
      { name: '两化融合贯标', code: 'LIANGHUA' },
      { name: '两化融合技改（信息化技改）', code: 'LIANGHUA_REFORM', aliases: ['信息化技改'] },
      { name: '省科技型中小科技型企业', code: 'SME_TECH' },
      { name: '高新技术企业', code: 'HIGHTECH', aliases: ['国家高新技术企业申报'] },
      { name: '科技型中小企业申报', code: 'SME_DECL' },
      { name: '县长质量奖', code: 'COUNTY_QA' },
      { name: '市长质量奖', code: 'CITY_QA' },
      { name: '浙江省专精特新中小企业', code: 'SPECIALIZED' },
      { name: '省、市、县绿色工厂', code: 'GREEN_FACTORY' },
      { name: '省、市级企业研究院', code: 'RESEARCH_INSTITUTE' },
      { name: '企业研发中心', code: 'RND_CENTER' },
      { name: '技改项目申报', code: 'TECH_REFORM' },
      { name: '企业技术中心', code: 'TECH_CENTER' },
      { name: '两化融合试点/示范企业', code: 'LIANGHUA_DEMO' },
      { name: '智能制造', code: 'SMART_MANUFACTURING' },
      { name: '发明专利产业化', code: 'PATENT_INDUSTRIAL' },
      { name: '能源评价', code: 'ENERGY_EVAL' },
      { name: '环境评价', code: 'ENV_EVAL' },
      { name: '环保工程验收', code: 'ENV_ACCEPT' },
      { name: '环境应急预案', code: 'ENV_EMERGENCY' },
      { name: '清洁生产', code: 'CLEAN_PRODUCTION' },
      { name: '节水型企业', code: 'WATER_SAVING' },
      { name: '安全评价', code: 'SAFETY_EVAL' },
      { name: '安全生产标准化', code: 'SAFETY_STANDARD' },
      { name: '职业卫生检测', code: 'OCCUP_HEALTH_TEST' },
      { name: '职业卫生评价', code: 'OCCUP_HEALTH_EVAL' },
      { name: '浙江制造', code: 'ZJ_MANUFACTURE' }
    ]
  },
  {
    category: '管理培训/顾问服务',
    deliveryMode: 'Partner',
    workflowTemplateId: 'WF_TRAINING',
    items: [
      { name: '管理顾问服务' },
      { name: '管理培训' },
      { name: '财务托管' },
      { name: '台账托管' },
      { name: '安全台账' },
      { name: '消防台账' },
      { name: '五项制度台账' },
      { name: '易制毒台账' },
      { name: 'QS 台账' },
      { name: 'SC 台账' },
      { name: '环保台账' },
      { name: '职业卫生台账' },
      { name: '智能审计' },
      { name: '体系落地' },
      { name: '自理和阶' },
      { name: '精益生产' },
      { name: '6S 管理' },
      { name: '化验员培训' },
      { name: '专项审计服务' },
      { name: '可行性研究报告' }
    ]
  },
  {
    category: '生产许可类',
    deliveryMode: 'Self',
    workflowTemplateId: 'WF_PRODUCTION_LICENSE',
    items: [
      { name: 'QS 食品相关产品生产许可', code: 'QS' },
      { name: 'SC 食品生产许可', code: 'SC' },
      { name: '医疗器械经营/生产许可证', code: 'MED_DEVICE' },
      { name: '特种设备设计/制造/安装许可证', code: 'SPECIAL_EQUIP' },
      { name: '保健食品许可证', code: 'HEALTH_FOOD' },
      { name: '化妆品许可证', code: 'COSMETIC' },
      { name: '消毒产品卫生许可证', code: 'DISINFECT' },
      { name: '排水/排污许可证', code: 'DRAIN' },
      { name: '全国工业产品生产许可证', code: 'NATIONAL_PROD' },
      { name: '药包材注册', code: 'MED_PACK' }
    ]
  },
  {
    category: '其他',
    deliveryMode: 'Partner',
    workflowTemplateId: 'WF_OTHER_PARTNER',
    items: [
      { name: '验厂服务' },
      { name: '安全技术' },
      { name: '环保技术' },
      { name: '环保工程' },
      { name: '知识产权（非贯标类）' },
      { name: '净化装修' },
      { name: '光伏储能' },
      { name: '浙食链' },
      { name: '风险管控体系' },
      { name: '安全预案' },
      { name: '环境检测' },
      { name: '实用新型专利' },
      { name: '产品检测' },
      { name: '计量校准' }
    ]
  }
];

export const SERVICE_CATALOG: ServiceCatalogItem[] = SERVICE_CATALOG_GROUPS.flatMap((group, groupIndex) => {
  return group.items.map((item, index) => ({
    id: `SC-${groupIndex + 1}-${index + 1}`,
    name: item.name,
    category: group.category,
    deliveryMode: group.deliveryMode,
    code: item.code,
    aliases: item.aliases,
    workflowTemplateId: item.workflowTemplateId || group.workflowTemplateId
  }));
});

export const MOCK_PROJECTS: Project[] = [
  { 
      id: 'P001', name: '科诺华 ISO 9001 实施', contractRef: 'CT-2025-001', manager: '张强', progress: 40, status: Status.Active, paymentStatus: 'partial', deadline: '2025-12-31', duration: 30,
      projectCategory: 'Delivery',
      projectType: 'Self-Operated',
      tasks: [
        { id: 'T1-1', title: '现场辅导', deadline: '2025-11-01', status: 'Completed', priority: 'High', category: 'Core', owner: '张强' },
        { id: 'T1-2', title: '文件编制', deadline: '2025-11-15', status: 'Completed', priority: 'High', category: 'Core', owner: '张强' },
        { id: 'T1-3', title: '内审', deadline: '2025-11-20', status: 'Pending', priority: 'Medium', category: 'Core', owner: '张强' },
        { id: 'T1-4', title: '管评', deadline: '2025-11-25', status: 'Pending', priority: 'Medium', category: 'Core', owner: '张强' },
        { id: 'T1-5', title: '认证审核', deadline: '2025-12-10', status: 'Pending', priority: 'High', category: 'Core', owner: '张强' },
      ],
      settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
  },
  { 
      id: 'P002', name: '吴氏医药 GMP 审计', contractRef: 'CT-2025-002', manager: '李娜', progress: 0, status: Status.Active, paymentStatus: 'partial', deadline: '2025-12-15', duration: 30,
      projectCategory: 'Delivery',
      projectType: 'Self-Operated',
      tasks: [],
      settlementConfig: { rule: 'Fixed', value: 5000 }
  }
];

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'C001', name: '科诺华科技（深圳）有限公司', contactPerson: '陈爱丽', totalValue: 150000, riskStatus: 'low', activeContracts: 2, mobile: '13800138000' }
];

export const MOCK_CONTRACTS: Contract[] = [
  { id: 'CT-2025-001', title: 'ISO 9001 质量体系认证', customerName: '科诺华科技（深圳）有限公司', amount: 50000, signDate: '2025-09-01', status: Status.Active, serviceLine: 'ISO 标准', riskLevel: 'Low', archiveStatus: 'active', receivables: [
    { id: 'R1', node: '签约首付', amount: 15000, dueDate: '2025-09-05', status: 'paid' },
    { id: 'R2', node: '审核通过', amount: 25000, dueDate: '2025-11-01', status: 'unpaid' }
  ], attachments: [] }
];

export const COMPANY_SERVICES = "";
export const CERT_LIFECYCLE_RULES: Record<string, { name: string }> = {
  'SYSTEM_3Y': { name: 'ISO 三年周期' },
  'IATF_3Y': { name: 'IATF 16949 三年周期' },
  'PRODUCT_5Y': { name: '产品认证 五年周期' },
  'FDA_MED_5Y': { name: 'FDA 医疗 五年周期' },
  'HIGHTECH_3Y': { name: '高新申报 三年周期' },
  'SPECIALIZED_3Y': { name: '专精特新 三年周期' },
  'SC_5Y': { name: 'SC 食品生产 五年周期' }
};
export const MOCK_VENDORS = [];
export const MOCK_LEADS = [];
export const MOCK_SETTLEMENTS = [];
export const MOCK_AUDITS = [];
export const MOCK_DOCS = [];
export const MOCK_STRATEGY_TASKS = [];
