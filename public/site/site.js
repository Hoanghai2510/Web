/* Website công khai Hội GDCSSKCĐ VN — SPA router */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const app = $('#app');
const API = '/api/public';

const state = { settings: {}, meta: {} };

const NAV = [
  { path: '/', label: 'Trang chủ' },
  { path: '/gioi-thieu', label: 'Giới thiệu Hội', num: '01' },
  { path: '/tin-tuc', label: 'Tin tức – Sự kiện', num: '02' },
  { path: '/to-chuc', label: 'Hệ thống tổ chức', num: '03' },
  { path: '/nhan-su', label: 'Nhân sự – Hội viên', num: '04' },
  { path: '/van-ban', label: 'Văn bản – Biểu mẫu', num: '05' },
  { path: '/tai-chinh', label: 'Tài chính – Hội phí', num: '06' },
  { path: '/bao-cao', label: 'Báo cáo nội bộ', num: '07' },
  { path: '/lien-he', label: 'Liên hệ', num: '08' }
];

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => String(name || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const money = (n) => new Intl.NumberFormat('vi-VN').format(Number(n || 0));
const fmtDate = (d) => { if (!d) return ''; const dt = new Date(String(d).replace(' ', 'T')); return isNaN(dt) ? '' : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt); };
const fmtDateFull = (d) => { if (!d) return ''; const dt = new Date(String(d).replace(' ', 'T')); return isNaN(dt) ? '' : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' }).format(dt); };

function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.background = isError ? '#b23c46' : '#0d3b66';
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

async function getJSON(path) {
  const res = await fetch(API + path);
  if (!res.ok) {
    let msg = 'Không thể tải dữ liệu. Vui lòng thử lại.';
    try { const d = await res.json(); if (d && d.error) msg = d.error; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

const padColor = ['#1769df,#0e4a9a', '#0e9f95,#0a6f68', '#7c5cd6,#4e33a0', '#e0863a,#b3561a', '#bf4a54,#8c2630', '#2f83f6,#134b91'];
function coverStyle(item) {
  if (item && item.cover_image) return `background-image:url(${esc(item.cover_image)})`;
  const key = String((item && (item.slug || item.id)) || '');
  let h = 0; for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const g = padColor[h % padColor.length];
  return `background-image:radial-gradient(circle at 30% 20%,rgba(255,255,255,.18),transparent 45%),linear-gradient(140deg,${g})`;
}

const loadingHTML = () => `<div class="loading"><div class="skeleton wide"></div><div class="skeleton wide"></div><div class="skeleton wide"></div><div class="skeleton wide"></div></div>`;
const emptyHTML = (icon, text) => `<div class="empty"><span class="big">${icon}</span>${esc(text)}</div>`;

function crumbHTML(parts) {
  const items = parts.map((p, i) => i === 0
    ? `<span>${esc(p)}</span>`
    : `<a href="/">Trang chủ</a><span>/</span><span>${esc(p)}</span>`).join('');
  return `<nav class="crumb">${items}</nav>`;
}

function pageHeadHTML(eyebrow, title, lead) {
  return `<div class="section-head">
    <div><span class="eyebrow">${esc(eyebrow)}</span><h2 style="margin-top:10px">${title}</h2>${lead ? `<p>${lead}</p>` : ''}</div>
  </div>`;
}

function postCardHTML(p) {
  const isEvent = p.type === 'event';
  const label = p.category_label || p.category || (isEvent ? 'Sự kiện' : 'Tin tức');
  const href = `/tin-tuc/${esc(p.slug)}`;
  return `<article class="card post-card">
    <a href="${href}" class="post-cover" style="${coverStyle(p)}" aria-hidden="true"><span class="cover-chip">${esc(label)}</span></a>
    <div class="post-body">
      <div class="meta">
        ${isEvent ? `<span class="event-badge">SỰ KIỆN</span>` : ''}
        <span>${esc(p.author || 'Ban Biên tập')}</span>
        <span>${fmtDate(p.event_date || p.published_at)}</span>
      </div>
      <h3><a href="${href}">${esc(p.title)}</a></h3>
      ${p.excerpt ? `<p class="excerpt">${esc(p.excerpt)}</p>` : ''}
      ${isEvent && p.event_location ? `<span class="event-badge schedule">📍 ${esc(p.event_location)}</span>` : ''}
      <a class="more" href="${href}">Xem chi tiết →</a>
    </div>
  </article>`;
}

function docRowHTML(d) {
  return `<a class="doc-row" href="/van-ban/${esc(d.slug)}">
    <span class="doc-ico">${esc(d.doc_type ? d.doc_type.toUpperCase().slice(0, 3) : 'PDF')}</span>
    <span><b>${esc(d.title)}</b>
      <small>${[d.doc_number, d.issuer, d.issued_at ? fmtDate(d.issued_at) : ''].filter(Boolean).join(' · ')}</small></span>
  </a>`;
}

function unitCardHTML(u) {
  return `<div class="org-card" data-go="${esc(u.slug)}">
    <span class="type-tag">${esc(u.unit_type_label || u.unit_type)}</span>
    <b>${esc(u.name)}</b>
    ${u.description ? `<p>${esc(u.description)}</p>` : ''}
    ${u.head_name ? `<div class="lead">◈ Người đứng đầu: <b>${esc(u.head_name)}</b></div>` : ''}
  </div>`;
}

function personCardHTML(p) {
  return `<a class="person-card" href="/nhan-su/${esc(p.slug)}">
    <span class="avatar-lg">${esc(initials(p.full_name))}</span>
    <b>${esc(p.full_name)}</b>
    <div class="role">${esc(p.position || p.title || 'Hội viên')}</div>
    <div class="meta">${esc(p.unit_name || '')}${p.term ? ` · Nhiệm kỳ ${esc(p.term)}` : ''}</div>
  </a>`;
}

function eventsListHTML(list) {
  if (!list.length) return emptyHTML('🗓', 'Chưa có sự kiện nào được đăng tải.');
  return `<div class="grid cols-2">
    ${list.map((e) => `<article class="card" style="display:flex;gap:14px;align-items:center">
      <div style="text-align:center;flex-shrink:0;background:#eef5ff;border-radius:12px;padding:10px 12px">
        <b style="color:var(--blue);font-size:20px">${e.event_date ? fmtDate(e.event_date).slice(0, 2) : '––'}</b>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px">${e.event_date ? new Intl.DateTimeFormat('vi-VN', { month: 'short' }).format(new Date(e.event_date.replace(' ', 'T'))) : ''}</div>
      </div>
      <div>
        <h3 style="font-size:14.5px"><a href="/tin-tuc/${esc(e.slug)}">${esc(e.title)}</a></h3>
        <div class="meta" style="color:var(--muted);font-size:11.5px;margin-top:6px">
          ${e.event_location ? `📍 ${esc(e.event_location)}` : ''}${e.author ? ` · ${esc(e.author)}` : ''}
        </div>
      </div>
    </article>`).join('')}
  </div>`;
}

function paginationHTML(page, pages, base) {
  if (pages <= 1) return '';
  let html = `<div class="pager">`;
  const link = (p, label, cls = '') => `<button class="${p === page ? 'on' : ''} ${cls}" data-pg="${p}">${label}</button>`;
  if (page > 1) html += link(page - 1, '‹');
  const from = Math.max(1, page - 2), to = Math.min(pages, page + 2);
  if (from > 1) html += link(1, 1);
  for (let p = from; p <= to; p += 1) html += link(p, p);
  if (to < pages) html += link(pages, pages);
  if (page < pages) html += link(page + 1, '›');
  return html + '</div>';
}

/* ---------- navigation ---------- */
function isActive(path) {
  const cur = location.pathname;
  if (path === '/') return cur === '/';
  return cur === path || cur.startsWith(path + '/');
}

function renderNav() {
  const desktop = NAV.map((n) => `<a href="${n.path}" class="${isActive(n.path) ? 'on' : ''}">${esc(n.label)}</a>`).join('');
  $('#mainNav').innerHTML = desktop +
    `<button class="search-icon" id="searchOpen" aria-label="Tìm kiếm">⌕</button>
     <a class="login" href="/admin">Cổng quản trị ↗</a>`;
  $('#drawerNav').innerHTML = NAV.map((n) => `<a href="${n.path}" class="${isActive(n.path) ? 'on' : ''}"><span>${esc(n.label)}</span>${n.num ? `<i>${n.num}</i>` : ''}</a>`).join('') +
    `<a class="login" href="/admin">Đăng nhập cổng quản trị →</a>`;
}

/* ---------- core views ---------- */
async function renderHome() {
  const s = state.settings;
  const [home, leaders] = await Promise.all([getJSON('/home'), getJSON('/leaders')]);
  const news = home.latest.filter((p) => p.type === 'news').slice(0, 6);
  const events = home.events;
  document.title = `${state.settings.site_name || 'Hội GDCSSKCĐ VN'} — Trang chủ`;
  app.innerHTML = `
    <section class="hero">
      <div class="container hero-inner">
        <div>
          <span class="eyebrow">KẾT NỐI · PHỤNG SỰ · PHÁT TRIỂN</span>
          <h1>${esc(s.hero_title || 'Chung tay vì một cộng đồng khỏe mạnh').replace(/\n/g, '<br>')}</h1>
          <p>${esc(s.hero_text || '')}</p>
          <div class="hero-actions">
            <a class="btn" href="/gioi-thieu">Tìm hiểu về Hội →</a>
            <a class="btn ghost" href="/tin-tuc">Khám phá hoạt động</a>
          </div>
        </div>
        <div class="hero-visual">
          <div style="position:relative;z-index:1;margin-bottom:20px">
            <p class="v-eyebrow">SỨ MỆNH</p>
            <h2>Giáo dục sức khỏe.<br>Chăm sóc cộng đồng.</h2>
            <p>Nơi kết nối chuyên gia, cán bộ, hội viên và tình nguyện viên cùng hướng tới một Việt Nam khỏe mạnh.</p>
          </div>
          <div class="hero-stats">
            <div><b>${home.stats.units}</b><small>Đơn vị trực thuộc</small></div>
            <div><b>${home.stats.news}</b><small>Tin & sự kiện</small></div>
            <div><b>${home.stats.documents}</b><small>Văn bản công khai</small></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="hero-grid">
          <div class="stat-tile"><span class="ico">✚</span><div><b>${home.stats.units}</b><small>đơn vị trong hệ thống</small></div></div>
          <div class="stat-tile"><span class="ico">◈</span><div><b>${leaders.length}</b><small>lãnh đạo công khai</small></div></div>
          <div class="stat-tile"><span class="ico">▤</span><div><b>${home.stats.documents}</b><small>văn bản, quy định</small></div></div>
          <div class="stat-tile"><span class="ico">↔</span><div><b>${home.stats.news}</b><small>bài viết, sự kiện</small></div></div>
        </div>
      </div>
    </section>

    <section class="section tint">
      <div class="container">
        <div class="section-head">
          <div><span class="eyebrow">VỀ CHÚNG TÔI</span><h2 style="margin-top:10px">${esc(s.about_title || 'Giới thiệu Hội')}</h2>
          <p>${esc(s.about_text || '')}</p></div>
          <a class="head-link" href="/gioi-thieu">Xem đầy đủ →</a>
        </div>
        <div class="grid">
          <article class="card"><h3 style="font-size:16px">📕 ${esc(s.about_title || 'Giới thiệu chung')}</h3>
            <p class="muted" style="font-size:13px">Hoạt động vì mục tiêu giáo dục, chăm sóc và nâng cao sức khỏe cộng đồng trên toàn quốc.</p>
            <a class="more" href="/gioi-thieu" style="font-size:12.5px;font-weight:700;color:var(--blue)">Xem thêm →</a></article>
          <article class="card"><h3 style="font-size:16px">👥 Ban lãnh đạo</h3>
            <p class="muted" style="font-size:13px">Ban Chấp hành, Ban Thường vụ và lãnh đạo các đơn vị trực thuộc.</p>
            <a class="more" href="/nhan-su" style="font-size:12.5px;font-weight:700;color:var(--blue)">Danh sách nhân sự →</a></article>
          <article class="card"><h3 style="font-size:16px">📜 Văn bản nền tảng</h3>
            <p class="muted" style="font-size:13px">Điều lệ, quyết định thành lập, quy chế tổ chức và biểu mẫu.</p>
            <a class="more" href="/van-ban" style="font-size:12.5px;font-weight:700;color:var(--blue)">Thư viện văn bản →</a></article>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div><span class="eyebrow">TIN TỨC & SỰ KIỆN</span><h2 style="margin-top:10px">Tin hoạt động mới</h2></div>
          <a class="head-link" href="/tin-tuc">Xem tất cả tin →</a>
        </div>
        ${news.length ? `<div class="grid">${news.map(postCardHTML).join('')}</div>` : emptyHTML('📰', 'Chưa có tin tức nào được xuất bản.')}
      </div>
    </section>

    <section class="section tint">
      <div class="container">
        <div class="section-head">
          <div><span class="eyebrow">LỊCH HOẠT ĐỘNG</span><h2 style="margin-top:10px">Sự kiện nổi bật</h2></div>
          <a class="head-link" href="/tin-tuc?type=event">Xem lịch sự kiện →</a>
        </div>
        ${eventsListHTML(events)}
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div><span class="eyebrow">THƯ VIỆN VĂN BẢN</span><h2 style="margin-top:10px">Văn bản, quy định mới</h2></div>
          <a class="head-link" href="/van-ban">Toàn bộ văn bản →</a>
        </div>
        ${home.documents && home.documents.length
          ? `<div class="card">${home.documents.map(docRowHTML).join('')}</div>`
          : emptyHTML('📚', 'Chưa có văn bản nào được công bố.')}
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div><span class="eyebrow">HỆ THỐNG HỘI</span><h2 style="margin-top:10px">Liên kết nhanh</h2></div>
        </div>
        <div class="grid cols-4">
          <a class="card" href="/to-chuc" style="text-align:center;padding:26px 16px"><div style="font-size:30px">🏛</div><b style="display:block;margin:8px 0 4px">Hệ thống tổ chức</b><span class="muted" style="font-size:12px">Đơn vị trực thuộc</span></a>
          <a class="card" href="/nhan-su" style="text-align:center;padding:26px 16px"><div style="font-size:30px">👥</div><b style="display:block;margin:8px 0 4px">Nhân sự – Hội viên</b><span class="muted" style="font-size:12px">Lãnh đạo, thủ tục</span></a>
          <a class="card" href="/tai-chinh" style="text-align:center;padding:26px 16px"><div style="font-size:30px">💳</div><b style="display:block;margin:8px 0 4px">Tài chính – Hội phí</b><span class="muted" style="font-size:12px">Quy định & hướng dẫn</span></a>
          <a class="card" href="/bao-cao" style="text-align:center;padding:26px 16px"><div style="font-size:30px">📤</div><b style="display:block;margin:8px 0 4px">Báo cáo trực tuyến</b><span class="muted" style="font-size:12px">Đơn vị nộp báo cáo</span></a>
        </div>
      </div>
    </section>

    <section class="container">
      <div class="cta">
        <div><h2>Cổng quản trị dành cho các đơn vị</h2>
        <p>Đăng nhập để cập nhật dữ liệu tổ chức, nhân sự, báo cáo và hội phí theo đúng quyền được cấp.</p></div>
        <a class="btn" href="/admin">Đăng nhập cổng quản trị →</a>
      </div>
    </section>`;
}

async function renderGioiThieu() {
  document.title = 'Giới thiệu Hội | Hội GDCSSKCĐ VN';
  const s = state.settings;
  const [docs, leaders] = await Promise.all([getJSON('/documents?category=gioi-thieu'), getJSON('/leaders')]);
  const bch = leaders.filter((l) => l.group_role === 'bch');
  const bttv = leaders.filter((l) => l.group_role === 'bttv');
  app.innerHTML = `
    <section class="hero">
      <div class="container hero-inner">
        <div>
          <span class="eyebrow">GIỚI THIỆU HỘI</span>
          <h1>${esc(s.about_title || 'Về Hội Giáo dục Chăm sóc Sức khỏe Cộng đồng Việt Nam')}</h1>
          <p>${esc(s.about_text || '')}</p>
          <div class="hero-actions">
            <a class="btn" href="#leaders">Ban lãnh đạo</a>
            <a class="btn ghost" href="/van-ban?category=gioi-thieu">Văn bản nền tảng</a>
          </div>
        </div>
        <div class="grid" style="grid-template-columns:1fr">
          <div class="card"><div style="font-size:30px">🕊</div><b style="font-size:15px">Sứ mệnh</b><p class="muted" style="font-size:13px;margin:7px 0 0">Giáo dục, tuyên truyền và nâng cao nhận thức về chăm sóc sức khỏe; kết nối, huy động nguồn lực vì sức khỏe cộng đồng.</p></div>
          <div class="card"><div style="font-size:30px">🎯</div><b style="font-size:15px">Mục tiêu</b><p class="muted" style="font-size:13px;margin:7px 0 0">Phát triển hệ thống hội viên, tổ chức các chương trình sức khỏe cộng đồng trên phạm vi toàn quốc.</p></div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${pageHeadHTML('VỀ CHÚNG TÔI', 'Giới thiệu chung', 'Thông tin khái quát về Hội, mục tiêu hoạt động và định hướng phát triển.')}
        <div class="grid" style="grid-template-columns:2fr 1fr">
          <div class="card"><div class="prose" style="font-size:14.5px;color:#2b4164">
            <p>${esc(s.about_text || '')}</p>
            <p>Hội hoạt động dựa trên nguyên tắc tự nguyện, đoàn kết, minh bạch và phục vụ lợi ích cộng đồng; quy tụ cán bộ, chuyên gia, người hành nghề trong lĩnh vực y tế, giáo dục sức khỏe và các tổ chức cùng chung mục tiêu.</p>
            <ul><li>Xây dựng mạng lưới tổ chức từ Trung ương đến các địa phương.</li>
            <li>Tổ chức nghiên cứu, đào tạo, tư vấn và truyền thông giáo dục sức khỏe.</li>
            <li>Phối hợp triển khai các chương trình thiện nguyện, chăm sóc sức khỏe nhân dân.</li></ul>
          </div></div>
          <div class="card">
            <b>Tóm tắt thông tin</b>
            ${[['Tên đầy đủ', s.site_name || '—'], ['Slogan', s.site_tagline || '—'], ['Trụ sở', s.address || '—'], ['Email', s.email || '—'], ['Điện thoại', s.phone || '—']]
              .map((r) => `<div style="padding:9px 0;border-bottom:1px solid var(--line)"><span style="font-size:11px;color:var(--muted);letter-spacing:.5px">${esc(r[0])}</span><div style="font-weight:600;font-size:13.5px;color:var(--navy)">${esc(r[1])}</div></div>`).join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="section tint" id="leaders">
      <div class="container">
        ${pageHeadHTML('BAN LÃNH ĐẠO', 'Lãnh đạo Hội', 'Danh sách công khai Ban Chấp hành, Ban Thường vụ và lãnh đạo đơn vị.')}
        ${renderGroups(bch, bttv)}
        <div style="margin-top:22px"><a class="btn ghost" href="/nhan-su">Xem toàn bộ nhân sự →</a></div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${pageHeadHTML('VĂN BẢN NỀN TẢNG', 'Điều lệ, quyết định thành lập', 'Các văn bản quan trọng của Hội được công bố công khai.')}
        ${docs.items.length ? `<div class="card">${docs.items.map(docRowHTML).join('')}</div>` : emptyHTML('📚', 'Văn bản nền tảng đang được Hội cập nhật.')}
        <div style="margin-top:18px"><a class="btn ghost small" href="/van-ban?category=gioi-thieu">Xem văn bản giới thiệu Hội →</a></div>
      </div>
    </section>`;
}

function renderGroups(...groupsOfLeaders) {
  if (!groupsOfLeaders.some((g) => g.length)) return emptyHTML('👥', 'Danh sách lãnh đạo công khai đang được cập nhật bởi quản trị viên.');
  let html = '';
  [['BAN CHẤP HÀNH TRUNG ƯƠNG', groupsOfLeaders[0]], ['BAN THƯỜNG VỤ', groupsOfLeaders[1]], ['LÃNH ĐẠO ĐƠN VỊ', []]].forEach(([label, list], i) => {
    if (!list.length) return;
    html += `<div class="group-head"><span></span>${label}<span></span></div>
      <div class="people-grid">${list.map((p) => `<div class="card person-card" style="text-align:left;display:flex;gap:14px;align-items:center">
          <span class="avatar-lg" style="margin:0">${esc(initials(p.full_name))}</span>
          <div><b style="font-size:14px">${esc(p.full_name)}</b>
          <div class="role" style="font-size:12px;color:var(--blue);font-weight:600">${esc(p.position || p.title || '')}</div>
          <div class="meta" style="font-size:11.5px;color:var(--muted)">${esc(p.unit_name || '')}${p.term ? ` · ${esc(p.term)}` : ''}</div></div>
        </div>`).join('')}</div>`;
  });
  return html;
}

async function renderTinTuc(params) {
  const qs = new URLSearchParams(params || location.search);
  const type = qs.get('type') || '';
  const category = qs.get('category') || '';
  const page = Number(qs.get('page') || 1);
  const meta = state.meta;
  const sub = (type === 'event') ? 'Sự kiện' : 'Tin tức';
  document.title = `${sub} | Hội GDCSSKCĐ VN`;
  app.innerHTML = `<section class="section tint">
    <div class="container">${pageHeadHTML('CHUYÊN MỤC 02', `${sub} – hoạt động Hội`, 'Chính sách y tế, hoạt động Hội, hội nghị, thiện nguyện, thể thao, văn nghệ và hoạt động đơn vị.')}
      <div class="flex wrap gap-8" style="margin:14px 0">
        ${[['', 'Tất cả'], ['news', 'Tin tức'], ['event', 'Sự kiện']].map(([t, lb]) => `<a class="chip ${type === t ? 'on' : ''}" href="/tin-tuc${t ? `?type=${t}` : ''}">${lb}</a>`).join('')}
        <span style="flex:1"></span>
        ${Object.entries(meta.post_categories || {}).map(([k, lb]) => `<a class="chip small ${category === k ? 'on' : ''}" href="/tin-tuc?${type ? `type=${type}&` : ''}category=${k}">${esc(lb)}</a>`).join('')}
      </div>
      <div id="tintucList">${loadingHTML()}</div>
      <div id="tintucPager"></div>
    </div></section>`;

  try {
    const listBox = $('#tintucList');
    listBox.innerHTML = loadingHTML();
    const res = await getJSON(`/posts?limit=9&page=${page}${type ? `&type=${type}` : ''}${category ? `&category=${category}` : ''}`);
    listBox.innerHTML = res.items.length
      ? `<div class="grid">${res.items.map(postCardHTML).join('')}</div>`
      : emptyHTML('📰', 'Chưa có nội dung phù hợp.');
    $('#tintucPager').innerHTML = paginationHTML(page, res.pages, '');
    $('#tintucList').querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => {
      const p = Number(b.dataset.pg);
      const u = new URLSearchParams(location.search); u.set('page', p);
      location.href = `/tin-tuc?${u.toString()}`;
    }));
  } catch (e) { $('#tintucList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function renderBaiViet(slug) {
  document.title = 'Bài viết | Hội GDCSSKCĐ VN';
  app.innerHTML = `<section class="section" style="background:#fff"><div class="container"><div class="article">${loadingHTML()}</div></div></section>`;
  try {
    const p = await getJSON('/posts/' + encodeURIComponent(slug));
    const isEvent = p.type === 'event';
    document.title = `${p.title} | Hội GDCSSKCĐ VN`;
    setDesc(p.excerpt);
    const cover = p.cover_image ? `<div class="cover" style="background-image:url(${esc(p.cover_image)})"></div>` : `<div class="cover" style="${coverStyle(p)}">✚</div>`;
    const eventBox = isEvent ? `<div class="card" style="display:flex;gap:16px;flex-wrap:wrap;margin:18px 0;align-items:center">
      <div style="display:grid;place-items:center;width:56px;height:56px;border-radius:14px;background:#eef5ff;color:var(--blue)">📅</div>
      <div><div class="muted" style="font-size:12px">THỜI GIAN · ĐỊA ĐIỂM</div><b style="font-size:14.5px">${fmtDateFull(p.event_date) || 'Đang cập nhật'}${p.event_location ? ` · ${esc(p.event_location)}` : ''}</b></div>
      ${p.attachment ? `<a class="btn small mint" href="${esc(p.attachment)}" download>Tải tài liệu ↓</a>` : ''}
    </div>` : '';
    app.innerHTML = `<section class="section" style="background:#fff;border-bottom:1px solid var(--line)">
      <div class="container"><div class="article">
        ${crumbHTML(['Tin bài'])}
        <div class="meta muted" style="margin-top:22px;display:flex;gap:14px;flex-wrap:wrap">
          <span>${isEvent ? '🗓 Sự kiện' : '📰 Tin tức'}</span>
          <span>✍ ${esc(p.author || 'Ban Biên tập')}</span>
          <span>🗓 ${fmtDate(p.published_at)}</span>
          <span>👁 ${p.view_count + 1} lượt xem</span>
        </div>
        <h1 style="margin-top:14px">${esc(p.title)}</h1>
        ${p.excerpt ? `<p class="muted" style="margin:12px 0;font-size:15px">${esc(p.excerpt)}</p>` : ''}
        ${cover}
        <div class="prose">${p.content || `<p>Nội dung bài viết đang được biên tập.</p>`}</div>
        ${eventBox}
        <div class="tag-list"><a class="chip" href="/tin-tuc?category=${esc(p.category)}">${esc(p.category_label || p.category)}</a><a class="chip" href="/tin-tuc">Xem tin tức</a></div>
      </div></div></section>
      ${p.related && p.related.length ? `<section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">LIÊN QUAN</span><h2 style="margin-top:10px">Bài viết cùng chuyên mục</h2></div></div>
        <div class="grid">${p.related.map(postCardHTML).join('')}</div></div></section>` : ''}`;
  } catch (e) {
    app.innerHTML = `<section class="section"><div class="container"><div class="empty">${esc(e.message)}<br><br><a class="btn small" href="/tin-tuc">← Quay lại danh sách</a></div></div></section>`;
  }
}

async function renderToChuc() {
  document.title = 'Hệ thống tổ chức | Hội GDCSSKCĐ VN';
  app.innerHTML = `<section class="section tint"><div class="container">
    ${pageHeadHTML('CHUYÊN MỤC 03', 'Hệ thống tổ chức của Hội', 'Trung ương Hội, ban chuyên môn, liên chi hội, chi hội, viện, trung tâm, văn phòng đại diện và doanh nghiệp hội viên.')}
    <div id="orgList">${loadingHTML()}</div>
  </div></section>`;
  try {
    const units = await getJSON('/units');
    const types = state.meta.unit_types || {};
    if (!units.length) { $('#orgList').innerHTML = emptyHTML('🏛', 'Chưa có dữ liệu tổ chức được công bố.'); return; }
    const groups = Object.entries(types);
    $('#orgList').innerHTML = groups.map(([key, label]) => {
      const list = units.filter((u) => u.unit_type === key);
      return list.length ? `<div class="group-head"><span></span>${esc(label)} (${list.length})<span></span></div>
        <div class="org-strip">${list.map(unitCardHTML).join('')}</div>` : '';
    }).join('');
    $('#orgList').querySelectorAll('.org-card[data-go]').forEach((el) => el.addEventListener('click', () => location.href = `/to-chuc/${el.dataset.go}`));
  } catch (e) { $('#orgList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function renderDonVi(slug) {
  document.title = 'Đơn vị | Hội GDCSSKCĐ VN';
  app.innerHTML = `<section class="section tint"><div class="container"><div class="card">${loadingHTML()}</div></div></section>`;
  try {
    const u = await getJSON('/units/' + encodeURIComponent(slug));
    document.title = `${u.name} | Hội GDCSSKCĐ VN`;
    setDesc(u.description);
    const info = [['Loại hình', u.unit_type_label], ['Mã đơn vị', u.code], ['Người đứng đầu', u.head_name], ['Ngày thành lập', u.founded_at ? fmtDate(u.founded_at) : '—'], ['Địa chỉ', u.address], ['Điện thoại', u.phone], ['Email', u.email], ['Trạng thái', u.status === 'active' ? 'Đang hoạt động' : 'Tạm ngừng']]
      .filter(([, v]) => v && v !== '—' && v !== '');
    app.innerHTML = `<section class="section tint"><div class="container">
      ${crumbHTML(['Hệ thống tổ chức'])}
      <div class="hero-grid" style="margin-top:22px;grid-template-columns:1.4fr 1fr">
        <div class="card">
          <span class="type-tag" style="font-size:10.5px;font-weight:800;color:var(--teal);letter-spacing:1.5px">${esc(u.unit_type_label)}</span>
          <h1 style="font-size:28px;margin:10px 0">${esc(u.name)}</h1>
          <p class="muted">${esc(u.description || 'Thông tin chi tiết đang được cập nhật.')}</p>
          <div class="flex wrap gap-12" style="margin-top:18px">
            ${u.website ? `<a class="btn small" href="https://${esc(u.website)}" target="_blank" rel="noopener">Trang đơn vị</a>` : ''}
            <a class="btn ghost small" href="/to-chuc">← Toàn bộ đơn vị</a>
          </div>
        </div>
        <div class="card">
          <b>Thông tin liên hệ</b>
          ${info.map(([k, v]) => `<div style="padding:9px 0;border-bottom:1px solid var(--line)"><span style="font-size:11px;color:var(--muted)">${esc(k)}</span><div style="font-weight:600;font-size:13px;color:var(--navy)">${esc(v)}</div></div>`).join('')}
        </div>
      </div>
      ${u.children && u.children.length ? `<div style="margin-top:26px">${pageHeadHTML('ĐƠN VỊ TRỰC THUỘC', 'Cấp dưới', '')}
        <div class="org-strip">${u.children.map(unitCardHTML).join('')}</div></div>` : ''}
      ${u.leaders && u.leaders.length ? `<div style="margin-top:26px">${pageHeadHTML('NHÂN SỰ', 'Lãnh đạo đơn vị', '')}
        <div class="people-grid">${u.leaders.map(personCardHTML).join('')}</div></div>` : ''}
    </div></section>`;
  } catch (e) {
    app.innerHTML = `<section class="section"><div class="container"><div class="empty">${esc(e.message)}<br><br><a class="btn small" href="/to-chuc">← Về mục tổ chức</a></div></div></section>`;
  }
}

async function renderNhanSu() {
  document.title = 'Nhân sự – Hội viên | Hội GDCSSKCĐ VN';
  app.innerHTML = `<section class="section tint"><div class="container">
    ${pageHeadHTML('CHUYÊN MỤC 04', 'Nhân sự và hội viên', 'BCH Trung ương, Ban Thường vụ, lãnh đạo đơn vị, thủ tục kết nạp và quy định bầu cử, bổ nhiệm.')}
    <div id="peopleList">${loadingHTML()}</div>
  </div></section>`;
  try {
    const [leaders, docs] = await Promise.all([getJSON('/leaders'), getJSON('/documents?category=nhan-su')]);
    const grouped = { bch: [], bttv: [], lanh_dao_don_vi: [] };
    leaders.forEach((p) => { (grouped[p.group_role] || grouped.lanh_dao_don_vi).push(p); });
    const labels = { bch: 'BAN CHẤP HÀNH TRUNG ƯƠNG', bttv: 'BAN THƯỜNG VỤ', lanh_dao_don_vi: 'LÃNH ĐẠO ĐƠN VỊ' };
    let html = Object.entries(labels).map(([k, lb]) => {
      if (!grouped[k].length) return '';
      return `<div class="group-head"><span></span>${lb}<span></span></div>
        <div class="people-grid">${grouped[k].map(personCardHTML).join('')}</div>`;
    }).join('');
    if (!html) html = emptyHTML('👥', 'Danh sách nhân sự công khai đang được cập nhật.');
    html += `<div style="margin-top:34px">${pageHeadHTML('QUY TRÌNH & VĂN BẢN', 'Thủ tục kết nạp, bầu cử và bổ nhiệm', 'Hướng dẫn kết nạp hội viên cá nhân, tập thể và quy định bầu cử, bổ nhiệm, miễn nhiệm.')}
      ${docs.items.length ? `<div class="card">${docs.items.map(docRowHTML).join('')}</div>` : emptyHTML('📄', 'Văn bản thủ tục đang được cập nhật.')}</div>`;
    $('#peopleList').innerHTML = html;
  } catch (e) { $('#peopleList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function renderCaNhan(slug) {
  document.title = 'Hồ sơ nhân sự | Hội GDCSSKCĐ VN';
  app.innerHTML = `<section class="section tint"><div class="container"><div class="card" style="max-width:720px;margin:0 auto">${loadingHTML()}</div></div></section>`;
  try {
    const p = await getJSON('/people/' + encodeURIComponent(slug));
    document.title = `${p.full_name} | Hội GDCSSKCĐ VN`;
    setDesc(p.bio || p.position || '');
    app.innerHTML = `<section class="section tint"><div class="container">
      ${crumbHTML(['Nhân sự – Hội viên'])}
      <div class="card" style="max-width:720px;margin:20px auto 0">
        <div style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
          <span class="avatar-lg" style="width:84px;height:84px;font-size:32px">${esc(initials(p.full_name))}</span>
          <div style="flex:1;min-width:240px">
            <h1 style="font-size:26px">${esc(p.full_name)}</h1>
            <div class="role" style="color:var(--blue);font-weight:700;margin-top:4px">${esc(p.position || p.title || 'Hội viên')}</div>
            <div class="meta muted" style="margin-top:8px">${esc(p.unit_name || '')} · ${esc(p.group_label || p.group_role || '')}${p.term ? ` · Nhiệm kỳ ${esc(p.term)}` : ''}</div>
            <div class="flex wrap gap-12" style="margin-top:14px">
              ${p.email ? `<a class="chip small" href="mailto:${esc(p.email)}">✉ ${esc(p.email)}</a>` : ''}
              ${p.phone ? `<span class="chip small">✆ ${esc(p.phone)}</span>` : ''}
            </div>
          </div>
        </div>
        ${p.bio ? `<div class="prose" style="margin-top:20px;font-size:14px">${p.bio}</div>` : ''}
      </div>
      <div style="text-align:center;margin-top:26px"><a class="btn ghost small" href="/nhan-su">← Danh sách nhân sự</a></div>
    </div></section>`;
  } catch (e) {
    app.innerHTML = `<section class="section"><div class="container"><div class="empty">${esc(e.message)}<br><br><a class="btn small" href="/nhan-su">← Về mục nhân sự</a></div></div></section>`;
  }
}

async function renderVanBan(params) {
  const qs = new URLSearchParams(params || location.search);
  const category = qs.get('category') || '';
  const doctype = qs.get('doctype') || '';
  document.title = 'Văn bản – Biểu mẫu | Hội GDCSSKCĐ VN';
  const meta = state.meta;
  app.innerHTML = `<section class="section tint"><div class="container">
    ${pageHeadHTML('CHUYÊN MỤC 05', 'Thư viện văn bản và biểu mẫu', 'Điều lệ, quyết định, quy chế tổ chức, nhân sự, tài chính và các biểu mẫu của Hội.')}
    <div class="flex wrap gap-8" style="margin:14px 0">
      <a class="chip ${!category ? 'on' : ''}" href="/van-ban">Tất cả nhóm</a>
      ${Object.entries(meta.document_categories || {}).map(([k, lb]) => `<a class="chip ${category === k ? 'on' : ''}" href="/van-ban?category=${k}">${esc(lb)}</a>`).join('')}
    </div>
    <div class="flex wrap gap-8" style="margin:0 0 14px">
      <a class="chip small ${!doctype ? 'on' : ''}" href="/van-ban${category ? `?category=${category}` : ''}">Mọi loại</a>
      ${(meta.document_types || []).map((t) => `<a class="chip small ${doctype === t ? 'on' : ''}" href="/van-ban?${category ? `category=${category}&` : ''}doctype=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
    </div>
    <div id="docList">${loadingHTML()}</div>
  </div></section>`;
  try {
    const q = [];
    if (category) q.push(`category=${category}`);
    if (doctype) q.push(`doctype=${encodeURIComponent(doctype)}`);
    const res = await getJSON('/documents' + (q.length ? '?' + q.join('&') : ''));
    $('#docList').innerHTML = res.items.length
      ? `<div class="card">${res.items.map(docRowHTML).join('')}</div>`
      : emptyHTML('📚', 'Không có văn bản nào trong chuyên mục này.');
  } catch (e) { $('#docList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function renderDocDetail(slug) {
  app.innerHTML = `<section class="section tint"><div class="container"><div class="card" style="max-width:760px;margin:0 auto"><span class="skeleton wide" style="height:120px;border-radius:12px;display:block"></span></div></div></section>`;
  try {
    const all = await getJSON('/documents');
    const d = all.items.find((x) => x.slug === slug);
    if (!d) throw new Error('Không tìm thấy văn bản');
    document.title = `${d.title} | Văn bản – Hội GDCSSKCĐ VN`;
    setDesc(d.summary);
    const info = [['Số ký hiệu', d.doc_number], ['Loại văn bản', d.doc_type], ['Cơ quan ban hành', d.issuer], ['Ngày ban hành', d.issued_at ? fmtDate(d.issued_at) : '—'], ['Lĩnh vực', d.category_label], ['Lượt tải', `${d.download_count} lượt`]].filter(([, v]) => v);
    app.innerHTML = `<section class="section tint"><div class="container">
      ${crumbHTML(['Văn bản – Biểu mẫu'])}
      <div class="card" style="max-width:760px;margin:20px auto 0">
        <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
          <span class="doc-ico" style="width:52px;height:62px;font-size:12px">${esc((d.doc_type || 'PDF').toUpperCase().slice(0, 3))}</span>
          <div style="flex:1;min-width:260px">
            <h1 style="font-size:22px">${esc(d.title)}</h1>
            <p class="muted" style="margin:8px 0 0">${esc(d.summary || '')}</p>
          </div>
        </div>
        <div class="tbl-wrap" style="margin-top:20px"><table><tbody>
          ${info.map(([k, v]) => `<tr><th style="width:170px">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="flex wrap gap-12" style="margin-top:20px">
          ${d.file_url ? `<a class="btn" href="/api/public/documents/${d.id}/download">Tải văn bản ↓</a>` : `<a class="btn ghost" href="/lien-he">Liên hệ để nhận văn bản</a>`}
          <a class="btn ghost" href="/van-ban">← Thư viện văn bản</a>
        </div>
      </div>
    </div></section>`;
  } catch (e) {
    app.innerHTML = `<section class="section"><div class="container"><div class="empty">${esc(e.message)}<br><br><a class="btn small" href="/van-ban">← Về thư viện văn bản</a></div></div></section>`;
  }
}

function renderTaiChinh() {
  document.title = 'Tài chính – Hội phí | Hội GDCSSKCĐ VN';
  const feeRows = [
    ['Hội phí cá nhân', 'Cá nhân hoạt động trong lĩnh vực y tế, giáo dục sức khỏe', 'Theo quy định hiện hành của Hội', 'Hằng năm'],
    ['Hội phí tập thể', 'Chi hội, liên chi hội, đơn vị trực thuộc', 'Theo quy mô và loại hình đơn vị', 'Hằng năm'],
    ['Phí thành lập đơn vị', 'Chi hội, liên chi hội, ban chuyên môn, viện/trung tâm mới', 'Theo quy định hiện hành của Hội', 'Một lần'],
    ['Đóng góp từ thiện', 'Cá nhân, tổ chức đồng hành cùng chương trình', 'Theo chương trình công bố', 'Khi đăng ký']
  ];
  app.innerHTML = `
    <section class="hero"><div class="container hero-inner" style="padding:44px 0">
      <div><span class="eyebrow">CHUYÊN MỤC 06</span>
        <h1>Quy định tài chính, hội phí</h1>
        <p>Các mức hội phí, phí thành lập, phương thức thanh toán và đóng góp từ thiện được công khai, minh bạch để các đơn vị và hội viên thực hiện.</p>
        <div class="hero-actions"><a class="btn" href="/van-ban?category=tai-chinh">Văn bản quy định →</a><a class="btn ghost" href="/lien-he">Liên hệ tài chính</a></div>
      </div>
      <div class="hero-visual" style="min-height:260px"><div style="position:relative;z-index:1"><p class="v-eyebrow">MINH BẠCH</p>
        <h2 style="font-size:26px">Nghĩa vụ hội phí<br>được theo dõi, đối soát</h2>
        <p>Việc thu, xác minh và đối soát giao dịch do bộ phận tài chính quản lý trên cổng nội bộ.</p></div>
        <div class="hero-stats"><div><b>${money(0)}</b><small>phụ thu phí trực tuyến</small></div></div></div>
    </div></section>

    <section class="section"><div class="container">
      ${pageHeadHTML('BIỂU PHÍ', 'Các khoản phí của Hội', 'Mức thu cụ thể theo văn bản quy định của Ban Thường vụ.')}
      <div class="tbl-wrap"><table>
        <thead><tr><th>Hạng mục</th><th>Đối tượng</th><th>Mức thu</th><th>Kỳ thu</th></tr></thead>
        <tbody>${feeRows.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted" style="font-size:12px;margin-top:10px">Lưu ý: Bảng thông tin trên mang tính hướng dẫn; mức thu chính thức căn cứ theo <a href="/van-ban?category=tai-chinh" style="color:var(--blue)">văn bản quy định</a> của Hội.</p>
    </div></section>

    <section class="section tint"><div class="container">
      ${pageHeadHTML('THANH TOÁN', 'Phương thức đóng phí', '')}
      <div class="grid">
        <div class="card"><div style="font-size:28px">🏦</div><h3 style="margin:10px 0 6px;font-size:16px">Chuyển khoản ngân hàng</h3><p class="muted" style="font-size:13px">Các đơn vị chuyển khoản theo tài khoản do Hội công bố chính thức và ghi rõ mã đơn vị, kỳ thu ở nội dung chuyển.</p></div>
        <div class="card"><div style="font-size:28px">🧾</div><h3 style="margin:10px 0 6px;font-size:16px">Xác minh và đối soát</h3><p class="muted" style="font-size:13px">Bộ phận tài chính đối chiếu mã giao dịch, số tiền với sao kê trước khi xác nhận đã thanh toán. Không dùng ảnh biên lai làm bằng chứng.</p></div>
        <div class="card"><div style="font-size:28px">♡</div><h3 style="margin:10px 0 6px;font-size:16px">Đóng góp từ thiện</h3><p class="muted" style="font-size:13px">Đóng góp được ghi nhận theo chương trình có công bố, kèm chứng từ và báo cáo thu – chi công khai.</p></div>
      </div>
    </div></section>`;
}

function renderBaoCao() {
  document.title = 'Báo cáo – Biểu mẫu nội bộ | Hội GDCSSKCĐ VN';
  const steps = [
    ['01', 'Cấp tài khoản', 'Mỗi đơn vị được cấp tài khoản tương ứng với phạm vi quản lý của mình.'],
    ['02', 'Soạn & nộp báo cáo', 'Nhập nội dung theo biểu mẫu hoặc đính kèm tệp, sau đó gửi lên cấp trên.'],
    ['03', 'Xem xét, phê duyệt', 'Người duyệt ghi nhận xét, duyệt hoặc yêu cầu bổ sung, trả về đơn vị.'],
    ['04', 'Theo dõi trạng thái', 'Đơn vị theo dõi tiến độ; hệ thống nhắc quá hạn và lưu lịch sử xử lý.']
  ];
  app.innerHTML = `
    <section class="hero"><div class="container hero-inner" style="padding:44px 0">
      <div><span class="eyebrow">CHUYÊN MỤC 07 · NỘI BỘ</span>
        <h1>Báo cáo trực tuyến</h1>
        <p>Khu vực này dành cho các đơn vị trực thuộc và cán bộ Hội. Sau khi đăng nhập vào cổng quản trị, đơn vị có thể soạn thảo, nộp báo cáo, tải biểu mẫu và theo dõi trạng thái duyệt.</p>
        <div class="hero-actions"><a class="btn" href="/admin">Đăng nhập cổng quản trị →</a><a class="btn ghost" href="/van-ban?category=bao-cao">Tải biểu mẫu</a></div>
      </div>
      <div class="hero-visual" style="min-height:260px"><p class="v-eyebrow">QUY TRÌNH</p>
        <h2 style="font-size:26px">Nộp, duyệt, trả lại,<br>xuất tổng hợp</h2>
        <p>Nhật ký thao tác lưu lại ai sửa dữ liệu, sửa gì và lúc nào để đối chiếu khi cần.</p>
      </div>
    </div></section>

    <section class="section"><div class="container">
      ${pageHeadHTML('QUY TRÌNH', 'Các bước nộp báo cáo', '')}
      <div class="grid cols-4">${steps.map(([n, t, d]) => `<div class="card"><b style="font-size:26px;color:var(--blue)">${n}</b><h3 style="margin:8px 0 6px;font-size:15px">${esc(t)}</h3><p class="muted" style="font-size:12.5px">${esc(d)}</p></div>`).join('')}</div>
    </div></section>

    <section class="section tint"><div class="container">
      ${pageHeadHTML('BIỂU MẪU NỘI BỘ', 'Tải biểu mẫu báo cáo', 'Biểu mẫu chuẩn của Hội dành cho chi hội và các đơn vị trực thuộc.')}
      <div data-docbox>${loadingHTML()}</div>
      <div style="margin-top:20px"><a class="btn" href="/admin">Vào cổng quản trị để nộp báo cáo →</a></div>
    </div></section>`;
  getJSON('/documents?category=bao-cao').then((res) => {
    const box = $('[data-docbox]');
    box.innerHTML = res.items.length ? `<div class="card">${res.items.map(docRowHTML).join('')}</div>` : emptyHTML('📄', 'Biểu mẫu đang được cập nhật.');
  }).catch((e) => { $('[data-docbox]').innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
}

function renderLienHe() {
  document.title = 'Liên hệ | Hội GDCSSKCĐ VN';
  const s = state.settings;
  const cards = [
    ['📍', 'Địa chỉ trụ sở', s.address || 'Đang cập nhật'],
    ['✉', 'Email liên hệ', s.email || 'Đang cập nhật'],
    ['✆', 'Điện thoại', s.phone || 'Đang cập nhật'],
    ['🕑', 'Giờ làm việc', s.hours || 'Thứ Hai – Thứ Sáu, 08:00 – 17:00']
  ];
  app.innerHTML = `
    <section class="section tint"><div class="container">
      ${pageHeadHTML('CHUYÊN MỤC 08', 'Liên hệ với Hội', 'Vui lòng sử dụng thông tin dưới đây để gửi thắc mắc, đề xuất hoặc làm việc với các bộ phận của Hội.')}
      <div class="grid cols-4" style="margin-bottom:26px">
        ${cards.map(([i, t, v]) => `<div class="card" style="text-align:center"><div style="font-size:30px">${i}</div><b style="display:block;margin:10px 0 4px">${esc(t)}</b><span class="muted" style="font-size:12.5px">${esc(v)}</span></div>`).join('')}
      </div>
      <div class="grid" style="grid-template-columns:1.2fr 1fr">
        <div class="card">
          <span class="eyebrow">GỬI LIÊN HỆ</span>
          <h2 style="font-size:21px;margin:10px 0 6px">Gửi phản hồi cho Hội</h2>
          <p class="muted">Mẫu này mở email của bạn với nội dung chuẩn bị sẵn để gửi tới Văn phòng Hội.</p>
          <form id="contactForm" class="form">
            <div class="field"><label for="cName">Họ và tên</label><input id="cName" required placeholder="Nguyễn Văn A"></div>
            <div class="field"><label for="cEmail">Email</label><input id="cEmail" type="email" required placeholder="ten@email.com"></div>
            <div class="field"><label for="cTopic">Chủ đề</label><select id="cTopic"><option>Thông tin về Hội</option><option>Kết nạp hội viên</option><option>Công tác tài chính, hội phí</option><option>Báo cáo của đơn vị</option><option>Khác</option></select></div>
            <div class="field"><label for="cMsg">Nội dung</label><textarea id="cMsg" required placeholder="Nhập nội dung phản hồi…"></textarea></div>
            <button class="btn" type="submit">Gửi liên hệ →</button>
          </form>
        </div>
        <div class="card" style="background:linear-gradient(150deg,#0d3b66,#1555a0);color:#eaf2ff;border:none">
          <h2 style="color:#fff;font-size:20px">Văn phòng Hội</h2>
          <p>Đơn vị trực thuộc ở địa phương vui lòng liên hệ theo đầu mối tại trang <a href="/to-chuc" style="color:#9fd4ff;text-decoration:underline">hệ thống tổ chức</a>.</p>
          <div style="background:#ffffff14;border-radius:12px;padding:16px;margin-top:14px">
            <div style="font-size:12px;letter-spacing:1.2px;color:#9fd4ff">MONG ĐỢI PHẢN HỒI TRONG</div>
            <b style="font-size:26px;color:#fff;display:block;margin-top:6px">3 ngày làm việc</b>
          </div>
        </div>
      </div>
    </div></section>`;

  $('#contactForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const subject = `[Liên hệ website] ${$('#cTopic').value} — ${$('#cName').value}`;
    const body = encodeURIComponent(`Họ tên: ${$('#cName').value}\nEmail: ${$('#cEmail').value}\n\n${$('#cMsg').value}`);
    const email = state.settings.email || '';
    if (email.includes('@')) window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${body}`;
    else toast('Chưa có email liên hệ chính thức.');
    toast('Đang chuyển tới ứng dụng email…');
  });
}

async function renderTimKiem(params) {
  const q = new URLSearchParams(params || location.search).get('q') || '';
  document.title = 'Tìm kiếm | Hội GDCSSKCĐ VN';
  app.innerHTML = `<section class="section tint"><div class="container">
    ${pageHeadHTML('TRA CỨU', 'Tìm kiếm thông tin công khai', `Tìm kiếm tin tức, sự kiện, văn bản, đơn vị và nhân sự của Hội.${q ? ` Từ khóa: “${esc(q)}”` : ''}`)}
    <form class="search-page-bar" id="searchBar">
      <span style="color:var(--muted)">⌕</span>
      <input type="search" name="q" value="${esc(q)}" placeholder="Nhập từ khóa cần tìm…" autocomplete="off">
      <button class="btn small" type="submit">Tìm kiếm</button>
    </form>
    <div id="searchResult">${q ? loadingHTML() : emptyHTML('⌕', 'Nhập từ khóa để bắt đầu tra cứu.')}</div>
  </div></section>`;
  $('#searchBar').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('#searchBar input[name=q]').value.trim();
    history.pushState(null, '', val ? `/tim-kiem?q=${encodeURIComponent(val)}` : '/tim-kiem');
    renderTimKiem();
  });
  if (!q) return;
  if (q.length < 2) { $('#searchResult').innerHTML = emptyHTML('✎', 'Từ khóa cần ít nhất 2 ký tự.'); return; }
  try {
    const r = await getJSON('/search?q=' + encodeURIComponent(q));
    const resultBox = $('#searchResult');
    const all = r.posts.length + r.documents.length + r.units.length + r.people.length;
    if (!all) { resultBox.innerHTML = emptyHTML('🔍', `Không tìm thấy kết quả cho “${esc(q)}”. Vui lòng thử từ khóa khác.`); return; }
    let html = `<p class="muted" style="font-size:13px">Tìm thấy <b>${all}</b> kết quả.</p>`;
    if (r.posts.length) html += `<div class="result-group-title">📰 Tin tức & sự kiện <span class="count">${r.posts.length}</span></div><div class="grid">${r.posts.map(postCardHTML).join('')}</div>`;
    if (r.documents.length) html += `<div class="result-group-title">📚 Văn bản <span class="count">${r.documents.length}</span></div><div class="card">${r.documents.map(docRowHTML).join('')}</div>`;
    if (r.units.length) html += `<div class="result-group-title">🏛 Đơn vị <span class="count">${r.units.length}</span></div><div class="org-strip">${r.units.map(unitCardHTML).join('')}</div>`;
    if (r.people.length) html += `<div class="result-group-title">👥 Nhân sự <span class="count">${r.people.length}</span></div><div class="people-grid">${r.people.map(personCardHTML).join('')}</div>`;
    resultBox.innerHTML = html;
    resultBox.querySelectorAll('.org-card[data-go]').forEach((el) => el.addEventListener('click', () => location.href = `/to-chuc/${el.dataset.go}`));
  } catch (e) { $('#searchResult').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function render404() {
  document.title = 'Không tìm thấy trang | Hội GDCSSKCĐ VN';
  app.innerHTML = `<section class="page404"><div class="code">404</div>
    <h1 style="font-size:22px">Trang bạn tìm không tồn tại</h1>
    <p class="muted">Đường dẫn có thể đã thay đổi hoặc bị xóa.</p>
    <div class="hero-actions" style="justify-content:center;gap:12px;margin-top:22px">
      <a class="btn" href="/">Về trang chủ</a><a class="btn ghost" href="/tim-kiem">Tìm kiếm thông tin</a>
    </div></section>`;
}

/* ---------- router ---------- */
function setDesc(v) {
  const el = document.querySelector('meta[name="description"]') || (() => { const m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); return m; })();
  el.content = String(v || '').slice(0, 160);
}

function applyMeta() {
  const title = document.title;
  const ogT = document.querySelector('meta[property="og:title"]');
  const ogD = document.querySelector('meta[property="og:description"]');
  const ogU = document.querySelector('meta[property="og:url"]');
  if (ogT) ogT.setAttribute('content', title);
  if (ogU) ogU.setAttribute('content', location.href);
  const desc = (document.querySelector('meta[name="description"]') || {}).content;
  if (ogD) ogD.setAttribute('content', desc || title);
}

function route() {
  window.scrollTo({ top: 0 });
  closeUI();
  renderNav();
  const path = location.pathname;
  const finish = (p) => { if (p && p.finally) p.finally(applyMeta); else applyMeta(); return p; };
  try {
    if (path === '/') return finish(renderHome().catch(showErr));
    let m;
    if (m = path.match(/^\/tin-tuc\/([a-z0-9-]+)\/?$/)) return finish(renderBaiViet(m[1]).catch(showErr));
    if (m = path.match(/^\/to-chuc\/([a-z0-9-]+)\/?$/)) return finish(renderDonVi(m[1]).catch(showErr));
    if (m = path.match(/^\/nhan-su\/([a-z0-9-]+)\/?$/)) return finish(renderCaNhan(m[1]).catch(showErr));
    if (m = path.match(/^\/van-ban\/([a-z0-9-]+)\/?$/)) return finish(renderDocDetail(m[1]).catch(showErr));
    if (path.startsWith('/tin-tuc')) return finish(renderTinTuc().catch(showErr));
    if (path.startsWith('/gioi-thieu')) return finish(renderGioiThieu().catch(showErr));
    if (path.startsWith('/to-chuc')) return finish(renderToChuc().catch(showErr));
    if (path.startsWith('/nhan-su')) return finish(renderNhanSu().catch(showErr));
    if (path.startsWith('/van-ban')) return finish(renderVanBan().catch(showErr));
    if (path.startsWith('/tai-chinh')) return finish(renderTaiChinh());
    if (path.startsWith('/bao-cao')) return finish(renderBaoCao());
    if (path.startsWith('/lien-he')) return finish(renderLienHe());
    if (path.startsWith('/tim-kiem')) return finish(renderTimKiem().catch(showErr));
    return finish(render404());
  } catch (e) { showErr(e); applyMeta(); }
}

function showErr(e) {
  app.innerHTML = `<section class="section"><div class="container"><div class="empty">⚠ ${esc(e.message)}<br><br><button class="btn small" onclick="location.reload()">Thử lại</button></div></div></section>`;
}

/* ---------- global UI ---------- */
function setSiteMeta() {
  const s = state.settings;
  $('#topbarSite').textContent = s.site_name || 'HỘI GDCSSKCĐ VN';
  $('#brandName').textContent = s.site_short || 'HỘI GDCSSKCĐ VN';
  $('#brandTag').textContent = (s.site_tagline || '').toUpperCase();
  $('#footerAbout').textContent = `${s.about_text || ''}`;
  document.title = `${s.site_name || 'Hội GDCSSKCĐ VN'} — Trang chủ`;
  $('#fAddr').textContent = s.address || '—';
  $('#fEmail').textContent = s.email || '—';
  $('#fPhone').textContent = s.phone || '—';
  $('#fHours').textContent = s.hours || '—';
  $('#fYear').textContent = new Date().getFullYear();
}

function closeUI() {
  $('#drawer').classList.remove('open');
  $('#backdrop').classList.remove('show');
  $('#searchOverlay').classList.remove('show');
}

function bindGlobal() {
  renderNav();
  $('#searchOpen').addEventListener('click', () => {
    $('#searchOverlay').classList.add('show');
    setTimeout(() => $('#searchInput').focus(), 60);
  });
  $('#searchOverlay .search-panel input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      closeUI();
      if (q) { history.pushState(null, '', `/tim-kiem?q=${encodeURIComponent(q)}`); route(); }
    }
  });
  $('#searchOverlay').addEventListener('click', (e) => { if (e.target.id === 'searchOverlay') closeUI(); });
  $('#hamburger').addEventListener('click', () => { $('#drawer').classList.add('open'); $('#backdrop').classList.add('show'); });
  $('#drawerClose').addEventListener('click', closeUI);
  $('#backdrop').addEventListener('click', closeUI);
  $('#drawerNav').addEventListener('click', closeUI);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUI(); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#') || href.includes('download')) return;
    if (href.startsWith('/admin')) return;
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    history.pushState(null, '', url.pathname + url.search);
    route();
  });
  window.addEventListener('popstate', route);
}

async function init() {
  try { const [settings, meta] = await Promise.all([getJSON('/settings'), getJSON('/meta')]); state.settings = settings; state.meta = meta; } catch (_) { /* fallback defaults */ }
  setSiteMeta();
  bindGlobal();
  route();
}

init();