
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { FileText, Download, Search, X, Upload, Loader2, BrainCircuit, Trash2, Database, Zap, BookOpen, Sparkles, ArrowRight, Bot, ExternalLink, RefreshCw, Lock, Eye, ShieldCheck, FileKey } from 'lucide-react';
import { KnowledgeDoc, RoleID } from '../types';
import { SYSTEM_ROLES } from '../constants';
import { aiService } from '../services/aiService';
import { IngestionUploader } from '../components/IngestionUploader';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractTextFromDocx } from '../services/documentParsers';

const Knowledge = () => {
  const { knowledgeDocs, addKnowledgeDoc, deleteKnowledgeDoc, updateKnowledgeDoc, currentUser, backfillPdcaForPaidContracts } = useApp();
  const [filter, setFilter] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocCategory, setNewDocCategory] = useState<'Company Profile' | 'Product Service' | 'Standard' | 'Template' | 'Training' | 'PDCA' | 'AI生成' | 'Other'>('Company Profile');
  const [visibleRoles, setVisibleRoles] = useState<RoleID[]>(['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']);
  
  // V5.0 Security: AI Permission Toggle
  const [aiVisible, setAiVisible] = useState(true);

  // Preview Drawer State
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDoc | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);

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

  const accessibleDocs = knowledgeDocs.filter(canAccessDoc);
  const normalizedQuery = searchTerm.trim().toLowerCase();
  const filteredDocsBase = filter === 'All' ? accessibleDocs : accessibleDocs.filter(d => d.category === filter);
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
          default: return cat;
      }
  };

  const getDefaultRolesForCategory = (cat: string): RoleID[] => {
      if (cat === 'PDCA') return ['ADMIN', 'MANAGER', 'FINANCE'];
      if (cat === 'AI生成') return ['ADMIN', 'MANAGER'];
      return ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'];
  };

  useEffect(() => {
      // Auto-generate summary when opening preview if missing
      if (previewDoc && !previewDoc.summary && !isSummarizing && previewDoc.aiVisible) {
          const generateSummary = async () => {
              setIsSummarizing(true);
              try {
                  // Fallback to title if content is missing (for mock binaries)
                  const contentSnippet = previewDoc.content 
                    ? previewDoc.content.slice(0, 2000) 
                    : `(Document Title: ${previewDoc.title}. Category: ${previewDoc.category}. Note: Content is binary/PDF/Image. Please generate a plausible summary based on the title.)`;
                  
                  const prompt = `请为以下文档生成一份精炼的摘要（100字以内），突出核心价值和关键信息点：\n\n${contentSnippet}`;
                  const summary = await aiService.generateText('kimi-k2.5', prompt);
                  
                  // Update global state
                  updateKnowledgeDoc(previewDoc.id, { summary });
                  // Update local preview state to show immediately
                  setPreviewDoc(prev => prev ? { ...prev, summary } : null);
              } catch (e) {
                  console.error("Summary generation failed", e);
              } finally {
                  setIsSummarizing(false);
              }
          };
          generateSummary();
      }
  }, [previewDoc]);

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

          const newDoc: KnowledgeDoc = {
              id: `DOC-${Date.now()}`,
              title: newDocTitle || file.name.replace(/\.[^/.]+$/, ""),
              category: newDocCategory,
              format: detectedFormat,
              size: `${(file.size / 1024).toFixed(1)} KB`,
              updatedAt: new Date().toISOString().split('T')[0],
              content: extractedText,
              sourceUrl: URL.createObjectURL(file), // Create object URL for preview/download
              aiVisible: aiVisible, // V5.0 Security Flag
              accessRoles: visibleRoles
          };
          addKnowledgeDoc(newDoc);
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

  const handleDownload = (e: React.MouseEvent, doc: KnowledgeDoc) => {
      e.stopPropagation();
      if (!doc.sourceUrl || doc.sourceUrl === '#') {
          if (doc.content) {
              const blob = new Blob([doc.content], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${doc.title}.md`; 
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
          } else {
              alert('【演示模式】此为纯演示条目，无实体内容。');
          }
      } else {
          const a = document.createElement('a');
          a.href = doc.sourceUrl;
          a.download = doc.title;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      }
  };

  const isImage = (fmt: string) => ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(fmt.toLowerCase());
  const isPdf = (fmt: string) => ['pdf'].includes(fmt.toLowerCase());

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      {/* 顶部统计区 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600"><BrainCircuit className="w-6 h-6" /></div>
              <div>
                  <p className="text-xs text-gray-400 font-bold uppercase">AI 权限已开文档</p>
                  <div className="flex items-center space-x-2">
                      <p className="text-2xl font-black text-gray-900">{learnedDocsCount}</p>
                      <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">RAG Ready</span>
                  </div>
              </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-gray-50 rounded-xl text-gray-600"><Lock className="w-6 h-6" /></div>
              <div>
                  <p className="text-xs text-gray-400 font-bold uppercase">机密/隔离文档</p>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDocs.map(doc => (
              <div 
                key={doc.id} 
                className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-xl hover:-translate-y-1 cursor-pointer group relative"
                onClick={() => openPreview(doc)}
              >
                  {/* AI Status Badge */}
                  <div className="absolute top-4 right-4">
                      {doc.aiVisible ? (
                          <div className="flex items-center space-x-1 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100" title="AI 已学习 (可引用)">
                              <BrainCircuit className="w-3 h-3 text-indigo-600" />
                              <span className="text-[10px] font-bold text-indigo-600">AI</span>
                          </div>
                      ) : (
                          <div className="flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded-lg border border-gray-200" title="机密文档 (AI 无法读取)">
                              <Lock className="w-3 h-3 text-gray-500" />
                              <span className="text-[10px] font-bold text-gray-500">机密</span>
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
                  
                  {/* Summary Snippet */}
                  {doc.summary ? (
                      <div className={`mt-3 p-2 rounded-lg border ${doc.aiVisible ? 'bg-indigo-50/50 border-indigo-50' : 'bg-gray-50 border-gray-100'}`}>
                          <p className={`text-xs line-clamp-2 leading-relaxed ${doc.aiVisible ? 'text-indigo-800' : 'text-gray-500'}`}>{doc.summary}</p>
                      </div>
                  ) : (
                      <div className="mt-3 p-2 rounded-lg bg-gray-50 border border-gray-50">
                          <p className="text-xs text-gray-400 italic">暂无智能摘要</p>
                      </div>
                  )}

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
          ))}
      </div>

      {/* Upload Modal with Security Toggle */}
      {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4">
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
                                  {aiVisible ? '允许 AI 读取并学习 (RAG)' : '设为机密/隔离文档'}
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
                            onSuccess={(result) => {
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
                                        sourceUrl: doc.sourceUrl || '#',
                                        aiVisible: aiVisible,
                                        accessRoles: visibleRoles
                                    };
                                    addKnowledgeDoc(newDoc);
                                    setIsModalOpen(false);
                                    setNewDocTitle('');
                                    alert("✅ 上传成功！AI 已自动处理内容。");
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
                              <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-xs text-gray-500">{getCategoryLabel(previewDoc.category)}</span>
                                  <span className="text-[10px] bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 font-bold">
                                      可见：{getAccessLabel(previewDoc)}
                                  </span>
                                  {!previewDoc.aiVisible && (
                                      <span className="flex items-center text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-100 font-bold">
                                          <Lock className="w-3 h-3 mr-1" /> 机密模式
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
                          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 min-h-full">
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

                      {/* AI Sidebar */}
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
                                          该文档已被标记为“机密/隔离”。<br/>为了保护您的数据隐私，<br/>AI 无法读取、总结或引用此内容。
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
                                      <div className="border-t border-gray-100 pt-4">
                                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">建议用途</h4>
                                          <ul className="list-disc list-inside text-xs text-gray-500 space-y-1">
                                              <li>{previewDoc.category === 'Company Profile' ? '公司制度/流程基准' : '内部知识参考'}</li>
                                              <li>{previewDoc.category === 'Standard' ? '合规性检查依据' : '项目交付参考'}</li>
                                          </ul>
                                      </div>
                                  </div>
                              ) : (
                                  <div className="text-center py-10">
                                      <p className="text-xs text-gray-400 mb-4">暂无摘要</p>
                                      <button 
                                        onClick={() => setPreviewDoc({...previewDoc, summary: ''})} // Trigger effect manually
                                        className="text-xs bg-indigo-50 text-indigo-600 px-3 py-2 rounded-lg font-bold hover:bg-indigo-100 transition-colors"
                                      >
                                          <RefreshCw className="w-3 h-3 inline mr-1" /> 重新生成
                                      </button>
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Knowledge;
