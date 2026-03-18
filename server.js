const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'host.html')));


// =====================================================
// DATABASE
// =====================================================
// JSON-based database (no compilation needed)
const DB_FILE = path.join(__dirname, 'players.json');
let playersDB = {};
if (fs.existsSync(DB_FILE)) {
  try { playersDB = JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch(e) { playersDB = {}; }
}
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(playersDB, null, 2)); }

// db helper functions
const db = {
  prepare: (sql) => ({
    run: (...args) => {
      if (sql.includes('INSERT INTO players')) {
        const [username,email,hash,title] = args;
        const key = username.toLowerCase();
        if (playersDB[key]) throw new Error('UNIQUE constraint failed: players.username');
        const emailKey = Object.values(playersDB).find(p=>p.email===email);
        if (emailKey) throw new Error('UNIQUE constraint failed: players.email');
        playersDB[key] = {username,email,password_hash:hash,title:title||'لاعب',level:1,prestige:0,correct_answers:0,total_matches:0,best_round:0,created_at:new Date().toISOString()};
        saveDB();
      } else if (sql.includes('UPDATE players SET correct_answers')) {
        const [correct,level,prestige,username] = args;
        const key=username.toLowerCase(); if(playersDB[key]){playersDB[key].correct_answers=correct;playersDB[key].level=level;playersDB[key].prestige=prestige;saveDB();}
      } else if (sql.includes('UPDATE players SET total_matches')) {
        const [username]=args; const key=username.toLowerCase(); if(playersDB[key]){playersDB[key].total_matches=(playersDB[key].total_matches||0)+1;saveDB();}
      } else if (sql.includes('UPDATE players SET title')) {
        const [title,username]=args; const key=username.toLowerCase(); if(playersDB[key]){playersDB[key].title=title;saveDB();}
      }
    },
    get: (...args) => {
      const username = args[0];
      if (!username) return null;
      return playersDB[username.toLowerCase()] || null;
    }
  })
};

const PRESTIGE_BADGES  = ['','🥉','🥈','🥇','💎','🔥','⚡','🌟','👑','🏆','🐐'];
const ANSWERS_PER_LEVEL = 5;
const MAX_LEVEL = 30;
function getPlayerBadge(p){ return PRESTIGE_BADGES[p||0] || ''; }

// =====================================================
// AUTH REST API
// =====================================================
app.post('/api/register', async (req,res) => {
  const { username, email, password, title } = req.body;
  if (!username||!email||!password) return res.json({ok:false,msg:'بيانات ناقصة'});
  if (!email.endsWith('@7snn.onion'))  return res.json({ok:false,msg:'الإيميل لازم يكون @7snn.onion'});
  if (username.length<2||username.length>20) return res.json({ok:false,msg:'اليوزرنيم بين 2-20 حرف'});
  if (password.length<4) return res.json({ok:false,msg:'الباسورد 4 أحرف على الأقل'});
  try {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO players (username,email,password_hash,title) VALUES (?,?,?,?)').run(
      username.trim(), email.trim().toLowerCase(), hash, title||'لاعب'
    );
    res.json({ok:true});
  } catch(e) {
    if(e.message.includes('UNIQUE')){
      if(e.message.includes('username')) return res.json({ok:false,msg:'اليوزرنيم محجوز'});
      if(e.message.includes('email'))    return res.json({ok:false,msg:'الإيميل مسجّل مسبقاً'});
    }
    res.json({ok:false,msg:'خطأ في السيرفر'});
  }
});

app.post('/api/login', (req,res) => {
  const { username } = req.body;
  if (!username) return res.json({ok:false,msg:'أدخل اليوزرنيم'});
  const p = db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(username.trim());
  if (!p) return res.json({ok:false,msg:'اليوزرنيم غير موجود — سجّل أولاً'});
  res.json({ok:true, profile:{
    username:p.username, title:p.title,
    level:p.level, prestige:p.prestige,
    badge:getPlayerBadge(p.prestige),
    correct_answers:p.correct_answers,
    total_matches:p.total_matches,
    best_round:p.best_round
  }});
});

app.get('/api/profile/:username', (req,res) => {
  const p = db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(req.params.username);
  if (!p) return res.json({ok:false});
  res.json({ok:true, profile:{
    username:p.username, title:p.title,
    level:p.level, prestige:p.prestige,
    badge:getPlayerBadge(p.prestige),
    correct_answers:p.correct_answers,
    total_matches:p.total_matches, best_round:p.best_round
  }});
});

app.post('/api/update-title', (req,res) => {
  const {username,title} = req.body;
  if(!username||!title) return res.json({ok:false});
  db.prepare('UPDATE players SET title=? WHERE username=? COLLATE NOCASE').run(title,username);
  res.json({ok:true});
});

// =====================================================
// ADMIN PAGE (سرية)
// =====================================================
const ADMIN_KEY = process.env.ADMIN_KEY || 'حسن-ادمن-2025';

app.get('/admin', (req,res) => {
  if(req.query.key !== ADMIN_KEY) return res.send('<h2>❌ ممنوع</h2>');

  const SURVEY_LABELS = {
    's_كروي':    '⚽ كرة القدم',
    's_ديني':    '🕌 ديني',
    's_علوم':    '🔬 علوم',
    's_جغرافيا': '🌍 جغرافيا',
    's_علمي':    '💡 علمي',
    's_ثقافي':   '🎭 ثقافي',
    'win_expect':     '🏆 يتوقع يفوز؟',
    'site_opinion':   '🤔 رأيه في الموقع',
    'wars_opinion':   '💣 رأيه في الحروب',
    'epstein':        '🕵️ إيبستين عايش؟',
    'obama':          '🦎 أوباما سحلية؟',
    'survey_opinion': '📝 رأيه في الاستبيان',
    'end_now':        '🚪 خلّص الاستبيان؟',
  };

  const STAR_LABELS = ['','😐 ضعيف','🙂 متوسط','😊 جيد','😎 قوي','🔥 خبير'];

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
.section{display:none;} .section.on{display:block;}
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
.stat{display:inline-block;background:#f1f5f9;border-radius:8px;padding:4px 10px;font-size:.78rem;font-weight:700;margin-left:6px;}
.empty{color:#94a3b8;font-size:.88rem;text-align:center;padding:30px;}
table{width:100%;border-collapse:collapse;font-size:.82rem;}
th{background:#f8fafc;padding:8px 12px;text-align:right;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0;}
td{padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#1e293b;}
tr:hover td{background:#f8fafc;}
</style>
</head>
<body>
<h1>🎮 لوحة إدارة حروف مع حسن <span>— ${Object.keys(playersDB).length} مستخدم</span></h1>
<div class="tabs">
  <button class="tab-btn on" onclick="showTab('surveys')">📝 الاستبيانات</button>
  <button class="tab-btn" onclick="showTab('players')">👥 اللاعبون</button>
</div>`;

  // ── قسم الاستبيانات ──
  html += '<div class="section on" id="tab-surveys">';
  const entries = Object.entries(playersDB);
  const withSurvey = entries.filter(([,p]) => p.survey);

  if(!withSurvey.length){
    html += '<div class="empty">لا توجد استبيانات بعد</div>';
  } else {
    withSurvey.forEach(([key, p]) => {
      const isGuest = key.startsWith('__guest__');
      const date = p.survey_date ? new Date(p.survey_date).toLocaleDateString('ar-SA') : '';
      html += `<div class="card">
        <div class="card-header">
          <div class="avatar${isGuest?' guest':''}">${isGuest?'👤':(p.username||'?')[0]}</div>
          <div>
            <div class="name">${isGuest?'ضيف: '+p.username:p.username} <span class="badge${isGuest?' guest':''}">${isGuest?'ضيف':'مسجّل'}</span></div>
            <div class="meta">${date}${p.level?` • ليفل ${p.level}`:''}</div>
          </div>
        </div>`;

      Object.entries(p.survey).forEach(([k,v]) => {
        const label = SURVEY_LABELS[k] || k;
        let display = v;
        // التصنيفات بالنجوم
        if(k.startsWith('s_') && typeof v === 'number'){
          display = '<span class="stars">' + '★'.repeat(v) + '☆'.repeat(5-v) + '</span> ' + (STAR_LABELS[v]||v);
        }
        html += `<div class="q-row"><div class="q-label">${label}</div><div class="q-answer">${display}</div></div>`;
      });
      html += '</div>';
    });
  }
  html += '</div>';

  // ── قسم اللاعبون ──
  html += '<div class="section" id="tab-players"><div class="card"><table><thead><tr><th>اليوزرنيم</th><th>اللقب</th><th>الإيميل</th><th>ليفل</th><th>بريستيج</th><th>إجابات صح</th><th>مباريات</th><th>تاريخ التسجيل</th></tr></thead><tbody>';

  entries.filter(([k]) => !k.startsWith('__guest__')).forEach(([,p]) => {
    html += `<tr>
      <td><b>${p.username}</b></td>
      <td>${p.title||'—'}</td>
      <td>${p.email||'—'}</td>
      <td>${p.level||1}</td>
      <td>${p.prestige||0}</td>
      <td>${p.correct_answers||0}</td>
      <td>${p.total_matches||0}</td>
      <td>${p.created_at?new Date(p.created_at).toLocaleDateString('ar-SA'):'—'}</td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';

  html += `<script>
function showTab(id){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('on'));
  document.getElementById('tab-'+id).classList.add('on');
  event.target.classList.add('on');
}
</script></body></html>`;

  res.send(html);
});

// =====================================================
// CONSTANTS
// =====================================================
const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي'];
const HOST_CODE          = process.env.HOST_CODE || 'Tty3201';
const BUTTON_ANSWER_TIME = 5000;
const TEAM_TIMEOUT_MS    = 10000;
const HINT_AFTER_MS      = 30000;
const CANCEL_VOTE_AFTER  = 2 * 60 * 1000;
const QUESTION_EXPIRE    = 5 * 60 * 1000;

// =====================================================
// QUESTIONS DATABASE (776 سؤال)
const QUESTIONS_DB = {
  "أ": [
    {
      "text": "صانع ألعاب إسباني قاد منتخب بلاده للفوز بكأس العالم 2010 وسجل الهدف الحاسم في النهائي",
      "answer": "أندريس إنييستا",
      "hint": "لعب في برشلونة",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "أول الخلفاء الراشدين ورفيق النبي في الهجرة وأحد العشرة المبشرين بالجنة",
      "answer": "أبو بكر الصديق",
      "hint": "والد عائشة",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة تركية كانت عاصمة الإمبراطورية البيزنطية والعثمانية وتقع على مضيق البوسفور",
      "answer": "إسطنبول",
      "hint": "كانت تسمى القسطنطينية",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء ورياضيات إنجليزي اشتهر بقصة التفاحة ووضع قوانين الجاذبية",
      "answer": "إسحاق نيوتن",
      "hint": "اسمه الأول إسحاق",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "أكبر قارة في العالم من حيث المساحة تضم الصين والهند",
      "answer": "آسيا",
      "hint": "شرق العالم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "سورة في القرآن الكريم تعدل ثلث القرآن وتسمى قل هو الله أحد",
      "answer": "الإخلاص",
      "hint": "رقمها 112",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "نادٍ لندني لكرة القدم يلقب بالمدفعجية وملعبه الإمارات",
      "answer": "أرسنال",
      "hint": "أسس في جنوب لندن",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "غاز عديم اللون والرائحة يشكل حوالي 21% من الغلاف الجوي وضروري للحياة",
      "answer": "أكسجين",
      "hint": "رمزه O",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر جاهلي صاحب إحدى المعلقات ومطلعها قفا نبك من ذكرى حبيب ومنزل",
      "answer": "أمرؤ القيس",
      "hint": "ابن ملك كندة",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حارس مرمى ألماني أسطوري عرف بأدائه العالي وحصل على جائزة أفضل لاعب في كأس العالم 2002",
      "answer": "أوليفر كان",
      "hint": "كان قائد المنتخب الألماني",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة أثرية في الأردن، اشتهرت بمنحوتاتها الصخرية الوردية، وكانت عاصمة الأنباط.",
      "answer": "البتراء",
      "hint": "تسمى المدينة الوردية",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء ألماني، وضع نظرية النسبية العامة، وحصل على جائزة نوبل في الفيزياء.",
      "answer": "أينشتاين",
      "hint": "معادلة E=mc²",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "ممثل ومخرج أمريكي، اشتهر بأفلام مثل 'المنتقمون' و'الحديقة الجوراسية'.",
      "answer": "أفلام؟",
      "hint": "اسمه الأول ستيفن",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من سويسرا ويصب في بحر الشمال، ويمر عبر ألمانيا وهولندا.",
      "answer": "الراين",
      "hint": "نهر الراين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني يستخدم لقراءة الكتب الرقمية، مثل كيندل.",
      "answer": "قارئ إلكتروني",
      "hint": "يبدأ بـ ق",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض تنفسي فيروسي ظهر في ووهان بالصين عام 2019.",
      "answer": "كوفيد-19",
      "hint": "يبدأ بـ ك",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة الولايات المتحدة الأمريكية.",
      "answer": "دولار",
      "hint": "يبدأ بـ د",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "كاتب وفيلسوف فرنسي، صاحب كتاب 'الغثيان' و'الجدار'.",
      "answer": "سارتر",
      "hint": "يبدأ بـ س",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي بحري، يعيش في المحيطات، ويتميز بذكائه وقدرته على القفز.",
      "answer": "دولفين",
      "hint": "يبدأ بـ د",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة عراقية، كانت عاصمة الدولة العباسية في عهد الخليفة المنصور.",
      "answer": "بغداد",
      "hint": "يبدأ بـ ب",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم برتغالي، لعب لمانشستر يونايتد وريال مدريد، ويعتبر من أعظم اللاعبين.",
      "answer": "رونالدو",
      "hint": "يبدأ بـ ر",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة مايكروسوفت.",
      "answer": "ويندوز",
      "hint": "يبدأ بـ و",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "عنصر كيميائي رمزه H، وهو أخف العناصر.",
      "answer": "هيدروجين",
      "hint": "يبدأ بـ ه",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها بانكوك، تشتهر بالسياحة والطعام الحار.",
      "answer": "تايلاند",
      "hint": "يبدأ بـ ت",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "قانوني يعني الاتفاق بين طرفين على إنشاء التزامات.",
      "answer": "عقد",
      "hint": "يبدأ بـ ع",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "نوع من الفواكه، صيفي، لذيذ الطعم، منه الأحمر والأصفر.",
      "answer": "خوخ",
      "hint": "يبدأ بـ خ",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بـ ط",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في المحيط الهندي، تابعة لليمن، استراتيجية عند باب المندب.",
      "answer": "سقطرى",
      "hint": "يبدأ بـ س",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يضخ الدم.",
      "answer": "قلب",
      "hint": "يبدأ بـ ق",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ب": [
    {
      "text": "نادٍ إسباني لكرة القدم يعرف بالبرسا ويقع في كتالونيا",
      "answer": "برشلونة",
      "hint": "ملعبه كامب نو",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "عاصمة فرنسا وتلقب بمدينة النور",
      "answer": "باريس",
      "hint": "يوجد بها برج إيفل",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "أطول سورة في القرآن الكريم",
      "answer": "البقرة",
      "hint": "رقمها 2",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "أسطورة كرة القدم البرازيلية فاز بكأس العالم ثلاث مرات ويعرف بالملك",
      "answer": "بيليه",
      "hint": "اسمه الحقيقي إدسون",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "عاصمة العراق مدينة السلام تقع على نهر دجلة",
      "answer": "بغداد",
      "hint": "تقع على نهر دجلة",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "دواء مسكن وخافض للحرارة يعرف أيضاً باسم أسيتامينوفين",
      "answer": "باراسيتامول",
      "hint": "يستخدم بكثرة للصداع",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "موسيقي ألماني عانى من الصمم وألف السيمفونية التاسعة",
      "answer": "بيتهوفن",
      "hint": "ألف السيمفونية الخامسة أيضًا",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "عاصمة ألمانيا كانت مقسمة بجدار",
      "answer": "برلين",
      "hint": "كانت مقسمة بجدار",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "نادٍ ألماني يلقب بالعملاق البافاري وملعبه أليانز أرينا",
      "answer": "بايرن ميونخ",
      "hint": "أكثر الأندية الألمانية تتويجًا",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "كوكب قزم كان يعتبر تاسع كواكب المجموعة الشمسية",
      "answer": "بلوتو",
      "hint": "تم استبعاده عام 2006",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة لبنانية، تقع على ساحل البحر المتوسط، وتشتهر بقلعتها البحرية.",
      "answer": "بيروت",
      "hint": "عاصمة لبنان",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم كيمياء مسلم، يعتبر أبو الكيمياء، له إسهامات في التقطير والتبلور.",
      "answer": "جابر بن حيان",
      "hint": "يبدأ بـ ج",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مخترع أمريكي، طور المصباح الكهربائي والفونوغراف.",
      "answer": "إديسون",
      "hint": "يبدأ بـ إ",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من ألمانيا ويصب في البحر الأسود، ويمر عبر عدة دول.",
      "answer": "الدانوب",
      "hint": "يبدأ بـ د",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم لقياس الضغط الجوي.",
      "answer": "بارومتر",
      "hint": "يبدأ بـ ب",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس كورونا، ظهر في ووهان.",
      "answer": "كوفيد",
      "hint": "يبدأ بـ ك",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة المملكة المتحدة.",
      "answer": "جنيه إسترليني",
      "hint": "يبدأ بـ ج",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "كاتب روسي، صاحب رواية 'الجريمة والعقاب'.",
      "answer": "دوستويفسكي",
      "hint": "يبدأ بـ د",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في الغابات، ويتميز بذيله الطويل.",
      "answer": "قرد",
      "hint": "يبدأ بـ ق",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية، تقع في المنطقة الشرقية، وتعتبر مركزًا نفطيًا مهمًا.",
      "answer": "الظهران",
      "hint": "يبدأ بـ ظ",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم مصري، لعب للأهلي وليفربول، ويعتبر أفضل هداف عربي.",
      "answer": "صلاح",
      "hint": "يبدأ بـ ص",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "نظام تشغيل للهواتف الذكية، طورته جوجل.",
      "answer": "أندرويد",
      "hint": "يبدأ بـ أ",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "عنصر كيميائي رمزه O، ضروري للحياة.",
      "answer": "أكسجين",
      "hint": "يبدأ بـ أ",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في شمال أفريقيا، عاصمتها الجزائر، وتشتهر بالصحراء والبترول.",
      "answer": "الجزائر",
      "hint": "يبدأ بـ ج",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني انتهاء العلاقة الزوجية بحكم قضائي.",
      "answer": "طلاق",
      "hint": "يبدأ بـ ط",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الأسماك، يعيش في المياه المالحة، وله جسم مسطح.",
      "answer": "سمك موسى",
      "hint": "يبدأ بـ س",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار.",
      "answer": "جرير",
      "hint": "يبدأ بـ ج",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بـ ك",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الرقبة، ويحتوي على الحنجرة.",
      "answer": "حلق",
      "hint": "يبدأ بـ ح",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ت": [
    {
      "text": "دولة عربية في شمال أفريقيا عاصمتها تونس وتشتهر بجامع الزيتونة",
      "answer": "تونس",
      "hint": "تشتهر بجامع الزيتونة",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "سفينة بريطانية شهيرة غرقت في المحيط الأطلسي عام 1912 وكانت توصف بأنها لا تغرق",
      "answer": "تيتانيك",
      "hint": "كانت توصف بأنها لا تغرق",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم لرصد الأجرام السماوية ومن أشهرها هابل",
      "answer": "تلسكوب",
      "hint": "من أشهرها هابل",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مهاجم فرنسي أسطوري لعب لأرسنال وبرشلونة وهو هداف فرنسا التاريخي",
      "answer": "تيري هنري",
      "hint": "حصل على كأس العالم 1998",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "فرعون مصري شاب اكتشف مقبرته كاملة عام 1922 وقناعه الذهبي مشهور",
      "answer": "توت عنخ آمون",
      "hint": "قناعه الذهبي مشهور",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان زاحف يعيش في الماء واليابسة له فكوك قوية",
      "answer": "تمساح",
      "hint": "يوجد منه نوع يسمى النيل",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "الكتاب المقدس الذي أنزل على موسى عليه السلام ويحتوي على الوصايا العشر",
      "answer": "توراة",
      "hint": "يحتوي على الوصايا العشر",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "نادٍ إنجليزي لكرة القدم يلقب بالسبيرز من أندية لندن",
      "answer": "توتنهام",
      "hint": "من أندية لندن",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة أثرية في سوريا كانت مملكة قديمة وتعرضت لتدمير في الحرب الحديثة",
      "answer": "تدمر",
      "hint": "كانت تحت حكم زنوبيا",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية تقع شمال غرب المملكة وترد في السياق القرآني",
      "answer": "تبوك",
      "hint": "تقع شمال غرب السعودية",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم رياضيات وفيزياء إنجليزي، وضع قوانين الحركة والجاذبية، واشتهر بقصة التفاحة.",
      "answer": "نيوتن",
      "hint": "يبدأ بنون",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم إسباني، لعب لبرشلونة، ويُعتبر أحد أفضل لاعبي خط الوسط في التاريخ.",
      "answer": "تشافي",
      "hint": "اسمه تشافي هيرنانديز",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "ممثل ومخرج أمريكي، اشتهر بأفلام مثل 'تايتانيك' و'أفاتار'.",
      "answer": "كاميرون",
      "hint": "جيمس كاميرون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا الوسطى، يصب في بحر آرال، وكان قديمًا يصب في بحر قزوين.",
      "answer": "سيحون",
      "hint": "يبدأ بسين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني يستخدم لتسجيل الفيديو والصور، ويوجد في الهواتف الذكية.",
      "answer": "كاميرا",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض جلدي يسبب حكة واحمرارًا، ويعرف بالأكزيما.",
      "answer": "إكزيما",
      "hint": "يبدأ بألف",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة اليابان.",
      "answer": "ين",
      "hint": "يبدأ بياء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "كاتب وفيلسوف ألماني، صاحب كتاب 'هكذا تكلم زرادشت'.",
      "answer": "نيتشه",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي مفترس، من فصيلة السنوريات، يعيش في الغابات الآسيوية.",
      "answer": "نمر",
      "hint": "يبدأ بنون",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة عسير، وتشتهر بجمالها السياحي.",
      "answer": "أبها",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم هولندي، لعب لأياكس وميلان، ويعتبر أحد أفضل هدافي كرة القدم.",
      "answer": "فان باستن",
      "hint": "ماركو فان باستن",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة أبل.",
      "answer": "ماك",
      "hint": "macOS",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Na، يستخدم في ملح الطعام.",
      "answer": "صوديوم",
      "hint": "يبدأ بصاد",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب آسيا، تقع في جبال الهيمالايا، تشتهر بجبل إفرست.",
      "answer": "نيبال",
      "hint": "يبدأ بنون",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني إعادة النظر في حكم قضائي أمام محكمة أعلى.",
      "answer": "تمييز",
      "hint": "محكمة التمييز",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الاستوائية، له قشر أصفر ولحم حلو، ويأكله القرود.",
      "answer": "موز",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أندلسي، اشتهر بالغزل، وله موشحات مشهورة.",
      "answer": "ابن زيدون",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بالآثار القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو الجزء الذي يقع بين الرأس والجذع.",
      "answer": "رقبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ث": [
    {
      "text": "جبل يقع جنوب مكة المكرمة اشتهر بغار اختبأ فيه النبي وصاحبه أثناء الهجرة",
      "answer": "ثور",
      "hint": "الغار الذي ورد ذكره في القرآن",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان ثديي يتميز بذيله الطويل الكثيف يعيش في الجحور ويضرب به المثل في المكر",
      "answer": "ثعلب",
      "hint": "يسمى في القصص العربية أبا الحصين",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان زاحف من رتبة الحرشفيات ينسلخ عن جلده ومنه أنواع سامة وغير سامة",
      "answer": "ثعبان",
      "hint": "يمثل في الأساطير رمزًا للشر",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح ديني يعني الجزاء والعوض وهو ما ينتظره المؤمن من الله على عمله الصالح",
      "answer": "ثواب",
      "hint": "مقابل العقاب",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "قبيلة عربية قديمة ورد ذكرها في القرآن في قصة نبي الله صالح عليه السلام",
      "answer": "ثمود",
      "hint": "كانوا ينحتون البيوت في الجبال",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "نبات عشبي يستخدم بكثرة في الطهي وله رائحة مميزة ويستخدم أيضاً في الطب الشعبي",
      "answer": "ثوم",
      "hint": "له فوائد للضغط والمناعة",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "شاعر مخضرم عاش في الجاهلية والإسلام اشتهر بحكمته وزهده",
      "answer": "ثابت بن جابر",
      "hint": "يلقب بتأبط شرًا",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مصطلح قانوني يعني الاعتماد على شخص في التصرف نيابة عنك ومرادف للأمانة",
      "answer": "ثقة",
      "hint": "مرادف للأمانة",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "عالم رياضيات وفلكي عربي من حران له إسهامات في حساب المثلثات",
      "answer": "ثابت بن قرة",
      "hint": "يعتبر مؤسس علم الإستاتيكا",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "صغير الغزال في اللغة العربية",
      "answer": "شادن",
      "hint": "صغير الغزال",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم إنجليزي، لعب لأرسنال، وسجل أسرع هدف في تاريخ الدوري الإنجليزي.",
      "answer": "والكوت",
      "hint": "ثيو والكوت",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "كاتب وفيلسوف يوناني، صاحب كتاب 'الجمهورية'، وأستاذ أرسطو.",
      "answer": "أفلاطون",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في العراق، ينبع من تركيا، ويلتقي مع دجلة في شط العرب.",
      "answer": "الفرات",
      "hint": "يبدأ بفاء",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم لقياس درجة الحرارة.",
      "answer": "ترمومتر",
      "hint": "يبدأ بتاء",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض فيروسي حاد ظهر في غرب أفريقيا، وتسبب في وفيات كثيرة.",
      "answer": "إيبولا",
      "hint": "يبدأ بألف",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة أوروبية موحدة، تستخدم في 19 دولة.",
      "answer": "يورو",
      "hint": "يبدأ بياء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي مخضرم، عاش في الجاهلية والإسلام، واشتهر بقصيدته 'اللامية'.",
      "answer": "حسان بن ثابت",
      "hint": "يبدأ بحاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة تاريخية في اليمن، كانت مركزًا للمملكة السبئية، وتشتهر بسدها القديم.",
      "answer": "مأرب",
      "hint": "يبدأ بميم",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم برتغالي، لعب لريال مدريد، ويعتبر من أفضل اللاعبين في التاريخ.",
      "answer": "رونالدو",
      "hint": "كريستيانو رونالدو",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "لغة برمجة شهيرة، تستخدم في تطوير تطبيقات الويب.",
      "answer": "بايثون",
      "hint": "يبدأ بباء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Fe، يستخدم في صناعة الفولاذ.",
      "answer": "حديد",
      "hint": "يبدأ بحاء",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في شمال أوروبا، عاصمتها ستوكهولم، تشتهر بالجمال الطبيعي.",
      "answer": "السويد",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني التعهد بعدم الإخلال بالعقد.",
      "answer": "ضمان",
      "hint": "يبدأ بضاد",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الأسماك، يعيش في المياه العذبة، وله شارب.",
      "answer": "قرموط",
      "hint": "يبدأ بقاف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي معاصر، مصري الجنسية، اشتهر بإلقاء الشعر في المناسبات.",
      "answer": "هشام الجخ",
      "hint": "يبدأ بهاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في المحيط الهادئ، تابعة لإندونيسيا، تشتهر بالسياحة.",
      "answer": "بالي",
      "hint": "يبدأ بباء",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الجمجمة، وهو مركز الجهاز العصبي.",
      "answer": "دماغ",
      "hint": "يبدأ بدال",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ج": [
    {
      "text": "مدينة سعودية عروس البحر الأحمر ثاني أكبر مدن المملكة وميناؤها الرئيسي",
      "answer": "جدة",
      "hint": "باب مكة",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مدافع إنجليزي أسطوري قاد تشيلسي لسنوات وكان قائد منتخب إنجلترا",
      "answer": "جون تيري",
      "hint": "فاز بالدوري الإنجليزي 4 مرات مع تشيلسي",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم كيمياء مسلم يعتبر أبو الكيمياء له إسهامات في التقطير والتبلور",
      "answer": "جابر بن حيان",
      "hint": "ينسب إليه اكتشاف حمض الكبريتيك",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان ثديي يلقب بسفينة الصحراء يستطيع تخزين الماء والدهون في سنامه",
      "answer": "جمل",
      "hint": "له نوع واحد السنام ونوعان",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 72 تتحدث عن استماع الجن للقرآن",
      "answer": "الجن",
      "hint": "السورة تبدأ بقل أوحي",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "وحدة قياس الطاقة في النظام الدولي تساوي الشغل المبذول عندما تؤثر قوة مقدارها نيوتن لمسافة متر",
      "answer": "جول",
      "hint": "نسبة إلى الفيزيائي الإنجليزي جيمس بريسكوت جول",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات جذري برتقالي اللون غني بفيتامين أ يؤكل نيئاً أو مطبوخاً",
      "answer": "جزر",
      "hint": "يُستخدم في السلطات",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "فيلسوف وعالم اجتماع فرنسي صاحب نظرية العقد الاجتماعي",
      "answer": "جان جاك روسو",
      "hint": "صاحب نظرية العقد الاجتماعي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "قوة في الفيزياء تجذب الأجسام بعضها نحو بعض وتتناسب طرديًا مع الكتلة",
      "answer": "جاذبية",
      "hint": "اكتشفها نيوتن تحت شجرة تفاح",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم ويلزي لعب لتوتنهام وريال مدريد اشتهر بالسرعة والتسديدات القوية",
      "answer": "جاريث بيل",
      "hint": "سجل هدفًا مشهورًا في نهائي كأس الملك",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "عالم فيزياء إيطالي، اخترع البطارية الكهربائية الأولى، وسميت على اسمه وحدة قياس الجهد.",
      "answer": "فولتا",
      "hint": "يبدأ بفاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم فرنسي، لعب لريال مدريد، وقاد فرنسا للفوز بكأس العالم 1998.",
      "answer": "زيدان",
      "hint": "زين الدين زيدان",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "رسام ونحات إيطالي من عصر النهضة، أشهر أعماله تمثال داوود ولوحة السقف في كنيسة سيستين.",
      "answer": "مايكل أنجلو",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أفريقيا، أطول أنهار العالم، يمر بمصر والسودان.",
      "answer": "النيل",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم لتحديد المواقع عبر الأقمار الصناعية.",
      "answer": "جي بي إس",
      "hint": "GPS",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض يصيب المفاصل بسبب تراكم حمض البوليك، ويسبب ألمًا شديدًا.",
      "answer": "نقرس",
      "hint": "يبدأ بنون",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة اليابان.",
      "answer": "ين",
      "hint": "يبدأ بياء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة تاريخية في العراق، كانت عاصمة الدولة العباسية.",
      "answer": "بغداد",
      "hint": "يبدأ بباء",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم أرجنتيني، لعب لبرشلونة وإنتر ميامي، ويعتبر أحد أعظم اللاعبين.",
      "answer": "ميسي",
      "hint": "ليونيل ميسي",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "نظام تشغيل للهواتف الذكية، طورته أبل.",
      "answer": "آي أو إس",
      "hint": "iOS",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه C، أساس الحياة على الأرض.",
      "answer": "كربون",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها جاكرتا، وهي أكبر دولة إسلامية من حيث عدد السكان.",
      "answer": "إندونيسيا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني إبطال العقد أو فسخه.",
      "answer": "فسخ",
      "hint": "يبدأ بفاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الطيور الجارحة، يتميز ببصره الحاد، ويستخدم في الصيد.",
      "answer": "صقر",
      "hint": "يبدأ بصاد",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار.",
      "answer": "الفرزدق",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في البطن، ويساعد في هضم الطعام.",
      "answer": "أمعاء",
      "hint": "يبدأ بألف",
      "category": "علوم",
      "difficulty": "صعب"
    }
  ],
  "ح": [
    {
      "text": "لاعب ومدرب مصري قاد المنتخب المصري للفوز بكأس الأمم الأفريقية ثلاث مرات متتالية ويعرف بالمعلم",
      "answer": "حسن شحاتة",
      "hint": "كان لاعبًا ممتازًا في الستينات",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء مسلم ولد في البصرة له إسهامات في البصريات والمنهج العلمي وصاحب كتاب المناظر",
      "answer": "الحسن بن الهيثم",
      "hint": "أول من شرح العين تشريحًا كاملاً",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سورية كانت مركزًا للثقافة العربية والإسلامية وتشتهر بقلعتها وأسواقها القديمة",
      "answer": "حلب",
      "hint": "من أكبر المدن السورية",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر النبي وصحابي جليل اشتهر بالدفاع عن الإسلام بالشعر",
      "answer": "حسان بن ثابت",
      "hint": "شاعر النبي ﷺ",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان ثديي من فصيلة الخيول يستخدم للركوب والجر وله أنواع عربية أصيلة",
      "answer": "حصان",
      "hint": "الأنثى فرس",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "الركن الخامس من أركان الإسلام وهو زيارة بيت الله الحرام في مكة المكرمة",
      "answer": "حج",
      "hint": "يتم في شهر ذي الحجة",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "معركة فاصلة في التاريخ الإسلامي عام 1187م انتصر فيها صلاح الدين على الصليبيين",
      "answer": "حطين",
      "hint": "تقع بالقرب من طبريا",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "طبيب ومترجم عربي ترجم كتب الطب اليوناني إلى العربية",
      "answer": "حنين بن إسحاق",
      "hint": "ترجم كتب الطب اليوناني إلى العربية",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عشبي من الفصيلة البقولية تستخدم بذوره كتوابل وله فوائد صحية",
      "answer": "حلبة",
      "hint": "تستخدم لزيادة الوزن",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "منطقة تاريخية في غرب السعودية تضم مكة المكرمة والمدينة المنورة",
      "answer": "الحجاز",
      "hint": "منطقة تاريخية تضم مكة والمدينة",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء ألماني، صاحب مبدأ عدم اليقين في ميكانيكا الكم، وحصل على نوبل في الفيزياء 1932.",
      "answer": "هايزنبرج",
      "hint": "فيرنر هايزنبرج",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "ممثل ومخرج أمريكي، اشتهر بأفلام الحركة مثل 'داي هارد' و'ذا هانت فور ريد أكتوبر'.",
      "answer": "بروس ويليس",
      "hint": "يبدأ بباء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا الوسطى، ينبع من جبال بامير ويصب في بحر آرال.",
      "answer": "سيحون",
      "hint": "يبدأ بسين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني يستخدم في المعامل لقياس كثافة السوائل.",
      "answer": "هيدرومتر",
      "hint": "يبدأ بهاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس كورونا، ظهر في ووهان بالصين عام 2019.",
      "answer": "كورونا",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة الأردن.",
      "answer": "دينار",
      "hint": "يبدأ بدال",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أندلسي، اشتهر بالغزل، وله موشحات مشهورة.",
      "answer": "ابن زيدون",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة الكلبيات، يعيش في قطعان، ويتميز بعواءه الطويل.",
      "answer": "ذئب",
      "hint": "يبدأ بذال",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة مكة المكرمة، وهي محافظة ساحلية على البحر الأحمر.",
      "answer": "الليث",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم ألماني، لعب لبايرن ميونخ، ويعتبر أحد أفضل حراس المرمى في التاريخ.",
      "answer": "نوير",
      "hint": "مانويل نوير",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "لغة برمجة شهيرة، تستخدم في تطوير تطبيقات الذكاء الاصطناعي.",
      "answer": "بايثون",
      "hint": "يبدأ بباء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Au، يستخدم في صناعة الحلي.",
      "answer": "ذهب",
      "hint": "يبدأ بذال",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في شمال أوروبا، عاصمتها أوسلو، تشتهر بالمضايق البحرية.",
      "answer": "النرويج",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني الحضور أمام المحكمة والإنابة عنها.",
      "answer": "نيابة",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الاستوائية، له قشر بني ولحم أخضر، ويؤكل مع الحليب.",
      "answer": "أفوكادو",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بحكمته وأشعاره.",
      "answer": "زهير بن أبي سلمى",
      "hint": "يبدأ بزاي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بالآثار القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الجمجمة، وهو مركز الجهاز العصبي.",
      "answer": "دماغ",
      "hint": "يبدأ بدال",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "خ": [
    {
      "text": "رابع الخلفاء الراشدين وابن عم النبي محمد صلى الله عليه وسلم وزوج ابنته فاطمة",
      "answer": "خليفة علي بن أبي طالب",
      "hint": "رابع الخلفاء الراشدين",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا كانت تحت الحكم الخمير ومن أشهر معالمها أنغكور وات",
      "answer": "خمير",
      "hint": "من أشهر معالمها أنغكور وات",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة مغربية عريقة تُعد من أبرز مدن السياحة الثقافية في شمال أفريقيا",
      "answer": "خريبكة",
      "hint": "مدينة مغربية",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "رياضة قتالية يابانية الأصل تعني الطريق الفارغ",
      "answer": "خوان",
      "hint": "فن قتالي آسيوي",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "عنصر كيميائي رمزه Au وهو معدن ثمين أصفر اللون يستخدم في المجوهرات",
      "answer": "خيمياء",
      "hint": "معدن ثمين أصفر",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "طائر من أشهر الطيور الجارحة في الجزيرة العربية يستخدم في الصيد البدوي",
      "answer": "خروف",
      "hint": "طائر جارح يستخدم في الصيد",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم رياضيات فارسي مؤسس علم الجبر واشتهر بكتابه في حساب الجبر والمقابلة",
      "answer": "الخوارزمي",
      "hint": "مؤسس علم الجبر",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية تقع في منطقة عسير تشتهر بطبيعتها الخلابة وجبالها",
      "answer": "خميس مشيط",
      "hint": "في منطقة عسير",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "أسلوب قتالي ياباني يركز على المسافة وضربات اليد والقدم",
      "answer": "كاراتيه",
      "hint": "فن قتالي ياباني",
      "category": "ثقافي",
      "difficulty": "سهل"
    },
    {
      "text": "مصطلح قانوني يعني انتهاء العقد بسبب انتهاء مدته أو انتهاء الغرض منه",
      "answer": "خيار",
      "hint": "حق إنهاء العقد",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في المنطقة الشرقية، تضم أكبر حقل نفط بحري في العالم.",
      "answer": "الخفجي",
      "hint": "قرب الحدود الكويتية",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم مكسيكي، لعب لمانشستر يونايتد وريال مدريد، ويلقب بالتشيتشاريتو.",
      "answer": "خافيير هيرنانديز",
      "hint": "اسمه الأول خافيير",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "فيلسوف وعالم اجتماع ألماني، صاحب كتاب 'رأس المال'، وأحد مؤسسي النظرية الاشتراكية.",
      "answer": "ماركس",
      "hint": "كارل ماركس",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا، ينبع من جبال الهيمالايا، ويصب في بحر العرب.",
      "answer": "السند",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في المعامل لقياس الزلازل وشدتها.",
      "answer": "سيسموغراف",
      "hint": "يبدأ بسين",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض يصيب الجهاز التنفسي، يسببه فيروس كورونا المستجد.",
      "answer": "كوفيد-19",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة سويسرا.",
      "answer": "فرنك",
      "hint": "يبدأ بفاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة الأيائل، يعيش في الغابات، له قرون متفرعة.",
      "answer": "أيل",
      "hint": "يبدأ بألف",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة تاريخية في أوزبكستان، كانت مركزًا للعلوم الإسلامية، ومسقط رأس البخاري.",
      "answer": "بخارى",
      "hint": "يبدأ بباء",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم عماني، لعب في الدوري السعودي، وأحرز هدفًا مشهورًا في مرمى العراق.",
      "answer": "عماد الحوسني",
      "hint": "يبدأ بعين",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، مفتوح المصدر، يشبه يونكس.",
      "answer": "لينكس",
      "hint": "يبدأ بلام",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Pb، يستخدم في البطاريات.",
      "answer": "رصاص",
      "hint": "يبدأ براء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في غرب أفريقيا، عاصمتها داكار، تشتهر بسباق باريس-داكار.",
      "answer": "السنغال",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "مصطلح قانوني يعني التنازل عن حق أو دعوى قضائية.",
      "answer": "خلع",
      "hint": "في الزواج",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الأسماك المفترسة، يعيش في المحيطات، وله أسنان حادة.",
      "answer": "قرش",
      "hint": "يبدأ بقاف",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار.",
      "answer": "جرير",
      "hint": "يبدأ بجيم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأحمر، تابعة لمصر، تشتهر بالسياحة والغوص.",
      "answer": "الغردقة",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الرقبة، ويحتوي على الحنجرة.",
      "answer": "حلق",
      "hint": "يبدأ بحاء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "د": [
    {
      "text": "دولة عربية في الخليج العربي عاصمتها أبوظبي تشتهر بناطحات السحاب",
      "answer": "دولة الإمارات",
      "hint": "تتكون من 7 إمارات",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "نهر يمر بمصر والسودان وهو أطول أنهار العالم",
      "answer": "دجلة",
      "hint": "نهر في العراق",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مدافع إيطالي أسطوري قاد يوفنتوس لسنوات طويلة وكان القائد الشهير",
      "answer": "دييغو فوزيليني",
      "hint": "مدافع إيطالي أسطوري",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم أرجنتيني يعتبر من أعظم اللاعبين في التاريخ فاز بكأس العالم مرتين",
      "answer": "دييغو مارادونا",
      "hint": "هدف القرن لعب لنابولي",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز في الحاسوب يخزن البيانات بشكل دائم ويختصر بـ HDD",
      "answer": "دسك",
      "hint": "القرص الصلب",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عراقي حديث من رواد الشعر الحر صاحب أنشودة المطر",
      "answer": "بدر شاكر السياب",
      "hint": "توفي في الستينات",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "سورة قرآنية رقمها 19 تتحدث عن قصة مريم وولادة عيسى عليه السلام",
      "answer": "ديمقراطية",
      "hint": "سورة مريم",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة دنماركية هي عاصمة المملكة الدنماركية",
      "answer": "دنمارك",
      "hint": "عاصمة الدنمارك",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان من الثدييات البحرية يشبه الإنسان في ذكائه ويعيش في قطعان",
      "answer": "دلفين",
      "hint": "من أذكى الحيوانات",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "مصطلح قانوني يعني الالتزام الذي يقع على عاتق شخص تجاه آخر",
      "answer": "دين",
      "hint": "مال مستحق",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في شمال أفريقيا، عاصمتها الرباط، تطل على البحر الأبيض المتوسط والمحيط الأطلسي.",
      "answer": "المغرب",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم طبيعة إنجليزي، صاحب نظرية التطور والانتخاب الطبيعي.",
      "answer": "داروين",
      "hint": "تشارلز داروين",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم هولندي، لعب لأرسنال وبرشلونة، واشتهر بمهاراته العالية وتسديداته القوية.",
      "answer": "بيركامب",
      "hint": "دينيس بيركامب",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "رسام إيطالي من عصر النهضة، أشهر أعماله لوحة 'العشاء الأخير' و'الموناليزا'.",
      "answer": "دافنشي",
      "hint": "ليوناردو دافنشي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من ألمانيا ويصب في البحر الأسود، ويمر عبر عدة دول.",
      "answer": "الدانوب",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم لقياس المسافات باستخدام الليزر.",
      "answer": "ليدار",
      "hint": "يبدأ بلام",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس نقص المناعة البشرية.",
      "answer": "إيدز",
      "hint": "يبدأ بألف",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة الجزائر.",
      "answer": "دينار",
      "hint": "يبدأ بدال",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي بحري، من أذكى الحيوانات، يعيش في المحيطات.",
      "answer": "دولفين",
      "hint": "يبدأ بدال",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية، عاصمة المملكة العربية السعودية.",
      "answer": "الرياض",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم فرنسي، قاد فرنسا للفوز بكأس العالم 1998، واشتهر بالركلات الحرة.",
      "answer": "زيدان",
      "hint": "زين الدين زيدان",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "لغة برمجة شهيرة، تستخدم في تطوير تطبيقات الويب.",
      "answer": "جافا سكريبت",
      "hint": "يبدأ بجيم",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Ag، يستخدم في صناعة العملات.",
      "answer": "فضة",
      "hint": "يبدأ بفاء",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها كوالالمبور، تشتهر بأبراج بتروناس.",
      "answer": "ماليزيا",
      "hint": "يبدأ بميم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني المسؤولية المدنية عن تعويض الضرر.",
      "answer": "ضمان",
      "hint": "يبدأ بضاد",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الصيفية، له نواة كبيرة، ولب أصفر.",
      "answer": "مشمش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، فلسطيني، كتب 'بطاقة هوية'.",
      "answer": "محمود درويش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع بين الرأس والجذع.",
      "answer": "رقبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ذ": [
    {
      "text": "نبي الله الذي ابتلع الحوت وأقام في بطنه فسبّح الله",
      "answer": "ذو النون",
      "hint": "صاحب الحوت",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "حيوان مفترس من فصيلة الكلبيات يصطاد في قطعان ويتميز بعوائه الشهير",
      "answer": "ذئب",
      "hint": "رمز المفترس في الأساطير",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "معدن ثمين أصفر اللون يستخدم في المجوهرات والاحتياطيات النقدية",
      "answer": "ذهب",
      "hint": "المعدن الأصفر الثمين",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "وحدة صغيرة من المادة تتكون من نواة وإلكترونات",
      "answer": "ذرة",
      "hint": "أصغر وحدة في المادة",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "سورة قرآنية رقمها 51 تتحدث عن الرياح وأهوال يوم القيامة",
      "answer": "الذاريات",
      "hint": "سورة الذاريات",
      "category": "ديني",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر جاهلي اشتهر بصعلكته وكان يتسم بالشجاعة والإقدام",
      "answer": "ذو الرمة",
      "hint": "شاعر أموي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان مسؤول عن تذوق الطعام ونطق الكلام",
      "answer": "ذقن",
      "hint": "جزء من الوجه",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "مصطلح في الفلسفة يعني الهوية الشخصية والكيان الفردي",
      "answer": "ذات",
      "hint": "الكيان الداخلي للإنسان",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "اسم عربي يعني صاحب القرنين وهو ملك عادل ورد ذكره في القرآن الكريم",
      "answer": "ذو القرنين",
      "hint": "ورد ذكره في سورة الكهف",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية في جازان تشتهر بطبيعتها وجبالها الخضراء",
      "answer": "ذهبان",
      "hint": "منطقة ساحلية في غرب السعودية",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي من فصيلة الأيائل، يعيش في المناطق الجبلية، ويتميز بقرونه الطويلة المتفرعة، وهو سريع الجري.",
      "answer": "ذلفاء",
      "hint": "نوع من الغزلان",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة تاريخية في جنوب اليمن، كانت عاصمة مملكة حضرموت القديمة، وتشتهر بواديها وقصورها الأثرية.",
      "answer": "ذمار",
      "hint": "تبعد عن صنعاء بحوالي 100 كم",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "صحابي جليل، كان قائدًا للمسلمين في معركة اليرموك، وعُرف بسيفه المسلول.",
      "answer": "ذو الفقار",
      "hint": "سيف النبي ﷺ",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم في المختبرات لقياس كمية الضوء الممتصة من قبل مادة كيميائية.",
      "answer": "ذو اللون",
      "hint": "يقيس الامتصاصية",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عشبي حولي، أوراقه عطرية، يستخدم في الطهي والطب الشعبي كمهدئ للأعصاب.",
      "answer": "ذنبان",
      "hint": "شبيه بالريحان",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم سعودي سابق، لعب للنصر والمنتخب، واشتهر بقدراته التهديفية العالية.",
      "answer": "ذويخ",
      "hint": "منذر ذويخ",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "مصطلح قانوني يعني الحق الشخصي الذي يثبت للفرد، ويطالب به أمام القضاء.",
      "answer": "ذمة",
      "hint": "الذمة المالية",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جبل في مكة المكرمة، يقع بالقرب من مشعر عرفة، وله أهمية تاريخية.",
      "answer": "ذُباب",
      "hint": "جبل ذباب",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جزء من النبات، هو الجزء الذي ينمو من البذرة ويتجه إلى أسفل التربة.",
      "answer": "ذنب",
      "hint": "الجذر",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مؤرخ وفيلسوف عربي، يعتبر مؤسس علم الاجتماع، صاحب كتاب 'المقدمة'.",
      "answer": "ابن خلدون",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة في شمال الأردن، تشتهر بآثارها الرومانية القديمة.",
      "answer": "جرش",
      "hint": "يبدأ بجيم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم لقياس شدة الإشعاع النووي.",
      "answer": "عداد جايجر",
      "hint": "يبدأ بعين",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض جلدي معدي يسببه طفيلي الجرب، ويسبب حكة شديدة.",
      "answer": "جرب",
      "hint": "يبدأ بجيم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة كازاخستان.",
      "answer": "تينغ",
      "hint": "يبدأ بتاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم برازيلي، لعب لبرشلونة والمنتخب البرازيلي، اشتهر بمهاراته الفائقة.",
      "answer": "رونالدينيو",
      "hint": "يبدأ براء",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من السمك البحري الصغير، يستخدم في صناعة المعلبات.",
      "answer": "سردين",
      "hint": "يبدأ بسين",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر من سوريا، له قصيدة 'أنا يوسف يا أبي'.",
      "answer": "عدنان الصائغ",
      "hint": "يبدأ بعين",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط تابعة لإيطاليا، تشتهر بجمال طبيعتها.",
      "answer": "كابري",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو الجزء الذي يربط بين الكتف واليد.",
      "answer": "عضد",
      "hint": "يبدأ بعين",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ر": [
    {
      "text": "مهاجم برتغالي أسطوري سجل أكثر من 900 هدف رسمي واشتهر بقفزاته العالية وتسديداته القوية",
      "answer": "رونالدو",
      "hint": "يلقب بالدون لعب لريال مدريد",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "عاصمة المملكة العربية السعودية وأكبر مدنها",
      "answer": "الرياض",
      "hint": "مركز الحكم والإدارة",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 13 تتحدث عن ظواهر كونية وقصص الأنبياء",
      "answer": "الرعد",
      "hint": "السورة باسم ظاهرة جوية",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة روسيا تنقسم إلى 100 كوبيك",
      "answer": "روبل",
      "hint": "عملة روسية",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم إيطالي فاز بكأس العالم 1994 واشتهر بضفيرته وضرباته الحرة",
      "answer": "روبرتو باجيو",
      "hint": "أضاع ركلة جزاء في نهائي كأس العالم 1994",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عشبي له رائحة عطرية قوية يستخدم في الطهي وورد ذكره في القرآن",
      "answer": "ريحان",
      "hint": "يذكر في القرآن",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "نهر أوروبي ينبع من سويسرا ويصب في بحر الشمال يمر بعدة دول",
      "answer": "راين",
      "hint": "نهر الراين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة أثرية في الأردن تعتبر من عجائب الدنيا السبع الجديدة وتسمى المدينة الوردية",
      "answer": "البتراء",
      "hint": "عاصمة الأنباط",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مكتشف الأشعة السينية وحصل على جائزة نوبل عام 1901",
      "answer": "رونتغن",
      "hint": "اكتشف الأشعة التي سميت باسمه",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعرة صوفية مشهورة بأشعار الحب الإلهي من أبرز متصوفي الإسلام",
      "answer": "رابعة العدوية",
      "hint": "من أشهر الصوفيات",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء إنجليزي، مكتشف الإلكترون، وحصل على جائزة نوبل في الفيزياء.",
      "answer": "طومسون",
      "hint": "جوزيف جون طومسون",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "ممثل ومخرج أمريكي، اشتهر بأفلام الأكشن مثل 'روكي' و'رامبو'.",
      "answer": "ستالوني",
      "hint": "سيلفستر ستالوني",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من جبال الألب في سويسرا ويصب في بحر الشمال، ويمر بألمانيا وهولندا.",
      "answer": "الراين",
      "hint": "نهر الراين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني صغير يستخدم للتحكم عن بعد في الأجهزة المنزلية.",
      "answer": "ريموت",
      "hint": "ريموت كنترول",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض وراثي يصيب الدم، ويؤدي إلى تكسر خلايا الدم الحمراء.",
      "answer": "روماتيزم",
      "hint": "أنيميا منجلية",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة الهند.",
      "answer": "روبية",
      "hint": "يبدأ براء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي من المعلقات، اشتهر بوصف الخيل والحرب.",
      "answer": "ربيعة",
      "hint": "ربيعة بن مقروم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي من القوارض، يعيش في الحقول، له ذيل طويل وأسنان قوية.",
      "answer": "فأر",
      "hint": "يبدأ بفاء",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة ساحلية في لبنان، من أقدم المدن المأهولة في العالم.",
      "answer": "بيروت",
      "hint": "يبدأ بباء",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم إيطالي، قاد إيطاليا للفوز بكأس العالم 2006، واشتهر بالدفاع القوي.",
      "answer": "كانافارو",
      "hint": "يبدأ بكاف",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للهواتف الذكية، طورته جوجل.",
      "answer": "أندرويد",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "عنصر كيميائي رمزه Cu، يستخدم في صناعة الأسلاك الكهربائية.",
      "answer": "نحاس",
      "hint": "يبدأ بنون",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها بانكوك، تشتهر بالسياحة والأكل الحار.",
      "answer": "تايلاند",
      "hint": "يبدأ بتاء",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني الرجوع في الهبة أو العطية.",
      "answer": "رجوع",
      "hint": "نقيض الإعطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الحمضية، لونه برتقالي، غني بفيتامين سي.",
      "answer": "برتقال",
      "hint": "يبدأ بباء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل الصريح، له قصص مع ليلى الأخيلية.",
      "answer": "قيس بن الملوح",
      "hint": "يبدأ بقاف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الكاريبي، تشتهر بقراصنتها ومنتجعاتها.",
      "answer": "جامايكا",
      "hint": "يبدأ بجيم",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو الجزء الذي يصل بين القدم والساق.",
      "answer": "كاحل",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ز": [
    {
      "text": "لاعب كرة قدم فرنسي من أصل جزائري قاد فرنسا للفوز بكأس العالم 1998 واشتهر بالمراوغة والمقصية",
      "answer": "زين الدين زيدان",
      "hint": "اشتهر بمقصيته في دوري الأبطال",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "أبو الجراحة الحديثة عالم عربي صاحب كتاب التصريف في الطب",
      "answer": "الزهراوي",
      "hint": "أبو الجراحة الحديثة",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر من أصحاب المعلقات اشتهر بحكمته وشعره الجاهلي",
      "answer": "زهير بن أبي سلمى",
      "hint": "شاعر الحوليات",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان أفريقي من أطول الحيوانات برقبته الطويلة التي تساعده في الوصول لأوراق الشجر",
      "answer": "زرافة",
      "hint": "أطول حيوان بري",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "مدينة سويسرية مركز مالي عالمي وأكبر مدن سويسرا",
      "answer": "زيورخ",
      "hint": "مركز مالي عالمي",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "فيلسوف يوناني مؤسس المدرسة الرواقية",
      "answer": "زينون",
      "hint": "زينون الرواقي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 43 فيها آيات عن زينة الحياة الدنيا",
      "answer": "الزخرف",
      "hint": "السورة باسم الذهب والحلي",
      "category": "ديني",
      "difficulty": "صعب"
    },
    {
      "text": "برنامج اتصال شهير يتيح إجراء مكالمات فيديو ازداد استخدامه أثناء جائحة كورونا",
      "answer": "زووم",
      "hint": "ازداد استخدامه أثناء كورونا",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "نبات عطري يستخدم مع اللحم وفي الشاي وله فوائد طبية",
      "answer": "زعتر",
      "hint": "يستخدم في الطبخ والشاي",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "عملة بولندا",
      "answer": "زلوتي",
      "hint": "العملة البولندية",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية في منطقة القصيم، تشتهر بزراعة التمور وجودة تمورها.",
      "answer": "الزلفي",
      "hint": "شمال الرياض",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عالم نبات سويدي، وضع نظام التصنيف الحديث للكائنات الحية.",
      "answer": "لينيوس",
      "hint": "كارل لينيوس",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم فرنسي من أصل جزائري، قاد فرنسا للفوز بكأس العالم 1998، وصنع هدف الفوز في النهائي.",
      "answer": "زيدان",
      "hint": "زين الدين زيدان",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "رسام هولندي، اشتهر برسم لوحات الطبيعة والأشخاص، ومن أشهر لوحاته 'ليلة النجوم'.",
      "answer": "فان جوخ",
      "hint": "يبدأ بفاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من أوكرانيا ويصب في البحر الأسود، وهو أطول أنهار أوكرانيا.",
      "answer": "دنيبر",
      "hint": "يبدأ بدال",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في التصوير الفوتوغرافي لتكبير الصور.",
      "answer": "زوم",
      "hint": "عدسة الزوم",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض معدي يسببه فيروس، ينتقل عن طريق البعوض، ويسبب حمى وآلامًا في المفاصل.",
      "answer": "زيكا",
      "hint": "فيروس زيكا",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار مع جرير والأخطل.",
      "answer": "الفرزدق",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة البقريات، يتميز بقرونه الطويلة الملتفة، ويعيش في المناطق الجبلية.",
      "answer": "وعل",
      "hint": "يبدأ بواو",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة تاريخية في اليمن، كانت مركزًا للمملكة الحميرية، وتشتهر بآثارها.",
      "answer": "ظفار",
      "hint": "يبدأ بظاء",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم إسباني، لعب لبرشلونة، ويُعتبر أحد أفضل لاعبي خط الوسط في التاريخ.",
      "answer": "تشافي",
      "hint": "يبدأ بتاء",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "لغة برمجة شهيرة، تستخدم في تطوير تطبيقات الذكاء الاصطناعي.",
      "answer": "بايثون",
      "hint": "يبدأ بباء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Zn، يستخدم في جلفنة الحديد لحمايته من الصدأ.",
      "answer": "زنك",
      "hint": "يبدأ بزاي",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في غرب أفريقيا، عاصمتها نيامي، تشتهر بصحرائها ومناجم اليورانيوم.",
      "answer": "النيجر",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "مصطلح قانوني يعني تزوير المستندات أو التوقيعات.",
      "answer": "زور",
      "hint": "تزوير",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الأسماك البحرية، لونه فضي، يعيش في المياه الضحلة.",
      "answer": "بوري",
      "hint": "يبدأ بباء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي معاصر، من سوريا، اشتهر بقصيدة 'أنا الدمشقي'.",
      "answer": "نزار قباني",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بجمالها.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو الجزء الذي يقع بين الرأس والجذع.",
      "answer": "رقبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "س": [
    {
      "text": "لاعب كرة قدم مصري لعب لليفربول وحقق معهم الدوري الإنجليزي ودوري الأبطال ويعتبر أفضل هداف عربي",
      "answer": "محمد صلاح",
      "hint": "يلقب بالفرعون المصري",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "دولة في شبه الجزيرة العربية عاصمتها الرياض وهي مهبط الوحي",
      "answer": "السعودية",
      "hint": "المملكة العربية السعودية",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "فيلسوف وجودي فرنسي رفض جائزة نوبل وصاحب كتاب الوجود والعدم",
      "answer": "سارتر",
      "hint": "رفض جائزة نوبل",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 36 وتسمى قلب القرآن",
      "answer": "يس",
      "hint": "تبدأ بحرفي الياء والسين",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان زاحف من رتبة الحرشفيات يتميز بجلده الجاف وأنواعه كثيرة منها أليف",
      "answer": "سحلية",
      "hint": "توجد منها أنواع كثيرة",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة عراقية مقدسة تضم مرقد الإمامين العسكريين",
      "answer": "سامراء",
      "hint": "تضم مرقد الإمامين العسكريين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جزء من الذراع بين المرفق والرسغ",
      "answer": "ساعد",
      "hint": "بين المرفق والرسغ",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة هي جزء من مائة من العملة الأساسية في كثير من الدول",
      "answer": "سنت",
      "hint": "جزء من مائة من العملة الأساسية",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "نبات زيتي تصنع منه الطحينة والحلاوة الطحينية",
      "answer": "سمسم",
      "hint": "يصنع منه الطحينة والحلاوة",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "فيلسوف يوناني اشتهر بطريقة الحوار والتساؤل وهو معلم أفلاطون",
      "answer": "سقراط",
      "hint": "فيلسوف يوناني اشتهر بالحوار",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء إيطالي، اخترع أول بطارية كهربائية، وسميت على اسمه وحدة قياس الجهد الكهربائي.",
      "answer": "فولتا",
      "hint": "ألساندرو فولتا",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم مصري، لعب لليفربول وحقق معهم الدوري الإنجليزي ودوري الأبطال، ويعتبر أفضل هداف أفريقي في التاريخ.",
      "answer": "صلاح",
      "hint": "محمد صلاح",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "مخرج سينمائي أمريكي، اشتهر بأفلام الخيال العلمي مثل 'حرب النجوم' و'إنديانا جونز'.",
      "answer": "سبيلبرغ",
      "hint": "ستيفن سبيلبرغ",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا الوسطى، ينبع من جبال بامير ويصب في بحر آرال.",
      "answer": "سيحون",
      "hint": "يسمى أيضًا نهر سير داريا",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني يستخدم لتخزين البيانات ونقلها بين الأجهزة، ويوصل عبر منفذ USB.",
      "answer": "فلاشة",
      "hint": "ذاكرة USB",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض مزمن يصيب الجهاز التنفسي، يسبب صعوبة في التنفس وأزيزًا في الصدر.",
      "answer": "ربو",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة روسيا.",
      "answer": "روبل",
      "hint": "يبدأ براء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان زاحف، من رتبة الحرشفيات، يتميز بجلده الجاف وقدرته على تغيير لونه.",
      "answer": "حرباء",
      "hint": "يبدأ بحاء",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة عراقية مقدسة عند الشيعة، تضم مرقد الإمام علي بن أبي طالب.",
      "answer": "النجف",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم إسباني، لعب لبرشلونة، ويعتبر أحد أفضل صانعي الألعاب في التاريخ.",
      "answer": "إنييستا",
      "hint": "أندريس إنييستا",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، مفتوح المصدر، يستخدم بكثرة في الخوادم.",
      "answer": "لينكس",
      "hint": "يبدأ بلام",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه S، يستخدم في صناعة حامض الكبريتيك.",
      "answer": "كبريت",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها سنغافورة، وهي مدينة ودولة في آن واحد.",
      "answer": "سنغافورة",
      "hint": "يبدأ بسين",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني وثيقة تثبت حقًا أو دينًا على شخص.",
      "answer": "سند",
      "hint": "سند دين",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الخضروات الورقية، يستخدم في السلطات والطبخ، غني بالحديد.",
      "answer": "سبانخ",
      "hint": "يبدأ بسين",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار.",
      "answer": "جرير",
      "hint": "يبدأ بجيم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بالآثار القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الجمجمة، وهو مركز الجهاز العصبي.",
      "answer": "دماغ",
      "hint": "يبدأ بدال",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ش": [
    {
      "text": "هداف الدوري الإنجليزي التاريخي لعب لنيوكاسل وبلاك بيرن",
      "answer": "آلان شيرر",
      "hint": "هداف الدوري الإنجليزي التاريخي",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر مصري لقب بأمير الشعراء وله قصائد وطنية خالدة",
      "answer": "أحمد شوقي",
      "hint": "شاعر مصري لقب بأمير الشعراء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء نمساوي صاحب قطة شهيرة في ميكانيكا الكم",
      "answer": "إرفين شرودنغر",
      "hint": "صاحب قطة شرودنغر الشهيرة",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "إمارة ثقافية في الإمارات تضم العديد من المتاحف",
      "answer": "الشارقة",
      "hint": "إمارة ثقافية تضم العديد من المتاحف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة إيرانية كانت عاصمة للدولة الزندية وتشتهر بالأدب والورود",
      "answer": "شيراز",
      "hint": "مدينة إيرانية تشتهر بالشعر والورود",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "سورة قرآنية رقمها 26 تتحدث عن قصة موسى وفرعون والرسل",
      "answer": "الشعراء",
      "hint": "السورة باسم الشعراء",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "مؤلف موسيقي نمساوي ألف أكثر من 600 أغنية ومن أعلام الموسيقى الكلاسيكية",
      "answer": "فرانز شوبرت",
      "hint": "ألف أكثر من 600 أغنية",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزء من الوجه يُستخدم في الأكل والكلام",
      "answer": "شفة",
      "hint": "جزء من الفم",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "لاعب إسباني لعب لريال مدريد في مركز الظهير الأيسر",
      "answer": "شولز",
      "hint": "ظهير ألماني في الدوري الألماني",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عطري يستخدم في الطبخ ولتجديد النفس",
      "answer": "شمر",
      "hint": "يستخدم في الطبخ والطب الشعبي",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في الخليج العربي، عاصمتها الدوحة، وتشتهر بالغاز الطبيعي واستضافتها كأس العالم 2022.",
      "answer": "قطر",
      "hint": "يبدأ بقاف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء نمساوي، صاحب معادلة شرودنغر في ميكانيكا الكم، وله قطة شهيرة.",
      "answer": "شرودنغر",
      "hint": "إرفين شرودنغر",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم إنجليزي، أسطورة نيوكاسل يونايتد، هداف الدوري الإنجليزي التاريخي.",
      "answer": "شيرر",
      "hint": "آلان شيرر",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "مؤلف موسيقي نمساوي، من أعلام الموسيقى الكلاسيكية، ألف السمفونية غير المكتملة.",
      "answer": "شوبرت",
      "hint": "فرانز شوبرت",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في العراق، ينبع من تركيا، ويلتقي مع دجلة في شط العرب.",
      "answer": "الفرات",
      "hint": "يبدأ بفاء",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم لقياس سرعة الرياح.",
      "answer": "انيمومتر",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض جلدي معدي يسببه طفيلي الجرب، ويسبب حكة شديدة.",
      "answer": "جرب",
      "hint": "يبدأ بجيم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة إسرائيل.",
      "answer": "شيكل",
      "hint": "يبدأ بشين",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة الكلبيات، يعيش في قطعان، ويتميز بعواءه الطويل.",
      "answer": "ذئب",
      "hint": "يبدأ بذال",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة مكة المكرمة، وهي محافظة ساحلية على البحر الأحمر.",
      "answer": "الليث",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم ألماني، لعب لبايرن ميونخ، ويعتبر أحد أفضل حراس المرمى في التاريخ.",
      "answer": "نوير",
      "hint": "مانويل نوير",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "لغة برمجة شهيرة، تستخدم في تطوير تطبيقات الذكاء الاصطناعي.",
      "answer": "بايثون",
      "hint": "يبدأ بباء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Cl، يستخدم في تعقيم المياه.",
      "answer": "كلور",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في شمال أوروبا، عاصمتها أوسلو، تشتهر بالمضايق البحرية.",
      "answer": "النرويج",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني إفادة أمام المحكمة تحت القسم.",
      "answer": "شهادة",
      "hint": "يبدأ بشين",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "نوع من الفواكه الاستوائية، له قشر بني ولحم أخضر، ويؤكل مع الحليب.",
      "answer": "أفوكادو",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي معاصر، فلسطيني، كتب 'بطاقة هوية'.",
      "answer": "محمود درويش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع بين الرأس والجذع.",
      "answer": "رقبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ص": [
    {
      "text": "لاعب كرة قدم مصري لعب للأهلي وليفربول وهو أفضل هداف عربي في دوري الأبطال",
      "answer": "محمد صلاح",
      "hint": "يلقب بالفرعون",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "عاصمة اليمن وأقدم مدينة مأهولة باستمرار في العالم",
      "answer": "صنعاء",
      "hint": "أقدم مدينة مأهولة باستمرار",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "طائر جارح يتميز ببصره الحاد ويستخدم في الصيد البدوي",
      "answer": "صقر",
      "hint": "طائر جارح مشهور",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 38 وتسمى بسورة داود عليه السلام",
      "answer": "ص",
      "hint": "تبدأ بحرف صاد",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "الجزء الأمامي من الجذع يحتوي على القلب والرئتين",
      "answer": "صدر",
      "hint": "يحتوي على القلب والرئتين",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم كاميروني لعب لبرشلونة وهو من أبرز أساطير الكرة الأفريقية",
      "answer": "صامويل إيتو",
      "hint": "هداف المنتخب الكاميروني لعب لبرشلونة",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "اتفاق ينهي نزاعًا قضائياً بدلاً من الحكم القضائي",
      "answer": "صلح",
      "hint": "اتفاق ينهي نزاعًا",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات شوكي يستخدم في مستحضرات التجميل والطب",
      "answer": "صبار",
      "hint": "نبات شوكي يستخدم في مستحضرات التجميل",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة لبنانية على البحر المتوسط من أقدم المدن الساحلية",
      "answer": "صيدا",
      "hint": "مدينة لبنانية على البحر المتوسط",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "أكبر جزيرة في البحر المتوسط تابعة لإيطاليا",
      "answer": "صقلية",
      "hint": "أكبر جزيرة في البحر المتوسط",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في شمال أفريقيا، عاصمتها الرباط، وتشتهر بمدنها التاريخية مثل مراكش وفاس.",
      "answer": "المغرب",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم رياضيات وفيزياء إنجليزي، وضع قوانين الحركة والجاذبية.",
      "answer": "نيوتن",
      "hint": "يبدأ بنون",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم مصري، لعب للأهلي وليفربول، ويعتبر أفضل هداف عربي في التاريخ.",
      "answer": "صلاح",
      "hint": "محمد صلاح",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "رسام ونحات إيطالي من عصر النهضة، أشهر أعماله تمثال داوود ولوحة السقف في كنيسة سيستين.",
      "answer": "مايكل أنجلو",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أفريقيا، أطول أنهار العالم، يمر بمصر والسودان.",
      "answer": "النيل",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم لتحديد المواقع عبر الأقمار الصناعية.",
      "answer": "جي بي إس",
      "hint": "GPS",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض يصيب المفاصل بسبب تراكم حمض البوليك، ويسبب ألمًا شديدًا.",
      "answer": "نقرس",
      "hint": "يبدأ بنون",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة الصين.",
      "answer": "يوان",
      "hint": "يبدأ بياء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بحكمته وأشعاره.",
      "answer": "زهير بن أبي سلمى",
      "hint": "يبدأ بزاي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة السنوريات، يعيش في الغابات، ويتميز بخطوطه السوداء.",
      "answer": "نمر",
      "hint": "يبدأ بنون",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية، عاصمة المملكة العربية السعودية.",
      "answer": "الرياض",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم أرجنتيني، لعب لبرشلونة وإنتر ميامي، ويعتبر أحد أعظم اللاعبين.",
      "answer": "ميسي",
      "hint": "ليونيل ميسي",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "نظام تشغيل للهواتف الذكية، طورته أبل.",
      "answer": "آي أو إس",
      "hint": "iOS",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه C، أساس الحياة على الأرض.",
      "answer": "كربون",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها جاكرتا، وهي أكبر دولة إسلامية من حيث عدد السكان.",
      "answer": "إندونيسيا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني إبطال العقد أو فسخه.",
      "answer": "فسخ",
      "hint": "يبدأ بفاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار.",
      "answer": "الفرزدق",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في البطن، ويساعد في هضم الطعام.",
      "answer": "أمعاء",
      "hint": "يبدأ بألف",
      "category": "علوم",
      "difficulty": "صعب"
    }
  ],
  "ض": [
    {
      "text": "حيوان مفترس يأكل الجيف ويعيش في أفريقيا وآسيا",
      "answer": "ضبع",
      "hint": "حيوان مفترس يأكل الجيف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "السن الخلفي في الفم يستخدم لطحن الطعام",
      "answer": "ضرس",
      "hint": "سن من الأسنان الخلفية",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "مصطلح قانوني يعني المسؤولية القانونية بتعويض الضرر",
      "answer": "ضمان",
      "hint": "التزام قانوني بتعويض الضرر",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "قبيلة عربية جاهلية ورد ذكرها في قصة ثمود في القرآن",
      "answer": "ضرار بن الخطاب",
      "hint": "شاعر قرشي أسلم يوم الفتح",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "سورة قصيرة في القرآن الكريم رقمها 93",
      "answer": "الضحى",
      "hint": "سورة قصيرة في جزء عم",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "محافظة سعودية في منطقة تبوك على ساحل البحر الأحمر",
      "answer": "ضباء",
      "hint": "محافظة سعودية في تبوك",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "بلدة في نجد قرب الرياض",
      "answer": "ضرماء",
      "hint": "بلدة في نجد قرب الرياض",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "الحرف العربي الذي يميز اللغة العربية عن غيرها",
      "answer": "الضاد",
      "hint": "حرف يميز اللغة العربية",
      "category": "ثقافي",
      "difficulty": "سهل"
    },
    {
      "text": "شاعر جاهلي مشهور بشعره في الحرب والفروسية",
      "answer": "ضمرة",
      "hint": "شاعر جاهلي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "ظاهرة طبيعية تحدث بسبب اختلاف الضغط الجوي وتسبب غيوماً وأمطاراً",
      "answer": "ضباب",
      "hint": "ظاهرة جوية تسبب قلة الرؤية",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة أثرية في المملكة العربية السعودية، تقع شمال غرب البلاد، وتضم بقايا معابد ونقوش نبطية قديمة.",
      "answer": "ضبا",
      "hint": "محافظة ساحلية في تبوك",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي من بني عبس، اشتهر بالفروسية والشعر، وكان أحد أبطال حرب داحس والغبراء.",
      "answer": "ضرار بن الأزور",
      "hint": "صحابي جليل أيضًا",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مركز إداري في منطقة عسير جنوب غرب السعودية، يشتهر بزراعة البن والمناظر الجبلية الخلابة.",
      "answer": "ضمد",
      "hint": "محافظة ضمد",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم سعودي سابق، لعب للنصر والمنتخب، وكان معروفًا بقوته التهديفية في الثمانينات.",
      "answer": "ضيف الله",
      "hint": "ضيف الله القرني",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عشبي معمر، ينمو في المناطق الجافة، له أوراق شوكية وأزهار صفراء، يستخدم في الطب الشعبي.",
      "answer": "ضمران",
      "hint": "يسمى أيضًا العرفج",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "موقعة تاريخية حدثت في صدر الإسلام بين المسلمين وقبيلة هوازن، وكانت بعد فتح مكة مباشرة.",
      "answer": "حنين",
      "hint": "يبدأ بحاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في قياس الضغط الجوي، اخترعه العالم الإيطالي إيفانجليستا توريتشيلي.",
      "answer": "بارومتر",
      "hint": "يبدأ بباء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو الجزء البارز في الوجه أسفل الفم ويغطي الأسنان.",
      "answer": "شفة",
      "hint": "يبدأ بشين",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة سوريا.",
      "answer": "ليرة",
      "hint": "يبدأ بلام",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي أندلسي، عاصر الخلافة الأموية في الأندلس، له قصائد في الغزل والطبيعة.",
      "answer": "ابن زيدون",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في المحيط الهندي، تابعة لتنزانيا، تشتهر بتوابلها وثقافتها السواحيلية.",
      "answer": "زنجبار",
      "hint": "يبدأ بزاي",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الاستوائية، له قشر أخضر ولب أبيض، ويحتوي على بذور سوداء.",
      "answer": "جوافة",
      "hint": "يبدأ بجيم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "مخرج سينمائي أمريكي من أصل صيني، أخرج فيلم 'النمر الرابض والتنين الخفي'.",
      "answer": "أنج لي",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Al، يستخدم في صناعة الطائرات والأواني المنزلية.",
      "answer": "ألومنيوم",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب القوقاز، عاصمتها باكو، تشتهر بالنفط والغاز.",
      "answer": "أذربيجان",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم ألماني، لعب لبايرن ميونخ والمنتخب الألماني، اشتهر بالتمريرات الدقيقة.",
      "answer": "توماس مولر",
      "hint": "يبدأ بتاء",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عطري يستخدم في الطهي والطب، يشبه البقدونس، وله أوراق ريشية.",
      "answer": "كزبرة",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ط": [
    {
      "text": "شاعر جاهلي من أصحاب المعلقات مطلع معلقته لخولة أطلال ببرقة ثهمد",
      "answer": "طرفة بن العبد",
      "hint": "من شعراء المعلقات",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يطبع المستندات والصور ويتصل بالحاسوب",
      "answer": "طابعة",
      "hint": "جهاز يطبع المستندات والصور",
      "category": "علمي",
      "difficulty": "سهل"
    },
    {
      "text": "مدينة مصرية في الدلتا تشتهر بالقطن وصناعته",
      "answer": "طنطا",
      "hint": "مدينة مصرية في الدلتا",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 20",
      "answer": "طه",
      "hint": "تبدأ بحرفي الطاء والهاء",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "طائر معروف بجمال ريشه الملون",
      "answer": "طاووس",
      "hint": "طائر معروف بجمال ريشه",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "نبات عطري يستخدم في السلطات وله خصائص طبية",
      "answer": "طرخون",
      "hint": "نبات عطري يستخدم في السلطات",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "الاعتراض على حكم قضائي أمام محكمة أعلى",
      "answer": "طعن",
      "hint": "الاعتراض على حكم قضائي",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "واجهة سطر الأوامر في الحاسوب",
      "answer": "طرفية",
      "hint": "واجهة سطر الأوامر",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "محافظة سعودية في الحدود الشمالية",
      "answer": "طريف",
      "hint": "محافظة سعودية في الحدود الشمالية",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "مكتشف الإلكترون وحصل على نوبل في الفيزياء 1906",
      "answer": "جوزيف جون طومسون",
      "hint": "اكتشف الإلكترون",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية مقدسة، تقع في منطقة مكة المكرمة، وهي مقصد الحجاج والمعتمرين.",
      "answer": "الطائف",
      "hint": "مصايفها الجميلة",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء ورياضيات إنجليزي، وضع قوانين الحركة والجاذبية، واكتشف تركيب الضوء.",
      "answer": "نيوتن",
      "hint": "يبدأ بنون",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم كرواتي، لعب لريال مدريد، وقاد منتخب بلاده للوصول إلى نهائي كأس العالم 2018.",
      "answer": "مودريتش",
      "hint": "لوكا مودريتش",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "مغني وموسيقي أمريكي، اشتهر بأغاني البوب والروك، مثل 'بيلي جين' و'ثريلر'.",
      "answer": "مايكل جاكسون",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أفريقيا، ينبع من بحيرة فيكتوريا ويصب في البحر الأبيض المتوسط، وهو أطول أنهار العالم.",
      "answer": "النيل",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض معدي يسببه فيروس، ينتقل عن طريق البعوض، ويسبب آلامًا في المفاصل وحمى.",
      "answer": "شيكونغونيا",
      "hint": "يبدأ بشين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة تركيا.",
      "answer": "ليرة",
      "hint": "يبدأ بلام",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي من فصيلة القرود، يعيش في غابات أفريقيا وآسيا، يتميز بذيله الطويل.",
      "answer": "قرد",
      "hint": "يبدأ بقاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة تاريخية في تونس، كانت عاصمة الدولة الفاطمية، وتضم جامع الزيتونة.",
      "answer": "تونس",
      "hint": "يبدأ بتاء",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم إنجليزي، أسطورة مانشستر يونايتد، هداف النادي التاريخي.",
      "answer": "واين روني",
      "hint": "يبدأ بواو",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة أبل، ويتميز بواجهته الرسومية الأنيقة.",
      "answer": "ماك أو إس",
      "hint": "macOS",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه U، يستخدم في توليد الطاقة النووية.",
      "answer": "يورانيوم",
      "hint": "يبدأ بياء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب أوروبا، عاصمتها أثينا، تشتهر بجزرها الساحرة وتاريخها القديم.",
      "answer": "اليونان",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "نوع من الخضروات الجذرية، لونه برتقالي، غني بفيتامين أ، يستخدم في السلطات.",
      "answer": "جزر",
      "hint": "يبدأ بجيم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر من العراق، اشتهر بقصيدته 'أنشودة المطر'.",
      "answer": "بدر شاكر السياب",
      "hint": "يبدأ بباء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لإيطاليا، تشتهر ببركان إتنا.",
      "answer": "صقلية",
      "hint": "يبدأ بصاد",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو الجزء الذي يصل بين الجذع والطرف العلوي.",
      "answer": "كتف",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ظ": [
    {
      "text": "حيوان من فصيلة الغزلان يتميز بقرونه ورشاقته ويعيش في الصحراء",
      "answer": "ظبي",
      "hint": "الظبي أو الغزال",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "الجزء الصلب في أطراف الأصابع",
      "answer": "ظفر",
      "hint": "الجزء الصلب في أطراف الأصابع",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "مدينة تاريخية في اليمن وكانت عاصمة الدولة الحميرية",
      "answer": "ظفار",
      "hint": "مدينة تاريخية في اليمن",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "محافظة في سلطنة عمان تشتهر بصلالة وطبيعتها الخضراء",
      "answer": "ظفار عمان",
      "hint": "في جنوب سلطنة عمان",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر أندلسي من العصر الموحدي",
      "answer": "ظافر الحداد",
      "hint": "شاعر أندلسي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "ظاهرة جوية تنشأ من تراكم بخار الماء القريب من سطح الأرض وتسبب قلة الرؤية",
      "answer": "ظباب",
      "hint": "ظاهرة جوية تسبب قلة الرؤية",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "ظاهرة طبيعية تحدث بسبب الزلازل والانفجارات البركانية",
      "answer": "ظاهرة",
      "hint": "كلمة عامة لظواهر طبيعية",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "لاعب كرة قدم عراقي سابق اشتهر بمهاراته في السبعينيات",
      "answer": "ظافر",
      "hint": "لاعب عراقي سابق",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "مصطلح ديني يعني الصلاة الرابعة في اليوم",
      "answer": "ظهر",
      "hint": "صلاة منتصف النهار",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "جبل في مكة المكرمة مشهور",
      "answer": "ظبير",
      "hint": "جبل في مكة المكرمة",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي من بني تميم، كان فارسًا وشاعرًا، وله شعر في الفخر والحماسة.",
      "answer": "ظبيان",
      "hint": "اسمه ظبيان بن عمارة",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مصطلح قانوني يعني الحضور الشخصي أمام القضاء، أو اليمين التي يحلفها الشاهد.",
      "answer": "ظهور",
      "hint": "الظهور أمام المحكمة",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عشبي حولي، ينبت في الأراضي الرملية، له أزهار صفراء، ويستخدم في الطب الشعبي.",
      "answer": "ظيان",
      "hint": "يسمى أيضًا العليق",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "واد في المنطقة الشرقية من السعودية، كان معروفًا بوقوع معركة بين المسلمين والفرس.",
      "answer": "ذو قار",
      "hint": "يبدأ بذال",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة في شمال الأردن، تشتهر بآثارها الرومانية ومدرجها الجنوبي.",
      "answer": "جرش",
      "hint": "يبدأ بجيم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "جهاز يستخدم في المختبرات لفصل السوائل عن المواد الصلبة باستخدام قوة الطرد المركزي.",
      "answer": "جهاز طرد مركزي",
      "hint": "يبدأ بجيم",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض جلدي يسببه فطر، يظهر على شكل بقع بيضاء أو حمراء على الجلد.",
      "answer": "سعفة",
      "hint": "يبدأ بسين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة المغرب.",
      "answer": "درهم",
      "hint": "يبدأ بدال",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار.",
      "answer": "جرير",
      "hint": "يبدأ بجيم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بمنتجعاتها الفاخرة.",
      "answer": "كوت دازور",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الحمضية، لونه أصفر، يستخدم في العصائر والطبخ.",
      "answer": "ليمون",
      "hint": "يبدأ بلام",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "مخرج سينمائي أمريكي، أخرج أفلامًا مثل 'الفك المفترس' و'إي تي'.",
      "answer": "ستيفن سبيلبرغ",
      "hint": "يبدأ بسين",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه He، يستخدم في ملء البالونات والمناطيد.",
      "answer": "هيليوم",
      "hint": "يبدأ بهاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في غرب أفريقيا، عاصمتها أبوجا، وهي أكبر دولة أفريقية من حيث عدد السكان.",
      "answer": "نيجيريا",
      "hint": "يبدأ بنون",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم ألماني، لعب لبايرن ميونخ، ويعتبر أحد أفضل حراس المرمى في التاريخ.",
      "answer": "نوير",
      "hint": "مانويل نوير",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات عطري يستخدم في الطهي والطب، يشبه النعناع، وله أوراق خضراء.",
      "answer": "ريحان",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ع": [
    {
      "text": "لاعب كرة قدم عماني يعتبر من أفضل حراس المرمى العرب لعب في الدوري الإنجليزي",
      "answer": "علي الحبسي",
      "hint": "حارس مرمى عماني لعب في إنجلترا",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "سلطنة عربية عاصمتها مسقط تقع في الركن الجنوبي الشرقي من شبه الجزيرة العربية",
      "answer": "عمان",
      "hint": "سلطنة عمان عاصمتها مسقط",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "عالم رياضيات وفلك وشاعر فارسي من أعلام القرن الحادي عشر",
      "answer": "عمر الخيام",
      "hint": "عالم رياضيات وفلك وشاعر فارسي",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "العضو المسؤول عن الإبصار في جسم الإنسان",
      "answer": "عين",
      "hint": "العين",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "مدينة سعودية في منطقة القصيم تشتهر بالتمور",
      "answer": "عنيزة",
      "hint": "مدينة سعودية في القصيم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "سورة قصيرة في القرآن رقمها 103 تتحدث عن قيمة الوقت",
      "answer": "العصر",
      "hint": "سورة قصيرة في جزء عم",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "شركة صينية للتجارة الإلكترونية من أكبر الشركات التقنية في العالم",
      "answer": "علي بابا",
      "hint": "شركة صينية للتجارة الإلكترونية",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "الاتفاق بين طرفين لإنشاء التزامات في القانون",
      "answer": "عقد",
      "hint": "العقد في القانون",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم إماراتي يلقب بعموري",
      "answer": "عمر عبدالرحمن",
      "hint": "لاعب إماراتي يلقب بعموري",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر يمر بسوريا ولبنان وتركيا",
      "answer": "العاصي",
      "hint": "نهر في سوريا ولبنان وتركيا",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء إنجليزي، مكتشف النواة الذرية، وحصل على جائزة نوبل في الكيمياء عام 1908.",
      "answer": "رذرفورد",
      "hint": "إرنست رذرفورد",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "كاتب وفيلسوف ألماني، صاحب كتاب 'الموبي ديك'، وأحد أعلام الفلسفة الوجودية.",
      "answer": "نيتشه",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا، ينبع من جبال بامير ويصب في بحر آرال، وهو أطول أنهار آسيا الوسطى.",
      "answer": "سيحون",
      "hint": "يبدأ بسين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني يستخدم لقياس التيار الكهربائي في الدوائر.",
      "answer": "أميتر",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض وراثي يصيب الدم، يؤدي إلى تكسر خلايا الدم الحمراء بشكل مستمر.",
      "answer": "أنيميا",
      "hint": "فقر الدم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة العراق.",
      "answer": "دينار",
      "hint": "يبدأ بدال",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بحكمته وأشعاره.",
      "answer": "زهير بن أبي سلمى",
      "hint": "يبدأ بزاي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة عسير، وتشتهر بجمالها السياحي وأجوائها المعتدلة.",
      "answer": "أبها",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم إيطالي، لعب ليوفنتوس، ويعتبر أحد أفضل المدافعين في التاريخ.",
      "answer": "كانافارو",
      "hint": "فابيو كانافارو",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة مايكروسوفت، ويستخدم على نطاق واسع.",
      "answer": "ويندوز",
      "hint": "يبدأ بواو",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "عنصر كيميائي رمزه Fe، يستخدم في صناعة الفولاذ والحديد الزهر.",
      "answer": "حديد",
      "hint": "يبدأ بحاء",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها كوالالمبور، تشتهر بأبراجها الشاهقة.",
      "answer": "ماليزيا",
      "hint": "يبدأ بميم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "نوع من الفواكه الصيفية، له نواة كبيرة، ولب أصفر، ويؤكل طازجًا أو مجففًا.",
      "answer": "مشمش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، فلسطيني، له قصيدة 'أحن إلى خبز أمي'.",
      "answer": "محمود درويش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بمعابدها القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع بين الفخذ والساق.",
      "answer": "ركبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "غ": [
    {
      "text": "لاعب كرة قدم ويلزي سجل هدفاً رائعاً في نهائي دوري الأبطال الأوروبي 2018",
      "answer": "غاريث بيل",
      "hint": "لعب أيضًا للوس أنجلوس",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء وفلك إيطالي دعم نظرية مركزية الشمس وواجه محاكم التفتيش",
      "answer": "غاليليو غاليلي",
      "hint": "أبو العلم الحديث",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في غرب أفريقيا تشتهر بإنتاج الكاكاو وكانت تسمى ساحل الذهب",
      "answer": "غانا",
      "hint": "كانت تسمى ساحل الذهب",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان رشيق يعيش في الصحراء ويتميز بسرعته وخفته",
      "answer": "غزال",
      "hint": "حيوان رشيق من الصحراء",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 40 تسمى أيضاً سورة المؤمن",
      "answer": "غافر",
      "hint": "سورة غافر",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "شركة تكنولوجيا أمريكية تعمل محرك البحث الأشهر في العالم",
      "answer": "غوغل",
      "hint": "محرك البحث الأشهر",
      "category": "علمي",
      "difficulty": "سهل"
    },
    {
      "text": "نهر في الهند من أقدس الأنهار عند الهندوس",
      "answer": "الغانج",
      "hint": "نهر الغانج في الهند",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "طائر أسود يرمز للشؤم في الأساطير الشعبية",
      "answer": "غراب",
      "hint": "طائر أسود",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "غدة تفرز الهرمونات في الدم",
      "answer": "غدة",
      "hint": "تفرز الهرمونات في الدم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم برازيلي شهير بمراوغته وسجل أهدافاً رائعة",
      "answer": "غارينشا",
      "hint": "أسطورة البرازيل في كأس العالم 1958 و1962",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "عالم فيزياء وفلك إيطالي، دعم نظرية كوبرنيكوس حول مركزية الشمس، وواجه محاكم التفتيش.",
      "answer": "غاليليو",
      "hint": "غاليليو غاليلي",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مؤلف موسيقي نمساوي، من أعلام الموسيقى الكلاسيكية، ألف السيمفونية التاسعة.",
      "answer": "بيتهوفن",
      "hint": "يبدأ بباء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في الاتصالات لنقل الإشارات عبر الألياف البصرية.",
      "answer": "مكرر",
      "hint": "يبدأ بميم",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض يصيب الغدة الدرقية، يؤدي إلى زيادة الوزن والخمول.",
      "answer": "قصور درقي",
      "hint": "يبدأ بقاف",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عملة الهند.",
      "answer": "روبية",
      "hint": "يبدأ براء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في المنطقة الشرقية، وتضم أكبر حقل نفط بحري في العالم.",
      "answer": "الخفجي",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم برازيلي، لعب لبرشلونة، ويعتبر أحد أفضل لاعبي خط الوسط في التاريخ.",
      "answer": "رونالدينيو",
      "hint": "يبدأ براء",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "لغة برمجة شهيرة، تستخدم في تطوير تطبيقات الذكاء الاصطناعي.",
      "answer": "بايثون",
      "hint": "يبدأ بباء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Hg، يستخدم في موازين الحرارة القديمة.",
      "answer": "زئبق",
      "hint": "يبدأ بزاي",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في شمال أوروبا، عاصمتها ستوكهولم، تشتهر بالجمال الطبيعي.",
      "answer": "السويد",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني الحضور أمام المحكمة والإنابة عنها.",
      "answer": "نيابة",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الاستوائية، له قشر أحمر ولحم أبيض، وبذور سوداء.",
      "answer": "رمان",
      "hint": "يبدأ براء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، من سوريا، اشتهر بقصيدة 'أنا يوسف يا أبي'.",
      "answer": "عدنان الصائغ",
      "hint": "يبدأ بعين",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في البطن، ويفرز الأنسولين.",
      "answer": "بنكرياس",
      "hint": "يبدأ بباء",
      "category": "علوم",
      "difficulty": "صعب"
    }
  ],
  "ف": [
    {
      "text": "مهاجم كولومبي لعب لأتلتيكو مدريد واشتهر بالتهديف الرائع",
      "answer": "راداميل فالكاو",
      "hint": "مهاجم كولومبي لعب لأتلتيكو مدريد",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "عالم فيزياء وكيمياء إنجليزي مكتشف الحث الكهرومغناطيسي",
      "answer": "مايكل فاراداي",
      "hint": "مكتشف الحث الكهرومغناطيسي",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب شرق آسيا اشتهرت بحربها مع أمريكا",
      "answer": "فيتنام",
      "hint": "دولة اشتهرت بحربها مع أمريكا",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي أموي اشتهر بالهجاء وكان أحد الثلاثة الكبار مع جرير والأخطل",
      "answer": "الفرزدق",
      "hint": "شاعر أموي مشهور",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان سريع من فصيلة السنوريات يُعد أسرع حيوان بري",
      "answer": "فهد",
      "hint": "أسرع حيوان بري",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 1 وهي أم الكتاب",
      "answer": "الفاتحة",
      "hint": "سورة الفاتحة",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "موقع تواصل اجتماعي شهير تأسس عام 2004 مملوك لشركة ميتا",
      "answer": "فيسبوك",
      "hint": "أكبر شبكة اجتماعية في العالم",
      "category": "علمي",
      "difficulty": "سهل"
    },
    {
      "text": "فيلسوف ألماني صاحب نظرية الإرادة إلى القوة",
      "answer": "فريدريك نيتشه",
      "hint": "فيلسوف ألماني",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "عالم رياضيات يوناني صاحب النظرية الشهيرة في المثلث القائم",
      "answer": "فيثاغورس",
      "hint": "عالم رياضيات يوناني",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "طائر طويل الساقين لونه وردي يعيش في المستنقعات",
      "answer": "فلامنغو",
      "hint": "طائر طويل الساقين لونه وردي",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها بانكوك، تشتهر بالسياحة والطعام الحار.",
      "answer": "تايلاند",
      "hint": "يبدأ بتاء",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء إنجليزي، مكتشف الإلكترون، وحصل على جائزة نوبل في الفيزياء.",
      "answer": "طومسون",
      "hint": "يبدأ بطاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم فرنسي، لعب لريال مدريد، ويعتبر أحد أفضل لاعبي خط الوسط في التاريخ.",
      "answer": "زيدان",
      "hint": "زين الدين زيدان",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "رسام ونحات إيطالي من عصر النهضة، أشهر أعماله تمثال داوود.",
      "answer": "مايكل أنجلو",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من ألمانيا ويصب في البحر الأسود، ويمر عبر عدة دول.",
      "answer": "الدانوب",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم لقياس سرعة الرياح.",
      "answer": "انيمومتر",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس كورونا، ظهر في ووهان بالصين عام 2019.",
      "answer": "كورونا",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة فرنسا قبل اليورو.",
      "answer": "فرنك",
      "hint": "يبدأ بفاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة مكة المكرمة، وهي محافظة ساحلية على البحر الأحمر.",
      "answer": "الليث",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم هولندي، لعب لأياكس وميلان، ويعتبر أحد أفضل هدافي كرة القدم.",
      "answer": "فان باستن",
      "hint": "ماركو فان باستن",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، مفتوح المصدر، يستخدم بكثرة في الخوادم.",
      "answer": "لينكس",
      "hint": "يبدأ بلام",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Ag، يستخدم في صناعة العملات والحلي.",
      "answer": "فضة",
      "hint": "يبدأ بفاء",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب أوروبا، عاصمتها روما، تشتهر بالتاريخ القديم والبيتزا.",
      "answer": "إيطاليا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني إبطال العقد أو فسخه.",
      "answer": "فسخ",
      "hint": "يبدأ بفاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الحمضية، لونه برتقالي، غني بفيتامين سي.",
      "answer": "برتقال",
      "hint": "يبدأ بباء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، فلسطيني، له قصيدة 'أحن إلى خبز أمي'.",
      "answer": "محمود درويش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بمعابدها القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الرقبة، ويحتوي على الحنجرة.",
      "answer": "حلق",
      "hint": "يبدأ بحاء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ق": [
    {
      "text": "دولة في الخليج العربي عاصمتها الدوحة تشتهر بالغاز الطبيعي واستضافت كأس العالم 2022",
      "answer": "قطر",
      "hint": "دولة قطر",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "شاعر أموي اشتهر بقصة حبه ليلى",
      "answer": "قيس بن الملوح",
      "hint": "شاعر أموي عشق ليلى",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان من الثدييات يتميز بذكائه وقدرته على التعلم",
      "answer": "قرد",
      "hint": "من أذكى الحيوانات",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "العضو الذي يضخ الدم في جسم الإنسان",
      "answer": "قلب",
      "hint": "القلب",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 50",
      "answer": "ق",
      "hint": "سورة ق",
      "category": "ديني",
      "difficulty": "متوسط"
    },
    {
      "text": "جزيرة في شرق البحر المتوسط دولة مستقلة",
      "answer": "قبرص",
      "hint": "جزيرة في شرق البحر المتوسط",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "ما تصدره المحكمة من حكم",
      "answer": "قرار",
      "hint": "ما تصدره المحكمة",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "الاختراق غير المشروع للأنظمة الإلكترونية",
      "answer": "قرصنة",
      "hint": "الاختراق غير المشروع",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة قطر",
      "answer": "ريال قطري",
      "hint": "عملة قطر",
      "category": "ثقافي",
      "difficulty": "سهل"
    },
    {
      "text": "لاعب كرة قدم عراقي سابق",
      "answer": "قحطان جثير",
      "hint": "لاعب عراقي سابق",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "عالم رياضيات وفلك فارسي، وضع أسس الجبر، واشتق اسمه مصطلح الخوارزمية.",
      "answer": "الخوارزمي",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم برازيلي، لعب لريال مدريد، ويعتبر أحد أفضل لاعبي خط الوسط في التاريخ.",
      "answer": "كاكا",
      "hint": "ريكاردو كاكا",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "مخرج سينمائي أمريكي، أخرج أفلامًا مثل 'العراب' و'القيامة الآن'.",
      "answer": "فرانسيس فورد كوبولا",
      "hint": "يبدأ بفاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا الوسطى، ينبع من جبال بامير ويصب في بحر آرال.",
      "answer": "سيحون",
      "hint": "يبدأ بسين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في الحواسيب لتخزين البيانات بشكل دائم.",
      "answer": "قرص صلب",
      "hint": "HDD",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض معدي يسببه فيروس، ينتقل عن طريق البعوض، ويسبب حمى وآلامًا في المفاصل.",
      "answer": "شيكونغونيا",
      "hint": "يبدأ بشين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في المنطقة الشرقية، وتضم أكبر حقل نفط بحري في العالم.",
      "answer": "الخفجي",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم فرنسي، لعب لريال مدريد، وقاد فرنسا للفوز بكأس العالم 1998.",
      "answer": "زيدان",
      "hint": "يبدأ بزاي",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "لغة برمجة شهيرة، تستخدم في تطوير تطبيقات الذكاء الاصطناعي.",
      "answer": "بايثون",
      "hint": "يبدأ بباء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Pb، يستخدم في البطاريات.",
      "answer": "رصاص",
      "hint": "يبدأ براء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في شمال أوروبا، عاصمتها ستوكهولم، تشتهر بالجمال الطبيعي.",
      "answer": "السويد",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "نوع من الفواكه الاستوائية، له قشر أحمر ولحم أبيض، وبذور سوداء.",
      "answer": "رمان",
      "hint": "يبدأ براء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، من سوريا، اشتهر بقصيدة 'أنا يوسف يا أبي'.",
      "answer": "عدنان الصائغ",
      "hint": "يبدأ بعين",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في البطن، ويفرز الأنسولين.",
      "answer": "بنكرياس",
      "hint": "يبدأ بباء",
      "category": "علوم",
      "difficulty": "صعب"
    }
  ],
  "ك": [
    {
      "text": "لاعب برازيلي حاصل على الكرة الذهبية عام 2007 لعب لريال مدريد وميلان",
      "answer": "كاكا",
      "hint": "لاعب برازيلي حاصل على الكرة الذهبية 2007",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في آسيا الوسطى عاصمتها أستانا وأكبر دولة في آسيا الوسطى",
      "answer": "كازاخستان",
      "hint": "عاصمتها أستانا",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "أكبر غدة في جسم الإنسان تقع في البطن",
      "answer": "كبد",
      "hint": "أكبر غدة في الجسم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "أول حيوان استأنسه الإنسان ويعتبر صديقه الوفي",
      "answer": "كلب",
      "hint": "أول حيوان استأنسه الإنسان",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 108",
      "answer": "الكوثر",
      "hint": "سورة قصيرة في جزء عم",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "مهاجم فرنسي حاصل على الكرة الذهبية 2022 لعب لريال مدريد",
      "answer": "كريم بنزيما",
      "hint": "مهاجم فرنسي حاصل على الكرة الذهبية 2022",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "فيلسوف ألماني صاحب كتاب نقد العقل المحض من أهم فلاسفة التنوير",
      "answer": "إيمانويل كانط",
      "hint": "فيلسوف ألماني من عصر التنوير",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نبات يستخدم في المشروبات ولونه أحمر",
      "answer": "كركديه",
      "hint": "نبات يستخدم في المشروبات",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "شركة أمريكية تصنع معالجات الهواتف الذكية",
      "answer": "كوالكوم",
      "hint": "شركة تصنع معالجات الهواتف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "الالتزام القانوني بأداء حق للغير",
      "answer": "كفالة",
      "hint": "التزام قانوني بأداء حق",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "عالم فيزياء ألماني، صاحب مبدأ عدم اليقين في ميكانيكا الكم، وحصل على نوبل في الفيزياء 1932.",
      "answer": "هايزنبرج",
      "hint": "يبدأ بهاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم ألماني، لعب لبايرن ميونخ، ويعتبر أحد أفضل حراس المرمى في التاريخ.",
      "answer": "نوير",
      "hint": "مانويل نوير",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "مؤلف موسيقي نمساوي، من أعلام الموسيقى الكلاسيكية، ألف السيمفونية التاسعة.",
      "answer": "بيتهوفن",
      "hint": "يبدأ بباء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من سويسرا ويصب في بحر الشمال، ويمر عبر ألمانيا.",
      "answer": "الراين",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني يستخدم لطباعة المستندات والصور على الورق.",
      "answer": "طابعة",
      "hint": "يبدأ بطاء",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض وراثي يصيب الدم، يؤدي إلى تكسر خلايا الدم الحمراء.",
      "answer": "أنيميا",
      "hint": "فقر الدم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة جمهورية التشيك.",
      "answer": "كرونة",
      "hint": "يبدأ بكاف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي أموي، اشتهر بالغزل والهجاء، وكان أحد الثلاثة الكبار.",
      "answer": "الفرزدق",
      "hint": "يبدأ بألف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة الكلبيات، يعيش في قطعان، ويتميز بعواءه الطويل.",
      "answer": "ذئب",
      "hint": "يبدأ بذال",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة عسير، وتشتهر بجمالها السياحي.",
      "answer": "أبها",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم إيطالي، لعب ليوفنتوس، ويعتبر أحد أفضل المدافعين في التاريخ.",
      "answer": "كانافارو",
      "hint": "فابيو كانافارو",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة أبل.",
      "answer": "ماك أو إس",
      "hint": "macOS",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Al، يستخدم في صناعة الطائرات.",
      "answer": "ألومنيوم",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها جاكرتا، وهي أكبر دولة إسلامية من حيث عدد السكان.",
      "answer": "إندونيسيا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني التعهد بعدم الإخلال بالعقد.",
      "answer": "ضمان",
      "hint": "يبدأ بضاد",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الصيفية، له نواة كبيرة، ولب أصفر، ويؤكل طازجًا أو مجففًا.",
      "answer": "مشمش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، فلسطيني، له قصيدة 'أحن إلى خبز أمي'.",
      "answer": "محمود درويش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بمعابدها القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع بين الفخذ والساق.",
      "answer": "ركبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ل": [
    {
      "text": "لاعب كرة قدم أرجنتيني يعتبر من أعظم اللاعبين في التاريخ فاز بالكرة الذهبية 8 مرات",
      "answer": "ليونيل ميسي",
      "hint": "يلقب بالبرغوث",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "دولة في جنوب شرق آسيا غير ساحلية عاصمتها فينتيان",
      "answer": "لاوس",
      "hint": "دولة لاوس في جنوب شرق آسيا",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر جاهلي أسلم وله معلقة مشهورة",
      "answer": "لبيد بن ربيعة",
      "hint": "شاعر جاهلي أسلم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان يشبه الجمل لكن ليس له سنام يعيش في أمريكا الجنوبية",
      "answer": "لاما",
      "hint": "يشبه الجمل بدون سنام",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عضو عضلي في الفم يُستخدم للتذوق والكلام",
      "answer": "لسان",
      "hint": "عضو عضلي في الفم",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 31",
      "answer": "لقمان",
      "hint": "سورة لقمان",
      "category": "ديني",
      "difficulty": "سهل"
    },
    {
      "text": "شبكة اجتماعية مهنية للبحث عن عمل وبناء العلاقات المهنية",
      "answer": "لينكد إن",
      "hint": "شبكة اجتماعية مهنية",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "نظام تشغيل مفتوح المصدر يشبه يونكس تستخدمه الخوادم",
      "answer": "لينكس",
      "hint": "نظام تشغيل لينكس",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم كرواتي حاصل على الكرة الذهبية 2018 لعب لريال مدريد",
      "answer": "لوكا مودريتش",
      "hint": "لاعب كرواتي حاصل على الكرة الذهبية 2018",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "فاكهة حمضية صفراء تستخدم في الطبخ والمشروبات",
      "answer": "ليمون",
      "hint": "فاكهة حمضية صفراء",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "عالم رياضيات وفيزياء إنجليزي، وضع قوانين الحركة والجاذبية.",
      "answer": "نيوتن",
      "hint": "يبدأ بنون",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم أرجنتيني، لعب لبرشلونة وإنتر ميامي، ويعتبر أحد أعظم اللاعبين.",
      "answer": "ميسي",
      "hint": "ليونيل ميسي",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "فيلسوف وعالم اجتماع ألماني، صاحب كتاب 'رأس المال'.",
      "answer": "ماركس",
      "hint": "كارل ماركس",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من ألمانيا ويصب في البحر الأسود، ويمر عبر عدة دول.",
      "answer": "الدانوب",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في المعامل لقياس كثافة السوائل.",
      "answer": "هيدرومتر",
      "hint": "يبدأ بهاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس كورونا، ظهر في ووهان بالصين عام 2019.",
      "answer": "كورونا",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة إيطاليا قبل اليورو.",
      "answer": "ليرة",
      "hint": "يبدأ بلام",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بحكمته وأشعاره.",
      "answer": "زهير بن أبي سلمى",
      "hint": "يبدأ بزاي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة مكة المكرمة، وهي محافظة ساحلية على البحر الأحمر.",
      "answer": "الليث",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم كرواتي، لعب لريال مدريد، وقاد منتخب بلاده للوصول إلى نهائي كأس العالم 2018.",
      "answer": "مودريتش",
      "hint": "لوكا مودريتش",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه C، أساس الحياة على الأرض.",
      "answer": "كربون",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب أوروبا، عاصمتها روما، تشتهر بالتاريخ القديم والبيتزا.",
      "answer": "إيطاليا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني الاتفاق بين طرفين على إنشاء التزامات متبادلة.",
      "answer": "عقد",
      "hint": "يبدأ بعين",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، من سوريا، اشتهر بقصيدة 'أنا الدمشقي'.",
      "answer": "نزار قباني",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الرقبة، ويحتوي على الحنجرة.",
      "answer": "حلق",
      "hint": "يبدأ بحاء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "م": [
    {
      "text": "لاعب كرة قدم مصري لعب لليفربول يعتبر أفضل هداف عربي في تاريخ دوري أبطال أوروبا",
      "answer": "محمد صلاح",
      "hint": "يلقب بالفرعون المصري",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "عاصمة الإسلام والقبلة الأولى للمسلمين",
      "answer": "مكة المكرمة",
      "hint": "مهبط الوحي",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "شركة تكنولوجية أمريكية تنتج نظام تشغيل ويندوز وأجهزة إكس بوكس",
      "answer": "مايكروسوفت",
      "hint": "شركة مايكروسوفت",
      "category": "علمي",
      "difficulty": "سهل"
    },
    {
      "text": "فيلسوف ألماني صاحب كتاب رأس المال وأحد مؤسسي الشيوعية",
      "answer": "كارل ماركس",
      "hint": "صاحب رأس المال",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "سورة في القرآن الكريم رقمها 60",
      "answer": "الممتحنة",
      "hint": "سورة الممتحنة",
      "category": "ديني",
      "difficulty": "صعب"
    },
    {
      "text": "عالم فيزياء ألماني مؤسس نظرية الكم حاصل على نوبل",
      "answer": "ماكس بلانك",
      "hint": "مؤسس نظرية الكم",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في شمال أفريقيا عاصمتها الرباط تشتهر بمدنها التاريخية",
      "answer": "المغرب",
      "hint": "المغرب",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر فلسطيني معاصر كتب سجل أنا عربي",
      "answer": "محمود درويش",
      "hint": "شاعر فلسطيني كبير",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "نهر في أفريقيا أطول أنهار العالم يمر بمصر والسودان",
      "answer": "النيل",
      "hint": "أطول نهر في العالم",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "مهنة الترافع أمام القضاء",
      "answer": "محاماة",
      "hint": "مهنة الترافع أمام القضاء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء ألماني، صاحب النظرية النسبية، وحصل على جائزة نوبل في الفيزياء.",
      "answer": "أينشتاين",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم مصري، لعب للأهلي وليفربول، ويعتبر أفضل هداف عربي في التاريخ.",
      "answer": "صلاح",
      "hint": "محمد صلاح",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "مخرج سينمائي أمريكي، أخرج أفلامًا مثل 'العراب' و'القيامة الآن'.",
      "answer": "كوبولا",
      "hint": "فرانسيس فورد كوبولا",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في الحواسيب لتخزين البيانات بشكل دائم.",
      "answer": "قرص صلب",
      "hint": "يبدأ بقاف",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض وراثي يصيب الدم، يؤدي إلى تكسر خلايا الدم الحمراء.",
      "answer": "أنيميا",
      "hint": "فقر الدم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة اليابان.",
      "answer": "ين",
      "hint": "يبدأ بياء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة عسير، وتشتهر بجمالها السياحي.",
      "answer": "أبها",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم إيطالي، لعب ليوفنتوس، ويعتبر أحد أفضل المدافعين في التاريخ.",
      "answer": "كانافارو",
      "hint": "فابيو كانافارو",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة أبل.",
      "answer": "ماك أو إس",
      "hint": "macOS",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Al، يستخدم في صناعة الطائرات.",
      "answer": "ألومنيوم",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها جاكرتا، وهي أكبر دولة إسلامية من حيث عدد السكان.",
      "answer": "إندونيسيا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني التعهد بعدم الإخلال بالعقد.",
      "answer": "ضمان",
      "hint": "يبدأ بضاد",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الصيفية، له نواة كبيرة، ولب أصفر، ويؤكل طازجًا أو مجففًا.",
      "answer": "مشمش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بمعابدها القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع بين الفخذ والساق.",
      "answer": "ركبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ن": [
    {
      "text": "مهاجم برازيلي لعب لبرشلونة وباريس سان جيرمان اشتهر بمهاراته العالية",
      "answer": "نيمار",
      "hint": "يلقب بنيمار دا سيلفا",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "عالم سويدي اخترع الديناميت وأسس جائزة عالمية تمنح في مجالات متعددة",
      "answer": "نوبل",
      "hint": "جائزة نوبل",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب آسيا في جبال الهيمالايا تشتهر بجبل إفرست",
      "answer": "نيبال",
      "hint": "علمها غير مستطيل الشكل",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر سوري معاصر اشتهر بكتابة الشعر الحديث وكان دبلوماسياً",
      "answer": "نزار قباني",
      "hint": "ديبلوماسي سابق",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "حيوان مفترس من فصيلة السنوريات يتميز بجلده المرقط وقوته",
      "answer": "نمر",
      "hint": "يُسمى أيضًا الفهد",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "حشرة غشائية الأجنحة تنتج العسل وتلقح الأزهار",
      "answer": "نحلة",
      "hint": "تلقح الأزهار",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "خدمة بث أفلام ومسلسلات عبر الإنترنت تنتج محتوى أصلياً",
      "answer": "نتفليكس",
      "hint": "تأسست كشركة لتأجير أقراص DVD",
      "category": "علمي",
      "difficulty": "سهل"
    },
    {
      "text": "حارس مرمى بايرن ميونخ والمنتخب الألماني يعتبر من أفضل حراس المرمى",
      "answer": "نوير",
      "hint": "مانويل نوير",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في غرب أفريقيا أكبر دولة أفريقية من حيث عدد السكان",
      "answer": "نيجيريا",
      "hint": "تشتهر بإنتاج النفط",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض يصيب المفاصل بسبب تراكم حمض البوليك يسمى مرض الملوك",
      "answer": "نقرس",
      "hint": "مرض الملوك",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "عالم فيزياء إنجليزي، مكتشف الإلكترون، وحصل على جائزة نوبل في الفيزياء.",
      "answer": "طومسون",
      "hint": "يبدأ بطاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "فيلسوف وعالم اجتماع ألماني، صاحب كتاب 'رأس المال'.",
      "answer": "ماركس",
      "hint": "كارل ماركس",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في أوروبا، ينبع من ألمانيا ويصب في البحر الأسود، ويمر عبر عدة دول.",
      "answer": "الدانوب",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في المعامل لقياس كثافة السوائل.",
      "answer": "هيدرومتر",
      "hint": "يبدأ بهاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس كورونا، ظهر في ووهان بالصين عام 2019.",
      "answer": "كورونا",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة إيطاليا قبل اليورو.",
      "answer": "ليرة",
      "hint": "يبدأ بلام",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بحكمته وأشعاره.",
      "answer": "زهير بن أبي سلمى",
      "hint": "يبدأ بزاي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة مكة المكرمة، وهي محافظة ساحلية على البحر الأحمر.",
      "answer": "الليث",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم كرواتي، لعب لريال مدريد، وقاد منتخب بلاده للوصول إلى نهائي كأس العالم 2018.",
      "answer": "مودريتش",
      "hint": "لوكا مودريتش",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، مفتوح المصدر، يستخدم بكثرة في الخوادم.",
      "answer": "لينكس",
      "hint": "يبدأ بلام",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه C، أساس الحياة على الأرض.",
      "answer": "كربون",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب أوروبا، عاصمتها روما، تشتهر بالتاريخ القديم والبيتزا.",
      "answer": "إيطاليا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني الاتفاق بين طرفين على إنشاء التزامات متبادلة.",
      "answer": "عقد",
      "hint": "يبدأ بعين",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "نوع من الفواكه الحمضية، لونه أصفر، يستخدم في العصائر والطبخ.",
      "answer": "ليمون",
      "hint": "يبدأ بلام",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في الرقبة، ويحتوي على الحنجرة.",
      "answer": "حلق",
      "hint": "يبدأ بحاء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ه": [
    {
      "text": "مهاجم إنجليزي قائد منتخب إنجلترا وهداف توتنهام التاريخي",
      "answer": "هاري كين",
      "hint": "يلقب بهاري",
      "category": "كروي",
      "difficulty": "سهل"
    },
    {
      "text": "عالم فيزياء ألماني صاحب مبدأ عدم اليقين في ميكانيكا الكم حاصل على نوبل",
      "answer": "هايزنبرج",
      "hint": "فيرنر هايزنبرج",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة أوروبية تشتهر بطواحين الهواء والتوليب والأحذية الخشبية",
      "answer": "هولندا",
      "hint": "عاصمتها أمستردام",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "طائر صغير ورد ذكره في القرآن في قصة سليمان عليه السلام",
      "answer": "هدهد",
      "hint": "ينقل الأخبار",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "فيلسوف ألماني صاحب كتاب ظواهر الروح من أعلام المثالية الألمانية",
      "answer": "هيغل",
      "hint": "جورج فيلهلم فريدريش هيغل",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني محمول يجمع بين الهاتف والحاسوب",
      "answer": "هاتف ذكي",
      "hint": "يعمل بنظام أندرويد أو iOS",
      "category": "علمي",
      "difficulty": "سهل"
    },
    {
      "text": "التصرف القانوني الذي يمنح شخصاً شيئاً دون مقابل",
      "answer": "هبة",
      "hint": "عقد تبرع",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "لاعب كرة قدم بلجيكي لعب لتشيلسي وريال مدريد اشتهر بالمراوغة والسرعة",
      "answer": "هازارد",
      "hint": "إدين هازارد",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء إنجليزي اشتهر بأبحاثه في الثقوب السوداء",
      "answer": "هوكينج",
      "hint": "ستيفن هوكينج",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في أوروبا الوسطى عاصمتها بودابست تشتهر بحماماتها الحرارية",
      "answer": "هنغاريا",
      "hint": "المجر",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "فيلسوف ألماني، صاحب كتاب 'هكذا تكلم زرادشت'.",
      "answer": "نيتشه",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا الوسطى، ينبع من جبال بامير ويصب في بحر آرال.",
      "answer": "سيحون",
      "hint": "يبدأ بسين",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز إلكتروني صغير يستخدم للتحكم عن بعد في الأجهزة المنزلية.",
      "answer": "ريموت",
      "hint": "ريموت كنترول",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "مرض وراثي يصيب الدم، يؤدي إلى تكسر خلايا الدم الحمراء.",
      "answer": "أنيميا",
      "hint": "فقر الدم",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة الهند.",
      "answer": "روبية",
      "hint": "يبدأ براء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في المنطقة الشرقية، وتضم أكبر حقل نفط بحري في العالم.",
      "answer": "الخفجي",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم فرنسي، لعب لريال مدريد، وقاد فرنسا للفوز بكأس العالم 1998.",
      "answer": "زيدان",
      "hint": "يبدأ بزاي",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة مايكروسوفت.",
      "answer": "ويندوز",
      "hint": "يبدأ بواو",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "عنصر كيميائي رمزه Fe، يستخدم في صناعة الفولاذ.",
      "answer": "حديد",
      "hint": "يبدأ بحاء",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب شرق آسيا، عاصمتها كوالالمبور، تشتهر بأبراجها الشاهقة.",
      "answer": "ماليزيا",
      "hint": "يبدأ بميم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني الحكم النهائي الصادر من المحكمة.",
      "answer": "قرار",
      "hint": "يبدأ بقاف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الاستوائية، له قشر أحمر ولحم أبيض، وبذور سوداء.",
      "answer": "رمان",
      "hint": "يبدأ براء",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، من سوريا، اشتهر بقصيدة 'أنا يوسف يا أبي'.",
      "answer": "عدنان الصائغ",
      "hint": "يبدأ بعين",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بمعابدها القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في البطن، ويفرز الأنسولين.",
      "answer": "بنكرياس",
      "hint": "يبدأ بباء",
      "category": "علوم",
      "difficulty": "صعب"
    }
  ],
  "و": [
    {
      "text": "مهاجم إنجليزي أسطوري لعب لمانشستر يونايتد وهو الهداف التاريخي للدوري الإنجليزي الممتاز",
      "answer": "واين روني",
      "hint": "بدأ مسيرته مع إيفرتون",
      "category": "كروي",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم اسكتلندي طور المحرك البخاري وسميت على اسمه وحدة قياس القدرة",
      "answer": "واط",
      "hint": "جيمس واط",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "عاصمة الولايات المتحدة الأمريكية تقع على نهر بوتوماك",
      "answer": "واشنطن",
      "hint": "تضم البيت الأبيض",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "حيوان ثديي من فصيلة البقريات يعيش في الجبال له قرون طويلة",
      "answer": "وعل",
      "hint": "يسمى أيضًا التيس الجبلي",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "الأنابيب الدموية التي تنقل الدم من الأنسجة إلى القلب",
      "answer": "وريد",
      "hint": "عكس الشريان",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "التصرف القانوني الذي يحدد فيه الشخص مصير أمواله بعد وفاته",
      "answer": "وصية",
      "hint": "تُكتب قبل الممات",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "منتج أفلام أمريكي مؤسس شركة ديزني ابتكر شخصية ميكي ماوس",
      "answer": "والت ديزني",
      "hint": "اسمه الأول والت",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "نظام تشغيل للحواسيب طورته مايكروسوفت يتميز بواجهة رسومية",
      "answer": "ويندوز",
      "hint": "مايكروسوفت ويندوز",
      "category": "علمي",
      "difficulty": "سهل"
    },
    {
      "text": "منخفض طبيعي بين الجبال أو التلال غالباً ما يمر به نهر",
      "answer": "وادي",
      "hint": "وادي النيل",
      "category": "جغرافيا",
      "difficulty": "سهل"
    },
    {
      "text": "الجزء الأمامي من الرأس يحتوي على العينين والأنف والفم",
      "answer": "وجه",
      "hint": "يتعرف به الناس",
      "category": "علوم",
      "difficulty": "سهل"
    },
    {
      "text": "نهر في أوروبا، ينبع من سويسرا ويصب في بحر الشمال، ويمر عبر ألمانيا.",
      "answer": "الراين",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم لقياس سرعة الرياح.",
      "answer": "انيمومتر",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس كورونا، ظهر في ووهان بالصين عام 2019.",
      "answer": "كورونا",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة كوريا الجنوبية.",
      "answer": "وون",
      "hint": "يبدأ بواو",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بحكمته وأشعاره.",
      "answer": "زهير بن أبي سلمى",
      "hint": "يبدأ بزاي",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في منطقة مكة المكرمة، وهي محافظة ساحلية على البحر الأحمر.",
      "answer": "الليث",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم كرواتي، لعب لريال مدريد، وقاد منتخب بلاده للوصول إلى نهائي كأس العالم 2018.",
      "answer": "مودريتش",
      "hint": "لوكا مودريتش",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، طورته شركة أبل.",
      "answer": "ماك أو إس",
      "hint": "macOS",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه Al، يستخدم في صناعة الطائرات.",
      "answer": "ألومنيوم",
      "hint": "يبدأ بألف",
      "category": "علمي",
      "difficulty": "متوسط"
    },
    {
      "text": "دولة في جنوب أوروبا، عاصمتها روما، تشتهر بالتاريخ القديم والبيتزا.",
      "answer": "إيطاليا",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني تفويض شخص لآخر للقيام بعمل نيابة عنه.",
      "answer": "وكالة",
      "hint": "عقد الوكالة",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الصيفية، له نواة كبيرة، ولب أصفر، ويؤكل طازجًا أو مجففًا.",
      "answer": "مشمش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، فلسطيني، له قصيدة 'أحن إلى خبز أمي'.",
      "answer": "محمود درويش",
      "hint": "يبدأ بميم",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لفرنسا، تشتهر بجمالها.",
      "answer": "كورسيكا",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع بين الفخذ والساق.",
      "answer": "ركبة",
      "hint": "يبدأ براء",
      "category": "علوم",
      "difficulty": "متوسط"
    }
  ],
  "ي": [
    {
      "text": "دولة في شبه الجزيرة العربية، عاصمتها صنعاء، تشتهر بجمالها التاريخي.",
      "answer": "اليمن",
      "hint": "بلد عربي قديم",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "عالم فيزياء وفلك إيطالي، دعم نظرية كوبرنيكوس حول مركزية الشمس.",
      "answer": "غاليليو",
      "hint": "يبدأ بغين",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم إيفواري، لعب لبرشلونة ومانشستر سيتي، ويعتبر من أفضل لاعبي أفريقيا.",
      "answer": "يايا توريه",
      "hint": "فكّر أكثر...",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "فيلسوف وعالم اجتماع ألماني، صاحب كتاب 'الأخلاق البروتستانتية وروح الرأسمالية'.",
      "answer": "فيبر",
      "hint": "ماكس فيبر",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نهر في آسيا، ينبع من جبال الهيمالايا، ويصب في خليج البنغال، وهو أقدس أنهار الهند.",
      "answer": "الغانج",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "جهاز يستخدم في المعامل لقياس كثافة السوائل.",
      "answer": "هيدرومتر",
      "hint": "يبدأ بهاء",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "مرض معدي يسببه فيروس كورونا، ظهر في ووهان بالصين عام 2019.",
      "answer": "كورونا",
      "hint": "يبدأ بكاف",
      "category": "علوم",
      "difficulty": "متوسط"
    },
    {
      "text": "عملة الصين.",
      "answer": "يوان",
      "hint": "يبدأ بياء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "شاعر عربي جاهلي، من أصحاب المعلقات، اشتهر بقصيدته التي يصف فيها ناقته.",
      "answer": "طرفة بن العبد",
      "hint": "يبدأ بطاء",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "حيوان ثديي، من فصيلة القرود، يعيش في غابات أفريقيا، ويتميز بحجمه الكبير.",
      "answer": "غوريلا",
      "hint": "يبدأ بغين",
      "category": "علوم",
      "difficulty": "صعب"
    },
    {
      "text": "مدينة سعودية، تقع في المنطقة الشرقية، وتضم أكبر حقل نفط بحري في العالم.",
      "answer": "الخفجي",
      "hint": "يبدأ بألف ولام",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "لاعب كرة قدم فرنسي، لعب لريال مدريد، وقاد فرنسا للفوز بكأس العالم 1998.",
      "answer": "زيدان",
      "hint": "يبدأ بزاي",
      "category": "كروي",
      "difficulty": "صعب"
    },
    {
      "text": "نظام تشغيل للحواسيب، مفتوح المصدر، يستخدم بكثرة في الخوادم.",
      "answer": "لينكس",
      "hint": "يبدأ بلام",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "عنصر كيميائي رمزه C، أساس الحياة على الأرض.",
      "answer": "كربون",
      "hint": "يبدأ بكاف",
      "category": "علمي",
      "difficulty": "صعب"
    },
    {
      "text": "دولة في جنوب أوروبا، عاصمتها أثينا، تشتهر بجزرها الساحرة وتاريخها القديم.",
      "answer": "اليونان",
      "hint": "يبدأ بألف",
      "category": "جغرافيا",
      "difficulty": "متوسط"
    },
    {
      "text": "مصطلح قانوني يعني إقرار الشخص بصحة وثيقة أو توقيع.",
      "answer": "يمين",
      "hint": "الحلف",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "نوع من الفواكه الحمضية، لونه أصفر، يستخدم في العصائر والطبخ.",
      "answer": "ليمون",
      "hint": "يبدأ بلام",
      "category": "ثقافي",
      "difficulty": "متوسط"
    },
    {
      "text": "شاعر عربي معاصر، من سوريا، اشتهر بقصيدة 'أنا الدمشقي'.",
      "answer": "نزار قباني",
      "hint": "يبدأ بنون",
      "category": "ثقافي",
      "difficulty": "صعب"
    },
    {
      "text": "جزيرة في البحر الأبيض المتوسط، تابعة لليونان، تشتهر بمعابدها القديمة.",
      "answer": "كريت",
      "hint": "يبدأ بكاف",
      "category": "جغرافيا",
      "difficulty": "صعب"
    },
    {
      "text": "عضو في جسم الإنسان، هو العضو الذي يقع في البطن، ويفرز الأنسولين.",
      "answer": "بنكرياس",
      "hint": "يبدأ بباء",
      "category": "علوم",
      "difficulty": "صعب"
    }
  ]
};

function getMultipleQuestions(letter, category, difficulty, count) {
  let pool = QUESTIONS_DB[letter] || [];
  if (category && category !== 'عشوائي') {
    const f = pool.filter(q => q.category === category);
    if (f.length) pool = f;
  }
  if (difficulty && difficulty !== 'عشوائي') {
    const f = pool.filter(q => q.difficulty === difficulty);
    if (f.length) pool = f;
  }
  if (!pool.length) pool = QUESTIONS_DB[letter] || [];
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
}

// Sync - no AI needed anymore
function generateQuestionsAI(letter, category, difficulty, count) {
  return getMultipleQuestions(letter, category, difficulty, count);
}

// GAME STATE  ← يجب أن يكون قبل io.on('connection')
// =====================================================
let gameState = {
  phase: 'lobby',
  gridSize: 5,
  grid: [],
  teamNames: { green: 'الفريق الأخضر', orange: 'الفريق البرتقالي' },
  teamColors: { green: '#16a34a', orange: '#ea580c' },
  players: {},
  host: null,
  selectedCell: null,
  currentQuestion: null,
  currentQuestionData: null,
  aiAlternatives: [],
  aiPreferences: { category: 'عشوائي', difficulty: 'متوسط' },
  buttonOpen: false,
  buttonPressedBy: null,
  buttonPressedAt: null,
  answerWindowOpen: false,
  answerTimerEnd: null,
  greenTimeoutUntil: 0,
  orangeTimeoutUntil: 0,
  wins: { green: 0, orange: 0 },
  hintVotes: {},
  hintActive: false,
  hintUnlocked: false,
  hintTimerHandle: null,
  questionTimerHandle: null,
  cancelVoteTimerHandle: null,
  answerTimerHandle: null,
  opponentTimerHandle: null,
  lastWrongTeam: null,
  opponentWindowOpen: false,
  opponentTeam: null,
  opponentTimerEnd: null,
  inviteCode: 'حسن',
  timeoutGiven: {},
  cancelVoteActive: false,
  cancelVotes: {},
  playerSurveys: {},
  questionStartTime: null,
};

// =====================================================
// HELPERS
// =====================================================
function generateGrid(size) {
  let pool = [];
  while (pool.length < size * size)
    pool = pool.concat([...ARABIC_LETTERS].sort(() => Math.random() - 0.5));
  pool = pool.slice(0, size * size).sort(() => Math.random() - 0.5);
  const grid = [];
  let i = 0;
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++) grid[r].push({ letter: pool[i++], owner: null });
  }
  return grid;
}

function getTeamCount(t) { return Object.values(gameState.players).filter(p => p.team === t).length; }

function getHexNeighbors(r, c, size) {
  const odd = c % 2 === 1;
  const dirs = odd
    ? [[-1,0],[1,0],[0,-1],[1,-1],[0,1],[1,1]]
    : [[-1,0],[1,0],[-1,-1],[0,-1],[-1,1],[0,1]];
  return dirs.map(([dr,dc]) => [r+dr, c+dc])
             .filter(([nr,nc]) => nr>=0 && nr<size && nc>=0 && nc<size);
}

function checkWin() {
  const size = gameState.gridSize, grid = gameState.grid;
  function bfs(team, starts, fn) {
    const vis = Array.from({length:size}, () => Array(size).fill(false));
    const q = starts.filter(([r,c]) => grid[r][c].owner === team);
    if (!q.length) return false;
    q.forEach(([r,c]) => vis[r][c] = true);
    let h = 0;
    while (h < q.length) {
      const [r,c] = q[h++];
      if (fn(r,c)) return true;
      for (const [nr,nc] of getHexNeighbors(r,c,size))
        if (!vis[nr][nc] && grid[nr][nc].owner === team) { vis[nr][nc]=true; q.push([nr,nc]); }
    }
    return false;
  }
  if (bfs('green',  Array.from({length:size},(_,r)=>[r,size-1]), (_,c)=>c===0))    return 'green';
  if (bfs('orange', Array.from({length:size},(_,c)=>[0,c]),      (r)=>r===size-1)) return 'orange';
  return null;
}

function clearAllTimers() {
  ['hintTimerHandle','questionTimerHandle','cancelVoteTimerHandle','answerTimerHandle','opponentTimerHandle']
    .forEach(k => { if (gameState[k]) { clearTimeout(gameState[k]); gameState[k]=null; } });
}

function resetButtonState() {
  if (gameState.answerTimerHandle)   { clearTimeout(gameState.answerTimerHandle);   gameState.answerTimerHandle=null; }
  if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle=null; }
  gameState.buttonOpen=false; gameState.buttonPressedBy=null; gameState.buttonPressedAt=null;
  gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
  gameState.opponentWindowOpen=false; gameState.opponentTeam=null; gameState.opponentTimerEnd=null;
  Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
}

function resetGameState() {
  clearAllTimers();
  gameState.phase='lobby'; gameState.grid=generateGrid(gameState.gridSize);
  gameState.selectedCell=null; gameState.currentQuestion=null;
  gameState.currentQuestionData=null; gameState.questionStartTime=null;
  resetButtonState();
  gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
  gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
  gameState.lastWrongTeam=null; gameState.timeoutGiven={};
  gameState.cancelVoteActive=false; gameState.cancelVotes={};
  Object.values(gameState.players).forEach(p => { p.score=0; p.correctCount=0; p.wrongCount=0; });
}

function broadcastState() { io.emit('gameState', sanitizeState()); }

function sanitizeState() {
  return {
    phase: gameState.phase, gridSize: gameState.gridSize, grid: gameState.grid,
    teamNames: gameState.teamNames, players: gameState.players,
    selectedCell: gameState.selectedCell, currentQuestion: gameState.currentQuestion,
    currentQuestionData: gameState.currentQuestionData,
    buttonOpen: gameState.buttonOpen, buttonPressedBy: gameState.buttonPressedBy,
    answerWindowOpen: gameState.answerWindowOpen, answerTimerEnd: gameState.answerTimerEnd,
    greenTimeoutUntil: gameState.greenTimeoutUntil, orangeTimeoutUntil: gameState.orangeTimeoutUntil,
    wins: gameState.wins, hintVotes: gameState.hintVotes,
    hintActive: gameState.hintActive, hintUnlocked: gameState.hintUnlocked,
    lastWrongTeam: gameState.lastWrongTeam,
    opponentWindowOpen: gameState.opponentWindowOpen, opponentTeam: gameState.opponentTeam,
    opponentTimerEnd: gameState.opponentTimerEnd,
    inviteCode: gameState.inviteCode,
    cancelVoteActive: gameState.cancelVoteActive, cancelVotes: gameState.cancelVotes,
    questionStartTime: gameState.questionStartTime,
  };
}

function applyWrongAnswer(wrongTeam) {
  const now = Date.now();
  const other = wrongTeam === 'green' ? 'orange' : 'green';
  if (gameState.lastWrongTeam && gameState.lastWrongTeam !== wrongTeam) {
    // الفريق الثاني أجاب غلط — بدون تايم أوت
    gameState.lastWrongTeam=null; gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
    gameState.opponentWindowOpen=false; gameState.opponentTeam=null; gameState.opponentTimerEnd=null;
    if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle=null; }
    gameState.buttonOpen=true; gameState.buttonPressedBy=null;
    gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
  } else if (!gameState.timeoutGiven[wrongTeam]) {
    // الفريق الأول يغلط — تايم أوت مرة واحدة
    gameState.timeoutGiven[wrongTeam]=true;
    gameState.lastWrongTeam=wrongTeam;
    const until = now + TEAM_TIMEOUT_MS;
    if (wrongTeam==='green') gameState.greenTimeoutUntil=until;
    else gameState.orangeTimeoutUntil=until;
    Object.values(gameState.players).forEach(p => {
      if (p.team===wrongTeam) { p.muted=true; p.deafened=true; }
      else { p.muted=false; p.deafened=false; }
    });
    gameState.opponentWindowOpen=true; gameState.opponentTeam=other;
    gameState.opponentTimerEnd=now+TEAM_TIMEOUT_MS;
    gameState.buttonOpen=true; gameState.buttonPressedBy=null;
    gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
    if (gameState.opponentTimerHandle) clearTimeout(gameState.opponentTimerHandle);
    gameState.opponentTimerHandle=setTimeout(() => {
      gameState.opponentWindowOpen=false; gameState.opponentTeam=null; gameState.opponentTimerEnd=null;
      gameState.lastWrongTeam=null; gameState.buttonOpen=true; gameState.buttonPressedBy=null;
      gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
      gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
      Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
      broadcastState();
    }, TEAM_TIMEOUT_MS);
    setTimeout(() => {
      if (wrongTeam==='green') gameState.greenTimeoutUntil=0; else gameState.orangeTimeoutUntil=0;
      Object.values(gameState.players).forEach(p => { if (p.team===wrongTeam) { p.muted=false; p.deafened=false; } });
      broadcastState();
    }, TEAM_TIMEOUT_MS);
  } else {
    // نفس الفريق يغلط مرة ثانية — فتح للكل
    gameState.lastWrongTeam=null; gameState.buttonOpen=true; gameState.buttonPressedBy=null;
    gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
  }
}

// =====================================================
// SOCKET EVENTS
// =====================================================
io.on('connection', (socket) => {
  socket.on('checkInvite', code => socket.emit(code===gameState.inviteCode ? 'inviteOk' : 'inviteFail'));
  socket.on('getInviteCode', () => socket.emit('inviteCodeForPlayer', gameState.inviteCode));

  socket.on('hostLogin', code => {
    if (code===HOST_CODE) { gameState.host=socket.id; socket.emit('hostOk'); broadcastState(); }
    else socket.emit('hostFail');
  });

  socket.on('setInviteCode', code => { if (socket.id!==gameState.host) return; gameState.inviteCode=code; broadcastState(); });

  socket.on('submitSurvey', data => {
    if (!gameState.players[socket.id]) return;
    gameState.playerSurveys[socket.id] = data;
    gameState.players[socket.id].surveyDone = true;
    // احفظ الاستبيان في قاعدة البيانات
    const player = gameState.players[socket.id];
    if (player.dbUsername) {
      const key = player.dbUsername.toLowerCase();
      if (playersDB[key]) {
        playersDB[key].survey = data;
        playersDB[key].survey_date = new Date().toISOString();
        saveDB();
      }
    } else {
      // حتى الضيوف نحفظهم باسمهم
      const guestKey = '__guest__' + player.name;
      playersDB[guestKey] = playersDB[guestKey] || { username: player.name, type: 'guest' };
      playersDB[guestKey].survey = data;
      playersDB[guestKey].survey_date = new Date().toISOString();
      saveDB();
    }
    broadcastState();
  });

  socket.on('playerJoin', ({ name, team, inviteCode, dbUsername }) => {
    const isAuth = dbUsername && db.prepare('SELECT id FROM players WHERE username=? COLLATE NOCASE').get(dbUsername);
    if (!isAuth && inviteCode!==gameState.inviteCode) {
      socket.emit('joinFail','يوزرنيمك غير مسجّل — سجّل أولاً'); return;
    }
    const ex=Object.entries(gameState.players).find(([,p])=>p.name===name);
    if (ex) {
      const [oldId,pd]=ex;
      delete gameState.players[oldId];
      gameState.players[socket.id]=pd;
      if (gameState.buttonPressedBy===oldId) gameState.buttonPressedBy=socket.id;
      broadcastState(); socket.emit('joinOk'); return;
    }
    if (team!=='random' && getTeamCount(team)>=2) { socket.emit('joinFail','الفريق ممتلئ'); return; }
    const dbP = dbUsername ? db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(dbUsername) : null;
    gameState.players[socket.id]={
      name, team, score:0, correctCount:0, wrongCount:0, muted:false, deafened:false, surveyDone:false,
      dbUsername: dbUsername||null,
      title: dbP?.title||'',
      level: dbP?.level||1,
      prestige: dbP?.prestige||0,
      badge: getPlayerBadge(dbP?.prestige||0)
    };
    broadcastState(); socket.emit('joinOk');
  });

  socket.on('setTeamName',  ({team,name})  => { if (socket.id!==gameState.host) return; gameState.teamNames[team]=name;  broadcastState(); });
  socket.on('setTeamColor', ({team,color}) => { if (socket.id!==gameState.host) return; gameState.teamColors[team]=color; broadcastState(); });
  socket.on('setGridSize',  size           => { if (socket.id!==gameState.host) return; gameState.gridSize=size; gameState.grid=generateGrid(size); broadcastState(); });

  socket.on('assignRandomTeams', () => {
    if (socket.id!==gameState.host) return;
    const randPlayers = Object.entries(gameState.players)
      .filter(([,p])=>p.team==='random').map(([id])=>id).sort(()=>Math.random()-.5);
    const half = Math.ceil(randPlayers.length/2);
    randPlayers.forEach((id,i)=>{ gameState.players[id].team = i<half?'green':'orange'; });
    broadcastState();
    io.emit('teamsAssigned', Object.fromEntries(
      Object.entries(gameState.players).map(([id,p])=>[id,{name:p.name,team:p.team}])
    ));
  });

  socket.on('showMVP', () => { if(socket.id!==gameState.host) return; io.emit('showMVP'); });

  socket.on('newGrid', () => {
    if (socket.id!==gameState.host) return;
    gameState.grid=generateGrid(gameState.gridSize);
    gameState.selectedCell=null; resetButtonState();
    gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
    broadcastState();
  });

  socket.on('startGame', () => {
    if (socket.id!==gameState.host) return;
    gameState.phase='playing';
    if (!gameState.grid.length) gameState.grid=generateGrid(gameState.gridSize);
    broadcastState();
  });

  socket.on('setAIPreferences', ({ category, difficulty }) => {
    if (socket.id!==gameState.host) return;
    gameState.aiPreferences = { category: category||'عشوائي', difficulty: difficulty||'متوسط' };
  });

  socket.on('selectCell', ({ row, col }) => {
    if (socket.id!==gameState.host || gameState.grid[row]?.[col]?.owner) return;
    clearAllTimers();
    const letter = gameState.grid[row][col].letter;
    gameState.selectedCell={ row, col };
    gameState.currentQuestion=letter;
    gameState.questionStartTime=Date.now();
    resetButtonState();
    gameState.buttonOpen=true; gameState.lastWrongTeam=null; gameState.timeoutGiven={};
    gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
    gameState.cancelVoteActive=false; gameState.cancelVotes={};

    // توليد فوري بدون async
    const pref = gameState.aiPreferences;
    const questions = generateQuestionsAI(letter, pref.category, pref.difficulty, 3);
    gameState.currentQuestionData = questions[0] || null;
    gameState.aiAlternatives = questions.slice(1);
    broadcastState();

    const hostSock = [...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
    if (hostSock) hostSock.emit('questionsReady',{ active:questions[0], alternatives:questions.slice(1) });

    gameState.hintTimerHandle=setTimeout(()=>{ gameState.hintActive=true; broadcastState(); }, HINT_AFTER_MS);
    gameState.cancelVoteTimerHandle=setTimeout(()=>{ gameState.cancelVoteActive=true; broadcastState(); }, CANCEL_VOTE_AFTER);
    gameState.questionTimerHandle=setTimeout(()=>{
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null;
      resetButtonState(); broadcastState(); io.emit('questionExpired');
    }, QUESTION_EXPIRE);
  });

  socket.on('selectAlternativeQ', idx => {
    if (socket.id!==gameState.host || !gameState.currentQuestion) return;
    const alts=gameState.aiAlternatives||[];
    if (alts[idx]) {
      gameState.currentQuestionData=alts[idx]; broadcastState();
    } else {
      const letter=gameState.currentQuestion;
      const cat=gameState.aiPreferences.category; const diff=gameState.aiPreferences.difficulty;
      const qs=generateQuestionsAI(letter,cat,diff,3);
      gameState.currentQuestionData=qs[0]; gameState.aiAlternatives=qs.slice(1);
      broadcastState();
      const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
      if (hostSock) hostSock.emit('questionsReady',{ active:qs[0], alternatives:qs.slice(1) });
    }
  });

  socket.on('regenerateQuestion', ({ category, difficulty }) => {
    if (socket.id!==gameState.host || !gameState.currentQuestion) return;
    const letter=gameState.currentQuestion;
    if (category)   gameState.aiPreferences.category   = category;
    if (difficulty) gameState.aiPreferences.difficulty = difficulty;
    const cat=gameState.aiPreferences.category; const diff=gameState.aiPreferences.difficulty;
    const qs=generateQuestionsAI(letter,cat,diff,3);
    if (!gameState.selectedCell) return;
    gameState.currentQuestionData=qs[0]; gameState.aiAlternatives=qs.slice(1);
    broadcastState();
    const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
    if (hostSock) hostSock.emit('questionsReady',{ active:qs[0], alternatives:qs.slice(1) });
  });

  socket.on('judge', correct => {
    if (socket.id!==gameState.host) return;
    const pid=gameState.buttonPressedBy;
    if (!pid||!gameState.players[pid]) return;
    const player=gameState.players[pid];
    if (gameState.answerTimerHandle) { clearTimeout(gameState.answerTimerHandle); gameState.answerTimerHandle=null; }
    if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle=null; }
    io.emit('judgeResult', { correct, playerName: player.name, team: player.team });
    if (correct) {
      player.score++; player.correctCount++;
      const {row,col}=gameState.selectedCell;
      gameState.grid[row][col].owner=player.team;
      clearAllTimers();
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null;
      gameState.lastWrongTeam=null; gameState.timeoutGiven={};
      gameState.cancelVoteActive=false; gameState.cancelVotes={};
      resetButtonState();
      // XP & LEVEL UP
      if (player.dbUsername) {
        try {
          const dbP = db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(player.dbUsername);
          if (dbP) {
            const newCorrect = dbP.correct_answers + 1;
            const newLevel   = Math.min(Math.floor(newCorrect / ANSWERS_PER_LEVEL) + 1, MAX_LEVEL);
            const leveledUp  = newLevel > dbP.level;
            let newPrestige  = dbP.prestige, prestigeUp = false;
            if (newLevel >= MAX_LEVEL && dbP.level < MAX_LEVEL && dbP.prestige < 10) {
              newPrestige++; prestigeUp = true;
            }
            db.prepare('UPDATE players SET correct_answers=?,level=?,prestige=? WHERE username=? COLLATE NOCASE')
              .run(newCorrect, prestigeUp?1:newLevel, newPrestige, player.dbUsername);
            const pSock = [...io.sockets.sockets.values()].find(s=>s.id===pid);
            if (pSock) {
              if (prestigeUp) pSock.emit('prestigeUp',{prestige:newPrestige,badge:getPlayerBadge(newPrestige)});
              else if (leveledUp) pSock.emit('levelUp',{level:newLevel});
              pSock.emit('xpUpdate',{correct_answers:newCorrect,level:prestigeUp?1:newLevel,prestige:newPrestige,badge:getPlayerBadge(newPrestige)});
            }
            player.badge = getPlayerBadge(newPrestige);
          }
        } catch(e){ console.error('XP error:',e); }
      }
      const winner=checkWin();
      if (winner) {
        Object.values(gameState.players).forEach(p=>{
          if(p.dbUsername) db.prepare('UPDATE players SET total_matches=total_matches+1 WHERE username=? COLLATE NOCASE').run(p.dbUsername);
        });
        gameState.wins[winner]++; gameState.phase='roundEnd'; broadcastState(); io.emit('roundWin',winner);
      } else broadcastState();
    } else {
      player.wrongCount++;
      applyWrongAnswer(player.team);
      broadcastState();
    }
  });

  socket.on('resetButton', () => {
    if (socket.id!==gameState.host) return;
    gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
    gameState.lastWrongTeam=null; gameState.timeoutGiven={};
    if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle=null; }
    if (gameState.answerTimerHandle) { clearTimeout(gameState.answerTimerHandle); gameState.answerTimerHandle=null; }
    gameState.opponentWindowOpen=false; gameState.opponentTeam=null; gameState.opponentTimerEnd=null;
    gameState.buttonOpen=true; gameState.buttonPressedBy=null;
    gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p=>{ p.muted=false; p.deafened=false; });
    broadcastState();
  });

  socket.on('openButtonAfterHint', () => {
    if (socket.id!==gameState.host) return;
    gameState.hintUnlocked=true; gameState.buttonOpen=true;
    gameState.buttonPressedBy=null; gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p=>{ p.muted=false; p.deafened=false; });
    broadcastState();
  });

  socket.on('hostTimeout', ({team}) => {
    if (socket.id!==gameState.host) return;
    const until=Date.now()+TEAM_TIMEOUT_MS;
    const teams=team==='all'?['green','orange']:[team];
    teams.forEach(t=>{
      if (t==='green') gameState.greenTimeoutUntil=until; else gameState.orangeTimeoutUntil=until;
      Object.values(gameState.players).forEach(p=>{ if(p.team===t){p.muted=true;p.deafened=true;} });
    });
    broadcastState();
    setTimeout(()=>{
      teams.forEach(t=>{
        if (t==='green') gameState.greenTimeoutUntil=0; else gameState.orangeTimeoutUntil=0;
        Object.values(gameState.players).forEach(p=>{ if(p.team===t){p.muted=false;p.deafened=false;} });
      }); broadcastState();
    }, TEAM_TIMEOUT_MS);
  });

  socket.on('hostMutePlayer',   ({playerId,muted})    => { if(socket.id===gameState.host&&gameState.players[playerId]){gameState.players[playerId].muted=muted;broadcastState();} });
  socket.on('hostDeafenPlayer', ({playerId,deafened}) => { if(socket.id===gameState.host&&gameState.players[playerId]){gameState.players[playerId].deafened=deafened;broadcastState();} });

  socket.on('restartGame', () => { if(socket.id!==gameState.host) return; resetGameState(); gameState.phase='playing'; gameState.grid=generateGrid(gameState.gridSize); broadcastState(); });

  socket.on('newRound', () => {
    if(socket.id!==gameState.host) return;
    io.emit('newRound');
    clearAllTimers(); gameState.phase='playing';
    gameState.grid=generateGrid(gameState.gridSize);
    gameState.selectedCell=null; gameState.currentQuestion=null;
    gameState.currentQuestionData=null; gameState.questionStartTime=null;
    resetButtonState();
    gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
    gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
    gameState.lastWrongTeam=null; gameState.timeoutGiven={};
    gameState.cancelVoteActive=false; gameState.cancelVotes={};
    broadcastState();
  });

  socket.on('pressButton', () => {
    if (!gameState.players[socket.id]||!gameState.buttonOpen||gameState.buttonPressedBy) return;
    const player=gameState.players[socket.id], team=player.team, now=Date.now();
    if (team==='green'&&gameState.greenTimeoutUntil>now) return;
    if (team==='orange'&&gameState.orangeTimeoutUntil>now) return;
    if (player.muted) return;
    if (gameState.opponentWindowOpen&&gameState.opponentTeam&&team!==gameState.opponentTeam) return;
    gameState.buttonPressedBy=socket.id; gameState.buttonPressedAt=now;
    gameState.buttonOpen=false; gameState.answerWindowOpen=true;
    gameState.answerTimerEnd=now+BUTTON_ANSWER_TIME;
    gameState.opponentWindowOpen=false;
    if(gameState.opponentTimerHandle){clearTimeout(gameState.opponentTimerHandle);gameState.opponentTimerHandle=null;}
    Object.entries(gameState.players).forEach(([id,p])=>{ if(id!==socket.id){p.muted=true;p.deafened=true;}else{p.muted=false;p.deafened=false;} });
    gameState.answerTimerHandle=setTimeout(()=>{
      if(gameState.buttonPressedBy===socket.id&&gameState.answerWindowOpen){
        const p=gameState.players[socket.id]; if(p) p.wrongCount++;
        applyWrongAnswer(team); broadcastState();
      }
    }, BUTTON_ANSWER_TIME);
    broadcastState();
    io.emit('buttonPressed',{ playerId:socket.id, playerName:player.name, team });
  });

  socket.on('voteHint', () => {
    if(!gameState.players[socket.id]||!gameState.hintActive) return;
    gameState.hintVotes[socket.id]=true;
    const total=Object.keys(gameState.players).length;
    if(total>0&&Object.keys(gameState.hintVotes).length>=total) io.emit('hintApproved');
    broadcastState();
  });

  socket.on('voteCancelQuestion', () => {
    if(!gameState.players[socket.id]||!gameState.cancelVoteActive) return;
    gameState.cancelVotes[socket.id]=true;
    const total=Object.keys(gameState.players).length;
    if(total>0&&Object.keys(gameState.cancelVotes).length>=total){
      clearAllTimers();
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null;
      resetButtonState(); gameState.lastWrongTeam=null; gameState.timeoutGiven={};
      gameState.cancelVoteActive=false; gameState.cancelVotes={};
      broadcastState(); io.emit('questionCancelled');
    } else broadcastState();
  });

  socket.on('webrtc-offer',  ({to,offer})     => io.to(to).emit('webrtc-offer',  {from:socket.id,offer}));
  socket.on('webrtc-answer', ({to,answer})    => io.to(to).emit('webrtc-answer', {from:socket.id,answer}));
  socket.on('webrtc-ice',    ({to,candidate}) => io.to(to).emit('webrtc-ice',    {from:socket.id,candidate}));

  socket.on('disconnect', () => {
    if(gameState.host===socket.id) gameState.host=null;
    if(gameState.buttonPressedBy===socket.id){ resetButtonState(); gameState.buttonOpen=!!(gameState.selectedCell); }
    delete gameState.players[socket.id];
    delete gameState.playerSurveys[socket.id];
    broadcastState();
  });
});

// =====================================================
// START
// =====================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ موجود (' + process.env.ANTHROPIC_API_KEY.slice(0,12) + '...)' : '❌ غير موجود'}`);
});