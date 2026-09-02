import React, { useEffect, useMemo, useState } from 'react';
import { 
  Target, 
  TrendingUp, 
  ShieldAlert, 
  Zap, 
  LayoutGrid, 
  Crosshair,
  BrainCircuit,
  Loader2,
  RefreshCw,
  Box,
  BarChart as BarChartIcon,
  CheckCircle2,
  Clock,
  Circle,
  Plus,
  Trash2,
  MoreHorizontal,
  CalendarCheck
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { StrategicTask } from '../types';
import { useLocation } from 'react-router-dom';
import MonthlyReview from '../components/MonthlyReview';
import { MonthlyAction } from '../src/modules/review/normalize';

// Fix: Component defined outside to prevent re-renders
// Explicitly using React.FC to ensure key prop is handled correctly by TS
const TaskCard: React.FC<{ task: StrategicTask }> = ({ task }) => {
  const { updateStrategicTaskStatus, deleteStrategicTask, addProject } = useApp();

  const handleConvertToProject = () => {
    addProject({
      name: `【战略战役】${task.title}`.slice(0, 60),
      contractRef: `STRATEGY:${task.id}`,
      manager: task.owner || '待指派',
      projectCategory: 'FollowUp',
      projectType: 'Self-Operated',
      deadline: task.deadline || new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().split('T')[0],
      tasks: [
        {
          id: `T-ST-${Date.now()}`,
          title: task.title,
          status: 'Pending',
          priority: task.priority || 'Medium',
          category: 'Core',
          owner: task.owner || '待指派',
          deadline: task.deadline || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0]
        }
      ]
    });
    updateStrategicTaskStatus(task.id, 'In Progress');
  };

  return (
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all group mb-3 cursor-grab active:cursor-grabbing">
          <div className="flex justify-between items-start mb-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                  task.priority === 'High' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
              }`}>
                  {task.priority} Priority
              </span>
              <button 
                onClick={() => deleteStrategicTask(task.id)}
                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                  <Trash2 className="w-3 h-3" />
              </button>
          </div>
          <h4 className="text-sm font-bold text-gray-900 mb-2 leading-relaxed">{task.title}</h4>
          <div className="flex justify-between items-center text-xs text-gray-500">
              <div className="flex items-center">
                  <span className="font-bold bg-gray-50 px-1.5 py-0.5 rounded text-gray-600 mr-2">{task.owner}</span>
              </div>
              <span className="font-mono">{task.deadline}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-gray-50 text-xs font-bold text-indigo-600 flex items-center">
              <Zap className="w-3 h-3 mr-1" />
              {task.impact}
          </div>
          
          {/* Status Controls */}
          <div className="mt-3 flex gap-1">
              <button onClick={handleConvertToProject} className="flex-1 py-1 bg-indigo-50 hover:bg-indigo-100 rounded text-[10px] text-indigo-600 font-bold">转项目</button>
              {task.status !== 'Pending' && (
                  <button onClick={()=>updateStrategicTaskStatus(task.id, 'Pending')} className="flex-1 py-1 bg-gray-50 hover:bg-gray-100 rounded text-[10px] text-gray-500">重置</button>
              )}
              {task.status !== 'In Progress' && (
                  <button onClick={()=>updateStrategicTaskStatus(task.id, 'In Progress')} className="flex-1 py-1 bg-blue-50 hover:bg-blue-100 rounded text-[10px] text-blue-600 font-bold">进行中</button>
              )}
              {task.status !== 'Completed' && (
                  <button onClick={()=>updateStrategicTaskStatus(task.id, 'Completed')} className="flex-1 py-1 bg-green-50 hover:bg-green-100 rounded text-[10px] text-green-600 font-bold">完成</button>
              )}
          </div>
      </div>
  );
};

const Strategy = () => {
  const { strategicInsight, isAnalyzingStrategy, runDeepAnalysis, strategicTasks, addStrategicTask, generateStrategicTasksFromInsight } = useApp();
  /*
    默认落在「本月经营判断」，不是 SWOT。

    SWOT/BCG 那套上线至今**一次都没被用过**（战略洞察为空、战略任务 0 条）——
    它是给大企业做年度规划的框架，对一家 200-400 单/年的公司只会输出
    「优势：本地化服务」这类正确但不指向动作的话。
    把真正能用的东西放在默认位置，是这次改动的重点，不是顺手调的顺序。
  */
  const [activeTab, setActiveTab] = useState<'review' | 'analysis' | 'execution'>('review');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [dashboardFocusLabel, setDashboardFocusLabel] = useState('');
  const [focusedStatus, setFocusedStatus] = useState<'Pending' | 'In Progress' | 'Completed' | ''>('');
  const location = useLocation();

  // Use AI Real Data if available, else Mock for initial render or fallback
  const swotData = strategicInsight ? {
      strengths: strategicInsight.swot?.strengths?.map((s: any) => s.content || s) || [],
      weaknesses: strategicInsight.swot?.weaknesses?.map((s: any) => s.content || s) || [],
      opportunities: strategicInsight.swot?.opportunities?.map((s: any) => s.content || s) || [],
      threats: strategicInsight.swot?.threats?.map((s: any) => s.content || s) || [],
  } : {
    // 未跑 AI 推演时的样例，仅用于演示布局。标题处会显式标注"示例内容"，
    // 避免被当成基于真实业务数据的结论。
    strengths: ['（示例）拥有行业领先的 ISO 认证专家团队', '（示例）自研 AI 辅助系统降低 30% 人力成本', '（示例）客户续费率保持在 85% 以上'],
    weaknesses: ['（示例）新行业（如新能源）案例积累不足', '（示例）部分偏远地区交付依赖第三方', '（示例）品牌知名度在华南地区较弱'],
    opportunities: ['（示例）国家大力推行 ESG 与绿色制造标准', '（示例）中小企业数字化转型带来的合规需求', '（示例）"出海"企业对国际认证的爆发式增长'],
    threats: ['（示例）低价竞争对手扰乱市场价格体系', '（示例）政策法规变动可能导致旧业务萎缩', '（示例）头部机构开始下沉抢占中小客户'],
  };

  const bcgData = strategicInsight ? [
      { category: 'Stars (明星)', items: strategicInsight.marketGrowthHigh },
      { category: 'Cash Cows (金牛)', items: strategicInsight.marketGrowthLow },
      { category: 'Question Marks (问号)', items: strategicInsight.marketShareHigh },
      { category: 'Dogs (瘦狗)', items: strategicInsight.marketShareLow },
  ] : [
      { category: 'Stars (明星)', items: ['新能源合规', 'ESG 报告'] },
      { category: 'Cash Cows (金牛)', items: ['ISO 9001', 'ISO 14001'] },
      { category: 'Question Marks (问号)', items: ['数据安全 (ISO 27001)', '碳足迹'] },
      { category: 'Dogs (瘦狗)', items: ['简单代办服务', '低价商标注册'] },
  ];

  const handleAddTask = (e: React.FormEvent) => {
      e.preventDefault();
      if(!newTaskTitle.trim()) return;
      addStrategicTask({
          id: `ST-${Date.now()}`,
          title: newTaskTitle,
          priority: 'Medium',
          owner: '待定',
          status: 'Pending',
          /*
            截止日默认为 30 天后，不能写死日期。

            原来写死 '2025-12-31'——而今天是 2026 年，
            **新建的战略任务一出生就是逾期的**，直接进逾期统计。
            写死的日期不会报错，只会随时间悄悄变成过期数据。
          */
          deadline: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
          impact: '待评估',
          type: 'Market'
      });
      setNewTaskTitle('');
  };

  /*
    把一条 AI 建议收成战役。

    **依据要一起带过来**（写进 impact）。只存标题的话，
    过两周回头看这条战役，谁也说不清当初是哪个数字让它进来的——
    那时它和拍脑袋定的目标就没区别了。
  */
  const adoptMonthlyAction = (action: MonthlyAction) => {
      addStrategicTask({
          id: `ST-${Date.now()}`,
          title: action.title,
          priority: action.urgency === 'high' ? 'High' : action.urgency === 'low' ? 'Low' : 'Medium',
          owner: '待定',
          status: 'Pending',
          deadline: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
          impact: action.why,
          type: 'Operation'
      });
  };

  useEffect(() => {
      const state: any = location.state || {};
      const focus = state.dashboardFocus;
      const tabQuery = String(new URLSearchParams(location.search).get('tab') || '').trim();

      if (focus?.type === 'review' || tabQuery === 'review') {
          setActiveTab('review');
          setFocusedStatus('');
          setDashboardFocusLabel('本月经营判断');
      } else if (focus?.type === 'analysis' || tabQuery === 'analysis') {
          setActiveTab('analysis');
          setFocusedStatus('');
          setDashboardFocusLabel('战略分析视图');
      } else if (focus?.type === 'execution_status') {
          setActiveTab('execution');
          const nextStatus = String(focus.status || '') as 'Pending' | 'In Progress' | 'Completed' | '';
          setFocusedStatus(nextStatus);
          setDashboardFocusLabel(nextStatus === 'Pending' ? '待启动战役' : nextStatus === 'In Progress' ? '攻坚中战役' : '已达成战役');
      } else if (focus?.type === 'execution' || tabQuery === 'execution') {
          setActiveTab('execution');
          setFocusedStatus('');
          setDashboardFocusLabel('战略执行看板');
      }

      if (state.dashboardFocus) {
          window.history.replaceState({}, document.title);
      }
  }, [location.state, location.search]);

  const pendingTasks = useMemo(() => strategicTasks.filter(t => t.status === 'Pending'), [strategicTasks]);
  const inProgressTasks = useMemo(() => strategicTasks.filter(t => t.status === 'In Progress'), [strategicTasks]);
  const completedTasks = useMemo(() => strategicTasks.filter(t => t.status === 'Completed'), [strategicTasks]);
  const getColumnFocusClass = (status: 'Pending' | 'In Progress' | 'Completed') => {
      if (!focusedStatus) return '';
      return focusedStatus === status ? 'ring-2 ring-indigo-300 shadow-md' : 'opacity-45';
  };

  return (
    <div className="p-6 animate-in fade-in duration-500">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
              战略管理中心
              {strategicInsight && <span className="ml-3 text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full font-bold flex items-center"><BrainCircuit className="w-3 h-3 mr-1"/> AI 实时驱动</span>}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
              {strategicInsight ? `上次更新: ${strategicInsight.generatedAt} (基于全量序列化数据)` : '制定方向，驱动线索，闭环落地'}
          </p>
        </div>
        <div className="flex space-x-2">
          {activeTab === 'analysis' && (
              <button
                onClick={runDeepAnalysis}
                disabled={isAnalyzingStrategy}
                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center shadow-sm transition-all active:scale-95 ${isAnalyzingStrategy ? 'bg-indigo-50 text-indigo-400 cursor-wait' : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:shadow-lg'}`}
              >
                {isAnalyzingStrategy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {isAnalyzingStrategy ? 'AI 全局推演中...' : '启动深度战略推演'}
              </button>
          )}
          {activeTab === 'execution' && (
              <button
                onClick={generateStrategicTasksFromInsight}
                disabled={isAnalyzingStrategy || !strategicInsight}
                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center shadow-sm transition-all active:scale-95 ${isAnalyzingStrategy ? 'bg-indigo-50 text-indigo-400 cursor-wait' : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg'}`}
              >
                {isAnalyzingStrategy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2 text-yellow-300" />}
                {isAnalyzingStrategy ? '正在拆解战役...' : 'AI 自动生成必赢战役'}
              </button>
          )}
          <button
            onClick={() => setActiveTab('review')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center ${activeTab === 'review' ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
          >
            <CalendarCheck className="w-4 h-4 mr-2" />
            本月经营判断
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center ${activeTab === 'analysis' ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
          >
            <LayoutGrid className="w-4 h-4 mr-2" />
            战略分析
          </button>
          <button
            onClick={() => setActiveTab('execution')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center ${activeTab === 'execution' ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
          >
            <Crosshair className="w-4 h-4 mr-2" />
            战略落地 (MQL)
          </button>
        </div>
      </div>
      {dashboardFocusLabel && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
            工作台焦点：{dashboardFocusLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              setDashboardFocusLabel('');
              setFocusedStatus('');
            }}
            className="text-xs font-bold text-gray-500 hover:text-gray-700"
          >
            清除焦点
          </button>
        </div>
      )}

      {activeTab === 'review' && <MonthlyReview onAdopt={adoptMonthlyAction} />}

      {/* Main Analysis Content */}
      {activeTab === 'analysis' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-indigo-900 to-blue-900 rounded-xl p-6 text-white shadow-lg relative overflow-hidden">
              <div className="relative z-10">
                  <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-2 flex items-center">
                      <BrainCircuit className="w-4 h-4 mr-2" /> 首席战略官 (AI CSO) 核心建议
                  </h3>
                  <p className="text-lg md:text-xl font-bold leading-relaxed">
                      {isAnalyzingStrategy 
                        ? "正在扫描线索库、合同台账与财务报表，请稍候..." 
                        : `“${strategicInsight?.keyRecommendation || '点击右上角启动按钮，让 AI 基于您的真实业务数据生成战略建议。'}”`}
                  </p>
              </div>
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none">
                  <Target className="w-48 h-48 text-white" />
              </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-900 flex items-center">
                <Target className="w-5 h-5 mr-2 text-blue-600" />
                SWOT 分析矩阵 {isAnalyzingStrategy && <Loader2 className="w-4 h-4 ml-2 animate-spin text-gray-400"/>}
              </h3>
              <span className={`text-xs font-bold px-2 py-1 rounded-full border ${strategicInsight ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                {strategicInsight ? '数据源：全量业务系统（AI 推演结果）' : '示例内容 · 点右上角「启动深度战略推演」生成真实分析'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
              <div className="p-6 bg-blue-50/30">
                <div className="flex items-center mb-4 text-blue-700 font-bold"> <TrendingUp className="w-5 h-5 mr-2" /> 优势 (Strengths) </div>
                <ul className="space-y-2"> {swotData.strengths.map((item, idx) => ( <li key={idx} className="flex items-start text-sm text-gray-700"> <span className="mr-2 text-blue-400">•</span> {item} </li> ))} </ul>
              </div>
              <div className="p-6 bg-orange-50/30">
                <div className="flex items-center mb-4 text-orange-700 font-bold"> <ShieldAlert className="w-5 h-5 mr-2" /> 劣势 (Weaknesses) </div>
                <ul className="space-y-2"> {swotData.weaknesses.map((item, idx) => ( <li key={idx} className="flex items-start text-sm text-gray-700"> <span className="mr-2 text-orange-400">•</span> {item} </li> ))} </ul>
              </div>
              <div className="p-6 bg-green-50/30 border-t border-gray-100">
                <div className="flex items-center mb-4 text-green-700 font-bold"> <Zap className="w-5 h-5 mr-2" /> 机会 (Opportunities) </div>
                <ul className="space-y-2"> {swotData.opportunities.map((item, idx) => ( <li key={idx} className="flex items-start text-sm text-gray-700"> <span className="mr-2 text-green-400">•</span> {item} </li> ))} </ul>
              </div>
              <div className="p-6 bg-red-50/30 border-t border-gray-100">
                <div className="flex items-center mb-4 text-red-700 font-bold"> <ShieldAlert className="w-5 h-5 mr-2" /> 威胁 (Threats) </div>
                <ul className="space-y-2"> {swotData.threats.map((item, idx) => ( <li key={idx} className="flex items-start text-sm text-gray-700"> <span className="mr-2 text-red-400">•</span> {item} </li> ))} </ul>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <h3 className="font-bold text-gray-900 mb-6 flex items-center"> <Box className="w-5 h-5 mr-2 text-purple-600" /> BCG 业务矩阵分布 </h3>
                  <div className="grid grid-cols-2 gap-4">
                      {bcgData.map((group, idx) => (
                          <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                              <p className="text-xs font-black text-gray-400 uppercase mb-2">{group.category}</p>
                              <div className="flex flex-wrap gap-1"> {group.items?.length > 0 ? group.items.map((tag, tIdx) => ( <span key={tIdx} className="text-xs font-bold bg-white border border-gray-200 px-2 py-1 rounded text-gray-700">{tag}</span> )) : <span className="text-xs text-gray-300">-</span>} </div>
                          </div>
                      ))}
                  </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-center items-center text-center">
                  <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4"> <BarChartIcon className="w-8 h-8 text-indigo-600" /> </div>
                  <h3 className="font-bold text-gray-900 mb-2">更多深度分析模型</h3>
                  <p className="text-sm text-gray-500 mb-6 max-w-xs"> PEST 分析、波特五力模型及财务杜邦分析正在开发中。 </p>
                  <button className="text-xs font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-colors"> 敬请期待 V5.2 </button>
              </div>
          </div>
        </div>
      )}

      {/* Execution Tab - Kanban Board */}
      {activeTab === 'execution' && (
          <div className="h-[calc(100vh-140px)] flex flex-col">
              {/* Toolbar */}
              <div className="mb-4 flex space-x-2">
                  <form onSubmit={handleAddTask} className="flex-1 flex shadow-sm">
                      <input 
                        className="flex-1 bg-white border border-gray-200 rounded-l-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                        placeholder="添加新战役任务..."
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                      />
                      <button type="submit" className="bg-gray-900 text-white px-4 py-2 rounded-r-xl font-bold text-sm hover:bg-gray-800 transition-colors">
                          <Plus className="w-4 h-4" />
                      </button>
                  </form>
              </div>

              {/* Kanban Columns */}
              <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
                  <div className="flex h-full gap-6 min-w-[1000px]">
                      {/* Column 1: Pending */}
                      <div className="flex-1 flex flex-col bg-gray-100/50 rounded-2xl border border-gray-200/50">
                          <div className="p-4 flex justify-between items-center border-b border-gray-100">
                              <h3 className="font-black text-gray-600 uppercase text-xs tracking-widest flex items-center">
                                  <Circle className="w-3 h-3 mr-2" /> 待启动 (Pending)
                              </h3>
                              <span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-0.5 rounded-full font-bold">{strategicTasks.filter(t => t.status === 'Pending').length}</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                              {strategicTasks.filter(t => t.status === 'Pending').map(task => <TaskCard key={task.id} task={task} />)}
                          </div>
                      </div>

                      {/* Column 2: In Progress */}
                      <div className={`flex-1 flex flex-col bg-blue-50/30 rounded-2xl border border-blue-100 transition-all ${getColumnFocusClass('In Progress')}`}>
                          <div className="p-4 flex justify-between items-center border-b border-blue-100">
                              <h3 className="font-black text-blue-600 uppercase text-xs tracking-widest flex items-center">
                                  <Clock className="w-3 h-3 mr-2" /> 攻坚中 (In Progress)
                              </h3>
                              <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold">{inProgressTasks.length}</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                              {inProgressTasks.map(task => <TaskCard key={task.id} task={task} />)}
                          </div>
                      </div>

                      {/* Column 3: Completed */}
                      <div className={`flex-1 flex flex-col bg-green-50/30 rounded-2xl border border-green-100 transition-all ${getColumnFocusClass('Completed')}`}>
                          <div className="p-4 flex justify-between items-center border-b border-green-100">
                              <h3 className="font-black text-green-600 uppercase text-xs tracking-widest flex items-center">
                                  <CheckCircle2 className="w-3 h-3 mr-2" /> 已达成 (Completed)
                              </h3>
                              <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full font-bold">{completedTasks.length}</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                              {completedTasks.map(task => <TaskCard key={task.id} task={task} />)}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Strategy;
