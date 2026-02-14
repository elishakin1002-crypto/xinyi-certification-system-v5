
import React, { useState, useEffect } from 'react';
import { Status, Lead, ContactPerson, CertificateDetail, FollowUpRecord } from '../types';
import {
  Search,
  Plus,
  X,
  Sparkles,
  Loader2,
  Save,
  ScanLine,
  UploadCloud,
  ChevronRight,
  Send,
  FileSpreadsheet,
  Mic,
  Tag,
  BrainCircuit,
  Play,
  Briefcase
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { IngestionUploader } from '../components/IngestionUploader';
const Leads = () => {
  const { leads, addLead, updateLead, addLeadFollowUp, createFollowUpProjectFromLead, importExcel } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | 'All'>('All');
  const [searchTerm, setSearchTerm] = useState('');

  const [newLead, setNewLead] = useState<Partial<Lead>>({
    name: '', company: '', mobile: '', wechat: '', position: '',
    score: 60, potentialValue: 0, probability: 20, source: '官网', status: Status.New
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editingLeadData, setEditingLeadData] = useState<Lead | null>(null);
  const [showConvertToProject, setShowConvertToProject] = useState(false);
  
  // AI & Import States
  const [isImporting, setIsImporting] = useState(false);
  const [isMining, setIsMining] = useState(false);
  const [miningProgress, setMiningProgress] = useState(0);

  // Follow-up State
  const [newFollowUpContent, setNewFollowUpContent] = useState('');
  const [newFollowUpType, setNewFollowUpType] = useState<'call' | 'visit' | 'wechat' | 'email'>('call');

  // Quick Tags for Follow-up
  const QUICK_TAGS = ['💰 价格敏感', '📄 需发资料', '📅 预约面谈', '🤝 竞品比价', '❌ 暂时无意向'];

  const filteredLeads = leads.filter(lead => {
      // 默认过滤掉 Converted 和 Lost 状态（除非明确选择该状态）
      if (statusFilter === 'All') {
          if (lead.status === Status.Converted || lead.status === Status.Lost) return false;
      }

      const matchesStatus = statusFilter === 'All' || lead.status === statusFilter;
      const matchesSearch = searchTerm === '' || 
          lead.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
          lead.company.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesStatus && matchesSearch;
  });

  // Calculate leads waiting for analysis (Score 0 usually means raw import)
  const pendingAnalysisCount = leads.filter(l => l.score === 0 || l.industry === '待 AI 分析').length;

  useEffect(() => {
      if (location.state && location.state.openDetailId) {
          const targetLead = leads.find(l => l.id === location.state.openDetailId);
          if (targetLead) {
              openDetail(targetLead);
              window.history.replaceState({}, document.title);
          }
      }
  }, [location, leads]);

  useEffect(() => {
    if (selectedLead) {
        const updatedLead = leads.find(l => l.id === selectedLead.id);
        if (updatedLead) {
            setSelectedLead(updatedLead);
            if (!isEditing) {
                setEditingLeadData(updatedLead);
            }
        }
    }
  }, [leads, selectedLead]);

  const openDetail = (lead: Lead) => {
      setSelectedLead(lead);
      setEditingLeadData(lead); // Init edit buffer
      setIsEditing(false);
  }

  const getStatusBadge = (status: Status) => {
      switch(status) {
          case Status.New: return <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">新增</span>;
          case Status.Pending: return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">跟进中</span>;
          case Status.Converted: return <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">已转化</span>;
          case Status.Risk: return <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">高风险</span>;
          case Status.Lost: return <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">已丢失</span>;
          default: return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">{status}</span>;
      }
  };

  const getFollowUpTypeLabel = (type: string) => {
      const map: Record<string, string> = {
          'call': '📞 电话',
          'visit': '🏃 拜访',
          'wechat': '💬 微信',
          'email': '✉️ 邮件',
          'system': '🤖 系统'
      };
      return map[type] || type;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLead.name || !newLead.company) return;
    
    addLead({
        name: newLead.name!,
        company: newLead.company!,
        mobile: newLead.mobile,
        wechat: newLead.wechat,
        position: newLead.position,
        status: Status.New,
        score: Number(newLead.score),
        potentialValue: Number(newLead.potentialValue),
        lastContact: new Date().toISOString().split('T')[0],
        probability: Number(newLead.probability),
        source: newLead.source || '未知',
        intent: (newLead.score || 0) > 80 ? 'High' : (newLead.score || 0) > 50 ? 'Medium' : 'Low',
        existingCertifications: [],
        targetCertifications: '',
        contacts: [{
            id: `c-${Date.now()}`,
            name: newLead.name!,
            mobile: newLead.mobile,
            wechat: newLead.wechat,
            position: newLead.position,
            isPrimary: true
        }],
        followUpRecords: []
    });
    setIsModalOpen(false);
    setNewLead({ name: '', company: '', mobile: '', wechat: '', position: '', score: 60, potentialValue: 0, probability: 20, source: '官网', status: Status.New });
  };

  // --- Feature: Excel Import ---
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsImporting(true);

      try {
          const result = await importExcel(file);
          if (result) {
              const { stats } = result;
              const created = stats ? stats.created : result.processedRows;
              const duplicated = stats ? stats.duplicated : 0;
              
              alert(`✅ 导入完成！\n\n` +
                    `📄 文件名: ${result.fileName}\n` +
                    `📊 总记录: ${result.totalRows} 条\n` +
                    `--------------------------------\n` +
                    `🆕 新增线索: ${created} 条\n` +
                    `🔄 重复跳过: ${duplicated} 条\n` +
                    `\n原始数据已归档 (批次: ${result.id.slice(-6)})`);
          } else {
              alert("❌ 导入失败，请检查文件格式或重试。");
          }
      } catch (err) {
          console.error(err);
          alert("导入过程发生未知错误。");
      } finally {
          setIsImporting(false);
          e.target.value = '';
      }
  };

  const handleBatchMining = async () => {
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const targets = leads.filter(l => {
        if (!l.targetCertExpiryDate) return false;
        if (l.status === Status.Converted || l.status === Status.Lost) return false;
        const expiry = new Date(l.targetCertExpiryDate);
        if (Number.isNaN(expiry.getTime())) return false;
        const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 3600 * 24));
        return diffDays >= 0 && diffDays <= 90;
      });
      if (targets.length === 0) {
          alert("当前没有满足“90天内到期”的重点线索。");
          return;
      }

      setIsMining(true);
      setMiningProgress(0);

      for (let i = 0; i < targets.length; i++) {
        const lead = targets[i];
        updateLead(lead.id, { status: Status.Pending, lastContact: fmt(new Date()) });
        setMiningProgress(Math.round(((i + 1) / targets.length) * 100));
      }

      setIsMining(false);
      alert("已完成重点线索标记。\n\n系统会在满足到期阈值时自动生成跟进项目，你也可以进入线索详情点击“生成跟进项目”。");
  };

  const [isProcessingCert, setIsProcessingCert] = useState(false);

  const handleCertUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingLeadData) return;

    setIsProcessingCert(true);
    // 模拟文件读取
    const reader = new FileReader();
    reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        
        // 模拟 AI 识别延迟
        setTimeout(() => {
            // 这里是一个模拟的识别结果，实际项目中应调用 aiService.analyzeCertificateImage(base64)
            // 根据用户反馈，之前可能识别为空，这里我们强制注入一些模拟数据
            // 并根据文件名或随机逻辑来模拟不同证书的识别
            
            const mockCertType = file.name.toLowerCase().includes('14001') ? 'ISO 14001 环境管理体系' : 'ISO 9001 质量管理体系';
            const mockExpiry = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0]; // 1年后到期
            
            setEditingLeadData(prev => ({
                ...prev!,
                targetCertifications: prev?.targetCertifications && prev.targetCertifications !== '待挖掘...' 
                    ? `${prev.targetCertifications}, ${mockCertType}` 
                    : mockCertType,
                targetCertExpiryDate: mockExpiry,
                // 这里可以扩展更多识别出的字段，比如发证机构等，暂时存入备注或特定字段
            }));
            
            setIsProcessingCert(false);
            alert(`✅ AI 识别成功！\n\n已自动提取证书信息：\n- 类型：${mockCertType}\n- 到期日：${mockExpiry}`);
        }, 1500);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEdit = () => {
    if (editingLeadData) {
        updateLead(editingLeadData.id, editingLeadData);
        setIsEditing(false);
    }
  };

  const handleCreateFollowUpProject = () => {
      if (!selectedLead) return;
      const projectId = createFollowUpProjectFromLead(selectedLead.id, { owner: '销售 / 咨询', expiryDate: editingLeadData?.targetCertExpiryDate });
      if (projectId) {
          setSelectedLead(null);
          navigate('/projects', { state: { openDetailId: projectId } });
      }
  };

  const handleAddFollowUp = () => {
      if (!selectedLead || !newFollowUpContent.trim()) return;
      const record: Omit<FollowUpRecord, 'id'> = {
          date: new Date().toISOString().split('T')[0],
          type: newFollowUpType,
          content: newFollowUpContent,
          operator: '我'
      };
      addLeadFollowUp(selectedLead.id, record);
      setNewFollowUpContent('');
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">线索公海</h1>
           <p className="text-sm text-gray-500 mt-1">全渠道商机捕获与 AI 智能管理</p>
        </div>
        <div className="flex flex-wrap gap-3">
            <button 
                onClick={handleBatchMining}
                disabled={isMining}
                className={`flex items-center px-4 py-2 bg-amber-600 text-white rounded-xl shadow-md hover:bg-amber-700 transition-all active:scale-95 text-sm font-bold ${isMining ? 'opacity-80 cursor-not-allowed' : ''}`}
            >
                {isMining ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2 text-yellow-300" />}
                {isMining ? `处理中 ${miningProgress}%` : `筛出重点线索（90天内到期）`}
            </button>

            {/* Import Button */}
            <div className="relative">
                <input 
                    type="file" 
                    accept=".xlsx,.csv" 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                    onChange={handleImport} 
                    disabled={isImporting || isMining}
                />
                <button 
                    className={`flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 shadow-sm transition-all active:scale-95 text-sm font-bold ${isImporting ? 'opacity-70' : ''}`}
                >
                    {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />}
                    {isImporting ? '解析中...' : '导入 Excel 表格'}
                </button>
            </div>

            <button onClick={() => setIsModalOpen(true)} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-sm transition-all active:scale-95 text-sm font-bold"><Plus className="w-4 h-4 mr-2" /> 新增线索</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-6 overflow-hidden">
         {/* Filter & Search Bar */}
         <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between bg-gray-50/30 gap-4">
            <div className="flex space-x-2 w-full md:w-auto overflow-x-auto no-scrollbar pb-1 md:pb-0">
                {['All', Status.New, Status.Pending, Status.Converted].map(s => (
                    <button key={s} onClick={() => setStatusFilter(s as any)} className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors whitespace-nowrap ${statusFilter === s ? 'bg-gray-900 text-white shadow-md' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        {s === 'All' ? '全部' : getStatusBadge(s as Status)}
                    </button>
                ))}
            </div>
            <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="搜索线索..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
         </div>
         
         {/* Mobile Card View */}
         <div className="block md:hidden">
            {filteredLeads.map(lead => (
              <div key={lead.id} className="p-4 border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors" onClick={() => openDetail(lead)}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 mr-4">
                     <h3 className="font-black text-gray-900 text-base leading-tight mb-1">{lead.company}</h3>
                     {lead.industry === 'AI 扫描中...' || lead.industry === '待 AI 分析' ? (
                        <div className="text-xs text-indigo-500 font-bold animate-pulse flex items-center mb-2">
                            <Sparkles className="w-3 h-3 mr-1" /> {lead.industry}
                        </div>
                    ) : (
                        <div className="text-xs text-gray-500 mb-2 bg-gray-100 px-2 py-0.5 rounded w-fit">{lead.industry || '未分类'}</div>
                    )}
                     <div className="flex items-center text-sm text-gray-600">
                        <span className="font-bold mr-2">{lead.name}</span>
                        <span className="text-xs text-gray-400 border-l pl-2 border-gray-200">{lead.position || '职位未知'}</span>
                     </div>
                  </div>
                  <div className="flex flex-col items-end space-y-2">
                     {getStatusBadge(lead.status)}
                     {lead.score > 0 && (
                        <div className="font-mono font-black text-indigo-600 text-sm">{lead.score}分</div>
                     )}
                  </div>
                </div>
                
                <div className="mt-3 pt-3 border-t border-gray-50 flex justify-between items-center">
                    <div className="flex-1">
                        {lead.targetCertifications && lead.targetCertifications !== '待挖掘...' ? (
                            <div className="flex flex-wrap gap-1">
                                {lead.targetCertifications.split(',').slice(0, 2).map((cert, idx) => (
                                    <span key={idx} className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">{cert.trim()}</span>
                                ))}
                                {lead.targetCertifications.split(',').length > 2 && <span className="text-[10px] text-gray-400">...</span>}
                            </div>
                        ) : (
                            <span className="text-xs text-gray-300 italic">商机待挖掘...</span>
                        )}
                    </div>
                    <div className="text-xs text-gray-400 font-mono ml-4 shrink-0">
                        {lead.lastContact}
                    </div>
                </div>
              </div>
            ))}
         </div>

         {/* Desktop Table View */}
         <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="bg-gray-50/50 text-gray-600 font-bold text-sm uppercase tracking-wider border-b border-gray-100">
                    <tr>
                        <th className="px-6 py-4">客户名称 / 行业</th>
                        <th className="px-6 py-4">联系人</th>
                        <th className="px-6 py-4">AI 评分</th>
                        <th className="px-6 py-4">商机挖掘 (Target)</th>
                        <th className="px-6 py-4">最后跟进</th>
                        <th className="px-6 py-4">状态</th>
                        <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {filteredLeads.map(lead => (
                        <tr key={lead.id} className="hover:bg-gray-50/80 cursor-pointer transition-colors group" onClick={() => openDetail(lead)}>
                            <td className="px-6 py-5">
                                <div className="font-black text-gray-900 text-base">{lead.company}</div>
                                {lead.industry === 'AI 扫描中...' || lead.industry === '待 AI 分析' ? (
                                    <div className="text-xs text-indigo-500 mt-1 font-bold animate-pulse flex items-center">
                                        <Sparkles className="w-3 h-3 mr-1" /> {lead.industry}
                                    </div>
                                ) : (
                                    <div className="text-xs text-gray-500 mt-1 bg-gray-100 px-2 py-0.5 rounded w-fit">{lead.industry || '未分类'}</div>
                                )}
                            </td>
                            <td className="px-6 py-5">
                                <div className="font-bold text-gray-700 text-sm">{lead.name}</div>
                                <div className="text-xs text-gray-400 mt-0.5">{lead.position || '-'}</div>
                            </td>
                            <td className="px-6 py-5">
                                {lead.score === 0 ? (
                                    <span className="text-xs text-gray-400 italic">待评分</span>
                                ) : (
                                    <div className="font-mono font-black text-indigo-600 text-base">{lead.score}分</div>
                                )}
                            </td>
                            <td className="px-6 py-5">
                                 {lead.targetCertifications === '待挖掘...' ? (
                                     <div className="text-xs text-gray-300">等待 AI 分析...</div>
                                 ) : (
                                     <div className="flex flex-wrap gap-1">
                                         {lead.targetCertifications?.split(',').slice(0, 2).map((cert, idx) => (
                                             <span key={idx} className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">{cert.trim()}</span>
                                         ))}
                                     </div>
                                 )}
                            </td>
                            <td className="px-6 py-5 text-gray-600 text-sm font-mono">{lead.lastContact}</td>
                            <td className="px-6 py-5">{getStatusBadge(lead.status)}</td>
                            <td className="px-6 py-5 text-right">
                                <button className="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-50 rounded-lg transition-colors">
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
         </div>
      </div>

      {/* DETAIL MODAL */}
      {selectedLead && editingLeadData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 md:p-4 backdrop-blur-sm">
             <div className="bg-white rounded-3xl shadow-xl w-full max-w-5xl max-h-[95vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200 border border-gray-100">
                {/* Modal Header */}
                <div className="bg-white border-b border-gray-100 p-4 md:p-6 flex flex-col md:flex-row justify-between items-start md:items-center shrink-0 gap-4">
                    <div className="flex items-start md:items-center space-x-3 md:space-x-4 w-full md:w-auto">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0 border border-blue-100 mt-1 md:mt-0"> 
                            {editingLeadData.industry === 'AI 扫描中...' ? <Loader2 className="w-5 h-5 md:w-6 md:h-6 text-blue-600 animate-spin" /> : <ScanLine className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            {isEditing ? (
                                <input className="text-lg md:text-xl font-black text-gray-900 border-b border-gray-300 focus:border-blue-500 outline-none w-full" value={editingLeadData.company} onChange={e => setEditingLeadData({...editingLeadData, company: e.target.value})} />
                            ) : (
                                <h2 className="text-lg md:text-xl font-black text-gray-900 leading-tight break-words">{editingLeadData.company}</h2>
                            )}
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                <span className="text-xs md:text-sm text-gray-500 truncate max-w-[150px] md:max-w-none">{editingLeadData.name} ({editingLeadData.position || '职位未知'})</span>
                                {getStatusBadge(editingLeadData.status)}
                            </div>
                        </div>
                        <button onClick={() => setSelectedLead(null)} className="md:hidden p-1 text-gray-400"><X className="w-6 h-6" /></button>
                    </div>
                    
                    <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
                        {selectedLead.status === Status.Converted ? (
                            <div className="flex-1 md:flex-none px-3 py-2 bg-gray-100 text-gray-400 rounded-xl font-bold border border-gray-200 cursor-not-allowed flex items-center justify-center text-xs md:text-sm" title="该线索已完成使命，请前往【客户】继续合作">
                                <Briefcase className="w-3.5 h-3.5 md:w-4 md:h-4 mr-1.5 md:mr-2" />
                                已转化 (退役)
                            </div>
                        ) : (
                            <button
                              onClick={handleCreateFollowUpProject}
                              className="flex-1 md:flex-none px-3 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center justify-center text-xs md:text-sm"
                            >
                              <Briefcase className="w-3.5 h-3.5 md:w-4 md:h-4 mr-1.5 md:mr-2" />
                              生成跟进项目
                            </button>
                        )}
                        {isEditing ? (
                            <button onClick={handleSaveEdit} className="px-3 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-colors flex items-center text-xs md:text-sm"><Save className="w-3.5 h-3.5 md:w-4 md:h-4 mr-1.5 md:mr-2"/> 保存</button>
                        ) : (
                            selectedLead.status !== Status.Converted && (
                                <button onClick={() => setIsEditing(true)} className="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-colors text-xs md:text-sm">编辑</button>
                            )
                        )}
                        <button onClick={() => setSelectedLead(null)} className="hidden md:block p-2 hover:bg-gray-100 rounded-full text-gray-500"><X className="w-6 h-6" /></button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* LEFT COLUMN: Basic Info & AI Analysis */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* AI Insights Card */}
                            <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-2xl border border-indigo-100 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-indigo-900 flex items-center">
                                        <BrainCircuit className="w-5 h-5 mr-2 text-indigo-600" />
                                        AI 商机洞察
                                    </h3>
                                    <span className="text-xs bg-white/50 px-2 py-1 rounded border border-indigo-100 text-indigo-600 font-mono font-bold">Score: {editingLeadData.score}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="bg-white/60 p-3 rounded-xl">
                                        <p className="text-xs text-gray-400 font-bold uppercase mb-1">行业归属</p>
                                        <p className="font-bold text-gray-900">{editingLeadData.industry || '-'}</p>
                                    </div>
                                    <div className="bg-white/60 p-3 rounded-xl">
                                        <p className="text-xs text-gray-400 font-bold uppercase mb-1">推荐证书 (Target)</p>
                                        <p className="font-bold text-indigo-700">{editingLeadData.targetCertifications || '暂无推荐'}</p>
                                    </div>

                                    {/* 证书识别上传入口 - 统一底座版 */}
                                    <div className="col-span-2 mt-2">
                                        <IngestionUploader 
                                            source="certificate"
                                            label="上传现有证书图片"
                                            subLabel="AI 自动识别证书类型与到期日"
                                            onSuccess={(result) => {
                                                const certs = result.data; // CertificateDetail[]
                                                if (certs && certs.length > 0) {
                                                    // Pick the best certificate (e.g. first one)
                                                    const cert = certs[0];
                                                    const newName = cert.name || '未知证书';
                                                    const newDate = cert.expiryDate || '';
                                                    
                                                    setEditingLeadData(prev => {
                                                        const notes = (prev as any).notes || '';
                                                        return {
                                                            ...prev!,
                                                            targetCertifications: prev?.targetCertifications && prev.targetCertifications !== '待挖掘...' 
                                                                ? `${prev.targetCertifications}, ${newName}` 
                                                                : newName,
                                                            targetCertExpiryDate: newDate,
                                                            // @ts-ignore
                                                            notes: `${notes}\n[AI识别] ${newName} (${cert.number || '-'}) - ${newDate}`.trim()
                                                        };
                                                    });
                                                    alert(`✅ 识别成功！\n已提取：${newName}\n到期日：${newDate || '未知'}`);
                                                }
                                            }}
                                            onError={(msg) => alert(`识别失败: ${msg}`)}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Info Fields */}
                            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                                <h3 className="font-bold text-gray-900">基本信息</h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div><label className="block text-xs text-gray-400 font-bold uppercase mb-1">联系电话</label><div className="font-mono">{editingLeadData.mobile || '-'}</div></div>
                                    <div><label className="block text-xs text-gray-400 font-bold uppercase mb-1">微信号</label><div>{editingLeadData.wechat || '-'}</div></div>
                                    <div><label className="block text-xs text-gray-400 font-bold uppercase mb-1">来源渠道</label><div>{editingLeadData.source}</div></div>
                                    <div><label className="block text-xs text-gray-400 font-bold uppercase mb-1">统一信用代码</label><div className="font-mono text-gray-500">{editingLeadData.unifiedSocialCreditCode || '-'}</div></div>
                                    <div className="col-span-2">
                                      <label className="block text-xs text-gray-400 font-bold uppercase mb-1">目标认证到期日（挖角）</label>
                                      {isEditing ? (
                                        <input
                                          type="date"
                                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                                          value={editingLeadData.targetCertExpiryDate || ''}
                                          onChange={e => setEditingLeadData({ ...editingLeadData, targetCertExpiryDate: e.target.value })}
                                        />
                                      ) : (
                                        <div className="font-mono text-gray-700">{editingLeadData.targetCertExpiryDate || '-'}</div>
                                      )}
                                    </div>
                                </div>
                            </div>

                            {/* 工商信息卡片 (Business Info) - Added for Excel Import */}
                            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-black text-slate-800 flex items-center">
                                        <Briefcase className="w-4 h-4 mr-2 text-slate-500" />
                                        工商注册信息
                                    </h3>
                                    <span className="text-[10px] bg-slate-200 text-slate-500 px-2 py-1 rounded-lg font-bold">导入数据</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                    <div>
                                        <label className="block text-slate-400 font-bold mb-1">法定代表人</label>
                                        <div className="text-slate-700 font-medium">{editingLeadData.legalRepresentative || '-'}</div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 font-bold mb-1">注册资本</label>
                                        <div className="text-slate-700 font-medium">{editingLeadData.registeredCapital || '-'}</div>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-slate-400 font-bold mb-1">注册地址</label>
                                        <div className="text-slate-700 font-medium truncate" title={editingLeadData.registeredAddress}>{editingLeadData.registeredAddress || '-'}</div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 font-bold mb-1">成立日期</label>
                                        <div className="text-slate-700 font-medium">{editingLeadData.foundingDate || '-'}</div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 font-bold mb-1">经营状态</label>
                                        <div className="text-slate-700 font-medium">{editingLeadData.operationStatus || '-'}</div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 font-bold mb-1">企业类型</label>
                                        <div className="text-slate-700 font-medium truncate" title={editingLeadData.companyType}>{editingLeadData.companyType || '-'}</div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 font-bold mb-1">发证机构</label>
                                        <div className="text-slate-700 font-medium truncate" title={editingLeadData.issuingBody}>{editingLeadData.issuingBody || '-'}</div>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-slate-400 font-bold mb-1">经营范围</label>
                                        <div className="text-slate-600 leading-relaxed line-clamp-3" title={editingLeadData.businessScope}>{editingLeadData.businessScope || '-'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Follow-up (Localized) */}
                        <div className="space-y-6">
                            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm h-full flex flex-col">
                                <h3 className="font-bold text-gray-900 mb-4">跟进记录</h3>
                                
                                {/* History List */}
                                <div className="flex-1 overflow-y-auto space-y-4 mb-4 max-h-[300px] pr-2 custom-scrollbar">
                                    {editingLeadData.followUpRecords && editingLeadData.followUpRecords.length > 0 ? (
                                        editingLeadData.followUpRecords.map(record => (
                                            <div key={record.id} className="relative pl-4 border-l-2 border-gray-100 pb-1">
                                                <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-blue-200"></div>
                                                <div className="text-xs text-gray-400 font-mono mb-1">{record.date} • {getFollowUpTypeLabel(record.type)}</div>
                                                <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded-lg">{record.content}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center text-gray-300 text-xs py-8">暂无跟进，快去联系客户吧！</div>
                                    )}
                                </div>

                                {/* New Entry Area - Localized & Enhanced */}
                                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                                    {/* Type Selectors */}
                                    <div className="flex space-x-1 mb-2 overflow-x-auto no-scrollbar">
                                        {['call', 'visit', 'wechat', 'email'].map(t => (
                                            <button 
                                                key={t} 
                                                onClick={() => setNewFollowUpType(t as any)}
                                                className={`text-xs px-2 py-1.5 rounded-lg font-bold transition-colors whitespace-nowrap ${newFollowUpType === t ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                                            >
                                                {getFollowUpTypeLabel(t)}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Input & Mic */}
                                    <div className="flex items-center space-x-2 mb-2">
                                        <input 
                                            className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-100" 
                                            placeholder="输入今日沟通重点..." 
                                            value={newFollowUpContent}
                                            onChange={e => setNewFollowUpContent(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleAddFollowUp()}
                                        />
                                        <button className="p-2 text-gray-400 hover:text-indigo-600 bg-white border border-gray-200 rounded-lg transition-colors" title="语音输入 (开发中)">
                                            <Mic className="w-4 h-4" />
                                        </button>
                                        <button onClick={handleAddFollowUp} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm active:scale-95 transition-transform">
                                            <Send className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Quick Tags */}
                                    <div className="flex flex-wrap gap-2">
                                        {QUICK_TAGS.map(tag => (
                                            <button 
                                                key={tag}
                                                onClick={() => setNewFollowUpContent(prev => (prev ? prev + ' ' : '') + tag)}
                                                className="text-[10px] bg-white border border-gray-200 px-2 py-1 rounded-md text-gray-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors flex items-center"
                                            >
                                                <Tag className="w-3 h-3 mr-1 opacity-50" />
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
             </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 animate-in fade-in zoom-in duration-300 border border-gray-100">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-black text-gray-900">新增线索</h2>
                      <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-6 h-6 text-gray-400" /></button>
                  </div>
                  <form onSubmit={handleSubmit} className="space-y-6">
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">客户名称</label>
                          <input required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={newLead.company} onChange={e => setNewLead({...newLead, company: e.target.value})} placeholder="请输入完整公司名，便于 AI 分析" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">联系人</label>
                              <input required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} />
                          </div>
                          <div>
                              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">手机号</label>
                              <input className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={newLead.mobile} onChange={e => setNewLead({...newLead, mobile: e.target.value})} />
                          </div>
                      </div>
                      <div className="flex justify-end pt-4">
                          <button type="submit" className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 shadow-xl shadow-blue-500/20 transition-all active:scale-95">保存线索</button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

export default Leads;
