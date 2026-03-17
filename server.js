const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// =====================================================
// CONSTANTS
// =====================================================
const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و'];
const HOST_CODE          = process.env.HOST_CODE || 'Tty3201';
const BUTTON_ANSWER_TIME = 5000;
const TEAM_TIMEOUT_MS    = 10000;
const HINT_AFTER_MS      = 30000;
const CANCEL_VOTE_AFTER  = 2 * 60 * 1000;
const QUESTION_EXPIRE    = 5 * 60 * 1000;

// =====================================================
// AI QUESTION GENERATOR
// =====================================================
const questionCache = {};

const CAT_DESC = {
  'كروي':    'كرة القدم: لاعبون، أندية، مدربون، بطولات',
  'ديني':    'إسلامية: أنبياء، صحابة، سور، أحداث',
  'علوم':    'طبيعية: حيوانات، نباتات، ظواهر',
  'جغرافيا': 'جغرافيا: دول، مدن، جبال، أنهار',
  'علمي':    'علم وتقنية: علماء، اختراعات، مصطلحات',
  'ثقافي':   'ثقافة عامة: شخصيات، أحداث، فنون',
  'عشوائي':  'متنوع من جميع المجالات',
};
const DIFF_DESC = {
  'سهل':   'مشهورة جداً يعرفها الجميع',
  'متوسط': 'معروفة نسبياً',
  'صعب':   'نادرة تحتاج معرفة عميقة',
};

function makeFallback(letter, count) {
  return Array(count).fill(null).map(() => ({
    text: `⚠️ تعذر توليد السؤال — اضغط "جديد" للمحاولة مرة أخرى`,
    answer: `${letter}...`,
    hint: 'اضغط زر التوليد من جديد',
    category: 'خطأ',
    difficulty: 'خطأ',
  })).slice(0, count);
}

async function generateQuestionsAI(letter, category = 'عشوائي', difficulty = 'متوسط', count = 3) {
  const cacheKey = `${letter}-${category}-${difficulty}`;
  if (questionCache[cacheKey]) return questionCache[cacheKey];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return makeFallback(letter, count);

  const catDesc  = CAT_DESC[category]   || 'متنوع';
  const diffDesc = DIFF_DESC[difficulty] || 'معروفة';

  const prompt = `أنت خبير في وضع أسئلة ذكية للعبة "حروف".
المطلوب: توليد ${count} أسئلة حلها يبدأ بحرف «${letter}».
التصنيف: ${category} (${catDesc})
الصعوبة: ${difficulty} (إجابات ${diffDesc})

قواعد صارمة:
1. ممنوع نهائياً البدء بعبارة "اذكر كلمة" أو "ما هو الشيء".
2. استخدم أسلوب الوصف Taboo: صِف الإجابة بذكاء ودع اللاعب يحزرها.
3. يجب أن تبدأ الإجابة (answer) بحرف «${letter}».
4. الالتزام التام بالتصنيف المحدد (${category}).
5. التلميح (hint) لا يحتوي على الإجابة.

مثال (حرف م - كروي):
{"text":"أسطورة الأرجنتين وصاحب الكرة الذهبية 8 مرات","answer":"ميسي","hint":"لعب لبرشلونة وإنتر ميامي"}

أرجع مصفوفة JSON فقط بدون أي نص خارجها:
[{"text":"...","answer":"...","hint":"...","category":"${category}","difficulty":"${difficulty}"}]`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        temperature: 0.8,
        system: 'أنت مولّد أسئلة محترف. رد بـ JSON فقط بدون أي نص خارجه.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data.error) { console.error('API error:', JSON.stringify(data.error)); return makeFallback(letter, count); }

    let raw = data?.content?.[0]?.text?.trim() || '';
    console.log(`AI raw (${letter}/${category}):`, raw.slice(0, 100));

    if (!raw) return makeFallback(letter, count);

    // تنظيف markdown
    raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // استخراج أول مصفوفة JSON
    const arrStart = raw.indexOf('[');
    const arrEnd   = raw.lastIndexOf(']');
    if (arrStart === -1 || arrEnd === -1) { console.error('No JSON array in response'); return makeFallback(letter, count); }
    raw = raw.slice(arrStart, arrEnd + 1);

    const questions = JSON.parse(raw);
    if (!Array.isArray(questions) || !questions.length) return makeFallback(letter, count);

    // تحقق ذكي — يدعم عائلة الألف
    const norm = (ch) => (ch||'').replace(/[أإآ]/g, 'ا');
    const valid = questions.filter(q => norm((q.answer||'').trim().charAt(0)) === norm(letter));
    const result = (valid.length > 0 ? valid : questions).slice(0, count);
    questionCache[cacheKey] = result;
    return result;

  } catch (e) {
    console.error('AI error:', e.message);
  }
  return makeFallback(letter, count);
}

function clearQuestionCache() { Object.keys(questionCache).forEach(k => delete questionCache[k]); }

// =====================================================
// GAME STATE  ← يجب أن يكون قبل io.on('connection')
// =====================================================
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
    clearQuestionCache();
  });

  socket.on('selectCell', async ({ row, col }) => {
    if (socket.id!==gameState.host || gameState.grid[row]?.[col]?.owner) return;
    clearAllTimers();
    const letter = gameState.grid[row][col].letter;
    gameState.selectedCell={ row, col };
    gameState.currentQuestion=letter;
    gameState.questionStartTime=Date.now();
    gameState.currentQuestionData={ text:'⏳ جاري توليد السؤال...', hint:'—', category:'—', difficulty:'—', answer:'—' };
    resetButtonState();
    gameState.buttonOpen=true; gameState.lastWrongTeam=null; gameState.timeoutGiven={};
    gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
    gameState.cancelVoteActive=false; gameState.cancelVotes={};
    broadcastState();

    const pref = gameState.aiPreferences;
    generateQuestionsAI(letter, pref.category, pref.difficulty, 3).then(questions => {
      if (!gameState.selectedCell || gameState.selectedCell.row!==row || gameState.selectedCell.col!==col) return;
      gameState.currentQuestionData=questions[0];
      gameState.aiAlternatives=questions.slice(1);
      broadcastState();
      const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
      if (hostSock) hostSock.emit('questionsReady',{ active:questions[0], alternatives:questions.slice(1) });
    });

    gameState.hintTimerHandle=setTimeout(()=>{ gameState.hintActive=true; broadcastState(); }, HINT_AFTER_MS);
    gameState.cancelVoteTimerHandle=setTimeout(()=>{ gameState.cancelVoteActive=true; broadcastState(); }, CANCEL_VOTE_AFTER);
    gameState.questionTimerHandle=setTimeout(()=>{
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null;
      resetButtonState(); broadcastState(); io.emit('questionExpired');
    }, QUESTION_EXPIRE);
  });

  socket.on('selectAlternativeQ', async idx => {
    if (socket.id!==gameState.host || !gameState.currentQuestion) return;
    const alts=gameState.aiAlternatives||[];
    if (alts[idx]) {
      gameState.currentQuestionData=alts[idx]; broadcastState();
    } else {
      const letter=gameState.currentQuestion;
      const cat=gameState.aiPreferences.category; const diff=gameState.aiPreferences.difficulty;
      const cacheKey=`${letter}-${cat}-${diff}`; delete questionCache[cacheKey];
      const qs=await generateQuestionsAI(letter,cat,diff,3);
      gameState.currentQuestionData=qs[0]; gameState.aiAlternatives=qs.slice(1);
      broadcastState();
      const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
      if (hostSock) hostSock.emit('questionsReady',{ active:qs[0], alternatives:qs.slice(1) });
    }
  });

  socket.on('regenerateQuestion', async ({ category, difficulty }) => {
    if (socket.id!==gameState.host || !gameState.currentQuestion) return;
    const letter=gameState.currentQuestion;
    gameState.aiPreferences.category   = category   || gameState.aiPreferences.category;
    gameState.aiPreferences.difficulty = difficulty || gameState.aiPreferences.difficulty;
    const cat=gameState.aiPreferences.category; const diff=gameState.aiPreferences.difficulty;
    Object.keys(questionCache).forEach(k => { if (k.startsWith(letter+'-')) delete questionCache[k]; });
    const qs=await generateQuestionsAI(letter,cat,diff,3);
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
      const winner=checkWin();
      if (winner) { gameState.wins[winner]++; gameState.phase='roundEnd'; broadcastState(); io.emit('roundWin',winner); }
      else broadcastState();
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