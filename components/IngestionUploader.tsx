import React, { useState } from 'react';
import { Upload, Loader2, BrainCircuit, AlertCircle, FileCheck, X } from 'lucide-react';
import { ingestService, IngestJob, IngestResult } from '../services/ingestion';

interface IngestionUploaderProps {
  source: IngestJob['source'];
  label?: string;
  subLabel?: string;
  accept?: string;
  options?: any;
  onSuccess: (result: IngestResult, file?: File) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  compact?: boolean; // For mobile or tight spaces
}

export const IngestionUploader: React.FC<IngestionUploaderProps> = ({
  source,
  label = "点击上传或拖拽文件",
  subLabel = "支持自动识别与解析",
  accept = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx",
  options,
  onSuccess,
  onError,
  disabled = false,
  compact = false
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const job: IngestJob = {
        source,
        files: [file],
        options
      };
      
      const result = await ingestService.process(job);
      
      if (result.success) {
        onSuccess(result, file);
      } else {
        const stageHint = result.metadata?.stage ? `阶段:${result.metadata.stage}` : '';
        const modelHint = result.metadata?.modelUsed ? `模型:${result.metadata.modelUsed}` : '';
        const suffix = [stageHint, modelHint].filter(Boolean).join(' / ');
        const msg = `${result.error || "处理失败，请重试"}${suffix ? `（${suffix}）` : ''}`;
        setErrorMsg(msg);
        if (onError) onError(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "上传发生未知错误";
      setErrorMsg(msg);
      if (onError) onError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    const picked = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    // Allow re-selecting the same file after timeout/failure.
    e.target.value = '';
    if (picked) handleFile(picked);
  };

  /*
    ── compact：小，但不能小到看不见（2026-09-12 二改）──────────────

    金恩来：「上传合同区域虽然小了看起来也不协调，同时也容易忽略
    上传合同的窗口，提示好像不够直观」。

    第一版 compact 是一行居中的小字按钮 —— 确实不占地方，
    但它长得像个次要链接，而这其实是这张表**最省事的那条路**：
    传一份合同，下面十个字段自己填好。该被看见。

    三处改动：
      · 左图标 + 两行字（做什么 / 省了什么），不再是一行居中小字
      · **补上拖拽** —— 原来 compact 分支只有 input，没挂 drag 事件，
        拖文件上去毫无反应。「不够直观」有一半是这个。
      · 高度 ~56px：比原来的一行高一点，但离那个 180px 的大块很远

    保持一行的形态，是因为它在弹窗里和别的字段排在一起，
    做成大方块又会回到「上传区吃掉半屏」那个问题。
  */
  if (compact) {
    return (
      <div
        className={`relative group rounded-xl border border-dashed transition-all
          ${dragActive ? 'border-indigo-500 bg-indigo-50' : ''}
          ${errorMsg ? 'border-red-300 bg-red-50' : 'border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 hover:border-indigo-300'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          disabled={disabled || isProcessing}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className={`shrink-0 rounded-lg p-1.5 ${errorMsg ? 'bg-red-100' : 'bg-white'}`}>
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            ) : errorMsg ? (
              <AlertCircle className="h-4 w-4 text-red-500" />
            ) : (
              <BrainCircuit className="h-4 w-4 text-indigo-600" />
            )}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className={`block truncate text-sm font-bold ${errorMsg ? 'text-red-600' : 'text-indigo-700'}`}>
              {isProcessing ? 'AI 识别中…' : errorMsg ? '识别失败，点一下重试' : label}
            </span>
            {!isProcessing && !errorMsg && subLabel && (
              <span className="block truncate text-[11px] font-bold text-indigo-400">{subLabel}</span>
            )}
          </span>
          {!isProcessing && !errorMsg && (
            <span className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-black text-white group-hover:bg-indigo-700">
              选择文件
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`relative w-full rounded-2xl border-2 border-dashed transition-all duration-200
        ${dragActive ? 'border-indigo-500 bg-indigo-50 scale-[0.99]' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'}
        ${errorMsg ? 'border-red-300 bg-red-50' : ''}
        ${disabled ? 'opacity-60 pointer-events-none' : ''}
      `}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={disabled || isProcessing}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      
      <div className="p-6 flex flex-col items-center justify-center text-center space-y-3">
        <div className={`p-3 rounded-full transition-colors
          ${isProcessing ? 'bg-indigo-100' : errorMsg ? 'bg-red-100' : 'bg-indigo-50'}
        `}>
          {isProcessing ? (
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          ) : errorMsg ? (
            <X className="w-8 h-8 text-red-500" />
          ) : (
            <Upload className="w-8 h-8 text-indigo-500" />
          )}
        </div>
        
        <div className="space-y-1">
          <p className={`text-sm font-bold ${errorMsg ? 'text-red-600' : 'text-gray-900'}`}>
            {isProcessing ? 'AI 正在智能分析...' : errorMsg || label}
          </p>
          {/* 原来套着 max-w-[200px]，把「自动识别金额、条款与支付节点」
              硬折成「自动识别金 / 额、条款…」—— 断在词中间。宽度交给容器。 */}
          <p className="text-xs text-gray-400 leading-relaxed">
            {isProcessing ? '正在极速分析中...' : subLabel}
          </p>
        </div>
      </div>
    </div>
  );
};
