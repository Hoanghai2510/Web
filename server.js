require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { notFoundApi, errorHandler } = require('./middleware');

const devSecret = 'DEV_ONLY_CHANGE_THIS_SECRET_BEFORE_DEPLOYMENT';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === devSecret)) {
  console.error('FATAL: production requires JWT_SECRET. Set a strong secret in .env before starting.');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const PUBLIC_DIR = path.join(__dirname, 'public', 'site');
const ADMIN_DIR = path.join(__dirname, 'public', 'admin');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

app.use(express.json({ limit: '16mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false }));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const { db } = require('./db');
  const origin = `${req.protocol}://${req.get('host')}`;
  const pages = ['/', '/gioi-thieu', '/tin-tuc', '/van-ban', '/to-chuc', '/nhan-su', '/tai-chinh', '/bao-cao', '/lien-he', '/tim-kiem']
    .map((p) => `<url><loc>${origin}${p}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  const items = (table) => db.prepare(`SELECT slug FROM ${table} WHERE status='published' ORDER BY id DESC LIMIT 500`).all();
  pages.push(...items('posts').map((r) => `<url><loc>${origin}/tin-tuc/${r.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`));
  pages.push(...items('documents').map((r) => `<url><loc>${origin}/van-ban/${r.slug}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`));
  for (const u of db.prepare("SELECT slug FROM units WHERE is_public=1").all()) pages.push(`<url><loc>${origin}/to-chuc/${u.slug}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.join('\n')}\n</urlset>`);
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use('/admin', express.static(ADMIN_DIR, { index: false, fallthrough: true }));
app.use('/admin', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/public', require('./routes/public'));
app.use('/api', require('./routes/admin'));

app.use('/api', notFoundApi);
app.use((req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`Hoi portal running at http://${process.env.HOST || '0.0.0.0'}:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Development mode: set NODE_ENV=production + JWT_SECRET before deployment. Demo accounts are disabled unless ALLOW_DEMO=1.');
    }
  });
}

module.exports = app;