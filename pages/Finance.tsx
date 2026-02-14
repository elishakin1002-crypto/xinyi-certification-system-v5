
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Wallet, Search, CheckCircle, Clock, AlertCircle, RefreshCcw, Filter, Download, X, AlertTriangle, Upload, FileSpreadsheet, Loader2, DollarSign, Building, User } from 'lucide-react';
import { Receivable, Settlement } from '../types';
import { useLocation, useNavigate } from 'react-router-dom';
import { aiService } from '../services/aiService';

const Finance = () => {
  const { contracts, settlements, toggleReceivableStatus, rejectReceivable, importSettlements, updateSettlementStatus, vendors } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  
  const activeTab = location.pathname.includes('/settlements') ? 'settlements' : 'receivables';
  const initialFilterStatus = (location.state as any)?.filterStatus as ('all' | 'paid' | 'unpaid' | 'overdue') | undefined;
  const initialFilterMonth = (location.state as any)?.filterMonth as string | undefined;
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid' | 'overdue'>(initialFilterStatus || 'all');
  const [filterMonth, setFilterMonth] = useState<string>(initialFilterMonth || '');
  const [settlementTypeFilter, setSettlementTypeFilter] = useState<'All' | 'Internal' | 'External'>('All');
  const [receivableQuery, setReceivableQuery] = useState('');
  const [settlementQuery, setSettlementQuery] = useState('');
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectData, setRejectData] = useState<{contractId: string, receivableId: string, amount: number, customer: string} | null>(null);
  const [rejectReason, setRejectReason] = useState('查无此账 / 金额不符');
  const [isImporting, setIsImporting] = useState(false);

  // ... (Calculations and basic handlers identical)
  useEffect(() => {
    const nextStatus = (location.state as any)?.filterStatus as ('all' | 'paid' | 'unpaid' | 'overdue') | undefined;
    const nextMonth = (location.state as any)?.filterMonth as string | undefined;
    if (nextStatus) setFilterStatus(nextStatus);
    if (typeof nextMonth === 'string') setFilterMonth(nextMonth);
    if (nextStatus || typeof nextMonth === 'string') {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const resolveReceivableStatus = (receivable: Receivable): Receivable['status'] => {
    if (receivable.status === 'paid') return 'paid';
    const dueMs = new Date(String(receivable.dueDate || '')).getTime();
    if (!Number.isFinite(dueMs)) return receivable.status === 'overdue' ? 'overdue' : 'unpaid';
    return dueMs < Date.now() ? 'overdue' : 'unpaid';
  };

  const allReceivables = contracts.flatMap(c => c.receivables.map(r => ({
    ...r,
    displayStatus: resolveReceivableStatus(r),
    contractId: c.id,
    contractTitle: c.title,
    customerName: c.customerName
  })));
  const filteredReceivables = allReceivables
    .filter(r => {
      if (filterStatus !== 'all' && r.displayStatus !== filterStatus) return false;
      if (filterMonth && !(r.dueDate || '').startsWith(filterMonth)) return false;
      if (receivableQuery.trim()) {
        const q = receivableQuery.trim().toLowerCase();
        const haystack = `${r.customerName} ${r.contractTitle} ${r.node}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.dueDate || '2099-12-31').getTime() - new Date(b.dueDate || '2099-12-31').getTime());
  const totalReceivable = allReceivables.reduce((acc, r) => acc + r.amount, 0);
  const totalReceived = allReceivables.filter(r => r.displayStatus === 'paid').reduce((acc, r) => acc + r.amount, 0);
  const totalPending = totalReceivable - totalReceived;
  const collectionRate = totalReceivable > 0 ? (totalReceived / totalReceivable) * 100 : 0;
  const filteredSettlements = settlements
    .filter(s => settlementTypeFilter === 'All' || s.type === settlementTypeFilter)
    .filter(s => {
      if (!settlementQuery.trim()) return true;
      const q = settlementQuery.trim().toLowerCase();
      const haystack = `${s.beneficiary} ${s.contractRef} ${s.notes || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  const totalSettled = filteredSettlements.filter(s => s.status === 'paid').reduce((acc, s) => acc + s.amount, 0);
  const pendingSettlement = filteredSettlements.filter(s => s.status !== 'paid').reduce((acc, s) => acc + s.amount, 0);

  const openRejectModal = (contractId: string, receivableId: string, amount: number, customer: string) => { setRejectData({ contractId, receivableId, amount, customer }); setRejectReason('查无此账 / 金额不符'); setIsRejectModalOpen(true); };
  const handleConfirmReject = () => { if (rejectData && rejectReason.trim()) { rejectReceivable(rejectData.contractId, rejectData.receivableId, rejectReason); setIsRejectModalOpen(false); setRejectData(null); } };

  const handleSettlementImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      try {
          if (!(window as any).XLSX) throw new Error("Excel 解析库未加载");

          const arrayBuffer = await file.arrayBuffer();
          const workbook = (window as any).XLSX.read(arrayBuffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = (window as any).XLSX.utils.sheet_to_json(worksheet);

          const knownVendorNames = vendors.map(v => v.name).join(', ');
          const prompt = `
            Task: Map raw Excel data to 'Settlement' objects for a Consulting Firm.
            
            Rules for 'type' ('Internal' vs 'External'):
            1. 'Internal': Default for individual consultants/employees (e.g., keywords like 提成/Commission, 工资/Salary, 分红/Bonus, 绩效).
            2. 'External': For vendors/suppliers (e.g., keywords like 采购/Procurement, 外包/Outsourcing, 服务费/Service Fee, 供应商).
            3. Context Check:
               - Known Vendors in System: [${knownVendorNames}]. If beneficiary matches these, set type to 'External'.
               - If beneficiary appears to be a company name (ends with Co., Ltd, 公司), set to 'External'.
               - If beneficiary appears to be a person's name (2-3 chars), set to 'Internal'.

            Target Schema: [{ 
                "beneficiary": "Name string", 
                "type": "Internal" | "External",
                "contractRef": "Project/Contract Name string", 
                "month": "YYYY-MM string", 
                "amount": number, 
                "status": "draft" | "confirmed" | "paid"
            }]
            
            Input Data (First 20 rows): ${JSON.stringify(jsonData.slice(0, 20))}
            
            Return JSON Array ONLY.
          `;

          const parsedSettlements = await aiService.generateJSON('kimi-k2.5', prompt);
          
          if (Array.isArray(parsedSettlements) && parsedSettlements.length > 0) {
              const validSettlements: Settlement[] = parsedSettlements.map((s: any, idx: number) => ({
                  id: `S-IMP-${Date.now()}-${idx}`,
                  beneficiary: s.beneficiary || '未知对象',
                  type: s.type || 'Internal',
                  contractRef: s.contractRef || '未关联项目',
                  month: s.month || new Date().toISOString().slice(0, 7),
                  amount: Number(s.amount) || 0,
                  status: s.status || 'draft'
              }));
              importSettlements(validSettlements);
              alert(`成功导入 ${validSettlements.length} 条结算记录！\n已根据名单自动识别内部提成与外包采购。`);
          } else {
              alert("未识别到有效数据，请检查 Excel 格式。");
          }

      } catch (error) {
          console.error("Import failed", error);
          alert("导入失败，请重试。");
      } finally {
          setIsImporting(false);
          e.target.value = ''; 
      }
  };

  const getSettlementStatusText = (status: Settlement['status']) => {
    if (status === 'paid') return '已支付';
    if (status === 'confirmed') return '已确认';
    return '待支付';
  };

  const advanceSettlementStatus = (item: Settlement) => {
    const next = item.status === 'draft' ? 'confirmed' : item.status === 'confirmed' ? 'paid' : 'paid';
    if (next !== item.status) updateSettlementStatus(item.id, next);
  };

  const rollbackSettlementStatus = (item: Settlement) => {
    const prev = item.status === 'paid' ? 'confirmed' : item.status === 'confirmed' ? 'draft' : 'draft';
    if (prev !== item.status) updateSettlementStatus(item.id, prev);
  };

  return (
    <div className="p-6">
       <div className="mb-6 flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">财务中心</h1>
                <p className="text-sm text-gray-500 mt-1">资金流入(回款)与流出(结算)统一管理</p>
            </div>
            <div className="bg-white p-1 rounded-lg border border-gray-200 flex shadow-sm hidden md:flex">
                 <button onClick={() => navigate('/finance')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'receivables' ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}> 回款审核与台账 </button>
                 <button onClick={() => navigate('/finance/settlements')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'settlements' ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}> 支出与结算管理 </button>
            </div>
      </div>
      {activeTab === 'receivables' && ( 
        <div className="space-y-6 animate-in fade-in zoom-in duration-300"> 
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4"> 
                <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-gray-100"> <p className="text-xs text-gray-500 uppercase font-semibold">预计总回款 (AR)</p> <h3 className="text-lg md:text-2xl font-bold text-gray-900 mt-2">¥{totalReceivable.toLocaleString()}</h3> </div> 
                <div className="bg-green-50 p-4 md:p-5 rounded-xl shadow-sm border border-green-100"> <p className="text-xs text-green-700 uppercase font-semibold">实际已到账</p> <h3 className="text-lg md:text-2xl font-bold text-green-700 mt-2">¥{totalReceived.toLocaleString()}</h3> <p className="text-xs text-green-600 mt-1">回款率 {collectionRate.toFixed(1)}%</p> </div> 
                <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-gray-100"> <p className="text-xs text-gray-500 uppercase font-semibold">待收余额</p> <h3 className="text-lg md:text-2xl font-bold text-gray-900 mt-2">¥{totalPending.toLocaleString()}</h3> </div> 
                <div className="bg-red-50 p-4 md:p-5 rounded-xl shadow-sm border border-red-100"> <p className="text-xs text-red-700 uppercase font-semibold">逾期款项</p> <h3 className="text-lg md:text-2xl font-bold text-red-700 mt-2"> {allReceivables.filter(r => r.displayStatus === 'overdue').length} <span className="text-sm font-normal">笔</span> </h3> </div> 
            </div> 
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"> 
                <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-50/50 gap-3"> 
	                    <div className="flex items-center space-x-4 w-full md:w-auto"> 
	                        <h3 className="font-bold text-gray-900 flex items-center shrink-0"> <Wallet className="w-5 h-5 mr-2 text-blue-600" /> <span className="hidden md:inline">资金回款明细</span> <span className="md:hidden">回款明细</span> </h3> 
	                        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 overflow-x-auto no-scrollbar w-full md:w-auto"> 
	                            {['all', 'unpaid', 'overdue', 'paid'].map(status => ( <button key={status} onClick={() => setFilterStatus(status as any)} className={`px-3 py-1 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${filterStatus === status ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`} > {status === 'all' ? '全部' : status === 'paid' ? '已到账' : status === 'unpaid' ? '待回款' : '已逾期'} </button> ))} 
	                        </div> 
	                        {filterMonth && (
	                          <button
	                            onClick={() => setFilterMonth('')}
	                            className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
	                            title="清除月份筛选"
	                          >
	                            月份：{filterMonth} <X className="w-3 h-3 ml-1" />
	                          </button>
	                        )}
	                    </div> 
                    <div className="flex items-center space-x-3 w-full md:w-auto"> 
                        <div className="relative w-full md:w-64"> <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" /> <input type="text" value={receivableQuery} onChange={(e) => setReceivableQuery(e.target.value)} placeholder="搜索客户/节点/合同..." className="pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full" /> </div> 
                        <button className="flex items-center px-3 py-1.5 text-sm border border-gray-200 bg-white text-gray-700 rounded-lg hover:bg-gray-50 shrink-0"> <Download className="w-4 h-4 mr-2" /> <span className="hidden md:inline">导出对账单</span> <span className="md:hidden">导出</span> </button> 
                    </div> 
                </div> 
                
                {/* Desktop Table */}
                <div className="hidden md:block"> 
                    <table className="w-full text-sm text-left"> 
                        <thead className="bg-gray-50/50 text-gray-600 font-bold text-sm uppercase tracking-wider border-b border-gray-100"> 
                            <tr> <th className="px-6 py-4">应收日期</th> <th className="px-6 py-4">客户名称</th> <th className="px-6 py-4">款项节点 (摘要)</th> <th className="px-6 py-4">关联合同</th> <th className="px-6 py-4 text-right">应收金额</th> <th className="px-6 py-4 text-center">状态</th> <th className="px-6 py-4 text-right">财务操作</th> </tr> 
                        </thead> 
                        <tbody className="divide-y divide-gray-100"> 
                            {filteredReceivables.map((r, idx) => ( <tr key={`${r.contractId}-${r.id}-${idx}`} className={`hover:bg-gray-50 transition-colors ${r.displayStatus === 'paid' ? 'bg-gray-50/30' : ''}`}> <td className="px-6 py-5 font-mono text-gray-600 text-sm">{r.dueDate || '待定'}</td> <td className="px-6 py-5 font-black text-gray-900 text-base">{r.customerName}</td> <td className="px-6 py-5 text-gray-700"> <div className="flex items-center"> <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs border border-gray-200 mr-2 whitespace-nowrap"> 第 {r.node.match(/\d+/) ? r.node.match(/\d+/)?.[0] : '-'} 期 </span> <span className="text-sm font-bold">{r.node}</span> </div> {r.rejectionReason && ( <div className="text-xs text-red-600 mt-1 flex items-center bg-red-50 px-2 py-0.5 rounded w-fit"> <AlertCircle className="w-3 h-3 mr-1" /> 已驳回: {r.rejectionReason} </div> )} </td> <td className="px-6 py-5 text-gray-500 text-sm">{r.contractTitle}</td> <td className="px-6 py-5 text-right font-mono font-black text-gray-900 text-base">¥{r.amount.toLocaleString()}</td> <td className="px-6 py-5 text-center"> {r.displayStatus === 'paid' ? ( <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-green-100 text-green-800"> <CheckCircle className="w-3 h-3 mr-1" /> 已核销 </span> ) : r.displayStatus === 'overdue' ? ( <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-red-100 text-red-800"> <AlertCircle className="w-3 h-3 mr-1" /> 已逾期 </span> ) : r.rejectionReason ? ( <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-red-50 text-red-600 border border-red-100"> <RefreshCcw className="w-3 h-3 mr-1" /> 被驳回 </span> ) : ( <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-yellow-100 text-yellow-800"> <Clock className="w-3 h-3 mr-1" /> 待确认 </span> )} </td> <td className="px-6 py-5 text-right"> {r.displayStatus !== 'paid' ? ( <button onClick={() => toggleReceivableStatus(r.contractId, r.id)} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 shadow-sm transition-colors font-bold" > 确认到账 </button> ) : ( <button onClick={() => openRejectModal(r.contractId, r.id, r.amount, r.customerName)} className="text-gray-500 hover:text-red-600 text-xs flex items-center justify-end w-full font-bold" title="纠错/撤销核销状态" > <RefreshCcw className="w-3 h-3 mr-1" /> 驳回/撤销 </button> )} </td> </tr> ))} 
	                            {filteredReceivables.length === 0 && ( <tr> <td colSpan={7} className="px-6 py-12 text-center text-gray-400"> <div className="flex flex-col items-center"> <Filter className="w-8 h-8 mb-2 opacity-50" /> {filterStatus === 'overdue' ? '暂无逾期款项，财务状况良好！' : filterMonth ? `该月份暂无相关回款记录（${filterMonth}）` : '暂无相关回款记录'} </div> </td> </tr> )} 
                        </tbody> 
                    </table> 
                </div> 

                {/* Mobile List View - Receivables */}
                <div className="md:hidden divide-y divide-gray-100">
                    {filteredReceivables.map(r => (
                        <div key={`${r.contractId}-${r.id}`} className="p-4 active:bg-gray-50">
                            <div className="flex justify-between items-start mb-1">
                                <div className="font-medium text-gray-900 truncate pr-2 text-sm">{r.customerName}</div>
                                <div className="font-mono font-bold text-gray-900 text-sm">¥{r.amount.toLocaleString()}</div>
                            </div>
                            <div className="text-sm text-gray-500 mb-2 flex items-center justify-between">
                                <span>{r.node}</span>
                                <span>{r.dueDate}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <div>
                                    {r.displayStatus === 'paid' ? <span className="text-green-600 text-xs flex items-center"><CheckCircle className="w-3 h-3 mr-1"/>已核销</span> : 
                                     r.displayStatus === 'overdue' ? <span className="text-red-600 text-xs flex items-center"><AlertCircle className="w-3 h-3 mr-1"/>已逾期</span> : 
                                     <span className="text-yellow-600 text-xs flex items-center"><Clock className="w-3 h-3 mr-1"/>待确认</span>}
                                </div>
                                {r.displayStatus !== 'paid' ? (
                                    <button onClick={() => toggleReceivableStatus(r.contractId, r.id)} className="px-3 py-1 bg-blue-600 text-white text-xs rounded">确认</button>
                                ) : (
                                    <button onClick={() => openRejectModal(r.contractId, r.id, r.amount, r.customerName)} className="text-gray-400 text-xs">撤销</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div> 
        </div> 
      )}
      {activeTab === 'settlements' && ( 
        <div className="space-y-6 animate-in fade-in zoom-in duration-300"> 
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> 
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between"> <div> <p className="text-xs text-gray-500 uppercase font-semibold">已支付结算 (YTD)</p> <h3 className="text-2xl font-bold text-gray-900 mt-1">¥{totalSettled.toLocaleString()}</h3> </div> <div className="bg-green-50 p-3 rounded-lg text-green-600"> <CheckCircle className="w-6 h-6" /> </div> </div> 
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between"> <div> <p className="text-xs text-gray-500 uppercase font-semibold">待支付/草稿</p> <h3 className="text-2xl font-bold text-orange-600 mt-1">¥{pendingSettlement.toLocaleString()}</h3> </div> <div className="bg-orange-50 p-3 rounded-lg text-orange-600"> <Clock className="w-6 h-6" /> </div> </div> 
            </div> 
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"> 
                <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row justify-between items-center bg-gray-50/50 gap-3"> 
                    <div className="flex items-center space-x-2"> 
                        <h3 className="font-bold text-gray-900 flex items-center mr-4"> <DollarSign className="w-5 h-5 mr-2 text-indigo-600" /> 结算管理 </h3> 
                        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 overflow-x-auto no-scrollbar max-w-[200px] md:max-w-none"> 
                            {['All', 'Internal', 'External'].map(type => ( <button key={type} onClick={() => setSettlementTypeFilter(type as any)} className={`px-3 py-1 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${settlementTypeFilter === type ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`} > {type === 'All' ? '全部' : type === 'Internal' ? '内部提成' : '外包/采购'} </button> ))} 
                        </div> 
                    </div> 
                    <div className="flex items-center gap-2 w-full md:w-auto">
                      <div className="relative w-full md:w-64">
                        <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <input
                          type="text"
                          value={settlementQuery}
                          onChange={(e) => setSettlementQuery(e.target.value)}
                          placeholder="搜索结算对象/合同..."
                          className="pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                        />
                      </div>
                      <div className="relative w-full md:w-auto">
                        <input type="file" accept=".xlsx, .csv" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleSettlementImport} disabled={isImporting} />
                        <button className={`w-full md:w-auto flex items-center justify-center px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm transition-opacity ${isImporting ? 'opacity-70 cursor-not-allowed' : ''}`} disabled={isImporting} > {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />} {isImporting ? 'AI 解析中...' : '导入 Excel 结算单'} </button>
                      </div>
                    </div> 
                </div> 
                
                {/* Desktop Table */}
                <div className="overflow-x-auto hidden md:block"> 
                    <table className="w-full text-sm text-left"> 
                        <thead className="bg-gray-50/50 text-gray-600 font-bold text-sm uppercase tracking-wider border-b border-gray-100"> 
                            <tr>
                              <th className="px-6 py-4">结算类型</th>
                              <th className="px-6 py-4">结算对象</th>
                              <th className="px-6 py-4">关联项目/合同</th>
                              <th className="px-6 py-4">费用说明</th>
                              <th className="px-6 py-4 text-right">结算金额</th>
                              <th className="px-6 py-4 text-center">状态</th>
                              <th className="px-6 py-4 text-right">操作</th>
                            </tr> 
                        </thead> 
                        <tbody className="divide-y divide-gray-100"> 
                            {filteredSettlements.map((s) => (
                              <tr key={s.id} className="hover:bg-gray-50">
                                <td className="px-6 py-5">
                                  {s.type === 'External' ? (
                                    <span className="inline-flex items-center text-xs font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded border border-orange-100 uppercase tracking-tight">
                                      <Building className="w-3 h-3 mr-1" /> 外包采购
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded border border-indigo-100 uppercase tracking-tight">
                                      <User className="w-3 h-3 mr-1" /> 内部提成
                                    </span>
                                  )}
                                </td>
                                <td className="px-6 py-5 font-black text-gray-900 text-base">{s.beneficiary}</td>
                                <td className="px-6 py-5 text-gray-500 text-sm">{s.contractRef}</td>
                                <td className="px-6 py-5 text-gray-500 text-sm">{s.notes || '-'}</td>
                                <td className="px-6 py-5 text-right font-black font-mono text-gray-900 text-base">¥{s.amount.toLocaleString()}</td>
                                <td className="px-6 py-5 text-center">
                                  {s.status === 'paid' && <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold uppercase">已支付</span>}
                                  {s.status === 'confirmed' && <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold uppercase">已确认</span>}
                                  {s.status === 'draft' && <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold uppercase">待支付</span>}
                                </td>
                                <td className="px-6 py-5 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    {s.status !== 'paid' && (
                                      <button
                                        onClick={() => advanceSettlementStatus(s)}
                                        className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 shadow-sm transition-colors font-bold"
                                      >
                                        {s.status === 'draft' ? '确认结算' : '标记支付'}
                                      </button>
                                    )}
                                    {s.status !== 'draft' && (
                                      <button
                                        onClick={() => rollbackSettlementStatus(s)}
                                        className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded hover:bg-gray-50"
                                      >
                                        回退
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))} 
                            {filteredSettlements.length === 0 && ( <tr> <td colSpan={7} className="py-12 text-center text-gray-400"> 暂无结算记录 </td> </tr> )} 
                        </tbody> 
                    </table> 
                </div> 

                {/* Mobile List View - Settlements */}
                <div className="md:hidden divide-y divide-gray-100">
                    {filteredSettlements.map(s => (
                        <div key={s.id} className="p-4 active:bg-gray-50">
                            <div className="flex justify-between items-start mb-1">
                                <div className="font-medium text-gray-900 text-sm">{s.beneficiary}</div>
                                <div className="font-mono font-bold text-gray-900 text-sm">¥{s.amount.toLocaleString()}</div>
                            </div>
                            <div className="text-sm text-gray-500 mb-2 flex items-center justify-between">
                                <span>{s.type === 'Internal' ? '内部提成' : '外包采购'}</span>
                                <span>{s.contractRef}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <div className="text-xs text-gray-400">{s.month}</div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded text-xs ${s.status === 'paid' ? 'bg-green-100 text-green-700' : s.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-800'}`}>
                                      {getSettlementStatusText(s.status)}
                                    </span>
                                    {s.status !== 'paid' && (
                                      <button onClick={() => advanceSettlementStatus(s)} className="px-2 py-0.5 text-[11px] bg-indigo-600 text-white rounded">
                                        {s.status === 'draft' ? '确认' : '支付'}
                                      </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div> 
        </div> 
      )}
      {isRejectModalOpen && rejectData && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-gray-900 flex items-center">
                          <AlertTriangle className="w-5 h-5 text-orange-600 mr-2" /> 撤销核销 / 驳回确认
                      </h3>
                      <button onClick={() => setIsRejectModalOpen(false)} className="text-gray-400 hover:text-gray-600"> <X className="w-5 h-5" /> </button>
                  </div>
                  <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 text-sm text-orange-800 mb-4"> <p>您正在撤销 <strong>{rejectData.customer}</strong> 的 <strong>¥{rejectData.amount.toLocaleString()}</strong> 到账确认。</p> <p className="mt-1 font-medium">请填写原因，系统将通知销售重新核实。</p> </div>
                  <div className="mb-4"> <label className="block text-sm font-medium text-gray-700 mb-1">驳回/撤销原因</label> <div className="space-y-2"> <textarea className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-orange-500 outline-none text-sm" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="例如：银行流水未查到、金额不一致..." ></textarea> </div> </div>
                  <div className="flex justify-end space-x-3"> <button onClick={() => setIsRejectModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm" > 取消 </button> <button onClick={handleConfirmReject} disabled={!rejectReason.trim()} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" > 确认驳回 </button> </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Finance;
