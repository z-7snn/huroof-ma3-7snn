const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ===== GAME STATE =====
const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و'];
const HOST_CODE = 'Tty3201';

let gameState = {
  phase: 'lobby', // lobby | playing | roundEnd
  gridSize: 5,
  grid: [],
  teamNames: { green: 'الفريق الأخضر', orange: 'الفريق البرتقالي' },
  players: {}, // socketId -> { name, team, score, muted, deafened }
  host: null,
  selectedCell: null, // { row, col }
  currentQuestion: null,
  buttonOpen: false,
  buttonPressedBy: null, // socketId
  buttonPressedAt: null,
  greenTimeoutUntil: 0,
  orangeTimeoutUntil: 0,
  wins: { green: 0, orange: 0 },
  hintVotes: {},
  hintActive: false,
  hintUnlocked: false,
  hintTimer: null,
  lastWrongTeam: null,
  bothWrong: false,
};

function generateGrid(size) {
  const letters = [...ARABIC_LETTERS];
  const grid = [];
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++) {
      const idx = Math.floor(Math.random() * letters.length);
      grid[r].push({
        letter: letters[idx],
        owner: null, // null | 'green' | 'orange'
        selected: false
      });
    }
  }
  return grid;
}

function resetGameState() {
  gameState.phase = 'lobby';
  gameState.grid = generateGrid(gameState.gridSize);
  gameState.selectedCell = null;
  gameState.currentQuestion = null;
  gameState.buttonOpen = false;
  gameState.buttonPressedBy = null;
  gameState.buttonPressedAt = null;
  gameState.greenTimeoutUntil = 0;
  gameState.orangeTimeoutUntil = 0;
  gameState.hintVotes = {};
  gameState.hintActive = false;
  gameState.hintUnlocked = false;
  gameState.lastWrongTeam = null;
  gameState.bothWrong = false;
  if (gameState.hintTimer) clearTimeout(gameState.hintTimer);
  gameState.hintTimer = null;
  // Reset players scores
  Object.values(gameState.players).forEach(p => p.score = 0);
}

function checkWin() {
  const size = gameState.gridSize;
  const grid = gameState.grid;

  // Green: right to left (col: size-1 to 0)
  const visited = { green: Array.from({length:size}, () => Array(size).fill(false)),
                    orange: Array.from({length:size}, () => Array(size).fill(false)) };

  function bfs(team, startCells, winCheck) {
    const queue = [...startCells];
    const vis = visited[team];
    startCells.forEach(([r,c]) => vis[r][c] = true);
    while (queue.length) {
      const [r, c] = queue.shift();
      if (winCheck(r, c)) return true;
      const neighbors = getHexNeighbors(r, c, size);
      for (const [nr, nc] of neighbors) {
        if (!vis[nr][nc] && grid[nr][nc].owner === team) {
          vis[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
    }
    return false;
  }

  // Green starts from right column
  const greenStart = [];
  for (let r = 0; r < size; r++) {
    if (grid[r][size-1]?.owner === 'green') greenStart.push([r, size-1]);
  }
  if (greenStart.length && bfs('green', greenStart, (r,c) => c === 0)) return 'green';

  // Orange starts from top row
  const orangeStart = [];
  for (let c = 0; c < size; c++) {
    if (grid[0]?.[c]?.owner === 'orange') orangeStart.push([0, c]);
  }
  if (orangeStart.length && bfs('orange', orangeStart, (r,c) => r === size-1)) return 'orange';

  return null;
}

function getHexNeighbors(r, c, size) {
  const dirs = [[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0]];
  const res = [];
  for (const [dr,dc] of dirs) {
    const nr = r+dr, nc = c+dc;
    if (nr>=0 && nr<size && nc>=0 && nc<size) res.push([nr,nc]);
  }
  return res;
}

function broadcastState() {
  io.emit('gameState', sanitizeState());
}

function sanitizeState() {
  return {
    phase: gameState.phase,
    gridSize: gameState.gridSize,
    grid: gameState.grid,
    teamNames: gameState.teamNames,
    players: gameState.players,
    selectedCell: gameState.selectedCell,
    currentQuestion: gameState.currentQuestion,
    buttonOpen: gameState.buttonOpen,
    buttonPressedBy: gameState.buttonPressedBy,
    greenTimeoutUntil: gameState.greenTimeoutUntil,
    orangeTimeoutUntil: gameState.orangeTimeoutUntil,
    wins: gameState.wins,
    hintVotes: gameState.hintVotes,
    hintActive: gameState.hintActive,
    hintUnlocked: gameState.hintUnlocked,
    bothWrong: gameState.bothWrong,
    lastWrongTeam: gameState.lastWrongTeam,
  };
}

function getTeamCount(team) {
  return Object.values(gameState.players).filter(p => p.team === team).length;
}

// ===== SOCKET EVENTS =====
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Host login
  socket.on('hostLogin', (code) => {
    if (code === HOST_CODE) {
      gameState.host = socket.id;
      socket.emit('hostOk');
      broadcastState();
    } else {
      socket.emit('hostFail');
    }
  });

  // Player join
  socket.on('playerJoin', ({ name, team }) => {
    if (getTeamCount(team) >= 2) {
      socket.emit('joinFail', 'الفريق ممتلئ');
      return;
    }
    gameState.players[socket.id] = {
      name, team, score: 0,
      muted: false, deafened: false
    };
    broadcastState();
    socket.emit('joinOk', { team, name });
  });

  // Host actions
  socket.on('setTeamName', ({ team, name }) => {
    if (socket.id !== gameState.host) return;
    gameState.teamNames[team] = name;
    broadcastState();
  });

  socket.on('setGridSize', (size) => {
    if (socket.id !== gameState.host) return;
    gameState.gridSize = size;
    gameState.grid = generateGrid(size);
    broadcastState();
  });

  socket.on('newGrid', () => {
    if (socket.id !== gameState.host) return;
    gameState.grid = generateGrid(gameState.gridSize);
    gameState.selectedCell = null;
    gameState.buttonOpen = false;
    gameState.buttonPressedBy = null;
    gameState.hintVotes = {};
    gameState.hintActive = false;
    gameState.hintUnlocked = false;
    if (gameState.hintTimer) clearTimeout(gameState.hintTimer);
    broadcastState();
  });

  socket.on('startGame', () => {
    if (socket.id !== gameState.host) return;
    gameState.phase = 'playing';
    gameState.grid = generateGrid(gameState.gridSize);
    broadcastState();
  });

  socket.on('selectCell', ({ row, col }) => {
    if (socket.id !== gameState.host) return;
    if (gameState.grid[row][col].owner) return; // already owned
    gameState.selectedCell = { row, col };
    gameState.currentQuestion = gameState.grid[row][col].letter;
    gameState.buttonOpen = true;
    gameState.buttonPressedBy = null;
    gameState.hintVotes = {};
    gameState.hintActive = false;
    gameState.hintUnlocked = false;
    gameState.lastWrongTeam = null;
    gameState.bothWrong = false;
    if (gameState.hintTimer) clearTimeout(gameState.hintTimer);
    // Start 30s hint timer
    gameState.hintTimer = setTimeout(() => {
      gameState.hintActive = true;
      broadcastState();
    }, 30000);
    broadcastState();
  });

  socket.on('judge', (correct) => {
    if (socket.id !== gameState.host) return;
    const pressedId = gameState.buttonPressedBy;
    if (!pressedId || !gameState.players[pressedId]) return;
    const player = gameState.players[pressedId];
    const team = player.team;
    const { row, col } = gameState.selectedCell;

    if (correct) {
      // Give cell to team
      gameState.grid[row][col].owner = team;
      gameState.grid[row][col].selected = false;
      player.score += 1;
      gameState.buttonOpen = false;
      gameState.buttonPressedBy = null;
      gameState.selectedCell = null;
      gameState.currentQuestion = null;
      gameState.lastWrongTeam = null;
      gameState.bothWrong = false;
      if (gameState.hintTimer) clearTimeout(gameState.hintTimer);
      // Check win
      const winner = checkWin();
      if (winner) {
        gameState.wins[winner] += 1;
        gameState.phase = 'roundEnd';
        io.emit('roundWin', winner);
      }
    } else {
      // Wrong answer
      const otherTeam = team === 'green' ? 'orange' : 'green';
      const now = Date.now();

      if (gameState.lastWrongTeam && gameState.lastWrongTeam !== team) {
        // Both wrong
        gameState.bothWrong = true;
        gameState.buttonOpen = true;
        gameState.buttonPressedBy = null;
        gameState.greenTimeoutUntil = 0;
        gameState.orangeTimeoutUntil = 0;
        // Unmute all
        Object.values(gameState.players).forEach(p => { p.muted = false; p.deafened = false; });
      } else {
        gameState.lastWrongTeam = team;
        // Timeout wrong team 10s
        const until = now + 10000;
        if (team === 'green') gameState.greenTimeoutUntil = until;
        else gameState.orangeTimeoutUntil = until;
        // Mute/deafen wrong team
        Object.values(gameState.players).forEach(p => {
          if (p.team === team) { p.muted = true; p.deafened = true; }
          else { p.muted = false; p.deafened = false; }
        });
        gameState.buttonOpen = true;
        gameState.buttonPressedBy = null;
        // Auto unmute after 10s
        setTimeout(() => {
          Object.values(gameState.players).forEach(p => {
            if (p.team === team) { p.muted = false; p.deafened = false; }
          });
          if (team === 'green') gameState.greenTimeoutUntil = 0;
          else gameState.orangeTimeoutUntil = 0;
          broadcastState();
        }, 10000);
      }
    }
    broadcastState();
  });

  socket.on('hostTimeout', ({ team }) => {
    if (socket.id !== gameState.host) return;
    const now = Date.now();
    const until = now + 10000;
    const applyTo = team === 'all' ? ['green','orange'] : [team];
    applyTo.forEach(t => {
      if (t === 'green') gameState.greenTimeoutUntil = until;
      else gameState.orangeTimeoutUntil = until;
      Object.values(gameState.players).forEach(p => {
        if (p.team === t) { p.muted = true; p.deafened = true; }
      });
    });
    broadcastState();
    setTimeout(() => {
      applyTo.forEach(t => {
        if (t === 'green') gameState.greenTimeoutUntil = 0;
        else gameState.orangeTimeoutUntil = 0;
        Object.values(gameState.players).forEach(p => {
          if (p.team === t) { p.muted = false; p.deafened = false; }
        });
      });
      broadcastState();
    }, 10000);
  });

  socket.on('hostMutePlayer', ({ playerId, muted }) => {
    if (socket.id !== gameState.host) return;
    if (gameState.players[playerId]) {
      gameState.players[playerId].muted = muted;
      broadcastState();
    }
  });

  socket.on('hostDeafenPlayer', ({ playerId, deafened }) => {
    if (socket.id !== gameState.host) return;
    if (gameState.players[playerId]) {
      gameState.players[playerId].deafened = deafened;
      broadcastState();
    }
  });

  socket.on('openButtonAfterHint', () => {
    if (socket.id !== gameState.host) return;
    gameState.hintUnlocked = true;
    gameState.buttonOpen = true;
    gameState.buttonPressedBy = null;
    broadcastState();
  });

  socket.on('restartGame', () => {
    if (socket.id !== gameState.host) return;
    resetGameState();
    gameState.phase = 'playing';
    gameState.grid = generateGrid(gameState.gridSize);
    broadcastState();
  });

  socket.on('newRound', () => {
    if (socket.id !== gameState.host) return;
    resetGameState();
    gameState.phase = 'playing';
    gameState.grid = generateGrid(gameState.gridSize);
    broadcastState();
  });

  // Player presses button
  socket.on('pressButton', () => {
    if (!gameState.players[socket.id]) return;
    if (!gameState.buttonOpen) return;
    if (gameState.buttonPressedBy) return;
    const player = gameState.players[socket.id];
    const team = player.team;
    const now = Date.now();
    // Check timeout
    if (team === 'green' && gameState.greenTimeoutUntil > now) return;
    if (team === 'orange' && gameState.orangeTimeoutUntil > now) return;
    if (player.muted) return;

    gameState.buttonPressedBy = socket.id;
    gameState.buttonOpen = false;

    // Mute/deafen everyone except presser
    Object.entries(gameState.players).forEach(([id, p]) => {
      if (id !== socket.id) { p.muted = true; p.deafened = true; }
    });

    broadcastState();
    io.emit('buttonPressed', { playerId: socket.id, playerName: player.name, team });
  });

  // Hint vote
  socket.on('voteHint', () => {
    if (!gameState.players[socket.id]) return;
    if (!gameState.hintActive) return;
    gameState.hintVotes[socket.id] = true;
    const totalPlayers = Object.keys(gameState.players).length;
    if (Object.keys(gameState.hintVotes).length >= totalPlayers && totalPlayers > 0) {
      io.emit('hintApproved');
    }
    broadcastState();
  });

  // WebRTC signaling
  socket.on('webrtc-offer', ({ to, offer }) => {
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });
  socket.on('webrtc-answer', ({ to, answer }) => {
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });
  socket.on('webrtc-ice', ({ to, candidate }) => {
    io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });

  socket.on('disconnect', () => {
    if (gameState.host === socket.id) gameState.host = null;
    delete gameState.players[socket.id];
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));