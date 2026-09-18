import {SampleList} from '../components/SampleRow';

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { SampleTr } from '../components/SampleRow';
import { Wallet, Search, CheckCircle, Clock, AlertCircle, RefreshCcw, Filter, Download, X, AlertTriangle, Upload, FileSpreadsheet, Loader2, DollarSign, Building, User } from 'lucide-react';
import { Receivable, Settlement } from '../types';
import { hasContract, isBillable } from '../src/modules/projectCategory';
import { useLocation, useNavigate } from 'react-router-dom';
import { aiService } from '../services/aiService';
import { SearchInput, EmptyState, tableHeadClass, thClass, tdClass, trClass } from '../src/ui';
import { isReceivableOverdue } from '../src/modules/glossary';
import { settlementStatusLabel, FIELD } from '../src/modules/labels';
import { collectionProgress, collectionOnDue } from '../src/modules/cashBasis';

const Finance = () => {
  const { contracts, settlements, projects, toggleReceivableStatus, rejectReceivable, importSettlements, updateSettlementStatus, vendors } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  
  const activeTab = location.pathname.includes('/settlements') ? 'settlements' : 'receivables';
  const initialFilterStatus = (location.state as any)?.filterStatus as ('all' | 'paid' | 'unpaid' | 'overdue') | undefined;
  const initialFilterMonth = (location.state as any)?.filterMonth as string | undefined;
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid' | 'overdue'>(initialFilterStatus || 'all');
  const [filterMonth, setFilterMonth] = useState<string>(initialFilterMonth || '');
  const [dashboardFocus, setDashboardFocus] = useState<any>(null);
  const [dashboardFocusLabel, setDashboardFocusLabel] = useState('');
  const [settlementTypeFilter, setSettlementTypeFilter] = useState<'All' | 'Internal' | 'External'>('All');
  const [settlementStatusFilter, setSettlementStatusFilter] = useState<'all' | 'draft' | 'confirmed' | 'paid'>('all');
  const [receivableQuery, setReceivableQuery] = useState('');
  const [settlementQuery, setSettlementQuery] = useState('');
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectData, setRejectData] = useState<{contractId: string, receivableId: string, amount: number, customer: string} | null>(null);
  const [rejectReason, setRejectReason] = useState('查无此账 / 金额不符');
  const [isImporting, setIsImporting] = useState(false);

  // ... (Calculations and basic handlers identical)
  useEffect(() => {
    const state: any = location.state || {};
    const nextStatus = state.filterStatus as ('all' | 'paid' | 'unpaid' | 'overdue') | undefined;
    const nextMonth = state.filterMonth as string | undefined;
    const focus = state.dashboardFocus;
    if (nextStatus) setFilterStatus(nextStatus);
    if (typeof nextMonth === 'string') setFilterMonth(nextMonth);
    if (focus?.type) {
      setDashboardFocus(focus);
      if (focus.type === 'receivable_month') {
        setFilterStatus('all');
        setFilterMonth(String(focus.month || ''));
        setDashboardFocusLabel('本月应收台账');
      } else if (focus.type === 'paid_month') {
        setFilterStatus('paid');
        setFilterMonth(String(focus.month || ''));
        setDashboardFocusLabel('本月已回款台账');
      } else if (focus.type === 'overdue') {
        setFilterStatus('overdue');
        setDashboardFocusLabel('逾期应收台账');
      } else if (focus.type === 'next_30_days') {
        setFilterStatus('unpaid');
        setDashboardFocusLabel('未来 30 天预计回款');
      } else if (focus.type === 'no_contract_amount') {
        setDashboardFocusLabel('存在回款但无合同总额');
      } else if (focus.type === 'progress_abnormal') {
        setDashboardFocusLabel('回款进度异常');
      } else if (focus.type === 'analysis') {
        setDashboardFocusLabel(focus.analysis === 'industry' ? '行业回款结构' : focus.analysis === 'big_customer' ? '大客户回款占比' : '回款集中度分析');
      } else if (focus.type === 'settlement_status') {
        setSettlementStatusFilter(String(focus.settlementStatus || 'draft') as any);
        setDashboardFocusLabel('待确认结算');
      }
    }
    if (state.filterStatus || typeof nextMonth === 'string' || focus) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  /**
   * 一笔应收该显示成什么 —— 桌面和手机共用这一份。
   *
   * ── 为什么要收口（2026-09-16）────────────────────────────────
   *
   * 桌面表格和手机卡片各写各的，同一个状态两个说法：
   *     已收到钱   桌面「已到账」   手机「已核销」
   *     还没收到   桌面「待回款」   手机「待确认」
   * 而顶上的筛选器写的是「待回款 / 已逾期 / 已到账」——
   * 财务点「待回款」筛出来的行，在手机上每一行却写着「待确认」，
   * 她没法判断这是不是同一件事。
   *
   * 「待确认」本身是个有用的词，但它只该用在**真的有人报备了已收款、
   * 等财务核对**的那一种（r.paymentClaim）。用在所有未付款的行上，
   * 就是词不达意 —— 那条根本没人报备过，就是还没收到钱。
   *
   * 金恩来 2026-09-15：「字段要和实际功能挂钩，不能词不达意。」
   * 导出对账单也走这一份（STATUS_TEXT 已并进来），三处必然一致。
   */
  const receivableStatusLabel = (r: { displayStatus?: string; paymentClaim?: unknown; rejectionReason?: string }) => {
    if (r.displayStatus === 'paid') return '已到账';
    if (r.displayStatus === 'overdue') return '已逾期';
    if (r.rejectionReason) return '被驳回';
    if (r.paymentClaim) return '待确认';   // 有人报备了，等财务核对 —— 名副其实的那一种
    return '待回款';                        // 和筛选器的说法一致
  };

  /** 按自然日比较，和术语表 isReceivableOverdue 的口径一致 */
  const todayStr = new Date().toISOString().slice(0, 10);

  /*
    ── 「今天到期」不算逾期（2026-09-15 修）──────────────────────────

    原来这里把到期日转成时间戳和**此刻**比：
        new Date('2026-09-15').getTime() < Date.now()
    到期日会被解析成当天零点，所以今天早上八点打开页面，
    今天才到期的那笔就已经显示「逾期」了 —— 而客户还有一整天可以付。

    而术语表里的判断是按自然日：`due < today`，今天到期不算逾期。
    同一笔款在工作台和这一页会得到相反的状态，人没法判断要不要打电话催。

    另外原来的写法在日期解析失败时会**沿用记录上已有的 overdue 标记**，
    等于让一个可能早就过时的标志位继续生效。现在统一按术语表算，
    没填到期日就是没填，不是逾期（没约定就没有迟到）。
  */
  const resolveReceivableStatus = (receivable: Receivable): Receivable['status'] => {
    if (receivable.status === 'paid') return 'paid';
    return isReceivableOverdue(receivable, todayStr) ? 'overdue' : 'unpaid';
  };

  const allReceivables = contracts.flatMap(c => c.receivables.map((r, idx) => ({
    ...r,
    displayStatus: resolveReceivableStatus(r),
    paymentClaim: r.paymentClaim,
    contractId: c.id,
    contractTitle: c.title,
    customerName: c.customerName,
    contractAmount: Number(c.amount || 0),
    /*
      ── 期数就是它在本合同里排第几，不要从文字里猜（2026-09-14）────

      原来界面上写的是 `第 {r.node.match(/\d+/)?.[0]} 期` ——
      **从节点名里抓第一串数字当期数**。
      于是节点叫「甲方收到 ISO14001/ISO45001 认证电子版证书时」的那条，
      屏幕上显示成「第 14001 期」。金恩来让 Codex 走查时抓到的。

      这是「看起来像 X 就当 X」在这个项目里的第六次
      （前五次见 CLAUDE.md 二点五）。判据同样成立：
      这条规则要不要随着别人怎么写节点名而更新？要 —— 所以它早晚会错。

      真正的期数本来就有：应收在合同里的顺序。直接取，不用猜。
    */
    periodIndex: idx + 1
  })));
  const matchesReceivableFocus = (receivable: typeof allReceivables[number]) => {
    if (!dashboardFocus?.type) return true;
    if (dashboardFocus.contractId && receivable.contractId !== dashboardFocus.contractId) return false;
    if (dashboardFocus.type === 'next_30_days') {
      const diff = Math.ceil((new Date(String(receivable.dueDate || '')).getTime() - Date.now()) / (24 * 3600 * 1000));
      return receivable.displayStatus !== 'paid' && diff >= 0 && diff <= 30;
    }
    if (dashboardFocus.type === 'no_contract_amount') return Number(receivable.contractAmount || 0) <= 0 && Number(receivable.amount || 0) > 0;
    if (dashboardFocus.type === 'progress_abnormal') return Number(receivable.contractAmount || 0) > 0 && Number(receivable.amount || 0) / Number(receivable.contractAmount || 1) > 0.5;
    return true;
  };
  /*
    ── 导出对账单（2026-09-16 补）────────────────────────────────

    这个按钮原来**只是个壳**：没有 onClick、不在表单里，点下去什么都不发生。
    而它长得和能用的按钮一模一样（白底描边、带下载图标、有 hover），
    财务点了会以为系统坏了，或者以为导出失败了去找人。

    导的是**当前筛选后的结果**，不是全量 —— 人筛了半天状态和月份，
    导出却给他一整本，那这个按钮等于没用。

    金额**不要再换算**。库里存的确实是「分」（CLAUDE.md 第 4 条），
    但仓储层 `kind: 'amount'` 已经自动 ÷100 过一次，
    到前端时 r.amount 就是「元」了 —— 页面上那个 ¥18,000 就是这么来的。

    我第一版在这里又除了一次 100，导出来变成 100.00 / 80.00，
    小了一百倍。是导出后打开文件对了一眼数字才发现的 ——
    「改完要验原本正常的东西还正常」，这次验的是我自己刚写的东西。

    加 BOM：Excel 打开无 BOM 的 UTF-8 CSV 会把中文显示成乱码，
    而这份文件就是给人用 Excel 打开的。
  */
  const exportReceivables = () => {
    if (filteredReceivables.length === 0) {
      alert('当前筛选条件下没有应收记录，先放宽筛选再导出。');
      return;
    }
    const cell = (v: unknown) => {
      const text = String(v ?? '');
      // 逗号、引号、换行都要包起来，否则一个带逗号的客户名就把整列错开
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const header = ['到期日', '客户', '合同', FIELD.receivableNode, '期数', '金额(元)', '状态'];
    const rows = filteredReceivables.map(r => [
      r.dueDate || '待定',
      r.customerName,
      r.contractTitle,
      r.node,
      r.periodIndex ?? '',
      Number(r.amount || 0).toFixed(2),   // 已经是「元」，别再 ÷100
      receivableStatusLabel(r),   // 和界面上显示的完全一致，不另起一套
    ].map(cell).join(','));

    const csv = '\uFEFF' + [header.map(cell).join(','), ...rows].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `应收对账单-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const filteredReceivables = allReceivables
    .filter(r => {
      if (filterStatus !== 'all' && r.displayStatus !== filterStatus) return false;
      if (filterMonth && !(r.dueDate || '').startsWith(filterMonth)) return false;
      if (!matchesReceivableFocus(r)) return false;
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
  /*
    回款率的分母是**合同总额**，不是"回款节点计划总额"（2026-09-18 统一）。

    金恩来：「我们之前没有算回款率，但一般是倾向于真实的回款进度。」
    拿计划总额当分母会把数据缺失藏起来 —— 少录一期回款节点，
    分母变小，回款率反而变好看。合同签了 10 万只录了 6 万的节点，
    收到 6 万就显示 100%，而实际上还有 4 万没人跟。

    所以缺口（planGap）要暴露出来让人去补，不是换个分母绕过去。
    口径见 src/modules/cashBasis.ts。
  */
  const 回款进度 = collectionProgress(contracts);
  const collectionRate = (回款进度.rate ?? 0) * 100;
  /*
    催收效果 —— 已经到期的钱收上来多少（2026-09-18 补）。

    光看「回款率」（已收 ÷ 合同总额）会误判：昨天刚签的合同显示 0%，
    那是正常的（钱还没到期），不是催收出了问题。
    成熟系统一定是成对的：一个看**进度**，一个看**催收**。
    这一个把未到期的钱排除在分母外，所以它跌下来就一定是真的该收没收到。
  */
  const 催收 = collectionOnDue(contracts);
  const filteredSettlements = settlements
    .filter(s => settlementTypeFilter === 'All' || s.type === settlementTypeFilter)
    .filter(s => settlementStatusFilter === 'all' || s.status === settlementStatusFilter)
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

  // 口径收在 labels.ts：draft=待确认结算、confirmed=待支付、paid=已支付（B06）
  const getSettlementStatusText = (status: Settlement['status']) => settlementStatusLabel(status);

  const advanceSettlementStatus = (item: Settlement) => {
    const next = item.status === 'draft' ? 'confirmed' : item.status === 'confirmed' ? 'paid' : 'paid';
    if (next !== item.status) updateSettlementStatus(item.id, next);
  };

  const rollbackSettlementStatus = (item: Settlement) => {
    const prev = item.status === 'paid' ? 'confirmed' : item.status === 'confirmed' ? 'draft' : 'draft';
    if (prev !== item.status) updateSettlementStatus(item.id, prev);
  };

  /**
   * 收钱但没挂合同的项目。
   *
   * ── 为什么是提醒，不是关卡（2026-09-08）────────────────────
   *
   * 金恩来：「有些项目小比如台账指导可能就没有签合同，
   * 或者有些项目是先执行，后补合同。」
   *
   * 所以建项目时**不再要求先有合同** —— 拿合同当前提，这些活就进不了系统，
   * 而进不了系统就等于工时、进度、谁在做全部回到微信群里。
   *
   * 但「收了钱却没有合同」这件事本身是要有人知道的：对账、外审、
   * 真出纠纷时它就是风险。所以放在这里提醒，**看得见，但不挡路**。
   * 有些确实就是不会签合同（小额台账指导），忽略它也没关系 ——
   * 这一栏的作用是让人**知道有这么几笔**，不是逼人补齐。
   */
  const missingContract = useMemo(() => (projects || []).filter(p => (
    p.projectCategory === 'Delivery' && isBillable(p) && !hasContract(p)
  )), [projects]);

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
      {dashboardFocusLabel && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
            工作台焦点：{dashboardFocusLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              setDashboardFocus(null);
              setDashboardFocusLabel('');
              setFilterStatus('all');
              setFilterMonth('');
              setSettlementStatusFilter('all');
            }}
            className="text-xs font-bold text-gray-500 hover:text-gray-700"
          >
            清除焦点
          </button>
        </div>
      )}

      {missingContract.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-amber-900">
                有 {missingContract.length} 个收费项目还没关联合同
              </p>
              <p className="mt-0.5 text-[12px] font-bold leading-relaxed text-amber-800/90">
                没签、口头约定、先干后补都会出现在这里。这是提醒，不是错误 ——
                小额台账指导这类本来就可能不签合同，看一眼心里有数就行；
                真要补的，去合同管理录进来，再回项目里关联一下。
              </p>
              <ul className="mt-2 space-y-1">
                {missingContract.slice(0, 6).map(p => (
                  <li key={p.id} className="flex items-center gap-2 text-[12px] font-bold text-amber-900">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-amber-700/70">
                      {Number(p.projectAmount || 0) > 0 ? `¥${Number(p.projectAmount).toLocaleString()}` : '金额未填'}
                    </span>
                  </li>
                ))}
                {missingContract.length > 6 && (
                  <li className="text-[11px] font-bold text-amber-700/70">…还有 {missingContract.length - 6} 个</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'receivables' && ( 
        <div className="space-y-6 animate-in fade-in zoom-in duration-300"> 
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-blue-200 transition-colors">
                    <div className="p-3 bg-blue-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><Wallet className="w-6 h-6 text-blue-600" /></div>
                    <div className="min-w-0">
                        <div className="text-2xl font-black text-gray-900 truncate">¥{totalReceivable.toLocaleString()}</div>
                        <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">预计总回款 (AR)</div>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-emerald-200 transition-colors">
                    <div className="p-3 bg-emerald-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><CheckCircle className="w-6 h-6 text-emerald-600" /></div>
                    <div className="min-w-0">
                        <div className="text-2xl font-black text-gray-900 truncate">¥{totalReceived.toLocaleString()}</div>
                        <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">
                          实际已到账 · 回款率 {回款进度.rate === null ? '—' : `${collectionRate.toFixed(1)}%`}
                          <span className="ml-1 normal-case font-normal text-gray-400">（已收 ÷ 合同总额，看进度）</span>
                        </div>
                        {/*
                          两个指标成对显示，各答一个问题（行业标准做法）：
                            回款率   已收 ÷ 合同总额     → 这单收了多少（进度）
                            催收率   已收 ÷ 已到期应收   → 该收的收上来没有（催收效果）
                          只看前者会误判：刚签的合同 0% 是正常的，钱还没到期。
                        */}
                        <div className="mt-1 text-[11px] font-bold">
                          {催收.rate === null ? (
                            <span className="text-gray-400">还没有任何一笔到期 —— 催收这一项现在无从谈起。</span>
                          ) : (
                            <span className={催收.overdue > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                              已到期的 ¥{催收.due.toLocaleString()} 里收到 {(催收.rate * 100).toFixed(1)}%
                              {催收.overdue > 0 && <>，<b>还差 ¥{催收.overdue.toLocaleString()} 该收没收到</b></>}
                            </span>
                          )}
                        </div>
                        {回款进度.planGap > 0 && (
                          <div className="mt-1 text-[11px] text-amber-700">
                            有 ¥{回款进度.planGap.toLocaleString()} 的合同金额还没拆进回款节点 —— 这部分没人跟。
                          </div>
                        )}
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-amber-200 transition-colors">
                    <div className="p-3 bg-amber-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><Clock className="w-6 h-6 text-amber-600" /></div>
                    <div className="min-w-0">
                        <div className="text-2xl font-black text-gray-900 truncate">¥{totalPending.toLocaleString()}</div>
                        <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">待收余额</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-rose-500 to-red-600 p-5 rounded-2xl shadow-lg flex items-center text-white">
                    <div className="p-3 bg-white/20 rounded-xl mr-4"><AlertTriangle className="w-6 h-6" /></div>
                    <div className="min-w-0">
                        <div className="text-2xl font-black">{allReceivables.filter(r => r.displayStatus === 'overdue').length} <span className="text-base font-bold opacity-80">笔</span></div>
                        <div className="text-xs opacity-80 font-bold uppercase tracking-tight">逾期款项</div>
                    </div>
                </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"> 
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
                        <button type="button" onClick={exportReceivables} title={`导出当前筛选的 ${filteredReceivables.length} 条应收记录`} className="flex items-center px-3 py-1.5 text-sm border border-gray-200 bg-white text-gray-700 rounded-lg hover:bg-gray-50 shrink-0"> <Download className="w-4 h-4 mr-2" /> <span className="hidden md:inline">导出对账单</span> <span className="md:hidden">导出</span> </button> 
                    </div> 
                </div> 
                
                {/* Desktop Table */}
                <div className="hidden md:block"> 
                    <table className="w-full text-sm text-left"> 
                        <thead className={tableHeadClass}> 
                            <tr>
                              <th className={thClass}>应收日期</th>
                              <th className={thClass}>客户名称</th>
                              <th className={thClass}>{FIELD.receivableNode}（摘要）</th>
                              <th className={thClass}>关联合同</th>
                              <th className={`${thClass} text-right`}>应收金额</th>
                              <th className={`${thClass} text-center`}>状态</th>
                              <th className={`${thClass} text-right`}>财务操作</th>
                            </tr> 
                        </thead> 
                        <tbody className="divide-y divide-gray-100"> 
                            {/* 样例行：让引导有个能指的对象，不是对着空表讲 */}


                            <SampleList items={filteredReceivables} sample={{id: 'sample-receivable', contractId: 'sample-contract', contractNo: 'XY-SAMPLE-001', customerName: '示例包装有限公司', amount: 3000, node: '示例付款节点', contractTitle: '示例服务合同', paymentClaim: undefined, displayStatus: 'unpaid', status: 'unpaid', dueDate: '2026-09-09', contractAmount: 30000, periodIndex: 1} as (typeof filteredReceivables)[number]} render={(r, idx) => (
                              <tr key={`${r.contractId}-${r.id}-${idx}`} className={`hover:bg-gray-50 transition-colors ${r.displayStatus === 'paid' ? 'bg-gray-50/30' : ''}`}>
                                <td className={`${tdClass} font-mono text-gray-600 text-sm`}>{r.dueDate || '待定'}</td>
                                <td className={`${tdClass} font-black text-gray-900 text-base`}>{r.customerName}</td>
                                <td className={`${tdClass} text-gray-700`}>
                                  <div className="flex items-center">
                                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs border border-gray-200 mr-2 whitespace-nowrap"> 第 {r.periodIndex ?? '-'} 期 </span>
                                    <span className="text-sm font-bold">{r.node}</span>
                                  </div>
                                  {r.rejectionReason && (
                                    <div className="text-xs text-red-600 mt-1 flex items-center bg-red-50 px-2 py-0.5 rounded w-fit">
                                      <AlertCircle className="w-3 h-3 mr-1" /> 已驳回: {r.rejectionReason}
                                    </div>
                                  )}
                                </td>
                                <td className={`${tdClass} text-gray-500 text-sm`}>
                                  <div className="truncate">{r.contractTitle}</div>
                                  {/* 销售报备「已收款」——财务据此优先核对，并知道找谁问 */}
                                  {r.paymentClaim && r.displayStatus !== 'paid' && (
                                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-700">
                                      <AlertCircle className="w-3 h-3 shrink-0" />
                                      <span className="truncate">
                                        {r.paymentClaim.claimedBy} 报备已收款
                                        {r.paymentClaim.note ? ` · ${r.paymentClaim.note}` : ''}
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td className={`${tdClass} text-right font-mono font-black text-gray-900 text-base`}>¥{r.amount.toLocaleString()}</td>
                                <td className={`${tdClass} text-center`}>
                                  {r.displayStatus === 'paid' ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" /> {receivableStatusLabel(r)}</span>
                                  ) : r.displayStatus === 'overdue' ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-red-100 text-red-800"><AlertCircle className="w-3 h-3 mr-1" /> {receivableStatusLabel(r)}</span>
                                  ) : r.rejectionReason ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-red-50 text-red-600 border border-red-100"><RefreshCcw className="w-3 h-3 mr-1" /> {receivableStatusLabel(r)}</span>
                                  ) : r.paymentClaim ? (
                                    /*
                                      「待确认」名副其实的那一种：有人报备了已收款，等财务核对到账。
                                    */
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" /> {receivableStatusLabel(r)}</span>
                                  ) : (
                                    /*
                                      ── 没人报备的就叫「待回款」（2026-09-16 修）──────────────

                                      这一支原来也写「待确认」，于是同一个状态在同一屏上有两个说法：
                                          筛选器      「待回款」
                                          行里的徽章  「待确认」
                                      财务点「待回款」筛出来的行，每一行却写着「待确认」，
                                      她没法判断这是不是同一件事。

                                      而且「待确认」有误导：它听起来像"已经报备了、等我核对"，
                                      实际上这条根本没人报备过 —— 就是还没收到钱。
                                      真正该叫「待确认」的是上面那一支（有 paymentClaim）。

                                      金恩来 2026-09-15：「字段要和实际功能挂钩，不能词不达意。」
                                    */
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold uppercase bg-gray-100 text-gray-700"><Clock className="w-3 h-3 mr-1" /> {receivableStatusLabel(r)}</span>
                                  )}
                                </td>
                                <td className={`${tdClass} text-right`}>
                                  {r.displayStatus !== 'paid' ? (
                                    <button onClick={() => toggleReceivableStatus(r.contractId, r.id)} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 shadow-sm transition-colors font-bold">确认到账</button>
                                  ) : (
                                    <button onClick={() => openRejectModal(r.contractId, r.id, r.amount, r.customerName)} className="text-gray-500 hover:text-red-600 text-xs flex items-center justify-end w-full font-bold" title="纠错/撤销核销状态"><RefreshCcw className="w-3 h-3 mr-1" /> 驳回/撤销</button>
                                  )}
                                </td>
                              </tr>
                            )} />
	                            {filteredReceivables.length === 0 && (
                              <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                                  <div className="flex flex-col items-center">
                                    <Filter className="w-8 h-8 mb-2 opacity-50" />
                                    {filterStatus === 'overdue' ? '暂无逾期款项，财务状况良好！' : filterMonth ? `该月份暂无相关回款记录（${filterMonth}）` : '暂无相关回款记录'}
                                  </div>
                                </td>
                              </tr>
                            )} 
                        </tbody> 
                    </table> 
                </div> 

                {/* Mobile List View - Receivables */}
                <div className="md:hidden divide-y divide-gray-100">
                    <SampleList items={filteredReceivables} sample={{id: 'sample-receivable', contractId: 'sample-contract', contractNo: 'XY-SAMPLE-001', customerName: '示例包装有限公司', amount: 3000, node: '示例付款节点', contractTitle: '示例服务合同', paymentClaim: undefined, displayStatus: 'unpaid', status: 'unpaid', dueDate: '2026-09-09', contractAmount: 30000} as unknown as (typeof filteredReceivables)[number]} render={r => (
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
                                    {/* 文案走 receivableStatusLabel，和桌面表格、导出文件同一份 */}
                                    {r.displayStatus === 'paid' ? <span className="text-green-600 text-xs flex items-center"><CheckCircle className="w-3 h-3 mr-1"/>{receivableStatusLabel(r)}</span> : 
                                     r.displayStatus === 'overdue' ? <span className="text-red-600 text-xs flex items-center"><AlertCircle className="w-3 h-3 mr-1"/>{receivableStatusLabel(r)}</span> : 
                                     <span className="text-gray-600 text-xs flex items-center"><Clock className="w-3 h-3 mr-1"/>{receivableStatusLabel(r)}</span>}
                                </div>
                                {r.displayStatus !== 'paid' ? (
                                    <button onClick={() => toggleReceivableStatus(r.contractId, r.id)} className="px-3 py-1 bg-blue-600 text-white text-xs rounded">确认</button>
                                ) : (
                                    <button onClick={() => openRejectModal(r.contractId, r.id, r.amount, r.customerName)} className="text-gray-400 text-xs">撤销</button>
                                )}
                            </div>
                        </div>
                    )} />
                </div>
            </div> 
        </div> 
      )}
      {activeTab === 'settlements' && ( 
        <div className="space-y-6 animate-in fade-in zoom-in duration-300"> 
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-emerald-200 transition-colors">
                    <div className="p-3 bg-emerald-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><CheckCircle className="w-6 h-6 text-emerald-600" /></div>
                    <div className="min-w-0">
                        <div className="text-2xl font-black text-gray-900 truncate">¥{totalSettled.toLocaleString()}</div>
                        {/*
                          ── 不叫 YTD（2026-09-17 改名）──────────────────────

                          YTD 是"本年截至今天"，而这个数
                          （totalSettled）只是把**当前筛选结果**里 paid 的加起来，
                          没有任何年份条件 —— 去年的记录照样算进去。
                          财务拿它当"今年一共付了多少"，跨年之后就会偏。

                          它确实跟着筛选走（类型、状态、搜索都会影响），
                          所以按它实际的样子命名。
                        */}
                        <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">已支付结算（当前筛选）</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-5 rounded-2xl shadow-lg flex items-center text-white">
                    <div className="p-3 bg-white/20 rounded-xl mr-4"><Clock className="w-6 h-6" /></div>
                    <div className="min-w-0">
                        <div className="text-2xl font-black truncate">¥{pendingSettlement.toLocaleString()}</div>
                        {/* 这张卡算的是 status !== paid，含待确认和待支付两档 ——
                            所以它一定大于筛选「待支付」的金额，标题要说清（B06） */}
                        <div className="text-xs opacity-80 font-bold uppercase tracking-tight">未支付结算金额（含待确认）</div>
                    </div>
                </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"> 
                <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row justify-between items-center bg-gray-50/50 gap-3"> 
                    <div className="flex items-center space-x-2"> 
                        <h3 className="font-bold text-gray-900 flex items-center mr-4"> <DollarSign className="w-5 h-5 mr-2 text-indigo-600" /> 结算管理 </h3> 
                        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 overflow-x-auto no-scrollbar max-w-[200px] md:max-w-none"> 
                            {['All', 'Internal', 'External'].map(type => ( <button key={type} onClick={() => setSettlementTypeFilter(type as any)} className={`px-3 py-1 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${settlementTypeFilter === type ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`} > {type === 'All' ? '全部' : type === 'Internal' ? '内部提成' : '外包/采购'} </button> ))} 
                        </div>
                        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 overflow-x-auto no-scrollbar max-w-[240px] md:max-w-none"> 
                            {['all', 'draft', 'confirmed', 'paid'].map(status => ( <button key={status} onClick={() => setSettlementStatusFilter(status as any)} className={`px-3 py-1 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${settlementStatusFilter === status ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`} > {status === 'all' ? '全部状态' : settlementStatusLabel(status)} </button> ))} 
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
                        <thead className={tableHeadClass}> 
                            <tr>
                              <th className={thClass}>结算类型</th>
                              <th className={thClass}>结算对象</th>
                              <th className={thClass}>关联项目/合同</th>
                              <th className={thClass}>费用说明</th>
                              <th className={`${thClass} text-right`}>结算金额</th>
                              <th className={`${thClass} text-center`}>状态</th>
                              <th className={`${thClass} text-right`}>操作</th>
                            </tr> 
                        </thead> 
                        <tbody className="divide-y divide-gray-100"> 
                            <SampleList items={filteredSettlements} sample={{id: 'sample-settlement', beneficiary: '示例顾问', type: 'Internal', month: '2026-09', amount: 1200, status: 'draft', contractRef: 'XY-SAMPLE-001', date: '2026-09-09'} as (typeof filteredSettlements)[number]} render={(s) => (
                              <tr key={s.id} className="hover:bg-gray-50">
                                <td className={tdClass}>
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
                                <td className={`${tdClass} font-black text-gray-900 text-base`}>{s.beneficiary}</td>
                                <td className={`${tdClass} text-gray-500 text-sm`}>{s.contractRef}</td>
                                <td className={`${tdClass} text-gray-500 text-sm`}>{s.notes || '-'}</td>
                                <td className={`${tdClass} text-right font-black font-mono text-gray-900 text-base`}>¥{s.amount.toLocaleString()}</td>
                                <td className={`${tdClass} text-center`}>
                                  {s.status === 'paid' && <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold uppercase">{settlementStatusLabel('paid')}</span>}
                                  {s.status === 'confirmed' && <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold uppercase">{settlementStatusLabel('confirmed')}</span>}
                                  {s.status === 'draft' && <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold uppercase">{settlementStatusLabel('draft')}</span>}
                                </td>
                                <td className={`${tdClass} text-right`}>
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
                            )} />
                            {filteredSettlements.length === 0 && (
                              <tr>
                                <td colSpan={7} className="py-12 text-center text-gray-400">暂无结算记录</td>
                              </tr>
                            )} 
                        </tbody> 
                    </table> 
                </div> 

                {/* Mobile List View - Settlements */}
                <div className="md:hidden divide-y divide-gray-100">
                    <SampleList items={filteredSettlements} sample={{id: 'sample-settlement', beneficiary: '示例顾问', type: 'Internal', month: '2026-09', amount: 1200, status: 'draft', contractRef: 'XY-SAMPLE-001', date: '2026-09-09'} as (typeof filteredSettlements)[number]} render={s => (
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
                    )} />
                </div>
            </div> 
        </div> 
      )}
      {isRejectModalOpen && rejectData && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
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
