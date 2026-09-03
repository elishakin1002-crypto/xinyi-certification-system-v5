
import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sparkles, Loader2, User, Bot, Mic, Zap, Trash2, Paperclip, FileText, FileSpreadsheet, Image as ImageIcon, FileCheck, FileCode, CheckCircle2, ArrowRight, BellRing, Globe, Database } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { rankDocs } from '../src/modules/knowledge/retrieval';
import { aiService } from '../services/aiService'; 
import { dataService } from '../services/dataService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildSystemGuideReply } from '../src/modules/ai_center';
import { gateAiActions, AI_ACTION_PERMISSION, AI_ACTION_LABEL } from '../src/modules/ai_center/actionPermissions';
import { isEmptyPromise, EMPTY_PROMISE_NOTICE } from '../src/modules/ai_center/emptyPromise';
import { checkActionIntent, buildIntentPrompt } from '../src/modules/ai_center/intentGuard';
import { buildIdentityContext } from '../src/modules/ai_center/identityContext';
import { aiProposalService } from '../services/aiProposalService';
import { HIGH_RISK_ACTIONS, buildProposalFor } from '../src/modules/ai_center/highRisk';
import {
  buildGlobalSearchGroups,
  buildGlobalSearchReplyMarkdown,
  detectGlobalSearchIntent,
  resolveSearchScopesByPermissions
} from '../src/modules/global_search';

// Add global definition for Web Speech API & library mocks
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    mammoth: any;
    XLSX: any;
  }
}

interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: Date;
  attachments?: { name: string; type: string; }[];
  isExecuted?: boolean; // 标记是否已执行系统操作
  actionType?: string; // 标记执行的动作类型
  sources?: { uri: string; title: string }[]; // New: For Web Search Grounding
  ragDocs?: string[]; // New: List of Knowledge Docs referenced
  requestMeta?: {
    model: string;
    budgetTokens: number;
    estimatedTokens: number;
    usagePct: number;
    sourceSummary: string;
    systemPromptChars: number;
    historyMessages: number;
    historyChars: number;
    userInputChars: number;
    ragDocsCount: number;
    ragChars: number;
    ragDocTitles: string[];
    webSearchEnabled: boolean;
    fileAttached: boolean;
    fileType?: string;
    fileBinaryKB?: number;
    notes: string[];
  };
}

const DEFAULT_WELCOME_MSG: Message = {
  id: 'welcome',
  role: 'model',
  text: '你好！我是信义系统 AI 助手。👋\n\n**我是整个系统的总控入口**。您可以直接把**证书、合同或政策文件**发给我，我会自动将其归档到对应的客户名下。\n\n或者问我：\n*   “帮我查一下欧盟最新的电池法案”\n*   “知识库里关于 ISO 9001 的实施要点是什么？”\n*   “提醒我下周一联系吴氏医药”',
  timestamp: new Date()
};

const MAX_RAG_DOCS = 4;
// 检索逻辑单独成模块，便于测试——见 tests/knowledge-retrieval.test.js
const MAX_RAG_SNIPPET = 700;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 900;

const clampText = (text: unknown, max: number) => {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw.length > max ? `${raw.slice(0, max)}...[truncated]` : raw;
};

const estimateTokens = (text: unknown): number => {
  const raw = String(text || '');
  if (!raw) return 0;
  const cjkCount = (raw.match(/[\u3400-\u9fff]/g) || []).length;
  const otherCount = Math.max(0, raw.length - cjkCount);
  return Math.ceil(cjkCount * 1.1 + otherCount / 4);
};

const hasWebIntent = (query: string) => /最新|政策|法规|新闻|今天|今日|最近|动态|情报|通知|招标|招采|联网|搜索|查一下/i.test(String(query || ''));
const hasKnowledgeIntent = (query: string) => {
  const q = String(query || '').trim();
  if (!q || q.length < 3) return false;
  return /知识库|文档|资料|制度|标准|流程|模板|规范|依据|案例|历史|公司情况|我们公司|信义|客户资料|合同样本/i.test(q);
};

const AIChatWidget = () => {
  const {
    addContract,
    addReminder,
    addCustomer,
    addLead,
    addLeadFollowUp,
    addCustomerFollowUp,
    addProject,
    completeProject,
    toggleReceivableStatus,
    convertSignalToFollowUpProject,
    leads,
    customers,
    contracts,
    projects,
    knowledgeDocs,
    checkActionPermission,
    currentUser,
    activeRole,
    userPermissions
  } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
      const saved = dataService.get<any[]>('chat_history', []);
      if (saved && saved.length > 0) return saved.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
      return [DEFAULT_WELCOME_MSG];
  });

  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  
  const [pendingFile, setPendingFile] = useState<{ name: string; data: string; mimeType: string; content?: string; type: 'image' | 'doc' | 'sheet' | 'pdf' } | null>(null);
  
  // V5.0: Active Context for Objection Handling (Sales Scripting)
  const [activeContext, setActiveContext] = useState<{name: string, info: string} | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const speechSeedRef = useRef('');
  const speechFinalRef = useRef('');

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isOpen]);
  useEffect(() => { dataService.set('chat_history', messages); }, [messages]);

  // Listener for external triggers (Script Generation)
  useEffect(() => {
    const handleScriptTrigger = (event: Event) => {
        const customEvent = event as CustomEvent;
        const { context } = customEvent.detail;
        
        if (context) {
            setIsOpen(true);
            setActiveContext(context);
            
            // Add a visual context marker
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `### 🛡️ 已建立销售参谋模式\n**当前客户**：${context.name}\n\n${context.info}\n\n---\n**请直接输入客户疑议**（如“太贵了”），我将立即给出**1条**直击痛点的回复话术。`,
                timestamp: new Date()
            }]);
        }
    };

    window.addEventListener('trigger-ai-script', handleScriptTrigger);
    return () => window.removeEventListener('trigger-ai-script', handleScriptTrigger);
  }, []);

  useEffect(() => {
    const SpeechApi = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechApi) {
      setSpeechSupported(false);
      return;
    }

    setSpeechSupported(true);
    const recognition = new SpeechApi();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = String(event.results[i]?.[0]?.transcript || '');
        if (event.results[i].isFinal) {
          speechFinalRef.current += `${transcript} `;
        } else {
          interim += transcript;
        }
      }
      const nextText = `${speechSeedRef.current}${speechFinalRef.current}${interim}`.trim();
      setInputValue(nextText);
    };

    recognition.onerror = (event: any) => {
      const code = String(event?.error || '');
      setIsListening(false);
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        alert('语音权限被拒绝，请在浏览器中允许麦克风权限。');
      } else if (code !== 'aborted') {
        alert(`语音识别失败：${code || 'unknown error'}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      const stableText = `${speechSeedRef.current}${speechFinalRef.current}`.trim();
      if (stableText) setInputValue(stableText);
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {
        // noop
      }
      recognitionRef.current = null;
    };
  }, []);

  // --------------------------------------------------------------------------
  // 核心功能：解析 AI 文本中的 JSON 块并执行系统操作
  // --------------------------------------------------------------------------
  const executeSystemActions = async (text: string, userMessage: string): Promise<string | null> => {
    try {
      // 匹配被特定的标记包裹的 JSON 块
      const actionRegex = /<execute_action>([\s\S]*?)<\/execute_action>/;
      const match = text.match(actionRegex);
      
      if (match && match[1]) {
        const actionData = JSON.parse(match[1].trim());

        /*
          ── 动作权限总闸（2026-08-31 补）──────────────────────────
          AI 对话框是一条**绕过界面的通道**：界面上顾问看不到「确认回款」按钮，
          但他可以对 AI 说「确认某某合同的钱到账了」。
          在这之前 11 个动作里只有 2 个做了校验，confirm_receivable 这种
          **不可撤销的财务动作**是裸奔的。

          放在这里、放在任何一个动作执行之前：先整批判定，
          有一个不许就整批不做。不能「能做的先做」——
          那会留下「合同建了但回款没确认」这种半成品，
          用户以为办完了，实际账目是错的。
        */
        /*
          ── 意图核对（2026-08-31 补）────────────────────────────
          老板打了一句「在吗」，AI 回「收到，现在执行系统自我诊断并自动修复」，
          然后真的跑了一遍全系统自检。

          模型不是笨，是**从上下文惯性推断**——前面几轮都在做自检，它顺着接下去。
          而这里原本照单全收：AI 说要执行就执行，**从没核对过用户是不是真要这个**。

          只核对高风险的那几个（自检、确认回款、完成项目）。
          低风险动作推错了删掉重录就行，逐个都要求逐字对上，AI 就没法用了。
          放在权限闸之前：连意图都不成立的动作，不必再去谈权限。
        */
        const intent = checkActionIntent(actionData, userMessage);
        if (!intent.ok) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            text: buildIntentPrompt(intent.missing, AI_ACTION_LABEL),
            timestamp: new Date(),
          }]);
          /*
            返回哨兵值而不是 null：调用方要据此**丢掉模型那段话**。

            模型是按「动作会执行」写的那段话（「已触发系统自检并自动修复…」），
            动作被挡下来之后那句话就是**假的**。
            照样显示出来等于系统在骗人——比不拦还糟。
          */
          return '__intent_blocked__';
        }

        /*
          ── 高风险动作走「待确认队列」（2026-09-01）──────────────
          确认回款、完成项目、录合同这三个**不直接执行**，改成提案。

          区别不在动作本身有多危险，在**这个动作是谁决定的**：
          人自己点按钮是他的判断；AI 从「那个包装厂的钱到了」推断出
          要确认哪一笔，中间隔着一层猜测——而确认到账不可撤销。

          注意这**不给人加步骤**：人在页面上点按钮的路径完全没变，
          只有「AI 推断出来的」才需要人回头确认一下。
        */
        const risky = Object.keys(actionData).filter((k) => HIGH_RISK_ACTIONS.includes(k));
        if (risky.length > 0) {
          const proposals = [];
          for (const key of risky) {
            const p = buildProposalFor(key, actionData[key], currentUser?.name || '');
            if (!p) continue;
            try {
              await aiProposalService.create(p);
              proposals.push(p.title);
            } catch (e) {
              setMessages(prev => [...prev, {
                id: Date.now().toString(), role: 'system',
                text: `⚠️ 提案没能进队列：${e instanceof Error ? e.message : '未知错误'}。**没有执行任何操作。**`,
                timestamp: new Date(),
              }]);
              return null;
            }
          }
          if (proposals.length > 0) {
            setMessages(prev => [...prev, {
              id: Date.now().toString(), role: 'system',
              text: `📋 这几件事**风险高、而且是我从你的话里推断出来的**，所以先放进「待我确认」等你点一下：\n\n` +
                proposals.map(t => `· ${t}`).join('\n') +
                `\n\n去工作台的「待我确认」看一眼，确认无误再批准。**现在还没有执行。**`,
              timestamp: new Date(),
            }]);
            return '__proposed__';
          }
        }

        const gate = gateAiActions(actionData, checkActionPermission);
        if (!gate.allowed) {
          const lines = gate.denied.map(d => `· **${d.label}** —— ${d.reason}`).join('\n');
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            text: `❌ 这些操作你的角色做不了，已全部取消：\n\n${lines}\n\n需要的话找总经理开权限。`,
            timestamp: new Date(),
          }]);
          return null;
        }

        // 0. 优先执行客户创建 (Customer Creation)
        let createdCustomerId = null;
        if (actionData.customer) {
            // --- 权限校验 ---
            const perm = checkActionPermission('CUSTOMER_CREATE');
            if (!perm.allowed) {
                setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: `❌ 权限拒绝：${perm.reason}`, timestamp: new Date() }]);
                return null;
            }

            // 生成唯一 ID 供 Widget 和 Context 同步使用
            createdCustomerId = `C-AI-${Date.now()}`;
            
            const newCustomer = {
                id: createdCustomerId,
                name: actionData.customer.name,
                contactPerson: actionData.customer.contactPerson || '待定联系人',
                totalValue: 0,
                riskStatus: 'low',
                activeContracts: 0,
                mobile: actionData.customer.mobile || '',
                industry: actionData.customer.industry || '未知行业',
                contacts: [{ 
                    id: `c-ai-${Date.now()}`, 
                    name: actionData.customer.contactPerson || '待定', 
                    isPrimary: true 
                }],
                // 如果 AI 解析了证书，直接挂载
                existingCertifications: actionData.customer.existingCertifications || []
            };
            
            // 调用 AppContext 写入数据
            // @ts-ignore
            await addCustomer(newCustomer);
            console.log("AI Action Executed: Customer Created", newCustomer);
        }

        // 1. 执行合同归档
        if (actionData.contract) {
          // --- 权限校验 ---
          const perm = checkActionPermission('CONTRACT_CREATE');
          if (!perm.allowed) {
              setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: `❌ 权限拒绝：${perm.reason}`, timestamp: new Date() }]);
              return null;
          }

          const contractPayload = {
            ...actionData.contract,
            signDate: actionData.contract.signDate || new Date().toISOString().split('T')[0],
            amount: Number(actionData.contract.amount),
            serviceLine: actionData.contract.serviceLine || '综合咨询',
            receivables: actionData.contract.receivables || []
          };
          
          const result = await addContract(contractPayload, actionData.create_project ?? true);
          if (!result.ok) {
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: `⚠️ 合同未入库：${result.reason || '已存在或校验失败'}`, timestamp: new Date() }]);
            return null;
          }
          console.log("AI Action Executed: Contract & Project Created", contractPayload);
          return 'contract';
        }

        // 2. 执行提醒/日程设置 (通用能力，一般允许，但可细化)
        if (actionData.reminder) {
            const linkId = actionData.reminder.linkId;
            const linkType = actionData.reminder.linkType;

            if (linkType !== 'project' || !linkId) return null;

            await addReminder({
              title: actionData.reminder.title || 'AI 智能提醒',
              content: actionData.reminder.content || 'AI 自动创建的待办事项',
              date: actionData.reminder.date || new Date().toISOString().split('T')[0],
              type: actionData.reminder.type || 'task',
              linkId,
              linkType
            });
            console.log("AI Action Executed: Project Reminder Created", actionData.reminder);
            return 'reminder';
        }

        // --- 扩展动作：线索/跟进/项目/完成/回款/情报转化（均经 useApp → 后端 PG）---
        const today = new Date().toISOString().split('T')[0];
        const sys = (t: string) => setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', text: t, timestamp: new Date() }]);

        if (actionData.lead) {
          const l = actionData.lead;
          await addLead({ name: l.name, company: l.company, mobile: l.mobile, industry: l.industry, intent: l.intent || 'Medium', source: l.source || 'AI录入' } as any);
          sys(`✅ 已录入线索：${l.name || ''} / ${l.company || ''}`);
          return 'lead';
        }
        if (actionData.lead_follow_up) {
          const f = actionData.lead_follow_up;
          await addLeadFollowUp(f.leadId, { date: f.date || today, type: f.type || 'call', content: f.content || '', operator: currentUser?.name || 'AI' } as any);
          sys('✅ 已为线索添加跟进记录');
          return 'lead_follow_up';
        }
        if (actionData.customer_follow_up) {
          const f = actionData.customer_follow_up;
          await addCustomerFollowUp(f.customerId, { date: f.date || today, type: f.type || 'call', content: f.content || '', operator: currentUser?.name || 'AI' } as any);
          sys('✅ 已为客户添加跟进记录');
          return 'customer_follow_up';
        }
        if (actionData.project) {
          const p = actionData.project;
          addProject({ name: p.name, customerId: p.customerId, contractRef: p.contractRef, manager: p.manager || currentUser?.name, projectAmount: p.projectAmount, costStatus: p.costStatus, tasks: p.tasks || [] } as any);
          sys(`✅ 已创建交付项目：${p.name || ''}`);
          return 'project';
        }
        if (actionData.complete_project) {
          const r: any = await completeProject(actionData.complete_project.projectId);
          sys(r && r.ok === false ? `❌ 无法完成：${r.reason}` : '✅ 项目已完成（自动触发评级/客户分级/提醒/PDCA）');
          return 'complete_project';
        }
        if (actionData.confirm_receivable) {
          const c = actionData.confirm_receivable;
          toggleReceivableStatus(c.contractId, c.receivableId);
          sys('✅ 已确认回款（自动更新项目付款状态/客户价值）');
          return 'confirm_receivable';
        }
        if (actionData.convert_signal) {
          const r: any = await convertSignalToFollowUpProject(actionData.convert_signal.signalId);
          sys(r && r.ok === false ? `❌ 无法转化：${r.reason}` : '✅ 情报已转为跟进项目');
          return 'convert_signal';
        }
        if (actionData.diagnose) {
          if (activeRole !== 'ADMIN') { sys('❌ 系统自我诊断/自愈仅限总经理与系统管理员使用。'); return 'denied'; }
          try {
            const rep = await fetch('/api/admin/diagnose', { credentials: 'include' }).then((r) => r.json());
            if (!rep.ok) { sys(`诊断失败：${rep.message || '未知错误'}`); return 'diagnose'; }
            const icon: any = { ok: '✅', warn: '⚠️', fail: '❌' };
            const lines = rep.data.checks.map((c: any) => `${icon[c.status] || '•'} **${c.name}** — ${c.detail}${c.hint ? ` _(${c.hint})_` : ''}`).join('\n');
            let out = `### 🩺 系统自我诊断\n${lines}\n\n**汇总**：正常 ${rep.data.summary.ok} / 警告 ${rep.data.summary.warn} / 故障 ${rep.data.summary.fail}`;
            if (actionData.diagnose.autoFix) {
              const heal = await fetch('/api/admin/self-heal', { method: 'POST', credentials: 'include' }).then((r) => r.json());
              const items = (heal.data?.fixed || []).map((f: string) => `- ✓ ${f}`).join('\n');
              out += `\n\n### 🔧 自动修复\n${heal.message || ''}${items ? '\n' + items : ''}`;
              const needManual = rep.data.checks.filter((c: any) => c.status !== 'ok' && !c.fixable);
              if (needManual.length > 0) out += `\n\n**仍需人工处理**（自愈无法覆盖）：\n${needManual.map((c: any) => `- ${c.name}：${c.hint || c.detail}`).join('\n')}`;
            }
            sys(out);
          } catch (e: any) { sys(`诊断异常：${e?.message || e}`); }
          return 'diagnose';
        }

        if (createdCustomerId) return 'customer';
      }
    } catch (e) {
      console.error("AI Action Execution Failed", e);
    }
    return null;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let fileData = "";
      let mimeType = file.type;
      let type: 'image' | 'doc' | 'sheet' | 'pdf' = 'doc';
      let extractedContent = "";

      if (['jpg', 'jpeg', 'png', 'webp'].includes(extension || '')) {
        type = 'image';
        fileData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
      } else if (extension === 'pdf') {
        type = 'pdf';
        mimeType = 'application/pdf';
        fileData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
      } else if (extension === 'docx' && window.mammoth) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        extractedContent = result.value;
      } else if (['xlsx', 'xls', 'csv'].includes(extension || '') && window.XLSX) {
        type = 'sheet';
        const arrayBuffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        extractedContent = window.XLSX.utils.sheet_to_txt(firstSheet);
      } else if (file.type === 'text/plain') {
        extractedContent = await file.text();
      }

      setPendingFile({
        name: file.name,
        data: fileData,
        mimeType: mimeType,
        content: extractedContent,
        type: type
      });
    } catch (err) {
      alert("文件解析失败，请确保格式正确。");
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleVoiceInput = () => {
    if (!speechSupported || !recognitionRef.current) {
      alert('当前浏览器不支持语音输入，请使用 Chrome 或 Edge 最新版。');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      return;
    }
    speechSeedRef.current = inputValue.trim() ? `${inputValue.trim()} ` : '';
    speechFinalRef.current = '';
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (error) {
      setIsListening(false);
      alert('语音识别启动失败，请重试。');
    }
  };

  const handleSend = async () => {
    if ((!inputValue.trim() && !pendingFile) || isLoading) return;
    if (isListening && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      setIsListening(false);
    }

    const currentText = inputValue.trim();
    const currentFile = pendingFile;
    
    const userMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      text: currentText || (currentFile ? `发送文件：${currentFile.name}` : ""), 
      timestamp: new Date(),
      attachments: currentFile ? [{ name: currentFile.name, type: currentFile.type }] : undefined
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setPendingFile(null);
    setIsLoading(true);

    try {
      // 系统导览问题优先走本地知识引擎，保证稳定、可跳转、可复用。
      if (!currentFile) {
        const guideReply = buildSystemGuideReply(currentText, {
          activeRole,
          userName: currentUser.name,
          userId: currentUser.id,
          userPermissions
        });
        if (guideReply) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: guideReply,
            timestamp: new Date(),
            requestMeta: {
              model: 'local-system-guide',
              budgetTokens: 0,
              estimatedTokens: 0,
              usagePct: 0,
              sourceSummary: '本地导览知识库',
              systemPromptChars: 0,
              historyMessages: 0,
              historyChars: 0,
              userInputChars: currentText.length,
              ragDocsCount: 0,
              ragChars: 0,
              ragDocTitles: [],
              webSearchEnabled: false,
              fileAttached: false,
              notes: ['命中系统导览意图，已走本地稳定回答路径。']
            }
          }]);
          return;
        }

        const searchIntent = detectGlobalSearchIntent(currentText);
        if (searchIntent) {
          const allowedKnowledgeDocs = knowledgeDocs.filter(doc => {
            if (doc.accessUserIds && doc.accessUserIds.length > 0 && !doc.accessUserIds.includes(currentUser.id)) return false;
            if (doc.accessRoles && doc.accessRoles.length > 0 && !doc.accessRoles.some(role => currentUser.roles.includes(role))) return false;
            return true;
          });

          const searchableScopes = resolveSearchScopesByPermissions(userPermissions);
          const forcedScopes = searchIntent.scope ? [searchIntent.scope] : searchableScopes;
          const groups = buildGlobalSearchGroups(
            searchIntent.query,
            { leads, customers, contracts, projects, knowledgeDocs: allowedKnowledgeDocs },
            { includeScopes: forcedScopes, maxPerScope: 3 }
          );
          const replyText = buildGlobalSearchReplyMarkdown(searchIntent, groups);
          const matchedCount = groups.reduce((sum, group) => sum + group.count, 0);

          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: replyText,
            timestamp: new Date(),
            requestMeta: {
              model: 'local-global-search',
              budgetTokens: 0,
              estimatedTokens: 0,
              usagePct: 0,
              sourceSummary: '本地全局索引',
              systemPromptChars: 0,
              historyMessages: 0,
              historyChars: 0,
              userInputChars: currentText.length,
              ragDocsCount: 0,
              ragChars: 0,
              ragDocTitles: [],
              webSearchEnabled: false,
              fileAttached: false,
              notes: [`命中范围：${searchableScopes.join(' / ')}`, `检索结果：${matchedCount} 条`]
            }
          }]);
          return;
        }
      }

      const today = new Date();
      const dateContext = `当前日期：${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日 (周${['日','一','二','三','四','五','六'][today.getDay()]})`;

      const allowedDocs = knowledgeDocs.filter(d => {
        if (d.aiVisible !== true) return false;
        if (d.accessUserIds && d.accessUserIds.length > 0 && !d.accessUserIds.includes(currentUser.id)) return false;
        if (d.accessRoles && d.accessRoles.length > 0 && !d.accessRoles.some(r => currentUser.roles.includes(r))) return false;
        return true;
      });
      const referencedDocs: string[] = [];
      let ragContext = '';

      if (!currentFile && allowedDocs.length > 0 && hasKnowledgeIntent(currentText)) {
        const q = String(currentText || '').trim();
        /*
          用 rankDocs 检索，不再拿整句话做子串匹配。

          原来的写法是 `title.includes(q)`，q 是用户输入的**整句问话**——
          标题里当然不会出现一整句话，所以所有文档恒定 0 分，
          排序退化成「按数组顺序取前 4 篇」，检索出来的东西和问题无关。
          实测问「包装厂的复盘」匹配不到《客户复盘｜东莞市万豪包装有限公司》。

          这类失效不报错：AI 照样答，只是没用上公司自己的知识，
          看上去像「AI 不懂我们业务」，实际是检索压根没生效。
        */
        const scoredDocs = rankDocs(q, allowedDocs, { limit: MAX_RAG_DOCS });

        if (scoredDocs.length > 0) {
          ragContext = '\n\n### 内部知识库（已授权）';
          scoredDocs.forEach(({ doc }, idx) => {
            const snippet = clampText(doc.summary || doc.content || '无摘要', MAX_RAG_SNIPPET);
            ragContext += `\n[Doc ${idx + 1}] 标题: ${doc.title}\n分类: ${doc.category}\n摘要: ${snippet}`;
            referencedDocs.push(String(doc.title || ''));
          });
        }
      }

      /*
        告诉模型这个人不能做哪些动作。

        **这不是安全措施**（真正的拦截在 gateAiActions 和服务端），
        是为了不让 AI 承诺它做不到的事：不说的话，顾问问「帮我确认回款」，
        AI 会热情地照做、然后被拦下——用户看到的是「系统坏了」。
        提前说清楚，AI 会直接回「这件事要找总经理」，那才是有用的回答。
      */
      /*
        身份段。原来这里只拼了一句「不能做什么」，AI 仍然不知道**在跟谁说话**——
        老板问「我是谁」，它答「我这边看不到你的身份信息」。

        后果不只是答不出那一句：谁问都是同一套话，
        顾问问客户流失原因时可能被顺口告知成交价。
        身份进来之后，AI 才谈得上按角色把握分寸。
      */
      const identityContext = buildIdentityContext(
        currentUser ? { name: currentUser.name, roles: currentUser.roles as any, activeRole: activeRole as any } : null,
        (action) => checkActionPermission(action).allowed,
      );

      let systemPrompt = `你是信义系统AI助手，擅长CRM、合同、财务、认证管理。${dateContext}
${identityContext}
${ragContext}

规则：
1) 优先基于内部知识库回答，引用格式用 [1]。
2) 用户问“最新政策/法规/新闻”时，优先联网检索后再答。
3) 当用户明确要求执行系统操作时，在回复结尾输出一个隐藏动作块 <execute_action>{...}</execute_action>（普通说明照常写在前面，动作块用户看不到）。支持的动作键（按需选一个或多个，缺失字段可省略）：
   - lead: {name, company, mobile?, industry?, intent?}  录入线索
   - customer: {name, contactPerson?, mobile?, industry?}  新建客户
   - contract: {title, customerName, amount, serviceLine?, receivables?}  录入合同(可带回款计划)
   - project: {name, customerId?, contractRef?, manager?, projectAmount?, costStatus?, tasks?}  建交付项目
   - lead_follow_up: {leadId, content, type?}  线索加跟进
   - customer_follow_up: {customerId, content, type?}  客户加跟进
   - complete_project: {projectId}  完成项目(触发评级/客户分级/提醒/PDCA级联)
   - confirm_receivable: {contractId, receivableId}  确认回款(触发项目付款状态/客户价值级联)
   - convert_signal: {signalId}  把情报信号转为跟进项目
   - reminder: {title, content, date?, type?, linkType:'project', linkId}  建提醒
   - diagnose: {autoFix?:true}  系统自我诊断。当用户说「自我诊断/系统体检/自检/自我修复/检查系统」时输出此动作；说到「修复/自愈」时带 autoFix:true（会自动修复情报同步、补默认配置等低级问题，密钥失效/Docker等需人工的会列出）。
   金额单位一律为元。执行写操作前，先用一句话向用户复述将要写入的关键字段，再输出动作块。诊断类只读，可直接执行。
4) **打招呼、闲聊、问「在吗」这类，就正常简短回一句**（比如「在，有什么要处理的？」），
   **不要输出任何动作块**。用户只是在确认你还在，不是要你干活。
5) **你没有「稍后」。** 操作只在这一次回复里发生：要么现在就输出动作块，要么直接说做不了。
   **禁止**说「请稍候」「正在执行」「马上为您处理」这类话——说了却没有动作块，
   用户会一直等一件永远不会发生的事，那比直接说做不了糟糕得多。
6) 不得编造事实；不确定时要明确说明并给出下一步。
7) 回复简洁可执行，使用 Markdown。`;

      // V5.0: Override system prompt if in "Sales Director" mode
      if (activeContext) {
          systemPrompt = `你现在的身份是：**资深销售总监**（正在陪同下属打单，现在通过耳麦给下属递话）。
    
          **当前客户**：${activeContext.name}
          **客户情况**：${activeContext.info}
          
          **绝对指令（违者扣分）**：
          1. **只给话术**：直接给出**1条**最有力、最能噎住老板、或最能打动老板的回复。
          2. **禁止废话**：严禁输出“策略分析”、“核心逻辑”、“您可以这样说”等前缀。直接上干货。
          3. **短促有力**：话术控制在 30-50 字以内，口语化，适合微信秒回或电话里直接说。
          4. **除非被问**：只有当用户明确问“为什么”或“还有吗”时，才解释逻辑或提供备选。
          5. **风格**：一针见血，不卑不亢，用利益（钱/风险）说话。
          `;
      }

      const chatHistory: any[] = messages
        .filter(m => m.role === 'user' || m.role === 'model')
        .slice(-MAX_HISTORY_MESSAGES)
        .map(m => ({
          role: m.role,
          parts: [{ text: clampText(m.text, MAX_HISTORY_CHARS) }]
        }));

      const currentParts: any[] = [];
      if (currentFile) {
        if (currentFile.type === 'image' || currentFile.type === 'pdf') {
          currentParts.push({ inlineData: { data: currentFile.data, mimeType: currentFile.mimeType } });
          currentParts.push({ text: `[Action: AI Analysis & Sync] 请深度解析该文件并自动同步至合同管理系统。` });
        } else {
          currentParts.push({ text: `[Document Content from ${currentFile.name}]:\n${clampText(currentFile.content, 12000)}\n\nUser Question: ${currentText}` });
        }
      } else {
        // If active context, inject current objection
        if (activeContext) {
            currentParts.push({ text: `[客户疑议] ${currentText}` });
        } else {
            currentParts.push({ text: currentText });
        }
      }

      chatHistory.push({ role: 'user', parts: currentParts });
      chatHistory.unshift({ role: 'system' as any, parts: [{ text: systemPrompt }] });

      const tools = hasWebIntent(currentText) ? [{ webSearch: {} }] : undefined;
      const tokenBudget = Number((import.meta as any).env?.VITE_AI_TOKEN_BUDGET || 12000);
      const historyChars = chatHistory
        .slice(1) // exclude system prompt from history metrics
        .reduce((sum, msg) => sum + String(msg?.parts?.[0]?.text || '').length, 0);
      const historyTokens = chatHistory
        .slice(1)
        .reduce((sum, msg) => sum + estimateTokens(String(msg?.parts?.[0]?.text || '')), 0);
      const systemPromptChars = systemPrompt.length;
      const systemPromptTokens = estimateTokens(systemPrompt);
      const userInputChars = currentParts.reduce((sum, p) => sum + String(p?.text || '').length, 0);
      const userInputTokens = currentParts.reduce((sum, p) => sum + estimateTokens(String(p?.text || '')), 0);
      const ragChars = referencedDocs.length > 0 ? ragContext.length : 0;
      const estimatedTokens = systemPromptTokens + historyTokens + userInputTokens;
      const usagePct = Math.max(0, Math.round((estimatedTokens / Math.max(1, tokenBudget)) * 100));
      const fileBinaryKB = currentFile?.data ? Math.round((currentFile.data.length * 3 / 4) / 1024) : undefined;
      const sourceFlags: string[] = [];
      if (referencedDocs.length > 0) sourceFlags.push(`知识库 ${referencedDocs.length}`);
      if (tools && tools.length > 0) sourceFlags.push('联网检索');
      if (currentFile) sourceFlags.push(`文件 ${currentFile.type.toUpperCase()}`);
      if (sourceFlags.length === 0) sourceFlags.push('纯对话');
      const requestNotes: string[] = [];
      if (usagePct >= 100) requestNotes.push('预计上下文超预算，可能导致响应变慢。');
      if (usagePct >= 80 && usagePct < 100) requestNotes.push('预计上下文接近预算上限。');
      if (currentFile?.type === 'pdf' || currentFile?.type === 'image') requestNotes.push('图片/PDF 会触发视觉解析，耗时通常高于纯文本。');
      if (tools && tools.length > 0) requestNotes.push('本次已启用联网检索。');

      const requestMeta = {
        model: 'kimi-k2.5',
        budgetTokens: tokenBudget,
        estimatedTokens,
        usagePct,
        sourceSummary: sourceFlags.join(' + '),
        systemPromptChars,
        historyMessages: Math.max(0, chatHistory.length - 1),
        historyChars,
        userInputChars,
        ragDocsCount: referencedDocs.length,
        ragChars,
        ragDocTitles: referencedDocs.slice(0, 5),
        webSearchEnabled: Boolean(tools && tools.length > 0),
        fileAttached: Boolean(currentFile),
        fileType: currentFile?.type,
        fileBinaryKB,
        notes: requestNotes
      };

      const response = await aiService.chat('kimi-k2.5', chatHistory, tools);
      const fullResponseText = response.text || '';
      const groundingChunks = response.groundingMetadata?.groundingChunks || [];
      
      // Extract Sources for display
      const sources = groundingChunks
        .map((chunk: any) => chunk.web ? { uri: chunk.web.uri, title: chunk.web.title } : null)
        .filter((s: any) => s !== null);

      // 过滤掉用于执行动作的隐藏 JSON 块，不在 UI 中显示
      const displayableText = fullResponseText.replace(/<execute_action>[\s\S]*?<\/execute_action>/, "").trim();
      
      // 执行系统操作
      const executedActionType = await executeSystemActions(fullResponseText, currentText);
      
      /*
        动作被意图核对挡下时，**模型那段话不能显示**——
        它是按「动作会执行」写的，现在动作没执行，那句话就是假的。
        上面的追问已经把情况说清楚了，这里直接跳过。
      */
      if (executedActionType === '__intent_blocked__' || executedActionType === '__proposed__') {
        setIsLoading(false);
        return;
      }

      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        text: displayableText || '解析完成，但未提取到有效数据。', 
        timestamp: new Date(),
        isExecuted: !!executedActionType,
        actionType: executedActionType,
        sources: sources.length > 0 ? sources : undefined,
        ragDocs: referencedDocs.length > 0 && displayableText.length > 20 ? referencedDocs.slice(0, 3) : undefined,
        requestMeta
      }]);

      /*
        兜底：模型说了「请稍候」但没输出动作块。

        对话框只在同一轮执行动作，没有「稍后」这回事。
        模型按聊天习惯说「现在为您重新执行，请稍候」然后什么都不做，
        界面就停在那句话上——用户等两分钟以为系统卡死了。

        **这比真的报错更糟，因为它看起来像在工作。**
        提示词里已经禁止这么说，这里是模型没听话时的兜底。
      */
      if (isEmptyPromise(fullResponseText)) {
        setMessages(prev => [...prev, {
          id: (Date.now() + 2).toString(),
          role: 'system',
          text: EMPTY_PROMISE_NOTICE,
          timestamp: new Date(),
        }]);
      }

    } catch (error: any) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: `⚠️ **处理异常**：${error.message}`, timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-none md:pointer-events-none">
      <div className={`bg-white flex flex-col border border-gray-200 overflow-hidden shadow-2xl transition-all duration-300 ease-in-out transform origin-bottom-right ${isOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-90 pointer-events-none'} fixed inset-0 w-full h-full rounded-none z-[60] md:absolute md:bottom-[4.5rem] md:right-0 md:w-[480px] md:h-[700px] md:max-h-[calc(100vh-8rem)] md:rounded-2xl md:inset-auto md:z-50`}>
        {/* Header V5.0 */}
        <div className={`p-4 flex justify-between items-center text-white shrink-0 bg-gradient-to-r from-indigo-700 to-blue-800 shadow-lg`}> 
            <div className="flex items-center space-x-3"> 
                <div className="bg-white/20 p-2 rounded-xl shadow-inner">
                    <Zap className="w-5 h-5 text-yellow-300 animate-pulse" />
                </div>
                <div>
                    <span className="font-black tracking-tight block leading-none text-sm uppercase">信义智能助手</span>
                    <span className="text-[9px] opacity-70 font-black uppercase tracking-[0.2em] mt-1 block">Ultimate System OS</span>
                </div>
            </div> 
            <div className="flex items-center space-x-1">
                <button onClick={() => { setMessages([DEFAULT_WELCOME_MSG]); setActiveContext(null); }} className="hover:bg-white/20 rounded-full p-2 transition-colors"> <Trash2 className="w-4 h-4 text-white/80" /> </button>
                <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 rounded-full p-2 transition-colors"> <X className="w-5 h-5" /> </button> 
            </div>
        </div>
        
        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-5 bg-gray-50/50 space-y-6 custom-scrollbar"> 
            {messages.map((msg) => ( 
                <div key={msg.id} className={`flex items-start ${msg.role === 'user' ? 'ml-auto flex-row-reverse max-w-[85%]' : msg.role === 'system' ? 'mx-auto max-w-[95%]' : 'mr-auto max-w-[95%]'}`}> 
                    {msg.role !== 'system' && (
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm border ${ msg.role === 'user' ? 'bg-blue-600 border-blue-500 ml-3' : 'bg-white border-gray-100 mr-3' }`}> 
                            {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-5 h-5 text-indigo-600" />} 
                        </div> 
                    )}
                    <div className={`p-4 rounded-2xl text-sm shadow-sm transition-all relative ${ 
                        msg.role === 'user' 
                          ? 'bg-blue-600 text-white rounded-tr-none' 
                          : msg.role === 'system'
                          ? 'bg-yellow-50 text-yellow-900 border border-yellow-200 w-full text-center'
                          : 'bg-white text-gray-900 border border-gray-100 rounded-tl-none' 
                    }`}> 
                        {msg.attachments && (
                            <div className="mb-3 space-y-2">
                                {msg.attachments.map((file, i) => (
                                    <div key={i} className={`flex items-center p-2 rounded-lg text-xs font-bold ${msg.role === 'user' ? 'bg-blue-500/30 border border-blue-400' : 'bg-gray-100 border border-gray-200'}`}>
                                        {file.type === 'image' ? <ImageIcon className="w-4 h-4 mr-2" /> : file.type === 'pdf' ? <FileCode className="w-4 h-4 mr-2 text-red-500" /> : file.type === 'sheet' ? <FileSpreadsheet className="w-4 h-4 mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
                                        <span className="truncate">{file.name}</span>
                                        <FileCheck className="w-3 h-3 ml-auto text-green-400" />
                                    </div>
                                ))}
                            </div>
                        )}
                        {/*
                          系统提示要**标出来**。

                          黄色框是代码发的（权限不足、意图不明、操作被拦），
                          白色带头像的才是 AI 说的话。原来两者只有颜色差别，
                          用户分不清「这句是谁说的」——
                          而这两者的可信度完全不同：系统提示描述的是确定发生的事实，
                          AI 说的话可能是猜的。
                        */}
                        {msg.role === 'system' && (
                          <div className="mb-2 text-[10px] font-bold tracking-wider text-yellow-700/70 uppercase">
                            系统提示 · 不是 AI 的回答
                          </div>
                        )}
                        <div className={msg.role === 'model' ? 'markdown-body' : 'whitespace-pre-wrap'}>
                            {msg.role === 'user' || msg.role === 'system' ? msg.text : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>}
                        </div>

                        {msg.role === 'model' && msg.requestMeta && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                                <details className="group">
                                    <summary className="cursor-pointer text-[11px] font-bold text-gray-600 list-none flex items-center justify-between">
                                        <span>
                                            预算 {msg.requestMeta.estimatedTokens}/{msg.requestMeta.budgetTokens} tokens ({msg.requestMeta.usagePct}%)
                                        </span>
                                        <span className="text-[10px] text-gray-400">{msg.requestMeta.sourceSummary}</span>
                                    </summary>
                                    <div className="mt-2 text-[11px] text-gray-600 space-y-1">
                                        <div>模型：{msg.requestMeta.model}</div>
                                        <div>System 提示词：{msg.requestMeta.systemPromptChars} 字</div>
                                        <div>历史上下文：{msg.requestMeta.historyMessages} 条 / {msg.requestMeta.historyChars} 字</div>
                                        <div>本轮输入：{msg.requestMeta.userInputChars} 字</div>
                                        <div>知识库命中：{msg.requestMeta.ragDocsCount} 条 / {msg.requestMeta.ragChars} 字</div>
                                        <div>联网检索：{msg.requestMeta.webSearchEnabled ? '开启' : '关闭'}</div>
                                        <div>
                                            文件输入：{msg.requestMeta.fileAttached ? `${msg.requestMeta.fileType || 'unknown'}${msg.requestMeta.fileBinaryKB ? ` / ${msg.requestMeta.fileBinaryKB}KB` : ''}` : '无'}
                                        </div>
                                        {msg.requestMeta.ragDocTitles.length > 0 && (
                                            <div className="text-[10px] text-indigo-600">
                                                命中文档：{msg.requestMeta.ragDocTitles.join('、')}
                                            </div>
                                        )}
                                        {msg.requestMeta.notes.length > 0 && (
                                            <div className="text-[10px] text-amber-700">
                                                {msg.requestMeta.notes.join(' ')}
                                            </div>
                                        )}
                                    </div>
                                </details>
                            </div>
                        )}
                        
                        {/* Sources Display (Grounding) */}
                        {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1 flex items-center"><Globe className="w-3 h-3 mr-1" /> 互联网信源</p>
                                <div className="space-y-1">
                                    {msg.sources.slice(0, 3).map((source, idx) => (
                                        <a key={idx} href={source.uri} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-600 truncate hover:underline">
                                            [{idx+1}] {source.title || '网页链接'}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* RAG Docs Display (Internal Knowledge) */}
                        {msg.ragDocs && msg.ragDocs.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                                <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1 flex items-center"><Database className="w-3 h-3 mr-1" /> 内部知识引用</p>
                                <div className="space-y-1">
                                    {msg.ragDocs.map((docTitle, idx) => (
                                        <div key={idx} className="flex items-center text-xs text-indigo-600">
                                            <FileText className="w-3 h-3 mr-1 opacity-50" />
                                            {docTitle}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 动作执行成功标识 */}
                        {msg.isExecuted && (
                            <div className={`mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-[10px] font-black uppercase tracking-widest -mx-4 -mb-4 px-4 py-2 rounded-b-2xl ${msg.actionType === 'reminder' ? 'bg-indigo-50/50 text-indigo-600' : 'bg-green-50/50 text-green-600'}`}>
                                {msg.actionType === 'reminder' ? (
                                    <span className="flex items-center"><BellRing className="w-3 h-3 mr-1" /> 已创建日程提醒</span>
                                ) : msg.actionType === 'customer' ? (
                                    <span className="flex items-center"><User className="w-3 h-3 mr-1" /> 已创建客户档案</span>
                                ) : (
                                    <span className="flex items-center"><CheckCircle2 className="w-3 h-3 mr-1" /> 已自动同步至系统台账</span>
                                )}
                                
                                {msg.actionType === 'contract' && (
                                    <button onClick={() => window.location.hash = '#/contracts'} className="flex items-center hover:underline">
                                        前往核实 <ArrowRight className="w-3 h-3 ml-1" />
                                    </button>
                                )}
                                {(msg.actionType === 'reminder' || msg.actionType === 'customer') && (
                                    <button onClick={() => window.location.hash = '#/customers'} className="flex items-center hover:underline">
                                        前往查看 <ArrowRight className="w-3 h-3 ml-1" />
                                    </button>
                                )}
                            </div>
                        )}

                        <div className={`text-[9px] mt-2 flex items-center ${msg.role === 'user' ? 'text-blue-200 justify-end' : msg.role === 'system' ? 'text-yellow-600 justify-center' : 'text-gray-400 justify-start'}`}>
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {msg.role === 'model' && <span className="ml-2 px-1 rounded border border-gray-100 bg-gray-50 uppercase tracking-tighter font-bold">V5.0 EXEC-CORE</span>}
                        </div>
                    </div> 
                </div> 
            ))} 
            {(isLoading || isProcessingFile) && (
                <div className="flex items-center space-x-3 text-indigo-600 text-xs font-black animate-pulse px-4 py-2 bg-indigo-50 rounded-xl border border-indigo-100 w-fit">
                    <Loader2 className="w-4 h-4 animate-spin"/>
                    <span>{isProcessingFile ? "正在解析文件结构与内容..." : "AI 大脑正在联网搜索并分析..."}</span>
                </div>
            )}
            <div ref={messagesEndRef} /> 
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-gray-100 shrink-0">
            {/* File Chip Preview */}
            {pendingFile && (
                <div className="mb-3 animate-in slide-in-from-bottom-2 duration-200">
                    <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                        <div className="flex items-center overflow-hidden">
                            <div className="p-2 bg-white rounded-lg mr-3 shadow-sm">
                                {pendingFile.type === 'image' ? <ImageIcon className="w-5 h-5 text-indigo-600" /> : pendingFile.type === 'pdf' ? <FileCode className="w-5 h-5 text-red-500" /> : pendingFile.type === 'sheet' ? <FileSpreadsheet className="w-5 h-5 text-green-600" /> : <FileText className="w-5 h-5 text-blue-600" />}
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-indigo-900 truncate">{pendingFile.name}</p>
                                <p className="text-[10px] text-indigo-400 uppercase font-black tracking-widest">待系统同步 (Ready to Sync)</p>
                            </div>
                        </div>
                        <button onClick={() => setPendingFile(null)} className="p-1 hover:bg-red-100 text-red-500 rounded-full transition-colors"> <X className="w-4 h-4" /> </button>
                    </div>
                </div>
            )}

            <div className={`relative flex items-center border rounded-2xl px-2 py-1 focus-within:ring-4 transition-all ${activeContext ? 'bg-yellow-50/50 border-yellow-200 focus-within:border-yellow-400 focus-within:ring-yellow-100' : 'bg-gray-100/50 border-gray-200 focus-within:border-indigo-400 focus-within:ring-indigo-100'}`}> 
                <textarea 
                    rows={1}
                    value={inputValue} 
                    onChange={(e) => setInputValue(e.target.value)} 
                    onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} 
                    placeholder={activeContext ? "输入客户疑议 (如: 价格太高/担心不合规)..." : pendingFile ? "输入指令，如：'解析并归档合同'" : "发文件自动同步或提问"} 
                    className="flex-1 bg-transparent border-none focus:outline-none py-3 pl-3 text-sm resize-none text-gray-900 placeholder:text-gray-400"
                    style={{ minHeight: '44px', maxHeight: '120px' }}
                />
                
                {/* Actions */}
                <div className="flex items-center space-x-1 pr-2">
                    <input 
                        type="file" 
                        ref={fileInputRef}
                        className="hidden" 
                        onChange={handleFileSelect}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                    />
                    <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-xl text-gray-400 hover:text-indigo-600 hover:bg-white transition-all" title="上传文件">
                        <Paperclip className="w-5 h-5" />
                    </button>
                    <button
                        onClick={toggleVoiceInput}
                        className={`p-2 rounded-xl transition-all ${isListening ? 'text-red-600 bg-red-50 hover:bg-red-100' : 'text-gray-400 hover:text-indigo-600 hover:bg-white'}`}
                        title={!speechSupported ? '当前浏览器不支持语音输入' : (isListening ? '点击停止语音输入' : '点击开始语音输入')}
                    >
                        <Mic className="w-5 h-5" />
                    </button>
                    <button 
                        onClick={handleSend} 
                        disabled={!inputValue.trim() && !pendingFile}
                        className={`p-2 rounded-xl transition-all shadow-md ${!inputValue.trim() && !pendingFile ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'}`}
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
      </div>

      {/* Trigger Button (Floating) */}
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          className="w-14 h-14 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-all group z-50 ring-4 ring-white/50 pointer-events-auto"
        >
          <div className="absolute inset-0 bg-white/20 rounded-full animate-ping opacity-20"></div>
          <Sparkles className="w-6 h-6 group-hover:rotate-12 transition-transform" />
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
        </button>
      )}
    </div>
  );
};

export default AIChatWidget;
