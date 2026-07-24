'use strict';
/* OcuLauncher FX — l'app che "vive": intro assemblata, suoni, particelle,
   micro-interazioni. Completamente autonomo e difensivo: qualsiasi errore
   qui dentro non deve MAI impedire al launcher di funzionare. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Suoni (Web Audio, zero file) ---------------- */
  let actx = null;
  const store = { get(){ try { return localStorage.getItem('fxMuted'); } catch (_) { return null; } },
                  set(v){ try { localStorage.setItem('fxMuted', v); } catch (_) {} } };
  const muted = () => store.get() === '1';
  function ctx() {
    if (!actx) { try { actx = new AudioContext(); } catch (_) {} }
    return actx;
  }
  function tone({ f0 = 440, f1 = null, t = 0.12, type = 'sine', vol = 0.16, when = 0 }) {
    const c = ctx(); if (!c || muted() || reduced) return;
    try {
      const o = c.createOscillator(), g = c.createGain();
      const t0 = c.currentTime + when;
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + t);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
      o.connect(g).connect(c.destination);
      o.start(t0); o.stop(t0 + t + 0.05);
    } catch (_) {}
  }
  function noise({ t = 0.5, vol = 0.06, from = 300, to = 2400, when = 0 }) {
    const c = ctx(); if (!c || muted() || reduced) return;
    try {
      const len = Math.floor(c.sampleRate * t);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource(); s.buffer = buf;
      const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 0.8;
      const t0 = c.currentTime + when;
      fl.frequency.setValueAtTime(from, t0);
      fl.frequency.exponentialRampToValueAtTime(to, t0 + t);
      const g = c.createGain(); g.gain.value = vol;
      s.connect(fl).connect(g).connect(c.destination);
      s.start(t0);
    } catch (_) {}
  }
  const sfx = {
    pop:    (i) => tone({ f0: 300 + i * 40, f1: 600 + i * 60, t: 0.09, type: 'triangle', vol: 0.10 }),
    whoosh: () => noise({ t: 0.8, vol: 0.05, from: 200, to: 2800 }),
    chime:  () => { tone({ f0: 523, t: 0.35, vol: 0.10 }); tone({ f0: 784, t: 0.45, vol: 0.09, when: 0.09 }); tone({ f0: 1047, t: 0.6, vol: 0.08, when: 0.18 }); },
    click:  () => tone({ f0: 700, f1: 500, t: 0.05, type: 'triangle', vol: 0.07 }),
    on:     () => tone({ f0: 440, f1: 660, t: 0.10, type: 'triangle', vol: 0.09 }),
    off:    () => tone({ f0: 500, f1: 330, t: 0.10, type: 'triangle', vol: 0.08 }),
    launch: () => { noise({ t: 1.0, vol: 0.07, from: 150, to: 3200 }); tone({ f0: 220, f1: 880, t: 0.7, type: 'sawtooth', vol: 0.05 }); sfx.chime(); },
  };

  /* ---------------- Intro: i pezzi assemblano il logo ---------------- */
  function intro() {
    if (reduced) { document.body.classList.add('fx-enter'); return; }
    const ov = document.createElement('div');
    ov.id = 'fx-intro';
    const grid = document.createElement('div'); grid.id = 'fx-grid';
    // La "O" di Oculandia: cornice 4x4 senza il centro (12 voxel).
    const cells = [[0,0],[1,0],[2,0],[3,0],[0,1],[3,1],[0,2],[3,2],[0,3],[1,3],[2,3],[3,3]];
    cells.forEach(([gx, gy], i) => {
      const v = document.createElement('div');
      v.className = 'fx-voxel';
      const ang = Math.random() * Math.PI * 2, dist = 420 + Math.random() * 380;
      v.style.setProperty('--gx', gx); v.style.setProperty('--gy', gy);
      v.style.setProperty('--sx', Math.cos(ang) * dist + 'px');
      v.style.setProperty('--sy', Math.sin(ang) * dist + 'px');
      v.style.setProperty('--sr', (Math.random() * 540 - 270) + 'deg');
      v.style.setProperty('--d', (i * 0.055) + 's');
      grid.appendChild(v);
    });
    const ring = document.createElement('div'); ring.id = 'fx-ring'; grid.appendChild(ring);
    const title = document.createElement('div'); title.id = 'fx-title';
    'OCULANDIA'.split('').forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'fx-ch'; s.textContent = ch;
      s.style.setProperty('--d', (0.75 + i * 0.05) + 's');
      title.appendChild(s);
    });
    const sub = document.createElement('div'); sub.id = 'fx-sub'; sub.textContent = 'launcher ufficiale · VR';
    ov.append(grid, title, sub);
    document.body.appendChild(ov);

    let ended = false;
    const end = () => {
      if (ended) return; ended = true;
      ov.classList.add('fx-out');
      document.body.classList.add('fx-enter');
      document.querySelectorAll('.card, #topbar, #playbar').forEach((el, i) => {
        el.style.setProperty('--fxd', (i * 0.06) + 's');
      });
      setTimeout(() => ov.remove(), 500);
    };
    ov.addEventListener('click', end);
    requestAnimationFrame(() => {
      ov.classList.add('fx-go');
      sfx.whoosh();
      cells.forEach((_, i) => { if (i % 2 === 0) setTimeout(() => sfx.pop(i), i * 55); });
      setTimeout(() => sfx.chime(), 1550);
      setTimeout(end, 2350);
    });
  }

  /* ---------------- Particelle ambientali ---------------- */
  function ambient() {
    if (reduced) return;
    const cv = document.createElement('canvas'); cv.id = 'fx-bg';
    document.body.prepend(cv);
    const g = cv.getContext('2d'); if (!g) return;
    let W = 0, H = 0, ps = [];
    const resize = () => {
      W = cv.width = innerWidth; H = cv.height = innerHeight;
      const n = Math.min(46, Math.floor(W * H / 26000));
      ps = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.6 + Math.random() * 1.8, s: 0.12 + Math.random() * 0.35,
        w: Math.random() * Math.PI * 2, c: Math.random() < 0.5 ? '53,240,110' : '34,211,238',
        a: 0.05 + Math.random() * 0.16,
      }));
    };
    resize(); addEventListener('resize', resize);
    let run = true;
    document.addEventListener('visibilitychange', () => { run = !document.hidden; if (run) loop(); });
    function loop() {
      if (!run) return;
      g.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.y -= p.s; p.w += 0.01; p.x += Math.sin(p.w) * 0.18;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7);
        g.fillStyle = 'rgba(' + p.c + ',' + p.a + ')'; g.fill();
      }
      requestAnimationFrame(loop);
    }
    loop();
  }

  /* ---------------- Micro-interazioni + suoni UI ---------------- */
  function wire() {
    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('button, a');
      if (!el) return;
      if (el.id === 'btn-play') {
        sfx.launch();
        const b = document.createElement('span');
        b.className = 'fx-burst';
        el.style.position = 'relative'; el.appendChild(b);
        setTimeout(() => b.remove(), 550);
      } else sfx.click();
    }, true);
    document.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t && t.type === 'checkbox') (t.checked ? sfx.on : sfx.off)();
    }, true);
    const status = document.getElementById('status-line');
    if (status) new MutationObserver(() => {
      status.classList.remove('fx-flash'); void status.offsetWidth;
      status.classList.add('fx-flash');
    }).observe(status, { childList: true, characterData: true, subtree: true });
    const foot = document.querySelector('.sidebar-footer');
    if (foot) {
      const b = document.createElement('button');
      b.id = 'fx-mute'; b.title = 'Suoni del launcher';
      b.textContent = muted() ? '🔇' : '🔊';
      b.addEventListener('click', () => {
        store.set(muted() ? '0' : '1');
        b.textContent = muted() ? '🔇' : '🔊';
        if (!muted()) sfx.on();
      });
      foot.appendChild(b);
    }
  }

  try { intro(); ambient(); wire(); } catch (e) { console.warn('FX disattivati:', e); }
})();
