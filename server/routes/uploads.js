// 合同原件文件上传 + 下载（真实存盘，替代仅元数据）。
// 存储：.runtime/uploads/contracts/<contractId>/<file>；附件 url 指向 /api/files/<relpath>。
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db/pool');
const { contractRepo } = require('../repos/contractRepo');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { processImageFile } = require('../utils/imagePipeline');

const router = express.Router();
const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.XINYI_UPLOAD_DIR || '.runtime/uploads');
const today = () => new Date().toISOString().slice(0, 10);
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'upload error', {}, 500); }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'contracts', String(req.params.id || 'misc').replace(/[^\w-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname) || ''}`),
});
const upload = multer({ storage, limits: { fileSize: Number(process.env.XINYI_UPLOAD_MAX_MB || 20) * 1024 * 1024 } });
const decodeName = (n) => { try { return Buffer.from(String(n || ''), 'latin1').toString('utf8'); } catch { return String(n || ''); } };

// 文件落盘后统一过一遍图片压缩，再生成对外可访问的 URL。
// 压缩会改扩展名（heic/png → jpg），所以 URL 必须用压缩后的真实路径，不能沿用 multer 给的。
const toPublicUrl = (abs) => `/api/files/${path.relative(UPLOAD_ROOT, abs).split(path.sep).join('/')}`;
const finalizeUpload = async (file) => {
  const origName = decodeName(file.originalname);
  const shrunk = await processImageFile(file.path, file.mimetype);
  const finalPath = shrunk.finalPath || file.path;
  return {
    name: origName,
    size: `${(shrunk.finalBytes / 1024).toFixed(1)} KB`,
    sizeBytes: shrunk.finalBytes,
    type: file.mimetype || path.extname(origName).slice(1),
    uploadDate: today(),
    url: toPublicUrl(finalPath),
    ...(shrunk.thumbPath ? { thumbUrl: toPublicUrl(shrunk.thumbPath) } : {}),
    ...(shrunk.width ? { width: shrunk.width, height: shrunk.height } : {}),
    ...(shrunk.processed ? { originalBytes: shrunk.originalBytes } : {}),
  };
};

// 上传合同原件
router.post('/api/contracts/:id/attachments/upload', (req, res, next) => {
  if (!pool.isEnabled()) return sendFail(res, ERROR_CODES.SERVER_ERROR, '数据库未启用，无法记录附件', {}, 500);
  next();
}, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return sendFail(res, ERROR_CODES.PARAM_ERROR, '未收到文件（字段名应为 file）', {}, 400);
  const meta = await finalizeUpload(req.file);
  const attachment = { id: `ATT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, ...meta };
  const contract = await contractRepo.addAttachment(req.params.id, attachment);
  if (!contract) {
    fs.unlink(path.join(UPLOAD_ROOT, attachment.url.replace('/api/files/', '')), () => {});
    return sendFail(res, ERROR_CODES.NOT_FOUND, '合同不存在', {}, 404);
  }
  sendSuccess(res, { contract, attachment }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 通用文件上传：只存盘并返回可访问 URL，不绑定业务记录。
// 用于表单在保存前先把文件传上来（审核证据、现场照片等），避免把 base64 塞进数据字段。
const ALLOWED_SCOPES = new Set(['audit-evidence', 'work-log', 'misc']);
const genericStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const scope = ALLOWED_SCOPES.has(String(req.params.scope)) ? String(req.params.scope) : 'misc';
    const dir = path.join(UPLOAD_ROOT, scope, today().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname) || ''}`),
});
const genericUpload = multer({
  storage: genericStorage,
  limits: { fileSize: Number(process.env.XINYI_UPLOAD_MAX_MB || 20) * 1024 * 1024 },
});

router.post('/api/uploads/:scope', genericUpload.array('files', 10), wrap(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) return sendFail(res, ERROR_CODES.PARAM_ERROR, '未收到文件（字段名应为 files）', {}, 400);
  const uploaded = await Promise.all(files.map(finalizeUpload));
  sendSuccess(res, { files: uploaded }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 下载/查看文件（路径穿越防护）
router.get('/api/files/*', (req, res) => {
  const rel = String(req.params[0] || '');
  const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/g, '');
  const full = path.join(UPLOAD_ROOT, safe);
  if (!full.startsWith(UPLOAD_ROOT) || !fs.existsSync(full)) return res.status(404).json({ ok: false, message: 'file not found' });
  res.sendFile(full);
});

module.exports = router;
