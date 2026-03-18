// =====================================================
// db.js — قاعدة البيانات + Auth API + Admin
// =====================================================
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const DB_FILE = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'players.json')
  : path.join(__dirname, 'players.json');
let playersDB = {};

try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (raw && raw.trim()) playersDB = JSON.parse(raw);
  }
} catch(e) {
  console.error('DB read error:', e.message);
  playersDB = {};
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(playersDB, null, 2));
  } catch(e) {
    console.error('saveDB error:', e.message);
  }
}

// محاكاة SQL بسيطة
const db = {
  prepare: (sql) => ({
    run: (...args) => {
      if (sql.includes('INSERT INTO players')) {
        const [username, email, hash, title] = args;
        const key = username.toLowerCase();
        if (playersDB[key]) throw new Error('UNIQUE constraint failed: players.username');
        if (Object.values(playersDB).find(p => p.email === email))
          throw new Error('UNIQUE constraint failed: players.email');
        playersDB[key] = {
          username, email, password_hash: hash, title: title || 'لاعب',
          level: 1, prestige: 0, correct_answers: 0,
          total_matches: 0, best_round: 0,
          created_at: new Date().toISOString()
        };
        saveDB();
      } else if (sql.includes('UPDATE players SET correct_answers')) {
        const [correct, level, prestige, username] = args;
        const key = username.toLowerCase();
        if (playersDB[key]) {
          playersDB[key].correct_answers = correct;
          playersDB[key].level = level;
          playersDB[key].prestige = prestige;
          saveDB();
        }
      } else if (sql.includes('UPDATE players SET total_matches')) {
        const [username] = args;
        const key = username.toLowerCase();
        if (playersDB[key]) {
          playersDB[key].total_matches = (playersDB[key].total_matches || 0) + 1;
          saveDB();
        }
      } else if (sql.includes('UPDATE players SET title')) {
        const [title, username] = args;
        const key = username.toLowerCase();
        if (playersDB[key]) { playersDB[key].title = title; saveDB(); }
      }
    },
    get: (...args) => {
      const username = args[0];
      if (!username) return null;
      return playersDB[username.toLowerCase()] || null;
    }
  })
};

const PRESTIGE_BADGES  = ['', '🥉', '🥈', '🥇', '💎', '🔥', '⚡', '🌟', '👑', '🏆', '🐐'];
const ANSWERS_PER_LEVEL = 5;
const MAX_LEVEL = 30;

function getPlayerBadge(p) { return PRESTIGE_BADGES[p || 0] || ''; }

// =====================================================
// تسجيل Routes على app
// =====================================================
function registerRoutes(app) {
  const ADMIN_KEY = process.env.ADMIN_KEY || 'حسن-ادمن-2025';

  app.post('/api/register', (req, res) => {
    const { username, email, password, title } = req.body;
    if (!username || !email || !password) return res.json({ ok: false, msg: 'بيانات ناقصة' });
    if (!email.endsWith('@7snn.onion')) return res.json({ ok: false, msg: 'الإيميل لازم يكون @7snn.onion' });
    if (username.length < 2 || username.length > 20) return res.json({ ok: false, msg: 'اليوزرنيم بين 2-20 حرف' });
    if (password.length < 4) return res.json({ ok: false, msg: 'الباسورد 4 أحرف على الأقل' });
    try {
      const hash = crypto.createHash('sha256').update(password + 'hasan_salt_7oroof').digest('hex');
      db.prepare('INSERT INTO players (username,email,password_hash,title) VALUES (?,?,?,?)')
        .run(username.trim(), email.trim().toLowerCase(), hash, title || 'لاعب');
      res.json({ ok: true });
    } catch(e) {
      if (e.message && e.message.includes('UNIQUE')) {
        if (e.message.includes('username')) return res.json({ ok: false, msg: 'اليوزرنيم محجوز' });
        if (e.message.includes('email'))    return res.json({ ok: false, msg: 'الإيميل مسجّل مسبقاً' });
      }
      console.error('Register error:', e.message);
      res.json({ ok: false, msg: 'خطأ في السيرفر' });
    }
  });

  app.post('/api/login', (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ ok: false, msg: 'أدخل اليوزرنيم' });
    const p = db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(username.trim());
    if (!p) return res.json({ ok: false, msg: 'اليوزرنيم غير موجود — سجّل أولاً' });
    res.json({
      ok: true,
      profile: {
        username: p.username, title: p.title,
        level: p.level, prestige: p.prestige,
        badge: getPlayerBadge(p.prestige),
        correct_answers: p.correct_answers,
        total_matches: p.total_matches,
        best_round: p.best_round
      }
    });
  });

  app.get('/api/profile/:username', (req, res) => {
    const p = db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(req.params.username);
    if (!p) return res.json({ ok: false });
    res.json({
      ok: true,
      profile: {
        username: p.username, title: p.title,
        level: p.level, prestige: p.prestige,
        badge: getPlayerBadge(p.prestige),
        correct_answers: p.correct_answers,
        total_matches: p.total_matches,
        best_round: p.best_round
      }
    });
  });

  app.post('/api/update-title', (req, res) => {
    const { username, title } = req.body;
    if (!username || !title) return res.json({ ok: false });
    db.prepare('UPDATE players SET title=? WHERE username=? COLLATE NOCASE').run(title, username);
    res.json({ ok: true });
  });

  // ── Admin Page ──
  app.get('/admin', (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.send('<h2>❌ ممنوع</h2>');

    const SURVEY_LABELS = {
      's_كروي': '⚽ كرة القدم', 's_ديني': '🕌 ديني', 's_علوم': '🔬 علوم',
      's_جغرافيا': '🌍 جغرافيا', 's_علمي': '💡 علمي', 's_ثقافي': '🎭 ثقافي',
      'win_expect': '🏆 يتوقع يفوز؟', 'site_opinion': '🤔 رأيه في الموقع',
      'wars_opinion': '💣 رأيه في الحروب', 'epstein': '🕵️ إيبستين عايش؟',
      'obama': '🦎 أوباما سحلية؟', 'survey_opinion': '📝 رأيه في الاستبيان',
      'end_now': '🚪 خلّص الاستبيان؟',
    };
    const STAR_LABELS = ['', '😐 ضعيف', '🙂 متوسط', '😊 جيد', '😎 قوي', '🔥 خبير'];

    let html = `<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>لوحة الإدارة</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Tajawal,Arial,sans-serif;background:#f0f4f8;padding:20px;direction:rtl;}
h1{font-size:1.6rem;font-weight:900;margin-bottom:20px;color:#1e293b;}
h1 span{font-size:.9rem;font-weight:400;color:#64748b;}
.tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;}
.tab-btn{padding:8px 18px;border-radius:8px;border:1.5px solid #e2e8f0;background:#fff;cursor:pointer;font-size:.88rem;font-weight:700;color:#64748b;}
.tab-btn.on{background:#16a34a;color:#fff;border-color:#16a34a;}
.section{display:none;}.section.on{display:block;}
.card{background:#fff;border:1.5px solid #e2e8f0;border-radius:14px;padding:18px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,.06);}
.card-header{display:flex;align-items:center;gap:10px;margin-bottom:14px;border-bottom:1px solid #f1f5f9;padding-bottom:10px;}
.avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:900;flex-shrink:0;}
.avatar.guest{background:linear-gradient(135deg,#94a3b8,#64748b);}
.name{font-size:1rem;font-weight:900;color:#1e293b;}
.meta{font-size:.75rem;color:#64748b;}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700;background:#dcfce7;color:#14532d;margin-right:4px;}
.badge.guest{background:#f1f5f9;color:#475569;}
.q-row{display:flex;gap:8px;padding:7px 0;border-bottom:1px solid #f8fafc;align-items:flex-start;}
.q-row:last-child{border-bottom:none;}
.q-label{font-size:.78rem;color:#64748b;min-width:160px;flex-shrink:0;}
.q-answer{font-size:.85rem;font-weight:700;color:#1e293b;flex:1;}
.stars{color:#d97706;}
.empty{color:#94a3b8;font-size:.88rem;text-align:center;padding:30px;}
table{width:100%;border-collapse:collapse;font-size:.82rem;}
th{background:#f8fafc;padding:8px 12px;text-align:right;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0;}
td{padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#1e293b;}
tr:hover td{background:#f8fafc;}
</style></head><body>
<h1>🎮 لوحة إدارة حروف مع حسن <span>— ${Object.keys(playersDB).length} مستخدم</span></h1>
<div class="tabs">
  <button class="tab-btn on" onclick="showTab('surveys')">📝 الاستبيانات</button>
  <button class="tab-btn" onclick="showTab('players')">👥 اللاعبون</button>
</div>`;

    const entries = Object.entries(playersDB);
    const withSurvey = entries.filter(([, p]) => p.survey);

    html += '<div class="section on" id="tab-surveys">';
    if (!withSurvey.length) {
      html += '<div class="empty">لا توجد استبيانات بعد</div>';
    } else {
      withSurvey.forEach(([key, p]) => {
        const isGuest = key.startsWith('__guest__');
        const date = p.survey_date ? new Date(p.survey_date).toLocaleDateString('ar-SA') : '';
        html += `<div class="card"><div class="card-header">
          <div class="avatar${isGuest ? ' guest' : ''}">${isGuest ? '👤' : (p.username || '?')[0]}</div>
          <div><div class="name">${isGuest ? 'ضيف: ' + p.username : p.username}
          <span class="badge${isGuest ? ' guest' : ''}">${isGuest ? 'ضيف' : 'مسجّل'}</span></div>
          <div class="meta">${date}${p.level ? ` • ليفل ${p.level}` : ''}</div></div></div>`;
        Object.entries(p.survey).forEach(([k, v]) => {
          const label = SURVEY_LABELS[k] || k;
          let display = v;
          if (k.startsWith('s_') && typeof v === 'number')
            display = '<span class="stars">' + '★'.repeat(v) + '☆'.repeat(5 - v) + '</span> ' + (STAR_LABELS[v] || v);
          html += `<div class="q-row"><div class="q-label">${label}</div><div class="q-answer">${display}</div></div>`;
        });
        html += '</div>';
      });
    }
    html += '</div>';

    html += '<div class="section" id="tab-players"><div class="card"><table><thead><tr><th>اليوزرنيم</th><th>اللقب</th><th>الإيميل</th><th>ليفل</th><th>بريستيج</th><th>إجابات صح</th><th>مباريات</th><th>تاريخ التسجيل</th></tr></thead><tbody>';
    entries.filter(([k]) => !k.startsWith('__guest__')).forEach(([, p]) => {
      html += `<tr><td><b>${p.username}</b></td><td>${p.title || '—'}</td><td>${p.email || '—'}</td>
        <td>${p.level || 1}</td><td>${p.prestige || 0}</td><td>${p.correct_answers || 0}</td>
        <td>${p.total_matches || 0}</td><td>${p.created_at ? new Date(p.created_at).toLocaleDateString('ar-SA') : '—'}</td></tr>`;
    });
    html += '</tbody></table></div></div>';
    html += `<script>function showTab(id){document.querySelectorAll('.section').forEach(s=>s.classList.remove('on'));document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('on'));document.getElementById('tab-'+id).classList.add('on');event.target.classList.add('on');}</script></body></html>`;
    res.send(html);
  });
}

module.exports = { db, playersDB, saveDB, getPlayerBadge, registerRoutes, ANSWERS_PER_LEVEL, MAX_LEVEL };