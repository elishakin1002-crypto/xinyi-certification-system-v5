
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { AuditIssue, KnowledgeDoc } from '../types';
import { ClipboardCheck, Search, Filter, AlertTriangle, AlertCircle, Info, Plus, X, Sparkles, Loader2, Save, CheckCircle, ChevronDown, ChevronRight, BookOpen, BrainCircuit, ArrowUpRight } from 'lucide-react';
import { aiService } from '../services/aiService';

const Audit = () => {
  const { auditIssues, addAuditIssue, updateAuditIssue, projects, addKnowledgeDoc, addReminder } = useApp();
  const [filterStatus, setFilterStatus] = useState<'All' | 'Open' | 'Closed'>('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<AuditIssue | null>(null);
  const [isExtracting, setIsExtracting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [formData, setFormData] = useState<Partial<AuditIssue>>({
      customerName: '', contractRef: '', auditType: 'Internal', findings: '', severity: 'Minor', status: 'Open', auditor: '当前用户', createDate: new Date().toISOString().split('T')[0], deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  const [isGenerating, setIsGenerating] = useState(false);

  const filteredIssues = auditIssues.filter(i => {
    if (filterStatus === 'Open' && i.status === 'Closed') return false;
    if (filterStatus === 'Closed' && i.status !== 'Closed') return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const haystack = `${i.customerName} ${i.findings} ${i.rectificationPlan || ''} ${i.auditor || ''}`.toLowerCase();
    return haystack.includes(q);
  });
  const openIssues = auditIssues.filter(i => i.status !== 'Closed').length;
  const majorIssues = auditIssues.filter(i => i.severity === 'Major' && i.status !== 'Closed').length;

  const handleOpenModal = (issue?: AuditIssue) => {
      if (issue) { setEditingIssue(issue); setFormData(issue); } else { setEditingIssue(null); setFormData({ customerName: '', auditType: 'Internal', findings: '', severity: 'Minor', status: 'Open', auditor: '当前用户', createDate: new Date().toISOString().split('T')[0], deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }); }
      setIsModalOpen(true);
  };

  const handleAIPlan = async () => {
      if (!formData.findings) { alert("请先填写问题描述（不符合项事实）"); return; }
      setIsGenerating(true);
      try {
          const prompt = `
            Context: ISO 认证审计记录。作为首席审计员，请根据以下发现点生成专业的整改方案。
            发现点: "${formData.findings}"
            严重性: ${formData.severity}
            
            输出结构：
            1. 原因分析 (Root Cause)
            2. 纠正措施 (Correction)
            3. 预防措施 (Preventive Action)
          `;
          
          const text = await aiService.generateText('kimi-k2.5', prompt);
          setFormData(prev => ({ ...prev, rectificationPlan: text }));
      } catch (e) {
          console.error(e);
          alert("AI 生成失败");
      } finally {
          setIsGenerating(false);
      }
  };

  // V5.0 核心逻辑：经验提取
  const handleExtractExperience = async (issue: AuditIssue) => {
      setIsExtracting(issue.id);
      try {
          const prompt = `
            任务：将审计教训转化为“企业百科经验”。
            问题：${issue.findings}
            整改：${issue.rectificationPlan}
            
            请提炼出一条 100 字以内的“避坑锦囊”，告诉其他项目组成员在遇到类似项目时如何预防此类问题。
            输出 JSON: { "title": "经验标题", "content": "避坑内容", "category": "Training" }
          `;
          
          const result = await aiService.generateJSON('kimi-k2.5', prompt);
          
          const newDoc: KnowledgeDoc = {
              id: `EXP-${Date.now()}`,
              title: `【审计教训】${result.title}`,
              category: 'Training',
              format: 'AI-Insight',
              size: '0.1 KB',
              updatedAt: new Date().toISOString().split('T')[0],
              content: result.content
          };
          
          await addKnowledgeDoc(newDoc);
          alert("✅ 经验已提取并注入知识中心！未来类似项目将获得主动预警。");
      } catch (e) {
          console.error(e);
      } finally {
          setIsExtracting(null);
      }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerName || !formData.findings) return;
    if (editingIssue) {
      updateAuditIssue(editingIssue.id, formData);
    } else {
      addAuditIssue(formData as Omit<AuditIssue, 'id'>);
    }

    const deadline = String(formData.deadline || '');
    if (deadline) {
      addReminder({
        title: `🧾 审计整改跟进`,
        content: `客户【${formData.customerName}】不符合项已登记，整改截止：${deadline}。`,
        date: deadline,
        type: 'task',
        forRole: ['MANAGER', 'CONSULTANT']
      });
    }
    setIsModalOpen(false);
  };
  
  const getSeverityBadge = (s: string) => { switch(s) { case 'Major': return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-bold border border-red-200">严重</span>; case 'Minor': return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium border border-orange-200">一般</span>; case 'Observation': return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium border border-blue-200">观察</span>; default: return s; } };
  const getStatusBadge = (s: string) => { switch(s) { case 'Open': return <span className="text-sm text-red-600 font-medium">待整改</span>; case 'Rectifying': return <span className="text-sm text-orange-600 font-medium">整改中</span>; case 'Verifying': return <span className="text-sm text-blue-600 font-medium">待验证</span>; case 'Closed': return <span className="text-sm text-green-600 font-medium flex items-center"><CheckCircle className="w-3 h-3 mr-1"/>已关闭</span>; default: return s; } };

  return (
    <div className="p-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-6"> 
        <div> 
          <h1 className="text-2xl font-bold text-gray-900">不符合项与经验提取</h1> 
          <p className="text-sm text-gray-500 mt-1">V5.0：将审计教训转化为主动防御知识</p> 
        </div> 
        <button onClick={() => handleOpenModal()} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all active:scale-95 text-sm font-bold"><Plus className="w-4 h-4 mr-2" /> 登记不符合项</button> 
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6"> 
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-red-200 transition-colors"> 
          <div className="p-3 bg-red-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"> <AlertTriangle className="w-6 h-6 text-red-600" /> </div> 
          <div> <div className="text-2xl font-black text-gray-900">{openIssues}</div> <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">待整改/验证总数</div> </div> 
        </div> 
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-orange-200 transition-colors"> 
          <div className="p-3 bg-orange-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"> <AlertCircle className="w-6 h-6 text-orange-600" /> </div> 
          <div> <div className="text-2xl font-black text-gray-900">{majorIssues}</div> <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">严重不符合项 (Major)</div> </div> 
        </div>
        <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-5 rounded-2xl shadow-lg flex items-center text-white"> 
          <div className="p-3 bg-white/20 rounded-xl mr-4"> <BrainCircuit className="w-6 h-6" /> </div> 
          <div> 
            <div className="text-2xl font-black">AI 驱动中</div> 
            <div className="text-xs opacity-70 font-bold uppercase tracking-tight">大脑已介入经验闭环</div> 
          </div> 
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"> 
        <div className="p-4 border-b border-gray-100 flex justify-between items-center flex-wrap gap-2"> 
          <div className="flex space-x-2"> 
            {['All', 'Open', 'Closed'].map(st => ( <button key={st} onClick={() => setFilterStatus(st as any)} className={`px-4 py-1.5 text-sm font-bold rounded-xl transition-all ${filterStatus === st ? 'bg-gray-900 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`} > {st === 'All' ? '全部' : st === 'Open' ? '未完成' : '已归档'} </button> ))} 
          </div> 
          <div className="relative w-full md:w-64"> <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" /> <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索问题描述..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm" /> </div> 
        </div> 
        
        <div className="overflow-x-auto"> 
          <table className="w-full text-sm text-left"> 
            <thead className="bg-gray-50 text-gray-600 font-bold text-sm uppercase tracking-widest border-b border-gray-100"> 
              <tr> 
                <th className="px-6 py-4">严重度</th> 
                <th className="px-6 py-4">客户/主体</th> 
                <th className="px-6 py-4">审计发现点</th> 
                <th className="px-6 py-4">经验提炼状态</th> 
                <th className="px-6 py-4">状态</th> 
                <th className="px-6 py-4 text-right">操作</th> 
              </tr> 
            </thead> 
            <tbody className="divide-y divide-gray-100"> 
              {filteredIssues.map(issue => ( 
                <tr key={issue.id} className="hover:bg-gray-50/80 transition-colors group"> 
                  <td className="px-6 py-5">{getSeverityBadge(issue.severity)}</td> 
                  <td className="px-6 py-5 font-black text-gray-900 text-base">{issue.customerName}</td> 
                  <td className="px-6 py-5"> 
                    <p className="truncate max-w-xs text-gray-700 text-sm" title={issue.findings}>{issue.findings}</p> 
                    {issue.status === 'Closed' && (
                      <div className="mt-1 flex items-center text-xs text-green-600 font-bold">
                        <CheckCircle className="w-3 h-3 mr-1" /> 已通过验证
                      </div>
                    )}
                  </td> 
                  <td className="px-6 py-5">
                    {issue.status === 'Closed' ? (
                       <button 
                        onClick={() => handleExtractExperience(issue)}
                        disabled={isExtracting === issue.id}
                        className={`flex items-center text-xs font-black px-2 py-1 rounded-lg border transition-all ${isExtracting === issue.id ? 'bg-gray-100 text-gray-400' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-600 hover:text-white'}`}
                       >
                         {isExtracting === issue.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <BrainCircuit className="w-3 h-3 mr-1" />}
                         {isExtracting === issue.id ? '智能提炼中...' : '提炼避坑锦囊'}
                       </button>
                    ) : (
                      <span className="text-xs text-gray-300 italic">待关闭后提炼</span>
                    )}
                  </td>
                  <td className="px-6 py-5">{getStatusBadge(issue.status)}</td> 
                  <td className="px-6 py-5 text-right"> 
                    <button onClick={() => handleOpenModal(issue)} className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors">
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </td> 
                </tr> 
              ))} 
            </tbody> 
          </table> 
        </div> 
      </div>

      {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-8 animate-in fade-in zoom-in duration-300 max-h-[90vh] overflow-y-auto border border-gray-100">
                  <div className="flex justify-between items-center mb-8"> 
                    <h2 className="text-2xl font-black text-gray-900 flex items-center"> 
                       {editingIssue ? <Sparkles className="w-6 h-6 mr-3 text-indigo-600" /> : <Plus className="w-6 h-6 mr-3 text-blue-600" />}
                       {editingIssue ? '问题深度处理' : '登记新不符合项'} 
                    </h2> 
                    <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-6 h-6 text-gray-400"/></button> 
                  </div>
                  <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6"> 
                        <div> 
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">客户主体</label> 
                          <input required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} /> 
                        </div> 
                        <div> 
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">审核类别</label> 
                          <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={formData.auditType} onChange={e => setFormData({...formData, auditType: e.target.value as any})}> 
                            <option value="Internal">内部审核</option> 
                            <option value="External">外部认证审核</option> 
                            <option value="Surveillance">监督审核</option> 
                          </select> 
                        </div> 
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6"> 
                        <div> 
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">严重度评分</label> 
                          <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={formData.severity} onChange={e => setFormData({...formData, severity: e.target.value as any})}> 
                            <option value="Minor">一般不符合 (Minor)</option> 
                            <option value="Major">严重不符合 (Major)</option> 
                            <option value="Observation">观察项 (Obs)</option> 
                          </select> 
                        </div> 
                        <div> 
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">整改死线</label> 
                          <input type="date" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={formData.deadline} onChange={e => setFormData({...formData, deadline: e.target.value})} /> 
                        </div> 
                      </div>
                      <div> 
                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">问题描述 (Findings)</label> 
                        <textarea required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none min-h-[100px]" placeholder="详细客观描述现场发现的不符合事实..." value={formData.findings} onChange={e => setFormData({...formData, findings: e.target.value})}></textarea> 
                      </div>
                      
                      <div className="bg-indigo-50/30 p-6 rounded-3xl border border-indigo-100"> 
                        <div className="flex justify-between items-center mb-4"> 
                          <label className="text-xs font-black text-indigo-400 uppercase tracking-widest">AI 辅助整改决策</label> 
                          <button type="button" onClick={handleAIPlan} disabled={isGenerating} className="text-xs font-black flex items-center bg-indigo-600 text-white px-3 py-1.5 rounded-xl hover:bg-indigo-700 transition-all shadow-md active:scale-95" > 
                            {isGenerating ? <Loader2 className="w-3 h-3 mr-2 animate-spin"/> : <Sparkles className="w-3 h-3 mr-2"/>} 
                            智能生成整改方案 
                          </button> 
                        </div> 
                        <textarea className="w-full bg-white border-none rounded-2xl p-4 text-sm leading-relaxed focus:ring-2 focus:ring-indigo-500/20 outline-none min-h-[150px] shadow-sm" placeholder="AI 将协助生成原因分析、纠正措施及预防措施..." value={formData.rectificationPlan || ''} onChange={e => setFormData({...formData, rectificationPlan: e.target.value})} ></textarea> 
                      </div>

                      {editingIssue && (
                        <div className="flex items-center space-x-3 p-4 bg-gray-50 rounded-2xl border border-gray-100"> 
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded-lg border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                            checked={formData.status === 'Closed'} 
                            onChange={e => setFormData({...formData, status: e.target.checked ? 'Closed' : 'Rectifying'})} 
                          /> 
                          <span className="text-sm font-bold text-gray-700">标记为已验证关闭（经验可提取态）</span> 
                        </div>
                      )}

                      <div className="flex justify-end space-x-4 pt-4"> 
                        <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-gray-400 hover:text-gray-600 transition-colors">取消</button> 
                        <button type="submit" className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 shadow-xl shadow-blue-500/20 transition-all active:scale-95 flex items-center"> 
                          <Save className="w-4 h-4 mr-2" /> 确认保存 
                        </button> 
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

export default Audit;
