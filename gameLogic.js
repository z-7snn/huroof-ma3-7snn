// =====================================================
// gameLogic.js — منطق اللعبة + Socket.IO Events
// =====================================================

const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي'];
const HOST_CODE          = process.env.HOST_CODE || 'Tty3201';
const BUTTON_ANSWER_TIME = 5000;
const TEAM_TIMEOUT_MS    = 10000;
const HINT_AFTER_MS      = 30000;
const CANCEL_VOTE_AFTER  = 2 * 60 * 1000;
const QUESTION_EXPIRE    = 5 * 60 * 1000;

let gameState = {
  phase: 'lobby', gridSize: 5, grid: [],
  teamNames: { green: 'الفريق الأخضر', orange: 'الفريق البرتقالي' },
  teamColors: { green: '#16a34a', orange: '#ea580c' },
  players: {}, host: null,
  selectedCell: null, currentQuestion: null,
  currentQuestionData: null, aiAlternatives: [],
  aiPreferences: { category: 'عشوائي', difficulty: 'متوسط' },
  // btnState: idle | open | pressed | hint | correct | wrong | timeout_green | timeout_orange | cancelled
  btnState: 'idle',
  buttonPressedBy: null,
  answerTimerEnd: null,
  greenTimeoutUntil: 0, orangeTimeoutUntil: 0,
  timeoutGiven: {}, lastWrongTeam: null,
  hintVotes: {}, hintActive: false,
  cancelVoteActive: false, cancelVotes: {},
  hintTimerHandle: null, questionTimerHandle: null,
  cancelVoteTimerHandle: null, answerTimerHandle: null, timeoutTimerHandle: null,
  wins: { green: 0, orange: 0 },
  inviteCode: 'حسن', playerSurveys: {},
  questionStartTime: null, xpMultiplier: 1,
};

function generateGrid(size) {
  let pool = [];
  while (pool.length < size * size)
    pool = pool.concat([...ARABIC_LETTERS].sort(() => Math.random() - 0.5));
  pool = pool.slice(0, size * size).sort(() => Math.random() - 0.5);
  const grid = []; let i = 0;
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++) grid[r].push({ letter: pool[i++], owner: null });
  }
  return grid;
}

function getTeamCount(t) { return Object.values(gameState.players).filter(p => p.team === t).length; }

function getHexNeighbors(r, c, size) {
  const odd = c % 2 === 1;
  const dirs = odd ? [[-1,0],[1,0],[0,-1],[1,-1],[0,1],[1,1]] : [[-1,0],[1,0],[-1,-1],[0,-1],[-1,1],[0,1]];
  return dirs.map(([dr,dc]) => [r+dr, c+dc]).filter(([nr,nc]) => nr>=0 && nr<size && nc>=0 && nc<size);
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
  ['hintTimerHandle','questionTimerHandle','cancelVoteTimerHandle','answerTimerHandle','timeoutTimerHandle']
    .forEach(k => { if (gameState[k]) { clearTimeout(gameState[k]); gameState[k]=null; } });
}

function resetQuestionState() {
  clearAllTimers();
  gameState.selectedCell=null; gameState.currentQuestion=null;
  gameState.currentQuestionData=null; gameState.questionStartTime=null;
  gameState.btnState='idle'; gameState.buttonPressedBy=null; gameState.answerTimerEnd=null;
  gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
  gameState.timeoutGiven={}; gameState.lastWrongTeam=null;
  gameState.hintVotes={}; gameState.hintActive=false;
  gameState.cancelVoteActive=false; gameState.cancelVotes={};
  gameState.xpMultiplier=1;
  Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
}

function resetGameState() {
  resetQuestionState();
  gameState.phase='lobby'; gameState.grid=generateGrid(gameState.gridSize);
  Object.values(gameState.players).forEach(p => { p.score=0; p.correctCount=0; p.wrongCount=0; });
}

function sanitizeState() {
  return {
    phase:gameState.phase, gridSize:gameState.gridSize, grid:gameState.grid,
    teamNames:gameState.teamNames, teamColors:gameState.teamColors, players:gameState.players,
    selectedCell:gameState.selectedCell, currentQuestion:gameState.currentQuestion,
    currentQuestionData:gameState.currentQuestionData,
    btnState:gameState.btnState, buttonPressedBy:gameState.buttonPressedBy,
    answerTimerEnd:gameState.answerTimerEnd,
    greenTimeoutUntil:gameState.greenTimeoutUntil, orangeTimeoutUntil:gameState.orangeTimeoutUntil,
    wins:gameState.wins, hintVotes:gameState.hintVotes, hintActive:gameState.hintActive,
    cancelVoteActive:gameState.cancelVoteActive, cancelVotes:gameState.cancelVotes,
    questionStartTime:gameState.questionStartTime, xpMultiplier:gameState.xpMultiplier,
    inviteCode:gameState.inviteCode, timeoutGiven:gameState.timeoutGiven,
    lastWrongTeam:gameState.lastWrongTeam,
  };
}

function applyWrongAnswer(io, wrongTeam, broadcastState) {
  const now = Date.now();
  if (!gameState.timeoutGiven[wrongTeam]) {
    gameState.timeoutGiven[wrongTeam] = true;
    gameState.lastWrongTeam = wrongTeam;
    const until = now + TEAM_TIMEOUT_MS;
    if (wrongTeam==='green') gameState.greenTimeoutUntil=until;
    else gameState.orangeTimeoutUntil=until;
    gameState.btnState='timeout_'+wrongTeam;
    gameState.buttonPressedBy=null; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p => {
      if (p.team===wrongTeam) { p.muted=true; p.deafened=true; }
      else { p.muted=false; p.deafened=false; }
    });
    broadcastState();
    if (gameState.timeoutTimerHandle) clearTimeout(gameState.timeoutTimerHandle);
    gameState.timeoutTimerHandle = setTimeout(() => {
      if (wrongTeam==='green') gameState.greenTimeoutUntil=0;
      else gameState.orangeTimeoutUntil=0;
      gameState.btnState='open'; gameState.buttonPressedBy=null; gameState.lastWrongTeam=null;
      Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
      broadcastState();
    }, TEAM_TIMEOUT_MS);
  } else {
    gameState.btnState='open'; gameState.buttonPressedBy=null; gameState.answerTimerEnd=null;
    Object.values(gameState.players).forEach(p => { p.muted=false; p.deafened=false; });
    broadcastState();
  }
}

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
      gameState.playerSurveys[socket.id]=data; gameState.players[socket.id].surveyDone=true;
      const player=gameState.players[socket.id];
      if (player.dbUsername) {
        const key=player.dbUsername.toLowerCase();
        if (playersDB[key]) { playersDB[key].survey=data; playersDB[key].survey_date=new Date().toISOString(); saveDB(); }
      } else {
        const guestKey='__guest__'+player.name;
        playersDB[guestKey]=playersDB[guestKey]||{username:player.name,type:'guest'};
        playersDB[guestKey].survey=data; playersDB[guestKey].survey_date=new Date().toISOString(); saveDB();
      }
      broadcastState();
    });

    socket.on('playerJoin', ({ name, team, inviteCode, dbUsername }) => {
      const ex=Object.entries(gameState.players).find(([,p])=>p.name===name);
      if (ex) {
        const [oldId,pd]=ex; delete gameState.players[oldId]; gameState.players[socket.id]=pd;
        if (gameState.buttonPressedBy===oldId) gameState.buttonPressedBy=socket.id;
        broadcastState(); socket.emit('joinOk'); return;
      }
      const isAuth=dbUsername&&db.prepare('SELECT id FROM players WHERE username=? COLLATE NOCASE').get(dbUsername);
      if (!isAuth&&inviteCode!==gameState.inviteCode&&inviteCode!=='__auto__') { socket.emit('joinFail','يوزرنيمك غير مسجّل — سجّل أولاً'); return; }
      if (team!=='random'&&getTeamCount(team)>=2) { socket.emit('joinFail','الفريق ممتلئ'); return; }
      const dbP=dbUsername?db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(dbUsername):null;
      gameState.players[socket.id]={
        name,team,score:0,correctCount:0,wrongCount:0,muted:false,deafened:false,surveyDone:false,
        dbUsername:dbUsername||null, title:dbP?.title||'', level:dbP?.level||1,
        prestige:dbP?.prestige||0, badge:getPlayerBadge(dbP?.prestige||0)
      };
      broadcastState(); socket.emit('joinOk');
    });

    socket.on('setTeamName',  ({team,name})  => { if(socket.id!==gameState.host)return; gameState.teamNames[team]=name; broadcastState(); });
    socket.on('setTeamColor', ({team,color}) => { if(socket.id!==gameState.host)return; gameState.teamColors[team]=color; broadcastState(); });
    socket.on('setGridSize',  size           => { if(socket.id!==gameState.host)return; gameState.gridSize=size; gameState.grid=generateGrid(size); broadcastState(); });

    socket.on('assignRandomTeams', () => {
      if(socket.id!==gameState.host)return;
      const randPlayers=Object.entries(gameState.players).filter(([,p])=>p.team==='random').map(([id])=>id).sort(()=>Math.random()-.5);
      const half=Math.ceil(randPlayers.length/2);
      randPlayers.forEach((id,i)=>{ gameState.players[id].team=i<half?'green':'orange'; });
      broadcastState();
      io.emit('teamsAssigned',Object.fromEntries(Object.entries(gameState.players).map(([id,p])=>[id,{name:p.name,team:p.team}])));
    });

    socket.on('showMVP', () => { if(socket.id!==gameState.host)return; io.emit('showMVP'); });

    socket.on('newGrid', () => {
      if(socket.id!==gameState.host)return;
      gameState.grid=generateGrid(gameState.gridSize);
      gameState.selectedCell=null; gameState.btnState='idle'; gameState.buttonPressedBy=null;
      gameState.hintVotes={}; gameState.hintActive=false; broadcastState();
    });

    socket.on('startGame', () => {
      if(socket.id!==gameState.host)return;
      gameState.phase='playing';
      if(!gameState.grid.length) gameState.grid=generateGrid(gameState.gridSize);
      broadcastState();
    });

    socket.on('setAIPreferences', ({category,difficulty}) => {
      if(socket.id!==gameState.host)return;
      gameState.aiPreferences={category:category||'عشوائي',difficulty:difficulty||'متوسط'};
    });

    // ── الهوست يختار خلية ──
    socket.on('selectCell', ({row,col}) => {
      if(socket.id!==gameState.host||gameState.grid[row]?.[col]?.owner)return;
      clearAllTimers();
      const letter=gameState.grid[row][col].letter;
      gameState.selectedCell={row,col}; gameState.currentQuestion=letter;
      gameState.questionStartTime=Date.now();
      gameState.btnState='open'; gameState.buttonPressedBy=null; gameState.answerTimerEnd=null;
      gameState.lastWrongTeam=null; gameState.timeoutGiven={};
      gameState.hintVotes={}; gameState.hintActive=false;
      gameState.cancelVoteActive=false; gameState.cancelVotes={};
      gameState.xpMultiplier=1;
      Object.values(gameState.players).forEach(p=>{p.muted=false;p.deafened=false;});
      const pref=gameState.aiPreferences;
      const questions=generateQuestionsAI(letter,pref.category,pref.difficulty,3);
      gameState.currentQuestionData=questions[0]||null; gameState.aiAlternatives=questions.slice(1);
      broadcastState();
      const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
      if(hostSock) hostSock.emit('questionsReady',{active:questions[0],alternatives:questions.slice(1)});
      // تايمر تلميح
      gameState.hintTimerHandle=setTimeout(()=>{ gameState.hintActive=true; broadcastState(); },HINT_AFTER_MS);
      // تايمر تصويت إلغاء
      gameState.cancelVoteTimerHandle=setTimeout(()=>{ gameState.cancelVoteActive=true; broadcastState(); },CANCEL_VOTE_AFTER);
      // تايمر انتهاء السؤال — بدون تايم أوت
      gameState.questionTimerHandle=setTimeout(()=>{
        resetQuestionState(); broadcastState(); io.emit('questionExpired');
      },QUESTION_EXPIRE);
    });

    socket.on('selectAlternativeQ', idx => {
      if(socket.id!==gameState.host||!gameState.currentQuestion)return;
      const alts=gameState.aiAlternatives||[];
      if(alts[idx]){ gameState.currentQuestionData=alts[idx]; broadcastState(); }
      else {
        const qs=generateQuestionsAI(gameState.currentQuestion,gameState.aiPreferences.category,gameState.aiPreferences.difficulty,3);
        gameState.currentQuestionData=qs[0]; gameState.aiAlternatives=qs.slice(1); broadcastState();
        const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
        if(hostSock) hostSock.emit('questionsReady',{active:qs[0],alternatives:qs.slice(1)});
      }
    });

    socket.on('regenerateQuestion', ({category,difficulty}) => {
      if(socket.id!==gameState.host||!gameState.currentQuestion)return;
      if(category) gameState.aiPreferences.category=category;
      if(difficulty) gameState.aiPreferences.difficulty=difficulty;
      const qs=generateQuestionsAI(gameState.currentQuestion,gameState.aiPreferences.category,gameState.aiPreferences.difficulty,3);
      if(!gameState.selectedCell)return;
      gameState.currentQuestionData=qs[0]; gameState.aiAlternatives=qs.slice(1); broadcastState();
      const hostSock=[...io.sockets.sockets.values()].find(s=>s.id===gameState.host);
      if(hostSock) hostSock.emit('questionsReady',{active:qs[0],alternatives:qs.slice(1)});
    });

    socket.on('setXpMultiplier', mult => {
      if(socket.id!==gameState.host)return;
      gameState.xpMultiplier=[1,2,3].includes(mult)?mult:1; broadcastState();
    });

    // ── اللاعب يضغط الزر ──
    socket.on('pressButton', () => {
      if(!gameState.players[socket.id])return;
      if(gameState.btnState!=='open')return;
      const player=gameState.players[socket.id], team=player.team, now=Date.now();
      if(team==='green'&&gameState.greenTimeoutUntil>now)return;
      if(team==='orange'&&gameState.orangeTimeoutUntil>now)return;
      gameState.buttonPressedBy=socket.id; gameState.btnState='pressed';
      gameState.answerTimerEnd=now+BUTTON_ANSWER_TIME;
      Object.entries(gameState.players).forEach(([id,p])=>{
        if(id!==socket.id){p.muted=true;p.deafened=true;}else{p.muted=false;p.deafened=false;}
      });
      broadcastState();
      io.emit('buttonPressed',{playerId:socket.id,playerName:player.name,team});
      if(gameState.answerTimerHandle) clearTimeout(gameState.answerTimerHandle);
      gameState.answerTimerHandle=setTimeout(()=>{
        if(gameState.buttonPressedBy===socket.id&&gameState.btnState==='pressed'){
          const p=gameState.players[socket.id]; if(p) p.wrongCount++;
          gameState.btnState='wrong'; broadcastState();
          setTimeout(()=>{ applyWrongAnswer(io,team,broadcastState); },3000);
        }
      },BUTTON_ANSWER_TIME);
    });

    // ── الهوست يحكم ──
    socket.on('judge', correct => {
      if(socket.id!==gameState.host)return;
      const pid=gameState.buttonPressedBy;
      if(!pid||!gameState.players[pid])return;
      const player=gameState.players[pid], mult=gameState.xpMultiplier||1;
      if(gameState.answerTimerHandle){clearTimeout(gameState.answerTimerHandle);gameState.answerTimerHandle=null;}
      if(gameState.timeoutTimerHandle){clearTimeout(gameState.timeoutTimerHandle);gameState.timeoutTimerHandle=null;}
      io.emit('judgeResult',{correct,playerName:player.name,team:player.team});
      if(correct){
        player.score++; player.correctCount++;
        const {row,col}=gameState.selectedCell;
        gameState.grid[row][col].owner=player.team;
        gameState.btnState='correct'; broadcastState();
        setTimeout(()=>{
          if(player.dbUsername){
            try {
              const dbP=db.prepare('SELECT * FROM players WHERE username=? COLLATE NOCASE').get(player.dbUsername);
              if(dbP){
                const xpGained=1*mult, newCorrect=dbP.correct_answers+xpGained;
                const newLevel=Math.min(Math.floor(newCorrect/ANSWERS_PER_LEVEL)+1,MAX_LEVEL);
                const leveledUp=newLevel>dbP.level;
                let newPrestige=dbP.prestige, prestigeUp=false;
                if(newLevel>=MAX_LEVEL&&dbP.level<MAX_LEVEL&&dbP.prestige<10){newPrestige++;prestigeUp=true;}
                db.prepare('UPDATE players SET correct_answers=?,level=?,prestige=? WHERE username=? COLLATE NOCASE')
                  .run(newCorrect,prestigeUp?1:newLevel,newPrestige,player.dbUsername);
                const pSock=[...io.sockets.sockets.values()].find(s=>s.id===pid);
                if(pSock){
                  if(prestigeUp) pSock.emit('prestigeUp',{prestige:newPrestige,badge:getPlayerBadge(newPrestige)});
                  else if(leveledUp) pSock.emit('levelUp',{level:newLevel});
                  pSock.emit('xpUpdate',{correct_answers:newCorrect,level:prestigeUp?1:newLevel,prestige:newPrestige,badge:getPlayerBadge(newPrestige)});
                }
                player.badge=getPlayerBadge(newPrestige);
                io.emit('xpGain',{playerId:pid,playerName:player.name,team:player.team,xpGained,multiplier:mult,newCorrect,level:prestigeUp?1:newLevel,maxLevel:MAX_LEVEL,answersPerLevel:ANSWERS_PER_LEVEL});
              }
            } catch(e){console.error('XP error:',e);}
          } else {
            io.emit('xpGain',{playerId:pid,playerName:player.name,team:player.team,xpGained:1*mult,multiplier:mult,newCorrect:null,level:null});
          }
          const winner=checkWin();
          if(winner){
            Object.values(gameState.players).forEach(p=>{if(p.dbUsername) db.prepare('UPDATE players SET total_matches=total_matches+1 WHERE username=? COLLATE NOCASE').run(p.dbUsername);});
            gameState.wins[winner]++; gameState.phase='roundEnd';
            resetQuestionState(); broadcastState(); io.emit('roundWin',winner);
          } else { resetQuestionState(); broadcastState(); }
        },3000);
      } else {
        player.wrongCount++; gameState.btnState='wrong'; broadcastState();
        setTimeout(()=>{ applyWrongAnswer(io,player.team,broadcastState); },3000);
      }
    });

    socket.on('resetButton', ()=>{
      if(socket.id!==gameState.host)return;
      if(gameState.answerTimerHandle){clearTimeout(gameState.answerTimerHandle);gameState.answerTimerHandle=null;}
      if(gameState.timeoutTimerHandle){clearTimeout(gameState.timeoutTimerHandle);gameState.timeoutTimerHandle=null;}
      gameState.greenTimeoutUntil=0; gameState.orangeTimeoutUntil=0;
      gameState.lastWrongTeam=null; gameState.timeoutGiven={};
      gameState.btnState='open'; gameState.buttonPressedBy=null; gameState.answerTimerEnd=null;
      Object.values(gameState.players).forEach(p=>{p.muted=false;p.deafened=false;}); broadcastState();
    });

    socket.on('voteHint', ()=>{
      if(!gameState.players[socket.id]||!gameState.hintActive)return;
      gameState.hintVotes[socket.id]=true;
      const total=Object.keys(gameState.players).length;
      if(total>0&&Object.keys(gameState.hintVotes).length>=total){
        gameState.btnState='hint'; broadcastState(); io.emit('hintApproved');
      } else broadcastState();
    });

    socket.on('openButtonAfterHint', ()=>{
      if(socket.id!==gameState.host)return;
      gameState.btnState='open'; gameState.buttonPressedBy=null; gameState.answerTimerEnd=null;
      Object.values(gameState.players).forEach(p=>{p.muted=false;p.deafened=false;}); broadcastState();
    });

    socket.on('hostTimeout', ({team})=>{
      if(socket.id!==gameState.host)return;
      const until=Date.now()+TEAM_TIMEOUT_MS;
      const teams=team==='all'?['green','orange']:[team];
      teams.forEach(t=>{
        if(t==='green') gameState.greenTimeoutUntil=until; else gameState.orangeTimeoutUntil=until;
        Object.values(gameState.players).forEach(p=>{if(p.team===t){p.muted=true;p.deafened=true;}});
      });
      broadcastState();
      setTimeout(()=>{
        teams.forEach(t=>{
          if(t==='green') gameState.greenTimeoutUntil=0; else gameState.orangeTimeoutUntil=0;
          Object.values(gameState.players).forEach(p=>{if(p.team===t){p.muted=false;p.deafened=false;}});
        }); broadcastState();
      },TEAM_TIMEOUT_MS);
    });

    socket.on('voteCancelQuestion', ()=>{
      if(!gameState.players[socket.id]||!gameState.cancelVoteActive)return;
      gameState.cancelVotes[socket.id]=true;
      const total=Object.keys(gameState.players).length;
      if(total>0&&Object.keys(gameState.cancelVotes).length>=total){
        const answer=gameState.currentQuestionData?.answer||'';
        resetQuestionState(); broadcastState(); io.emit('questionCancelled',{answer});
      } else broadcastState();
    });

    // تعديل خلية من الهوست — ضغطتين يرجعها
    socket.on('resetCell', ({row,col})=>{
      if(socket.id!==gameState.host)return;
      if(gameState.grid[row]?.[col]) { gameState.grid[row][col].owner=null; broadcastState(); }
    });

    // كليك يمين — إعطاء خلية لفريق
    socket.on('assignCell', ({row,col,team})=>{
      if(socket.id!==gameState.host)return;
      if(gameState.grid[row]?.[col]) { gameState.grid[row][col].owner=team; broadcastState(); }
    });

    socket.on('hostMutePlayer',   ({playerId,muted})    => { if(socket.id===gameState.host&&gameState.players[playerId]){gameState.players[playerId].muted=muted;broadcastState();} });
    socket.on('hostDeafenPlayer', ({playerId,deafened}) => { if(socket.id===gameState.host&&gameState.players[playerId]){gameState.players[playerId].deafened=deafened;broadcastState();} });

    socket.on('restartGame', ()=>{ if(socket.id!==gameState.host)return; resetGameState(); gameState.phase='playing'; gameState.grid=generateGrid(gameState.gridSize); broadcastState(); });

    socket.on('newRound', ()=>{
      if(socket.id!==gameState.host)return;
      io.emit('newRound'); resetQuestionState(); gameState.phase='playing';
      gameState.grid=generateGrid(gameState.gridSize); broadcastState();
    });

    socket.on('webrtc-offer',  ({to,offer})     => io.to(to).emit('webrtc-offer',  {from:socket.id,offer}));
    socket.on('webrtc-answer', ({to,answer})    => io.to(to).emit('webrtc-answer', {from:socket.id,answer}));
    socket.on('webrtc-ice',    ({to,candidate}) => io.to(to).emit('webrtc-ice',    {from:socket.id,candidate}));

    socket.on('disconnect', ()=>{
      if(gameState.host===socket.id) gameState.host=null;
      if(gameState.buttonPressedBy===socket.id){
        gameState.btnState=gameState.selectedCell?'open':'idle';
        gameState.buttonPressedBy=null; gameState.answerTimerEnd=null;
        if(gameState.answerTimerHandle){clearTimeout(gameState.answerTimerHandle);gameState.answerTimerHandle=null;}
      }
      delete gameState.players[socket.id]; delete gameState.playerSurveys[socket.id];
      broadcastState();
    });
  });
}

module.exports = { registerSocketEvents };