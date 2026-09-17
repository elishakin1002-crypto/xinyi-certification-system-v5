import { SampleList } from '../components/SampleRow';
import { SAMPLE_DOC } from '../src/modules/onboarding/sampleRecords';

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { SampleRow } from '../components/SampleRow';
import { EmptyState } from '../src/ui';
import { FileText, Download, Search, X, Upload, Loader2, BrainCircuit, Trash2, Database, Zap, BookOpen, Sparkles, ArrowRight, Bot, ExternalLink, RefreshCw, Lock, Eye, ShieldCheck, FileKey, Paperclip } from 'lucide-react';
import { AuditEvidence, AuditIssue, KnowledgeDoc, RoleID } from '../types';
import { SYSTEM_ROLES } from '../constants';
import { aiService } from '../services/aiService';
import { extractForSummary, buildSummaryPrompt } from '../src/utils/summaryExtract';
import { IngestionUploader } from '../components/IngestionUploader';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractTextFromDocx } from '../services/documentParsers';
import { buildKnowledgeDedupeHash, findDuplicateKnowledgeDoc } from '../src/utils/knowledgeDedupe';
import { useLocation, useNavigate } from 'react-router-dom';
import { readGlobalSearchQuery } from '../src/modules/global_search';
import { adviseIntake } from '../src/modules/knowledge/intake';
import { APP_ROUTES } from '../src/routes';
import { auditSeverityLabel, auditStatusLabel } from '../src/modules/labels';

const Knowledge = () => {
  const { knowledgeDocs, auditIssues, addKnowledgeDoc, deleteKnowledgeDoc, updateKnowledgeDoc, currentUser, activeRole, backfillPdcaForPaidContracts } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dashboardFocus, setDashboardFocus] = useState<any>(null);
  const [dashboardFocusLabel, setDashboardFocusLabel] = useState('');
  
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocCategory, setNewDocCategory] = useState<'Company Profile' | 'Product Service' | 'Standard' | 'Template' | 'Training' | 'PDCA' | 'AI生成' | 'Other'>('Company Profile');
  const [visibleRoles, setVisibleRoles] = useState<RoleID[]>(['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']);
  
  /*
    「让 AI 学习」默认**不勾**。

    原来默认勾上，于是每一份传上去的文件都自动进 AI 语料——
    包括体系文件范本、空白记录表单这类内容。它们有两个问题：
      · 花钱：每次检索都要过一遍，token 是按量算的
      · 污染：100 家客户的记录表单 90% 是相同的，检索时把真正有用的
        复盘和案例挤下去，AI 答出来的东西越来越像模板

    默认不勾不是不信任 AI，是让「这份值得让 AI 学」变成一次**明确的判断**，
    而不是上传时顺手带过去的副作用。真正有价值的文档（客户复盘、
    不符合项整改经验、AI 交付物）由系统自动生成时仍然默认可见——
    那些是沉淀，不是模板。
  */
  const [aiVisible, setAiVisible] = useState(false);

  // Preview Drawer State
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDoc | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [previewEvidence, setPreviewEvidence] = useState<null | { name: string; url: string; kind: 'image' | 'pdf' }>(null);

  const allRoles: RoleID[] = ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'];
  const getRoleLabel = (roleId: RoleID) => SYSTEM_ROLES.find(r => r.id === roleId)?.name || roleId;

  const canAccessDoc = (doc: KnowledgeDoc) => {
      if (doc.accessUserIds && doc.accessUserIds.length > 0 && !doc.accessUserIds.includes(currentUser.id)) return false;
      if (doc.accessRoles && doc.accessRoles.length > 0 && !doc.accessRoles.some(r => currentUser.roles.includes(r))) return false;
      return true;
  };

  const getAccessLabel = (doc: KnowledgeDoc) => {
      if (doc.accessUserIds && doc.accessUserIds.length > 0) return '指定用户';
      if (!doc.accessRoles || doc.accessRoles.length === 0) return '全员可见';
      const unique = Array.from(new Set(doc.accessRoles));
      if (unique.length === allRoles.length) return '全员可见';
      return unique.map(getRoleLabel).join('、');
  };

  /*
    ── AI 智能摘要只给管理层看（2026-09-13）──────────────────────

    金恩来：「ai智能摘要的功能，只开发给系统管理员、总经理、总助这三个角色吧！
    其他角色，目前先不用显示这个功能了！」

    照做。三个角色：
      SYS_ADMIN（系统管理员）、ADMIN（总经理）、MANAGER（总助）

    判断用 activeRole 而不是 roles：系统里有「切换视角」，
    而视角切换**不改权限**（这条在走查手册里专门写过）——
    所以要看的是他当前实际生效的角色。

    只是不显示这一块界面，不动 aiVisible 那个字段 ——
    那是「这份文档准不准进 AI 语料」，和「谁能看到摘要面板」是两件事，
    今天刚因为把两件事混在一个词里（「机密」）绕过一圈。
  */
  const AI_SUMMARY_ROLES: RoleID[] = ['SYS_ADMIN', 'ADMIN', 'MANAGER'];
  const canUseAiSummary = AI_SUMMARY_ROLES.includes(activeRole);

  const accessibleDocs = knowledgeDocs.filter(canAccessDoc);
  const normalizedQuery = searchTerm.trim().toLowerCase();
  const matchesDashboardFocus = (doc: KnowledgeDoc) => {
      if (!dashboardFocus?.type) return true;
      if (dashboardFocus.type === 'ai_ready') return !!doc.aiVisible;
      if (dashboardFocus.type === 'audit_linked') return doc.linkType === 'audit';
      if (dashboardFocus.type === 'category') return doc.category === dashboardFocus.category;
      return true;
  };
  const filteredDocsBase = (filter === 'All' ? accessibleDocs : accessibleDocs.filter(d => d.category === filter)).filter(matchesDashboardFocus);
  const filteredDocs = normalizedQuery
    ? filteredDocsBase.filter(doc => {
        const haystack = [
          doc.title,
          doc.summary,
          doc.content,
          doc.linkTitle,
          (doc.tags || []).join(' ')
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : filteredDocsBase;

  const auditIssueMap = useMemo<Map<string, AuditIssue>>(() => new Map(auditIssues.map(issue => [issue.id, issue] as const)), [auditIssues]);
  const resolveLinkedAuditIssue = (doc?: KnowledgeDoc | null): AuditIssue | null => doc?.linkType === 'audit' && doc.linkId ? auditIssueMap.get(doc.linkId) || null : null;
  const linkedPreviewAudit = useMemo(() => resolveLinkedAuditIssue(previewDoc), [previewDoc, auditIssueMap]);
  
  const learnedDocsCount = accessibleDocs.filter(d => d.aiVisible).length;

  const getCategoryLabel = (cat: string) => {
      switch(cat) {
          case 'All': return '全部文档';
          case 'Company Profile': return '公司资料/制度';
          case 'Product Service': return '产品资料';
          case 'PDCA': return '客户复盘 (PDCA)';
          case 'Standard': return '标准法规';
          case 'Template': return '文档模板';
          case 'Training': return '培训资料';
          case 'AI生成': return 'AI交付';
          case '证书档案': return '证书档案';
          default: return cat;
      }
  };

  const getDefaultRolesForCategory = (cat: string): RoleID[] => {
      if (cat === 'PDCA') return ['ADMIN', 'MANAGER', 'FINANCE'];
      if (cat === 'AI生成') return ['ADMIN', 'MANAGER'];
      return ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'];
  };

  const getDuplicateAlertMessage = (duplicate: KnowledgeDoc, incomingTitle: string) => {
      return [
          '检测到重复文档，已阻止重复入库。',
          `已存在：${duplicate.title}（${getCategoryLabel(duplicate.category)}）`,
          `更新日期：${duplicate.updatedAt || '-'}`,
          `本次上传：${incomingTitle}`,
          '建议：如需调整分类或权限，请直接编辑已存在文档。'
      ].join('\n');
  };

  const tryAddKnowledgeDoc = async (doc: KnowledgeDoc, file?: File): Promise<boolean> => {
      const dedupeHash = doc.dedupeHash || (file ? await buildKnowledgeDedupeHash(file, doc.title) : '');
      const normalizedDoc: KnowledgeDoc = {
          ...doc,
          dedupeHash: dedupeHash || undefined,
          originalFileName: doc.originalFileName || file?.name
      };

      const duplicate = findDuplicateKnowledgeDoc(knowledgeDocs, normalizedDoc);
      if (duplicate) {
          alert(getDuplicateAlertMessage(duplicate, normalizedDoc.title));
          return false;
      }

      const result = await addKnowledgeDoc(normalizedDoc);
      if (!result.ok) {
          const duplicateDoc = knowledgeDocs.find(d => d.id === result.duplicateId);
          if (duplicateDoc) {
              alert(getDuplicateAlertMessage(duplicateDoc, normalizedDoc.title));
          } else {
              alert('检测到重复文档，已阻止重复入库。');
          }
          return false;
      }
      return true;
  };

  useEffect(() => {
      const q = readGlobalSearchQuery(location.search);
      if (q) setSearchTerm(q);
  }, [location.search]);

  useEffect(() => {
      const state: any = location.state || {};
      const focus = state.dashboardFocus;
      if (focus?.type) {
          setDashboardFocus(focus);
          if (focus.type === 'ai_ready') {
              setFilter('All');
              setDashboardFocusLabel('AI 可用知识');
          } else if (focus.type === 'audit_linked') {
              setFilter('All');
              setDashboardFocusLabel('审计经验知识卡');
          } else if (focus.type === 'category' && focus.category) {
              setFilter(String(focus.category));
              setDashboardFocusLabel(`分类：${getCategoryLabel(String(focus.category))}`);
          }
      }
      const targetId = state.openDetailId;
      if (targetId) {
          const targetDoc = accessibleDocs.find(doc => doc.id === targetId) || knowledgeDocs.find(doc => doc.id === targetId);
          if (targetDoc) {
              setPreviewDoc(targetDoc);
          }
      }
      if (state.dashboardFocus || state.openDetailId) {
          window.history.replaceState({}, document.title);
      }
  }, [location.state, accessibleDocs, knowledgeDocs]);

  /**
   * 生成摘要。改了三处（P0-11 / P0-12）：
   *
   * ① 不再自动触发。原来一打开预览就同步调 AI——点一下花一次钱还要干等，
   *    而且大多数时候人只是想看看原文。改成显式点按钮。
   * ② 取材按长度分层，不再固定 slice(0, 2000)。
   *    5970 字的培训手册原来只读到前三分之一，摘要必然是封面目录的废话。
   * ③ 正文为空时直接拒绝。原来会给模型一句
   *    「Please generate a plausible summary based on the title」——
   *    那是让 AI 照着标题编，编出来的摘要看着像真的，比没有更糟。
   */
  const generateSummary = async (doc: KnowledgeDoc) => {
      const extracted = extractForSummary(doc.content);
      if (extracted.tier === 'empty') {
          alert('该文档没有正文内容，无法生成摘要。\n（不会让 AI 照着标题编——编出来的摘要看着像真的，比没有更糟）');
          return;
      }
      setIsSummarizing(true);
      try {
          const summary = await aiService.generateText('kimi-k2.5', buildSummaryPrompt(doc.title, extracted));
          updateKnowledgeDoc(doc.id, { summary });
          setPreviewDoc(prev => prev ? { ...prev, summary } : null);
      } catch (e) {
          console.error("Summary generation failed", e);
          alert('摘要生成失败，请稍后重试');
      } finally {
          setIsSummarizing(false);
      }
  };



  const toggleVisibleRole = (roleId: RoleID) => {
      setVisibleRoles(prev => {
          if (prev.includes(roleId)) {
              const next = prev.filter(r => r !== roleId);
              return next.length === 0 ? prev : next;
          }
          return [...prev, roleId];
      });
  };

  const resetVisibleRoles = () => {
      setVisibleRoles(allRoles);
  };

  const handleBackfillPdca = () => {
      setIsBackfilling(true);
      try {
          const result = backfillPdcaForPaidContracts();
          alert(`✅ 已扫描 ${result.scanned} 份已回款合同，生成 ${result.created} 条复盘，更新 ${result.updated} 个客户。`);
      } catch (e) {
          alert('回款复盘补偿失败，请稍后重试。');
      } finally {
          setIsBackfilling(false);
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsUploading(true);
      try {
          let extractedText = '';
          const isDocx = file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          const isText = file.type === 'text/plain';
          
          if (isDocx) {
              extractedText = await extractTextFromDocx(file);
          } else if (isText) {
              extractedText = await file.text();
          } else {
              extractedText = ""; // Binary files have empty text content initially
          }

          // INTELLIGENT FORMAT DETECTION
          let detectedFormat = file.name.split('.').pop()?.toLowerCase() || 'file';
          
          if (file.type === 'application/pdf') {
              detectedFormat = 'pdf';
          } else if (file.type.startsWith('image/')) {
              if (file.type.includes('jpeg') || file.type.includes('jpg')) detectedFormat = 'jpg';
              else if (file.type.includes('png')) detectedFormat = 'png';
              else if (file.type.includes('gif')) detectedFormat = 'gif';
              else if (file.type.includes('webp')) detectedFormat = 'webp';
              else detectedFormat = 'png'; 
          }

          const finalTitle = newDocTitle || file.name.replace(/\.[^/.]+$/, "");

          /*
            入库准入检查。挡两类东西，性质完全不同：
              · 空白记录表单／通用模板 —— 100 家客户的同类表单大同小异，
                每家存一份会把真正有价值的复盘从检索结果里挤下去
              · 客户填好的记录 —— **合规风险**：客户的生产、检验、人员数据
                属于客户自己，存进我们系统意味着我们要为保管和泄露负责

            做成提示而不是硬拦：识别靠特征匹配，一定有误判。
            硬拦会让人传不上真正要传的文件，然后他绕过系统发微信——那比存进来更糟。
            所以让人看到理由后自己决定，只是默认不进 AI 语料。
          */
          const advice = adviseIntake(finalTitle, extractedText);
          let finalAiVisible = aiVisible;
          if (advice.verdict !== 'ok') {
              const proceed = window.confirm(
                  `${advice.reason}\n\n识别依据：${advice.signals.join('、')}\n\n`
                  + (advice.discourageStore
                      ? '⚠️ 这类文件建议不要存进系统。确定仍要上传？'
                      : '仍要上传吗？（会存下来，但不让 AI 学习）'));
              if (!proceed) return;
              finalAiVisible = false;   // 无论原来勾没勾，这两类都不进语料
          }

          /* 先存盘拿稳定地址，存不上就别建这条记录 —— 建了也是死链 */
          let uploadedUrl = '';
          try {
            const form = new FormData();
            form.append('files', file);
            const up = await fetch('/api/uploads/knowledge', { method: 'POST', credentials: 'include', body: form });
            const upBody = await up.json();
            uploadedUrl = String(upBody?.data?.files?.[0]?.url || '');
            if (!uploadedUrl) throw new Error(upBody?.message || '服务端没有返回文件地址');
          } catch (err) {
            alert(`文件没能存到服务器：${err instanceof Error ? err.message : '未知错误'}\n\n没有创建这条记录 —— 否则它会变成一条打不开的死链。请重试。`);
            return;
          }

          const newDoc: KnowledgeDoc = {
              id: `DOC-${Date.now()}`,
              title: finalTitle,
              category: newDocCategory,
              format: detectedFormat,
              size: `${(file.size / 1024).toFixed(1)} KB`,
              updatedAt: new Date().toISOString().split('T')[0],
              content: extractedText,
              /*
                ── 真的把文件存下来（2026-09-13）────────────────────────

                原来这里是 URL.createObjectURL(file) —— 浏览器临时地址，
                刷新就失效，别人永远打不开。
                **体检发现知识中心 40 篇里有 7 篇就是这么变成死链的**，
                列表上看着正常，点开是空白。

                和合同附件是同一个 bug（同一天先在合同那边修的）。
                服务端的通用上传接口本来就是为这种场景准备的，
                注释里写着「避免把 base64 塞进数据字段」。
              */
              sourceUrl: uploadedUrl,
              aiVisible: finalAiVisible,
              accessRoles: visibleRoles
          };
          const added = await tryAddKnowledgeDoc(newDoc, file);
          if (!added) return;
          setIsModalOpen(false);
          setNewDocTitle('');
      } catch (error) {
          alert("上传失败");
      } finally {
          setIsUploading(false);
      }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(window.confirm("确认删除？删除后 AI 将无法引用其内容。")) {
          deleteKnowledgeDoc(id);
          if (previewDoc?.id === id) setPreviewDoc(null);
      }
  };

  const openPreview = (doc: KnowledgeDoc) => {
      setPreviewDoc(doc);
  };

  const triggerDownload = (url: string, name: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const handleDownload = (e: React.MouseEvent, doc: KnowledgeDoc) => {
      e.stopPropagation();
      /* blob: 是历史遗留的临时地址，早就失效了 —— 和"没有地址"一个意思 */
      if (!doc.sourceUrl || doc.sourceUrl === '#' || doc.sourceUrl.startsWith('blob:')) {
          if (doc.content) {
              const blob = new Blob([doc.content], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              triggerDownload(url, `${doc.title}.md`);
              URL.revokeObjectURL(url);
          } else {
              /*
                这里原来说「演示模式，无实体内容」—— 会让人以为是样例数据。
                实际多半是历史遗留：文件当初存成了 blob 临时地址，早失效了。
                说清是哪种情况，人才知道要不要重新上传。
              */
              alert(String(doc.sourceUrl || '').startsWith('blob:')
                ? `「${doc.title}」的原文件没有真的存下来。\n\n`
                  + `它是旧版本留下的临时地址，刷新之后就失效了 —— 别人也从来打不开。\n\n`
                  + `请重新上传一次，这次会真的存到服务器上。`
                : `「${doc.title}」没有可下载的文件，只有一条记录。`);
          }
      } else {
          triggerDownload(doc.sourceUrl, doc.title);
      }
  };

  const isImage = (fmt: string) => ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'image/svg+xml'].includes(fmt.toLowerCase());
  const isPdf = (fmt: string) => ['pdf'].includes(fmt.toLowerCase());
  const resolveEvidencePreviewKind = (type: string, url?: string) => {
      const normalizedType = String(type || '').toLowerCase();
      const resolvedUrl = String(url || '');
      if (!resolvedUrl) return null;
      if (normalizedType.includes('pdf') || resolvedUrl.startsWith('data:application/pdf')) return { kind: 'pdf' as const, url: resolvedUrl };
      if (normalizedType.includes('image') || isImage(normalizedType) || resolvedUrl.startsWith('data:image')) return { kind: 'image' as const, url: resolvedUrl };
      return null;
  };

  const handlePreviewAuditEvidence = (evidence: NonNullable<typeof linkedPreviewAudit>['evidences'][number]) => {
      const resolved = resolveEvidencePreviewKind(evidence.type, evidence.url);
      if (!resolved) {
          alert('当前证据仅支持图片/PDF 在线预览，请改用下载查看。');
          return;
      }
      setPreviewEvidence({ name: evidence.name, url: resolved.url, kind: resolved.kind });
  };

  const handleDownloadAuditEvidence = (evidence: AuditEvidence) => {
      if (!evidence.url) {
          alert('该证据暂无可下载地址。');
          return;
      }
      triggerDownload(evidence.url, evidence.name);
  };

  const handleOpenLinkedAudit = () => {
      if (!linkedPreviewAudit) return;
      setPreviewDoc(null);
      navigate(APP_ROUTES.AUDIT, { state: { openDetailId: linkedPreviewAudit.id } });
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      {/* 顶部统计区 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600"><BrainCircuit className="w-6 h-6" /></div>
              <div>
                  <p className="text-xs text-gray-400 font-bold uppercase">允许 AI 引用的文档</p>
                  <div className="flex items-center space-x-2">
                      <p className="text-2xl font-black text-gray-900">{learnedDocsCount}</p>
                      <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">RAG Ready</span>
                  </div>
              </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-gray-50 rounded-xl text-gray-600"><Lock className="w-6 h-6" /></div>
              <div>
                  {/*
                    ── 「机密」这个词说的是 AI，不是人（2026-09-13 改）──────────

                    金恩来：「点击合同，提示的标签上写着全员可见，
                    又写着机密模式是什么意思？」

                    因为这是**两个不同的轴**，而标签让它们看起来互相矛盾：
                      · 可见范围 = **哪些人**能打开（accessRoles）
                      · 机密模式 = **AI 能不能读**（aiVisible）

                    中文里「机密」默认指对人保密，所以「全员可见 + 机密」
                    读起来就是自相矛盾。改成直说 AI —— 两个轴各说各的，就不打架了。
                  */}
                  <p className="text-xs text-gray-400 font-bold uppercase">AI 不可读文档</p>
                  <p className="text-2xl font-black text-gray-900">{accessibleDocs.length - learnedDocsCount}</p>
              </div>
          </div>
          <div className="bg-indigo-600 p-6 rounded-2xl shadow-lg flex items-center justify-between group cursor-pointer hover:bg-indigo-700 transition-colors" onClick={() => setIsModalOpen(true)}>
              <div className="flex items-center space-x-3 text-white">
                  <div className="p-2 bg-white/20 rounded-lg"><Upload className="w-5 h-5" /></div>
                  <div>
                      <p className="text-sm font-bold">📤 知识入库 / 上传</p>
                      <p className="text-xs opacity-70">支持设置 AI 读取权限</p>
                  </div>
              </div>
              <ArrowRight className="w-5 h-5 text-white/50 group-hover:translate-x-1 transition-transform" />
          </div>
      </div>

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex flex-wrap gap-2 pb-1">
              {['All', 'PDCA', 'Company Profile', 'Product Service', 'Standard', 'Template', 'Training', 'AI生成'].map(cat => (
                  <button 
                    key={cat}
                    onClick={() => setFilter(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                        filter === cat 
                        ? 'bg-gray-900 text-white shadow-md' 
                        : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                      {getCategoryLabel(cat)}
                  </button>
              ))}
          </div>
          <div className="flex items-center gap-2 w-full lg:w-auto">
              {(currentUser.roles.includes('ADMIN') || currentUser.roles.includes('MANAGER')) && (
                  <button
                    onClick={handleBackfillPdca}
                    disabled={isBackfilling}
                    className={`hidden md:inline-flex items-center px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                      isBackfilling
                        ? 'bg-gray-100 text-gray-400 border-gray-200'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                    }`}
                  >
                      {isBackfilling ? '补偿中...' : '回款复盘补偿'}
                  </button>
              )}
              <div className="relative w-full lg:w-auto md:block">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索知识点..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="bg-white border border-gray-200 rounded-xl py-2 pl-9 pr-4 text-xs w-full lg:w-64 focus:ring-2 focus:ring-blue-500/20 outline-none"
                  />
              </div>
          </div>
      </div>
      {dashboardFocusLabel && (
          <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
                  工作台焦点：{dashboardFocusLabel}
              </span>
              <button
                type="button"
                onClick={() => {
                    setDashboardFocus(null);
                    setDashboardFocusLabel('');
                    setFilter('All');
                }}
                className="text-xs font-bold text-gray-500 hover:text-gray-700"
              >
                  清除焦点
              </button>
          </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <SampleList items={filteredDocs} sample={SAMPLE_DOC} render={doc => {
              const linkedAudit = resolveLinkedAuditIssue(doc);
              return (
              <div 
                key={doc.id} 
                className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-xl hover:-translate-y-1 cursor-pointer group relative"
                onClick={() => openPreview(doc)}
              >
                  {/* AI Status Badge */}
                  <div className="absolute top-4 right-4">
                      {doc.aiVisible ? (
                          <div className="flex items-center space-x-1 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100" title="允许 AI 引用这份资料（只是许可，不代表已读取或已建索引）">
                              <BrainCircuit className="w-3 h-3 text-indigo-600" />
                              <span className="text-[10px] font-bold text-indigo-600">AI</span>
                          </div>
                      ) : (
                          <div className="flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded-lg border border-gray-200" title="这份不让 AI 读取（人照常按可见范围打开）">
                              <Lock className="w-3 h-3 text-gray-500" />
                              <span className="text-[10px] font-bold text-gray-500">AI 不可读</span>
                          </div>
                      )}
                  </div>

                  <div className="flex items-start justify-between mb-4">
                      <div className={`p-3 rounded-xl ${doc.aiVisible ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
                          {doc.aiVisible ? <Sparkles className="w-6 h-6" /> : <FileKey className="w-6 h-6" />}
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 bg-gray-50 text-gray-400 rounded-lg uppercase mr-12">{doc.format}</span>
                  </div>
                  
                  <h3 className="text-base font-bold text-gray-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1">{doc.title}</h3>
                  <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tight">{getCategoryLabel(doc.category)}</p>
                  {doc.linkTitle && (
                      <p className="text-[10px] text-gray-400 mt-1">关联：{doc.linkTitle}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">可见范围：{getAccessLabel(doc)}</p>
                  {linkedAudit && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold">
                          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">审计经验</span>
                          <span className="px-2 py-0.5 rounded-full bg-white text-gray-600 border border-gray-200">证据 {(linkedAudit.evidences || []).length} 份</span>
                          <span className="px-2 py-0.5 rounded-full bg-white text-gray-600 border border-gray-200">状态 {auditStatusLabel(linkedAudit.status)}</span>
                      </div>
                  )}
                  
                  {/* Summary Snippet —— 摘要属于 AI 功能，同样只给那三个角色 */}
                  {canUseAiSummary && (doc.summary ? (
                      <div className={`mt-3 p-2 rounded-lg border ${doc.aiVisible ? 'bg-indigo-50/50 border-indigo-50' : 'bg-gray-50 border-gray-100'}`}>
                          <p className={`text-xs line-clamp-2 leading-relaxed ${doc.aiVisible ? 'text-indigo-800' : 'text-gray-500'}`}>{doc.summary}</p>
                      </div>
                  ) : (
                      <div className="mt-3 p-2 rounded-lg bg-gray-50 border border-gray-50">
                          <p className="text-xs text-gray-400 italic">暂无智能摘要</p>
                      </div>
                  ))}

                  {doc.tags && doc.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                          {doc.tags.slice(0, 3).map((tag, idx) => (
                              <span key={`${doc.id}-tag-${idx}`} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 font-bold">
                                  #{tag}
                              </span>
                          ))}
                      </div>
                  )}

                  <div className="pt-4 mt-4 border-t border-gray-50 flex justify-between items-center text-[10px] text-gray-400">
                      <span>{doc.size} • {doc.updatedAt}</span>
                      <div className="flex space-x-2">
                          <button onClick={(e) => handleDelete(doc.id, e)} className="p-1.5 hover:bg-red-50 rounded text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                  </div>
              </div>
          );}} />
      </div>
      {/*
        空状态 + 样例（2026-09-08 补）。

        金恩来 2026-09-07：「每个板块中因为需要引导新手介绍功能，
        需要保留一个例子……否则新手引导的卡片做了也几乎等于白做，
        没有内容谁会看？看了谁又能记得住？」

        当时我只做了引导走到的 5 个页面，这一页是补上的。
        体检表（npm run checkup）就是为了不再让这种事靠人记。
      */}
      {filteredDocs.length === 0 && (
        <>
          <EmptyState
            title="这里还没有文档"
            hint="把体系文件、模板、以前项目的复盘传上来。传的时候花五秒选对分类，以后能省很多找的时间。"
          />

        </>
      )}

      {/* Upload Modal with Security Toggle */}
      {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-bold text-gray-900 flex items-center">
                          <Zap className="w-5 h-5 mr-2 text-yellow-500" /> 知识库注入
                      </h2>
                      <button onClick={() => setIsModalOpen(false)}><X className="w-6 h-6 text-gray-400" /></button>
                  </div>
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">文档分类</label>
                          <select
                            className="w-full border border-gray-200 rounded-xl p-3 text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            value={newDocCategory}
                            onChange={e => {
                                const next = e.target.value as any;
                                setNewDocCategory(next);
                                setVisibleRoles(getDefaultRolesForCategory(next));
                            }}
                          >
                              <option value="Company Profile">🏢 公司资料/制度</option>
                              <option value="Product Service">📦 产品手册</option>
                              <option value="Standard">⚖️ 行业标准</option>
                              <option value="Template">📄 文档模板</option>
                              <option value="Training">🎓 内部培训</option>
                              <option value="PDCA">🧭 客户复盘 (PDCA)</option>
                              <option value="AI生成">🤖 AI交付</option>
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">文档标题</label>
                          <input type="text" className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" placeholder="输入文档名称..." value={newDocTitle} onChange={e => setNewDocTitle(e.target.value)} />
                      </div>

                      <div>
                          <div className="flex items-center justify-between mb-2">
                              <label className="block text-xs font-bold text-gray-400 uppercase">可见范围</label>
                              <button
                                type="button"
                                onClick={resetVisibleRoles}
                                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700"
                              >
                                全员可见
                              </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                              {allRoles.map(roleId => {
                                  const label = getRoleLabel(roleId);
                                  const checked = visibleRoles.includes(roleId);
                                  return (
                                    <button
                                      key={roleId}
                                      type="button"
                                      onClick={() => toggleVisibleRole(roleId)}
                                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                                        checked
                                          ? 'bg-indigo-600 text-white border-indigo-600'
                                          : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  );
                              })}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-2">
                              仅选中角色可见，AI 只会读取你有权限查看的文档内容。
                          </p>
                      </div>
                      
                      {/* Security Toggle */}
                      <div className={`flex items-center space-x-3 p-4 rounded-xl border transition-colors ${aiVisible ? 'bg-indigo-50 border-indigo-100' : 'bg-gray-100 border-gray-200'}`}>
                          <input 
                            type="checkbox" 
                            id="aiVisible" 
                            className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer"
                            checked={aiVisible}
                            onChange={(e) => setAiVisible(e.target.checked)}
                          />
                          <label htmlFor="aiVisible" className="flex-1 cursor-pointer select-none">
                              <div className={`text-sm font-bold ${aiVisible ? 'text-indigo-900' : 'text-gray-700'}`}>
                                  {/* 「学习」会被理解成模型被训练过。实际只是一个可见性许可 */}
                                  {aiVisible ? '允许 AI 引用这份资料' : '不让 AI 读这份（人照常能看）'}
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                  {aiVisible ? 'AI 助手可以引用此文档回答问题' : '🔒 仅用于存储，AI 助手无法访问内容'}
                              </div>
                          </label>
                          {aiVisible ? <BrainCircuit className="w-5 h-5 text-indigo-400" /> : <Lock className="w-5 h-5 text-gray-400" />}
                      </div>

                      <div className="mb-6">
                        <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">文件上传</label>
                        <IngestionUploader 
                            source="knowledge"
                            label="点击或拖拽文件到此处"
                            subLabel="支持 PDF, Word, 图片, 文本 (AI 自动提取摘要)"
                            options={{ aiVisible }}
                            onSuccess={async (result, file) => {
                                const doc = result.data;
                                if (doc) {
                                    const newDoc: KnowledgeDoc = {
                                        id: `DOC-${Date.now()}`,
                                        title: newDocTitle || doc.title || '未命名文档',
                                        category: newDocCategory,
                                        format: doc.format || 'file',
                                        size: doc.size || '0 KB',
                                        updatedAt: new Date().toISOString().split('T')[0],
                                        content: doc.content || '',
                                        summary: doc.summary || '',
                                        /* 识别服务存不上盘时会返回空 —— 不要再拿 '#' 顶上，
                                           那会变成一条"看起来有文件其实没有"的记录 */
                                        sourceUrl: doc.sourceUrl || '',
                                        aiVisible: aiVisible,
                                        accessRoles: visibleRoles
                                    };
                                    const added = await tryAddKnowledgeDoc(newDoc, file);
                                    if (!added) return;
                                    setIsModalOpen(false);
                                    setNewDocTitle('');
                                    alert(newDoc.sourceUrl
                                      ? "✅ 上传成功！文件已存档，AI 已自动处理内容。"
                                      : "⚠️ 内容已提取入库，但**原文件没能存到服务器** —— 这条记录点开会没有文件。\n\n请稍后重新上传一次。");
                                }
                            }}
                            onError={(msg) => alert(`上传失败: ${msg}`)}
                        />
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Preview Drawer */}
      {previewDoc && (
          <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
              <div className="w-full md:w-[800px] h-full bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
                  {/* Header */}
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
                      <div className="flex items-center space-x-3 overflow-hidden">
                          <div className="bg-indigo-50 p-2 rounded-lg shrink-0">
                              <FileText className="w-6 h-6 text-indigo-600" />
                          </div>
                          <div className="min-w-0">
                              <h2 className="text-lg font-bold text-gray-900 truncate">{previewDoc.title}</h2>
                              <div className="flex items-center space-x-2 mt-1 flex-wrap">
                                  <span className="text-xs text-gray-500">{getCategoryLabel(previewDoc.category)}</span>
                                  <span className="text-[10px] bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 font-bold">
                                      可见：{getAccessLabel(previewDoc)}
                                  </span>
                                  {linkedPreviewAudit && (
                                      <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-100 font-bold">
                                          审计闭环同步
                                      </span>
                                  )}
                                  {!previewDoc.aiVisible && (
                                      <span className="flex items-center text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-100 font-bold">
                                          <Lock className="w-3 h-3 mr-1" /> AI 不可读
                                      </span>
                                  )}
                              </div>
                          </div>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                          <button
                              onClick={(e) => handleDownload(e, previewDoc)}
                              className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                              title="下载原文件"
                          >
                              <Download className="w-5 h-5" />
                          </button>
                          <button onClick={() => setPreviewDoc(null)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
                              <X className="w-6 h-6" />
                          </button>
                      </div>
                  </div>

                  {/* Body */}
                  <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                      {/* Main Content Area */}
                      <div className="flex-1 overflow-y-auto p-8 bg-gray-50 custom-scrollbar">
                          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 min-h-full space-y-6">
                              {linkedPreviewAudit && (
                                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
                                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                                          <div>
                                              <h3 className="text-base font-black text-gray-900 flex items-center"><Paperclip className="w-4 h-4 mr-2 text-indigo-600" /> 审计证据同步预览</h3>
                                              <p className="text-xs text-gray-500 mt-1">该知识卡已关联原始审计问题，证据与验证结论会实时同步显示。</p>
                                          </div>
                                          <button onClick={handleOpenLinkedAudit} className="inline-flex items-center px-3 py-2 rounded-xl bg-white border border-indigo-100 text-xs font-black text-indigo-700 hover:bg-indigo-100 transition-colors">
                                              <ExternalLink className="w-3 h-3 mr-1" /> 回到原问题
                                          </button>
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4 text-xs">
                                          <div className="rounded-xl bg-white border border-indigo-100 px-3 py-3">
                                              <div className="text-gray-400">客户</div>
                                              <div className="font-black text-gray-900 mt-1">{linkedPreviewAudit.customerName}</div>
                                          </div>
                                          <div className="rounded-xl bg-white border border-indigo-100 px-3 py-3">
                                              <div className="text-gray-400">状态</div>
                                              <div className="font-black text-gray-900 mt-1">{auditStatusLabel(linkedPreviewAudit.status)}</div>
                                          </div>
                                          <div className="rounded-xl bg-white border border-indigo-100 px-3 py-3">
                                              <div className="text-gray-400">严重度</div>
                                              <div className="font-black text-gray-900 mt-1">{auditSeverityLabel(linkedPreviewAudit.severity)}</div>
                                          </div>
                                          <div className="rounded-xl bg-white border border-indigo-100 px-3 py-3">
                                              <div className="text-gray-400">证据数</div>
                                              <div className="font-black text-gray-900 mt-1">{(linkedPreviewAudit.evidences || []).length} 份</div>
                                          </div>
                                      </div>
                                      <div className="mt-4 rounded-2xl border border-white/80 bg-white p-4">
                                          <div className="text-xs font-black text-gray-400 uppercase tracking-widest">验证关闭结论</div>
                                          <div className="text-sm text-gray-800 leading-6 mt-2">{linkedPreviewAudit.verification?.notes || '暂未填写验证结论。'}</div>
                                          <div className="mt-3 text-xs text-gray-500">验证人：{linkedPreviewAudit.verification?.verifiedBy || '-'} · 验证日期：{linkedPreviewAudit.verification?.verifiedAt || '-'}</div>
                                      </div>
                                      <div className="mt-4 space-y-3">
                                          {(linkedPreviewAudit.evidences || []).length > 0 ? linkedPreviewAudit.evidences!.map(evidence => (
                                              <div key={evidence.id} className="rounded-2xl border border-white/80 bg-white p-4">
                                                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                                      <div className="flex-1 min-w-0">
                                                          <div className="text-sm font-black text-gray-900 truncate">{evidence.name}</div>
                                                          <div className="mt-2 text-xs text-gray-500">上传：{evidence.uploadDate} · {evidence.uploadedBy || '未记录上传人'}</div>
                                                          <div className="mt-2 text-xs text-gray-600 leading-5">{evidence.note || '暂无证据说明。'}</div>
                                                      </div>
                                                      <div className="flex items-center gap-2 shrink-0">
                                                          <button type="button" onClick={() => handlePreviewAuditEvidence(evidence)} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700 hover:bg-gray-50 flex items-center">
                                                              <Eye className="w-3 h-3 mr-1" /> 预览
                                                          </button>
                                                          <button type="button" onClick={() => handleDownloadAuditEvidence(evidence)} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700 hover:bg-gray-50">
                                                              下载
                                                          </button>
                                                      </div>
                                                  </div>
                                              </div>
                                          )) : (
                                              <div className="rounded-2xl border border-dashed border-indigo-200 bg-white/70 py-6 text-center text-sm text-gray-400">当前关联审计问题暂无同步证据。</div>
                                          )}
                                      </div>
                                  </div>
                              )}
                              {isImage(previewDoc.format) && previewDoc.sourceUrl && previewDoc.sourceUrl !== '#' ? (
                                  <div className="flex flex-col items-center">
                                      <img src={previewDoc.sourceUrl} alt={previewDoc.title} className="max-w-full h-auto rounded-lg shadow-sm" />
                                      <p className="text-xs text-gray-400 mt-4">图片预览模式</p>
                                  </div>
                              ) : isPdf(previewDoc.format) && previewDoc.sourceUrl && previewDoc.sourceUrl !== '#' ? (
                                  <iframe src={previewDoc.sourceUrl} className="w-full h-[800px] border-none rounded-lg" title="PDF Preview"></iframe>
                              ) : previewDoc.content ? (
                                  <div className="markdown-body text-sm text-gray-800 leading-relaxed">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewDoc.content}</ReactMarkdown>
                                  </div>
                              ) : (
                                  <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-center">
                                      <FileText className="w-16 h-16 mb-4 opacity-20" />
                                      <p className="font-bold">无法在线预览全文</p>
                                      <p className="text-xs mt-2 max-w-xs mx-auto">此文件为二进制格式（且未提取文本），请直接下载查看。</p>
                                  </div>
                              )}
                          </div>
                      </div>

                      {/* AI Sidebar —— 只给系统管理员/总经理/总助 */}
                      {canUseAiSummary && (
                      <div className="w-full md:w-80 bg-white border-l border-gray-100 flex flex-col shrink-0">
                          <div className="p-5 border-b border-gray-100 bg-indigo-50/30">
                              <h3 className="font-bold text-indigo-900 flex items-center">
                                  <Bot className="w-5 h-5 mr-2 text-indigo-600" />
                                  AI 智能摘要
                              </h3>
                          </div>
                          <div className="flex-1 overflow-y-auto p-5">
                              {!previewDoc.aiVisible ? (
                                  <div className="text-center py-10">
                                      <ShieldCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                                      <p className="text-sm font-bold text-gray-600">AI 访问受限</p>
                                      <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                                          这份文档设置了**不让 AI 读取**。<br/>AI 不会读取、总结或引用它的内容。<br/><br/>这**不影响人查看** —— 谁能打开，看上面的「可见范围」。
                                      </p>
                                  </div>
                              ) : isSummarizing ? (
                                  <div className="flex flex-col items-center justify-center h-40 text-indigo-500">
                                      <Loader2 className="w-8 h-8 animate-spin mb-3" />
                                      <p className="text-xs font-bold">正在阅读并生成摘要...</p>
                                  </div>
                              ) : previewDoc.summary ? (
                                  <div className="text-sm text-gray-700 leading-relaxed space-y-4">
                                      <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 text-indigo-900">
                                          <Sparkles className="w-4 h-4 mb-2 text-yellow-500" />
                                          {previewDoc.summary}
                                      </div>
                                      <button
                                        onClick={() => generateSummary(previewDoc)}
                                        className="w-full text-[11px] font-bold text-gray-500 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition-colors"
                                      >
                                          <RefreshCw className="w-3 h-3 inline mr-1" /> 重新生成摘要
                                      </button>
                                      <div className="border-t border-gray-100 pt-4">
                                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">建议用途</h4>
                                          <ul className="list-disc list-inside text-xs text-gray-500 space-y-1">
                                              <li>{previewDoc.category === 'Company Profile' ? '公司制度/流程基准' : '内部知识参考'}</li>
                                              <li>{previewDoc.category === 'Standard' ? '合规性检查依据' : '项目交付参考'}</li>
                                              {linkedPreviewAudit && <li>可结合整改证据与验证结论，直接用于同类问题复盘和 SOP 优化。</li>}
                                          </ul>
                                      </div>
                                  </div>
                              ) : (
                                  <div className="text-center py-10">
                                      <p className="text-xs text-gray-400 mb-1">暂无摘要</p>
                                      {/* 不再自动生成：打开预览就调 AI，点一下花一次钱还要干等（P0-12） */}
                                      <p className="text-[10px] text-gray-400 mb-4 leading-4">摘要按需生成，不会自动运行</p>
                                      <button
                                        onClick={() => generateSummary(previewDoc)}
                                        className="text-xs bg-indigo-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-indigo-700 active:scale-95 transition-all"
                                      >
                                          <Sparkles className="w-3 h-3 inline mr-1" /> 生成摘要
                                      </button>
                                      {(() => {
                                        const ex = extractForSummary(previewDoc.content);
                                        const tip = ex.tier === 'empty' ? '该文档没有正文，无法生成'
                                          : ex.tier === 'full' ? `将读取全文（${ex.originalLength} 字）`
                                          : ex.tier === 'outline' ? `全文 ${ex.originalLength} 字，将取开头 + 结构 + 结尾`
                                          : `全文 ${ex.originalLength} 字，仅提取标题结构`;
                                        return <p className="text-[10px] text-gray-400 mt-3 leading-4">{tip}</p>;
                                      })()}
                                  </div>
                              )}
                          </div>
                      </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {previewEvidence && (
          <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                      <div className="text-sm font-black text-gray-900 truncate pr-4">{previewEvidence.name}</div>
                      <button onClick={() => setPreviewEvidence(null)} className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="bg-gray-50 p-4 max-h-[80vh] overflow-auto">
                      {previewEvidence.kind === 'image' ? (
                          <img src={previewEvidence.url} alt={previewEvidence.name} className="w-full rounded-2xl border border-gray-200 bg-white" />
                      ) : (
                          <iframe title={previewEvidence.name} src={previewEvidence.url} className="w-full h-[72vh] rounded-2xl bg-white border border-gray-200" />
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Knowledge;
