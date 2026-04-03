let mammothLoader: Promise<any> | null = null;
let pdfjsLoader: Promise<any> | null = null;

const getMammoth = async (): Promise<any> => {
  const globalMammoth = (window as any).mammoth;
  if (globalMammoth?.extractRawText) return globalMammoth;

  if (!mammothLoader) {
    mammothLoader = import('mammoth/mammoth.browser')
      .then((mod: any) => mod?.default || mod)
      .catch((err) => {
        console.warn('mammoth load failed', err);
        return null;
      });
  }
  return mammothLoader;
};

const getPdfJs = async (): Promise<any> => {
  const globalPdfJs = (window as any).pdfjsLib;
  if (globalPdfJs?.getDocument) return globalPdfJs;

  if (!pdfjsLoader) {
    pdfjsLoader = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((mod: any) => mod?.default || mod)
      .catch((err) => {
        console.warn('pdf.js load failed', err);
        return null;
      });
  }
  return pdfjsLoader;
};

export const extractTextFromDocx = async (file: File): Promise<string> => {
  try {
    const mammoth = await getMammoth();
    if (!mammoth?.extractRawText) return '';
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return String(result?.value || '').trim();
  } catch (error) {
    console.warn('DOCX text extraction failed', error);
    return '';
  }
};

export const extractTextFromPdf = async (file: File): Promise<string> => {
  try {
    const pdfjs = await getPdfJs();
    if (!pdfjs?.getDocument) return '';

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer, disableWorker: true });
    const pdf = await loadingTask.promise;
    const chunks: string[] = [];

    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items || [])
        .map((item: any) => String(item?.str || '').trim())
        .filter(Boolean)
        .join(' ');
      if (pageText) chunks.push(pageText);
    }

    return chunks.join('\n').trim();
  } catch (error) {
    console.warn('PDF text extraction failed', error);
    return '';
  }
};

export const renderPdfPagesAsImages = async (
  file: File,
  maxPages = 3,
  options?: { scale?: number; quality?: number; maxWidth?: number }
): Promise<string[]> => {
  try {
    const pdfjs = await getPdfJs();
    if (!pdfjs?.getDocument) return [];

    const renderScale = Math.max(0.8, Number(options?.scale || 1.2));
    const jpegQuality = Math.min(0.9, Math.max(0.45, Number(options?.quality || 0.72)));
    const maxWidth = Math.max(800, Number(options?.maxWidth || 1440));

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer, disableWorker: true });
    const pdf = await loadingTask.promise;
    const pages = Math.min(pdf.numPages, Math.max(1, maxPages));
    const images: string[] = [];

    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: renderScale });
      const widthRatio = viewport.width > maxWidth ? (maxWidth / viewport.width) : 1;
      const targetWidth = Math.floor(viewport.width * widthRatio);
      const targetHeight = Math.floor(viewport.height * widthRatio);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      await page.render({
        canvasContext: ctx,
        viewport,
        transform: widthRatio < 1 ? [widthRatio, 0, 0, widthRatio, 0, 0] : undefined
      }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
      const base64 = dataUrl.split(',')[1];
      if (base64) images.push(base64);
    }

    return images;
  } catch (error) {
    console.warn('PDF page rendering failed', error);
    return [];
  }
};
