const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, getSettings, norm } = require('../db');
const { asyncHandler, str, intOrNull, HttpError } = require('../middleware');

const router = express.Router();

const POST_CATEGORIES = {
  'chinh-sach': 'Chính sách y tế',
  'hoat-dong': 'Hoạt động Hội',
  'hoi-nghi': 'Hội nghị – Hội thảo',
  'thien-nguyen': 'Thiện nguyện',
  'the-thao': 'Thể thao',
  'van-nghe': 'Văn nghệ',
  'dao-tao': 'Đào tạo – Bồi dưỡng',
  'thong-bao': 'Thông báo',
  'don-vi': 'Hoạt động đơn vị'
};

const DOCUMENT_CATEGORIES = {
  'gioi-thieu': 'Giới thiệu Hội',
  'to-chuc': 'Quản trị tổ chức',
  'nhan-su': 'Quản trị nhân sự',
  'tai-chinh': 'Tài chính – Hội phí',
  'bao-cao': 'Chế độ báo cáo',
  'khac': 'Tài liệu khác'
};

const DOCUMENT_TYPES = ['Điều lệ', 'Quyết định', 'Quy chế', 'Hướng dẫn', 'Biểu mẫu', 'Báo cáo', 'Khác'];

const UNIT_TYPES = {
  trung_uong: 'Trung ương Hội',
  ban_chuyen_mon: 'Ban chuyên môn',
  lien_chi_hoi: 'Liên chi hội',
  chi_hoi: 'Chi hội',
  vien_trung_tam: 'Viện / Trung tâm',
  vp_dai_dien: 'Văn phòng đại diện',
  doanh_nghiep: 'Doanh nghiệp hội viên'
};

const PEOPLE_GROUPS = {
  bch: 'Ban Chấp hành Trung ương',
  bttv: 'Ban Thường vụ',
  lanh_dao_don_vi: 'Lãnh đạo đơn vị',
  can_bo: 'Cán bộ, hội viên'
};

const POST_SELECT = `SELECT id, slug, title, type, category, excerpt, cover_image, author,
  event_date, event_location, is_featured, view_count, published_at, created_at, updated_at
  FROM posts`;

function publishedWhere(extra = []) {
  return ["status='published'", ...extra].join(' AND ');
}

router.get('/meta', (req, res) => {
  res.json({
    post_categories: POST_CATEGORIES,
    document_categories: DOCUMENT_CATEGORIES,
    document_types: DOCUMENT_TYPES,
    unit_types: UNIT_TYPES,
    people_groups: PEOPLE_GROUPS
  });
});

router.get('/settings', (req, res) => res.json(getSettings()));

router.get('/home', (req, res) => {
  const latest = db.prepare(`${POST_SELECT} WHERE ${publishedWhere()} ORDER BY is_featured DESC, published_at DESC, id DESC LIMIT 6`).all();
  const events = db.prepare(`${POST_SELECT} WHERE ${publishedWhere(["type='event'"])} AND (event_date IS NULL OR event_date >= date('now')) ORDER BY event_date ASC, id DESC LIMIT 4`).all();
  const documents = db.prepare(`SELECT id, slug, title, doc_number, doc_type, category, issuer, issued_at, summary, download_count
    FROM documents WHERE status='published' ORDER BY issued_at DESC, id DESC LIMIT 5`).all();
  const units = db.prepare(`SELECT COUNT(*) n FROM units WHERE status='active' AND is_public=1`).get().n;
  const newsCount = db.prepare(`SELECT COUNT(*) n FROM posts WHERE ${publishedWhere(["type='news'"])}`).get().n;
  const docCount = db.prepare(`SELECT COUNT(*) n FROM documents WHERE status='published'`).get().n;
  res.json({ latest, events, documents, stats: { units, news: newsCount, documents: docCount } });
});

router.get('/posts', (req, res) => {
  const type = str(req.query.type, 20);
  const category = str(req.query.category, 40);
  const q = str(req.query.q, 200);
  const limit = Math.min(Math.max(intOrNull(req.query.limit) || 9, 1), 50);
  const page = Math.max(intOrNull(req.query.page) || 1, 1);
  const where = [publishedWhere()];
  const params = [];
  if (type === 'news' || type === 'event') { where.push('type=?'); params.push(type); }
  if (category && POST_CATEGORIES[category]) { where.push('category=?'); params.push(category); }
  if (q) { where.push('search_key LIKE ?'); params.push(`%${norm(q)}%`); }
  const sql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n FROM posts ${sql}`).get(...params).n;
  const rows = db.prepare(`${POST_SELECT} ${sql} ORDER BY is_featured DESC, published_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  res.json({ items: rows.map((r) => ({ ...r, category_label: POST_CATEGORIES[r.category] || r.category })), total, page, pages: Math.max(Math.ceil(total / limit), 1) });
});

router.get('/posts/:slug', (req, res) => {
  const slug = str(req.params.slug, 120);
  const row = db.prepare(`SELECT p.*, u.full_name author_name FROM posts p
    LEFT JOIN users u ON u.id = p.created_by
    WHERE p.slug=? AND p.status='published'`).get(slug);
  if (!row) throw new HttpError(404, 'Không tìm thấy bài viết');
  db.prepare('UPDATE posts SET view_count=view_count+1 WHERE id=?').run(row.id);
  const related = db.prepare(`${POST_SELECT} WHERE ${publishedWhere(['category=?', 'id!=?'])} ORDER BY published_at DESC LIMIT 3`).all(row.category, row.id);
  res.json({ ...row, category_label: POST_CATEGORIES[row.category] || row.category, related: related.map((r) => ({ ...r, category_label: POST_CATEGORIES[r.category] || r.category })) });
});

router.get('/documents', (req, res) => {
  const q = str(req.query.q, 200);
  const category = str(req.query.category, 40);
  const docType = str(req.query.doctype, 60);
  const where = ["status='published'"];
  const params = [];
  if (category && DOCUMENT_CATEGORIES[category]) { where.push('category=?'); params.push(category); }
  if (docType && DOCUMENT_TYPES.includes(docType)) { where.push('doc_type=?'); params.push(docType); }
  if (q) { where.push('search_key LIKE ?'); params.push(`%${norm(q)}%`); }
  const rows = db.prepare(`SELECT id, slug, title, doc_number, doc_type, category, issuer, issued_at, summary, file_url, download_count
    FROM documents WHERE ${where.join(' AND ')} ORDER BY issued_at DESC, id DESC LIMIT 200`).all(...params);
  res.json({ items: rows.map((r) => ({ ...r, category_label: DOCUMENT_CATEGORIES[r.category] || r.category })) });
});

router.get('/documents/:id', (req, res) => {
  const id = intOrNull(req.params.id);
  const row = db.prepare(`SELECT * FROM documents WHERE id=? AND status='published'`).get(id);
  if (!row) throw new HttpError(404, 'Không tìm thấy văn bản');
  res.json({ ...row, category_label: DOCUMENT_CATEGORIES[row.category] || row.category });
});

router.get('/documents/:id/download', (req, res) => {
  const id = intOrNull(req.params.id);
  const row = db.prepare(`SELECT * FROM documents WHERE id=? AND status='published'`).get(id);
  if (!row) throw new HttpError(404, 'Không tìm thấy văn bản');
  if (!row.file_url) throw new HttpError(404, 'Văn bản chưa có tệp đính kèm');
  const rel = String(row.file_url).replace(/^\/+/, '').replace(/^public\//, '');
  const filePath = path.resolve(__dirname, '..', 'public', rel);
  if (!filePath.startsWith(path.resolve(__dirname, '..', 'public'))) throw new HttpError(400, 'Đường dẫn tệp không hợp lệ');
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Tệp đính kèm không còn tồn tại');
  db.prepare('UPDATE documents SET download_count=download_count+1 WHERE id=?').run(row.id);
  const safeName = `${row.slug}${path.extname(filePath)}`;
  res.download(filePath, safeName);
});

router.get('/units', (req, res) => {
  const rows = db.prepare(`SELECT id, name, slug, code, parent_id, unit_type, description, address, phone, email, head_name, founded_at, status
    FROM units WHERE is_public=1 ORDER BY parent_id IS NULL DESC, parent_id, unit_type, name`).all()
    .map((u) => ({ ...u, unit_type_label: UNIT_TYPES[u.unit_type] || u.unit_type }));
  res.json(rows);
});

router.get('/units/:slug', (req, res) => {
  const row = db.prepare(`SELECT * FROM units WHERE slug=? AND is_public=1`).get(str(req.params.slug, 120));
  if (!row) throw new HttpError(404, 'Không tìm thấy đơn vị');
  const children = db.prepare(`SELECT id, name, slug, unit_type, description, head_name FROM units WHERE parent_id=? AND is_public=1 ORDER BY name`).all(row.id)
    .map((u) => ({ ...u, unit_type_label: UNIT_TYPES[u.unit_type] || u.unit_type }));
  const leaders = db.prepare(`SELECT id, slug, full_name, position, title, term FROM personnel WHERE unit_id=? AND is_public=1 ORDER BY sort_order, id LIMIT 12`).all(row.id);
  res.json({ ...row, unit_type_label: UNIT_TYPES[row.unit_type] || row.unit_type, children, leaders });
});

router.get('/leaders', (req, res) => {
  const rows = db.prepare(`SELECT p.id, p.slug, p.full_name, p.position, p.title, p.group_role, p.term, p.bio, p.unit_id, u.name unit_name
    FROM personnel p JOIN units u ON u.id = p.unit_id
    WHERE p.is_public=1 AND p.status='Đang hoạt động'
    ORDER BY CASE p.group_role WHEN 'bch' THEN 1 WHEN 'bttv' THEN 2 WHEN 'lanh_dao_don_vi' THEN 3 ELSE 4 END, p.sort_order, p.id`).all()
    .map((r) => ({ ...r, group_label: PEOPLE_GROUPS[r.group_role] || r.group_role }));
  res.json(rows);
});

router.get('/people/:slug', (req, res) => {
  const row = db.prepare(`SELECT p.*, u.name unit_name FROM personnel p JOIN units u ON u.id=p.unit_id
    WHERE p.slug=? AND p.is_public=1`).get(str(req.params.slug, 120));
  if (!row) throw new HttpError(404, 'Không tìm thấy hồ sơ');
  res.json({ ...row, group_label: PEOPLE_GROUPS[row.group_role] || row.group_role });
});

router.get('/search', (req, res) => {
  const q = str(req.query.q, 200);
  if (q.length < 2) return res.json({ q, posts: [], documents: [], units: [], people: [] });
  const like = `%${norm(q)}%`;
  const posts = db.prepare(`${POST_SELECT} WHERE ${publishedWhere(['search_key LIKE ?'])} ORDER BY published_at DESC LIMIT 8`).all(like)
    .map((r) => ({ ...r, category_label: POST_CATEGORIES[r.category] || r.category }));
  const documents = db.prepare(`SELECT id, slug, title, doc_number, doc_type, category, issuer, issued_at, summary
    FROM documents WHERE status='published' AND search_key LIKE ? ORDER BY issued_at DESC LIMIT 8`).all(like)
    .map((r) => ({ ...r, category_label: DOCUMENT_CATEGORIES[r.category] || r.category }));
  const units = db.prepare(`SELECT id, name, slug, unit_type, description FROM units WHERE is_public=1 AND search_key LIKE ? LIMIT 8`).all(like)
    .map((r) => ({ ...r, unit_type_label: UNIT_TYPES[r.unit_type] || r.unit_type }));
  const people = db.prepare(`SELECT id, slug, full_name, position, title FROM personnel WHERE is_public=1 AND search_key LIKE ? LIMIT 8`).all(like);
  res.json({ q, posts, documents, units, people });
});

module.exports = router;
module.exports.POST_CATEGORIES = POST_CATEGORIES;
module.exports.DOCUMENT_CATEGORIES = DOCUMENT_CATEGORIES;
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
module.exports.UNIT_TYPES = UNIT_TYPES;
module.exports.PEOPLE_GROUPS = PEOPLE_GROUPS;
