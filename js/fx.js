// ─────────────────────────────────────────────
//  DEVICE / TOUCH DETECTION
// ─────────────────────────────────────────────
let isTouchDevice = false;
window.addEventListener('touchstart', () => isTouchDevice = true, { once: true, passive: true });

// ─────────────────────────────────────────────
//  AMBIENT MOUSE GLOW (Desktop only)
// ─────────────────────────────────────────────
document.addEventListener('mousemove', e => {
  if (isTouchDevice) return;
  const glow = document.getElementById('ambient-glow');
  if (glow) glow.style.background = `radial-gradient(circle at ${e.clientX}px ${e.clientY}px, rgba(126,255,168,0.06) 0%, transparent 60%)`;
});

// ─────────────────────────────────────────────
//  PARTICLE SYSTEM
// ─────────────────────────────────────────────
const canvas = document.getElementById('particles-canvas');
const ctx = canvas.getContext('2d');
let particles = [], animFrame = null, resizeTimer = null;

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resizeCanvas();
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeCanvas, 250);
});

const PCOLORS = [[126,255,168],[189,252,212],[226,250,235],[242,202,107],[240,118,79],[124,205,240],[255,255,255]];

function spawnBurst(x, y, count = 40, isStar = false) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2, speed = isStar ? 2 + Math.random() * 12 : 4 + Math.random() * 10;
    const rgb = PCOLORS[Math.floor(Math.random() * PCOLORS.length)];
    particles.push({
      x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 5,
      alpha: 1, decay: 0.01 + Math.random() * 0.02, size: 4 + Math.random() * 8,
      r: rgb[0], g: rgb[1], b: rgb[2], shape: isStar ? 3 : Math.floor(Math.random() * 3),
      rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.4
    });
  }
  if (!animFrame) tickParticles();
}

function tickParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height); let active = false;
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.vx *= 0.94; p.vy *= 0.97;
    p.alpha -= p.decay; p.rot += p.rotV; p.size = Math.max(0, p.size - 0.05);
    if (p.alpha <= 0 || p.size <= 0) { particles.splice(i, 1); continue; }
    active = true;
    ctx.save(); ctx.globalAlpha = p.alpha; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    if (p.shape === 0) { ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI*2); ctx.fill(); }
    else if (p.shape === 1) { ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size); }
    else if (p.shape === 2) { ctx.fillRect(-p.size, -p.size/3, p.size*2, p.size/1.5); }
    else {
      ctx.beginPath();
      for (let j = 0; j < 5; j++) {
        ctx.lineTo(Math.cos((18+j*72)*Math.PI/180)*p.size, -Math.sin((18+j*72)*Math.PI/180)*p.size);
        ctx.lineTo(Math.cos((54+j*72)*Math.PI/180)*p.size/2, -Math.sin((54+j*72)*Math.PI/180)*p.size/2);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  if (active) animFrame = requestAnimationFrame(tickParticles); else animFrame = null;
}

function burstFromEl(el, count = 40, star = false) {
  const r = el.getBoundingClientRect();
  spawnBurst(r.left + r.width/2, r.top + r.height/2, count, star);
}

// ─────────────────────────────────────────────
//  HAPTICS
// ─────────────────────────────────────────────
function haptic(p) { if (navigator.vibrate) navigator.vibrate(p); }

// ─────────────────────────────────────────────
//  CELEBRATE (all-done animation)
// ─────────────────────────────────────────────
function celebrate() {
  const w = window.innerWidth, h = window.innerHeight;
  spawnBurst(w*0.2, h*0.8, 80, true); spawnBurst(w*0.8, h*0.8, 80, true);
  setTimeout(() => {
    spawnBurst(w*0.5, h*0.5, 120, true);
    haptic([40,50,40,50,100]);
    document.body.classList.add('screen-shake');
  }, 300);
  setTimeout(() => document.body.classList.remove('screen-shake'), 600);
  const flash = document.getElementById('flash-overlay');
  flash.classList.add('flash');
  setTimeout(() => flash.classList.remove('flash'), 100);
}

// ─────────────────────────────────────────────
//  TOAST NOTIFICATIONS
// ─────────────────────────────────────────────
let toastT;
function showToast(m) {
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3500);
}

// ─────────────────────────────────────────────
//  ANIMATED NUMBER COUNTER
// ─────────────────────────────────────────────
function animateValue(obj, start, end, duration, formatStr = '') {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const easeProg = 1 - Math.pow(1 - progress, 3);
    obj.innerHTML = Math.floor(easeProg * (end - start) + start) + formatStr;
    if (progress < 1) window.requestAnimationFrame(step);
    else obj.innerHTML = end + formatStr;
  };
  window.requestAnimationFrame(step);
}
let currentRingPct = 0, currentDurMins = 0;

// ─────────────────────────────────────────────
//  LONG-PRESS (TOUCH) + RIGHT-CLICK (DESKTOP) ROW ACTIONS
// ─────────────────────────────────────────────
let _longPressTimer = null;
let _activeRevealRow = null;

// Custom context menu
const _ctxMenu = (() => {
  const el = document.createElement('div');
  el.id = 'row-context-menu';
  el.innerHTML = `
    <button id="ctx-edit-btn">✏️ Edit</button>
    <button id="ctx-delete-btn" class="ctx-danger">✕ Delete</button>
  `;
  document.body.appendChild(el);
  return el;
})();

let _ctxEditFn = null, _ctxDeleteFn = null;

_ctxMenu.querySelector('#ctx-edit-btn').addEventListener('click', () => {
  hideContextMenu(); if (_ctxEditFn) _ctxEditFn();
});
_ctxMenu.querySelector('#ctx-delete-btn').addEventListener('click', () => {
  hideContextMenu(); if (_ctxDeleteFn) _ctxDeleteFn();
});

function showContextMenu(x, y, editFn, deleteFn) {
  _ctxEditFn = editFn; _ctxDeleteFn = deleteFn;
  _ctxMenu.style.visibility = 'hidden'; _ctxMenu.style.display = 'flex';
  const mw = _ctxMenu.offsetWidth, mh = _ctxMenu.offsetHeight;
  _ctxMenu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  _ctxMenu.style.top  = Math.min(y, window.innerHeight - mh - 8) + 'px';
  _ctxMenu.style.visibility = ''; _ctxMenu.classList.add('open');
}

function hideContextMenu() {
  _ctxMenu.classList.remove('open');
  setTimeout(() => { if (!_ctxMenu.classList.contains('open')) _ctxMenu.style.display = 'none'; }, 180);
}

document.addEventListener('mousedown', e => { if (!_ctxMenu.contains(e.target)) hideContextMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });

function attachRowActions(row, editFn, deleteFn) {
  // Desktop: right-click context menu
  row.addEventListener('contextmenu', e => {
    if (e.target.closest('.todo-item-check')) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, editFn, deleteFn);
  });

  // Touch: long-press to reveal inline buttons
  let startX, startY, moved = false;

  function startPress(x, y) {
    startX = x; startY = y; moved = false;
    _longPressTimer = setTimeout(() => {
      if (moved) return;
      if (_activeRevealRow && _activeRevealRow !== row) {
        _activeRevealRow.classList.remove('actions-revealed');
      }
      row.classList.toggle('actions-revealed');
      _activeRevealRow = row.classList.contains('actions-revealed') ? row : null;
      haptic([30, 20, 30]);
    }, 500);
  }

  function cancelPress(x, y) {
    if (x !== undefined && y !== undefined) {
      if (Math.abs(x - startX) > 8 || Math.abs(y - startY) > 8) moved = true;
    }
    clearTimeout(_longPressTimer);
  }

  row.addEventListener('touchstart', e => {
    if (e.target.closest('.todo-item-check') || e.target.closest('button')) return;
    const t = e.touches[0]; startPress(t.clientX, t.clientY);
  }, { passive: true });
  row.addEventListener('touchmove', e => { const t = e.touches[0]; cancelPress(t.clientX, t.clientY); }, { passive: true });
  row.addEventListener('touchend', () => cancelPress());
  row.addEventListener('touchcancel', () => cancelPress());
}

// Dismiss revealed row when tapping elsewhere on touch
document.addEventListener('touchstart', e => {
  if (_activeRevealRow && !_activeRevealRow.contains(e.target)) {
    _activeRevealRow.classList.remove('actions-revealed');
    _activeRevealRow = null;
  }
}, { passive: true });

// ─────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDue(dStr) {
  const d = new Date(dStr+'T00:00:00'), t = new Date(); t.setHours(0,0,0,0);
  const diff = Math.round((d-t)/86400000);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}