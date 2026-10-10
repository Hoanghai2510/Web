const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, slugify, uniqueSlug, norm, indexPost, indexDoc, setSetting, getSettings, log } = require('../db');
const {
  JWT_SECRET, TOKEN_TTL, HttpError, auth, roles, scopedUnit,
  asyncHandler, requireFields, str, intOrNull, enumOf, dateOrNull, sanitizeHtml
} = require('../middleware');
const { POST_CATEGORIES, DOCUMENT_CATEGORIES, DOCUMENT_TYPES } = require('./public');

const jwt = require('jsonwebtoken');

const router = express.Router();

const allowedRoles = ['admin', 'reviewer', 'unit_lead', 'viewer', 'finance'];

function unitName(id) {
  return db.prepare('SELECT name FROM units WHERE id=?').get(id)?.name || '';
}

/* ---------- Auth ---------- */
router.post('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.LOGIN_RATE_LIMIT || 12), standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu' });
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(String(username).trim());
  if (!user || !user.active || !bcrypt.compareSync(String(password), user.password_hash)) {
    log(null, 'LOGIN_FAILED', 'user', username);
    return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng' });
  }
  if (user.is_demo && process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO !== '1') {
    log(null, 'LOGIN_BLOCKED_DEMO', 'user', username);
    return res.status(403).json({ error: 'Tài khoản demo đã bị khóa ở môi trường production. Tạo tài khoản người dùng thật trước khi đưa hệ thống lên.' });
  }
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  log(user.id, 'LOGIN', 'user', user.id);
  res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, unit_id: user.unit_id } });
});

router.get('/auth/me', auth, (req, res) => res.json({ user: req.user, unit: unitName(req.user.unit_id) }));

router.post('/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || typeof newPassword !== 'string' || newPassword.length < 10) {
    throw new HttpError(400, 'Mật khẩu mới cần tối thiểu 10 ký tự');
  }
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, u.password_hash)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 12), req.user.id);
  log(req.user.id, 'CHANGE_PASSWORD', 'user', req.user.id);
  res.json({ ok: true });
});

/* ---------- Dashboard ---------- */
router.get('/dashboard', auth, (req, res) => {
  const unitFilter = ['admin', 'reviewer', 'finance'].includes(req.user.role) ? '' : ` WHERE unit_id=${Number(req.user.unit_id)}`;
  const units = db.prepare('SELECT COUNT(*) n FROM units').get().n;
  const people = db.prepare(`SELECT COUNT(*) n FROM personnel${unitFilter}`).get().n;
  const pending = db.prepare(`SELECT COUNT(*) n FROM reports WHERE status='Chờ duyệt'${req.user.role === 'unit_lead' ? ` AND unit_id=${Number(req.user.unit_id)}` : ''}`).get().n;
  const unpaid = db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM dues WHERE status='Chưa thanh toán'${req.user.role === 'unit_lead' ? ` AND unit_id=${Number(req.user.unit_id)}` : ''}`).get().n;
  const reports = db.prepare(`SELECT r.id,r.title,r.period,r.status,r.created_at,u.name unit_name,usr.full_name created_by_name
    FROM reports r JOIN units u ON u.id=r.unit_id JOIN users usr ON usr.id=r.created_by
    ${req.user.role === 'unit_lead' ? 'WHERE r.unit_id=?' : ''} ORDER BY r.id DESC LIMIT 6`)
    .all(...(req.user.role === 'unit_lead' ? [req.user.unit_id] : []));
  res.json({ stats: { units, people, pending, unpaid }, reports });
});

/* ---------- Units ---------- */
router.get('/units', auth, (req, res) => {
  const select = `SELECT u.id,u.name,u.code,u.parent_id,u.unit_type,u.slug,u.description,u.address,u.phone,u.email,u.head_name,u.founded_at,u.status,u.is_public,COUNT(p.id) people_count
    FROM units u LEFT JOIN personnel p ON p.unit_id=u.id`;
  if (['admin', 'reviewer'].includes(req.user.role)) {
    return res.json(db.prepare(`${select} GROUP BY u.id ORDER BY u.id`).all());
  }
  const own = Number(req.user.unit_id);
  const children = db.prepare('SELECT id FROM units WHERE parent_id=?').all(own).map((c) => c.id);
  const ids = [own, ...children];
  res.json(db.prepare(`${select} WHERE u.id IN (${ids.map(() => '?').join(',')}) GROUP BY u.id ORDER BY u.id`).all(...ids));
});

router.post('/units', auth, roles('admin'), (req, res) => {
  const { name, code } = req.body || {};
  requireFields(req.body, ['name', 'code']);
  const parent_id = intOrNull(req.body.parent_id);
  const slug = uniqueSlug(name, 'units');
  try {
    const info = db.prepare('INSERT INTO units(name,code,parent_id,slug) VALUES(?,?,?,?)')
      .run(str(name, 200), str(code, 30).toUpperCase(), parent_id, slug);
    log(req.user.id, 'CREATE', 'unit', info.lastInsertRowid, name);
    res.status(201).json({ id: info.lastInsertRowid, slug });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Tên hoặc mã đơn vị đã tồn tại');
    throw e;
  }
});

router.get('/units/:id', auth, roles('admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM units WHERE id=?').get(intOrNull(req.params.id));
  if (!row) throw new HttpError(404, 'Không tìm thấy đơn vị');
  res.json(row);
});

router.put('/units/:id', auth, roles('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM units WHERE id=?').get(intOrNull(req.params.id));
  if (!u) throw new HttpError(404, 'Không tìm thấy đơn vị');
  const b = req.body || {};
  const f = {
    name: str(b.name, 200) || u.name,
    code: str(b.code, 30).toUpperCase() || u.code,
    parent_id: intOrNull(b.parent_id) ?? u.parent_id,
    unit_type: enumOf(b.unit_type, Object.keys(POST_CATEGORIES).length ? Object.keys({ trung_uong: 1, ban_chuyen_mon: 1, lien_chi_hoi: 1, chi_hoi: 1, vien_trung_tam: 1, vp_dai_dien: 1, doanh_nghiep: 1 }) : ['chi_hoi'], u.unit_type),
    description: str(b.description, 2000),
    address: str(b.address, 300),
    phone: str(b.phone, 60),
    email: str(b.email, 120),
    head_name: str(b.head_name, 120),
    founded_at: dateOrNull(b.founded_at),
    status: enumOf(b.status, ['active', 'inactive'], u.status),
    is_public: b.is_public === undefined ? u.is_public : (b.is_public ? 1 : 0)
  };
  const slug = str(b.slug, 120) || u.slug || uniqueSlug(f.name, 'units', u.id);
  try {
    db.prepare(`UPDATE units SET name=?,code=?,parent_id=?,unit_type=?,description=?,address=?,phone=?,email=?,head_name=?,founded_at=?,status=?,is_public=?,slug=? WHERE id=?`)
      .run(f.name, f.code, f.parent_id, f.unit_type, f.description, f.address, f.phone, f.email, f.head_name, f.founded_at, f.status, f.is_public, slug, u.id);
    log(req.user.id, 'UPDATE', 'unit', u.id, u.name);
    res.json({ ok: true, id: u.id, slug });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Tên hoặc mã đơn vị đã tồn tại');
    throw e;
  }
});

router.delete('/units/:id', auth, roles('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM units WHERE id=?').get(intOrNull(req.params.id));
  if (!u) throw new HttpError(404, 'Không tìm thấy đơn vị');
  const child = db.prepare('SELECT COUNT(*) n FROM units WHERE parent_id=?').get(u.id).n;
  if (child) throw new HttpError(409, 'Đơn vị còn đơn vị trực thuộc, không thể xóa');
  const people = db.prepare('SELECT COUNT(*) n FROM personnel WHERE unit_id=?').get(u.id).n;
  if (people) throw new HttpError(409, 'Đơn vị còn nhân sự, không thể xóa');
  db.prepare('DELETE FROM units WHERE id=?').run(u.id);
  log(req.user.id, 'DELETE', 'unit', u.id, u.name);
  res.json({ ok: true });
});

/* ---------- Personnel ---------- */
const PERSONNEL_FIELDS = (req, existing = {}) => {
  const publicEditor = ['admin', 'reviewer'].includes(req.user.role);
  return {
    full_name: str(req.body.full_name, 120) || existing.full_name || '',
    title: str(req.body.title, 120),
    position: str(req.body.position, 120),
    email: str(req.body.email, 120),
    phone: str(req.body.phone, 60),
    unit_id: Number(req.body.unit_id) || existing.unit_id,
    status: enumOf(req.body.status, ['Đang hoạt động', 'Nghỉ công tác', 'Chấm dứt tư cách', 'Bảo lưu'], existing.status || 'Đang hoạt động'),
    group_role: publicEditor ? str(req.body.group_role, 40) : (existing.group_role || ''),
    term: publicEditor ? str(req.body.term, 40) : (existing.term || ''),
    bio: publicEditor ? sanitizeHtml(String(req.body.bio || '').slice(0, 4000)) : (existing.bio || ''),
    is_public: publicEditor ? (req.body.is_public ? 1 : 0) : (existing.is_public || 0),
    sort_order: publicEditor ? (intOrNull(req.body.sort_order) ?? (existing.sort_order || 0)) : (existing.sort_order || 0)
  };
};

function personnelQuery(req) {
  if (['admin', 'reviewer'].includes(req.user.role)) {
    return db.prepare(`SELECT p.id,p.slug,p.full_name,p.title,p.position,p.email,p.phone,p.unit_id,p.status,p.group_role,p.term,p.is_public,p.slug,p.sort_order,p.created_at,u.name unit_name
      FROM personnel p JOIN units u ON u.id=p.unit_id ORDER BY p.id DESC`).all();
  }
  return db.prepare(`SELECT p.id,p.slug,p.full_name,p.title,p.position,p.email,p.phone,p.unit_id,p.status,p.group_role,p.term,p.is_public,p.slug,p.sort_order,p.created_at,u.name unit_name
    FROM personnel p JOIN units u ON u.id=p.unit_id WHERE p.unit_id=? ORDER BY p.id DESC`).all(req.user.unit_id);
}

router.get('/personnel', auth, (req, res) => res.json(personnelQuery(req)));

router.post('/personnel', auth, roles('admin', 'unit_lead'), (req, res) => {
  const f = PERSONNEL_FIELDS(req, {});
  if (!f.full_name || !f.unit_id) throw new HttpError(400, 'Họ tên và đơn vị là bắt buộc');
  if (req.user.role === 'unit_lead' && f.unit_id !== req.user.unit_id) throw new HttpError(403, 'Chỉ được quản lý nhân sự thuộc đơn vị của bạn');
  const slug = uniqueSlug(f.full_name, 'personnel');
  const info = db.prepare(`INSERT INTO personnel(full_name,title,position,email,phone,unit_id,status,group_role,term,bio,is_public,sort_order,slug)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(f.full_name, f.title, f.position, f.email, f.phone, f.unit_id, f.status, f.group_role, f.term, f.bio, f.is_public, f.sort_order, slug);
  log(req.user.id, 'CREATE', 'personnel', info.lastInsertRowid, f.full_name);
  res.status(201).json({ id: info.lastInsertRowid, slug });
});

router.put('/personnel/:id', auth, roles('admin', 'unit_lead'), (req, res) => {
  const p = db.prepare('SELECT * FROM personnel WHERE id=?').get(intOrNull(req.params.id));
  if (!p) throw new HttpError(404, 'Không tìm thấy nhân sự');
  if (req.user.role === 'unit_lead' && p.unit_id !== req.user.unit_id) throw new HttpError(403, 'Không có quyền sửa dữ liệu đơn vị khác');
  const f = PERSONNEL_FIELDS(req, p);
  if (req.user.role === 'unit_lead' && f.unit_id !== req.user.unit_id) f.unit_id = p.unit_id;
  const slug = str(req.body.slug, 120) || p.slug || uniqueSlug(f.full_name, 'personnel', p.id);
  db.prepare(`UPDATE personnel SET full_name=?,title=?,position=?,email=?,phone=?,unit_id=?,status=?,group_role=?,term=?,bio=?,is_public=?,sort_order=?,slug=? WHERE id=?`)
    .run(f.full_name, f.title, f.position, f.email, f.phone, f.unit_id, f.status, f.group_role, f.term, f.bio, f.is_public, f.sort_order, slug, p.id);
  log(req.user.id, 'UPDATE', 'personnel', p.id, p.full_name);
  res.json({ ok: true, id: p.id, slug });
});

router.delete('/personnel/:id', auth, roles('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM personnel WHERE id=?').get(intOrNull(req.params.id));
  if (!p) throw new HttpError(404, 'Không tìm thấy nhân sự');
  db.prepare('DELETE FROM personnel WHERE id=?').run(p.id);
  log(req.user.id, 'DELETE', 'personnel', p.id, p.full_name);
  res.json({ ok: true });
});

/* ---------- Reports ---------- */
router.get('/reports', auth, (req, res) => {
  const where = req.user.role === 'unit_lead' ? 'WHERE r.unit_id=?' : '';
  const rows = db.prepare(`SELECT r.*,u.name unit_name,usr.full_name created_by_name,rv.full_name reviewer_name
    FROM reports r JOIN units u ON u.id=r.unit_id JOIN users usr ON usr.id=r.created_by LEFT JOIN users rv ON rv.id=r.reviewer_id ${where} ORDER BY r.id DESC`)
    .all(...(req.user.role === 'unit_lead' ? [req.user.unit_id] : []));
  res.json(rows);
});

router.post('/reports', auth, roles('admin', 'unit_lead'), (req, res) => {
  requireFields(req.body, ['title', 'period', 'content']);
  const target = req.user.role === 'unit_lead' ? req.user.unit_id : Number(req.body.unit_id || req.user.unit_id);
  if (req.user.role === 'unit_lead' && target !== req.user.unit_id) throw new HttpError(403, 'Không thể gửi báo cáo thay đơn vị khác');
  const info = db.prepare('INSERT INTO reports(title,period,content,unit_id,created_by,status) VALUES(?,?,?,?,?,?)')
    .run(str(req.body.title, 300), str(req.body.period, 100), sanitizeHtml(String(req.body.content).slice(0, 20000)), target, req.user.id, 'Nháp');
  log(req.user.id, 'CREATE', 'report', info.lastInsertRowid, str(req.body.title, 300));
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/reports/:id/submit', auth, roles('admin', 'unit_lead'), (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(intOrNull(req.params.id));
  if (!r) throw new HttpError(404, 'Không tìm thấy báo cáo');
  if (req.user.role === 'unit_lead' && r.unit_id !== req.user.unit_id) throw new HttpError(403, 'Không có quyền gửi báo cáo này');
  if (!['Nháp', 'Yêu cầu sửa'].includes(r.status)) throw new HttpError(400, 'Chỉ gửi được báo cáo nháp hoặc báo cáo được yêu cầu sửa');
  db.prepare("UPDATE reports SET status='Chờ duyệt',submitted_at=CURRENT_TIMESTAMP,review_note=NULL WHERE id=?").run(r.id);
  log(req.user.id, 'SUBMIT', 'report', r.id, r.title);
  res.json({ ok: true });
});

router.post('/reports/:id/review', auth, roles('admin', 'reviewer'), (req, res) => {
  const decision = enumOf(req.body && req.body.decision, ['Đã duyệt', 'Yêu cầu sửa']);
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(intOrNull(req.params.id));
  if (!r) throw new HttpError(404, 'Không tìm thấy báo cáo');
  if (r.status !== 'Chờ duyệt') throw new HttpError(400, 'Báo cáo chưa ở trạng thái chờ duyệt');
  db.prepare('UPDATE reports SET status=?,reviewer_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(decision, req.user.id, str(req.body.note, 2000), r.id);
  log(req.user.id, decision === 'Đã duyệt' ? 'APPROVE' : 'REQUEST_CHANGES', 'report', r.id, str(req.body.note, 2000) || r.title);
  res.json({ ok: true });
});

router.get('/reports/export.csv', auth, (req, res) => {
  const where = req.user.role === 'unit_lead' ? 'WHERE r.unit_id=?' : '';
  const rows = db.prepare(`SELECT r.id,r.title,r.period,u.name unit,r.status,usr.full_name created_by,r.created_at,r.review_note
    FROM reports r JOIN units u ON u.id=r.unit_id JOIN users usr ON usr.id=r.created_by ${where} ORDER BY r.id DESC`)
    .all(...(req.user.role === 'unit_lead' ? [req.user.unit_id] : []));
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '\uFEFF' + [['Mã', 'Tiêu đề', 'Kỳ báo cáo', 'Đơn vị', 'Trạng thái', 'Người tạo', 'Ngày tạo', 'Ghi chú'],
    ...rows.map(r => [r.id, r.title, r.period, r.unit, r.status, r.created_by, r.created_at, r.review_note])]
    .map(row => row.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-hoi.csv"');
  res.send(csv);
});

/* ---------- Dues & payments ---------- */
router.get('/dues', auth, (req, res) => {
  const sql = `SELECT d.*,u.name unit_name,p.transaction_ref,p.method,p.status payment_status,p.provider_ref,p.note payment_note,p.created_at payment_created
    FROM dues d JOIN units u ON u.id=d.unit_id LEFT JOIN payments p ON p.dues_id=d.id ${req.user.role === 'unit_lead' ? 'WHERE d.unit_id=?' : ''} ORDER BY d.id`;
  res.json(db.prepare(sql).all(...(req.user.role === 'unit_lead' ? [req.user.unit_id] : [])));
});

router.post('/dues', auth, roles('admin', 'finance'), (req, res) => {
  requireFields(req.body, ['unit_id', 'period', 'amount']);
  const info = db.prepare('INSERT INTO dues(unit_id,period,amount,status) VALUES(?,?,?,?)')
    .run(Number(req.body.unit_id), str(req.body.period, 100), Number(req.body.amount), 'Chưa thanh toán');
  log(req.user.id, 'CREATE', 'dues', info.lastInsertRowid, str(req.body.period, 100));
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/payments', auth, roles('admin', 'unit_lead', 'finance'), (req, res) => {
  const d = db.prepare('SELECT * FROM dues WHERE id=?').get(Number(req.body && req.body.dues_id));
  if (!d) throw new HttpError(404, 'Không tìm thấy khoản hội phí');
  if (req.user.role === 'unit_lead' && d.unit_id !== req.user.unit_id) throw new HttpError(403, 'Không thể tạo thanh toán cho đơn vị khác');
  if (Number(req.body.amount) !== d.amount) throw new HttpError(400, 'Số tiền không khớp khoản phải thu');
  const method = str(req.body.method, 60);
  if (!method) throw new HttpError(400, 'Vui lòng chọn phương thức thanh toán');
  const ref = 'DEMO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const info = db.prepare('INSERT INTO payments(dues_id,transaction_ref,amount,method,status,created_by,note) VALUES(?,?,?,?,?,?,?)')
    .run(d.id, ref, d.amount, method, 'Chờ xác minh', req.user.id, 'Giao dịch mô phỏng; chưa kết nối cổng thanh toán');
  log(req.user.id, 'CREATE', 'payment', info.lastInsertRowid, ref);
  res.status(201).json({ id: info.lastInsertRowid, transaction_ref: ref, status: 'Chờ xác minh', message: 'Đã ghi nhận yêu cầu demo. Chưa thu tiền thật.' });
});

router.post('/payments/:id/verify', auth, roles('admin', 'finance'), (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(intOrNull(req.params.id));
  if (!p) throw new HttpError(404, 'Không tìm thấy giao dịch');
  const decision = enumOf(req.body && req.body.decision, ['Đã xác minh', 'Không khớp', 'Thất bại']);
  const d = db.prepare('SELECT * FROM dues WHERE id=?').get(p.dues_id);
  if (decision === 'Đã xác minh' && p.amount !== d.amount) throw new HttpError(400, 'Không thể xác minh do số tiền không khớp');
  const tx = db.transaction(() => {
    db.prepare('UPDATE payments SET status=?,provider_ref=?,note=?,verified_by=?,verified_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(decision, str(req.body.provider_ref, 120), str(req.body.note, 2000) || p.note, req.user.id, p.id);
    if (decision === 'Đã xác minh') db.prepare("UPDATE dues SET status='Đã thanh toán' WHERE id=?").run(p.dues_id);
  });
  tx();
  log(req.user.id, 'VERIFY_PAYMENT', 'payment', p.id, decision);
  res.json({ ok: true });
});

router.get('/payments/export.csv', auth, roles('admin', 'finance'), (req, res) => {
  const rows = db.prepare(`SELECT p.id,p.transaction_ref,u.name unit,d.period,p.amount,p.method,p.status,p.provider_ref,p.created_at,p.verified_at
    FROM payments p JOIN dues d ON d.id=p.dues_id JOIN units u ON u.id=d.unit_id ORDER BY p.id DESC`).all();
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '\uFEFF' + [['Mã', 'Mã giao dịch', 'Đơn vị', 'Kỳ', 'Số tiền', 'Phương thức', 'Trạng thái', 'Mã ngân hàng', 'Ngày tạo', 'Ngày xác minh'],
    ...rows.map(r => [r.id, r.transaction_ref, r.unit, r.period, r.amount, r.method, r.status, r.provider_ref, r.created_at, r.verified_at])]
    .map(row => row.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="doi-soat-hoi-phi.csv"');
  res.send(csv);
});

/* ---------- Audit log ---------- */
router.get('/audit', auth, roles('admin'), (req, res) => {
  res.json(db.prepare(`SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.created_at,u.username,u.full_name
    FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`).all());
});

/* ---------- Users management ---------- */
router.get('/users', auth, roles('admin'), (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.username,u.full_name,u.role,u.unit_id,u.active,u.created_at,uu.name unit_name
    FROM users u LEFT JOIN units uu ON uu.id=u.unit_id ORDER BY u.id`).all();
  res.json(rows);
});

router.post('/users', auth, roles('admin'), (req, res) => {
  requireFields(req.body, ['username', 'full_name', 'password']);
  const role = enumOf(req.body.role, allowedRoles, 'viewer');
  const unit_id = intOrNull(req.body.unit_id);
  if (!unit_id) throw new HttpError(400, 'Vui lòng chọn đơn vị cho tài khoản');
  const password = str(req.body.password);
  if (password.length < 10) throw new HttpError(400, 'Mật khẩu cần tối thiểu 10 ký tự');
  try {
    const info = db.prepare('INSERT INTO users(username,password_hash,full_name,role,unit_id,active) VALUES(?,?,?,?,?,1)')
      .run(str(req.body.username, 60), bcrypt.hashSync(password, 12), str(req.body.full_name, 120), role, unit_id);
    log(req.user.id, 'CREATE', 'user', info.lastInsertRowid, str(req.body.username, 60));
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Tên đăng nhập đã tồn tại');
    throw e;
  }
});

router.put('/users/:id', auth, roles('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(intOrNull(req.params.id));
  if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
  const b = req.body || {};
  const role = enumOf(b.role, allowedRoles, u.role);
  const unit_id = intOrNull(b.unit_id) ?? u.unit_id;
  const active = b.active === undefined ? u.active : (b.active ? 1 : 0);
  db.prepare('UPDATE users SET full_name=?,role=?,unit_id=?,active=? WHERE id=?')
    .run(str(b.full_name, 120) || u.full_name, role, unit_id, active, u.id);
  log(req.user.id, 'UPDATE', 'user', u.id, u.username);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', auth, roles('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(intOrNull(req.params.id));
  if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
  const password = str(req.body && req.body.password);
  if (password.length < 10) throw new HttpError(400, 'Mật khẩu cần tối thiểu 10 ký tự');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 12), u.id);
  log(req.user.id, 'RESET_PASSWORD', 'user', u.id, u.username);
  res.json({ ok: true });
});

router.delete('/users/:id', auth, roles('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(intOrNull(req.params.id));
  if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
  if (req.user.id === u.id) throw new HttpError(409, 'Không thể xóa tài khoản đang đăng nhập');
  const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n;
  if (u.role === 'admin' && admins <= 1) throw new HttpError(409, 'Cần ít nhất một tài khoản quản trị hoạt động');
  if (db.prepare('SELECT COUNT(*) n FROM reports WHERE created_by=?').get(u.id).n) {
    throw new HttpError(409, 'Tài khoản đã tạo báo cáo. Khóa tài khoản thay vì xóa để giữ dữ liệu.');
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE audit_logs SET user_id=NULL WHERE user_id=?').run(u.id);
    db.prepare('UPDATE payments SET created_by=NULL WHERE created_by=?').run(u.id);
    db.prepare('UPDATE payments SET verified_by=NULL WHERE verified_by=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  });
  tx();
  log(req.user.id, 'DELETE', 'user', u.id, u.username);
  res.json({ ok: true });
});

/* ---------- Posts (news/events) ---------- */
const POST_COLUMNS = ['slug', 'title', 'type', 'category', 'excerpt', 'content', 'cover_image', 'author', 'event_date', 'event_location', 'attachment'];

function postFromBody(b, existing = {}) {
  const title = str(b.title, 300);
  if (!title) throw new HttpError(400, 'Tiêu đề là bắt buộc');
  return {
    slug: uniqueSlug(title, 'posts', existing.id),
    title,
    type: enumOf(b.type, ['news', 'event'], 'news'),
    category: enumOf(b.category, Object.keys(POST_CATEGORIES), existing.category || 'hoat-dong'),
    excerpt: str(b.excerpt, 500),
    content: sanitizeHtml(String(b.content || '').slice(0, 50000)),
    cover_image: str(b.cover_image, 500),
    author: str(b.author, 120),
    event_date: (enumOf(b.type, ['news', 'event'], 'news') === 'event') ? dateOrNull(b.event_date) : null,
    event_location: str(b.event_location, 200),
    attachment: str(b.attachment, 500),
    status: enumOf(b.status, ['draft', 'published'], existing.status || 'draft'),
    is_featured: b.is_featured ? 1 : 0
  };
}

router.get('/posts', auth, (req, res) => {
  const rows = db.prepare(`SELECT p.*,u.full_name created_by_name FROM posts p LEFT JOIN users u ON u.id=p.created_by ORDER BY p.id DESC LIMIT 500`).all();
  res.json(rows.map(r => ({ ...r, category_label: POST_CATEGORIES[r.category] || r.category })));
});

router.post('/posts', auth, roles('admin'), (req, res) => {
  const f = postFromBody(req.body || {}, {});
  const info = db.prepare(`INSERT INTO posts(slug,title,type,category,excerpt,content,cover_image,author,event_date,event_location,attachment,status,is_featured,published_at,created_by,search_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(f.slug, f.title, f.type, f.category, f.excerpt, f.content, f.cover_image, f.author, f.event_date, f.event_location, f.attachment, f.status, f.is_featured,
      f.status === 'published' ? 'CURRENT_TIMESTAMP' : null, req.user.id, norm(`${f.title} ${f.excerpt} ${f.author} ${f.category} ${f.content}`));
  log(req.user.id, 'CREATE', 'post', info.lastInsertRowid, f.title);
  res.status(201).json({ id: info.lastInsertRowid, slug: f.slug });
});

router.put('/posts/:id', auth, roles('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(intOrNull(req.params.id));
  if (!p) throw new HttpError(404, 'Không tìm thấy bài viết');
  const f = postFromBody(req.body || {}, p);
  const nowPublished = f.status === 'published' && p.status !== 'published';
  db.prepare(`UPDATE posts SET slug=?,title=?,type=?,category=?,excerpt=?,content=?,cover_image=?,author=?,event_date=?,event_location=?,attachment=?,status=?,is_featured=?,search_key=?,published_at=COALESCE(published_at, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE published_at END),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(f.slug, f.title, f.type, f.category, f.excerpt, f.content, f.cover_image, f.author, f.event_date, f.event_location, f.attachment, f.status, f.is_featured, norm(`${f.title} ${f.excerpt} ${f.author} ${f.category} ${f.content}`), nowPublished ? 1 : 0, p.id);
  log(req.user.id, 'UPDATE', 'post', p.id, f.title);
  res.json({ ok: true, id: p.id, slug: f.slug });
});

router.delete('/posts/:id', auth, roles('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(intOrNull(req.params.id));
  if (!p) throw new HttpError(404, 'Không tìm thấy bài viết');
  db.prepare('DELETE FROM posts WHERE id=?').run(p.id);
  log(req.user.id, 'DELETE', 'post', p.id, p.title);
  res.json({ ok: true });
});

/* ---------- Documents ---------- */
function docFromBody(b, existing = {}) {
  const title = str(b.title, 300);
  if (!title) throw new HttpError(400, 'Tiêu đề là bắt buộc');
  return {
    slug: uniqueSlug(title, 'documents', existing.id),
    title,
    doc_number: str(b.doc_number, 100),
    doc_type: enumOf(b.doc_type, DOCUMENT_TYPES, 'Khác'),
    category: enumOf(b.category, Object.keys(DOCUMENT_CATEGORIES), existing.category || 'khac'),
    issuer: str(b.issuer, 200),
    issued_at: dateOrNull(b.issued_at),
    summary: str(b.summary, 2000),
    file_url: str(b.file_url, 500),
    status: enumOf(b.status, ['draft', 'published'], existing.status || 'draft')
  };
}

router.get('/documents', auth, (req, res) => {
  const rows = db.prepare(`SELECT d.*,u.full_name created_by_name FROM documents d LEFT JOIN users u ON u.id=d.created_by ORDER BY d.id DESC LIMIT 500`).all();
  res.json(rows.map(r => ({ ...r, category_label: DOCUMENT_CATEGORIES[r.category] || r.category })));
});

router.post('/documents', auth, roles('admin'), (req, res) => {
  const f = docFromBody(req.body || {}, {});
  const info = db.prepare(`INSERT INTO documents(slug,title,doc_number,doc_type,category,issuer,issued_at,summary,file_url,status,created_by,search_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(f.slug, f.title, f.doc_number, f.doc_type, f.category, f.issuer, f.issued_at, f.summary, f.file_url, f.status, req.user.id,
      norm(`${f.title} ${f.summary} ${f.doc_number} ${f.issuer} ${f.doc_type}`));
  log(req.user.id, 'CREATE', 'document', info.lastInsertRowid, f.title);
  res.status(201).json({ id: info.lastInsertRowid, slug: f.slug });
});

router.put('/documents/:id', auth, roles('admin'), (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(intOrNull(req.params.id));
  if (!d) throw new HttpError(404, 'Không tìm thấy văn bản');
  const f = docFromBody(req.body || {}, d);
  db.prepare(`UPDATE documents SET slug=?,title=?,doc_number=?,doc_type=?,category=?,issuer=?,issued_at=?,summary=?,file_url=?,status=?,search_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(f.slug, f.title, f.doc_number, f.doc_type, f.category, f.issuer, f.issued_at, f.summary, f.file_url, f.status,
      norm(`${f.title} ${f.summary} ${f.doc_number} ${f.issuer} ${f.doc_type}`), d.id);
  log(req.user.id, 'UPDATE', 'document', d.id, f.title);
  res.json({ ok: true, id: d.id, slug: f.slug });
});

router.delete('/documents/:id', auth, roles('admin'), (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(intOrNull(req.params.id));
  if (!d) throw new HttpError(404, 'Không tìm thấy văn bản');
  db.prepare('DELETE FROM documents WHERE id=?').run(d.id);
  log(req.user.id, 'DELETE', 'document', d.id, d.title);
  res.json({ ok: true });
});

/* ---------- Settings ---------- */
router.get('/settings', auth, roles('admin'), (req, res) => res.json(getSettings()));

router.put('/settings', auth, roles('admin'), (req, res) => {
  const b = req.body || {};
  const allowed = ['site_name', 'site_short', 'site_tagline', 'hero_title', 'hero_text', 'about_title', 'about_text',
    'address', 'email', 'phone', 'hours', 'facebook', 'youtube'];
  for (const key of allowed) {
    if (b[key] !== undefined) setSetting(key, sanitizeHtml(String(b[key]).slice(0, 2000)));
  }
  log(req.user.id, 'UPDATE', 'settings', '', 'site settings');
  res.json(getSettings());
});

/* ---------- Upload ---------- */
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const ALLOWED_EXT = [/^\.(png|jpe?g|gif|webp|svg)$/i, /^\.pdf$/i, /^\.(docx?|xlsx?)$/i];
const MAX_BYTES = 10 * 1024 * 1024;

router.post('/upload', auth, roles('admin'), (req, res) => {
  const name = str(req.body && req.body.name, 200);
  const data = req.body && req.body.data;
  if (!name || !data) throw new HttpError(400, 'Thiếu tên tệp hoặc dữ liệu tệp');
  const ext = path.extname(name);
  if (!ALLOWED_EXT.some(re => re.test(ext))) throw new HttpError(400, 'Loại tệp không được phép. Chấp nhận ảnh, PDF, DOCX/XLSX');
  const buffer = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'Tệp tối đa 10MB');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safe = crypto.randomBytes(8).toString('hex') + ext.toLowerCase();
  const filePath = path.join(UPLOAD_DIR, safe);
  fs.writeFileSync(filePath, buffer);
  const url = `/uploads/${safe}`;
  log(req.user.id, 'UPLOAD', 'file', url, name);
  res.status(201).json({ url, name: `${path.basename(name, ext)}${ext.toLowerCase()}`, size: buffer.length });
});

module.exports = router;