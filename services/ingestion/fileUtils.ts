import { aiService } from '../aiService';
import { extractTextFromDocx as extractTextFromDocxLocal } from '../documentParsers';

// --- Types ---
export interface IngestJob {
  source: 'certificate' | 'contract' | 'knowledge' | 'lead_excel';
  files: File[];
  options?: any;
}

export interface IngestResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    fileType: string;
    size: number;
    processedAt: string;
    modelUsed?: string;
    stage?: string;
    attempts?: number;
    fallbackUsed?: boolean;
  };
}

// --- Utils ---
export const compressImage = async (file: File, quality = 0.7, maxWidth = 1024): Promise<string> => {
  return new Promise((resolve, reject) => {
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
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
};

export const extractTextFromDocx = async (file: File): Promise<string> => {
  return extractTextFromDocxLocal(file);
};
