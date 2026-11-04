// HtzTournaments — draw animations (roulette wheel or "clash" with a VS in the middle).
// The result is always decided beforehand by app.js; these only reveal it.
'use strict';

const Anim = (() => {
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hueOf = (name) => { let h = 7; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let skipped = false;
  let timers = [];
  let stage = null;

  // a wait that ends at once when the user presses "Saltar"
  function wait(ms) {
    if (skipped || ms <= 0) return Promise.resolve();
    return new Promise((res) => {
      const t = { res, id: setTimeout(() => { timers = timers.filter((x) => x !== t); res(); }, ms) };
      timers.push(t);
    });
  }
  function skip() {
    skipped = true;
    timers.forEach((t) => { clearTimeout(t.id); t.res(); });
    timers = [];
  }

  function open(title) {
    skipped = false;
    stage = document.createElement('div');
    stage.className = 'stage';
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-modal', 'true');
    stage.setAttribute('aria-label', title);
    stage.innerHTML = `<div class="stage-inner">
      <p class="stage-kicker">${escH(title)}</p>
      <h2 class="stage-title"></h2>
      <div class="stage-body"></div>
    </div>
    <div class="stage-foot"><span class="stage-count num"></span><button type="button" class="btn ghost stage-skip">Saltar animación</button></div>`;
    document.body.appendChild(stage);
    stage.querySelector('.stage-skip').addEventListener('click', skip);
    const onKey = (e) => { if (e.key === 'Escape') skip(); };
    document.addEventListener('keydown', onKey);
    stage._off = () => document.removeEventListener('keydown', onKey);
    requestAnimationFrame(() => stage.classList.add('on'));
    stage.querySelector('.stage-skip').focus();
  }
  async function close() {
    if (!stage) return;
    const s = stage;
    stage = null;
    s.classList.remove('on');
    s._off();
    await new Promise((r) => setTimeout(r, 200));
    s.remove();
  }
  const body = () => stage.querySelector('.stage-body');
  function setHead(title, count) {
    stage.querySelector('.stage-title').textContent = title || '';
    stage.querySelector('.stage-count').textContent = count || '';
  }
  const plate = (name, cls = '') => `<div class="plate ${cls}" style="--h:${hueOf(name)}"><span class="plate-av">${escH(initials(name))}</span><span class="plate-name">${escH(name)}</span></div>`;
  function initials(name) {
    const w = String(name).trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    const a = Array.from(w[0]);
    return (w.length > 1 ? a[0] + Array.from(w[1])[0] : a.slice(0, 2).join('')).toUpperCase();
  }

  // ---------------------------------------------------------------- sounds (from HtzRoulette)
  // 'original' is synthesized (a tick per slice, one sound when it lands); 'minecraft' uses samples.
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { try { getAudioCtx(); } catch (e) { /* no audio */ } }, { passive: true }));
  const SOUND_PACKS = {
    original: null,
    minecraft: {
      click: { url: 'sounds/minecraft/click.ogg', gain: 0.5 },
      orb: { url: 'sounds/minecraft/orb.ogg', gain: 0.6 },
      levelup: { url: 'sounds/minecraft/levelup.ogg', gain: 0.6 },
    },
  };
  const SOUND_SAMPLE_FOR = { tick: 'click', select: 'orb', final: 'levelup' };
  const soundBuffers = {};
  const soundLoads = {};
  let soundPack = 'original';
  function decodeSample(arrayBuffer) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoder = new Offline(1, 1, 44100);
    return new Promise((resolve, reject) => {
      const p = decoder.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    });
  }
  function loadSoundPack(pack) {
    const samples = SOUND_PACKS[pack];
    if (!samples) return Promise.resolve();
    if (soundLoads[pack]) return soundLoads[pack];
    soundBuffers[pack] = {};
    soundLoads[pack] = Promise.all(Object.entries(samples).map(async ([name, { url }]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        soundBuffers[pack][name] = await decodeSample(await res.arrayBuffer());
      } catch (err) { /* falls back to the synthesized sound */ }
    }));
    return soundLoads[pack];
  }
  function getPackSample(name) {
    const samples = SOUND_PACKS[soundPack];
    const buffer = samples && soundBuffers[soundPack] && soundBuffers[soundPack][name];
    return buffer ? { buffer, gain: samples[name].gain } : null;
  }
  function scheduleTick(ctx, when, gainScale) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 900;
    gain.gain.setValueAtTime(0.12 * gainScale, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.05);
  }
  function scheduleLanding(ctx, when) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, when);
    osc.frequency.exponentialRampToValueAtTime(140, when + 0.35);
    gain.gain.setValueAtTime(0.35, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.45);
  }
  function scheduleSound(ctx, kind, when, gainScale = 1) {
    const sample = getPackSample(SOUND_SAMPLE_FOR[kind]);
    if (sample) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = sample.buffer;
      gain.gain.value = sample.gain * gainScale;
      src.connect(gain).connect(ctx.destination);
      src.start(when);
      return;
    }
    if (kind === 'tick') scheduleTick(ctx, when, gainScale);
    else scheduleLanding(ctx, when);
  }
  let soundOn = true;
  function playSound(kind) {
    if (!soundOn || skipped) return;
    try { const ctx = getAudioCtx(); scheduleSound(ctx, kind, ctx.currentTime + 0.01); } catch (e) { /* no audio */ }
  }
  function setSound(pack) {
    soundOn = pack !== 'off';
    soundPack = SOUND_PACKS[pack] !== undefined ? pack : 'original';
    loadSoundPack(soundPack);
  }

  // ---------------------------------------------------------------- wheel (design from HtzRoulette)
  const RADIUS_RATIO = 250 / 280; // the outer margin holds the rim bulbs and the arrow
  const REF_RADIUS = 250;
  const normalize = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  function spinEasing(x) {
    const rampFraction = 0.1;
    const rampDistance = 0.18;
    if (x < rampFraction) return (x / rampFraction) * rampDistance;
    const remaining = (x - rampFraction) / (1 - rampFraction);
    return rampDistance + (1 - rampDistance) * (1 - Math.pow(1 - remaining, 4));
  }
  function lumaOf(h, s, l) {
    const sat = s / 100; const lig = l / 100;
    const a = sat * Math.min(lig, 1 - lig);
    const f = (n) => { const k = (n + h / 30) % 12; return lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
  }
  // slices in shades of the theme colour, lighter towards the middle of the circle
  function slicePaint(index, count, baseHue) {
    const pos = index / count;
    const triangle = pos < 0.5 ? pos * 2 : (1 - pos) * 2;
    const h = (baseHue + (index % 2 ? 10 : -10) + 360) % 360;
    const s = Math.round(78 + triangle * 18);
    const l = Math.round(44 + triangle * 20);
    return { h, s, l, color: `hsl(${h}, ${s}%, ${l}%)` };
  }
  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return { accent: cs.getPropertyValue('--accent').trim() || '#c6f24e', hue: Number(cs.getPropertyValue('--accent-hue')) || 80 };
  }

  function makeWheel(host) {
    const wrap = document.createElement('div');
    wrap.className = 'wheel';
    wrap.innerHTML = '<canvas></canvas>';
    host.appendChild(wrap);
    const canvas = wrap.querySelector('canvas');
    const size = Math.round(Math.min(480, window.innerWidth * 0.86, window.innerHeight * 0.52));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const { accent, hue } = themeColors();
    let rotation = Math.random() * Math.PI * 2;
    let names = [];
    let animating = false;

    function underIndex() {
      if (!names.length) return -1;
      const seg = (Math.PI * 2) / names.length;
      return Math.floor(normalize(-rotation) / seg) % names.length;
    }
    function draw() {
      const cx = size / 2; const cy = size / 2;
      const radius = (size / 2) * RADIUS_RATIO;
      const k = radius / REF_RADIUS;
      ctx.clearRect(0, 0, size, size);
      // rim with bulbs that blink while spinning
      const outer = radius + 24 * k;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.arc(0, 0, outer - k, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 8, 18, 0.9)';
      ctx.fill();
      ctx.lineWidth = Math.max(1, 2 * k);
      ctx.strokeStyle = accent;
      ctx.stroke();
      const bulbs = 28;
      const phase = animating ? Math.floor(performance.now() / 90) : 0;
      for (let i = 0; i < bulbs; i++) {
        const a = (i / bulbs) * Math.PI * 2;
        const lit = (i + phase) % 2 === 0;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (radius + 12 * k), Math.sin(a) * (radius + 12 * k), 3.2 * k, 0, Math.PI * 2);
        ctx.fillStyle = lit ? '#fff6c8' : 'rgba(255, 255, 255, 0.22)';
        ctx.shadowColor = lit ? '#ffd84a' : 'transparent';
        ctx.shadowBlur = lit ? 10 * k : 0;
        ctx.fill();
      }
      ctx.restore();

      // slices; the one under the arrow pops out and lights up
      const n = names.length;
      const seg = (Math.PI * 2) / n;
      const under = underIndex();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      const paint = (i, hl) => {
        const p = slicePaint(i, n, hue);
        ctx.save();
        if (hl) { ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 4; }
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, hl ? radius * 1.035 : radius, i * seg, (i + 1) * seg);
        ctx.closePath();
        ctx.fillStyle = hl ? `hsl(${p.h}, ${p.s}%, ${Math.min(p.l + 14, 74)}%)` : p.color;
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = hl ? 2.5 : 1.2;
        ctx.strokeStyle = hl ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.35)';
        ctx.stroke();
      };
      for (let i = 0; i < n; i++) if (i !== under) paint(i, false);
      if (under >= 0) paint(under, true);
      // names, turned upright on the left half
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.clip();
      const baseFont = Math.max(11, Math.min(21, Math.round((radius * 2.4) / Math.max(n, 6))));
      names.forEach((name, i) => {
        const hl = i === under;
        const fontSize = hl ? Math.round(baseFont * 1.1) : baseFont;
        const angle = i * seg + seg / 2;
        const flip = Math.cos(rotation + angle) < 0;
        const edge = radius - 10;
        const p = slicePaint(i, n, hue);
        const light = hl ? Math.min(p.l + 14, 74) : p.l;
        ctx.font = `600 ${fontSize}px Inter, "Segoe UI", sans-serif`;
        let label = name;
        while (ctx.measureText(label).width > radius - 40 && label.length > 2) label = label.slice(0, -1);
        if (label !== name) label = `${label.slice(0, -1)}…`;
        ctx.save();
        ctx.rotate(angle);
        if (flip) ctx.rotate(Math.PI);
        ctx.textAlign = flip ? 'left' : 'right';
        ctx.fillStyle = lumaOf(p.h, p.s, light) > 0.4 ? '#14101c' : '#fff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 3;
        ctx.fillText(label, flip ? -edge : edge, fontSize * 0.35);
        ctx.restore();
      });
      ctx.restore();
      ctx.restore();

      // hub
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 17 * k, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 8, 18, 0.9)';
      ctx.fill();
      ctx.lineWidth = Math.max(1, 3 * k);
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.restore();

      // arrow on the right, pointing at the wheel
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.moveTo(radius - 2 * k, 0);
      ctx.lineTo(radius + 24 * k, -14 * k);
      ctx.lineTo(radius + 24 * k, 14 * k);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 8 * k;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, 1.5 * k);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.stroke();
      ctx.restore();
    }

    // Ticks are computed up front from the same easing and scheduled on the audio clock.
    function scheduleSpinSounds(from, to, ms, seg, endKind) {
      if (!soundOn) return;
      let ctxA;
      try { ctxA = getAudioCtx(); } catch (e) { return; }
      loadSoundPack(soundPack);
      const times = [];
      let last = null; let lastMs = -Infinity;
      for (let t = 0; t <= ms; t += 2) {
        const rot = from + (to - from) * spinEasing(t / ms);
        const idx = Math.floor(normalize(-rot) / seg);
        if (last !== null && idx !== last && t - lastMs >= 20) { times.push(t); lastMs = t; }
        last = idx;
      }
      const start = ctxA.currentTime + 0.02;
      times.forEach((t, i) => {
        const gap = i === 0 ? Infinity : t - times[i - 1];
        scheduleSound(ctxA, 'tick', start + t / 1000, Math.min(1, Math.max(0.35, gap / 80)));
      });
      scheduleSound(ctxA, endKind, start + ms / 1000);
    }

    async function spin(pool, pick, seconds, endKind = 'select') {
      names = pool.slice();
      const kIdx = names.indexOf(pick);
      const n = names.length;
      const seg = (Math.PI * 2) / n;
      // the arrow points at angle 0: bring a spot inside slice k there
      const jitter = (0.2 + Math.random() * 0.6) * seg;
      let target = -(kIdx * seg + jitter);
      const turns = Math.max(3, Math.round(seconds * 1.6));
      while (target < rotation + turns * Math.PI * 2) target += Math.PI * 2;
      const from = rotation;
      const ms = skipped || n < 2 || reduced() ? 0 : seconds * 1000;
      if (!ms) { rotation = target; draw(); return; }
      scheduleSpinSounds(from, target, ms, seg, endKind);
      animating = true;
      await new Promise((res) => {
        const t0 = performance.now();
        const step = (now) => {
          if (skipped) { animating = false; rotation = target; draw(); res(); return; }
          const t = Math.min(1, (now - t0) / ms);
          rotation = from + (target - from) * spinEasing(t);
          draw();
          if (t < 1) requestAnimationFrame(step); else { animating = false; draw(); res(); }
        };
        requestAnimationFrame(step);
      });
    }
    return { spin, el: wrap };
  }

  // ---------------------------------------------------------------- steps
  async function stepMatch(s, cfg) {
    const b = body();
    if (cfg.anim === 'wheel') {
      b.innerHTML = '<div class="wheel-row"></div><div class="vs-line"></div>';
      const wheel = makeWheel(b.querySelector('.wheel-row'));
      const line = b.querySelector('.vs-line');
      line.innerHTML = `<div class="slot-a">${plate('?', 'ghost')}</div><span class="vs-mini">VS</span><div class="slot-b">${plate('?', 'ghost')}</div>`;
      await wheel.spin(s.poolA, s.a, cfg.spin);
      line.querySelector('.slot-a').innerHTML = plate(s.a, 'pop');
      await wait(cfg.appear * 1000);
      if (s.b) {
        await wheel.spin(s.poolB, s.b, cfg.spin);
        line.querySelector('.slot-b').innerHTML = plate(s.b, 'pop');
        line.classList.add('locked');
      } else {
        line.querySelector('.slot-b').innerHTML = '<div class="plate bye">Pasa sin jugar</div>';
      }
      await wait(cfg.hold * 1000);
      return;
    }
    // clash: names fly in from both sides and crash in the middle
    b.innerHTML = `<div class="clash" style="--appear:${skipped ? 0 : cfg.appear}s">
      <div class="clash-a">${plate(s.a, 'big')}</div>
      ${s.b ? `<div class="clash-vs"><span>VS</span></div><div class="clash-b">${plate(s.b, 'big')}</div>` : '<div class="clash-bye">pasa sin jugar</div>'}
    </div>`;
    const c = b.querySelector('.clash');
    void c.offsetWidth;
    c.classList.add('go');
    await wait(cfg.appear * 1000);
    c.classList.add('hit');
    playSound('select');
    await wait(cfg.hold * 1000);
  }

  async function stepTeam(s, cfg) {
    const b = body();
    b.innerHTML = `${cfg.anim === 'wheel' ? '<div class="wheel-row"></div>' : ''}<div class="team-card" style="--h:${hueOf(s.title)}"><p class="team-name">${escH(s.title)}</p><div class="team-members"></div></div>`;
    const list = b.querySelector('.team-members');
    const wheel = cfg.anim === 'wheel' ? makeWheel(b.querySelector('.wheel-row')) : null;
    for (let i = 0; i < s.members.length; i++) {
      if (wheel) await wheel.spin(s.pools[i], s.members[i], cfg.spin);
      else playSound('select');
      list.insertAdjacentHTML('beforeend', plate(s.members[i], 'pop'));
      await wait(cfg.appear * 1000);
    }
    await wait(cfg.hold * 1000);
  }

  async function stepOut(s, cfg) {
    const b = body();
    if (cfg.anim === 'wheel') {
      b.innerHTML = '<div class="wheel-row"></div><div class="out-line"></div>';
      const wheel = makeWheel(b.querySelector('.wheel-row'));
      await wheel.spin(s.pool, s.pick, cfg.spin);
    } else {
      // a quick shuffle of names that slows down and stops on the chosen one
      b.innerHTML = '<div class="out-line"></div>';
      const line = b.querySelector('.out-line');
      const total = skipped ? 0 : cfg.spin * 1000;
      let t = 0; let delay = 50;
      while (t < total && !skipped) {
        line.innerHTML = plate(s.pool[Math.floor(Math.random() * s.pool.length)], 'big');
        await wait(delay);
        t += delay;
        delay *= 1.12;
      }
    }
    if (cfg.anim !== 'wheel') playSound('select');
    b.querySelector('.out-line').innerHTML = `${plate(s.pick, 'big out')}<p class="out-tag">¡Fuera!</p>`;
    await wait(cfg.hold * 1000);
  }

  // steps: [{kind:'match'|'team'|'out', title, ...}]
  async function play(title, steps, cfg) {
    if (!steps.length || cfg.anim === 'off') return;
    setSound(cfg.sound || 'original');
    open(title);
    for (let i = 0; i < steps.length; i++) {
      if (skipped) break;
      const s = steps[i];
      setHead(s.kind === 'team' ? '' : s.title, steps.length > 1 ? `${i + 1} de ${steps.length}` : '');
      if (s.kind === 'team') await stepTeam(s, cfg);
      else if (s.kind === 'out') await stepOut(s, cfg);
      else await stepMatch(s, cfg);
    }
    if (!skipped) playSound('final');
    await close();
  }

  // a single sound, for the "Probar sonido" button in Ajustes
  function preview(pack, kind = 'final') {
    setSound(pack);
    const go = () => { skipped = false; playSound(kind); };
    if (SOUND_PACKS[soundPack]) loadSoundPack(soundPack).then(go); else go();
  }

  return { play, preview };
})();
