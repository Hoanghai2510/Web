require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(process.env.DATABASE_PATH || './data/portal.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureColumn(table, colDef) {
  const col = colDef.split(/\s+/)[0];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
}

function ensureSlugUniqueIndex(table) {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_slug ON ${table}(slug)`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  parent_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(parent_id) REFERENCES units(id)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','reviewer','unit_lead','viewer','finance')),
  unit_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_id) REFERENCES units(id)
);
CREATE TABLE IF NOT EXISTS personnel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  unit_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Đang hoạt động',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_id) REFERENCES units(id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  period TEXT NOT NULL,
  content TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Nháp' CHECK(status IN ('Nháp','Chờ duyệt','Đã duyệt','Yêu cầu sửa')),
  reviewer_id INTEGER,
  review_note TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_id) REFERENCES units(id),
  FOREIGN KEY(created_by) REFERENCES users(id),
  FOREIGN KEY(reviewer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS dues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Chưa thanh toán',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_id) REFERENCES units(id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dues_id INTEGER NOT NULL,
  transaction_ref TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Chờ xác minh' CHECK(status IN ('Chờ xác minh','Đã xác minh','Không khớp','Thất bại')),
  provider_ref TEXT,
  note TEXT,
  created_by INTEGER NOT NULL,
  verified_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  FOREIGN KEY(dues_id) REFERENCES dues(id),
  FOREIGN KEY(created_by) REFERENCES users(id),
  FOREIGN KEY(verified_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'news' CHECK(type IN ('news','event')),
  category TEXT NOT NULL DEFAULT 'hoat-dong',
  excerpt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  event_date TEXT,
  event_location TEXT,
  attachment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  is_featured INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  doc_number TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL DEFAULT 'Khác',
  category TEXT NOT NULL DEFAULT 'khac',
  issuer TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  summary TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  download_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
`);

ensureColumn('units', "unit_type TEXT NOT NULL DEFAULT 'chi_hoi'");
ensureColumn('units', "description TEXT NOT NULL DEFAULT ''");
ensureColumn('units', "address TEXT NOT NULL DEFAULT ''");
ensureColumn('units', "phone TEXT NOT NULL DEFAULT ''");
ensureColumn('units', "email TEXT NOT NULL DEFAULT ''");
ensureColumn('units', "head_name TEXT NOT NULL DEFAULT ''");
ensureColumn('units', "founded_at TEXT");
ensureColumn('units', "status TEXT NOT NULL DEFAULT 'active'");
ensureColumn('units', "is_public INTEGER NOT NULL DEFAULT 1");
ensureColumn('units', "slug TEXT NOT NULL DEFAULT ''");
ensureColumn('units', "search_key TEXT NOT NULL DEFAULT ''");

ensureColumn('users', "is_demo INTEGER NOT NULL DEFAULT 0");

ensureColumn('personnel', "slug TEXT NOT NULL DEFAULT ''");
ensureColumn('personnel', "position TEXT NOT NULL DEFAULT ''");
ensureColumn('personnel', "group_role TEXT NOT NULL DEFAULT ''");
ensureColumn('personnel', "term TEXT NOT NULL DEFAULT ''");
ensureColumn('personnel', "bio TEXT NOT NULL DEFAULT ''");
ensureColumn('personnel', "is_public INTEGER NOT NULL DEFAULT 0");
ensureColumn('personnel', "sort_order INTEGER NOT NULL DEFAULT 0");
ensureColumn('personnel', "search_key TEXT NOT NULL DEFAULT ''");

ensureColumn('posts', "search_key TEXT NOT NULL DEFAULT ''");
ensureColumn('documents', "search_key TEXT NOT NULL DEFAULT ''");

function indexPost(id) {
  const p = db.prepare('SELECT title,excerpt,author,category,content FROM posts WHERE id=?').get(id);
  if (!p) return;
  db.prepare('UPDATE posts SET search_key=? WHERE id=?').run(norm(`${p.title} ${p.excerpt} ${p.author} ${p.category} ${p.content}`), id);
}
function indexDoc(id) {
  const d = db.prepare('SELECT title,summary,doc_number,issuer,doc_type FROM documents WHERE id=?').get(id);
  if (!d) return;
  db.prepare('UPDATE documents SET search_key=? WHERE id=?').run(norm(`${d.title} ${d.summary} ${d.doc_number} ${d.issuer} ${d.doc_type}`), id);
}

const slugify = (str) => String(str)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 90) || 'ban-ghi';

function norm(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

function uniqueSlug(base, table, excludeId) {
  const stem = slugify(base);
  let candidate = stem;
  let i = 1;
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE slug=?${excludeId ? ' AND id!=?' : ''}`);
  while (exists.get(...(excludeId ? [candidate, excludeId] : [candidate]))) {
    i += 1;
    candidate = `${stem}-${i}`;
  }
  return candidate;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(key, String(value));
}

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key,value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function log(userId, action, entity, entityId = '', detail = '') {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?)')
    .run(userId || null, action, entity, String(entityId), detail);
}

const DEFAULT_SETTINGS = {
  site_name: 'Hội Giáo dục Chăm sóc Sức khỏe Cộng đồng Việt Nam',
  site_short: 'HỘI GDCSSKCĐ VN',
  site_tagline: 'Chung tay vì sức khỏe cộng đồng',
  hero_title: 'Chung tay vì một cộng đồng khỏe mạnh',
  hero_text: 'Cổng thông tin Hội Giáo dục Chăm sóc Sức khỏe Cộng đồng Việt Nam — nơi cập nhật hoạt động Hội, kết nối các đơn vị trực thuộc và thúc đẩy các chương trình chăm sóc, nâng cao sức khỏe nhân dân.',
  about_title: 'Về Hội',
  about_text: 'Hội Giáo dục Chăm sóc Sức khỏe Cộng đồng Việt Nam hoạt động vì mục tiêu giáo dục sức khỏe, chăm sóc và nâng cao sức khỏe nhân dân; kết nối các đơn vị trực thuộc, chuyên gia, tình nguyện viên và cộng đồng trên khắp cả nước.',
  address: 'Chưa cập nhật địa chỉ chính thức',
  email: 'info@example.org',
  phone: 'Chưa cập nhật số điện thoại',
  hours: 'Thứ Hai – Thứ Sáu, 08:00 – 17:00',
  facebook: '',
  youtube: ''
};

function seedIfEmpty() {
  const tx = db.transaction(() => {
    const settingsCount = db.prepare('SELECT COUNT(*) n FROM settings').get().n;
    if (!settingsCount) for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setSetting(k, v);

    const unitCount = db.prepare('SELECT COUNT(*) n FROM units').get().n;
    if (!unitCount) {
      const add = db.prepare('INSERT INTO units(name,code,parent_id,unit_type,description,address,phone,email,head_name,founded_at,status,is_public,slug) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      add.run('Văn phòng Hội', 'VP', null, 'trung_uong', 'Cơ quan thường trực điều phối hoạt động của Hội và quản trị vận hành hệ thống.', '', '', '', '', null, 'active', 1, 'van-phong-hoi');
      add.run('Ban Chuyên môn Nghiên cứu và Đào tạo', 'BCM-NC', 1, 'ban_chuyen_mon', 'Tổ chức nghiên cứu khoa học, bồi dưỡng chuyên môn và tập huấn cho cán bộ Hội.', '', '', '', '', null, 'active', 1, 'ban-chuyen-mon-nghien-cuu-dao-tao');
      add.run('Liên chi hội Miền Bắc', 'LCB', 1, 'lien_chi_hoi', 'Điều phối hoạt động của các chi hội khu vực miền Bắc.', '', '', '', '', null, 'active', 1, 'lien-chi-hoi-mien-bac');
      add.run('Chi hội Hà Nội', 'HN', 3, 'chi_hoi', 'Chi hội trực thuộc Liên chi hội Miền Bắc, tổ chức các hoạt động giáo dục sức khỏe trên địa bàn thành phố Hà Nội.', 'Hà Nội', '', '', '', null, 'active', 1, 'chi-hoi-ha-noi');
      add.run('Chi hội Đà Nẵng', 'DN', 3, 'chi_hoi', 'Chi hội trực thuộc Liên chi hội Miền Bắc, hoạt động tại khu vực miền Trung.', 'Đà Nẵng', '', '', '', null, 'active', 1, 'chi-hoi-da-nang');
      add.run('Chi hội TP. Hồ Chí Minh', 'HCM', 1, 'chi_hoi', 'Chi hội trực thuộc Hội Trung ương, hoạt động tại phía Nam.', 'TP. Hồ Chí Minh', '', '', '', null, 'active', 1, 'chi-hoi-tp-ho-chi-minh');
      add.run('Viện Nghiên cứu Giáo dục Sức khỏe', 'VIEN', 1, 'vien_trung_tam', 'Đơn vị nghiên cứu chuyên sâu về giáo dục sức khỏe và chăm sóc sức khỏe cộng đồng.', '', '', '', '', null, 'active', 1, 'vien-nghien-cuu-giao-duc-suc-khoe');
      add.run('Trung tâm Đào tạo và Bồi dưỡng', 'TTDT', 1, 'vien_trung_tam', 'Tổ chức các khóa đào tạo, bồi dưỡng và tập huấn kỹ năng cho cán bộ, hội viên.', '', '', '', '', null, 'active', 1, 'trung-tam-dao-tao-boi-duong');
      add.run('Văn phòng đại diện Miền Trung', 'VPMT', 1, 'vp_dai_dien', 'Đại diện Hội tại khu vực miền Trung, kết nối và hỗ trợ các chi hội địa phương.', '', '', '', '', null, 'active', 1, 'van-phong-dai-dien-mien-trung');
      add.run('Công ty TNHH Y tế Cộng đồng', 'DNHV', 1, 'doanh_nghiep', 'Doanh nghiệp hội viên đồng hành cùng các chương trình chăm sóc sức khỏe cộng đồng.', '', '', '', '', null, 'active', 1, 'cong-ty-tnhh-y-te-cong-dong');
    }

    const peopleCount = db.prepare('SELECT COUNT(*) n FROM personnel').get().n;
    if (!peopleCount) {
      const unitId = (code) => db.prepare('SELECT id FROM units WHERE code=?').get(code).id;
      const ins = db.prepare(`INSERT INTO personnel(full_name,title,email,phone,unit_id,status,slug,position,group_role,term,bio,is_public,sort_order)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const seed = [
        ['Nguyễn Minh Anh', 'Chủ tịch Hội', 'minhanh@example.org', '09xx xxx 101', 'VP', 'Chủ tịch Hội', 'chu-tich-hoi', 'bch', '2025–2030', 'Chủ tịch Hội, chịu trách nhiệm chung trước Ban Chấp hành.', 1, 1],
        ['Trần Quốc Bảo', 'Phó Chủ tịch Hội', 'quocbao@example.org', '09xx xxx 202', 'VP', 'Phó Chủ tịch Hội', 'pho-chu-tich-hoi', 'bch', '2025–2030', 'Phó Chủ tịch Hội, phụ trách chuyên môn và tổ chức.', 1, 2],
        ['Lê Thu Hà', 'Tổng thư ký', 'thuha@example.org', '09xx xxx 303', 'VP', 'Tổng thư ký', 'tong-thu-ky', 'bttv', '2025–2030', 'Tổng thư ký, điều hành hoạt động thường trực.', 1, 3],
        ['Phạm Văn Hùng', 'Ủy viên Thường vụ', 'vanhung@example.org', '09xx xxx 404', 'VP', 'Ủy viên Thường vụ', 'uy-vien-thuong-vu', 'bttv', '2025–2030', '', 1, 4],
        ['Đỗ Thị Lan', 'Chủ tịch Chi hội Hà Nội', 'thilan@example.org', '09xx xxx 505', 'HN', 'Chủ tịch Chi hội', 'chu-tich-chi-hoi-ha-noi', 'lanh_dao_don_vi', '2025–2030', '', 1, 5],
        ['Vũ Ngọc Sơn', 'Phó Chủ tịch Chi hội Đà Nẵng', 'ngocson@example.org', '09xx xxx 606', 'DN', 'Phó Chủ tịch Chi hội', 'pho-chu-tich-chi-hoi-da-nang', 'lanh_dao_don_vi', '2025–2030', '', 1, 6]
      ];
      for (const s of seed) ins.run(s[0], s[1], s[2], s[3], unitId(s[4]), 'Đang hoạt động', s[5] ? s[6] : '', s[5], s[7], s[8], s[9], s[10], s[11]);
    }

    const postCount = db.prepare('SELECT COUNT(*) n FROM posts').get().n;
    if (!postCount) {
      const ins = db.prepare(`INSERT INTO posts(slug,title,type,category,excerpt,content,cover_image,author,event_date,event_location,status,is_featured,published_at,view_count)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const P = (slug, title, type, category, excerpt, content, author, event_date, event_location, featured, views) =>
        ins.run(slug, title, type, category, excerpt, content, '', author, event_date, event_location, 'published', featured, '2026-09-01 08:00:00', views);
      P('hoi-nghi-tong-thuong-nien-2026', 'Hội nghị tổng kết hoạt động năm 2026 và phương hướng năm 2027', 'news', 'hoi-nghi',
        'Hội nghị tổng kết các hoạt động chuyên môn, tổ chức và tài chính của hệ thống Hội trong năm 2026.',
        '<p>Hội nghị tổng kết năm 2026 đã thảo luận về kết quả hoạt động của hệ thống Hội, bao gồm công tác tổ chức, chuyên môn, tài chính và các hoạt động vì cộng đồng.</p><p>Nội dung chi tiết sẽ được cập nhật sau khi được Ban Thường vụ thông qua.</p>',
        'Ban Tuyên truyền', null, null, 1, 480);
      P('chuong-trinh-thien-nguyen-mua-thu-2026', 'Chương trình thiện nguyện "Mùa thu vì cộng đồng" năm 2026', 'news', 'thien-nguyen',
        'Các chi hội đồng loạt tổ chức hoạt động khám bệnh, tư vấn sức khỏe và tặng quà cho người dân khó khăn.',
        '<p>Chương trình thiện nguyện "Mùa thu vì cộng đồng" được triển khai tại nhiều địa phương với sự tham gia của cán bộ, hội viên và tình nguyện viên.</p><p>Hoạt động bao gồm khám bệnh miễn phí, tư vấn sức khỏe, truyền thông phòng bệnh và tặng quà cho các gia đình khó khăn.</p>',
        'Ban Tuyên truyền', null, null, 1, 320);
      P('khai-nam-hoc-dao-tao-2026-2027', 'Khai giảng khóa đào tạo giáo dục sức khỏe năm học 2026–2027', 'news', 'dao-tao',
        'Trung tâm Đào tạo và Bồi dưỡng khai giảng khóa đào tạo dành cho cán bộ, hội viên toàn quốc.',
        '<p>Khóa đào tạo nhằm chuẩn hóa kiến thức và kỹ năng về giáo dục sức khỏe, chăm sóc sức khỏe cộng đồng cho cán bộ, hội viên.</p>',
        'Trung tâm Đào tạo và Bồi dưỡng', null, null, 0, 210);
      P('thong-bao-hop-bch-lan-thu-vii', 'Thông báo phiên họp Ban Chấp hành lần thứ VII', 'news', 'thong-bao',
        'Thông báo thời gian, địa điểm và nội dung phiên họp Ban Chấp hành lần thứ VII.',
        '<p>Phiên họp Ban Chấp hành lần thứ VII dự kiến tập trung vào công tác tổ chức, chuẩn bị đại hội và các nội dung chuyên môn.</p>',
        'Văn phòng Hội', null, null, 0, 190);
      P('le-khai-truong-vien-nghien-cuu-2026', 'Lễ khai trương Viện Nghiên cứu Giáo dục Sức khỏe', 'event', 'hoat-dong',
        'Sự kiện khai trương đơn vị trực thuộc mới của Hội.',
        '<p>Lễ khai trương đánh dấu bước phát triển mới trong hoạt động nghiên cứu của Hội.</p>',
        'Văn phòng Hội', '2026-11-20', 'Hà Nội', 1, 260);
      P('ngay-suc-khoe-cong-dong-2026', 'Ngày Sức khỏe Cộng đồng toàn quốc năm 2026', 'event', 'hoat-dong',
        'Sự kiện lớn nhất trong năm, hưởng ứng Ngày Sức khỏe Cộng đồng.',
        '<p>Chuỗi hoạt động hưởng ứng Ngày Sức khỏe Cộng đồng gồm tọa đàm khoa học, khám bệnh cộng đồng và các hoạt động thể thao, văn nghệ.</p>',
        'Ban Tuyên truyền', '2026-12-05', 'TP. Hồ Chí Minh', 1, 540);
      P('hoi-thao-khoa-hoc-giao-duc-suc-khoe', 'Hội thảo khoa học về giáo dục sức khỏe trong nhà trường', 'event', 'hoi-nghi',
        'Hội thảo khoa học cấp quốc gia về giáo dục sức khỏe học đường.',
        '<p>Hội thảo tập trung vào phương pháp giảng dạy, chương trình giáo dục sức khỏe và mô hình trường học khỏe mạnh.</p>',
        'Viện Nghiên cứu Giáo dục Sức khỏe', '2026-11-28', 'Đà Nẵng', 0, 150);
      P('giai-bong-da-lien-chi-hoi-2026', 'Giải bóng đá liên chi hội lần thứ III năm 2026', 'event', 'the-thao',
        'Sự kiện thể thao gắn kết hội viên toàn hệ thống.',
        '<p>Giải bóng đá liên chi hội là hoạt động thường niên nhằm tăng cường giao lưu, rèn luyện thể chất giữa các chi hội.</p>',
        'Liên chi hội Miền Bắc', '2026-10-24', 'Hà Nội', 0, 175);
    }

    const docCount = db.prepare('SELECT COUNT(*) n FROM documents').get().n;
    if (!docCount) {
      const ins = db.prepare(`INSERT INTO documents(slug,title,doc_number,doc_type,category,issuer,issued_at,summary,file_url,status,download_count)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      const D = (slug, title, num, type, cat, issuer, date, summary) =>
        ins.run(slug, title, num, type, cat, issuer, date, summary, '', 'published', 0);
      D('dieu-le-hoi', 'Điều lệ Hội Giáo dục Chăm sóc Sức khỏe Cộng đồng Việt Nam', '01/ĐL-HỘI', 'Điều lệ', 'gioi-thieu', 'Ban Chấp hành Trung ương Hội', '2025-06-15', 'Điều lệ quy định phạm vi hoạt động, cơ cấu tổ chức, quyền và nghĩa vụ của hội viên.');
      D('quyet-dinh-thanh-lap-hoi', 'Quyết định thành lập Hội Giáo dục Chăm sóc Sức khỏe Cộng đồng Việt Nam', '123/QĐ', 'Quyết định', 'gioi-thieu', 'Cơ quan có thẩm quyền', '2024-03-20', 'Quyết định thành lập Hội và công nhận Ban Chấp hành lâm thời.');
      D('quy-che-to-chuc-hoat-dong', 'Quy chế tổ chức và hoạt động của hệ thống Hội', '02/QC-HỘI', 'Quy chế', 'to-chuc', 'Ban Thường vụ Trung ương Hội', '2025-08-01', 'Quy định về hệ thống tổ chức, thẩm quyền và quy trình ra quyết định.');
      D('quy-che-bac-cu-bo-nhiem', 'Quy chế bầu cử, bổ nhiệm và miễn nhiệm cán bộ', '03/QC-HỘI', 'Quy chế', 'nhan-su', 'Ban Thường vụ Trung ương Hội', '2025-09-10', 'Quy trình chuẩn bị, tiến hành bầu cử, bổ nhiệm và miễn nhiệm cán bộ các cấp.');
      D('quy-dinh-hoi-phi', 'Quy định về hội phí, phí thành lập và đóng góp từ thiện', '05/QC-TC', 'Quy chế', 'tai-chinh', 'Ban Thường vụ Trung ương Hội', '2025-10-05', 'Mức thu, kỳ thu, đối tượng đóng hội phí và cơ chế quản lý, công khai tài chính.');
      D('quy-dinh-bao-cao', 'Chế độ báo cáo của các đơn vị trực thuộc', '06/QC-BC', 'Hướng dẫn', 'bao-cao', 'Văn phòng Hội', '2025-10-20', 'Hướng dẫn nội dung, kỳ hạn và hình thức nộp báo cáo của chi hội, liên chi hội và đơn vị trực thuộc.');
      D('mau-ho-so-ky-nap-hoi-vien', 'Mẫu hồ sơ kết nạp hội viên cá nhân và tập thể', '07/BB-HV', 'Biểu mẫu', 'nhan-su', 'Văn phòng Hội', '2025-11-02', 'Bộ mẫu hồ sơ, đơn đề nghị và quyết định kết nạp hội viên.');
      D('mau-bao-cao-quy', 'Mẫu báo cáo quý của chi hội và liên chi hội', '08/BB-BC', 'Biểu mẫu', 'bao-cao', 'Văn phòng Hội', '2025-11-02', 'Mẫu báo cáo định kỳ theo quý áp dụng cho toàn hệ thống.');
    }

    const userCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    if (!userCount) {
      const addUser = db.prepare('INSERT INTO users(username,password_hash,full_name,role,unit_id,is_demo) VALUES(?,?,?,?,?,?)');
      const vp = db.prepare("SELECT id FROM units WHERE code='VP'").get().id;
      const hn = db.prepare("SELECT id FROM units WHERE code='HN'").get().id;
      addUser.run('admin', bcrypt.hashSync('admin123', 10), 'Quản trị hệ thống', 'admin', vp, 1);
      addUser.run('reviewer', bcrypt.hashSync('review123', 10), 'Người duyệt báo cáo', 'reviewer', vp, 1);
      addUser.run('unitlead', bcrypt.hashSync('unit123', 10), 'Trưởng Chi hội Hà Nội', 'unit_lead', hn, 1);
      addUser.run('finance', bcrypt.hashSync('finance123', 10), 'Phụ trách tài chính', 'finance', vp, 1);
    }
    if (db.prepare('SELECT COUNT(*) n FROM personnel').get().n && db.prepare('SELECT COUNT(*) n FROM reports').get().n === 0) {
      const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
      const leadId = db.prepare("SELECT id FROM users WHERE username='unitlead'").get().id;
      const hn = db.prepare("SELECT id FROM units WHERE code='HN'").get().id;
      const dn = db.prepare("SELECT id FROM units WHERE code='DN'").get().id;
      const ins = db.prepare('INSERT INTO reports(title,period,content,unit_id,created_by,status,submitted_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)');
      ins.run('Báo cáo hoạt động quý III/2026', 'Quý III/2026', 'Tổng hợp hoạt động chuyên môn, truyền thông và công tác hội viên trong quý.', hn, leadId, 'Chờ duyệt');
      ins.run('Báo cáo công tác tổ chức tháng 09/2026', 'Tháng 09/2026', 'Cập nhật thay đổi nhân sự, cơ cấu tổ chức và các hoạt động phối hợp.', dn, adminId, 'Đã duyệt');
    }
    if (db.prepare('SELECT COUNT(*) n FROM dues').get().n === 0) {
      const ins = db.prepare('INSERT INTO dues(unit_id,period,amount,status) VALUES(?,?,?,?)');
      const id = (code) => db.prepare('SELECT id FROM units WHERE code=?').get(code).id;
      ins.run(id('HN'), 'Năm 2026', 1200000, 'Chưa thanh toán');
      ins.run(id('DN'), 'Năm 2026', 1200000, 'Chưa thanh toán');
      ins.run(id('HCM'), 'Năm 2026', 1500000, 'Chưa thanh toán');
    }
  });
  tx();
}

function backfill() {
  const tx = db.transaction(() => {
    for (const u of db.prepare('SELECT id,name,slug,code,head_name,unit_type FROM units').all()) {
      if (!u.slug) db.prepare('UPDATE units SET slug=? WHERE id=?').run(uniqueSlug(u.name, 'units', u.id), u.id);
      if (u.code === 'VP' && u.unit_type === 'chi_hoi') db.prepare("UPDATE units SET unit_type='trung_uong' WHERE id=?").run(u.id);
      if (!u.head_name) {
        const head = db.prepare(`SELECT full_name FROM personnel WHERE unit_id=? AND (position LIKE 'Chủ tịch%' OR title LIKE 'Chủ tịch%') ORDER BY sort_order LIMIT 1`).get(u.id);
        if (head) db.prepare('UPDATE units SET head_name=? WHERE id=?').run(head.full_name, u.id);
      }
    }
    for (const p of db.prepare('SELECT id,full_name,slug,group_role FROM personnel').all()) {
      if (!p.slug) db.prepare('UPDATE personnel SET slug=? WHERE id=?').run(uniqueSlug(p.full_name, 'personnel', p.id), p.id);
      if (!p.group_role) db.prepare("UPDATE personnel SET group_role='can_bo' WHERE id=?").run(p.id);
    }
    for (const t of [['posts', 'title'], ['documents', 'title']]) {
      for (const r of db.prepare(`SELECT id,${t[1]} title,slug FROM ${t[0]}`).all()) {
        if (!r.slug) db.prepare(`UPDATE ${t[0]} SET slug=? WHERE id=?`).run(uniqueSlug(r.title, t[0], r.id), r.id);
      }
    }
    for (const p of db.prepare('SELECT id FROM posts').all()) indexPost(p.id);
    for (const d of db.prepare('SELECT id FROM documents').all()) indexDoc(d.id);
    for (const u of db.prepare('SELECT id,name,description,address FROM units').all()) {
      db.prepare('UPDATE units SET search_key=? WHERE id=?').run(norm(`${u.name} ${u.description} ${u.address}`), u.id);
    }
    for (const p of db.prepare('SELECT id,full_name,position,title FROM personnel').all()) {
      db.prepare('UPDATE personnel SET search_key=? WHERE id=?').run(norm(`${p.full_name} ${p.position} ${p.title}`), p.id);
    }
    const DEMO_PASSWORDS = { admin: 'admin123', reviewer: 'review123', unitlead: 'unit123', finance: 'finance123' };
    for (const u of db.prepare('SELECT id,username,password_hash,is_demo FROM users').all()) {
      const demoPass = DEMO_PASSWORDS[u.username];
      if (demoPass && bcrypt.compareSync(demoPass, u.password_hash)) {
        if (!u.is_demo) db.prepare('UPDATE users SET is_demo=1 WHERE id=?').run(u.id);
      }
    }
  });
  tx();
}

seedIfEmpty();
backfill();

ensureSlugUniqueIndex('units');
ensureSlugUniqueIndex('personnel');

db.exec(`
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_search ON posts(search_key);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents(search_key);
CREATE INDEX IF NOT EXISTS idx_units_public ON units(is_public);
CREATE INDEX IF NOT EXISTS idx_personnel_public ON personnel(is_public, status);
CREATE INDEX IF NOT EXISTS idx_personnel_unit ON personnel(unit_id);
CREATE INDEX IF NOT EXISTS idx_reports_unit ON reports(unit_id);
CREATE INDEX IF NOT EXISTS idx_payments_dues ON payments(dues_id);
`);

module.exports = { db, slugify, uniqueSlug, norm, indexPost, indexDoc, setSetting, getSettings, log, dbPath };
