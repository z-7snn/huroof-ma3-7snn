const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// ── AI Question Generator ─────────────────────────────────────────────────
// Cache: letter -> [questions]  (reset each new round)
const questionCache = {};

function generateQuestionsAI(letter, category = 'عشوائي', difficulty = 'متوسط', count = 3) {
  return new Promise((resolve) => {
    const cacheKey = `${letter}-${category}-${difficulty}`;
    if (questionCache[cacheKey]) { resolve(questionCache[cacheKey]); return; }

    const arg = JSON.stringify({ letter, category, difficulty, count });
    const py = spawn('python3', [path.join(__dirname, 'question_generator.py'), arg]);
    let out = '';
    py.stdout.on('data', d => out += d);
    py.on('close', () => {
      try {
        const questions = JSON.parse(out.trim());
        questionCache[cacheKey] = questions;
        resolve(questions);
      } catch {
        resolve([{ text: `اذكر كلمة تبدأ بـ ${letter}`, answer: '—', hint: '—', category: 'عام', difficulty: 'سهل' }]);
      }
    });
    py.on('error', () => {
      resolve([{ text: `اذكر كلمة تبدأ بـ ${letter}`, answer: '—', hint: '—', category: 'عام', difficulty: 'سهل' }]);
    });
    setTimeout(() => { py.kill(); resolve([{ text: `اذكر كلمة تبدأ بـ ${letter}`, answer: '—', hint: '—', category: 'عام', difficulty: 'سهل' }]); }, 15000);
  });
}

function clearQuestionCache() { Object.keys(questionCache).forEach(k => delete questionCache[k]); }

// ===== CONSTANTS =====
const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و'];
const HOST_CODE          = process.env.HOST_CODE || 'Tty3201';
const BUTTON_ANSWER_TIME = 5000;
const TEAM_TIMEOUT_MS    = 10000;
const HINT_AFTER_MS      = 30000;
const CANCEL_VOTE_AFTER  = 2 * 60 * 1000;
const QUESTION_EXPIRE    = 5 * 60 * 1000;

// ===== QUESTIONS DB =====
const QUESTIONS_DB = {
  'أ': [
    { text: 'اذكر حيواناً يبدأ بحرف الألف', hint: 'يعيش في الغابة ولديه خرطوم', category: 'علوم', difficulty: 'سهل' },
    { text: 'اذكر عاصمة دولة تبدأ بالألف', hint: 'في قارة أفريقيا', category: 'جغرافيا', difficulty: 'متوسط' },
    { text: 'اذكر لاعب كرة قدم اسمه يبدأ بالألف', hint: 'لاعب أرجنتيني مشهور', category: 'كروي', difficulty: 'سهل' },
  ],
  'ب': [
    { text: 'اذكر لاعب كرة مشهور اسمه يبدأ بالباء', hint: 'لعب في برشلونة وريال مدريد', category: 'كروي', difficulty: 'سهل' },
    { text: 'اذكر نبياً اسمه يبدأ بالباء', hint: 'من أنبياء بني إسرائيل', category: 'ديني', difficulty: 'متوسط' },
    { text: 'اذكر مدينة سعودية تبدأ بالباء', hint: 'على البحر الأحمر', category: 'جغرافيا', difficulty: 'سهل' },
  ],
  'ت': [
    { text: 'اذكر مدينة سعودية تبدأ بالتاء', hint: 'في المنطقة الغربية', category: 'جغرافيا', difficulty: 'سهل' },
    { text: 'اذكر تقنية حديثة تبدأ بالتاء', hint: 'يستخدمها الهاتف الذكي', category: 'علمي', difficulty: 'متوسط' },
  ],
  'ث': [
    { text: 'اذكر فاكهة تبدأ بالثاء', hint: 'حلوة جداً وحمراء', category: 'علوم', difficulty: 'سهل' },
  ],
  'ج': [
    { text: 'اذكر دولة تبدأ بالجيم', hint: 'في جنوب شرق آسيا', category: 'جغرافيا', difficulty: 'متوسط' },
    { text: 'اذكر صحابياً جليلاً اسمه يبدأ بالجيم', hint: 'من العشرة المبشرين بالجنة', category: 'ديني', difficulty: 'متوسط' },
  ],
  'ح': [
    { text: 'اذكر صحابياً جليلاً اسمه يبدأ بالحاء', hint: 'من العشرة المبشرين بالجنة', category: 'ديني', difficulty: 'متوسط' },
    { text: 'اذكر حيواناً بحرياً يبدأ بالحاء', hint: 'يتميز برأسه الكبير', category: 'علوم', difficulty: 'سهل' },
  ],
  'خ': [
    { text: 'اذكر رياضة تبدأ بالخاء', hint: 'فنون قتالية آسيوية', category: 'كروي', difficulty: 'سهل' },
    { text: 'اذكر خليفة راشدياً يبدأ اسمه بالخاء', hint: 'رابع الخلفاء الراشدين', category: 'ديني', difficulty: 'سهل' },
  ],
  'د': [
    { text: 'اذكر دولة عربية تبدأ بالدال', hint: 'في الخليج العربي', category: 'جغرافيا', difficulty: 'سهل' },
    { text: 'اذكر عالماً مسلماً مشهوراً يبدأ اسمه بالدال', hint: 'في علم الرياضيات', category: 'علمي', difficulty: 'صعب' },
  ],
  'ذ': [
    { text: 'اذكر نبياً اسمه يبدأ بالذال', hint: 'صاحب الحوت', category: 'ديني', difficulty: 'سهل' },
  ],
  'ر': [
    { text: 'اذكر لاعب كرة قدم اسمه يبدأ بالراء', hint: 'البرتغالي الشهير', category: 'كروي', difficulty: 'سهل' },
    { text: 'اذكر نهراً عالمياً يبدأ بالراء', hint: 'يمر بأوروبا', category: 'جغرافيا', difficulty: 'متوسط' },
  ],
  'ز': [
    { text: 'اذكر نبياً اسمه يبدأ بالزاي', hint: 'نبي الله زكريا عليه السلام', category: 'ديني', difficulty: 'سهل' },
    { text: 'اذكر زهرة أو نبتة تبدأ بالزاي', hint: 'تستخدم في الطبخ', category: 'علوم', difficulty: 'متوسط' },
  ],
  'س': [
    { text: 'اذكر مدينة سعودية تبدأ بالسين', hint: 'على ساحل البحر الأحمر', category: 'جغرافيا', difficulty: 'سهل' },
    { text: 'اذكر عالماً مشهوراً يبدأ اسمه بالسين', hint: 'اكتشف قانوناً في الفيزياء', category: 'علمي', difficulty: 'صعب' },
  ],
  'ش': [
    { text: 'اذكر شجرة اسمها يبدأ بالشين', hint: 'معروفة بثمرها الحلو', category: 'علوم', difficulty: 'سهل' },
    { text: 'اذكر شخصية إسلامية تبدأ بالشين', hint: 'إمام من الأئمة الأربعة', category: 'ديني', difficulty: 'متوسط' },
  ],
  'ص': [
    { text: 'اذكر صحابياً اسمه يبدأ بالصاد', hint: 'أول من أسلم من الرجال', category: 'ديني', difficulty: 'سهل' },
  ],
  'ض': [
    { text: 'اذكر دولة تبدأ بالضاد', hint: 'في أفريقيا', category: 'جغرافيا', difficulty: 'صعب' },
  ],
  'ط': [
    { text: 'اذكر طائراً اسمه يبدأ بالطاء', hint: 'يطير عالياً جداً', category: 'علوم', difficulty: 'سهل' },
    { text: 'اذكر اختراعاً علمياً يبدأ بالطاء', hint: 'يستخدم في المستشفيات', category: 'علمي', difficulty: 'متوسط' },
  ],
  'ظ': [
    { text: 'اذكر ظاهرة طبيعية تبدأ بالظاء', hint: 'تحدث في السماء عند المطر', category: 'علوم', difficulty: 'متوسط' },
  ],
  'ع': [
    { text: 'اذكر عاصمة عربية تبدأ بالعين', hint: 'في شمال أفريقيا', category: 'جغرافيا', difficulty: 'سهل' },
    { text: 'اذكر صحابياً اسمه يبدأ بالعين', hint: 'ثالث الخلفاء الراشدين', category: 'ديني', difficulty: 'سهل' },
  ],
  'غ': [
    { text: 'اذكر دولة تبدأ بالغين', hint: 'في غرب أفريقيا', category: 'جغرافيا', difficulty: 'صعب' },
  ],
  'ف': [
    { text: 'اذكر لاعباً مشهوراً اسمه يبدأ بالفاء', hint: 'نجم كروي فرنسي', category: 'كروي', difficulty: 'متوسط' },
    { text: 'اذكر فيلسوفاً مسلماً اسمه يبدأ بالفاء', hint: 'يلقب بالمعلم الثاني', category: 'علمي', difficulty: 'صعب' },
  ],
  'ق': [
    { text: 'اذكر قارة تبدأ بالقاف', hint: 'القطب الجنوبي', category: 'جغرافيا', difficulty: 'سهل' },
    { text: 'اذكر قصة قرآنية تبدأ بالقاف', hint: 'قصة نبي وقومه', category: 'ديني', difficulty: 'متوسط' },
  ],
  'ك': [
    { text: 'اذكر كوكباً يبدأ بالكاف', hint: 'له حلقات مميزة', category: 'علمي', difficulty: 'سهل' },
    { text: 'اذكر كأس كروية تبدأ بالكاف', hint: 'أوروبية مشهورة', category: 'كروي', difficulty: 'متوسط' },
  ],
  'ل': [
    { text: 'اذكر لاعب كرة قدم اسمه يبدأ باللام', hint: 'نجم فرنسي في ريال مدريد', category: 'كروي', difficulty: 'سهل' },
    { text: 'اذكر لغة تبدأ باللام', hint: 'لغة أوروبية لاتينية الأصل', category: 'علمي', difficulty: 'متوسط' },
  ],
  'م': [
    { text: 'اذكر مدينة عالمية تبدأ بالميم', hint: 'عاصمة دولة أوروبية', category: 'جغرافيا', difficulty: 'سهل' },
    { text: 'اذكر مخترعاً مشهوراً اسمه يبدأ بالميم', hint: 'اخترع المصباح الكهربائي', category: 'علمي', difficulty: 'سهل' },
  ],
  'ن': [
    { text: 'اذكر نجماً مشهوراً في كرة القدم اسمه يبدأ بالنون', hint: 'برازيلي لاعب في الدوري السعودي', category: 'كروي', difficulty: 'سهل' },
    { text: 'اذكر نهراً أفريقياً يبدأ بالنون', hint: 'أطول نهر في العالم', category: 'جغرافيا', difficulty: 'سهل' },
  ],
  'ه': [
    { text: 'اذكر هاتفاً ذكياً يبدأ بالهاء', hint: 'شركة صينية مشهورة', category: 'علمي', difficulty: 'سهل' },
  ],
  'و': [
    { text: 'اذكر وليّاً مشهوراً اسمه يبدأ بالواو', hint: 'من الصحابة الكرام', category: 'ديني', difficulty: 'متوسط' },
    { text: 'اذكر وحدة قياس علمية تبدأ بالواو', hint: 'تقيس القوة الكهربائية', category: 'علمي', difficulty: 'متوسط' },
  ],
};

// ===== GAME STATE =====
let gameState = {
  phase: 'lobby',
  gridSize: 5,
  grid: [],
  teamNames: { green: 'الفريق الأخضر', orange: 'الفريق البرتقالي' },
  players: {},
  host: null,
  selectedCell: null,
  currentQuestion: null,
  currentQuestionData: null,
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
  timeoutGiven: {},  // team -> true if already got timeout this question
  cancelVoteActive: false,
  cancelVotes: {},
  playerSurveys: {},
  questionStartTime: null,
};

// ─── helpers ───────────────────────────────────────────────────────────────
function generateGrid(size) {
  let pool = [];
  while (pool.length < size * size)
    pool = pool.concat([...ARABIC_LETTERS].sort(() => Math.random() - 0.5));
  pool = pool.slice(0, size * size).sort(() => Math.random() - 0.5);
  const grid = [];
  let i = 0;
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++)
      grid[r].push({ letter: pool[i++], owner: null });
  }
  return grid;
}

function getTeamCount(t) { return Object.values(gameState.players).filter(p => p.team === t).length; }

function getHexNeighbors(r, c, size) {
  const odd = c % 2 === 1;
  // Odd-Q offset grid — mathematically corrected
  const dirs = odd
    ? [[-1,0],[1,0],[0,-1],[1,-1],[0,1],[1,1]]   // أعمدة فردية
    : [[-1,0],[1,0],[-1,-1],[0,-1],[-1,1],[0,1]]; // أعمدة زوجية
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
  if (bfs('green',  Array.from({length:size},(_,r)=>[r,size-1]), (_,c)=>c===0)) return 'green';
  if (bfs('orange', Array.from({length:size},(_,c)=>[0,c]),      (r)=>r===size-1)) return 'orange';
  return null;
}

function clearAllTimers() {
  ['hintTimerHandle','questionTimerHandle','cancelVoteTimerHandle','answerTimerHandle','opponentTimerHandle']
    .forEach(k => { if (gameState[k]) { clearTimeout(gameState[k]); gameState[k]=null; } });
}

function resetButtonState() {
  if (gameState.answerTimerHandle) { clearTimeout(gameState.answerTimerHandle); gameState.answerTimerHandle=null; }
  if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle=null; }
  gameState.buttonOpen = false;
  gameState.buttonPressedBy = null;
  gameState.buttonPressedAt = null;
  gameState.answerWindowOpen = false;
  gameState.answerTimerEnd = null;
  gameState.opponentWindowOpen = false;
  gameState.opponentTeam = null;
  gameState.opponentTimerEnd = null;
  Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
}

function resetGameState() {
  clearAllTimers();
  gameState.phase = 'lobby';
  gameState.grid = generateGrid(gameState.gridSize);
  gameState.selectedCell = null;
  gameState.currentQuestion = null;
  gameState.currentQuestionData = null;
  gameState.questionStartTime = null;
  resetButtonState();
  gameState.greenTimeoutUntil = 0;
  gameState.orangeTimeoutUntil = 0;
  gameState.hintVotes = {};
  gameState.hintActive = false;
  gameState.hintUnlocked = false;
  gameState.lastWrongTeam = null;
  gameState.cancelVoteActive = false;
  gameState.cancelVotes = {};
  gameState.timeoutGiven = {};
  Object.values(gameState.players).forEach(p => { p.score=0; p.correctCount=0; p.wrongCount=0; });
}

function broadcastState() { io.emit('gameState', sanitizeState()); }

function sanitizeState() {
  return {
    phase: gameState.phase,
    gridSize: gameState.gridSize,
    grid: gameState.grid,
    teamNames: gameState.teamNames,
    players: gameState.players,
    selectedCell: gameState.selectedCell,
    currentQuestion: gameState.currentQuestion,
    currentQuestionData: gameState.currentQuestionData,
    buttonOpen: gameState.buttonOpen,
    buttonPressedBy: gameState.buttonPressedBy,
    answerWindowOpen: gameState.answerWindowOpen,
    answerTimerEnd: gameState.answerTimerEnd,
    greenTimeoutUntil: gameState.greenTimeoutUntil,
    orangeTimeoutUntil: gameState.orangeTimeoutUntil,
    wins: gameState.wins,
    hintVotes: gameState.hintVotes,
    hintActive: gameState.hintActive,
    hintUnlocked: gameState.hintUnlocked,
    lastWrongTeam: gameState.lastWrongTeam,
    opponentWindowOpen: gameState.opponentWindowOpen,
    opponentTeam: gameState.opponentTeam,
    opponentTimerEnd: gameState.opponentTimerEnd,
    inviteCode: gameState.inviteCode,
    cancelVoteActive: gameState.cancelVoteActive,
    cancelVotes: gameState.cancelVotes,
    questionStartTime: gameState.questionStartTime,
  };
}

function getQuestionForLetter(letter) {
  const qs = QUESTIONS_DB[letter];
  if (!qs?.length) return { text:`اذكر كلمة تبدأ بحرف ${letter}`, hint:'—', category:'عام', difficulty:'سهل' };
  return qs[Math.floor(Math.random() * qs.length)];
}

function applyWrongAnswer(wrongTeam) {
  const now = Date.now();
  const other = wrongTeam === 'green' ? 'orange' : 'green';

  // Check if this team already got their one timeout for this question
  const alreadyGotTimeout = gameState.timeoutGiven[wrongTeam];

  if (alreadyGotTimeout) {
    // No more timeout — just open button for everyone, no penalty
    gameState.lastWrongTeam = null;
    gameState.opponentWindowOpen = false;
    gameState.opponentTeam = null;
    gameState.opponentTimerEnd = null;
    gameState.buttonOpen = true;
    gameState.buttonPressedBy = null;
    gameState.answerWindowOpen = false;
    gameState.answerTimerEnd = null;
    Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
    return;
  }

  if (gameState.lastWrongTeam && gameState.lastWrongTeam !== wrongTeam) {
    // الفريق الثاني أجاب غلط — لا يأخذ تايم أوت، يفتح الزر للكل
    gameState.lastWrongTeam = null;
    gameState.greenTimeoutUntil = 0;
    gameState.orangeTimeoutUntil = 0;
    gameState.opponentWindowOpen = false;
    gameState.opponentTeam = null;
    gameState.opponentTimerEnd = null;
    if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle = null; }
    gameState.buttonOpen = true;
    gameState.buttonPressedBy = null;
    gameState.answerWindowOpen = false;
    gameState.answerTimerEnd = null;
    Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
  } else {
    // First wrong answer — give timeout, open opponent window
    gameState.timeoutGiven[wrongTeam] = true;
    gameState.lastWrongTeam = wrongTeam;
    const until = now + TEAM_TIMEOUT_MS;
    if (wrongTeam==='green') gameState.greenTimeoutUntil=until;
    else gameState.orangeTimeoutUntil=until;
    Object.values(gameState.players).forEach(p => {
      if (p.team===wrongTeam) { p.muted=true; p.deafened=true; }
      else { p.muted=false; p.deafened=false; }
    });
    gameState.opponentWindowOpen = true;
    gameState.opponentTeam = other;
    gameState.opponentTimerEnd = now + TEAM_TIMEOUT_MS;
    gameState.buttonOpen = true;
    gameState.buttonPressedBy = null;
    gameState.answerWindowOpen = false;
    gameState.answerTimerEnd = null;
    if (gameState.opponentTimerHandle) clearTimeout(gameState.opponentTimerHandle);
    gameState.opponentTimerHandle = setTimeout(() => {
      gameState.opponentWindowOpen = false;
      gameState.opponentTeam = null;
      gameState.opponentTimerEnd = null;
      gameState.lastWrongTeam = null;
      gameState.buttonOpen = true;
      gameState.buttonPressedBy = null;
      gameState.answerWindowOpen = false;
      gameState.answerTimerEnd = null;
      gameState.greenTimeoutUntil = 0;
      gameState.orangeTimeoutUntil = 0;
      Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
      broadcastState();
    }, TEAM_TIMEOUT_MS);
    setTimeout(() => {
      if (wrongTeam==='green') gameState.greenTimeoutUntil=0;
      else gameState.orangeTimeoutUntil=0;
      Object.values(gameState.players).forEach(p => { if (p.team===wrongTeam) { p.muted=false; p.deafened=false; } });
      broadcastState();
    }, TEAM_TIMEOUT_MS);
  }
}

// ─── PRE-GENERATION (spawn واحد لكل الحروف) ────────────────────────────────
async function preGenerateAllLetters(hostSocketId) {
  if (!gameState.grid.length) return;
  const letters = [...new Set(gameState.grid.flat().filter(c=>!c.owner).map(c=>c.letter))];
  if (!letters.length) return;

  const pref = gameState.aiPreferences || {};
  const cat  = pref.category  || 'عشوائي';
  const diff = pref.difficulty || 'متوسط';

  const hostSock = () => [...io.sockets.sockets.values()].find(s=>s.id===hostSocketId);
  if (hostSocketId) hostSock()?.emit('preGenStart', { total: letters.length });

  // Batch mode: spawn Python ONCE with all letters
  const arg = JSON.stringify({ letters, category: cat, difficulty: diff, count: 3 });
  const result = await new Promise((resolve) => {
    const py = spawn('python3', [path.join(__dirname, 'question_generator.py'), arg]);
    let out = '';
    py.stdout.on('data', d => out += d);
    py.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({}); }
    });
    py.on('error', () => resolve({}));
    // Progress: emit fake progress every ~2s while waiting
    let fakeProgress = 0;
    const progressInterval = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + Math.floor(letters.length * 0.2), letters.length - 1);
      if (hostSocketId) hostSock()?.emit('preGenProgress', { done: fakeProgress, total: letters.length });
    }, 2000);
    setTimeout(() => { clearInterval(progressInterval); py.kill(); resolve({}); }, 60000);
    py.on('close', () => clearInterval(progressInterval));
  });

  // Store in cache
  if (result && typeof result === 'object') {
    Object.entries(result).forEach(([letter, questions]) => {
      if (Array.isArray(questions) && questions.length) {
        const cacheKey = `${letter}-${cat}-${diff}`;
        questionCache[cacheKey] = questions;
      }
    });
  }

  if (hostSocketId) hostSock()?.emit('preGenDone', { total: letters.length });
}

// ─── SOCKET EVENTS ──────────────────────────────────────────────────────────
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
    gameState.playerSurveys[socket.id]=data;
    gameState.players[socket.id].surveyDone=true;
    broadcastState();
  });

  socket.on('playerJoin', ({ name, team, inviteCode }) => {
    if (inviteCode!==gameState.inviteCode) { socket.emit('joinFail','رمز الدعوة غير صحيح'); return; }
    const ex=Object.entries(gameState.players).find(([,p])=>p.name===name&&p.team===team);
    if (ex) {
      const [oldId,pd]=ex;
      delete gameState.players[oldId];
      gameState.players[socket.id]=pd;
      if (gameState.buttonPressedBy===oldId) gameState.buttonPressedBy=socket.id;
      broadcastState(); socket.emit('joinOk'); return;
    }
    if (getTeamCount(team)>=2) { socket.emit('joinFail','الفريق ممتلئ'); return; }
    gameState.players[socket.id]={ name, team, score:0, correctCount:0, wrongCount:0, muted:false, deafened:false, surveyDone:false };
    broadcastState(); socket.emit('joinOk');
  });

  socket.on('setTeamName', ({team,name}) => { if (socket.id!==gameState.host) return; gameState.teamNames[team]=name; broadcastState(); });
  socket.on('setGridSize', size => { if (socket.id!==gameState.host) return; gameState.gridSize=size; gameState.grid=generateGrid(size); broadcastState(); });

  socket.on('newGrid', () => {
    if (socket.id!==gameState.host) return;
    gameState.grid=generateGrid(gameState.gridSize);
    gameState.selectedCell=null;
    resetButtonState();
    gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
    broadcastState();
  });

  socket.on('startGame', () => {
    if (socket.id!==gameState.host) return;
    gameState.phase='playing';
    if (!gameState.grid.length) gameState.grid=generateGrid(gameState.gridSize);
    broadcastState();
    // Pre-generate questions for all unique letters on grid in background
    preGenerateAllLetters(socket.id);
  });

  socket.on('setAIPreferences', ({ category, difficulty }) => {
    if (socket.id!==gameState.host) return;
    gameState.aiPreferences = { category: category||'عشوائي', difficulty: difficulty||'متوسط' };
    clearQuestionCache();
    preGenerateAllLetters(socket.id);
  });

  socket.on('selectCell', async ({ row, col }) => {
    if (socket.id!==gameState.host || gameState.grid[row]?.[col]?.owner) return;
    clearAllTimers();
    const letter = gameState.grid[row][col].letter;
    gameState.selectedCell={ row, col };
    gameState.currentQuestion = letter;
    gameState.questionStartTime = Date.now();
    gameState.currentQuestionData = { text:'⏳ جاري توليد السؤال...', hint:'—', category:'—', difficulty:'—', answer:'—' };
    resetButtonState();
    gameState.buttonOpen=true;
    gameState.lastWrongTeam=null;
    gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
    gameState.cancelVoteActive=false; gameState.cancelVotes={};
    gameState.timeoutGiven={};
    broadcastState();

    const pref = gameState.aiPreferences||{};
    generateQuestionsAI(letter, pref.category||'عشوائي', pref.difficulty||'متوسط', 3).then(questions => {
      if (!gameState.selectedCell || gameState.selectedCell.row!==row || gameState.selectedCell.col!==col) return;
      gameState.currentQuestionData = questions[0];
      gameState.aiAlternatives = questions.slice(1);
      broadcastState();
      const hostSock = [...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
      if (hostSock) hostSock.emit('questionsReady', { active: questions[0], alternatives: questions.slice(1) });
    });

    gameState.hintTimerHandle=setTimeout(()=>{ gameState.hintActive=true; broadcastState(); }, HINT_AFTER_MS);
    gameState.cancelVoteTimerHandle=setTimeout(()=>{ gameState.cancelVoteActive=true; broadcastState(); }, CANCEL_VOTE_AFTER);
    gameState.questionTimerHandle=setTimeout(()=>{
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null;
      resetButtonState(); broadcastState(); io.emit('questionExpired');
    }, QUESTION_EXPIRE);
  });

  socket.on('selectAlternativeQ', idx => {
    if (socket.id!==gameState.host) return;
    const alts=gameState.aiAlternatives||[];
    if (alts[idx]) { gameState.currentQuestionData=alts[idx]; broadcastState(); }
  });

  socket.on('regenerateQuestion', async ({ category, difficulty }) => {
    if (socket.id!==gameState.host || !gameState.currentQuestion) return;
    const letter=gameState.currentQuestion;
    const cat=category||gameState.aiPreferences?.category||'عشوائي';
    const diff=difficulty||gameState.aiPreferences?.difficulty||'متوسط';
    if(category||difficulty) gameState.aiPreferences={category:cat,difficulty:diff};
    const ckey = letter+'-'+cat+'-'+diff;
    delete questionCache[ckey];
    const qs = await generateQuestionsAI(letter, cat, diff, 3);
    if(!gameState.selectedCell) return;
    gameState.currentQuestionData=qs[0];
    gameState.aiAlternatives=qs.slice(1);
    broadcastState();
    const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
    if(hostSock) hostSock.emit('questionsReady',{active:qs[0],alternatives:qs.slice(1)});
  });

  socket.on('judge', correct => {
    if (socket.id!==gameState.host) return;
    const pid=gameState.buttonPressedBy;
    if (!pid || !gameState.players[pid]) return;
    const player=gameState.players[pid];
    if (gameState.answerTimerHandle) { clearTimeout(gameState.answerTimerHandle); gameState.answerTimerHandle=null; }
    if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle=null; }
    // أرسل النتيجة لكل اللاعبين فوراً قبل أي تعديل
    io.emit('judgeResult', { correct, playerName: player.name, team: player.team });

    if (correct) {
      player.score++; player.correctCount++;
      const {row,col}=gameState.selectedCell;
      gameState.grid[row][col].owner=player.team;
      clearAllTimers();
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null;
      gameState.lastWrongTeam=null; gameState.cancelVoteActive=false; gameState.cancelVotes={};
      resetButtonState();
      const winner=checkWin();
      if (winner) { gameState.wins[winner]++; gameState.phase='roundEnd'; broadcastState(); io.emit('roundWin',winner); }
      else broadcastState();
    } else {
      player.wrongCount++;
      applyWrongAnswer(player.team);
      broadcastState();
    }
  });

  // RESET BUTTON — host force-unlock, keep current question
  socket.on('resetButton', () => {
    if (socket.id!==gameState.host) return;
    gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
    gameState.lastWrongTeam=null;
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
      if (t==='green') gameState.greenTimeoutUntil=until;
      else gameState.orangeTimeoutUntil=until;
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

  socket.on('hostMutePlayer',   ({playerId,muted})    => { if(socket.id===gameState.host&&gameState.players[playerId]) { gameState.players[playerId].muted=muted; broadcastState(); } });
  socket.on('hostDeafenPlayer', ({playerId,deafened}) => { if(socket.id===gameState.host&&gameState.players[playerId]) { gameState.players[playerId].deafened=deafened; broadcastState(); } });

  socket.on('restartGame', () => { if(socket.id!==gameState.host) return; resetGameState(); gameState.phase='playing'; gameState.grid=generateGrid(gameState.gridSize); broadcastState(); });
  socket.on('newRound',    () => {
    if(socket.id!==gameState.host) return;
    clearAllTimers(); gameState.phase='playing';
    gameState.grid=generateGrid(gameState.gridSize);
    gameState.selectedCell=null; gameState.currentQuestion=null;
    gameState.currentQuestionData=null; gameState.questionStartTime=null;
    resetButtonState();
    gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
    gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
    gameState.lastWrongTeam=null; gameState.cancelVoteActive=false; gameState.cancelVotes={};
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
      if(gameState.buttonPressedBy===socket.id&&gameState.answerWindowOpen) {
        const p=gameState.players[socket.id];
        if(p) p.wrongCount++;
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
    if(total>0&&Object.keys(gameState.cancelVotes).length>=total) {
      clearAllTimers();
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null;
      resetButtonState(); gameState.lastWrongTeam=null;
      gameState.cancelVoteActive=false; gameState.cancelVotes={};
      broadcastState(); io.emit('questionCancelled');
    } else broadcastState();
  });

  socket.on('webrtc-offer',  ({to,offer})     => io.to(to).emit('webrtc-offer',  {from:socket.id,offer}));
  socket.on('webrtc-answer', ({to,answer})    => io.to(to).emit('webrtc-answer', {from:socket.id,answer}));
  socket.on('webrtc-ice',    ({to,candidate}) => io.to(to).emit('webrtc-ice',    {from:socket.id,candidate}));

  socket.on('disconnect', () => {
    if(gameState.host===socket.id) gameState.host=null;
    if(gameState.buttonPressedBy===socket.id) { resetButtonState(); gameState.buttonOpen=!!(gameState.selectedCell); }
    delete gameState.players[socket.id];
    delete gameState.playerSurveys[socket.id];
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));