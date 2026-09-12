let mammothLoader: Promise<any> | null = null;
let pdfjsLoader: Promise<any> | null = null;

/*
  ── 失败原因要留下来（2026-09-12）────────────────────────────────

  下面每个解析函数原来都是 `catch { console.warn(...); return '' }`。
  后果：合同识别坏了不知道多久，界面上只说
  「PDF 未提取到可读内容，请改用清晰扫描件」—— **把锅甩给用户的文件**，
  而真实原因是 pdf.js 的 worker 没配好，再清晰的扫描件也一样失败。

  他会照着提示去重扫一遍，再失败一次，然后以为是自己文件的问题。

  吞掉异常本身没错（不能让解析失败炸掉整个页面），
  错在**把原因也一起吞了**。现在留下来，让报错能说人话。
*/
let lastParseFailure = '';
export const getLastParseFailure = (): string => lastParseFailure;
const noteFailure = (where: string, error: unknown) => {
  const msg = String((error as any)?.message || error || '').slice(0, 200);
  lastParseFailure = `${where}：${msg}`;
  console.warn(`[documentParsers] ${lastParseFailure}`);
};

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

/**
 * 加载 pdf.js，并且**把 worker 指好**。
 *
 * ── 2026-09-12：合同识别一直是坏的，而且坏得看不出来 ──────────────
 *
 * 金恩来传合同 PDF，界面报「PDF 未提取到可读内容（文本/OCR均失败）。
 * 请改用清晰扫描件或先转图片后上传。」
 *
 * 这句话把锅甩给了他的文件 —— **而真相是每一个 PDF 都识别不了**，
 * 再清晰的扫描件也一样。他会照着提示去重扫一遍，然后再失败一次。
 *
 * 真因：代码里传的是 `getDocument({ data, disableWorker: true })`。
 * **pdfjs-dist v5 已经不认 `disableWorker` 了**（我们装的是 ^5.4.624），
 * 它现在一律要求 `GlobalWorkerOptions.workerSrc`，
 * 拿不到就抛 `No "GlobalWorkerOptions.workerSrc" specified.`
 *
 * 而上层两个函数都 `catch` 掉异常、返回空值，只在 console 里 warn 一行 ——
 * 于是「文本抽取失败」和「渲染成图也失败」接连发生，
 * 最后汇成一句怪用户的提示。**不报错，但一直是错的**，
 * 正是这个项目最典型的那类坑。
 *
 * 修法：用 Vite 的 `?url` 拿到打包后的 worker 地址，明确设给 pdf.js。
 * 不用 CDN —— 部署自检里有一条「外部 CDN 引用必须为 0」，
 * 内网环境也拉不到。
 */
const getPdfJs = async (): Promise<any> => {
  /*
    **不再优先用 window.pdfjsLib。**

    index.html 里那份全局 pdf.js 是 2.16.105，而 package.json 装的是 5.4.624。
    这一行原来写着「有全局就用全局」，于是永远用到旧的那份 ——
    而它的 worker 文件压根没随 vendor 一起放，合同 PDF 全军覆没。

    一个功能有两份实现时，「哪份赢」这种事不该靠加载顺序决定。
    现在只认 npm 那一份，版本跟着 package.json 走。
  */
  if (!pdfjsLoader) {
    pdfjsLoader = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then(async (mod: any) => {
        const pdfjs = mod?.default || mod;
        if (pdfjs?.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
          const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        }
        return pdfjs;
      })
      .catch((err) => {
        noteFailure('pdf.js 加载', err);
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
    noteFailure('DOCX 文本抽取', error);
    return '';
  }
};

export const extractTextFromPdf = async (file: File): Promise<string> => {
  try {
    const pdfjs = await getPdfJs();
    if (!pdfjs?.getDocument) return '';

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
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
    noteFailure('PDF 文本抽取', error);
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
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
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
    noteFailure('PDF 渲染成图', error);
    return [];
  }
};
