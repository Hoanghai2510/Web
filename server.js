require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'DEV_ONLY_CHANGE_THIS_SECRET_BEFORE_DEPLOYMENT';
const dbPath = path.resolve(process.env.DATABASE_PATH || './data/portal.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE, parent_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(parent_id) REFERENCES units(id));
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','reviewer','unit_lead','viewer','finance')), unit_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(unit_id) REFERENCES units(id));
CREATE TABLE IF NOT EXISTS personnel (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, title TEXT, email TEXT, phone TEXT, unit_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Đang hoạt động', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(unit_id) REFERENCES units(id));
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, period TEXT NOT NULL, content TEXT NOT NULL, unit_id INTEGER NOT NULL, created_by INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Nháp' CHECK(status IN ('Nháp','Chờ duyệt','Đã duyệt','Yêu cầu sửa')), reviewer_id INTEGER, review_note TEXT, submitted_at TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(unit_id) REFERENCES units(id), FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(reviewer_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS dues (id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER NOT NULL, period TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Chưa thanh toán', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(unit_id) REFERENCES units(id));
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, dues_id INTEGER NOT NULL, transaction_ref TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Chờ xác minh' CHECK(status IN ('Chờ xác minh','Đã xác minh','Không khớp','Thất bại')), provider_ref TEXT, note TEXT, created_by INTEGER NOT NULL, verified_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, verified_at TEXT, FOREIGN KEY(dues_id) REFERENCES dues(id), FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(verified_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, detail TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
`);

const unitCount = db.prepare('SELECT COUNT(*) n FROM units').get().n;
if (!unitCount) {
  const addUnit = db.prepare('INSERT INTO units(name,code) VALUES(?,?)');
  addUnit.run('Văn phòng Hội', 'VP'); addUnit.run('Chi hội Hà Nội', 'HN'); addUnit.run('Chi hội Đà Nẵng', 'DN'); addUnit.run('Chi hội TP. Hồ Chí Minh', 'HCM');
}
const unitId = name => db.prepare('SELECT id FROM units WHERE name=?').get(name).id;
const userCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (!userCount) {
  const addUser = db.prepare('INSERT INTO users(username,password_hash,full_name,role,unit_id) VALUES(?,?,?,?,?)');
  addUser.run('admin', bcrypt.hashSync('admin123', 10), 'Quản trị hệ thống', 'admin', unitId('Văn phòng Hội'));
  addUser.run('reviewer', bcrypt.hashSync('review123', 10), 'Người duyệt báo cáo', 'reviewer', unitId('Văn phòng Hội'));
  addUser.run('unitlead', bcrypt.hashSync('unit123', 10), 'Trưởng Chi hội Hà Nội', 'unit_lead', unitId('Chi hội Hà Nội'));
  addUser.run('finance', bcrypt.hashSync('finance123', 10), 'Phụ trách tài chính', 'finance', unitId('Văn phòng Hội'));
}
if (db.prepare('SELECT COUNT(*) n FROM personnel').get().n === 0) {
  const ins = db.prepare('INSERT INTO personnel(full_name,title,email,phone,unit_id) VALUES(?,?,?,?,?)');
  ins.run('Nguyễn Minh Anh','Chủ tịch Chi hội','minhanh@example.org','09xx xxx 101',unitId('Chi hội Hà Nội'));
  ins.run('Trần Quốc Bảo','Phó chủ tịch','quocbao@example.org','09xx xxx 202',unitId('Chi hội Đà Nẵng'));
  ins.run('Lê Thu Hà','Ủy viên','thuha@example.org','09xx xxx 303',unitId('Chi hội TP. Hồ Chí Minh'));
}
if (db.prepare('SELECT COUNT(*) n FROM reports').get().n === 0) {
  const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  const leadId = db.prepare("SELECT id FROM users WHERE username='unitlead'").get().id;
  const ins = db.prepare('INSERT INTO reports(title,period,content,unit_id,created_by,status,submitted_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)');
  ins.run('Báo cáo hoạt động quý III','Quý III/2026','Tổng hợp hoạt động chuyên môn, truyền thông và công tác hội viên trong quý.',unitId('Chi hội Hà Nội'),leadId,'Chờ duyệt');
  ins.run('Báo cáo công tác tổ chức','Tháng 09/2026','Cập nhật thay đổi nhân sự, cơ cấu tổ chức và các hoạt động phối hợp.',unitId('Chi hội Đà Nẵng'),adminId,'Đã duyệt');
}
if (db.prepare('SELECT COUNT(*) n FROM dues').get().n === 0) {
  const ins = db.prepare('INSERT INTO dues(unit_id,period,amount,status) VALUES(?,?,?,?)');
  ins.run(unitId('Chi hội Hà Nội'),'Năm 2026',1200000,'Chưa thanh toán');
  ins.run(unitId('Chi hội Đà Nẵng'),'Năm 2026',1200000,'Chưa thanh toán');
  ins.run(unitId('Chi hội TP. Hồ Chí Minh'),'Năm 2026',1500000,'Chưa thanh toán');
}

function log(userId, action, entity, entityId='', detail='') {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?)').run(userId || null, action, entity, String(entityId), detail);
}
function auth(req,res,next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    if (!token) throw new Error('missing');
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id,username,full_name,role,unit_id,active FROM users WHERE id=?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({error:'Tài khoản không hoạt động'});
    req.user = user; next();
  } catch { return res.status(401).json({error:'Phiên đăng nhập không hợp lệ hoặc đã hết hạn'}); }
}
function roles(...allowed) { return (req,res,next) => allowed.includes(req.user.role) ? next() : res.status(403).json({error:'Bạn không có quyền thực hiện thao tác này'}); }
function scopedUnit(req, requested) {
  if (req.user.role === 'admin' || req.user.role === 'reviewer' || req.user.role === 'finance') return requested ? Number(requested) : null;
  return req.user.unit_id;
}
function personnelQuery(req) {
  if (['admin','reviewer'].includes(req.user.role)) return db.prepare(`SELECT p.id,p.full_name,p.title,p.email,p.phone,p.unit_id,p.status,p.created_at,u.name unit_name FROM personnel p JOIN units u ON u.id=p.unit_id ORDER BY p.id DESC`).all();
  return db.prepare(`SELECT p.id,p.full_name,p.title,p.email,p.phone,p.unit_id,p.status,p.created_at,u.name unit_name FROM personnel p JOIN units u ON u.id=p.unit_id WHERE p.unit_id=? ORDER BY p.id DESC`).all(req.user.unit_id);
}

app.get('/api/health', (req,res)=>res.json({ok:true,service:'hoi-portal-api',time:new Date().toISOString()}));
app.post('/api/auth/login', rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:true,legacyHeaders:false}), (req,res)=>{
  const {username,password}=req.body || {};
  if (!username || !password) return res.status(400).json({error:'Vui lòng nhập tài khoản và mật khẩu'});
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(String(username).trim());
  if (!user || !user.active || !bcrypt.compareSync(String(password),user.password_hash)) { log(null,'LOGIN_FAILED','user',username); return res.status(401).json({error:'Tài khoản hoặc mật khẩu không đúng'}); }
  const token = jwt.sign({id:user.id},JWT_SECRET,{expiresIn:'8h'});
  log(user.id,'LOGIN','user',user.id);
  res.json({token,user:{id:user.id,username:user.username,full_name:user.full_name,role:user.role,unit_id:user.unit_id}});
});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user,unit:db.prepare('SELECT name FROM units WHERE id=?').get(req.user.unit_id)?.name}));
app.post('/api/auth/change-password',auth,(req,res)=>{
  const {currentPassword,newPassword}=req.body||{};
  if (!currentPassword || typeof newPassword!=='string' || newPassword.length<10) return res.status(400).json({error:'Mật khẩu mới cần tối thiểu 10 ký tự'});
  const u=db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if(!bcrypt.compareSync(currentPassword,u.password_hash)) return res.status(400).json({error:'Mật khẩu hiện tại không đúng'});
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword,12),req.user.id); log(req.user.id,'CHANGE_PASSWORD','user',req.user.id); res.json({ok:true});
});

app.get('/api/dashboard',auth,(req,res)=>{
  const unitFilter = ['admin','reviewer','finance'].includes(req.user.role) ? '' : ' WHERE unit_id='+Number(req.user.unit_id);
  const units=db.prepare('SELECT COUNT(*) n FROM units').get().n;
  const people=db.prepare(`SELECT COUNT(*) n FROM personnel${unitFilter}`).get().n;
  const pending=db.prepare(`SELECT COUNT(*) n FROM reports WHERE status='Chờ duyệt'${req.user.role==='unit_lead' ? ' AND unit_id='+Number(req.user.unit_id):''}`).get().n;
  const unpaid=db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM dues WHERE status='Chưa thanh toán'${req.user.role==='unit_lead' ? ' AND unit_id='+Number(req.user.unit_id):''}`).get().n;
  const reports=db.prepare(`SELECT r.id,r.title,r.period,r.status,r.created_at,u.name unit_name,usr.full_name created_by_name FROM reports r JOIN units u ON u.id=r.unit_id JOIN users usr ON usr.id=r.created_by ${req.user.role==='unit_lead'?'WHERE r.unit_id=?':''} ORDER BY r.id DESC LIMIT 6`).all(...(req.user.role==='unit_lead'?[req.user.unit_id]:[]));
  res.json({stats:{units,people,pending,unpaid},reports});
});
app.get('/api/units',auth,(req,res)=>{
  const rows=db.prepare('SELECT u.id,u.name,u.code,u.parent_id,COUNT(p.id) people_count FROM units u LEFT JOIN personnel p ON p.unit_id=u.id GROUP BY u.id ORDER BY u.id').all();
  res.json(rows);
});
app.post('/api/units',auth,roles('admin'),(req,res)=>{
  const {name,code,parent_id}=req.body||{}; if(!name||!code) return res.status(400).json({error:'Tên đơn vị và mã đơn vị là bắt buộc'});
  try {const info=db.prepare('INSERT INTO units(name,code,parent_id) VALUES(?,?,?)').run(name.trim(),code.trim().toUpperCase(),parent_id||null);log(req.user.id,'CREATE','unit',info.lastInsertRowid,name);res.status(201).json({id:info.lastInsertRowid});} catch(e){res.status(409).json({error:'Tên hoặc mã đơn vị đã tồn tại'});}
});
app.get('/api/personnel',auth,(req,res)=>res.json(personnelQuery(req)));
app.post('/api/personnel',auth,roles('admin','unit_lead'),(req,res)=>{
  const {full_name,title,email,phone,unit_id}=req.body||{};
  if(!full_name||!unit_id) return res.status(400).json({error:'Họ tên và đơn vị là bắt buộc'});
  if(req.user.role==='unit_lead' && Number(unit_id)!==req.user.unit_id) return res.status(403).json({error:'Chỉ được quản lý nhân sự thuộc đơn vị của bạn'});
  const info=db.prepare('INSERT INTO personnel(full_name,title,email,phone,unit_id) VALUES(?,?,?,?,?)').run(full_name.trim(),title||'',email||'',phone||'',Number(unit_id));log(req.user.id,'CREATE','personnel',info.lastInsertRowid,full_name);res.status(201).json({id:info.lastInsertRowid});
});
app.put('/api/personnel/:id',auth,roles('admin','unit_lead'),(req,res)=>{
  const p=db.prepare('SELECT * FROM personnel WHERE id=?').get(Number(req.params.id)); if(!p)return res.status(404).json({error:'Không tìm thấy nhân sự'});
  if(req.user.role==='unit_lead'&&p.unit_id!==req.user.unit_id)return res.status(403).json({error:'Không có quyền sửa dữ liệu đơn vị khác'});
  const {full_name,title,email,phone,status}=req.body||{}; db.prepare('UPDATE personnel SET full_name=?,title=?,email=?,phone=?,status=? WHERE id=?').run(full_name||p.full_name,title??p.title,email??p.email,phone??p.phone,status||p.status,p.id);log(req.user.id,'UPDATE','personnel',p.id,p.full_name);res.json({ok:true});
});
app.delete('/api/personnel/:id',auth,roles('admin'),(req,res)=>{const p=db.prepare('SELECT * FROM personnel WHERE id=?').get(Number(req.params.id));if(!p)return res.status(404).json({error:'Không tìm thấy nhân sự'});db.prepare('DELETE FROM personnel WHERE id=?').run(p.id);log(req.user.id,'DELETE','personnel',p.id,p.full_name);res.json({ok:true});});

app.get('/api/reports',auth,(req,res)=>{
 const where=req.user.role==='unit_lead'?'WHERE r.unit_id=?':'';
 const rows=db.prepare(`SELECT r.*,u.name unit_name,usr.full_name created_by_name,rv.full_name reviewer_name FROM reports r JOIN units u ON u.id=r.unit_id JOIN users usr ON usr.id=r.created_by LEFT JOIN users rv ON rv.id=r.reviewer_id ${where} ORDER BY r.id DESC`).all(...(req.user.role==='unit_lead'?[req.user.unit_id]:[]));res.json(rows);
});
app.post('/api/reports',auth,roles('admin','unit_lead'),(req,res)=>{
 const {title,period,content,unit_id}=req.body||{};if(!title||!period||!content)return res.status(400).json({error:'Vui lòng nhập tiêu đề, kỳ báo cáo và nội dung'});
 const target=req.user.role==='unit_lead'?req.user.unit_id:Number(unit_id||req.user.unit_id);if(req.user.role==='unit_lead'&&target!==req.user.unit_id)return res.status(403).json({error:'Không thể gửi báo cáo thay đơn vị khác'});
 const info=db.prepare('INSERT INTO reports(title,period,content,unit_id,created_by,status) VALUES(?,?,?,?,?,?)').run(title.trim(),period.trim(),content.trim(),target,req.user.id,'Nháp');log(req.user.id,'CREATE','report',info.lastInsertRowid,title);res.status(201).json({id:info.lastInsertRowid});
});
app.post('/api/reports/:id/submit',auth,roles('admin','unit_lead'),(req,res)=>{const r=db.prepare('SELECT * FROM reports WHERE id=?').get(Number(req.params.id));if(!r)return res.status(404).json({error:'Không tìm thấy báo cáo'});if(req.user.role==='unit_lead'&&r.unit_id!==req.user.unit_id)return res.status(403).json({error:'Không có quyền gửi báo cáo này'});if(!['Nháp','Yêu cầu sửa'].includes(r.status))return res.status(400).json({error:'Chỉ gửi được báo cáo nháp hoặc báo cáo được yêu cầu sửa'});db.prepare("UPDATE reports SET status='Chờ duyệt',submitted_at=CURRENT_TIMESTAMP,review_note=NULL WHERE id=?").run(r.id);log(req.user.id,'SUBMIT','report',r.id,r.title);res.json({ok:true});});
app.post('/api/reports/:id/review',auth,roles('admin','reviewer'),(req,res)=>{const {decision,note}=req.body||{};if(!['Đã duyệt','Yêu cầu sửa'].includes(decision))return res.status(400).json({error:'Quyết định duyệt không hợp lệ'});const r=db.prepare('SELECT * FROM reports WHERE id=?').get(Number(req.params.id));if(!r)return res.status(404).json({error:'Không tìm thấy báo cáo'});if(r.status!=='Chờ duyệt')return res.status(400).json({error:'Báo cáo chưa ở trạng thái chờ duyệt'});db.prepare('UPDATE reports SET status=?,reviewer_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(decision,req.user.id,String(note||''),r.id);log(req.user.id,decision==='Đã duyệt'?'APPROVE':'REQUEST_CHANGES','report',r.id,note||r.title);res.json({ok:true});});
app.get('/api/reports/export.csv',auth,(req,res)=>{const rows=db.prepare(`SELECT r.id,r.title,r.period,u.name unit,r.status,usr.full_name created_by,r.created_at,r.review_note FROM reports r JOIN units u ON u.id=r.unit_id JOIN users usr ON usr.id=r.created_by ${req.user.role==='unit_lead'?'WHERE r.unit_id=?':''} ORDER BY r.id DESC`).all(...(req.user.role==='unit_lead'?[req.user.unit_id]:[]));const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv='\uFEFF'+[['Mã','Tiêu đề','Kỳ báo cáo','Đơn vị','Trạng thái','Người tạo','Ngày tạo','Ghi chú'],...rows.map(r=>[r.id,r.title,r.period,r.unit,r.status,r.created_by,r.created_at,r.review_note])].map(row=>row.map(esc).join(',')).join('\r\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="bao-cao-hoi.csv"');res.send(csv);});

app.get('/api/dues',auth,(req,res)=>{const sql=`SELECT d.*,u.name unit_name, p.transaction_ref,p.method,p.status payment_status,p.provider_ref,p.note payment_note,p.created_at payment_created FROM dues d JOIN units u ON u.id=d.unit_id LEFT JOIN payments p ON p.dues_id=d.id ${req.user.role==='unit_lead'?'WHERE d.unit_id=?':''} ORDER BY d.id`;res.json(db.prepare(sql).all(...(req.user.role==='unit_lead'?[req.user.unit_id]:[])));});
app.post('/api/payments',auth,roles('admin','unit_lead','finance'),(req,res)=>{const {dues_id,method,amount}=req.body||{};const d=db.prepare('SELECT * FROM dues WHERE id=?').get(Number(dues_id));if(!d)return res.status(404).json({error:'Không tìm thấy khoản hội phí'});if(req.user.role==='unit_lead'&&d.unit_id!==req.user.unit_id)return res.status(403).json({error:'Không thể tạo thanh toán cho đơn vị khác'});if(Number(amount)!==d.amount)return res.status(400).json({error:'Số tiền không khớp khoản phải thu'});if(!method)return res.status(400).json({error:'Vui lòng chọn phương thức thanh toán'});const ref='DEMO-'+Date.now()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();const info=db.prepare('INSERT INTO payments(dues_id,transaction_ref,amount,method,status,created_by,note) VALUES(?,?,?,?,?,?,?)').run(d.id,ref,d.amount,method,'Chờ xác minh',req.user.id,'Giao dịch mô phỏng; chưa kết nối cổng thanh toán');log(req.user.id,'CREATE','payment',info.lastInsertRowid,ref);res.status(201).json({id:info.lastInsertRowid,transaction_ref:ref,status:'Chờ xác minh',message:'Đã ghi nhận yêu cầu demo. Chưa thu tiền thật.'});});
app.post('/api/payments/:id/verify',auth,roles('admin','finance'),(req,res)=>{const p=db.prepare('SELECT * FROM payments WHERE id=?').get(Number(req.params.id));if(!p)return res.status(404).json({error:'Không tìm thấy giao dịch'});const {decision,provider_ref,note}=req.body||{};if(!['Đã xác minh','Không khớp','Thất bại'].includes(decision))return res.status(400).json({error:'Trạng thái xác minh không hợp lệ'});const d=db.prepare('SELECT * FROM dues WHERE id=?').get(p.dues_id);if(decision==='Đã xác minh'&&p.amount!==d.amount)return res.status(400).json({error:'Không thể xác minh do số tiền không khớp'});const tx=db.transaction(()=>{db.prepare('UPDATE payments SET status=?,provider_ref=?,note=?,verified_by=?,verified_at=CURRENT_TIMESTAMP WHERE id=?').run(decision,provider_ref||'',note||p.note,req.user.id,p.id);if(decision==='Đã xác minh')db.prepare("UPDATE dues SET status='Đã thanh toán' WHERE id=?").run(p.dues_id);});tx();log(req.user.id,'VERIFY_PAYMENT','payment',p.id,decision);res.json({ok:true});});
app.get('/api/payments/export.csv',auth,roles('admin','finance'),(req,res)=>{const rows=db.prepare('SELECT p.id,p.transaction_ref,u.name unit,d.period,p.amount,p.method,p.status,p.provider_ref,p.created_at,p.verified_at FROM payments p JOIN dues d ON d.id=p.dues_id JOIN units u ON u.id=d.unit_id ORDER BY p.id DESC').all();const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv='\uFEFF'+[['Mã','Mã giao dịch','Đơn vị','Kỳ','Số tiền','Phương thức','Trạng thái','Mã ngân hàng','Ngày tạo','Ngày xác minh'],...rows.map(r=>[r.id,r.transaction_ref,r.unit,r.period,r.amount,r.method,r.status,r.provider_ref,r.created_at,r.verified_at])].map(row=>row.map(esc).join(',')).join('\r\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="doi-soat-hoi-phi.csv"');res.send(csv);});
app.get('/api/audit',auth,roles('admin'),(req,res)=>res.json(db.prepare('SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.created_at,u.username,u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100').all()));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>{console.log(`Hoi portal running at http://localhost:${PORT}`);if(JWT_SECRET==='DEV_ONLY_CHANGE_THIS_SECRET_BEFORE_DEPLOYMENT')console.warn('WARNING: set JWT_SECRET before deployment. Demo accounts are enabled.');});
