// 图片入库前的统一压缩管线（P0-15）。
//
// 为什么必须在上线前做：咨询师去车间拍的照片一张 3-5MB，一年几千张就是几十 GB。
// 一旦原图落了盘，将来再想省空间就得跑数据迁移；现在做只是一次编码。
//
// 处理规则：
//   1. 只处理图片，其他文件原样放过；
//   2. 先按 EXIF 方向摆正 —— 手机横拍的照片不转会整片躺倒；
//   3. 宽度超过上限才缩，绝不放大；
//   4. 重新编码时丢掉 EXIF（含 GPS 定位），既省体积也避免把客户厂区坐标存进来；
//   5. 额外出一张缩略图，列表页只加载它；
//   6. 任何一步失败都保留原文件 —— 省空间不能以丢证据为代价。
const fs = require('fs');
const path = require('path');

let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : dflt; };

const CONFIG = {
  enabled: String(process.env.XINYI_IMAGE_COMPRESS || 'on').toLowerCase() !== 'off',
  maxWidth: num(process.env.XINYI_IMAGE_MAX_WIDTH, 1600),
  quality: num(process.env.XINYI_IMAGE_QUALITY, 80),
  thumbWidth: num(process.env.XINYI_IMAGE_THUMB_WIDTH, 320),
  // 小于这个体积的图不值得重新编码，动它反而可能变大
  skipUnderBytes: num(process.env.XINYI_IMAGE_SKIP_UNDER_KB, 300) * 1024,
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.bmp']);

const isImage = (filePath, mimetype) => {
  if (String(mimetype || '').startsWith('image/')) return true;
  return IMAGE_EXT.has(path.extname(String(filePath || '')).toLowerCase());
};

// 透明通道要留给 png/webp，压成 jpeg 会出现黑底
const hasAlpha = (meta) => Boolean(meta && meta.hasAlpha);

/**
 * 就地压缩一张已落盘的图片，并生成缩略图。
 * @returns {Promise<{processed:boolean, reason?:string, originalBytes:number, finalBytes:number, width?:number, height?:number, thumbPath?:string}>}
 */
const processImageFile = async (filePath, mimetype) => {
  const originalBytes = (() => { try { return fs.statSync(filePath).size; } catch { return 0; } })();
  const result = { processed: false, originalBytes, finalBytes: originalBytes };

  if (!CONFIG.enabled) return { ...result, reason: 'disabled' };
  if (!sharp) return { ...result, reason: 'sharp-unavailable' };
  if (!isImage(filePath, mimetype)) return { ...result, reason: 'not-image' };

  try {
    const meta = await sharp(filePath).metadata();
    const needsResize = Number(meta.width || 0) > CONFIG.maxWidth;
    // 已经又小又窄的图直接放过，但缩略图照样要出，列表页才有得用
    const worthRecoding = needsResize || originalBytes > CONFIG.skipUnderBytes;

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const keepAlpha = hasAlpha(meta);
    const outExt = keepAlpha ? '.png' : '.jpg';

    let finalPath = filePath;
    let finalMeta = meta;

    if (worthRecoding) {
      const tmpPath = path.join(dir, `${base}.tmp${outExt}`);
      const pipeline = sharp(filePath)
        .rotate() // 按 EXIF 摆正；这一步之后方向信息已写死进像素
        .resize({ width: CONFIG.maxWidth, withoutEnlargement: true });
      const encoded = keepAlpha
        ? pipeline.png({ quality: CONFIG.quality, compressionLevel: 9 })
        : pipeline.jpeg({ quality: CONFIG.quality, mozjpeg: true });
      finalMeta = await encoded.toFile(tmpPath);

      const newBytes = fs.statSync(tmpPath).size;
      if (newBytes > 0 && newBytes < originalBytes) {
        const target = path.join(dir, `${base}${outExt}`);
        fs.renameSync(tmpPath, target);
        // 换了扩展名就把原文件删掉，否则同一张图会占两份
        if (target !== filePath) { try { fs.unlinkSync(filePath); } catch { /* 原文件已不在，忽略 */ } }
        finalPath = target;
        result.processed = true;
      } else {
        // 压完反而更大（本来就是高压缩比的图），保留原图
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        finalMeta = meta;
      }
    }

    // 缩略图：不管有没有压缩都生成，列表页统一走它
    let thumbPath;
    try {
      const t = path.join(path.dirname(finalPath), `${path.basename(finalPath, path.extname(finalPath))}.thumb.jpg`);
      await sharp(finalPath)
        .rotate()
        .resize({ width: CONFIG.thumbWidth, withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
        .toFile(t);
      thumbPath = t;
    } catch { thumbPath = undefined; } // 缩略图失败不影响主图可用

    return {
      ...result,
      processed: result.processed,
      finalPath,
      finalBytes: (() => { try { return fs.statSync(finalPath).size; } catch { return originalBytes; } })(),
      width: finalMeta?.width,
      height: finalMeta?.height,
      thumbPath,
    };
  } catch (e) {
    // 压缩是优化不是必需，坏掉也要让文件本身留下来
    return { ...result, reason: `failed:${e?.message || 'unknown'}` };
  }
};

module.exports = { processImageFile, isImage, IMAGE_CONFIG: CONFIG };
