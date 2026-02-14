
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Bell, TrendingUp, Briefcase, Check, Sparkles, Zap, ArrowRight, BrainCircuit, Target, AlertTriangle, Coins, CheckCircle, Activity } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Status } from '../types';
import { useNavigate } from 'react-router-dom';

const Dashboard = () => {
  const { projects, contracts, visibleReminders, aggregatedReminders, dismissReminder, activeRole, currentUser, marketSignals } = useApp();
  const navigate = useNavigate();

  const activeProjects = projects.filter(p => p.status === Status.Active).length;
  
  const now = new Date();

  const isBossView = activeRole === 'ADMIN';
  const [reminderView, setReminderView] = React.useState<'aggregated' | 'detail'>(isBossView ? 'aggregated' : 'detail');
  const [expandedAggId, setExpandedAggId] = React.useState<string | null>(null);
  const [detailScopeKey, setDetailScopeKey] = React.useState<string>('');
  const [detailSearch, setDetailSearch] = React.useState<string>('');
  const [detailGrouped, setDetailGrouped] = React.useState<boolean>(true);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    setReminderView(isBossView ? 'aggregated' : 'detail');
    setExpandedAggId(null);
    setDetailScopeKey('');
    setDetailSearch('');
    setCollapsedGroupKeys({});
  }, [isBossView]);

  const getScopeLabel = React.useCallback((scopeKey: string) => {
    const a = aggregatedReminders.find(x => `${x.linkType}:${x.linkId}` === scopeKey);
    if (a?.projectName && a?.customerName) return `客户【${a.customerName}】 · 项目【${a.projectName}】`;
    if (a?.projectName) return `项目【${a.projectName}】`;
    if (a?.customerName) return `客户【${a.customerName}】`;
    return scopeKey;
  }, [aggregatedReminders]);

  const detailReminders = React.useMemo(() => {
    let list = visibleReminders;
    if (detailScopeKey) {
      list = list.filter(r => `${r.linkType || ''}:${r.linkId || ''}` === detailScopeKey);
    }
    const q = detailSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(r => `${r.title || ''} ${r.content || ''}`.toLowerCase().includes(q));
    }
    return list;
  }, [visibleReminders, detailScopeKey, detailSearch]);

  const groupedDetail = React.useMemo(() => {
    const groups = new Map<string, typeof detailReminders>();
    for (const r of detailReminders) {
      const key = `${r.linkType || ''}:${r.linkId || ''}`;
      const prev = groups.get(key) || [];
      prev.push(r);
      groups.set(key, prev);
    }
    const order = aggregatedReminders
      .map(a => `${a.linkType}:${a.linkId}`)
      .filter(k => groups.has(k));
    const rest = Array.from(groups.keys()).filter(k => !order.includes(k));
    return [...order, ...rest].map(key => ({ key, label: getScopeLabel(key), items: groups.get(key) || [] }));
  }, [detailReminders, aggregatedReminders, getScopeLabel]);

  // 1. 进行中项目
  const runningProjects = projects.filter(p => p.status === Status.Active);

  // 2. 已逾期任务数
  const totalOverdueTasks = projects.flatMap(p => p.tasks || []).filter(t => t.status !== 'Completed' && new Date(t.deadline) < now).length;

  // 4. 任务堆最多的人
  const taskCounts: Record<string, number> = {};
  projects.flatMap(p => p.tasks || []).filter(t => t.status !== 'Completed').forEach(t => {
      taskCounts[t.owner] = (taskCounts[t.owner] || 0) + 1;
  });
  const busiestPerson = Object.entries(taskCounts).sort((a, b) => b[1] - a[1])[0] || ['无', 0];

  // Categorize reminders for briefing logic
  const risks = visibleReminders.filter(r => r.type === 'risk');
  const opportunities = visibleReminders.filter(r => r.type === 'opportunity');
  const expiring = visibleReminders.filter(r => r.type === 'expire');

  const strategicReminders = visibleReminders.filter(r => r.type === 'opportunity' || r.type === 'risk' || r.type === 'expire');

  const today = new Date().toISOString().split('T')[0];
  const intelToday = marketSignals.filter(s => s.publishedAt === today);
  const intelHigh = intelToday.filter(s => s.urgency === 'high' && s.status !== 'converted' && s.status !== 'ignored');

  const myProjects = projects.filter(p => p.manager === currentUser.name || (p.tasks || []).some(t => t.owner === currentUser.name));
  const myOpenTasks = projects.flatMap(p => (p.tasks || []).map(t => ({ project: p, task: t })))
    .filter(x => x.task.owner === currentUser.name && x.task.status !== 'Completed');

  const diffDays = (dateStr: string) => {
    const deadline = new Date(dateStr);
    return Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 3600 * 24));
  };
  const dueSoonTasks = projects.flatMap(p => (p.tasks || []).map(t => ({ project: p, task: t })))
    .filter(x => x.task.status !== 'Completed')
    .filter(x => diffDays(x.task.deadline) <= 7 && diffDays(x.task.deadline) >= 0);
  const overdueTasks = projects.flatMap(p => (p.tasks || []).map(t => ({ project: p, task: t })))
    .filter(x => x.task.status !== 'Completed')
    .filter(x => diffDays(x.task.deadline) < 0);

  const receivables = contracts.flatMap(c => (c.receivables || []).map(r => ({
    contractId: c.id,
    customerName: c.customerName,
    node: r.node,
    amount: r.amount,
    dueDate: r.dueDate,
    status: r.status
  })));
  const unpaidReceivables = receivables.filter(r => r.status !== 'paid');
  const overdueReceivables = unpaidReceivables.filter(r => diffDays(r.dueDate) < 0);
  const sumAmount = (items: { amount: number }[]) => items.reduce((acc, x) => acc + (x.amount || 0), 0);

  const monthKeyFromDate = (d: string) => String(d || '').slice(0, 7);
  const buildMonthKeys = (count: number) => {
    const keys: string[] = [];
    const cursor = new Date(now);
    cursor.setDate(1);
    for (let i = 0; i < count; i++) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      keys.unshift(`${y}-${m}`);
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return keys;
  };
  const monthKeys = buildMonthKeys(7);
  const paidByMonth: Record<string, number> = {};
  receivables
    .filter(r => r.status === 'paid')
    .forEach(r => {
      const key = monthKeyFromDate(r.dueDate);
      if (!key) return;
      paidByMonth[key] = (paidByMonth[key] || 0) + (Number(r.amount) || 0);
    });
  const dataRevenue = monthKeys.map(key => {
    const m = Number(key.split('-')[1] || 0);
    return { key, name: `${m}月`, revenue: paidByMonth[key] || 0 };
  });

  const needsAttentionProject = React.useMemo(() => {
    const overdueCountForProject = (p: any) => (p.tasks || []).filter((t: any) => t.status !== 'Completed' && new Date(t.deadline) < now).length;
    const dueSoonCountForProject = (p: any) => (p.tasks || []).filter((t: any) => t.status !== 'Completed' && diffDays(t.deadline) >= 0 && diffDays(t.deadline) <= 7).length;
    const openCountForProject = (p: any) => (p.tasks || []).filter((t: any) => t.status !== 'Completed').length;
    return runningProjects
      .slice()
      .sort((a, b) => {
        const ao = overdueCountForProject(a);
        const bo = overdueCountForProject(b);
        if (ao !== bo) return bo - ao;
        const ad = dueSoonCountForProject(a);
        const bd = dueSoonCountForProject(b);
        if (ad !== bd) return bd - ad;
        return openCountForProject(b) - openCountForProject(a);
      })[0];
  }, [runningProjects]);

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      {/* KPI Stats Cards (Boss View 4 Metrics) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <button
          className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group text-left"
          onClick={() => navigate('/projects')}
          title="跳转到项目管理"
        >
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">正在进行项目</p>
              <h3 className="text-2xl font-black text-gray-900 mt-1">{runningProjects.length}</h3>
              <div className="flex items-center text-xs mt-2 font-bold text-green-500">
                <TrendingUp className="w-3 h-3 mr-1" /> 正常运转
              </div>
            </div>
            <div className="p-4 bg-green-50 rounded-2xl group-hover:scale-110 transition-transform">
              <Briefcase className="w-6 h-6 text-green-600" />
            </div>
        </button>
        
        <button
          className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group text-left"
          onClick={() => navigate('/projects', { state: { dashboardFocus: { type: 'overdue_tasks' } } })}
          title="跳转到项目管理并定位逾期任务"
        >
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">已逾期任务</p>
              <h3 className="text-2xl font-black text-red-600 mt-1">{totalOverdueTasks}</h3>
              <div className="flex items-center text-xs mt-2 font-bold text-red-400">
                <AlertTriangle className="w-3 h-3 mr-1" /> 需立即介入
              </div>
            </div>
            <div className="p-4 bg-red-50 rounded-2xl group-hover:scale-110 transition-transform">
              <Bell className="w-6 h-6 text-red-600" />
            </div>
        </button>

        <button
          className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group text-left"
          onClick={() => {
            if (needsAttentionProject?.id) navigate('/projects', { state: { openDetailId: needsAttentionProject.id } });
            else navigate('/projects');
          }}
          title="跳转到需要关注的项目"
        >
            <div className="overflow-hidden">
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">需关注项目</p>
              <h3 className="text-lg font-black text-gray-900 mt-1 truncate" title={needsAttentionProject?.name || '无'}>
                {needsAttentionProject?.name || '暂无异常'}
              </h3>
              <div className="flex items-center text-xs mt-2 font-bold text-amber-500">
                <Activity className="w-3 h-3 mr-1" /> {needsAttentionProject ? '优先介入' : '状态良好'}
              </div>
            </div>
            <div className="p-4 bg-amber-50 rounded-2xl group-hover:scale-110 transition-transform shrink-0">
              <Zap className="w-6 h-6 text-amber-600" />
            </div>
        </button>

        <button
          className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group text-left"
          onClick={() => navigate('/projects', { state: { dashboardFocus: { type: 'busiest_owner', owner: busiestPerson[0] } } })}
          title="跳转到项目管理并查看该负责人任务"
        >
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">任务堆积最多</p>
              <h3 className="text-xl font-black text-indigo-600 mt-1">{busiestPerson[0]}</h3>
              <div className="flex items-center text-xs mt-2 font-bold text-indigo-400">
                <BrainCircuit className="w-3 h-3 mr-1" /> 积压 {busiestPerson[1]} 个任务
              </div>
            </div>
            <div className="p-4 bg-indigo-50 rounded-2xl group-hover:scale-110 transition-transform">
              <Sparkles className="w-6 h-6 text-indigo-600" />
            </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: AI Brief & Chart */}
        <div className="lg:col-span-2 space-y-6">
            {/* AI Briefing - Dynamic Insights Area */}
            <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-2xl shadow-sm border border-indigo-100 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5">
                    <Sparkles className="w-48 h-48 text-indigo-600" />
                </div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-indigo-900 flex items-center">
                        <Zap className="w-5 h-5 mr-2 text-yellow-500 animate-pulse" />
                        AI 智能全域简报 (MORNING BRIEF)
                    </h3>
                    <div className="flex space-x-2">
                         <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded shadow-sm font-bold">Kimi K2.5 驱动</span>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Insights Block 1: Opportunities */}
                    <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-indigo-100 flex items-start space-x-3 group cursor-pointer hover:border-blue-400 transition-colors" onClick={()=>navigate('/customers')}>
                        <div className="bg-blue-100 p-2 rounded-lg text-blue-600"><Target className="w-4 h-4" /></div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900">线索商机洞察</p>
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                                {opportunities.length > 0 
                                  ? `AI 检测到 ${opportunities.length} 个潜在增购增长点。重点关注：【${opportunities[0].title.split('：')[1] || '待跟进项目'}】等。`
                                  : "当前暂无新增商机匹配，建议执行全域巡检以挖掘老客户二次开发潜力。"}
                            </p>
                        </div>
                    </div>
                    {/* Insights Block 2: Risks */}
                    <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-red-100 flex items-start space-x-3 group cursor-pointer hover:border-red-400 transition-colors" onClick={()=>navigate('/projects')}>
                        <div className="bg-red-100 p-2 rounded-lg text-red-600"><AlertTriangle className="w-4 h-4" /></div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900">交付与合规风险</p>
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                                {risks.length > 0
                                  ? `警告：系统内存在 ${risks.length} 项重大风险预警。建议优先处理【${risks[0].title}】等关键卡点。`
                                  : "交付链路处于极佳状态，所有项目节点均在绿灯区。"}
                            </p>
                        </div>
                    </div>
                    {/* Insights Block 3: Intel Radar */}
                    <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-emerald-100 flex items-start space-x-3 group cursor-pointer hover:border-emerald-400 transition-colors" onClick={()=>navigate('/intel')}>
                        <div className="bg-emerald-100 p-2 rounded-lg text-emerald-700"><Sparkles className="w-4 h-4" /></div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900">情报雷达（今日）</p>
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                                {intelToday.length > 0
                                  ? `今日新增 ${intelToday.length} 条情报，高紧急 ${intelHigh.length} 条。点击进入一键转化为跟进项目。`
                                  : "暂无今日情报。进入情报雷达抓取最新政策/行业/企业动态。"}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center">
                        <TrendingUp className="w-5 h-5 mr-2 text-blue-500" />
                        月度回款趋势（已核销）
                    </h3>
                    <button
                      className="text-xs font-black text-indigo-600 hover:text-indigo-700"
                      onClick={() => navigate('/finance', { state: { filterStatus: 'paid' } })}
                      title="查看回款明细"
                    >
                      查看回款 <ArrowRight className="w-3.5 h-3.5 inline-block ml-1" />
                    </button>
                </div>
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={dataRevenue}
                      onClick={(e: any) => {
                        const key = e?.activePayload?.[0]?.payload?.key;
                        if (!key) return;
                        navigate('/finance', { state: { filterStatus: 'paid', filterMonth: key } });
                      }}
                    >
                        <defs>
                            <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#9ca3af'}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#9ca3af'}} />
                        <Tooltip />
                        <Area type="monotone" dataKey="revenue" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                    </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>

        {/* Right: Task Box - Detailed Actionables */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
            <div className="p-6 border-b border-gray-100 bg-gray-50/30">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center">
                        任务提醒箱
                    </h3>
                    <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] rounded-md font-bold animate-pulse">
                        {(reminderView === 'aggregated' ? aggregatedReminders.length : detailReminders.length)}
                    </span>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                    <p className="text-xs text-gray-400 uppercase tracking-tight">
                        {reminderView === 'aggregated' ? '按对象聚合：先看哪些项目/客户有问题' : '原子化动作：逐条处理并可标记完成'}
                    </p>
                    <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm w-full">
                        <button
                            onClick={() => setReminderView('aggregated')}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${reminderView === 'aggregated' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                            聚合视图
                        </button>
                        <button
                            onClick={() => setReminderView('detail')}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${reminderView === 'detail' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                            明细视图
                        </button>
                    </div>

                    {reminderView === 'detail' && (
                        <div className="space-y-2">
                            <div className="flex flex-col md:flex-row md:items-center gap-2">
                                <select
                                    className="w-full md:w-auto bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
                                    value={detailScopeKey}
                                    onChange={(e) => {
                                        setDetailScopeKey(e.target.value);
                                        setCollapsedGroupKeys({});
                                    }}
                                >
                                    <option value="">全部对象</option>
                                    {aggregatedReminders.map(a => (
                                        <option key={a.id} value={`${a.linkType}:${a.linkId}`}>
                                            {a.projectName ? `项目：${a.projectName}` : a.customerName ? `客户：${a.customerName}` : `${a.linkType}:${a.linkId}`}（{a.count}）
                                        </option>
                                    ))}
                                </select>

                                <input
                                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
                                    placeholder="搜索提醒关键词…"
                                    value={detailSearch}
                                    onChange={(e) => setDetailSearch(e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                                        <button
                                            onClick={() => setDetailGrouped(true)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${detailGrouped ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                                        >
                                            分组
                                        </button>
                                        <button
                                            onClick={() => setDetailGrouped(false)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${!detailGrouped ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                                        >
                                            平铺
                                        </button>
                                    </div>
                                </div>

                                {detailScopeKey && (
                                    <div className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                                        <span className="text-xs font-bold text-gray-700 truncate">{getScopeLabel(detailScopeKey)}</span>
                                        <button
                                            className="text-xs font-bold text-gray-500 hover:text-gray-800"
                                            onClick={() => {
                                                setDetailScopeKey('');
                                                setCollapsedGroupKeys({});
                                            }}
                                        >
                                            清除
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[600px] custom-scrollbar">
                {reminderView === 'aggregated' && aggregatedReminders.map(a => (
                    <div
                        key={a.id}
                        className={`group p-4 rounded-xl border-l-4 transition-all hover:translate-x-1 cursor-pointer bg-white border border-gray-100 shadow-sm ${
                            a.severity === 'high' ? 'border-l-red-500' : a.severity === 'medium' ? 'border-l-amber-500' : 'border-l-indigo-500'
                        }`}
                        onClick={() => {
                            if (a.linkType === 'customer') navigate('/customers', { state: { openDetailId: a.linkId } });
                            else if (a.linkType === 'lead') navigate('/leads', { state: { openDetailId: a.linkId } });
                            else if (a.linkType === 'contract') navigate('/contracts', { state: { openDetailId: a.linkId } });
                            else if (a.linkType === 'project') navigate('/projects', { state: { openDetailId: a.linkId } });
                        }}
                    >
                        <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2">
                                    <span className={`text-[10px] font-extrabold uppercase ${
                                        a.severity === 'high' ? 'text-red-500' : a.severity === 'medium' ? 'text-amber-500' : 'text-indigo-500'
                                    }`}>
                                        {a.severity === 'high' ? '🚨 严重风险' : a.severity === 'medium' ? '⚠️ 风险提示' : '💡 机会/到期'}
                                    </span>
                                    <span className="text-gray-300 text-[10px]">•</span>
                                    <span className="text-[10px] text-gray-400">{a.latestDate || '-'}</span>
                                    <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-black bg-gray-50 text-gray-500">
                                        {a.count} 条
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setReminderView('detail');
                                            setDetailScopeKey(`${a.linkType}:${a.linkId}`);
                                            setDetailSearch('');
                                            setCollapsedGroupKeys({});
                                        }}
                                        className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                                        title="只看该对象的全部明细"
                                    >
                                        查看全部
                                    </button>
                                </div>
                                <p className="text-sm font-bold text-gray-900 mt-1 group-hover:text-blue-700 transition-colors truncate">
                                    {a.mainScene}
                                </p>
                                <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">
                                    {(a.customerName ? `客户【${a.customerName}】` : '') + (a.projectName ? ` · 项目【${a.projectName}】` : '')}
                                </p>
                                {a.tags.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {a.tags.slice(0, 4).map(t => (
                                            <span key={t} className="px-2 py-0.5 bg-gray-50 text-gray-500 text-[10px] rounded-full font-bold">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {expandedAggId === a.id && (
                                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                                        {a.samples.map(r => (
                                            <div
                                                key={r.id}
                                                className="p-3 rounded-lg bg-gray-50/60 border border-gray-100 hover:bg-gray-50 transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (r.linkType === 'customer') navigate('/customers', { state: { openDetailId: r.linkId } });
                                                    else if (r.linkType === 'lead') navigate('/leads', { state: { openDetailId: r.linkId } });
                                                    else if (r.linkType === 'contract') navigate('/contracts', { state: { openDetailId: r.linkId } });
                                                    else if (r.linkType === 'project') navigate('/projects', { state: { openDetailId: r.linkId } });
                                                }}
                                            >
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-bold text-gray-800 truncate">{r.title}</p>
                                                        <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{r.content}</p>
                                                    </div>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); dismissReminder(r.id); }}
                                                        className="p-1.5 bg-white rounded-lg shadow-sm text-gray-400 hover:text-green-600 hover:bg-green-50 transition-all"
                                                        title="标记完成"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); setExpandedAggId(expandedAggId === a.id ? null : a.id); }}
                                className="opacity-100 p-1.5 bg-gray-50 rounded-lg shadow-sm text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all ml-2"
                                title={expandedAggId === a.id ? '收起明细' : '查看明细'}
                            >
                                <Bell className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}

                {reminderView === 'detail' && !detailGrouped && detailReminders.map(r => (
                    <div 
                        key={r.id} 
                        className={`group p-4 rounded-xl border-l-4 transition-all hover:translate-x-1 cursor-pointer bg-white border border-gray-100 shadow-sm ${
                            r.type === 'risk' ? 'border-l-red-500' : 
                            r.type === 'opportunity' ? 'border-l-indigo-500' : 
                            'border-l-amber-500'
                        }`}
                        title={r.content}
                        onClick={() => {
                            if (r.linkType === 'customer') navigate('/customers', { state: { openDetailId: r.linkId } });
                            else if (r.linkType === 'lead') navigate('/leads', { state: { openDetailId: r.linkId } });
                            else if (r.linkType === 'contract') navigate('/contracts', { state: { openDetailId: r.linkId } });
                            else if (r.linkType === 'project') navigate('/projects', { state: { openDetailId: r.linkId } });
                        }}
                    >
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                    <span className={`text-[10px] font-extrabold uppercase ${
                                      r.type === 'risk' ? 'text-red-500' : r.type === 'opportunity' ? 'text-indigo-500' : 'text-amber-500'
                                    }`}>
                                        {r.type === 'risk' ? '⚠️ 紧急风险' : r.type === 'opportunity' ? '💡 增购动作' : '📅 常规待办'}
                                    </span>
                                    <span className="text-gray-300 text-[10px]">•</span>
                                    <span className="text-[10px] text-gray-400">{r.date}</span>
                                </div>
                                <p className="text-sm font-bold text-gray-900 mt-1 group-hover:text-blue-700 transition-colors">{r.title}</p>
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{r.content}</p>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); dismissReminder(r.id); }}
                                className="opacity-0 group-hover:opacity-100 p-1.5 bg-gray-50 rounded-lg shadow-sm text-gray-400 hover:text-green-600 hover:bg-green-50 transition-all ml-2"
                                title="标记完成"
                            >
                                <Check className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}

                {reminderView === 'detail' && detailGrouped && groupedDetail.map(g => (
                    <div key={g.key} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                        <button
                            className="w-full px-4 py-3 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between"
                            onClick={() => setCollapsedGroupKeys(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
                            title={g.label}
                        >
                            <div className="min-w-0 text-left">
                                <p className="text-xs font-black text-gray-800 truncate">{g.label}</p>
                                <p className="text-[10px] text-gray-400 mt-1">{g.items.length} 条</p>
                            </div>
                            <span className="text-xs font-black text-gray-400">{collapsedGroupKeys[g.key] ? '展开' : '收起'}</span>
                        </button>
                        {!collapsedGroupKeys[g.key] && (
                            <div className="p-3 space-y-2">
                                {g.items.map(r => (
                                    <div 
                                        key={r.id} 
                                        className={`group p-4 rounded-xl border-l-4 transition-all hover:translate-x-1 cursor-pointer bg-white border border-gray-100 ${
                                            r.type === 'risk' ? 'border-l-red-500' : 
                                            r.type === 'opportunity' ? 'border-l-indigo-500' : 
                                            'border-l-amber-500'
                                        }`}
                                        title={r.content}
                                        onClick={() => {
                                            if (r.linkType === 'customer') navigate('/customers', { state: { openDetailId: r.linkId } });
                                            else if (r.linkType === 'lead') navigate('/leads', { state: { openDetailId: r.linkId } });
                                            else if (r.linkType === 'contract') navigate('/contracts', { state: { openDetailId: r.linkId } });
                                            else if (r.linkType === 'project') navigate('/projects', { state: { openDetailId: r.linkId } });
                                        }}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="flex items-center space-x-2">
                                                    <span className={`text-[10px] font-extrabold uppercase ${
                                                      r.type === 'risk' ? 'text-red-500' : r.type === 'opportunity' ? 'text-indigo-500' : 'text-amber-500'
                                                    }`}>
                                                        {r.type === 'risk' ? '⚠️ 紧急风险' : r.type === 'opportunity' ? '💡 增购动作' : '📅 常规待办'}
                                                    </span>
                                                    <span className="text-gray-300 text-[10px]">•</span>
                                                    <span className="text-[10px] text-gray-400">{r.date}</span>
                                                </div>
                                                <p className="text-sm font-bold text-gray-900 mt-1 group-hover:text-blue-700 transition-colors">{r.title}</p>
                                                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{r.content}</p>
                                            </div>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); dismissReminder(r.id); }}
                                                className="opacity-0 group-hover:opacity-100 p-1.5 bg-gray-50 rounded-lg shadow-sm text-gray-400 hover:text-green-600 hover:bg-green-50 transition-all ml-2"
                                                title="标记完成"
                                            >
                                                <Check className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                
                {reminderView === 'detail' && detailReminders.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full py-20 text-center opacity-40">
                        <CheckCircle className="w-12 h-12 text-gray-300 mb-3" />
                        <p className="text-gray-400 text-sm font-medium">恭喜！暂无待办任务</p>
                    </div>
                )}

                {reminderView === 'aggregated' && aggregatedReminders.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full py-20 text-center opacity-40">
                        <CheckCircle className="w-12 h-12 text-gray-300 mb-3" />
                        <p className="text-gray-400 text-sm font-medium">恭喜！暂无待处理对象</p>
                    </div>
                )}
            </div>
            
            <div className="p-4 bg-gray-50/50 border-t border-gray-100">
                <button onClick={()=>navigate('/audit')} className="w-full py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center shadow-sm">
                    进入全量审计中心 <ArrowRight className="w-3 h-3 ml-2" />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
