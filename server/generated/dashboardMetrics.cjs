var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// services/dashboardMetrics.ts
var dashboardMetrics_exports = {};
__export(dashboardMetrics_exports, {
  buildDashboardMetrics: () => buildDashboardMetrics
});
module.exports = __toCommonJS(dashboardMetrics_exports);

// src/routes/index.ts
var APP_ROUTES = {
  DASHBOARD: "/dashboard",
  LEADS: "/leads",
  CUSTOMERS: "/customers",
  CONTRACTS: "/contracts",
  PROJECTS: "/projects",
  FINANCE: "/finance",
  AUDIT: "/audit",
  KNOWLEDGE: "/knowledge",
  INTEL: "/intel",
  STRATEGY: "/strategy",
  AI_CENTER: "/ai-center"
};

// src/utils/projectCapabilities.ts
var isValidSourceType = (value) => value === "intel" || value === "lead" || value === "customer" || value === "contract" || value === "manual";
var isValidProjectMode = (value) => value === "followup" || value === "delivery";
var parseLegacyProjectRef = (ref) => {
  const raw = String(ref || "").trim();
  if (!raw || raw === "\u65E0\u5173\u8054") return {};
  if (raw.startsWith("INTEL:")) return { sourceType: "intel", sourceRef: raw.slice("INTEL:".length) };
  if (raw.startsWith("LEAD:")) return { sourceType: "lead", sourceRef: raw.slice("LEAD:".length) };
  if (raw.startsWith("CUSTCERT:")) return { sourceType: "customer", sourceRef: raw.slice("CUSTCERT:".length) };
  if (raw.startsWith("CUST:")) return { sourceType: "customer", sourceRef: raw.slice("CUST:".length) };
  return { sourceType: "contract", sourceRef: raw };
};
var resolveProjectMode = (project) => {
  if (isValidProjectMode(project.projectMode)) return project.projectMode;
  if (project.projectCategory === "FollowUp") return "followup";
  if (project.projectCategory === "Delivery") return "delivery";
  const legacy = parseLegacyProjectRef(project.contractRef);
  if (legacy.sourceType === "intel" || legacy.sourceType === "lead" || legacy.sourceType === "customer") return "followup";
  return "delivery";
};
var resolveProjectSourceType = (project) => {
  if (isValidSourceType(project.sourceType)) return project.sourceType;
  const legacy = parseLegacyProjectRef(project.contractRef);
  if (legacy.sourceType) return legacy.sourceType;
  return "manual";
};
var resolveProjectSourceRef = (project) => {
  if (typeof project.sourceRef === "string" && project.sourceRef.trim()) return project.sourceRef.trim();
  const legacy = parseLegacyProjectRef(project.contractRef);
  return legacy.sourceRef || "";
};
var inferProjectMeta = (project) => {
  const projectMode = resolveProjectMode(project);
  const sourceType = resolveProjectSourceType(project);
  const sourceRef = resolveProjectSourceRef(project);
  return { projectMode, sourceType, sourceRef };
};

// services/dashboardMetrics.ts
var nowDate = () => /* @__PURE__ */ new Date();
var currentMonthKey = (date = nowDate()) => date.toISOString().slice(0, 7);
var parseDate = (value) => {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : NaN;
};
var diffDays = (dateText, base = nowDate()) => {
  const ts = parseDate(dateText);
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.floor((ts - base.getTime()) / (24 * 3600 * 1e3));
};
var inMonth = (dateText, monthKey) => String(dateText || "").startsWith(monthKey);
var money = (n) => `\xA5${Number(n || 0).toFixed(2)}`;
var pct = (n) => `${(Number(n || 0) * 100).toFixed(1)}%`;
var normalizeName = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
var taskOwner = (task, userName) => String(task?.owner || "") === userName;
var projectIsMine = (project, userName) => String(project.manager || "") === userName || (project.tasks || []).some((task) => taskOwner(task, userName));
var contractPaidAmount = (contract) => (contract.receivables || []).filter((r) => r.status === "paid").reduce((acc, r) => acc + Number(r.amount || 0), 0);
var contractUnpaidOverdueAmount = (contract, base = nowDate()) => (contract.receivables || []).filter((r) => r.status !== "paid" && diffDays(r.dueDate, base) < 0).reduce((acc, r) => acc + Number(r.amount || 0), 0);
var isRevenueProject = (project) => {
  const meta = inferProjectMeta(project);
  if (meta.projectMode !== "delivery") return false;
  if (project.status !== "Completed" /* Completed */) return false;
  if (project.isRevenueProject === false) return false;
  return true;
};
var isLeadSourcedRevenueProject = (project) => {
  if (!isRevenueProject(project)) return false;
  const meta = inferProjectMeta(project);
  return meta.sourceType === "lead";
};
var projectCompleteMonthKey = (project) => {
  const actualEndDate = String(project.completionRecord?.actualEndDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(actualEndDate)) return actualEndDate.slice(0, 7);
  const completedAt = String(project.completionRecord?.completedAt || "").trim();
  const completedAtTs = Date.parse(completedAt);
  if (Number.isFinite(completedAtTs)) return new Date(completedAtTs).toISOString().slice(0, 7);
  return "";
};
var resolveLeadIdFromProject = (project) => {
  const meta = inferProjectMeta(project);
  if (meta.sourceType !== "lead") return "";
  return String(meta.sourceRef || "").trim();
};
var isLeadInMonth = (lead, monthKey) => {
  const idRaw = String(lead.id || "");
  const idTs = Number(idRaw.split("-")[1]);
  if (Number.isFinite(idTs) && idTs > 0) {
    return new Date(idTs).toISOString().slice(0, 7) === monthKey;
  }
  return inMonth(lead.lastContact, monthKey);
};
var resolveDashboardRoleView = (currentUser, activeRole) => {
  if (activeRole === "FINANCE") return "finance";
  if (activeRole === "CONSULTANT") return "consultant";
  if (activeRole === "MANAGER") return "sales";
  const tags = (currentUser.positionTags || []).join(" ");
  if (/销售/i.test(tags) && !/负责人|老板|总经理/i.test(tags)) return "sales";
  return "boss";
};
var buildBossMetrics = (inputs, monthKey) => {
  const now = nowDate();
  const activeProjects = inputs.projects.filter((p) => p.status === "Active" /* Active */);
  const monthContracts = inputs.contracts.filter((c) => inMonth(c.signDate, monthKey));
  const monthContractAmount = monthContracts.reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const monthPaid = inputs.contracts.reduce((acc, c) => {
    const paidThisMonth = (c.receivables || []).filter((r) => r.status === "paid" && inMonth(r.dueDate, monthKey)).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    return acc + paidThisMonth;
  }, 0);
  const overdueAmount = inputs.contracts.reduce((acc, c) => acc + contractUnpaidOverdueAmount(c, now), 0);
  const monthLeads = inputs.leads.filter((l) => isLeadInMonth(l, monthKey));
  const monthLeadRevenueProjects = inputs.projects.filter(
    (p) => isLeadSourcedRevenueProject(p) && projectCompleteMonthKey(p) === monthKey
  );
  const conversionRate = monthLeads.length > 0 ? monthLeadRevenueProjects.length / monthLeads.length : 0;
  const nearOverdueContracts = inputs.contracts.filter(
    (c) => (c.receivables || []).some((r) => r.status !== "paid" && diffDays(r.dueDate, now) >= 0 && diffDays(r.dueDate, now) <= 7)
  ).length;
  const highRiskProjects = activeProjects.filter((p) => p.aiInsight?.riskLevel === "High" || p.status === "Risk" /* Risk */).length;
  const overdueReceivableCount = inputs.contracts.reduce(
    (acc, c) => acc + (c.receivables || []).filter((r) => r.status !== "paid" && diffDays(r.dueDate, now) < 0).length,
    0
  );
  const churnCustomers = inputs.customers.filter((c) => {
    const dates = (c.followUpRecords || []).map((f) => parseDate(f.date)).filter(Number.isFinite);
    if (dates.length === 0) return true;
    const latest = Math.max(...dates);
    return (now.getTime() - latest) / (24 * 3600 * 1e3) > 45;
  }).length;
  const owners = Array.from(new Set(activeProjects.map((p) => String(p.manager || "").trim()).filter(Boolean)));
  const avgInProgress = owners.length > 0 ? activeProjects.length / owners.length : 0;
  const openTasks = inputs.projects.flatMap((p) => p.tasks || []).filter((t) => t.status !== "Completed");
  const delayedTasks = openTasks.filter((t) => diffDays(t.deadline, now) < 0);
  const delayedRate = openTasks.length > 0 ? delayedTasks.length / openTasks.length : 0;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  const weekLogProjects = new Set(
    inputs.projectWorkLogs.filter((log) => parseDate(log.logDate) >= weekStart.getTime()).map((log) => log.projectId)
  );
  const logCoverage = activeProjects.length > 0 ? weekLogProjects.size / activeProjects.length : 0;
  const topRiskList = [
    ...inputs.contracts.filter((c) => contractUnpaidOverdueAmount(c, now) > 0).slice(0, 3).map((c) => ({
      id: `risk-contract-${c.id}`,
      title: `${c.customerName} \u56DE\u6B3E\u8D85\u671F`,
      subtitle: `${money(contractUnpaidOverdueAmount(c, now))} \xB7 \u5408\u540C ${c.contractNo || c.title}`,
      route: `${APP_ROUTES.FINANCE}?status=overdue&contractId=${encodeURIComponent(c.id)}`
    })),
    ...activeProjects.filter((p) => p.aiInsight?.riskLevel === "High" || p.status === "Risk" /* Risk */).slice(0, 3).map((p) => ({
      id: `risk-project-${p.id}`,
      title: `\u9AD8\u98CE\u9669\u9879\u76EE\uFF1A${p.name}`,
      subtitle: `\u8D1F\u8D23\u4EBA\uFF1A${p.manager}`,
      route: `${APP_ROUTES.PROJECTS}?risk=high&projectId=${encodeURIComponent(p.id)}`
    }))
  ].slice(0, 6);
  return {
    topCards: [
      { id: "boss-month-contract", title: "\u672C\u6708\u65B0\u589E\u5408\u540C\u91D1\u989D", value: money(monthContractAmount), route: `${APP_ROUTES.CONTRACTS}?month=this` },
      { id: "boss-month-paid", title: "\u672C\u6708\u5DF2\u56DE\u6B3E\u91D1\u989D", value: money(monthPaid), route: `${APP_ROUTES.FINANCE}?month=this&view=paid` },
      { id: "boss-overdue-amt", title: "\u56DE\u6B3E\u98CE\u9669\u91D1\u989D\uFF08\u8D85\u671F\uFF09", value: money(overdueAmount), route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: "boss-conv", title: "\u9500\u552E\u8F6C\u5316\u7387\uFF08\u7EBF\u7D22\u2192\u8425\u6536\u9879\u76EE\uFF09", value: pct(conversionRate), route: `${APP_ROUTES.LEADS}?filter=conversion` }
    ],
    middleCards: [
      { id: "boss-near-overdue", title: "\u5373\u5C06\u903E\u671F\u5408\u540C", value: String(nearOverdueContracts), route: `${APP_ROUTES.CONTRACTS}?due=7d` },
      { id: "boss-high-risk-project", title: "\u9AD8\u98CE\u9669\u9879\u76EE", value: String(highRiskProjects), route: `${APP_ROUTES.PROJECTS}?risk=high` },
      { id: "boss-overdue-receivable", title: "\u5E94\u6536\u8D85\u671F\u6E05\u5355", value: String(overdueReceivableCount), route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: "boss-customer-churn", title: "\u5BA2\u6237\u6D41\u5931\u9884\u8B66", value: String(churnCustomers), route: `${APP_ROUTES.CUSTOMERS}?filter=churn` }
    ],
    bottomCards: [
      { id: "boss-capacity", title: "\u4EBA\u5747\u5728\u5236\u9879\u76EE\u6570", value: avgInProgress.toFixed(2), route: `${APP_ROUTES.PROJECTS}?view=team` },
      { id: "boss-delay-rate", title: "\u9879\u76EE\u5EF6\u8BEF\u7387", value: pct(delayedRate), route: `${APP_ROUTES.PROJECTS}?filter=delay` },
      { id: "boss-log-coverage", title: "\u672C\u5468\u65E5\u5FD7\u8986\u76D6\u7387", value: pct(logCoverage), route: `${APP_ROUTES.PROJECTS}?tab=logs` }
    ],
    listItems: topRiskList
  };
};
var buildSalesMetrics = (inputs, monthKey) => {
  const now = nowDate();
  const me = String(inputs.currentUser.name || "");
  const myLeadSet = inputs.leads.filter(
    (lead) => (lead.followUpRecords || []).some((r) => String(r.operator || "") === me) || String(lead.name || "") === me
  );
  const myLeadIds = new Set(myLeadSet.map((l) => l.id));
  const myMonthLeads = myLeadSet.filter((l) => isLeadInMonth(l, monthKey)).length;
  const myFollowups = [
    ...inputs.leads.flatMap((l) => l.followUpRecords || []),
    ...inputs.customers.flatMap((c) => c.followUpRecords || [])
  ].filter((f) => String(f.operator || "") === me && inMonth(f.date, monthKey)).length;
  const myContracts = inputs.contracts.filter((c) => {
    const owner = String(c.owner || "").trim();
    if (owner) return owner === me;
    const linked = inputs.projects.find((p) => p.contractRef === c.id || p.contractRef === c.contractNo);
    return linked ? String(linked.manager || "") === me : false;
  });
  const myMonthSignedAmount = myContracts.filter((c) => inMonth(c.signDate, monthKey)).reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const myMonthLeadRevenueProjects = inputs.projects.filter((p) => {
    if (!isLeadSourcedRevenueProject(p)) return false;
    if (projectCompleteMonthKey(p) !== monthKey) return false;
    const leadId = resolveLeadIdFromProject(p);
    if (leadId && myLeadIds.has(leadId)) return true;
    return String(p.manager || "") === me;
  });
  const personalConversionRate = myMonthLeads > 0 ? myMonthLeadRevenueProjects.length / myMonthLeads : 0;
  const staleLeads = myLeadSet.filter((l) => diffDays(l.lastContact, now) < -7);
  const hotLeads = myLeadSet.filter((l) => l.intent === "High" && l.status !== "Converted" /* Converted */).slice(0, 5);
  const sleepingCustomers = inputs.customers.filter((c) => {
    const last = (c.followUpRecords || []).filter((r) => String(r.operator || "") === me).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!last) return false;
    return diffDays(last.date, now) < -30;
  });
  const repurchaseCustomers = inputs.customers.filter((c) => Number(c.serviceCount || 0) >= 2 || Number(c.cooperationCount || 0) >= 2);
  const expiringContracts = myContracts.filter(
    (c) => (c.receivables || []).some((r) => r.status !== "paid" && diffDays(r.dueDate, now) >= 0 && diffDays(r.dueDate, now) <= 15)
  );
  const todayActionList = [
    ...hotLeads.slice(0, 3).map((l) => ({
      id: `sales-hot-${l.id}`,
      title: `\u4ECA\u65E5\u4F18\u5148\u8054\u7CFB\uFF1A${l.company}`,
      subtitle: `\u610F\u5411${l.intent} \xB7 \u6700\u8FD1\u8054\u7CFB ${l.lastContact || "\u672A\u77E5"}`,
      route: `${APP_ROUTES.LEADS}?owner=me&leadId=${encodeURIComponent(l.id)}`
    })),
    ...staleLeads.slice(0, 2).map((l) => ({
      id: `sales-stale-${l.id}`,
      title: `\u8D85\u8FC77\u5929\u672A\u8DDF\u8FDB\uFF1A${l.company}`,
      subtitle: `\u6700\u540E\u8054\u7CFB ${l.lastContact || "\u672A\u77E5"}`,
      route: `${APP_ROUTES.LEADS}?owner=me&stale=7d&leadId=${encodeURIComponent(l.id)}`
    })),
    ...myContracts.filter((c) => c.status === "Pending" /* Pending */ || (c.receivables || []).every((r) => r.status !== "paid")).slice(0, 2).map((c) => ({
      id: `sales-contract-${c.id}`,
      title: `\u5F85\u7B7E/\u5F85\u63A8\u8FDB\u5408\u540C\uFF1A${c.customerName}`,
      subtitle: `${money(Number(c.amount || 0))} \xB7 ${c.contractNo || c.title}`,
      route: `${APP_ROUTES.CONTRACTS}?owner=me&contractId=${encodeURIComponent(c.id)}`
    }))
  ].slice(0, 8);
  return {
    topCards: [
      { id: "sales-new-leads", title: "\u672C\u6708\u65B0\u589E\u7EBF\u7D22", value: String(myMonthLeads), route: `${APP_ROUTES.LEADS}?owner=me&month=this` },
      { id: "sales-followups", title: "\u672C\u6708\u6709\u6548\u8DDF\u8FDB\u6B21\u6570", value: String(myFollowups), route: `${APP_ROUTES.CUSTOMERS}?owner=me&tab=followups` },
      { id: "sales-sign-amt", title: "\u672C\u6708\u7B7E\u7EA6\u91D1\u989D", value: money(myMonthSignedAmount), route: `${APP_ROUTES.CONTRACTS}?owner=me&month=this` },
      { id: "sales-conversion", title: "\u4E2A\u4EBA\u8F6C\u5316\u7387\uFF08\u7EBF\u7D22\u2192\u8425\u6536\u9879\u76EE\uFF09", value: pct(personalConversionRate), route: `${APP_ROUTES.LEADS}?owner=me&filter=conversion` }
    ],
    middleCards: [
      { id: "sales-hot", title: "\u5373\u5C06\u6210\u4EA4\u5BA2\u6237", value: String(hotLeads.length), route: `${APP_ROUTES.LEADS}?owner=me&intent=high` },
      { id: "sales-stale", title: "\u8D85\u8FC77\u5929\u672A\u8DDF\u8FDB", value: String(staleLeads.length), route: `${APP_ROUTES.LEADS}?owner=me&stale=7d` },
      { id: "sales-sleeping", title: "\u6C89\u7761\u5BA2\u6237\uFF0830\u5929\uFF09", value: String(sleepingCustomers.length), route: `${APP_ROUTES.CUSTOMERS}?owner=me&filter=sleeping30` },
      { id: "sales-repeat", title: "\u53EF\u590D\u8D2D\u5BA2\u6237", value: String(repurchaseCustomers.length), route: `${APP_ROUTES.CUSTOMERS}?owner=me&filter=repurchase` },
      { id: "sales-expiring", title: "\u5408\u540C\u5373\u5C06\u5230\u671F", value: String(expiringContracts.length), route: `${APP_ROUTES.CONTRACTS}?owner=me&due=15d` }
    ],
    bottomCards: [
      { id: "sales-today-contact", title: "\u4ECA\u65E5\u5FC5\u987B\u8054\u7CFB\u5BA2\u6237", value: String(hotLeads.length), route: `${APP_ROUTES.LEADS}?owner=me&today=contact` },
      { id: "sales-pending-quote", title: "\u5F85\u62A5\u4EF7\u5BA2\u6237", value: String(myLeadSet.filter((l) => l.status === "Pending" /* Pending */).length), route: `${APP_ROUTES.LEADS}?owner=me&status=pending` },
      { id: "sales-pending-sign", title: "\u5F85\u7B7E\u5408\u540C", value: String(myContracts.filter((c) => c.status === "Pending" /* Pending */).length), route: `${APP_ROUTES.CONTRACTS}?owner=me&status=pending` }
    ],
    listItems: todayActionList
  };
};
var buildConsultantMetrics = (inputs) => {
  const now = nowDate();
  const me = String(inputs.currentUser.name || "");
  const myProjects = inputs.projects.filter((p) => projectIsMine(p, me));
  const myActiveProjects = myProjects.filter((p) => p.status === "Active" /* Active */);
  const myTaskPairs = myProjects.flatMap((project) => (project.tasks || []).map((task) => ({ project, task }))).filter(({ task }) => taskOwner(task, me));
  const myOpenTasks = myTaskPairs.filter(({ task }) => task.status !== "Completed");
  const myOverdueTasks = myOpenTasks.filter(({ task }) => diffDays(task.deadline, now) < 0);
  const myDueSoonTasks = myOpenTasks.filter(({ task }) => diffDays(task.deadline, now) >= 0 && diffDays(task.deadline, now) <= 7);
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - 6);
  const myWeekLogs = inputs.projectWorkLogs.filter((log) => String(log.operatorName || "") === me && parseDate(log.logDate) >= thisWeekStart.getTime());
  const weekCompletedTasks = myWeekLogs.filter((log) => log.source === "task_transition").length;
  const weekHours = myWeekLogs.reduce((acc, log) => acc + Number(log.actualHours || 0), 0);
  const pendingCustomerConfirm = myOpenTasks.filter(({ task }) => /确认|回传|审核|签字|盖章/.test(String(task.title || ""))).length;
  const belowHalfProjects = myActiveProjects.filter((p) => Number(p.progress || 0) < 50);
  const projectTaskBucket = {};
  myOpenTasks.forEach(({ project }) => {
    projectTaskBucket[project.id] = (projectTaskBucket[project.id] || 0) + 1;
  });
  const mostStacked = Object.entries(projectTaskBucket).sort((a, b) => b[1] - a[1])[0];
  const mostStackedProject = mostStacked ? myProjects.find((p) => p.id === mostStacked[0]) : null;
  const listItems = myOverdueTasks.slice(0, 8).map(({ project, task }) => ({
    id: `consultant-overdue-${task.id}`,
    title: `\u903E\u671F\u4EFB\u52A1\uFF1A${task.title}`,
    subtitle: `${project.name} \xB7 \u622A\u6B62 ${task.deadline}`,
    route: `${APP_ROUTES.PROJECTS}?owner=me&task=overdue&projectId=${encodeURIComponent(project.id)}`
  }));
  return {
    topCards: [
      { id: "cons-active-project", title: "\u5F53\u524D\u5728\u5236\u9879\u76EE\u6570", value: String(myActiveProjects.length), route: `${APP_ROUTES.PROJECTS}?owner=me&status=active` },
      { id: "cons-overdue-task", title: "\u903E\u671F\u4EFB\u52A1\u6570", value: String(myOverdueTasks.length), route: `${APP_ROUTES.PROJECTS}?owner=me&task=overdue` },
      { id: "cons-week-completed", title: "\u672C\u5468\u5B8C\u6210\u4EFB\u52A1\u6570", value: String(weekCompletedTasks), route: `${APP_ROUTES.PROJECTS}?owner=me&task=completed&range=7d` },
      { id: "cons-customer-confirm", title: "\u5BA2\u6237\u5F85\u786E\u8BA4\u4E8B\u9879", value: String(pendingCustomerConfirm), route: `${APP_ROUTES.PROJECTS}?owner=me&task=customer_confirm` }
    ],
    middleCards: [
      { id: "cons-due-soon", title: "\u5373\u5C06\u5230\u671F\u4EFB\u52A1", value: String(myDueSoonTasks.length), route: `${APP_ROUTES.PROJECTS}?owner=me&task=due_7d` },
      { id: "cons-stacked-project", title: "\u4EFB\u52A1\u5806\u79EF\u6700\u591A\u9879\u76EE", value: mostStackedProject ? `${mostStackedProject.name}` : "\u6682\u65E0\u6570\u636E", route: `${APP_ROUTES.PROJECTS}?owner=me&focus=stacked` },
      { id: "cons-below-half", title: "\u670D\u52A1\u8FDB\u5EA6\u4F4E\u4E8E50%\u9879\u76EE", value: String(belowHalfProjects.length), route: `${APP_ROUTES.PROJECTS}?owner=me&progress=lt50` }
    ],
    bottomCards: [
      { id: "cons-week-logs", title: "\u672C\u5468\u65E5\u5FD7\u6761\u6570", value: String(myWeekLogs.length), route: `${APP_ROUTES.PROJECTS}?owner=me&tab=logs&range=7d` },
      { id: "cons-week-hours", title: "\u672C\u5468\u5DE5\u65F6\u7EDF\u8BA1", value: `${weekHours.toFixed(1)}h`, route: `${APP_ROUTES.PROJECTS}?owner=me&tab=logs&metric=hours` },
      { id: "cons-join-project", title: "\u53C2\u4E0E\u9879\u76EE\u6570", value: String(new Set(myWeekLogs.map((l) => l.projectId)).size), route: `${APP_ROUTES.PROJECTS}?owner=me` }
    ],
    listItems
  };
};
var buildFinanceMetrics = (inputs, monthKey) => {
  const now = nowDate();
  const receivables = inputs.contracts.flatMap((contract) => (contract.receivables || []).map((r) => ({
    contractId: contract.id,
    customerName: contract.customerName,
    amount: Number(r.amount || 0),
    dueDate: r.dueDate,
    status: r.status,
    contractAmount: Number(contract.amount || 0),
    contractNo: contract.contractNo || contract.title
  })));
  const monthReceivable = receivables.filter((r) => inMonth(r.dueDate, monthKey)).reduce((acc, r) => acc + r.amount, 0);
  const monthPaid = receivables.filter((r) => r.status === "paid" && inMonth(r.dueDate, monthKey)).reduce((acc, r) => acc + r.amount, 0);
  const overdueItems = receivables.filter((r) => r.status !== "paid" && diffDays(r.dueDate, now) < 0);
  const overdueAmount = overdueItems.reduce((acc, r) => acc + r.amount, 0);
  const expected30 = receivables.filter((r) => r.status !== "paid" && diffDays(r.dueDate, now) >= 0 && diffDays(r.dueDate, now) <= 30).reduce((acc, r) => acc + r.amount, 0);
  const missingContractAmountProjects = inputs.projects.filter((p) => p.projectCategory === "Delivery" && Number(p.projectAmount || 0) <= 0).length;
  const receivableWithoutContractAmount = inputs.contracts.filter((c) => Number(c.amount || 0) <= 0 && (c.receivables || []).some((r) => Number(r.amount || 0) > 0)).length;
  const uninvoiced = inputs.settlements.filter((s) => s.status === "draft").length;
  const abnormalProgress = inputs.contracts.filter((c) => {
    const total = Number(c.amount || 0);
    const paid = contractPaidAmount(c);
    const overdue = contractUnpaidOverdueAmount(c, now);
    if (total > 0 && paid > total) return true;
    return total > 0 && overdue / total > 0.5;
  }).length;
  const industryPaidMap = {};
  inputs.contracts.forEach((c) => {
    const customer = inputs.customers.find((x) => normalizeName(x.name) === normalizeName(c.customerName));
    const industry = String(customer?.industry || "\u672A\u5206\u7C7B");
    industryPaidMap[industry] = (industryPaidMap[industry] || 0) + contractPaidAmount(c);
  });
  const paidSum = Object.values(industryPaidMap).reduce((acc, val) => acc + val, 0);
  const topIndustry = Object.entries(industryPaidMap).sort((a, b) => b[1] - a[1])[0];
  const bigCustomerPaid = {};
  inputs.contracts.forEach((c) => {
    bigCustomerPaid[c.customerName] = (bigCustomerPaid[c.customerName] || 0) + contractPaidAmount(c);
  });
  const sortedCustomerPaid = Object.entries(bigCustomerPaid).sort((a, b) => b[1] - a[1]);
  const top1Ratio = paidSum > 0 && sortedCustomerPaid.length > 0 ? sortedCustomerPaid[0][1] / paidSum : 0;
  const top3 = sortedCustomerPaid.slice(0, 3).reduce((acc, [, value]) => acc + value, 0);
  const concentration = paidSum > 0 ? top3 / paidSum : 0;
  const listItems = overdueItems.slice(0, 8).map((item, idx) => ({
    id: `finance-overdue-${item.contractId}-${idx}`,
    title: `${item.customerName} \u8D85\u671F\u5E94\u6536`,
    subtitle: `${money(item.amount)} \xB7 \u5230\u671F ${item.dueDate || "\u672A\u77E5"}`,
    route: `${APP_ROUTES.FINANCE}?status=overdue&contractId=${encodeURIComponent(item.contractId)}`
  }));
  return {
    topCards: [
      { id: "fin-month-rec", title: "\u672C\u6708\u5E94\u6536", value: money(monthReceivable), route: `${APP_ROUTES.FINANCE}?month=this&view=receivable` },
      { id: "fin-month-paid", title: "\u672C\u6708\u5DF2\u6536", value: money(monthPaid), route: `${APP_ROUTES.FINANCE}?month=this&view=paid` },
      { id: "fin-overdue", title: "\u8D85\u671F\u91D1\u989D", value: money(overdueAmount), hint: `${overdueItems.length} \u5355`, route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: "fin-next30", title: "\u672A\u676530\u5929\u9884\u8BA1\u56DE\u6B3E", value: money(expected30), route: `${APP_ROUTES.FINANCE}?range=30d` }
    ],
    middleCards: [
      { id: "fin-missing-amt", title: "\u5408\u540C\u91D1\u989D\u7F3A\u5931\u9879\u76EE", value: String(missingContractAmountProjects), route: `${APP_ROUTES.PROJECTS}?filter=missing_contract_amount` },
      { id: "fin-rec-no-contract", title: "\u5B58\u5728\u56DE\u6B3E\u4F46\u65E0\u5408\u540C\u603B\u989D", value: String(receivableWithoutContractAmount), route: `${APP_ROUTES.FINANCE}?filter=no_contract_amount` },
      { id: "fin-uninvoiced", title: "\u672A\u5F00\u7968\u9879\u76EE", value: String(uninvoiced), route: `${APP_ROUTES.FINANCE}?filter=uninvoiced` },
      { id: "fin-abnormal", title: "\u56DE\u6B3E\u8FDB\u5EA6\u5F02\u5E38", value: String(abnormalProgress), route: `${APP_ROUTES.FINANCE}?filter=progress_abnormal` }
    ],
    bottomCards: [
      { id: "fin-industry", title: "\u56DE\u6B3E\u6765\u6E90\u884C\u4E1A\u5206\u5E03", value: topIndustry ? `${topIndustry[0]} ${pct(topIndustry[1] / Math.max(paidSum, 1))}` : "\u6682\u65E0\u6570\u636E", route: `${APP_ROUTES.FINANCE}?analysis=industry` },
      { id: "fin-big-customer", title: "\u5927\u5BA2\u6237\u5360\u6BD4", value: pct(top1Ratio), route: `${APP_ROUTES.FINANCE}?analysis=big_customer` },
      { id: "fin-concentration", title: "\u56DE\u6B3E\u96C6\u4E2D\u5EA6\uFF08Top3\uFF09", value: pct(concentration), route: `${APP_ROUTES.FINANCE}?analysis=concentration` }
    ],
    listItems
  };
};
var buildDashboardMetrics = (inputs) => {
  const monthKey = currentMonthKey();
  return {
    roleView: resolveDashboardRoleView(inputs.currentUser, inputs.activeRole),
    monthKey,
    boss: buildBossMetrics(inputs, monthKey),
    sales: buildSalesMetrics(inputs, monthKey),
    consultant: buildConsultantMetrics(inputs),
    finance: buildFinanceMetrics(inputs, monthKey)
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildDashboardMetrics
});
