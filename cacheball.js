/* cacheball.js - roll your agent's context up any web page.
   Paste into the console, load as a bookmarklet, or include with <script>.
   Esc quits and puts every word back. Arrows / WASD / mouse to roll. M mutes. */
(() => {
  if (window.__cacheball) { window.__cacheball.stop(); return; }
  const OPT = Object.assign({ manual: false, start: null }, window.CACHEBALL_OPTS || {});
  const doc = document, root = doc.documentElement;
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------- overlay
  const cv = doc.createElement('canvas');
  cv.setAttribute('data-cacheball', '');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646';
  doc.body.appendChild(cv);
  const g = cv.getContext('2d');
  let VW = 0, VH = 0;
  function resize() { VW = innerWidth; VH = innerHeight; cv.width = VW * DPR; cv.height = VH * DPR; }
  addEventListener('resize', resize); resize();

  // ---------------- collect items from the real page
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'IFRAME', 'TEMPLATE', 'HEAD', 'TITLE']);
  const items = [];
  const styleCache = new Map();
  function styleOf(el) {
    let s = styleCache.get(el);
    if (!s) {
      const c = getComputedStyle(el);
      let bg = c.backgroundColor; if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = null;
      s = { font: `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`, color: c.color, bg, hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity === 0 };
      styleCache.set(el, s);
    }
    return s;
  }
  function wrapWords() {
    const tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement; if (!p || p.closest('[data-cacheball]')) return NodeFilter.FILTER_REJECT;
        for (let e = p; e && e !== doc.body; e = e.parentElement) if (SKIP.has(e.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = []; while (tw.nextNode() && nodes.length < 6000) nodes.push(tw.currentNode);
    let count = 0;
    for (const n of nodes) {
      if (count > 6000) break;
      const parts = n.nodeValue.split(/(\s+)/); if (parts.length === 1 && parts[0].length > 40) continue;
      const frag = doc.createDocumentFragment();
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { frag.appendChild(doc.createTextNode(p)); continue; }
        const sp = doc.createElement('span'); sp.className = 'cb-w'; sp.textContent = p; frag.appendChild(sp); count++;
      }
      n.parentNode.replaceChild(frag, n);
    }
  }
  function measure() {
    items.length = 0;
    const sx = scrollX, sy = scrollY;
    doc.querySelectorAll('span.cb-w').forEach(el => {
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
      const s = styleOf(el.parentElement); if (s.hidden) return;
      items.push({ el, kind: 'word', text: el.textContent, x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, s, done: false });
    });
    doc.querySelectorAll('img, video, picture > img').forEach(el => {
      if (el.closest('[data-cacheball]')) return;
      const r = el.getBoundingClientRect(); if (r.width < 6 || r.height < 6) return;
      items.push({ el, kind: 'img', text: el.alt || '', x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, s: null, done: false });
    });
    buildGrid();
  }
  // spatial grid
  const CELL = 160; let grid = new Map();
  function buildGrid() {
    grid = new Map();
    items.forEach((it, i) => {
      const x0 = Math.floor(it.x / CELL), x1 = Math.floor((it.x + it.w) / CELL), y0 = Math.floor(it.y / CELL), y1 = Math.floor((it.y + it.h) / CELL);
      for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) { const k = a + ',' + b; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i); }
    });
  }
  function near(x, y, r) {
    const out = new Set(); const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) { const l = grid.get(a + ',' + b); if (l) for (const i of l) out.add(i); }
    return out;
  }
  wrapWords(); measure();
  addEventListener('load', () => { measure(); setGoals(); });

  // ---------------- sprites
  function sprite(it) {
    const pad = it.s && it.s.bg ? 3 : 1;
    const w = Math.ceil(it.w + pad * 2), h = Math.ceil(it.h + pad * 2);
    const c = doc.createElement('canvas'); c.width = w * DPR; c.height = h * DPR; const x = c.getContext('2d'); x.scale(DPR, DPR);
    if (it.kind === 'img') { try { x.drawImage(it.el, pad, pad, it.w, it.h); } catch (e) { x.fillStyle = '#5fe3f0'; x.fillRect(0, 0, w, h); } }
    else {
      if (it.s.bg) { x.fillStyle = it.s.bg; x.beginPath(); x.roundRect ? x.roundRect(0, 0, w, h, 3) : x.rect(0, 0, w, h); x.fill(); }
      x.font = it.s.font; x.fillStyle = it.s.color; x.textBaseline = 'middle'; x.fillText(it.text, pad, h / 2 + 1);
    }
    return { c, w, h };
  }

  // ---------------- audio (pentatonic plinks, rolling hiss)
  let AC = null, master = null, rollG = null, muted = false;
  function audioOn() {
    if (AC || OPT.manual) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = .5; master.connect(AC.destination);
      const n = AC.createBufferSource(); const b = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      n.buffer = b; n.loop = true; const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; rollG = AC.createGain(); rollG.gain.value = 0; n.connect(f); f.connect(rollG); rollG.connect(master); n.start();
    } catch (e) { AC = null; }
  }
  const SCALE = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  function plink(m, vol = .18, dur = .35) {
    if (!AC || muted) return; const t = AC.currentTime;
    [[1, 'sine', 1], [2.01, 'triangle', .35], [3.98, 'sine', .12]].forEach(([k, type, a]) => {
      const o = AC.createOscillator(), e = AC.createGain(); o.type = type; o.frequency.value = mf(m) * k;
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(vol * a, t + .004); e.gain.exponentialRampToValueAtTime(.0001, t + dur / k ** .3);
      o.connect(e); e.connect(master); o.start(t); o.stop(t + dur + .05);
    });
  }
  const events = [];
  function sfx(type, m) {
    events.push({ t: S.t, type, m });
    if (type === 'pick') plink(m); else if (type === 'big') { plink(m - 12, .22, .7); plink(m - 5, .14, .6); }
    else if (type === 'lvl') { [0, 4, 7, 12].forEach((k, i) => setTimeout(() => plink(84 + k, .16, .5), i * 70)); }
    else if (type === 'mission') { [0, 7, 12, 16, 19].forEach((k, i) => setTimeout(() => plink(76 + k, .17, .6), i * 60)); }
    else if (type === 'vac') plink(m, .1, .2);
    else if (type === 'end') { [48, 55, 60, 64, 67, 72].forEach((k, i) => setTimeout(() => plink(k + 12, .2, 1.6), i * 90)); }
    else if (type === 'cold') plink(60, .12, 1.2); else if (type === 'bump') plink(m, .08, .25);
  }

  // ---------------- state
  const start = OPT.start || { x: scrollX + VW * .25, y: scrollY + VH * .45 };
  const fresh = p => ({ x: p.x, y: p.y, vx: 0, vy: 0, r: 22, t: 0, chars: 0, count: 0, combo: 0, maxCombo: 0, lastPick: -9, lastMove: 0, cold: false, pops: [], stuck: [], M: [1, 0, 0, 0, 1, 0, 0, 0, 1], lvl: 0, walk: 0, face: 1, misses: 0, missCost: 0,
    lucky: 0, bigs: 0, warmFrom: 0, mi: 0, doneM: [], mFlash: -9, tStart: null, tEnd: null, phase: 'play', ph0: 0, fly: [], cleared: false, startRatio: 0, lastVac: -9, vacN: 0 });
  const S = fresh(start);
  const ctxTok = () => 8000 + S.chars * 110;
  const total = () => items.length || 1;
  const pct = () => S.count / total() * 100;

  // ---------------- missions (tracked all at once, shown first-open-first)
  const nice = v => v < 200000 ? Math.max(30, Math.round(v / 10000) * 10) : Math.round(v / 50000) * 50;
  let G1 = 150, G2 = 400;
  function setGoals() { let c = 0; items.forEach(it => { c += it.kind === 'img' ? 40 : it.text.length; }); const P = 8000 + c * 110; G1 = nice(P * .35); G2 = Math.max(G1 + 20, nice(P * .8)); }
  const MISSIONS = [
    { txt: 'Roll up 25 words', goal: () => 25, val: () => S.count, fmt: v => `${Math.min(25, Math.floor(v))}/25` },
    { txt: 'Catch a lucky word', sub: 'opus · sonnet · cache · turn · handoff', goal: () => 1, val: () => S.lucky, fmt: v => `${Math.min(1, v)}/1` },
    { txt: 'Hit a x10 combo', sub: 'keep picking words without a pause', goal: () => 10, val: () => S.maxCombo, fmt: v => `x${Math.min(10, v)}` },
    { get txt() { return `Grow the cache to ${G1}K`; }, goal: () => G1, val: () => ctxTok() / 1000, fmt: v => `${Math.floor(v)}K` },
    { txt: 'Swallow a heading or image', sub: 'big things need a big ball', goal: () => 1, val: () => S.bigs, fmt: v => `${Math.min(1, v)}/1` },
    { txt: 'Keep the cache warm 20s', sub: 'stop for 5s and it resets', goal: () => 20, val: () => S.tStart === null ? 0 : S.t - S.warmFrom, fmt: v => `${Math.min(20, Math.floor(v))}s` },
    { get txt() { return `Grow the cache to ${G2}K`; }, goal: () => G2, val: () => ctxTok() / 1000, fmt: v => `${Math.floor(v)}K` },
    { txt: 'Clear the page', sub: 'Enter hands off early', goal: () => 97, val: () => pct(), fmt: v => `${Math.floor(v)}%` },
  ];
  function checkMission() {
    MISSIONS.forEach((m, i) => {
      if (S.doneM[i] || m.val() < m.goal()) return;
      S.doneM[i] = true; S.mi++; S.mFlash = S.t; sfx('mission');
      pop(`✓ ${m.txt}`, '#7ee29a', true);
    });
  }
  setGoals();

  const turn = (m, c) => (c * .2 + 5500 * (m ? 5 : 2.5) + 1500 * (m ? 20 : 10)) / 1e6;
  function pop(text, col, big) { const n = S.pops.filter(p => S.t - p.t < .6).length; S.pops.push({ text, col, big, t: S.t, x: S.x, y: S.y - S.r - 16 - n * 26 }); if (S.pops.length > 6) S.pops.shift(); }

  // rotation helpers
  function rotM(M, ax, ay, ang) { // axis in xy plane (z=0)
    const c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
    const R = [c + ax * ax * C, ax * ay * C, ay * s, ay * ax * C, c + ay * ay * C, -ax * s, -ay * s, ax * s, c];
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = R[i * 3] * M[j] + R[i * 3 + 1] * M[3 + j] + R[i * 3 + 2] * M[6 + j];
    return o;
  }
  const mul = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  const mulT = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];

  // ---------------- input
  const keys = {}; let ptr = null; let autopilot = null;
  const onKey = e => {
    if (e.key === 'Escape') { stop(); return; }
    if (e.key === 'm' || e.key === 'M') muted = !muted;
    if (e.type === 'keydown') {
      const k = e.key.toLowerCase();
      if (S.phase === 'play' && k === 'enter' && S.tStart !== null) { e.preventDefault(); startHandoff(); return; }
      if (S.phase === 'end' && k === 'r') { e.preventDefault(); restart(); return; }
      if (S.phase === 'end' && k === 'c') { e.preventDefault(); copyResult(); return; }
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = e.type === 'keydown'; audioOn();
  };
  const onMove = e => { ptr = [e.clientX, e.clientY]; };
  const onDown = e => { ptr = [e.clientX, e.clientY]; audioOn(); };
  addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true);
  addEventListener('pointermove', onMove, true); addEventListener('pointerdown', onDown, true);

  // ---------------- simulation
  function step(dt) {
    S.t += dt;
    if (S.phase !== 'play') { endStep(dt); return; }
    let ax = 0, ay = 0;
    if (autopilot) [ax, ay] = autopilot(S, items);
    else {
      if (keys.arrowleft || keys.a) ax -= 1; if (keys.arrowright || keys.d) ax += 1; if (keys.arrowup || keys.w) ay -= 1; if (keys.arrowdown || keys.s) ay += 1;
      if (!ax && !ay && ptr) { const tx = ptr[0] + scrollX, ty = ptr[1] + scrollY; const dx = tx - S.x, dy = ty - S.y, d = Math.hypot(dx, dy); if (d > S.r * .6) { const k = Math.min(1, d / 220); ax = dx / d * k; ay = dy / d * k; } }
    }
    const acc = 900 + S.r * 9; S.vx += ax * acc * dt; S.vy += ay * acc * dt; const fr = Math.pow(.08, dt); S.vx *= fr; S.vy *= fr;
    const sp = Math.hypot(S.vx, S.vy);
    if (sp > 30) { S.lastMove = S.t; if (S.tStart === null) { S.tStart = S.t; S.warmFrom = S.t; } }
    const maxX = Math.max(root.scrollWidth, VW), maxY = Math.max(root.scrollHeight, VH);
    S.x = clamp(S.x + S.vx * dt, S.r, maxX - S.r); S.y = clamp(S.y + S.vy * dt, S.r, maxY - S.r);
    if (sp > 1) { S.M = rotM(S.M, -S.vy / sp, S.vx / sp, sp * dt / S.r); S.face = S.vx >= 0 ? 1 : -1; S.walk += sp * dt * .06; S.dir = [S.vx / sp, S.vy / sp]; }
    if (rollG) rollG.gain.value = muted ? 0 : Math.min(.05, sp / 9000);
    // cache cold
    if (S.tStart !== null && !S.cold && S.t - S.lastMove > (OPT.coldAfter || 5)) { S.cold = true; S.warmFrom = S.t; pop('cache went cold', '#9ad7ff', true); sfx('cold'); }
    // pickups / collisions
    const R = S.r;
    for (const i of near(S.x, S.y, R + 80)) {
      const it = items[i]; if (it.done) continue;
      const cx = clamp(S.x, it.x, it.x + it.w), cy = clamp(S.y, it.y, it.y + it.h); const dx = S.x - cx, dy = S.y - cy, d = Math.hypot(dx, dy);
      if (d > R * .92) continue;
      const big = Math.max(it.w * .35, it.h * .9);
      if (big < R * 1.05) take(it);
      else if (S.t - (it.bump || -9) > 1.2 && d < R * .5) { it.bump = S.t; S.vx *= .85; S.vy *= .85; sfx('bump', 55); }
    }
    // level ups
    const lv = Math.floor(Math.log2(ctxTok() / 8000) * 2);
    if (lv > S.lvl) { S.lvl = lv; pop(`${Math.round(ctxTok() / 1000)}K · opus / sonnet ${(turn(1, ctxTok()) / turn(0, ctxTok())).toFixed(2)}x`, '#7ee29a', true); sfx('lvl'); }
    S.pops = S.pops.filter(p => S.t - p.t < 1.4);
    checkMission();
    if (S.tStart !== null && pct() >= 97) { S.cleared = true; startVacuum(); }
    follow(dt);
  }
  function follow(dt) {
    if (!OPT.noScroll) {
      const tx = clamp(S.x - VW * .5, 0, Math.max(0, root.scrollWidth - VW)), ty = clamp(S.y - VH * .5, 0, Math.max(0, root.scrollHeight - VH));
      const k = Math.min(1, dt * 3.2); const nx = scrollX + (tx - scrollX) * k, ny = scrollY + (ty - scrollY) * k;
      if (Math.abs(nx - scrollX) > .5 || Math.abs(ny - scrollY) > .5) scrollTo(nx, ny);
    }
  }
  function take(it) {
    it.done = true; it.el.style.visibility = 'hidden';
    const sp = sprite(it);
    // contact direction on the sphere, tilted toward the viewer
    let dx = (it.x + it.w / 2) - S.x, dy = (it.y + it.h / 2) - S.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const z = .35 + Math.random() * .4; const n = Math.hypot(dx, dy, z); const pw = [dx / n, dy / n, z / n];
    S.stuck.push({ sp, p: mulT(S.M, pw), tw: (Math.random() - .5) * 1.6, out: Math.min(it.w, it.h * 3) * .18 });
    if (S.stuck.length > 420) S.stuck.splice(0, S.stuck.length - 420);
    const area = it.w * it.h; S.r = Math.sqrt(S.r * S.r + area * .11); S.chars += it.kind === 'img' ? 40 : it.text.length; S.count++;
    let miss = 0; if (S.cold) { S.cold = false; S.misses++; miss = ctxTok() * 2.5 / 1e6; S.missCost += miss; pop(`cache miss · -$${miss.toFixed(2)}`, '#9ad7ff', true); }
    S.combo = S.t - S.lastPick < .55 ? S.combo + 1 : 0; S.lastPick = S.t; S.maxCombo = Math.max(S.maxCombo, S.combo);
    const note = SCALE[Math.min(SCALE.length - 1, S.combo % SCALE.length)];
    if (area > 2600) { S.bigs++; sfx('big', note); pop(it.kind === 'img' ? 'image!' : it.text, '#ffcf4a', false); } else sfx('pick', note);
    if (/opus|sonnet|cache|handoff|turns?/i.test(it.text)) S.lucky++, pop(`${it.text.replace(/[^\w$.]/g, '')} · LUCKY`, '#c8a6ff', false);
    if (S.combo === 10) pop('FLOW x10', '#ffcf4a', true);
  }

  // ---------------- ending: vacuum the last words, hand off, show the result
  const VAC = 1.4, HAND = 1.9;
  const ease = u => { u = clamp(u, 0, 1); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
  function startVacuum() {
    S.phase = 'vacuum'; S.ph0 = S.t; S.vx = S.vy = 0; if (rollG) rollG.gain.value = 0;
    const left = items.filter(it => !it.done);
    left.sort((a, b) => Math.hypot(a.x - S.x, a.y - S.y) - Math.hypot(b.x - S.x, b.y - S.y));
    left.forEach((it, i) => {
      it.done = true; it.el.style.visibility = 'hidden';
      S.fly.push({ it, sp: sprite(it), x0: it.x + it.w / 2, y0: it.y + it.h / 2, d: i / Math.max(1, left.length) * .7, dur: .55 + Math.random() * .2, in: false });
    });
  }
  function startHandoff() {
    if (S.phase === 'play') { S.vx = S.vy = 0; if (rollG) rollG.gain.value = 0; }
    S.phase = 'handoff'; S.ph0 = S.t; S.tEnd = S.t; sfx('end');
    pop(`${Math.round(ctxTok() / 1000)}K → handoff.md`, '#5fe3f0', true);
  }
  function endStep(dt) {
    S.pops = S.pops.filter(p => S.t - p.t < 1.4);
    const u = S.t - S.ph0;
    S.walk += dt * 3; if (S.phase !== 'end') follow(dt);
    if (S.phase === 'vacuum') {
      for (const f of S.fly) {
        if (f.in || u < f.d + f.dur) continue;
        f.in = true; const it = f.it;
        S.stuck.push({ sp: f.sp, p: mulT(S.M, (() => { const a = Math.random() * 6.28, z = .3 + Math.random() * .5; const n = Math.hypot(Math.cos(a), Math.sin(a), z); return [Math.cos(a) / n, Math.sin(a) / n, z / n]; })()), tw: (Math.random() - .5) * 1.6, out: Math.min(it.w, it.h * 3) * .18 });
        if (S.stuck.length > 420) S.stuck.splice(0, S.stuck.length - 420);
        S.r = Math.sqrt(S.r * S.r + it.w * it.h * .11); S.chars += it.kind === 'img' ? 40 : it.text.length; S.count++;
        if (S.t - S.lastVac > .035) { S.lastVac = S.t; sfx('vac', SCALE[Math.min(SCALE.length - 1, S.vacN++ % SCALE.length)]); }
      }
      S.M = rotM(S.M, 0.6, 0.8, dt * 4);
      if (u > VAC && S.fly.every(f => f.in)) { S.fly = []; checkMission(); startHandoff(); }
    } else if (S.phase === 'handoff') {
      S.M = rotM(S.M, 0.6, 0.8, dt * (4 + u * 10));
      if (u > HAND) { S.phase = 'end'; S.ph0 = S.t; showCard(); }
    }
  }
  function fmtTime(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function result() {
    const c = ctxTok(), ratio = turn(1, c) / turn(0, c), t = (S.tEnd || S.t) - (S.tStart || 0);
    const done = Math.min(MISSIONS.length, S.mi);
    const rank = S.cleared && done === MISSIONS.length && S.misses === 0 ? 'S' : S.cleared && done >= 7 ? 'A' : done >= 5 ? 'B' : 'C';
    return { c, ratio, t, done, rank, words: S.count, total: total(), start: turn(1, 8000) / turn(0, 8000) };
  }
  function resultText() {
    const r = result();
    return `cacheball · rank ${r.rank} · ${r.words.toLocaleString('en-US')} words in ${fmtTime(r.t)} · ${(r.c / 1000).toFixed(0)}K in cache · opus/sonnet ${r.ratio.toFixed(2)}x · ${S.misses} cache miss${S.misses === 1 ? '' : 'es'} · ${location.href.split('#')[0]}`;
  }
  let card = null;
  function copyResult() {
    const t = resultText(); const b = card && card.querySelector('[data-k=copy]');
    const ok = () => { if (b) { b.textContent = 'copied'; setTimeout(() => { if (b) b.textContent = 'copy result  C'; }, 1400); } };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, () => {}); else ok();
  }
  function showCard() {
    const r = result();
    card = doc.createElement('div'); card.setAttribute('data-cacheball', '');
    card.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,8,12,.55);opacity:0;transition:opacity .35s;font:14px ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;color:#d8e0e8';
    const rc = { S: '#ffcf4a', A: '#7ee29a', B: '#5fe3f0', C: '#9aa6b2' }[r.rank];
    const row = (k, v, c = '#ffffff') => `<div style="display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)"><span style="color:#8a96a4">${k}</span><b style="color:${c};font-weight:700">${v}</b></div>`;
    const dots = MISSIONS.map((m, i) => `<span title="${m.txt}" style="width:14px;height:14px;border-radius:50%;display:inline-block;background:${S.doneM[i] ? '#7ee29a' : 'transparent'};border:2px solid ${S.doneM[i] ? '#7ee29a' : '#3a4654'}"></span>`).join('');
    const btn = (k, label, bg, fg, bd) => `<button data-k="${k}" type="button" style="font:700 14px ui-monospace,Menlo,monospace;background:${bg};color:${fg};border:1px solid ${bd};border-radius:22px;padding:11px 18px;cursor:pointer;white-space:nowrap">${label}</button>`;
    card.innerHTML = `<div style="width:min(420px,100%);background:#0b0f15;border:1px solid rgba(95,227,240,.35);border-radius:18px;padding:24px 24px 20px;box-shadow:0 20px 70px rgba(0,0,0,.6);transform:translateY(12px);transition:transform .45s cubic-bezier(.2,.9,.3,1.2)">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:72px;height:72px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 40px ui-monospace,Menlo,monospace;color:${rc};border:3px solid ${rc};box-shadow:0 0 24px ${rc}55">${r.rank}</div>
        <div><div style="font-weight:800;font-size:19px;color:#fff;letter-spacing:.02em">${S.cleared ? 'PAGE CLEARED' : 'HANDED OFF EARLY'}</div>
        <div style="color:#8a96a4;margin-top:4px;line-height:1.45">${(r.c / 1000).toFixed(0)}K rolled into one handoff.md</div></div></div>
      ${row('words cached', `${r.words.toLocaleString('en-US')} / ${r.total.toLocaleString('en-US')}`)}
      ${row('time', fmtTime(r.t))}
      ${row('context in cache', `${(r.c / 1000).toFixed(1)}K`)}
      ${row('cache misses', S.misses ? `${S.misses} · -$${S.missCost.toFixed(2)}` : '0', S.misses ? '#9ad7ff' : '#7ee29a')}
      ${row('opus / sonnet', `${r.start.toFixed(2)}x → ${r.ratio.toFixed(2)}x`, '#5fe3f0')}
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0 4px"><span style="color:#8a96a4">missions ${r.done}/${MISSIONS.length}</span><span style="display:flex;gap:6px">${dots}</span></div>
      <p style="margin:12px 0 18px;color:#aab4c0;line-height:1.5">At ${(r.c / 1000).toFixed(0)}K in cache, a turn on Opus 5.5 costs ${r.ratio.toFixed(2)}x a turn on Sonnet 5.5.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${btn('again', '▶ roll again  R', '#1f6fd0', '#fff', '#5fe3f0')}${btn('copy', 'copy result  C', 'transparent', '#d8e0e8', '#3a4654')}${btn('quit', 'exit  Esc', 'transparent', '#8a96a4', '#2a333e')}</div>
    </div>`;
    doc.body.appendChild(card);
    card.querySelector('[data-k=again]').onclick = restart;
    card.querySelector('[data-k=copy]').onclick = copyResult;
    card.querySelector('[data-k=quit]').onclick = stop;
    requestAnimationFrame(() => { card.style.opacity = '1'; card.firstElementChild.style.transform = 'none'; });
  }
  function restart() {
    if (card) { card.remove(); card = null; }
    items.forEach(it => { it.done = false; it.el.style.visibility = ''; it.bump = null; });
    scrollTo(0, 0); measure(); setGoals();
    const keep = S.t; Object.assign(S, fresh({ x: VW * .3, y: VH * .5 })); S.t = keep; S.lastMove = keep; S.lastPick = keep - 9; S.mFlash = -9;
    ptr = null;
  }

  // ---------------- draw
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function txt(s, x, y, c, sz, w = 700, al = 'left') { g.font = `${w} ${sz}px ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace`; g.fillStyle = c; g.textAlign = al; g.fillText(s, x, y); g.textAlign = 'left'; }
  function drawStuck(bx, by, front, R) {
    const list = [];
    for (const s of S.stuck) { const p = mul(S.M, s.p); if (front ? p[2] < -.05 : p[2] >= -.05) continue; list.push([p, s]); }
    list.sort((a, b) => a[0][2] - b[0][2]);
    for (const [p, s] of list) {
      const q = R / S.r; const rad = (R + s.out * q); const x = bx + p[0] * rad, y = by + p[1] * rad;
      const k = (front ? .55 + .45 * p[2] : .5) * q; g.globalAlpha = front ? .35 + .65 * Math.max(0, p[2] + .1) : .35;
      g.save(); g.translate(x, y); g.rotate(Math.atan2(p[1], p[0]) * .35 + s.tw); g.scale(k, k);
      g.drawImage(s.sp.c, -s.sp.w / 2, -s.sp.h / 2, s.sp.w, s.sp.h); g.restore();
    }
    g.globalAlpha = 1;
  }
  function drawBall(bx, by, R = S.r) {
    if (R < .5) return;
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(bx + R * .25, by + R * .95, R * .95, R * .28, 0, 0, 7); g.fill();
    drawStuck(bx, by, false, R);
    const gr = g.createRadialGradient(bx - R * .35, by - R * .4, R * .05, bx, by, R * 1.05);
    gr.addColorStop(0, S.cold ? '#e9f8ff' : '#ffffff'); gr.addColorStop(.18, S.cold ? '#9ad7ff' : '#5fe3f0'); gr.addColorStop(.6, S.cold ? '#4c7d9b' : '#1f6fd0'); gr.addColorStop(1, '#0a1730');
    g.fillStyle = gr; g.beginPath(); g.arc(bx, by, R, 0, 7); g.fill();
    // rotating grid lines
    g.lineWidth = Math.max(1, R * .03); g.strokeStyle = 'rgba(255,255,255,.35)';
    for (const plane of [0, 1, 2]) {
      g.beginPath(); let pen = false;
      for (let i = 0; i <= 40; i++) {
        const a = i / 40 * Math.PI * 2; const v = plane === 0 ? [Math.cos(a), Math.sin(a), 0] : plane === 1 ? [Math.cos(a), 0, Math.sin(a)] : [0, Math.cos(a), Math.sin(a)];
        const p = mul(S.M, v); if (p[2] < 0) { pen = false; continue; }
        const x = bx + p[0] * R, y = by + p[1] * R; pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true;
      }
      g.stroke();
    }
    drawStuck(bx, by, true, R);
  }
  function drawGuy(bx, by, R = S.r, hop = 0) {
    const d = S.dir || [1, 0]; const gx = bx - d[0] * (R + 20), gy = by - d[1] * (R + 20) + R * .45 - 4 - hop;
    const ph = hop ? 0 : Math.sin(S.walk * 6); const f = S.face;
    g.save(); g.translate(gx, gy); g.scale(f * 1.7, 1.7);
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-2, 6); g.lineTo(-2 - ph * 4, 15); g.moveTo(2, 6); g.lineTo(2 + ph * 4, 15); g.stroke(); // legs
    g.fillStyle = '#ffd23f'; rr(-6, -6, 12, 13, 4); g.fill(); g.strokeStyle = '#1b1b1b'; g.lineWidth = 1.4; g.stroke(); // body
    if (hop) { g.beginPath(); g.moveTo(4, -3); g.lineTo(9, -12); g.moveTo(-4, -3); g.lineTo(-9, -12); g.lineWidth = 2.4; g.stroke(); } // arms up
    else { g.beginPath(); g.moveTo(5, -1); g.lineTo(11, -4 + ph); g.lineWidth = 2.4; g.stroke(); } // arm pushing
    g.fillStyle = '#7ee29a'; g.beginPath(); g.arc(0, -11, 6.5, 0, 7); g.fill(); g.lineWidth = 1.4; g.stroke(); // head
    g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(2.6, -12, 1.2, 0, 7); g.fill();
    g.strokeStyle = '#ff5fa2'; g.lineWidth = 2; g.beginPath(); g.moveTo(-1, -17); g.lineTo(-3, -24); g.stroke(); g.fillStyle = '#ff5fa2'; g.beginPath(); g.arc(-3, -25, 2.2, 0, 7); g.fill(); // antenna
    g.restore();
  }
  function bar(x, y, w, h, u, col) { g.fillStyle = 'rgba(255,255,255,.08)'; rr(x, y, w, h, h / 2); g.fill(); if (u > 0) { g.fillStyle = col; rr(x, y, Math.max(h, w * clamp(u, 0, 1)), h, h / 2); g.fill(); } }
  function hud() {
    const c = ctxTok(), ratio = turn(1, c) / turn(0, c);
    g.fillStyle = 'rgba(8,10,14,.86)'; rr(14, 14, 260, 108, 14); g.fill(); g.strokeStyle = 'rgba(95,227,240,.35)'; g.lineWidth = 1; g.stroke();
    const gr = g.createRadialGradient(46, 50, 3, 52, 57, 26); gr.addColorStop(0, '#fff'); gr.addColorStop(.3, '#5fe3f0'); gr.addColorStop(1, '#0a1730'); g.fillStyle = gr; g.beginPath(); g.arc(52, 57, 25, 0, 7); g.fill();
    txt((c / 1000).toFixed(1) + 'K', 88, 54, '#ffffff', 26, 800); txt('context in cache', 89, 72, '#8a96a4', 11, 400);
    txt(`opus / sonnet ${ratio.toFixed(2)}x`, 89, 90, '#5fe3f0', 12, 700);
    const p = pct(); bar(28, 104, 168, 6, p / 100, '#7ee29a'); txt(`${Math.floor(p)}% page`, 204, 110, '#8a96a4', 11, 400);
    if (S.tStart !== null) txt(fmtTime((S.tEnd || S.t) - S.tStart), 260, 34, '#8a96a4', 11, 700, 'right');
    // mission panel
    const m = MISSIONS.find((_, i) => !S.doneM[i]), fl = clamp(1 - (S.t - S.mFlash) / .6, 0, 1);
    if (S.phase === 'play' || fl > 0) {
      const y = 132, h = m && m.sub ? 74 : 60;
      g.fillStyle = 'rgba(8,10,14,.86)'; rr(14, y, 260, h, 14); g.fill();
      g.strokeStyle = fl > 0 ? `rgba(126,226,154,${.35 + .65 * fl})` : 'rgba(255,207,74,.35)'; g.lineWidth = 1 + fl; g.stroke();
      if (m) {
        const v = m.val();
        txt(`MISSIONS ${S.mi}/${MISSIONS.length}`, 28, y + 20, '#ffcf4a', 11, 800); txt(m.fmt(v), 260, y + 20, '#8a96a4', 11, 700, 'right');
        txt(m.txt, 28, y + 39, '#ffffff', 13, 700);
        if (m.sub) txt(m.sub, 28, y + 55, '#8a96a4', 10.5, 400);
        bar(28, y + h - 13, 232, 4, v / m.goal(), '#ffcf4a');
      } else { txt('ALL MISSIONS DONE', 28, y + 24, '#7ee29a', 11, 800); txt('clear the rest of the page', 28, y + 42, '#ffffff', 13, 700); }
    }
    if (S.combo > 2 && S.t - S.lastPick < .7) txt(`combo x${S.combo}`, 290, 34, '#ffcf4a', 13, 800);
    txt(S.phase === 'play' && S.tStart !== null ? 'enter hands off · esc quits · m mutes' : 'esc quits · m mutes', VW - 14, VH - 14, 'rgba(140,150,160,.8)', 11, 400, 'right');
  }
  function draw() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, VW, VH);
    const bx = S.x - scrollX, by = S.y - scrollY;
    if (S.phase === 'play' || S.phase === 'vacuum') { drawBall(bx, by); drawGuy(bx, by); }
    if (S.phase === 'vacuum') {
      const u = S.t - S.ph0;
      for (const f of S.fly) {
        if (f.in) continue; const k = ease((u - f.d) / f.dur); const x = f.x0 + (S.x - f.x0) * k - scrollX, y = f.y0 + (S.y - f.y0) * k - scrollY - Math.sin(k * Math.PI) * 40;
        const sc = 1 - k * .55; g.save(); g.translate(x, y); g.rotate(k * 4 * (f.d > .35 ? 1 : -1)); g.scale(sc, sc); g.drawImage(f.sp.c, -f.sp.w / 2, -f.sp.h / 2, f.sp.w, f.sp.h); g.restore();
      }
    }
    if (S.phase === 'handoff' || S.phase === 'end') {
      const u = S.phase === 'end' ? HAND + (S.t - S.ph0) : S.t - S.ph0;
      const k = 1 - ease((u - .25) / 1.25), R = S.r * k;
      g.save(); g.translate(bx, by); const pulse = 1 + Math.sin(u * 14) * .03 * k; g.scale(pulse, pulse); g.translate(-bx, -by); drawBall(bx, by, R); g.restore();
      // shockwave when the ball collapses
      const w = (u - 1.35) / .8; if (w > 0 && w < 1) { g.strokeStyle = `rgba(95,227,240,${1 - w})`; g.lineWidth = 6 * (1 - w) + 1; g.beginPath(); g.arc(bx, by, 20 + w * Math.max(260, S.r * 1.4), 0, 7); g.stroke(); }
      // handoff.md chip
      const a = clamp((u - 1.3) / .3, 0, 1);
      if (a > 0) {
        g.globalAlpha = a; const cw = 168, ch = 34, cy = by - 17 - Math.sin(S.t * 3) * 3;
        g.fillStyle = '#0b0f15'; rr(bx - cw / 2, cy, cw, ch, 10); g.fill(); g.strokeStyle = '#5fe3f0'; g.lineWidth = 1.5; g.stroke();
        txt('handoff.md · 20K', bx, cy + 22, '#5fe3f0', 13, 800, 'center'); g.globalAlpha = 1;
      }
      drawGuy(bx, by, Math.max(R, 30), Math.abs(Math.sin(S.t * 7)) * 10 * (a > 0 ? 1 : 0));
    }
    for (const p of S.pops) { const k = (S.t - p.t) / 1.4; g.globalAlpha = 1 - k; const x = p.x - scrollX, y = p.y - scrollY - k * 46; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)'; g.font = `800 ${p.big ? 20 : 15}px ui-monospace,Menlo,monospace`; g.textAlign = 'center'; g.strokeText(p.text, x, y); txt(p.text, x, y, p.col, p.big ? 20 : 15, 800, 'center'); g.globalAlpha = 1; }
    hud();
  }

  // ---------------- loop + teardown
  let raf = 0, last = performance.now(), alive = true;
  function loop(n) { if (!alive) return; const dt = Math.min(.033, (n - last) / 1000); last = n; step(dt); draw(); raf = requestAnimationFrame(loop); }
  if (!OPT.manual) raf = requestAnimationFrame(loop);
  function stop() {
    alive = false; cancelAnimationFrame(raf); cv.remove(); if (card) card.remove();
    removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true); removeEventListener('pointermove', onMove, true); removeEventListener('pointerdown', onDown, true);
    doc.querySelectorAll('span.cb-w').forEach(s => { s.style.visibility = ''; });
    items.forEach(it => { if (it.kind === 'img') it.el.style.visibility = ''; });
    if (AC) AC.close(); delete window.__cacheball;
  }
  window.__cacheball = { stop, step, draw, S, items, events, setAutopilot: f => { autopilot = f; }, measure, ctxTok, restart, startHandoff, MISSIONS };
})();
