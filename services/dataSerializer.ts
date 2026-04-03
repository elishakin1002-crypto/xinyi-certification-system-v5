
import { Lead, Customer, Contract, Project, AuditIssue, Status } from '../types';
import { inferProjectMeta } from '../src/utils/projectCapabilities';

/**
 * Data Serializer for AI Context
 * 
 * 核心目标：
 * 1. 减重 (Reduction): 去除 UI 状态字段、冗余描述、非业务字段。
 * 2. 聚合 (Aggregation): 预先计算部分统计值（如总额、转化率），减少 AI 数学计算错误的概率。
 * 3. 脱敏 (Sanitization): 确保 PII（如手机号）不直接发送，尽管我们在企业级环境，这也是最佳实践。
 * 4. 截断 (Truncation): 限制数组长度，优先保留最近发生的记录（Recency Bias）。
 */

export const serializeWorldState = (
    leads: Lead[],
    customers: Customer[],
    contracts: Contract[],
    projects: Project[],
    auditIssues: AuditIssue[]
) => {
    const isRevenueProject = (project: Project): boolean => {
        const meta = inferProjectMeta(project);
        if (meta.projectMode !== 'delivery') return false;
        if (project.status !== Status.Completed) return false;
        if ((project as any).isRevenueProject === false) return false;
        return true;
    };

    const isLeadSourcedRevenueProject = (project: Project): boolean => {
        if (!isRevenueProject(project)) return false;
        const meta = inferProjectMeta(project);
        return meta.sourceType === 'lead';
    };

    // 1. Leads Snapshot (Focus on conversion & source)
    const leadToRevenueConversionRate = leads.length > 0
        ? (projects.filter(isLeadSourcedRevenueProject).length / leads.length)
        : 0;
    const leadsSummary = {
        total: leads.length,
        conversionRate: leadToRevenueConversionRate.toFixed(2),
        activeLeads: leads
            .filter(l => l.status === Status.New || l.status === Status.Pending)
            .sort((a, b) => new Date(b.lastContact).getTime() - new Date(a.lastContact).getTime())
            .slice(0, 30) // Take top 30 active leads
            .map(l => ({
                industry: l.industry || 'Unknown',
                source: l.source,
                score: l.score,
                intent: l.intent,
                target: l.targetCertifications
            })),
        lostReasons: leads
            .filter(l => l.status === Status.Lost)
            .slice(0, 20)
            .map(l => l.followUpRecords?.[0]?.content || 'Unknown Reason') // Assume last followup has reason
    };

    // 2. Customers Snapshot (Focus on industry distribution & value)
    const customersSummary = {
        total: customers.length,
        industryDist: customers.reduce((acc, c) => {
            const ind = c.industry || 'Other';
            acc[ind] = (acc[ind] || 0) + 1;
            return acc;
        }, {} as Record<string, number>),
        highValueClients: customers
            .filter(c => c.totalValue > 50000)
            .map(c => ({ industry: c.industry, value: c.totalValue, risk: c.riskStatus })),
        riskClients: customers
            .filter(c => c.riskStatus === 'high' || c.riskStatus === 'medium')
            .map(c => ({ industry: c.industry, reason: 'Risk Flagged' }))
    };

    // 3. Contracts & Finance (Focus on Cash Flow & Delays)
    const contractsSummary = {
        activeCount: contracts.filter(c => c.status === Status.Active).length,
        totalPendingAmount: contracts
            .flatMap(c => c.receivables)
            .filter(r => r.status !== 'paid')
            .reduce((sum, r) => sum + r.amount, 0),
        overdueCount: contracts
            .flatMap(c => c.receivables)
            .filter(r => r.status === 'overdue').length,
        recentWins: contracts
            .slice(0, 10)
            .map(c => ({ service: c.serviceLine, amount: c.amount, month: c.signDate.substring(0, 7) }))
    };

    // 4. Delivery Quality (Audit Issues)
    const qualitySummary = {
        openIssues: auditIssues.filter(i => i.status !== 'Closed').length,
        majorIssues: auditIssues.filter(i => i.severity === 'Major').length,
        commonFindings: auditIssues
            .slice(0, 15)
            .map(i => i.findings.substring(0, 50)) // Truncate long text
    };

    // 5. Projects
    const deliverySummary = {
        avgProgress: projects.length > 0 
            ? (projects.reduce((acc, p) => acc + p.progress, 0) / projects.length).toFixed(0) 
            : 0,
        delayedProjects: projects.filter(p => {
            const deadline = new Date(p.deadline).getTime();
            const now = Date.now();
            return deadline < now && p.progress < 100;
        }).length
    };

    return {
        context: "Enterprise Strategy Analysis",
        timestamp: new Date().toISOString().split('T')[0],
        data: {
            market: leadsSummary,
            clientBase: customersSummary,
            finance: contractsSummary,
            quality: qualitySummary,
            delivery: deliverySummary
        }
    };
};
