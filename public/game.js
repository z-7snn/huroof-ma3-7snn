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
    playTone(440, 0.1, 'square', 0.2, now);
    playTone(660, 0.1, 'square', 0.2, now + 0.1);
    playTone(880, 2.8, 'sine', 0.15, now + 0.2);
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
    playTone(800, 0.05, 'square', 0.15);
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

  // Wrapper div with colored borders: green=left/right, orange=top/bottom
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    display:inline-block;position:relative;
    border-top:6px solid #ea580c;
    border-bottom:6px solid #ea580c;
    border-left:6px solid #16a34a;
    border-right:6px solid #16a34a;
    border-radius:12px;
    box-shadow:
      0 0 0 2px #fff,
      -8px 0 16px rgba(22,163,74,.25),
      8px 0 16px rgba(22,163,74,.25),
      0 -8px 16px rgba(234,88,12,.25),
      0 8px 16px rgba(234,88,12,.25);
    overflow:hidden;
  `;

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

      if (cell.owner === 'green') { fill = '#bbf7d0'; stroke = '#16a34a'; strokeW = '2'; }
      else if (cell.owner === 'orange') { fill = '#fed7aa'; stroke = '#ea580c'; strokeW = '2'; }

      const isSelected = state && state.selectedCell && state.selectedCell.row === r && state.selectedCell.col === c;
      if (isSelected) { stroke = '#d97706'; strokeW = '3'; fill = '#fef3c7'; }

      path.setAttribute('fill', fill);
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', strokeW);

      if (isSelected) {
        path.style.filter = 'drop-shadow(0 0 8px #facc15)';
        // Pulsing animation
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

  wrapper.appendChild(svg);

  // تسميات الاتجاهات
  const orangeT = document.createElement('div');
  orangeT.style.cssText = 'font-size:.65rem;font-weight:900;color:#ea580c;text-align:center;margin-bottom:3px;letter-spacing:1px;';
  orangeT.textContent = '↑ برتقالي ↑';
  const orangeB = document.createElement('div');
  orangeB.style.cssText = 'font-size:.65rem;font-weight:900;color:#ea580c;text-align:center;margin-top:3px;letter-spacing:1px;';
  orangeB.textContent = '↓ برتقالي ↓';

  const greenR = document.createElement('div');
  greenR.style.cssText = 'position:absolute;top:50%;left:-36px;transform:translateY(-50%) rotate(90deg);font-size:.6rem;font-weight:900;color:#16a34a;white-space:nowrap;';
  greenR.textContent = '← أخضر →';
  const greenL = document.createElement('div');
  greenL.style.cssText = 'position:absolute;top:50%;right:-36px;transform:translateY(-50%) rotate(-90deg);font-size:.6rem;font-weight:900;color:#16a34a;white-space:nowrap;';
  greenL.textContent = '← أخضر →';

  const midRow = document.createElement('div');
  midRow.style.cssText = 'position:relative;display:inline-block;';
  midRow.appendChild(greenR);
  midRow.appendChild(greenL);
  midRow.appendChild(wrapper);

  const outerWrap = document.createElement('div');
  outerWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  outerWrap.appendChild(orangeT);
  outerWrap.appendChild(midRow);
  outerWrap.appendChild(orangeB);

  container.innerHTML = '';
  container.appendChild(outerWrap);
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