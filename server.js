const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// ===== CONSTANTS =====
const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و'];
const HOST_CODE          = process.env.HOST_CODE || 'Tty3201';
const BUTTON_ANSWER_TIME = 5000;
const TEAM_TIMEOUT_MS    = 10000;
const HINT_AFTER_MS      = 30000;
const CANCEL_VOTE_AFTER  = 2 * 60 * 1000;
const QUESTION_EXPIRE    = 5 * 60 * 1000;

// ===== AI QUESTION GENERATOR (Node.js fetch) =====
const questionCache = {};

const LETTER_EXAMPLES = {
  'أ':'أسد، أرجنتين، أبوظبي، أحمد، أرسنال',
  'ب':'برشلونة، بيليه، بغداد، باريس، بنزيمة',
  'ت':'تونس، تركيا، تشيلسي، توتنهام',
  'ث':'ثعلب، ثعبان، ثروت',
  'ج':'جدة، جنوب أفريقيا، جوارديولا، جمل',
  'ح':'حصان، حمدان، حضرموت، حمص',
  'خ':'خيول، خالد، خوان كارلوس',
  'د':'دبي، دوري أبطال، دانمارك',
  'ذ':'ذئب، ذهب، ذرة',
  'ر':'رونالدو، ريال مدريد، الرياض',
  'ز':'زيدان، زرافة، زلزال',
  'س':'سلمى، سنغافورة، سلاحف',
  'ش':'شيكاغو، شيرازي، شيتا',
  'ص':'صقر، صلاح، الصين',
  'ض':'ضفدع، ضباب، ضمد',
  'ط':'طائرة، طنجة، طوكيو',
  'ظ':'ظبي، ظفار، ظاهرة طبيعية',
  'ع':'عقاب، عمان، عصام',
  'غ':'غانا، غزال، غرناطة',
  'ف':'فرنسا، فهد، فلامنغو',
  'ق':'قطر، قاهرة، قطيف',
  'ك':'كرواتيا، كيليان مبابي، كلب',
  'ل':'لبنان، ليفربول، لوبيز',
  'م':'مدريد، محمد، ميسي، مكة',
  'ن':'نيمار، نيجيريا، نمر',
  'ه':'هولندا، هاري كين، هدهد',
  'و':'وليد، وهران، ورد',
};

const CAT_DESC  = {
  'كروي':'كرة القدم: لاعبون، أندية، مدربون، بطولات',
  'ديني':'إسلامية: أنبياء، صحابة، سور، أحداث',
  'علوم':'طبيعية: حيوانات، نباتات، ظواهر',
  'جغرافيا':'جغرافيا: دول، مدن، جبال، أنهار',
  'علمي':'علم وتقنية: علماء، اختراعات، مصطلحات',
  'ثقافي':'ثقافة عامة: شخصيات، أحداث، فنون',
  'عشوائي':'متنوع من جميع المجالات',
};
const DIFF_DESC = {
  'سهل':'مشهورة جداً يعرفها الجميع',
  'متوسط':'معروفة نسبياً',
  'صعب':'نادرة تحتاج معرفة عميقة',
};

function makeFallback(letter, count) {
  // fallback واضح — يظهر فقط لو انقطع الاتصال بالـ API
  return Array(count).fill(null).map((_, i) => ({
    text: `⚠️ تعذر توليد السؤال — اضغط "جديد" للمحاولة مرة أخرى`,
    answer: `${letter}...`,
    hint: 'اضغط زر التوليد من جديد',
    category: 'خطأ',
    difficulty: 'خطأ'
  })).slice(0, count);
}

async function generateQuestionsAI(letter, category='عشوائي', difficulty='متوسط', count=3) {
  const cacheKey = `${letter}-${category}-${difficulty}`;
  if (questionCache[cacheKey]) return questionCache[cacheKey];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [{text:`خطأ: مفتاح الـ API غير موجود`, answer:'خطأ', hint:'تأكد من الإعدادات', category, difficulty}];

  const catDesc  = CAT_DESC[category]   || 'متنوع';
  const diffDesc = DIFF_DESC[difficulty] || 'معروفة';

  const prompt = `أنت خبير في وضع أسئلة ذكية للعبة "حروف".
المطلوب: توليد ${count} أسئلة حلها يبدأ بحرف «${letter}».
التصنيف: ${category} (${catDesc})
الصعوبة: ${difficulty} (${diffDesc})

قواعد صارمة:
1. ممنوع نهائياً البدء بعبارة "اذكر كلمة" أو "ما هو الشيء".
2. استخدم أسلوب الوصف (Taboo): صِف الإجابة بذكاء ودع اللاعب يحزرها.
3. يجب أن تبدأ الإجابة (answer) حصرياً بحرف «${letter}».
4. الالتزام التام بالتصنيف المحدد — لا تخلط التصنيفات أبداً.
5. التلميح (hint) لا يحتوي على الإجابة ولا على أول حرف منها.

مثال (حرف م - كروي):
{"text":"أسطورة الأرجنتين وصاحب الكرة الذهبية 8 مرات","answer":"ميسي","hint":"لعب لبرشلونة وإنتر ميامي"}

أرجع مصفوفة JSON فقط:
[{"text":"...","answer":"...","hint":"...","category":"${category}","difficulty":"${difficulty}"}]`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s max
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

    // تحقق من أخطاء الـ API
    if (data.error) {
      console.error('API error:', JSON.stringify(data.error));
      return makeFallback(letter, count);
    }

    let raw = data?.content?.[0]?.text?.trim() || '';
    console.log(`AI raw (${letter}):`, raw.slice(0, 120));

    if (!raw) { console.error('Empty response from API'); return makeFallback(letter, count); }

    // تنظيف markdown بكل أشكاله
    raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // استخراج أول مصفوفة JSON صالحة
    const arrStart = raw.indexOf('[');
    const arrEnd   = raw.lastIndexOf(']');
    if (arrStart === -1 || arrEnd === -1) {
      console.error('No JSON array found in:', raw.slice(0, 200));
      return makeFallback(letter, count);
    }
    raw = raw.slice(arrStart, arrEnd + 1);

    const questions = JSON.parse(raw);

    // تحقق ذكي — يدعم عائلة الألف
    const normalizedLetter = letter.replace(/[أإآ]/g, 'ا');
    const valid = questions.filter(q => {
      const firstChar = (q.answer||'').trim().charAt(0).replace(/[أإآ]/g, 'ا');
      return firstChar === normalizedLetter;
    });

    const result = (valid.length > 0 ? valid : questions).slice(0, count);
    questionCache[cacheKey] = result;
    return result;

  } catch(e) {
    console.error('AI error:', e.message);
  }

  return makeFallback(letter, count);
}

function clearQuestionCache() { Object.keys(questionCache).forEach(k => delete questionCache[k]); }

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
    // لا نولّد مسبقاً — يولّد عند اختيار الخلية فقط لتجنب crash السيرفر
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

  socket.on('selectAlternativeQ', async idx => {
    if (socket.id!==gameState.host || !gameState.currentQuestion) return;
    const alts = gameState.aiAlternatives || [];
    if (alts[idx]) {
      gameState.currentQuestionData = alts[idx];
      broadcastState();
    } else {
      // لو ما في بدائل، ولّد جديد — امسح المفتاح المحدد فقط
      const letter = gameState.currentQuestion;
      const cat  = gameState.aiPreferences?.category  || 'عشوائي';
      const diff = gameState.aiPreferences?.difficulty || 'متوسط';
      const cacheKey = `${letter}-${cat}-${diff}`;
      delete questionCache[cacheKey];
      const qs = await generateQuestionsAI(letter, cat, diff, 3);
      gameState.currentQuestionData = qs[0];
      gameState.aiAlternatives = qs.slice(1);
      broadcastState();
      const hostSock = [...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
      if (hostSock) hostSock.emit('questionsReady', { active: qs[0], alternatives: qs.slice(1) });
    }
  });

  socket.on('regenerateQuestion', async ({ category, difficulty }) => {
    if (socket.id!==gameState.host || !gameState.currentQuestion) return;
    const letter = gameState.currentQuestion;
    // حدّث التفضيلات
    gameState.aiPreferences.category   = category   || gameState.aiPreferences.category;
    gameState.aiPreferences.difficulty = difficulty || gameState.aiPreferences.difficulty;
    const cat  = gameState.aiPreferences.category;
    const diff = gameState.aiPreferences.difficulty;
    // امسح كاش الحرف كله لضمان عدم تكرار الأسئلة القديمة
    Object.keys(questionCache).forEach(k => { if (k.startsWith(letter+'-')) delete questionCache[k]; });
    const qs = await generateQuestionsAI(letter, cat, diff, 3);
    if (!gameState.selectedCell) return;
    gameState.currentQuestionData = qs[0];
    gameState.aiAlternatives = qs.slice(1);
    broadcastState();
    const hostSock = [...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
    if (hostSock) hostSock.emit('questionsReady', { active: qs[0], alternatives: qs.slice(1) });
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
server.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ موجود (' + process.env.ANTHROPIC_API_KEY.slice(0,12) + '...)' : '❌ غير موجود — AI سيستخدم الـ fallback'}`);
});