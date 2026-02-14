
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ChevronDown, ChevronRight, FileText, CheckCircle, Clock, AlertTriangle, Upload, X, Loader2, Plus, Wallet, AlignLeft, Trash2, AlertCircle, Briefcase, Archive, Paperclip, Download, Eye, ShieldAlert, ShieldCheck, Zap, ToggleLeft, ToggleRight, PlayCircle, BrainCircuit, BookOpen } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { aiService } from '../services/aiService'; 
import { IngestionUploader } from '../components/IngestionUploader';
import { Receivable, Lead, Status, Contract, ContractAttachment, KnowledgeDoc } from '../types';
import { extractTextFromDocx, extractTextFromPdf, renderPdfPagesAsImages } from '../services/documentParsers';

const Contracts = () => {
  const { contracts, addContract, deleteContract, archiveContract, projects, addProject, addKnowledgeDoc, checkActionPermission } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const [expandedContract, setExpandedContract] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'risk' | 'archived'>('all');
  
  const [docContent, setDocContent] = useState<any[] | null>(null);
  const [isAnalyzingRisk, setIsAnalyzingRisk] = useState(false);
  const [riskAssessment, setRiskAssessment] = useState<{ level: 'Low' | 'Medium' | 'High'; score: number; summary: string; issues: Array<{ category: string; description: string; severity: 'High' | 'Medium' | 'Low' }>; } | null>(null);

  const [formData, setFormData] = useState({
      title: '', contractNo: '', customerName: '', contactPerson: '', amount: '',
      signDate: new Date().toISOString().split('T')[0], serviceLine: 'ISO 标准',
      paymentMethod: '', remarks: '', createProject: true
  });
  
  const [extractedReceivables, setExtractedReceivables] = useState<Receivable[]>([]);
  const [fileAttachments, setFileAttachments] = useState<ContractAttachment[]>([]);
  const [fromLeadId, setFromLeadId] = useState<string | null>(null);
  const [originalLead, setOriginalLead] = useState<Lead | null>(null);

  const compressImage = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const maxWidth = 1024;
        const quality = 0.7;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl.split(',')[1]); 
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
  };

  useEffect(() => {
      if (location.state) {
          if (location.state.openModal) {
              setIsModalOpen(true);
              const lead = location.state.fromLead;
              if (lead) {
                  setOriginalLead(lead);
                  setFormData(prev => ({
                      ...prev, customerName: lead.company, contactPerson: lead.name, title: `${lead.company} - 服务合同`
                  }));
                  setFromLeadId(lead.id);
              }
          }
          if (location.state.openDetailId) {
              setExpandedContract(location.state.openDetailId);
              setTimeout(() => {
                  const element = document.getElementById(`contract-row-${location.state.openDetailId}`);
                  if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
          }
          window.history.replaceState({}, document.title);
      }
  }, [location]);

  useEffect(() => {
     setExtractedReceivables(prev => prev.map(r => {
         if (r.node.includes('签订') || r.node.includes('签约') || r.node.includes('首付')) {
             return { ...r, dueDate: formData.signDate };
         }
         return r;
     }));
  }, [formData.signDate]);

  const toggleExpand = (id: string) => setExpandedContract(expandedContract === id ? null : id);
  const handleDelete = (e: React.MouseEvent, id: string, title: string) => { e.stopPropagation(); e.preventDefault(); setTimeout(() => { if (window.confirm(`确认要撤销/删除合同 "${title}" 吗？\n\n注意：\n1. 关联的项目将被删除\n2. 若来自线索，线索状态将回滚为“跟进中”`)) { deleteContract(id); } }, 50); };
  const handleArchive = (e: React.MouseEvent, id: string, title: string) => { e.stopPropagation(); e.preventDefault(); setTimeout(() => { if (window.confirm(`确认要归档合同 "${title}" 吗？\n\n归档后，合同将移入历史库，不再显示在活跃列表中，但财务数据保留。`)) { archiveContract(id); } }, 50); };
  const getLinkedProject = (contract: Contract) => projects.find(p => p.contractRef === contract.id || p.contractRef === contract.contractNo);
  const handleCreateProject = (e: React.MouseEvent, contract: Contract) => { e.stopPropagation(); if (window.confirm(`确认要为合同 "${contract.title}" 立项吗？\n\n系统将自动创建交付项目，您可以在“项目管理”中指派负责人。`)) { addProject({ id: `P-${Date.now()}`, name: `${contract.customerName} - ${contract.serviceLine}项目`, contractRef: contract.id, manager: '待指派', progress: 0, status: Status.Active, paymentStatus: 'unpaid', deadline: '2025-12-31', projectType: 'Self-Operated', settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' } }); alert("项目创建成功！"); } };
  const handleGoToProject = (e: React.MouseEvent) => { e.stopPropagation(); navigate('/projects'); }
  const handlePreviewFile = (e: React.MouseEvent, file: ContractAttachment) => { e.stopPropagation(); e.preventDefault(); let targetUrl = file.url; if (!targetUrl) { const lowerType = file.type.toLowerCase(); const lowerName = file.name.toLowerCase(); if (lowerType === 'pdf' || lowerName.endsWith('.pdf')) { targetUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'; } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].some(t => lowerType.includes(t) || lowerName.includes(t))) { targetUrl = 'https://via.placeholder.com/800x600?text=System+Demo+Image'; } else { alert(`【系统提示】\n模拟文件 "${file.name}" 无法在线预览。\n请上传真实文件以体验完整预览功能。`); return; } } if (targetUrl) { window.open(targetUrl, '_blank'); } };
  
  const handleDownloadFile = (e: React.MouseEvent, file: ContractAttachment) => { 
      e.stopPropagation(); 
      e.preventDefault(); 
      if (file.url) { 
          const a = document.createElement('a'); 
          a.href = file.url; 
          a.download = file.name; 
          document.body.appendChild(a); 
          a.click(); 
          document.body.removeChild(a); 
      } else { 
          const lowerType = file.type.toLowerCase(); 
          const lowerName = file.name.toLowerCase(); 
          if (lowerType === 'pdf' || lowerName.endsWith('.pdf')) { 
              window.open('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', '_blank'); 
          } else { 
              setTimeout(() => alert(`【系统提示】\n模拟文件 "${file.name}" 无法下载。\n请上传真实文件以体验完整功能。`), 10); 
          } 
      } 
  };

  // FIX: Push to Knowledge Logic - Wrapped in setTimeout for robust execution
  const handlePushToKnowledge = (e: React.MouseEvent, file: ContractAttachment) => {
      e.stopPropagation();
      e.preventDefault();
      
      try {
          const newDoc: KnowledgeDoc = {
              id: `DOC-FROM-CT-${Date.now()}`,
              title: file.name.replace(/\.[^/.]+$/, "") + ' (合同归档)',
              category: 'Template',
              format: file.type || 'file',
              size: file.size,
              updatedAt: new Date().toISOString().split('T')[0],
              content: `该文档来自合同附件归档 (${file.name})，系统已自动建立索引。\n\n(此处为系统生成的占位符，真实环境将调用 OCR 服务提取全文)`,
              sourceUrl: file.url,
              aiVisible: true
          };
          addKnowledgeDoc(newDoc);
          setTimeout(() => alert(`✅ 已成功将 "${file.name}" 推送到知识中心！\n\n您可以在“知识中心”查看。`), 10);
      } catch (error) {
          console.error("Push failed:", error);
          setTimeout(() => alert("❌ 推送失败，请稍后重试。"), 10);
      }
  };

  const performFastExtraction = (text: string) => {
      const amountMatch = text.match(/(\d{1,3}(,\d{3})*(\.\d{1,2})?)(?=\s*(元|圆|RMB))/);
      const yearMatch = text.match(/202\d[-/年]\d{1,2}[-/月]\d{1,2}/);
      
      const updates: any = {};
      if (amountMatch) {
          updates.amount = amountMatch[1].replace(/,/g, '');
      }
      if (yearMatch) {
          updates.signDate = yearMatch[0].replace(/[年/]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, '');
      }
      if (Object.keys(updates).length > 0) {
          setFormData(prev => ({ ...prev, ...updates }));
      }
  };

  const PLACEHOLDER_RE = /(某某|xxx|示例|样例|测试|待定|未知|甲方|乙方|北京某某|2024-xx-xx|合同编号|请填写)/i;
  const isLikelyPlaceholder = (val: unknown) => PLACEHOLDER_RE.test(String(val || '').trim());
  const hasUsefulText = (val: unknown) => {
      const text = String(val || '').trim();
      if (!text) return false;
      if (text.length < 2) return false;
      return !isLikelyPlaceholder(text);
  };
  const normalizeForMatch = (input: string) =>
      String(input || '')
          .toLowerCase()
          .replace(/[\s\r\n\t\u3000]/g, '')
          .replace(/[，。、“”‘’：:；;（）()【】[\]《》<>]/g, '');
  const sanitizeNumber = (val: any) => {
      if (val === null || val === undefined || val === '') return '';
      const num = String(val).replace(/[^0-9.]/g, '');
      const parsed = parseFloat(num);
      return Number.isFinite(parsed) ? parsed : '';
  };
  const sanitizeDate = (val: any) => {
      if (!val) return '';
      const dateStr = String(val).replace(/年|\./g, '-').replace(/月/g, '-').replace(/日/g, '');
      const timestamp = Date.parse(dateStr);
      if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString().split('T')[0];
      return '';
  };
  const appearsInSource = (sourceText: string, value: string) => {
      const s = String(sourceText || '').trim();
      const v = String(value || '').trim();
      if (!s || !v) return true; // Binary files may have no extracted plain text
      if (v.length < 3) return true;
      const sn = normalizeForMatch(s);
      const vn = normalizeForMatch(v);
      if (!vn) return false;
      return sn.includes(vn);
  };
  const hasEvidenceForField = (
      field: string,
      value: string,
      evidence: Record<string, unknown> | undefined,
      sourceText: string
  ) => {
      if (!hasUsefulText(value)) return false;
      if (appearsInSource(sourceText, value)) return true;
      const ev = String(evidence?.[field] || '').trim();
      if (!ev || isLikelyPlaceholder(ev)) return false;
      if (value.length >= 3 && ev.includes(value.slice(0, Math.min(6, value.length)))) return true;
      return ev.length >= 8;
  };
  const heuristicExtractFromText = (rawText: string, fileName: string) => {
      const text = String(rawText || '');
      const out: any = {};
      const pick = (...patterns: RegExp[]) => {
          for (const p of patterns) {
              const m = text.match(p);
              if (m?.[1]) return String(m[1]).trim();
          }
          return '';
      };

      const title = pick(
          /(?:合同名称|协议名称|文件名称)\s*[:：]\s*([^\n]{4,80})/i,
          /([^\n]{2,40}(?:合同|协议))/i
      );
      if (hasUsefulText(title)) out.title = title;

      const contractNo = pick(
          /(?:合同编号|合同号|编号)\s*[:：]\s*([A-Za-z0-9\-\/_]{4,40})/i
      );
      if (hasUsefulText(contractNo)) out.contractNo = contractNo;

      const customerName = pick(
          /(?:甲方|委托方|需方|买方)\s*[:：]\s*([^\n，。,；;（）()]{4,80}(?:公司|集团|研究院|医院|中心|厂|店|有限公司|股份有限公司))/i,
          /([^\n，。,；;（）()]{4,80}(?:公司|集团|研究院|医院|中心|厂|店|有限公司|股份有限公司))/i
      );
      if (hasUsefulText(customerName)) out.customerName = customerName;

      const amountRaw = pick(
          /(?:合同(?:总)?金额|总价|总金额|金额)\s*[:：]?\s*([0-9][0-9,]{2,}(?:\.[0-9]{1,2})?)/i,
          /人民币\s*([0-9][0-9,]{2,}(?:\.[0-9]{1,2})?)\s*元/i
      );
      const amount = sanitizeNumber(amountRaw);
      if (amount && Number(amount) > 0) out.amount = amount;

      const signDate = sanitizeDate(pick(
          /(?:签订日期|签约日期|签订时间|签约时间|日期)\s*[:：]?\s*(20\d{2}[年\-\/\.]\d{1,2}[月\-\/\.]\d{1,2})/i
      ));
      if (signDate) out.signDate = signDate;

      if (!out.title) out.title = fileName.replace(/\.[^/.]+$/, '');
      return out;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      setRiskAssessment(null);
      setDocContent(null);
      // Prevent stale auto-filled values from previous uploads.
      setExtractedReceivables([]);
      setFormData(prev => ({
          ...prev,
          title: '',
          contractNo: '',
          customerName: '',
          contactPerson: '',
          amount: '',
          paymentMethod: '',
          remarks: '',
          signDate: new Date().toISOString().split('T')[0]
      }));
      
      const blobUrl = URL.createObjectURL(file);
      setFileAttachments(prev => [...prev, {
          id: `A-${Date.now()}`, name: file.name, size: `${(file.size / 1024 / 1024).toFixed(2)} MB`, type: file.name.split('.').pop() || 'file', uploadDate: new Date().toISOString().split('T')[0], url: blobUrl
      }]);

      try {
          let promptParts: any[] = [];
          let extractedPlainText = '';

          if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
              extractedPlainText = await extractTextFromDocx(file);
              if (!extractedPlainText || extractedPlainText.length < 20) {
                  throw new Error('DOCX 未提取到可读文本，请确认文件未加密且内容不是纯图片。');
              }
              performFastExtraction(extractedPlainText);
              promptParts = [
                  { text: extractedPlainText }
              ];
          } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
              extractedPlainText = await extractTextFromPdf(file);
              if (extractedPlainText && extractedPlainText.length > 30) {
                  performFastExtraction(extractedPlainText);
                  promptParts = [
                      { text: extractedPlainText.slice(0, 30000) }
                  ];
              } else {
                  // Fallback for scanned PDFs (image-based): render pages to images and run OCR on images.
                  const imagePages = await renderPdfPagesAsImages(file, 3);
                  if (imagePages.length > 0) {
                      promptParts = imagePages.map((data) => ({
                          inlineData: { mimeType: 'image/jpeg', data }
                      }));
                  } else {
                      throw new Error('PDF 未提取到可读内容（文本/OCR均失败）。请改用清晰扫描件或先转图片后上传。');
                  }
              }
          } else {
              let base64Data: string;
              if (file.type.startsWith('image/')) {
                  base64Data = await compressImage(file);
              } else {
                  base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.onerror = error => reject(error);
                  });
              }
              promptParts = [
                  { inlineData: { mimeType: file.type.startsWith('image/') ? 'image/jpeg' : file.type, data: base64Data } }
              ];
          }

          setDocContent(promptParts);

          const hasUsablePrompt = promptParts.some((part) => {
              if (part?.text && String(part.text).trim().length >= 12) return true;
              const mt = String(part?.inlineData?.mimeType || '').toLowerCase();
              return mt.startsWith('image/');
          });
          if (!hasUsablePrompt) {
              throw new Error('未提取到可识别内容，已中止AI识别（避免空识别/乱填）。');
          }

          const instructionText = `
你是合同信息抽取器。必须“只抽取可证据确认的信息”，禁止猜测、禁止样例填充。

严格规则：
1) 无法确认的字段必须留空（"" / null），不要编造默认值。
2) 不得输出“某某、XXX、示例、北京某某科技有限公司、2024-XX-XX-001”这类占位内容。
3) 如果文件不可读或信息不足，请返回 extractionStatus="unreadable" 或 "partial"。
4) 仅输出 JSON，不要 Markdown。

输出 JSON 结构：
{
  "extractionStatus": "success|partial|unreadable",
  "overallConfidence": 0.0,
  "data": {
    "title": "",
    "contractNo": "",
    "customerName": "",
    "contactPerson": "",
    "amount": null,
    "signDate": "",
    "serviceLine": "",
    "paymentMethod": "",
    "notes": "",
    "paymentPlan": [{"node":"","amount":null,"date":""}]
  },
  "evidence": {
    "title": "",
    "contractNo": "",
    "customerName": "",
    "amount": "",
    "signDate": ""
  }
}`.trim();

          promptParts.push({ text: instructionText });

          const extractedData = await aiService.generateJSON('kimi-k2.5', promptParts as any);
          const payload = (extractedData?.data && typeof extractedData.data === 'object') ? extractedData.data : extractedData;
          const evidence = (extractedData?.evidence && typeof extractedData.evidence === 'object') ? extractedData.evidence as Record<string, unknown> : undefined;
          const extractionStatus = String(extractedData?.extractionStatus || '').toLowerCase();
          const overallConfidence = Number(extractedData?.overallConfidence ?? extractedData?.confidence ?? 0);

          const candidateTitle = String(payload?.title || '').trim();
          const candidateContractNo = String(payload?.contractNo || '').trim();
          const candidateCustomer = String(payload?.customerName || '').trim();
          const candidateContact = String(payload?.contactPerson || '').trim();
          const candidateAmount = sanitizeNumber(payload?.amount);
          const candidateSignDate = sanitizeDate(payload?.signDate);
          const candidateServiceLine = String(payload?.serviceLine || '').trim();
          const candidatePaymentMethod = String(payload?.paymentMethod || '').trim();
          const candidateNotes = String(payload?.notes || '').trim();

          const trustedTitle = hasEvidenceForField('title', candidateTitle, evidence, extractedPlainText) ? candidateTitle : '';
          const trustedContractNo = hasEvidenceForField('contractNo', candidateContractNo, evidence, extractedPlainText) ? candidateContractNo : '';
          const trustedCustomer = hasEvidenceForField('customerName', candidateCustomer, evidence, extractedPlainText) ? candidateCustomer : '';
          const trustedContact = hasEvidenceForField('contactPerson', candidateContact, evidence, extractedPlainText) ? candidateContact : '';
          const amountEvidence = hasEvidenceForField('amount', String(candidateAmount || ''), evidence, extractedPlainText);
          const trustedAmount = (candidateAmount && candidateAmount > 0 && amountEvidence) ? candidateAmount : '';
          const dateEvidence = hasEvidenceForField('signDate', candidateSignDate, evidence, extractedPlainText);
          const trustedSignDate = dateEvidence ? candidateSignDate : '';
          const trustedServiceLine = hasUsefulText(candidateServiceLine) ? candidateServiceLine : '';
          const trustedPaymentMethod = hasUsefulText(candidatePaymentMethod) ? candidatePaymentMethod : '';
          const trustedNotes = hasUsefulText(candidateNotes) ? candidateNotes : '';

          const trustedKeyCount = [trustedTitle, trustedContractNo, trustedCustomer, trustedAmount, trustedSignDate].filter(Boolean).length;
          const lowTrust = extractionStatus === 'unreadable' || (overallConfidence > 0 && overallConfidence < 0.5);

          let finalTitle = trustedTitle;
          let finalContractNo = trustedContractNo;
          let finalCustomer = trustedCustomer;
          let finalContact = trustedContact;
          let finalAmount = trustedAmount;
          let finalSignDate = trustedSignDate;
          let finalServiceLine = trustedServiceLine;
          let finalPaymentMethod = trustedPaymentMethod;
          let finalNotes = trustedNotes;

          if (trustedKeyCount === 0 || lowTrust) {
              const heuristic = heuristicExtractFromText(extractedPlainText, file.name);
              finalTitle = finalTitle || String(heuristic.title || '');
              finalContractNo = finalContractNo || String(heuristic.contractNo || '');
              finalCustomer = finalCustomer || String(heuristic.customerName || '');
              finalAmount = finalAmount || sanitizeNumber(heuristic.amount);
              finalSignDate = finalSignDate || sanitizeDate(heuristic.signDate);
          }

          const finalKeyCount = [finalTitle, finalContractNo, finalCustomer, finalAmount, finalSignDate].filter(Boolean).length;
          if (finalKeyCount === 0) {
              alert('未识别到有效字段：可能是扫描件质量低或文本不可读。建议上传更清晰PDF/图片，或先手动录入关键字段。');
              return;
          }

          const extractedSignDate = finalSignDate || formData.signDate;
          setFormData(prev => ({
              ...prev,
              title: finalTitle || prev.title || file.name.replace(/\.[^/.]+$/, ""),
              contractNo: finalContractNo || prev.contractNo,
              customerName: finalCustomer || prev.customerName,
              contactPerson: finalContact || prev.contactPerson,
              amount: finalAmount ? String(finalAmount) : String(prev.amount || ''),
              signDate: extractedSignDate,
              serviceLine: finalServiceLine || prev.serviceLine,
              paymentMethod: finalPaymentMethod || prev.paymentMethod,
              remarks: finalNotes || prev.remarks
          }));

          if (Array.isArray(payload?.paymentPlan)) {
             const newReceivables: Receivable[] = payload.paymentPlan
                .map((p: any, index: number) => {
                    const nodeRaw = String(p?.node || '').trim();
                    const node = hasUsefulText(nodeRaw) ? nodeRaw : `第${index + 1}期`;
                    const amount = Number(sanitizeNumber(p?.amount)) || 0;
                    let dueDate = sanitizeDate(p?.date);
                    if (!dueDate && /签订|签约|首付/.test(node)) dueDate = extractedSignDate;
                    return { id: `R-AUTO-${Date.now()}-${index}`, node, amount, dueDate, status: 'unpaid' as const };
                })
                .filter((r: Receivable) => r.amount > 0);
             if (newReceivables.length > 0) setExtractedReceivables(newReceivables);
          } else if (finalAmount) {
              setExtractedReceivables([{ id: `R-AUTO-${Date.now()}-0`, node: '全额付款', amount: Number(finalAmount), dueDate: extractedSignDate, status: 'unpaid' }]);
          }

      } catch (error) {
          console.error("AI Extraction Failed:", error);
          const msg = error instanceof Error ? error.message : '识别失败，请重试';
          alert(`识别失败：${msg}`);
      } finally {
          setIsUploading(false);
      }
  };

  const handleRiskAnalysis = async () => {
      if (!docContent) return;
      setIsAnalyzingRisk(true);
      try {
          const analysisParts = [...docContent];
          const instructionText = `Task: Perform Risk Assessment on this contract (Chinese).
            Output JSON: { "riskAssessment": { "level": "High"|"Medium"|"Low", "score": number, "summary": string, "issues": [{ "category": string, "description": string, "severity": "High"|"Medium"|"Low" }] } }`;
          
          analysisParts.push({ text: instructionText });

          const result = await aiService.generateJSON('kimi-k2.5', analysisParts as any);
          
          if (result.riskAssessment) {
              setRiskAssessment(result.riskAssessment);
          } else {
              alert("AI 未发现明显风险或解析失败。");
          }
      } catch (error) {
          console.error("Risk Analysis Failed", error);
          alert("分析服务繁忙");
      } finally {
          setIsAnalyzingRisk(false);
      }
  };

  const handleReceivableChange = (index: number, field: keyof Receivable, value: any) => { const updated = [...extractedReceivables]; updated[index] = { ...updated[index], [field]: value }; setExtractedReceivables(updated); };
  const addReceivable = () => { setExtractedReceivables([...extractedReceivables, { id: `R-MANUAL-${Date.now()}`, node: `第${extractedReceivables.length + 1}期`, amount: 0, dueDate: '', status: 'unpaid' }]); };
  const removeReceivable = (index: number) => { setExtractedReceivables(extractedReceivables.filter((_, i) => i !== index)); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const perm = checkActionPermission('CONTRACT_CREATE');
    if (!perm.allowed) {
      alert(`权限拒绝：${perm.reason || '无权限'}`);
      return;
    }
    const result = addContract(
      {
        ...formData,
        receivables: extractedReceivables.length > 0 ? extractedReceivables : undefined,
        riskLevel: riskAssessment?.level || 'Low',
        attachments: fileAttachments
      },
      formData.createProject,
      fromLeadId || undefined
    );

    if (!result.ok) {
      alert(result.reason || '录入失败');
      if (result.existingContractId) {
        setIsModalOpen(false);
        setExpandedContract(result.existingContractId);
        setTimeout(() => {
          const element = document.getElementById(`contract-row-${result.existingContractId}`);
          if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
      return;
    }

    setIsModalOpen(false);
    setFormData({ title: '', contractNo: '', customerName: '', contactPerson: '', amount: '', signDate: new Date().toISOString().split('T')[0], serviceLine: 'ISO 标准', paymentMethod: '', remarks: '', createProject: true });
    setExtractedReceivables([]);
    setFileAttachments([]);
    setFromLeadId(null);
    setOriginalLead(null);
    setRiskAssessment(null);
    setDocContent(null);
  };
  const totalReceivables = extractedReceivables.reduce((sum, r) => sum + Number(r.amount), 0);
  const contractAmount = Number(formData.amount);
  const isTotalMatching = Math.abs(totalReceivables - contractAmount) < 1;
  const hasSubjectMismatch = fromLeadId && formData.customerName && originalLead?.company && originalLead.company !== formData.customerName;
  const calculateProgress = (contract: Contract) => { const paid = contract.receivables.filter(r => r.status === 'paid').reduce((acc, r) => acc + r.amount, 0); return contract.amount > 0 ? (paid / contract.amount) * 100 : 0; };
  const filteredContracts = contracts.filter(c => { if (filterStatus === 'all') return c.archiveStatus !== 'archived'; if (filterStatus === 'archived') return c.archiveStatus === 'archived'; if (filterStatus === 'risk') return c.riskLevel === 'High' || c.status === Status.Risk; if (filterStatus === 'active') return c.archiveStatus !== 'archived' && c.status === Status.Active; return true; });
  const createContractPerm = checkActionPermission('CONTRACT_CREATE');

  return (
    <div className="p-6">
       <div className="mb-6 flex justify-between items-center">
           <div><h1 className="text-2xl font-bold text-gray-900">合同管理</h1><p className="text-sm text-gray-500 mt-1">管理合同详情、回款节点与执行状态</p></div>
           <button
             onClick={() => {
               if (!createContractPerm.allowed) {
                 alert(`权限拒绝：${createContractPerm.reason || '无权限'}`);
                 return;
               }
               setIsModalOpen(true);
             }}
             className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 flex items-center shadow-sm whitespace-nowrap transition-all active:scale-95"
           >
             <Plus className="w-4 h-4 mr-2" /> 录入合同
           </button>
      </div>
      <div className="flex space-x-2 mb-6 border-b border-gray-200 pb-1 overflow-x-auto no-scrollbar"> {[ { id: 'all', label: '全部活跃', icon: AlignLeft }, { id: 'active', label: '执行中', icon: Zap }, { id: 'risk', label: '风险预警', icon: ShieldAlert }, { id: 'archived', label: '已归档', icon: Archive }, ].map(tab => ( <button key={tab.id} onClick={() => setFilterStatus(tab.id as any)} className={`flex items-center px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap uppercase tracking-wide ${ filterStatus === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300' }`} > <tab.icon className="w-4 h-4 mr-2" /> {tab.label} </button> ))} </div>
      
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm text-left">
            <thead className="bg-gray-50/50 text-gray-600 font-bold text-sm uppercase tracking-wider border-b border-gray-100">
                <tr>
                    <th className="w-10"></th>
                    <th className="px-6 py-4">合同编号/标题</th>
                    <th className="px-6 py-4">客户</th>
                    <th className="px-6 py-4">回款进度</th>
                    <th className="px-6 py-4">风险/状态</th>
                    <th className="px-6 py-4 text-center">操作</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {filteredContracts.map(contract => {
                    const linkedProject = getLinkedProject(contract);
                    const progress = calculateProgress(contract);
                    return ( <React.Fragment key={contract.id}> 
                        <tr id={`contract-row-${contract.id}`} className={`hover:bg-gray-50/80 cursor-pointer transition-colors group ${expandedContract === contract.id ? 'bg-indigo-50/50' : ''}`} onClick={() => toggleExpand(contract.id)}> 
                            <td className="pl-4 text-gray-300"> {expandedContract === contract.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} </td> 
                            <td className="px-6 py-5"> 
                                <div className="flex items-center font-black text-gray-900 text-base"> <FileText className="w-4 h-4 mr-2 text-gray-400" /> {contract.title} </div> 
                                <div className="text-sm text-gray-500 mt-1 pl-6 font-mono">{contract.contractNo || '-'}</div> 
                            </td> 
                            <td className="px-6 py-5">
                                <div className="font-bold text-gray-700 text-sm">{contract.customerName}</div>
                                <div className="text-sm text-gray-500 mt-0.5">{contract.contactPerson}</div>
                            </td> 
                            <td className="px-6 py-5 w-48"> 
                                <div className="flex items-center justify-between text-sm mb-1"> 
                                    <span className="text-gray-900 font-mono font-black text-base">¥{contract.amount.toLocaleString()}</span> 
                                    <span className="font-bold text-gray-500 font-mono">{progress.toFixed(0)}%</span> 
                                </div> 
                                <div className="w-full bg-gray-200 rounded-full h-1.5"> <div className={`h-1.5 rounded-full ${progress === 100 ? 'bg-green-500' : 'bg-blue-600'}`} style={{width: `${progress}%`}}></div> </div> 
                            </td> 
                            <td className="px-6 py-5"> 
                                <div className="flex space-x-2"> 
                                    {contract.archiveStatus === 'archived' ? ( <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase tracking-tight bg-gray-100 text-gray-600 border border-gray-200"> <Archive className="w-3 h-3 mr-1" /> 已归档 </span> ) : ( <> {contract.riskLevel === 'High' && ( <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase tracking-tight bg-red-100 text-red-700 border border-red-200"> <ShieldAlert className="w-3 h-3 mr-1" /> 高风险 </span> )} {contract.riskLevel === 'Medium' && ( <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase tracking-tight bg-orange-100 text-orange-700 border border-orange-200"> <AlertTriangle className="w-3 h-3 mr-1" /> 中风险 </span> )} {contract.riskLevel === 'Low' && ( <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase tracking-tight bg-green-100 text-green-700 border border-green-200"> <ShieldCheck className="w-3 h-3 mr-1" /> 正常 </span> )} </> )} 
                                </div> 
                            </td> 
                            <td className="px-6 py-5 text-center w-24" onClick={(e) => e.stopPropagation()}> 
                                <div className="flex flex-col items-center justify-center space-y-2">
                                {contract.archiveStatus !== 'archived' && ( 
                                    <> 
                                        {/* Top: Main Action */}
                                        {linkedProject ? ( 
                                            <button onClick={handleGoToProject} className="w-full text-xs bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 px-2 py-1.5 rounded-lg flex items-center justify-center transition-colors font-bold whitespace-nowrap" title={`已关联项目: ${linkedProject.name}`} > 
                                                <Briefcase className="w-3 h-3 mr-1" /> 已立项 
                                            </button> 
                                        ) : ( 
                                            <button onClick={(e) => handleCreateProject(e, contract)} className="w-full text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 px-2 py-1.5 rounded-lg flex items-center justify-center transition-colors shadow-sm font-bold whitespace-nowrap" title="一键转为交付项目" > 
                                                <Briefcase className="w-3 h-3 mr-1" /> 转项目 
                                            </button> 
                                        )} 
                                        {/* Middle: Archive */}
                                        <button onClick={(e) => handleArchive(e, contract.id, contract.title)} className="w-full p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center" title="归档合同" > 
                                            <Archive className="w-4 h-4" /> 
                                        </button> 
                                    </> 
                                )} 
                                {/* Bottom: Delete */}
                                <button type="button" onClick={(e) => handleDelete(e, contract.id, contract.title)} className="w-full p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center" title="删除合同" > 
                                    <Trash2 className="w-4 h-4" /> 
                                </button> 
                                </div>
                            </td> 
                        </tr> 
                        {expandedContract === contract.id && ( <tr> <td colSpan={8} className="bg-gray-50/50 p-6 animate-in slide-in-from-top-2 duration-200"> 
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"> 
                                <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-gray-100"> 
                                    {/* Details */} 
                                    <div className="flex-1 p-6"> <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center"> <AlignLeft className="w-4 h-4 mr-2" /> 基础信息 </h4> <div className="space-y-3 text-sm"> <div className="flex justify-between border-b border-gray-50 pb-2"> <span className="text-gray-500 font-bold text-xs uppercase">签订日期</span> <span className="text-gray-900 font-mono">{contract.signDate}</span> </div> <div className="flex justify-between border-b border-gray-50 pb-2"> <span className="text-gray-500 font-bold text-xs uppercase">支付方式</span> <span className="text-gray-900">{contract.paymentMethod || '-'}</span> </div> <div className="flex justify-between border-b border-gray-50 pb-2"> <span className="text-gray-500 font-bold text-xs uppercase">服务项目</span> <span className="text-gray-900 font-bold">{contract.serviceLine}</span> </div> <div className="pt-2"> <span className="text-gray-500 block mb-1 text-xs font-bold uppercase">备注</span> <p className="text-gray-700 bg-gray-50 p-3 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">{contract.remarks || '无'}</p> </div> </div> </div> 
                                    {/* Receivables */} 
                                    <div className="flex-1 p-6 bg-gray-50/30"> <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center"> <Wallet className="w-4 h-4 mr-2" /> 回款计划 </h4> <div className="space-y-2"> {contract.receivables.map(r => ( <div key={r.id} className="flex justify-between text-sm border-b border-gray-100 pb-2 items-center"> <div className="flex items-center"> {r.status === 'paid' ? <CheckCircle className="w-3 h-3 text-green-500 mr-2" /> : <Clock className="w-3 h-3 text-yellow-500 mr-2" />} <span className="text-gray-900 font-bold text-sm">{r.node}</span> </div> <div className="text-right"> <div className="font-mono font-bold text-gray-900">¥{r.amount.toLocaleString()}</div> <div className="text-xs text-gray-400">{r.dueDate || '待定'}</div> </div> </div> ))} </div> </div> 
                                    {/* Archives */} 
                                    <div className="flex-1 p-6 bg-blue-50/10"> 
                                        <div className="flex justify-between items-center mb-4"> 
                                            <h4 className="text-sm font-black text-blue-800 uppercase tracking-widest flex items-center"> <Paperclip className="w-4 h-4 mr-2" /> 电子档案柜 </h4> 
                                            <button className="text-xs font-bold text-blue-600 hover:underline flex items-center"> <Plus className="w-3 h-3 mr-1" /> 添加 </button> 
                                        </div> 
                                        <div className="space-y-3"> 
                                            {contract.attachments && contract.attachments.length > 0 ? contract.attachments.map(file => ( 
                                                <div key={file.id} className="flex items-center justify-between p-2 bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow"> 
                                                    <div className="flex items-center overflow-hidden"> 
                                                        <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center shrink-0 text-xs font-black text-gray-500 uppercase mr-3"> {file.type} </div> 
                                                        <div className="min-w-0"> <div className="text-sm font-bold text-gray-900 truncate max-w-[120px]" title={file.name}>{file.name}</div> <div className="text-xs text-gray-400">{file.size} • {file.uploadDate}</div> </div> 
                                                    </div> 
                                                    <div className="flex space-x-1"> 
                                                        <button onClick={(e) => handlePreviewFile(e, file)} className="p-1 hover:bg-gray-100 rounded text-gray-500" title="预览" > <Eye className="w-4 h-4" /> </button> 
                                                        <button onClick={(e) => handleDownloadFile(e, file)} className="p-1 hover:bg-gray-100 rounded text-gray-500" title="下载" > <Download className="w-4 h-4" /> </button> 
                                                        <button 
                                                            onClick={(e) => handlePushToKnowledge(e, file)} 
                                                            className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-indigo-600 transition-colors" 
                                                            title="存入知识中心"
                                                        >
                                                            <BookOpen className="w-4 h-4" />
                                                        </button>
                                                    </div> 
                                                </div> 
                                            )) : ( 
                                                <div className="text-center py-6 text-gray-400 text-xs border-2 border-dashed border-gray-100 rounded-lg font-medium"> 暂无归档文件 </div> 
                                            )} 
                                        </div> 
                                    </div> 
                                </div> 
                            </div> 
                        </td> </tr> )} 
                    </React.Fragment> );})}
            </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-gray-100">
          {filteredContracts.map(contract => {
              const linkedProject = getLinkedProject(contract);
              const progress = calculateProgress(contract);
              return (
                  <div key={contract.id} className="p-4 active:bg-gray-50 transition-colors" onClick={() => toggleExpand(contract.id)}>
                      <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0 mr-2">
                              <div className="font-bold text-gray-900 truncate text-sm">{contract.title}</div>
                              <div className="text-sm text-gray-500 truncate mt-0.5">{contract.customerName}</div>
                          </div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-tight ${contract.riskLevel === 'High' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {contract.riskLevel === 'High' ? '高风险' : '正常'}
                          </span>
                      </div>
                      <div className="flex justify-between items-center text-xs mb-2">
                          <span className="font-mono font-black text-gray-900">¥{contract.amount.toLocaleString()}</span>
                          <span className="text-gray-400 font-mono">{contract.signDate}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-3">
                          <div className={`h-1.5 rounded-full ${progress === 100 ? 'bg-green-500' : 'bg-blue-600'}`} style={{width: `${progress}%`}}></div>
                      </div>
                      
                      {expandedContract === contract.id && (
                          <div className="mt-4 pt-4 border-t border-gray-100 text-sm space-y-4 bg-gray-50/50 -mx-4 px-4 pb-0 animate-in slide-in-from-top-1">
                              {/* ... Mobile Expanded Content ... */}
                              {/* Archives in Mobile */}
                              <div className="border rounded-xl bg-white overflow-hidden border-gray-100">
                                  <div className="bg-blue-50/50 px-3 py-2 text-xs font-black text-blue-400 uppercase tracking-widest border-b border-blue-50 flex justify-between items-center">
                                      <span>电子档案</span>
                                      <Paperclip className="w-3 h-3" />
                                  </div>
                                  <div className="p-2 space-y-2">
                                      {contract.attachments && contract.attachments.length > 0 ? contract.attachments.map(file => (
                                          <div key={file.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                                              <div className="flex items-center overflow-hidden mr-2">
                                                  <div className="w-6 h-6 bg-white rounded flex items-center justify-center text-xs font-black text-gray-500 border border-gray-200 uppercase shrink-0 mr-2">{file.type}</div>
                                                  <div className="truncate text-xs font-bold text-gray-700">{file.name}</div>
                                              </div>
                                              <div className="flex space-x-1">
                                                  <button onClick={(e) => handleDownloadFile(e, file)} className="text-gray-400 hover:text-blue-600"><Download className="w-3 h-3" /></button>
                                                  <button onClick={(e) => handlePushToKnowledge(e, file)} className="text-gray-400 hover:text-indigo-600"><BookOpen className="w-3 h-3" /></button>
                                              </div>
                                          </div>
                                      )) : <div className="text-center py-2 text-xs text-gray-300">暂无附件</div>}
                                  </div>
                              </div>
                              {/* ... */}
                          </div>
                      )}
                  </div>
              )
          })}
      </div>
      
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            {/* Modal Body */}
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-3xl animate-in fade-in zoom-in duration-200 max-h-[90vh] border border-gray-100 overflow-hidden flex flex-col">
                <div className="overflow-y-auto p-8 w-full h-full">
                    {/* ... Existing Modal Content ... */}
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-black text-gray-900 flex items-center">
                            {fromLeadId && <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded mr-2 font-bold uppercase">来自线索</span>}
                            录入合同
                        </h2>
                        <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
                    </div>
                    
                    {/* AI Upload Section - Unified Base */}
                     <div className="mb-6">
                        <IngestionUploader 
                            source="contract"
                            label="点击上传或拖拽合同文件"
                            subLabel="支持 PDF, Word, 图片 • 自动识别金额、条款与支付节点"
                            disabled={isUploading || !createContractPerm.allowed}
                            onSuccess={(result, file) => {
                                const data = result.data;
                                if (!data) return;

                                const hasCoreFields = Boolean(
                                  String(data.contractNo || '').trim() ||
                                  String(data.customerName || '').trim() ||
                                  (Number(data.amount) > 0) ||
                                  String(data.signDate || '').trim()
                                );
                                if (!hasCoreFields) {
                                  alert('识别失败：未提取到关键字段（客户/金额/编号/日期），请上传更清晰文件重试。');
                                  return;
                                }

                                const paymentPlan = Array.isArray(data.paymentPlan) ? data.paymentPlan : [];
                                const paymentTotal = paymentPlan.reduce((sum: number, p: any) => sum + (Number(p?.amount) || 0), 0);
                                const extractedAmount = Number(data.amount) || 0;
                                const amountGapRatio = paymentTotal > 0 ? Math.abs(extractedAmount - paymentTotal) / paymentTotal : 0;
                                const resolvedAmount = (() => {
                                  if (paymentTotal <= 0) return extractedAmount || 0;
                                  if (extractedAmount <= 0) return paymentTotal;
                                  if (paymentPlan.length === 1) return paymentTotal;
                                  if (amountGapRatio > 0.2) return paymentTotal;
                                  return extractedAmount;
                                })();
                                
                                // Auto-add attachment
                                if (file) {
                                    const blobUrl = URL.createObjectURL(file);
                                    setFileAttachments(prev => [...prev, {
                                        id: `A-${Date.now()}`,
                                        name: file.name,
                                        size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                                        type: file.name.split('.').pop() || 'file',
                                        uploadDate: new Date().toISOString().split('T')[0],
                                        url: blobUrl
                                    }]);
                                }
                                
                                // Auto-fill form
                                setFormData(prev => ({
                                    ...prev,
                                    title: data.title || prev.title,
                                    contractNo: data.contractNo || prev.contractNo,
                                    customerName: data.customerName || prev.customerName,
                                    contactPerson: data.contactPerson || prev.contactPerson,
                                    amount: resolvedAmount ? resolvedAmount.toString() : prev.amount,
                                    signDate: data.signDate || prev.signDate,
                                    serviceLine: data.serviceLine || prev.serviceLine,
                                    paymentMethod: data.paymentMethod || prev.paymentMethod,
                                    remarks: data.notes || prev.remarks
                                }));

                                // Auto-fill receivables
                                if (data.paymentPlan && Array.isArray(data.paymentPlan)) {
                                    const newReceivables: Receivable[] = data.paymentPlan.map((p: any, index: number) => ({
                                        id: `R-AUTO-${Date.now()}-${index}`,
                                        node: p.phase || p.node || `第${index + 1}期`,
                                        amount: Number(p.amount) || 0,
                                        dueDate: p.plannedDate || p.date || '',
                                        status: 'unpaid'
                                    }));
                                    setExtractedReceivables(newReceivables);
                                } else if (data.amount) {
                                    setExtractedReceivables([{ 
                                        id: `R-AUTO-${Date.now()}-0`, 
                                        node: '全额付款', 
                                        amount: Number(data.amount), 
                                        dueDate: data.signDate || '', 
                                        status: 'unpaid' 
                                    }]);
                                }
                                
                                alert("✅ 合同识别成功！请核对下方信息。");
                            }}
                            onError={(msg) => alert(`识别失败: ${msg}`)}
                        />
                    </div>

                    {/* ... Form ... */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* ... Existing Fields ... */}
                        <div className="grid grid-cols-2 gap-4"> <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">合同标题</label> <input required type="text" className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} /> </div> <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">合同编号</label> <input type="text" className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm" value={formData.contractNo} onChange={e => setFormData({...formData, contractNo: e.target.value})} /> </div> </div>
                        {/* ... Rest of the form is unchanged ... */}
                        <div className="grid grid-cols-2 gap-4"> <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">客户名称</label> <input required type="text" className={`w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm ${hasSubjectMismatch ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-gray-50'}`} value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} /> </div> <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">服务项目</label> <input required type="text" className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm" value={formData.serviceLine} onChange={e => setFormData({...formData, serviceLine: e.target.value})} /> </div> </div>
                        <div className="grid grid-cols-3 gap-4"> <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">合同总额 (¥)</label> <input required type="number" className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm font-mono font-bold" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /> </div> <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">签订日期</label> <input required type="date" className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm" value={formData.signDate} onChange={e => setFormData({...formData, signDate: e.target.value})} /> </div> <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">支付方式</label> <input type="text" className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm" value={formData.paymentMethod} onChange={e => setFormData({...formData, paymentMethod: e.target.value})} /> </div> </div>
                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100"> <div className="flex justify-between items-center mb-3"> <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center"> <Wallet className="w-4 h-4 mr-2 text-blue-600" /> 支付节点与金额 (可编辑) </h4> <button type="button" onClick={addReceivable} className="text-xs font-bold text-blue-600 hover:underline flex items-center"> <Plus className="w-3 h-3 mr-1" /> 添加款项节点 </button> </div> {extractedReceivables.length === 0 && ( <div className="text-center text-gray-400 text-xs py-4 border-2 border-dashed border-gray-200 rounded-xl font-bold"> 暂无支付计划，AI 识别后将在此显示 </div> )} <div className="space-y-2"> {extractedReceivables.map((r, idx) => ( <div key={idx} className="flex space-x-2 items-center"> <div className="flex-1"> <input type="text" className="w-full px-3 py-2 text-sm font-bold border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" value={r.node} onChange={(e) => handleReceivableChange(idx, 'node', e.target.value)} placeholder="节点名称 (如: 首付款)" /> </div> <div className="w-32 relative"> <span className="absolute left-2 top-2 text-xs text-gray-400">¥</span> <input type="number" className="w-full pl-6 pr-2 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none font-mono font-bold" value={r.amount} onChange={(e) => handleReceivableChange(idx, 'amount', Number(e.target.value))} placeholder="金额" /> </div> <div className="w-36"> <input type="date" className="w-full px-2 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" value={r.dueDate} onChange={(e) => handleReceivableChange(idx, 'dueDate', e.target.value)} /> </div> <button type="button" onClick={() => removeReceivable(idx)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors" > <Trash2 className="w-4 h-4" /> </button> </div> ))} </div> </div>
                        <div> <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center"> <AlignLeft className="w-4 h-4 mr-1" /> 备注 (注：最后一行内容) </label> <textarea className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none text-sm resize-none" rows={2} value={formData.remarks} onChange={e => setFormData({...formData, remarks: e.target.value})} ></textarea> </div>
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start"> <div className="flex items-center h-5"> <input id="createProject" name="createProject" type="checkbox" className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded" checked={formData.createProject} onChange={e => setFormData({...formData, createProject: e.target.checked})} /> </div> <div className="ml-3 text-sm"> <label htmlFor="createProject" className="font-bold text-blue-900">同时创建交付项目 (推荐)</label> <p className="text-blue-700 text-xs mt-0.5">勾选后将自动在“项目管理”中生成对应项目，项目回款状态将自动同步此处的支付计划。</p> </div> </div>
                        <div className="pt-4 flex justify-end space-x-3"> <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 font-bold hover:bg-gray-50 transition-colors" > 取消 </button> <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-95" > 确认录入并生成 </button> </div>
                    </form>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Contracts;
