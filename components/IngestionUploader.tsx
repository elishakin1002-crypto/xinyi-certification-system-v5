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

  if (compact) {
    return (
      <div className="relative group">
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          disabled={disabled || isProcessing}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <button 
          className={`w-full flex items-center justify-center space-x-2 px-4 py-2 rounded-lg border border-dashed transition-all
            ${errorMsg ? 'border-red-300 bg-red-50 text-red-600' : 'border-indigo-200 bg-indigo-50/50 text-indigo-600 hover:bg-indigo-50'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {isProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : errorMsg ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            <BrainCircuit className="w-4 h-4" />
          )}
          <span className="text-xs font-bold">
            {isProcessing ? 'AI 识别中...' : errorMsg ? '识别失败(重试)' : label}
          </span>
        </button>
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
          <p className="text-xs text-gray-400 max-w-[200px] mx-auto leading-relaxed">
            {isProcessing ? '正在极速分析中...' : subLabel}
          </p>
        </div>
      </div>
    </div>
  );
};
