// =====================================================
// game.js — منطق اللعبة + Socket.IO Events
// =====================================================

// الثوابت
const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي'];
const HOST_CODE          = process.env.HOST_CODE || 'Tty3201';
const BUTTON_ANSWER_TIME = 5000;
const TEAM_TIMEOUT_MS    = 10000;
const HINT_AFTER_MS      = 30000;
const CANCEL_VOTE_AFTER  = 2 * 60 * 1000;
const QUESTION_EXPIRE    = 5 * 60 * 1000;

// =====================================================
// GAME STATE
// =====================================================
let gameState = {
  phase: 'lobby', gridSize: 5, grid: [],
  teamNames: { green: 'الفريق الأخضر', orange: 'الفريق البرتقالي' },
  teamColors: { green: '#16a34a', orange: '#ea580c' },
  players: {}, host: null,
  selectedCell: null, currentQuestion: null,
  currentQuestionData: null, aiAlternatives: [],
  aiPreferences: { category: 'عشوائي', difficulty: 'متوسط' },
  buttonOpen: false, buttonPressedBy: null, buttonPressedAt: null,
  answerWindowOpen: false, answerTimerEnd: null,
  greenTimeoutUntil: 0, orangeTimeoutUntil: 0,
  wins: { green: 0, orange: 0 },
  hintVotes: {}, hintActive: false, hintUnlocked: false,
  hintTimerHandle: null, questionTimerHandle: null,
  cancelVoteTimerHandle: null, answerTimerHandle: null, opponentTimerHandle: null,
  lastWrongTeam: null, opponentWindowOpen: false, opponentTeam: null, opponentTimerEnd: null,
  inviteCode: 'حسن', timeoutGiven: {},
  cancelVoteActive: false, cancelVotes: {},
  playerSurveys: {}, questionStartTime: null,
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
    gameState.lastWrongTeam=null; gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
    gameState.opponentWindowOpen=false; gameState.opponentTeam=null; gameState.opponentTimerEnd=null;
    if (gameState.opponentTimerHandle) { clearTimeout(gameState.opponentTimerHandle); gameState.opponentTimerHandle=null; }
    gameState.buttonOpen=true; gameState.buttonPressedBy=null;
    gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
  } else if (!gameState.timeoutGiven[wrongTeam]) {
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
    gameState.lastWrongTeam=null; gameState.buttonOpen=true; gameState.buttonPressedBy=null;
    gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
  }
}

// =====================================================
// تسجيل Socket.IO Events
// =====================================================
function registerSocketEvents(io, db, playersDB, saveDB, getPlayerBadge, generateQuestionsAI, ANSWERS_PER_LEVEL, MAX_LEVEL) {
  function broadcastState() { io.emit('gameState', sanitizeState()); }

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
      const player = gameState.players[socket.id];
      if (player.dbUsername) {
        const key = player.dbUsername.toLowerCase();
        if (playersDB[key]) { playersDB[key].survey = data; playersDB[key].survey_date = new Date().toISOString(); saveDB(); }
      } else {
        const guestKey = '__guest__' + player.name;
        playersDB[guestKey] = playersDB[guestKey] || { username: player.name, type: 'guest' };
        playersDB[guestKey].survey = data; playersDB[guestKey].survey_date = new Date().toISOString(); saveDB();
      }
      broadcastState();
    });

    socket.on('playerJoin', ({ name, team, inviteCode, dbUsername }) => {
      const isAuth = dbUsername && db.prepare('SELECT id FROM players WHERE username=? COLLATE NOCASE').get(dbUsername);
      if (!isAuth && inviteCode!==gameState.inviteCode) { socket.emit('joinFail','يوزرنيمك غير مسجّل — سجّل أولاً'); return; }
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
        title: dbP?.title||'', level: dbP?.level||1, prestige: dbP?.prestige||0,
        badge: getPlayerBadge(dbP?.prestige||0)
      };
      broadcastState(); socket.emit('joinOk');
    });

    socket.on('setTeamName',  ({team,name})  => { if (socket.id!==gameState.host) return; gameState.teamNames[team]=name;  broadcastState(); });
    socket.on('setTeamColor', ({team,color}) => { if (socket.id!==gameState.host) return; gameState.teamColors[team]=color; broadcastState(); });
    socket.on('setGridSize',  size           => { if (socket.id!==gameState.host) return; gameState.gridSize=size; gameState.grid=generateGrid(size); broadcastState(); });

    socket.on('assignRandomTeams', () => {
      if (socket.id!==gameState.host) return;
      const randPlayers = Object.entries(gameState.players).filter(([,p])=>p.team==='random').map(([id])=>id).sort(()=>Math.random()-.5);
      const half = Math.ceil(randPlayers.length/2);
      randPlayers.forEach((id,i)=>{ gameState.players[id].team = i<half?'green':'orange'; });
      broadcastState();
      io.emit('teamsAssigned', Object.fromEntries(Object.entries(gameState.players).map(([id,p])=>[id,{name:p.name,team:p.team}])));
    });

    socket.on('showMVP', () => { if(socket.id!==gameState.host) return; io.emit('showMVP'); });

    socket.on('newGrid', () => {
      if (socket.id!==gameState.host) return;
      gameState.grid=generateGrid(gameState.gridSize); gameState.selectedCell=null; resetButtonState();
      gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false; broadcastState();
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
      gameState.selectedCell={ row, col }; gameState.currentQuestion=letter;
      gameState.questionStartTime=Date.now(); resetButtonState();
      gameState.buttonOpen=true; gameState.lastWrongTeam=null; gameState.timeoutGiven={};
      gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
      gameState.cancelVoteActive=false; gameState.cancelVotes={};
      const pref = gameState.aiPreferences;
      const questions = generateQuestionsAI(letter, pref.category, pref.difficulty, 3);
      gameState.currentQuestionData = questions[0] || null; gameState.aiAlternatives = questions.slice(1);
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
        const qs=generateQuestionsAI(letter,gameState.aiPreferences.category,gameState.aiPreferences.difficulty,3);
        gameState.currentQuestionData=qs[0]; gameState.aiAlternatives=qs.slice(1); broadcastState();
        const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
        if (hostSock) hostSock.emit('questionsReady',{ active:qs[0], alternatives:qs.slice(1) });
      }
    });

    socket.on('regenerateQuestion', ({ category, difficulty }) => {
      if (socket.id!==gameState.host || !gameState.currentQuestion) return;
      if (category)   gameState.aiPreferences.category   = category;
      if (difficulty) gameState.aiPreferences.difficulty = difficulty;
      const qs=generateQuestionsAI(gameState.currentQuestion,gameState.aiPreferences.category,gameState.aiPreferences.difficulty,3);
      if (!gameState.selectedCell) return;
      gameState.currentQuestionData=qs[0]; gameState.aiAlternatives=qs.slice(1); broadcastState();
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
        if (player.dbUsername) {
          try {
            const dbP = db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(player.dbUsername);
            if (dbP) {
              const newCorrect = dbP.correct_answers + 1;
              const newLevel   = Math.min(Math.floor(newCorrect / ANSWERS_PER_LEVEL) + 1, MAX_LEVEL);
              const leveledUp  = newLevel > dbP.level;
              let newPrestige  = dbP.prestige, prestigeUp = false;
              if (newLevel >= MAX_LEVEL && dbP.level < MAX_LEVEL && dbP.prestige < 10) { newPrestige++; prestigeUp = true; }
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
          Object.values(gameState.players).forEach(p=>{ if(p.dbUsername) db.prepare('UPDATE players SET total_matches=total_matches+1 WHERE username=? COLLATE NOCASE').run(p.dbUsername); });
          gameState.wins[winner]++; gameState.phase='roundEnd'; broadcastState(); io.emit('roundWin',winner);
        } else broadcastState();
      } else { player.wrongCount++; applyWrongAnswer(player.team); broadcastState(); }
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
      Object.values(gameState.players).forEach(p=>{ p.muted=false; p.deafened=false; }); broadcastState();
    });

    socket.on('openButtonAfterHint', () => {
      if (socket.id!==gameState.host) return;
      gameState.hintUnlocked=true; gameState.buttonOpen=true;
      gameState.buttonPressedBy=null; gameState.answerWindowOpen=false; gameState.answerTimerEnd=null;
      Object.values(gameState.players).forEach(p=>{ p.muted=false; p.deafened=false; }); broadcastState();
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
      io.emit('newRound'); clearAllTimers(); gameState.phase='playing';
      gameState.grid=generateGrid(gameState.gridSize);
      gameState.selectedCell=null; gameState.currentQuestion=null;
      gameState.currentQuestionData=null; gameState.questionStartTime=null; resetButtonState();
      gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
      gameState.hintVotes={}; gameState.hintActive=false; gameState.hintUnlocked=false;
      gameState.lastWrongTeam=null; gameState.timeoutGiven={};
      gameState.cancelVoteActive=false; gameState.cancelVotes={}; broadcastState();
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
      gameState.answerTimerEnd=now+BUTTON_ANSWER_TIME; gameState.opponentWindowOpen=false;
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
}

module.exports = { registerSocketEvents };