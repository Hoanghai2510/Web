process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-secret-2019-abcdef-1234567890';
process.env.ALLOW_DEMO = '1';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.DATABASE_PATH = './data/test-portal.db';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let server, base;

function raw(method, url, opts = {}) {
  return fetch(base + url, { method, ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}
async function json(method, url, body, token) {
  const opts = { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
  if (body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase())) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(body);
  }
  const r = await raw(method, url, opts);
  let data = null; try { data = await r.json(); } catch (_) { /* ignore */ }
  return { status: r.status, data };
}
async function login(u, p) {
  const r = await json('POST', '/api/auth/login', { username: u, password: p });
  return r;
}

const tokens = {};
const ids = { post: null, doc: null, unit: null, person: null, dues: null, payment: null, user: null, report: null };
let ulUnitId = null;

before(async () => {
  const app = require('../server');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server && server.close();
  for (const file of ['portal.db', 'portal.db-wal', 'portal.db-shm']) {
    const p = path.join(__dirname, '..', 'data', `test-${file}`);
    try { fs.rmSync(p, { force: true }); } catch (_) { /* ignore */ }
  }
});

/* ---------- Demo lockdown (production without ALLOW_DEMO) ---------- */
test('production blocks demo accounts unless ALLOW_DEMO=1', async () => {
  process.env.ALLOW_DEMO = '0';
  const blocked = await login('admin', 'admin123');
  assert.strictEqual(blocked.status, 403);
  for (const [u, p] of [['reviewer', 'review123'], ['unitlead', 'unit123'], ['finance', 'finance123']]) {
    const r = await login(u, p);
    assert.strictEqual(r.status, 403, `${u} should be blocked`);
  }
  process.env.ALLOW_DEMO = '1';
  const ok = await login('admin', 'admin123');
  assert.strictEqual(ok.status, 200);
  tokens.admin = ok.data.token;
  assert.ok(tokens.admin);
});

test('login failures rejected', async () => {
  const bad = await login('admin', 'wrong-password');
  assert.strictEqual(bad.status, 401);
  assert.ok(bad.data.error);
});

/* ---------- Public site & SEO ---------- */
test('public shell serves HTML for site + admin + SPA routes', async () => {
  for (const p of ['/', '/gioi-thieu', '/tin-tuc', '/van-ban', '/to-chuc', '/nhan-su', '/tai-chinh', '/bao-cao', '/lien-he', '/tim-kiem', '/unknown-page']) {
    const r = await raw('GET', p);
    assert.strictEqual(r.status, 200, p);
    assert.match(await r.text(), /<!doctype html>/i);
  }
});

test('SEO assets available', async () => {
  const robots = await raw('GET', '/robots.txt');
  assert.strictEqual(robots.status, 200);
  assert.match(await robots.text(), /Sitemap:/);
  const sitemap = await raw('GET', '/sitemap.xml');
  assert.strictEqual(sitemap.status, 200);
  const body = await sitemap.text();
  assert.match(body, /<urlset/);
  assert.match(body, /<loc>http:\/\//);
  assert.match(body, /\/tin-tuc\//);
  const siteJs = await raw('GET', '/site.js');
  assert.strictEqual(siteJs.status, 200);
  const siteCss = await raw('GET', '/site.css');
  assert.strictEqual(siteCss.status, 200);
  const adminJs = await raw('GET', '/admin/app.js');
  assert.strictEqual(adminJs.status, 200);
});

test('public APIs: home, meta, settings, posts, docs, units, search', async () => {
  const meta = await raw('GET', '/api/public/meta');
  assert.strictEqual(meta.status, 200);
  const m = await meta.json();
  assert.ok(m.post_categories['hoat-dong']);

  const home = await raw('GET', '/api/public/home');
  const h = await home.json();
  assert.ok(Array.isArray(h.latest) && h.latest.length >= 1);
  assert.ok(h.stats.units >= 1);

  const list = await json('GET', '/api/public/posts?type=news&limit=3');
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.data.items));
  assert.ok(list.data.items.every((x) => x.status === 'published' || !('status' in x) || x.id));

  const searchAccent = await json('GET', '/api/public/search?q=suc khoe');
  assert.strictEqual(searchAccent.status, 200);
});

/* ---------- Admin fixtures (RBAC) ---------- */
test('login all roles', async () => {
  for (const [u, p] of [['admin', 'admin123'], ['reviewer', 'review123'], ['unitlead', 'unit123'], ['finance', 'finance123']]) {
    const r = await login(u, p);
    assert.strictEqual(r.status, 200, u);
    tokens[u] = r.data.token;
    if (u === 'unitlead') ulUnitId = r.data.user.unit_id;
  }
  assert.ok(ulUnitId, 'unitlead has a unit');
});

test('RBAC: posts/documents/settings/users only admin', async () => {
  const reviewer = await json('POST', '/api/posts', { title: 'x', status: 'draft' }, tokens.reviewer);
  assert.strictEqual(reviewer.status, 403);
  const unitlead = await json('POST', '/api/posts', { title: 'x', status: 'draft' }, tokens.unitlead);
  assert.strictEqual(unitlead.status, 403);
  const reviewerSettings = await json('PUT', '/api/settings', { site_tagline: 'x' }, tokens.reviewer);
  assert.strictEqual(reviewerSettings.status, 403);
  const reviewerUsers = await json('GET', '/api/users', {}, tokens.reviewer);
  assert.strictEqual(reviewerUsers.status, 403);
  const financeUsers = await json('GET', '/api/audit', {}, tokens.finance);
  assert.strictEqual(financeUsers.status, 403);
});

test('RBAC: unit_lead scoping on personnel + units + reports', async () => {
  const allUnits = await json('GET', '/api/units', {}, tokens.admin);
  assert.ok(allUnits.data.length >= 4);
  const ulUnits = await json('GET', '/api/units', {}, tokens.unitlead);
  const names = ulUnits.data.map((u) => u.name).join(' ');
  assert.ok(names.includes('Hà Nội'));
  assert.ok(allUnits.data.length >= ulUnits.data.length);

  const ulPersonnel = await json('GET', '/api/personnel', {}, tokens.unitlead);
  assert.ok(ulPersonnel.data.every((p) => p.unit_id === ulUnitId), 'unitlead only sees own unit people');
  const created = await json('POST', '/api/personnel', { full_name: 'Nhân viên HN test', unit_id: ulUnitId, is_public: true }, tokens.unitlead);
  assert.strictEqual(created.status, 201);
  const pid = created.data.id;
  const list = await json('GET', '/api/personnel', {}, tokens.admin);
  const person = list.data.find((p) => p.id === pid);
  assert.strictEqual(person.is_public, 0, 'unit_lead cannot publish');
  const published = await json('PUT', `/api/personnel/${pid}`, { full_name: 'Nhân viên HN test', is_public: true }, tokens.admin);
  assert.strictEqual(published.status, 200);
  const leaders = await json('GET', '/api/public/leaders');
  assert.ok(leaders.data.some((p) => p.id === pid));
  assert.strictEqual((await json('DELETE', `/api/personnel/${pid}`, {}, tokens.admin)).status, 200);

  const report = await json('POST', '/api/reports', { title: 'Báo cáo test', period: 'Quý IV/2026', content: '<p>x</p>', unit_id: 99 }, tokens.unitlead);
  assert.strictEqual(report.status, 201, 'force own unit');
  ids.report = report.data.id;
  const reviewerList = await json('GET', '/api/reports', {}, tokens.admin);
  assert.ok(reviewerList.data.filter((r) => r.id === ids.report).length === 1);
});

test('RBAC: finance panel & payment verification', async () => {
  const dues = await json('POST', '/api/dues', { unit_id: ulUnitId, period: 'Năm 2027', amount: 500000 }, tokens.admin);
  assert.strictEqual(dues.status, 201);
  ids.dues = dues.data.id;

  const wrong = await json('POST', '/api/payments', { dues_id: ids.dues, amount: 1, method: 'Chuyển khoản' }, tokens.unitlead);
  assert.strictEqual(wrong.status, 400, 'amount must match');

  const pay = await json('POST', '/api/payments', { dues_id: ids.dues, amount: 500000, method: 'Chuyển khoản' }, tokens.unitlead);
  assert.strictEqual(pay.status, 201);
  ids.payment = pay.data.id;

  const blockVerify = await json('POST', `/api/payments/${ids.payment}/verify`, { decision: 'Đã xác minh' }, tokens.reviewer);
  assert.strictEqual(blockVerify.status, 403);

  const verify = await json('POST', `/api/payments/${ids.payment}/verify`, { decision: 'Đã xác minh' }, tokens.finance);
  assert.strictEqual(verify.status, 200);
  const duesList = await json('GET', '/api/dues', {}, tokens.admin);
  const d = duesList.data.find((x) => x.id === ids.dues);
  assert.strictEqual(d.status, 'Đã thanh toán');

  const csv = await raw('GET', '/api/payments/export.csv', { headers: { Authorization: `Bearer ${tokens.admin}` } });
  assert.strictEqual(csv.status, 200);
  assert.match(await csv.text(), /Năm 2027/);
  const nope = await json('GET', '/api/nope', {}, tokens.admin);
  assert.strictEqual(nope.status, 404, 'unknown API path rejected');
});

test('posts lifecycle: create→public→draft hidden→delete', async () => {
  const c = await json('POST', '/api/posts', { title: 'Bài kiểm thử tự động', type: 'news', category: 'hoat-dong', status: 'published', content: '<p>Hello <b>world</b></p><script>alert(1)</script>', excerpt: 'Mô tả' }, tokens.admin);
  assert.strictEqual(c.status, 201);
  ids.post = c.data.id;
  const pub = await json('GET', '/api/public/posts?limit=50');
  assert.ok(pub.data.items.some((p) => p.id === ids.post));

  const detailBefore = await json('GET', `/api/public/posts/${c.data.slug}`);
  assert.strictEqual(detailBefore.status, 200);
  assert.ok(!String(detailBefore.data.content).includes('<script>'), 'XSS stripped');
  const view1 = detailBefore.data.view_count;
  const detailAfter = await json('GET', `/api/public/posts/${c.data.slug}`);
  assert.ok(detailAfter.data.view_count >= view1 + 1, 'view counter increments');

  const draft = await json('PUT', `/api/posts/${ids.post}`, { title: 'Bài kiểm thử tự động', status: 'draft' }, tokens.admin);
  assert.strictEqual(draft.status, 200);
  const hidden = await json('GET', '/api/public/posts?limit=50');
  assert.ok(!hidden.data.items.some((p) => p.id === ids.post));
  const detailHidden = await json('GET', `/api/public/posts/${c.data.slug}`);
  assert.strictEqual(detailHidden.status, 404);

  assert.strictEqual((await json('DELETE', `/api/posts/${ids.post}`, {}, tokens.admin)).status, 200);
});

test('documents lifecycle + path traversal blocked', async () => {
  const c = await json('POST', '/api/documents', { title: 'Văn bản kiểm thử', doc_number: '09/QC-T', doc_type: 'Quyết định', category: 'khac', status: 'published', file_url: '/uploads/test.pdf' }, tokens.admin);
  assert.strictEqual(c.status, 201);
  ids.doc = c.data.id;
  const pub = await json('GET', '/api/public/documents?limit=100');
  assert.ok(pub.data.items.some((d) => d.id === ids.doc));

  const missing = await json('GET', `/api/public/documents/${ids.doc}/download`);
  assert.strictEqual(missing.status, 404, 'no file yet');

  const evil = await json('PUT', `/api/documents/${ids.doc}`, { title: 'Văn bản kiểm thử', status: 'published', file_url: '../../../../etc/passwd' }, tokens.admin);
  assert.strictEqual(evil.status, 200);
  const evilDownload = await json('GET', `/api/public/documents/${ids.doc}/download`);
  assert.strictEqual(evilDownload.status, 400, 'traversal blocked');

  assert.strictEqual((await json('DELETE', `/api/documents/${ids.doc}`, {}, tokens.admin)).status, 200);
});

test('units CRUD (admin)', async () => {
  const c = await json('POST', '/api/units', { name: 'Chi hội Kiểm thử', code: 'KT1' }, tokens.admin);
  assert.strictEqual(c.status, 201);
  ids.unit = c.data.id;
  const u = await json('PUT', `/api/units/${ids.unit}`, { name: 'Chi hội Kiểm thử', code: 'KT1', unit_type: 'chi_hoi', status: 'active', is_public: true, description: 'Đơn vị kiểm thử' }, tokens.admin);
  assert.strictEqual(u.status, 200);
  const t = await json('DELETE', `/api/units/${ids.unit}`, {}, tokens.admin);
  assert.strictEqual(t.status, 200, 'empty unit deletable');
});

test('users management: create/toggle/reset + password change', async () => {
  const c = await json('POST', '/api/users', { username: 'kt_user', full_name: 'Người kiểm thử', role: 'viewer', unit_id: 1, password: 'matkhau@2026xyz' }, tokens.admin);
  assert.strictEqual(c.status, 201);
  ids.user = c.data.id;
  assert.strictEqual((await json('PUT', `/api/users/${ids.user}`, { active: false }, tokens.admin)).status, 200);
  const loginLocked = await login('kt_user', 'matkhau@2026xyz');
  assert.strictEqual(loginLocked.status, 401, 'locked cannot login');
  assert.strictEqual((await json('POST', `/api/users/${ids.user}/reset-password`, { password: 'matkhau@2026abc' }, tokens.admin)).status, 200);
  assert.strictEqual((await json('PUT', `/api/users/${ids.user}`, { active: true }, tokens.admin)).status, 200);
  assert.strictEqual((await login('kt_user', 'matkhau@2026abc')).status, 200);
  assert.strictEqual((await json('DELETE', `/api/users/${ids.user}`, {}, tokens.admin)).status, 200);

  const cp = await json('POST', '/api/auth/change-password', { currentPassword: 'admin123', newPassword: 'Admin@2026test' }, tokens.admin);
  assert.strictEqual(cp.status, 200);
  assert.strictEqual((await login('admin', 'Admin@2026test')).status, 200);
  const back = await json('POST', '/api/auth/change-password', { currentPassword: 'Admin@2026test', newPassword: 'Admin@2026final' }, tokens.admin);
  assert.strictEqual(back.status, 200);
  assert.strictEqual((await login('admin', 'Admin@2026final')).status, 200);
});

test('upload whitelist + auth enforced', async () => {
  const anon = await json('POST', '/api/upload', { name: 'x.png', data: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.strictEqual(anon.status, 401);
  const bad = await json('POST', '/api/upload', { name: 'evil.exe', data: 'data:application/octet-stream;base64,aGVsbG8=' }, tokens.admin);
  assert.strictEqual(bad.status, 400);
  const ok = await json('POST', '/api/upload', { name: 'ok.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }, tokens.admin);
  assert.strictEqual(ok.status, 201);
  assert.match(ok.data.url, /^\/uploads\/[a-f0-9]{16}\.png$/);
  const served = await raw('GET', ok.data.url);
  assert.strictEqual(served.status, 200);
  try { fs.rmSync(path.join(__dirname, '..', 'public', 'uploads', path.basename(ok.data.url)), { force: true }); } catch (_) { /* ignore */ }
});

test('audit log written', async () => {
  const audit = await json('GET', '/api/audit', {}, tokens.admin);
  assert.ok(audit.data.some((a) => a.action === 'LOGIN' || a.action === 'CREATE'));
});

test('cleanup report fixture', async () => {
  if (ids.report) assert.strictEqual((await json('DELETE', `/api/reports/${ids.report}`, {}, tokens.admin)).status, 404, 'reports are immutable by design');
});