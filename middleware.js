const jwt = require('jsonwebtoken');
const { db, log } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'DEV_ONLY_CHANGE_THIS_SECRET_BEFORE_DEPLOYMENT';
const TOKEN_TTL = process.env.JWT_TTL || '8h';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    if (!token) throw new Error('missing');
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id,username,full_name,role,unit_id,active FROM users WHERE id=?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Tài khoản không hoạt động' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' });
  }
}

function roles(...allowed) {
  return (req, res, next) => allowed.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
}

const isSuper = (user) => ['admin', 'reviewer', 'finance'].includes(user.role);

function scopedUnit(req, requested) {
  if (isSuper(req.user)) return requested ? Number(requested) : null;
  return req.user.unit_id;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body ? body[f] : undefined;
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length) throw new HttpError(400, `Vui lòng nhập các trường bắt buộc: ${missing.join(', ')}`);
}

function str(v, max = 5000) {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max).trim();
}

function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function enumOf(v, allowed, fallback) {
  const s = str(v, 100);
  if (allowed.includes(s)) return s;
  if (fallback !== undefined) return fallback;
  throw new HttpError(400, `Giá trị không hợp lệ: ${s || '(trống)'}`);
}

function dateOrNull(v) {
  const s = str(v, 40);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Ngày không hợp lệ: ${s}`);
  return d.toISOString().slice(0, 10);
}

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'a', 'span', 'figure', 'figcaption', 'img']);

function sanitizeHtml(input) {
  let html = String(input || '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*\/?\s*>/gi, '');
  html = html.replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, '').replace(/ on[a-z]+\s*=\s*'[^']*'/gi, '').replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  html = html.replace(/javascript\s*:/gi, '');
  html = html.replace(/<\s*([a-zA-Z0-9]+)([^>]*)>/g, (m, tag, attrs) => {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return '';
    if (tag.toLowerCase() === 'a') {
      const safe = /href\s*=\s*"(https?:\/\/[^"]+|mailto:[^"]+|\/[^"]*)"/i.test(attrs);
      if (!safe) return '<span>';
      const href = (attrs.match(/href\s*=\s*"([^"]+)"/i) || [])[1];
      return `<a href="${href}" rel="noopener" target="_blank">`;
    }
    if (tag.toLowerCase() === 'img') {
      const src = (attrs.match(/src\s*=\s*"([^"]+)"/i) || [])[1];
      if (!src || !/^(https?:\/\/|\/uploads\/|data:image\/(?:png|jpe?g|gif|webp))/i.test(src)) return '';
      const alt = (attrs.match(/alt\s*=\s*"([^"]*)"/i) || [])[1] || '';
      return `<img src="${src}" alt="${alt.replace(/"/g, '')}">`;
    }
    return `<${tag}>`;
  });
  return html;
}

function notFoundApi(req, res) {
  res.status(404).json({ error: 'Không tìm thấy tài nguyên yêu cầu' });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.status) return res.status(err.status).json({ error: err.message || 'Yêu cầu không hợp lệ' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
  try { log(null, 'SERVER_ERROR', 'api', req.path, String(err && err.message || err).slice(0, 300)); } catch (_) { /* ignore */ }
  console.error('[ERROR]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Đã xảy ra lỗi máy chủ. Vui lòng thử lại sau.' });
}

module.exports = {
  JWT_SECRET, TOKEN_TTL, HttpError, auth, roles, isSuper, scopedUnit, asyncHandler,
  requireFields, str, intOrNull, enumOf, dateOrNull, sanitizeHtml, notFoundApi, errorHandler
};
