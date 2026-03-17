// game.js - Shared utilities & Audio Engine
// ============================================

// ===== AUDIO ENGINE =====
const AudioEngine = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function resume() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
  }

  function playTone(freq, duration, type = 'sine', gain = 0.3, startTime) {
    const c = getCtx();
    const osc = c.createOscillator();
    const gainNode = c.createGain();
    osc.connect(gainNode);
    gainNode.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime || c.currentTime);
    gainNode.gain.setValueAtTime(gain, startTime || c.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, (startTime || c.currentTime) + duration);
    osc.start(startTime || c.currentTime);
    osc.stop((startTime || c.currentTime) + duration);
  }

  function playButtonPress() {
    resume();
    const c = getCtx();
    const now = c.currentTime;
    // صوت "بوم" + نغمة صاعدة واضحة
    playTone(120, 0.15, 'sawtooth', 0.4, now);       // بوم قوي
    playTone(440, 0.12, 'square',   0.25, now + 0.05);
    playTone(660, 0.12, 'square',   0.22, now + 0.15);
    playTone(880, 0.18, 'sine',     0.2,  now + 0.25);
    playTone(1100, 3.0, 'sine',     0.12, now + 0.35); // رنين طويل خفيف
  }

  function playExpire() {
    resume();
    const c = getCtx();
    const now = c.currentTime;
    playTone(300, 0.3, 'sawtooth', 0.3, now);
    playTone(200, 0.5, 'sawtooth', 0.3, now + 0.3);
  }

  function playCorrect() {
    resume();
    const c = getCtx();
    const now = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => playTone(f, 0.25, 'sine', 0.25, now + i * 0.12));
  }

  function playWrong() {
    resume();
    const c = getCtx();
    const now = c.currentTime;
    [400, 320, 250, 180].forEach((f, i) => playTone(f, 0.25, 'sawtooth', 0.25, now + i * 0.12));
  }

  function playTick() {
    resume();
    const c = getCtx();
    const now = c.currentTime;
    playTone(1200, 0.04, 'square', 0.1, now);
    playTone(900,  0.03, 'square', 0.06, now + 0.04);
  }

  function playWin() {
    resume();
    const c = getCtx();
    const now = c.currentTime;
    const melody = [523, 659, 784, 659, 784, 1047, 1047, 1047];
    melody.forEach((f, i) => playTone(f, 0.3, 'sine', 0.3, now + i * 0.15));
  }

  function playHint() {
    resume();
    const c = getCtx();
    const now = c.currentTime;
    [880, 1100, 880, 1100].forEach((f, i) => playTone(f, 0.15, 'triangle', 0.2, now + i * 0.1));
  }

  return { playButtonPress, playExpire, playCorrect, playWrong, playTick, playWin, playHint, resume };
})();

// ===== HEX GRID UTILITIES =====
function getHexPath(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') + 'Z';
}

function buildHexGrid(grid, container, hexSize, onCellClick, highlightSelected, myTeam, state) {
  container.innerHTML = '';
  const size = grid.length;
  const W = hexSize * 2;
  const H = Math.sqrt(3) * hexSize;
  const svgW = size * W * 0.75 + W * 0.25 + 20;
  const svgH = size * H + H * 0.5 + 20;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.style.display = 'block';
  svg.style.maxWidth = '100%';

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = grid[r][c];
      const cx = 10 + c * W * 0.75 + hexSize;
      const cy = 10 + r * H + (c % 2 === 1 ? H / 2 : 0) + hexSize * (Math.sqrt(3)/2);

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.style.cursor = onCellClick && !cell.owner ? 'pointer' : 'default';

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', getHexPath(cx, cy, hexSize - 2));

      let fill = '#f8fafc';
      let stroke = '#cbd5e1';
      let strokeW = '1.5';
      let glowFilter = '';

      if (cell.owner === 'green') {
        fill = '#bbf7d0';
        stroke = '#16a34a';
        strokeW = '3';
        glowFilter = 'drop-shadow(0 0 6px rgba(22,163,74,.6)) drop-shadow(0 0 12px rgba(22,163,74,.3))';
      } else if (cell.owner === 'orange') {
        fill = '#fed7aa';
        stroke = '#ea580c';
        strokeW = '3';
        glowFilter = 'drop-shadow(0 0 6px rgba(234,88,12,.6)) drop-shadow(0 0 12px rgba(234,88,12,.3))';
      }

      const isSelected = state && state.selectedCell && state.selectedCell.row === r && state.selectedCell.col === c;
      if (isSelected) {
        stroke = '#d97706';
        strokeW = '3.5';
        fill = '#fef3c7';
        glowFilter = 'drop-shadow(0 0 8px #facc15) drop-shadow(0 0 18px rgba(250,204,21,.5))';
      }

      path.setAttribute('fill', fill);
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', strokeW);
      if (glowFilter) path.style.filter = glowFilter;

      if (isSelected) {
        path.style.animation = 'hexPulse 1.5s ease-in-out infinite';
      }

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', cx);
      text.setAttribute('y', cy + 1);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-family', 'Tajawal, sans-serif');
      text.setAttribute('font-size', hexSize * 0.55);
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', cell.owner ? '#14532d' : '#1e293b');

      if (!cell.owner) {
        text.textContent = cell.letter;
      }

      g.appendChild(path);
      g.appendChild(text);

      if (onCellClick && !cell.owner) {
        g.addEventListener('click', () => onCellClick(r, c));
      }

      svg.appendChild(g);
    }
  }

  // Add CSS animation
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    @keyframes hexPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  `;
  svg.insertBefore(style, svg.firstChild);

  container.appendChild(svg);
}

// ===== LEADERBOARD =====
function buildLeaderboard(players, teamNames) {
  const medals = ['🥇', '🥈', '🥉'];
  const sorted = Object.entries(players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return sorted.map((p, i) => `
    <div class="lb-entry" style="color:${p.team === 'green' ? '#22c55e' : '#f97316'}">
      <span>${medals[i]}</span>
      <span>${p.name}</span>
      <span>${p.score}نقطة</span>
    </div>
  `).join('');
}