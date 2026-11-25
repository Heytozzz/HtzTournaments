// HtzTournaments — tournament brackets and league tables that run entirely in the browser.
// Data lives in localStorage (no server). Formats: single elimination (with optional
// 3rd-place match) and league (round robin, optional home/away).
'use strict';

const LS_TOURNAMENTS = 'htzt_tournaments';
const LS_CURRENT = 'htzt_current';
const LS_LISTS = 'htzt_lists';
const CODE_GZIP = 'HTZT1:';
const CODE_PLAIN = 'HTZT0:';
const MAX_UNDO = 40;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

// ---------------------------------------------------------------- app settings (shared by every tournament)
const LS_SETTINGS = 'htzt_settings';
const DEFAULT_SETTINGS = { theme: 'red', twChannel: '', twCmd: '!unirme', twAccept: true, sound: 'original', layout: 'auto', anim: 'clash', appear: 0.6, hold: 1.2, spin: 3, animStart: true, animTeams: true, animElim: true };
let settings = loadSettings();
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}) }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }
// "auto": mirrored bracket on a computer, round by round on a phone
function effLayout() { return settings.layout === 'auto' ? (window.innerWidth <= 760 ? 'rounds' : 'split') : settings.layout; }
const animCfg = () => ({ anim: settings.anim, appear: settings.appear, hold: settings.hold, spin: settings.spin, sound: settings.sound });

// colour themes: they only change the accent (winners, champion, selections, the wheel)
const THEMES = {
  red: { name: 'Rojo', accent: '#f15562', on: '#ffffff', hue: 355 },
  pink: { name: 'Rosa', accent: '#f155b0', on: '#ffffff', hue: 325 },
  purple: { name: 'Morado', accent: '#b055f1', on: '#ffffff', hue: 275 },
  blue: { name: 'Azul', accent: '#5596f1', on: '#ffffff', hue: 215 },
  cyan: { name: 'Cian', accent: '#55caf1', on: '#0b1a20', hue: 195 },
  green: { name: 'Verde', accent: '#55f196', on: '#0b1f12', hue: 145 },
  yellow: { name: 'Amarillo', accent: '#f1d255', on: '#1a1400', hue: 48 },
  gray: { name: 'Gris', accent: '#b2b2b2', on: '#14101c', hue: 0, mono: true },
};
function applyTheme() {
  if (!THEMES[settings.theme]) settings.theme = 'red';
  const th = THEMES[settings.theme];
  const n = parseInt(th.accent.slice(1), 16);
  const st = document.documentElement.style;
  st.setProperty('--accent', th.accent);
  st.setProperty('--accent-rgb', `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`);
  st.setProperty('--accent-hue', String(th.hue));
  st.setProperty('--on-accent', th.on);
  st.setProperty('--wheel-mono', th.mono ? '1' : '0');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#000000';
}
applyTheme();

// ---------------------------------------------------------------- storage
let store = loadStore();
let cur = null; // current tournament object (lives inside store.tournaments)
let undoStack = [];
let view = 'participants';
let pFilter = 'all';

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_TOURNAMENTS));
    if (raw && typeof raw === 'object' && raw.tournaments) return raw;
  } catch (e) { /* ignore */ }
  return { tournaments: {} };
}
function save() {
  try {
    localStorage.setItem(LS_TOURNAMENTS, JSON.stringify(store));
    if (cur) localStorage.setItem(LS_CURRENT, cur.id);
  } catch (e) {
    toast('No se pudo guardar en este navegador');
  }
}
function loadLists() {
  try { const l = JSON.parse(localStorage.getItem(LS_LISTS)); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
function saveLists(lists) { localStorage.setItem(LS_LISTS, JSON.stringify(lists)); }

function newTournament(name, participants = []) {
  return sanitizeTournament({
    id: uid(), name, createdAt: Date.now(),
    format: 'single', places: 3, thirdPlace: true, byeSubs: false, seeded: false,
    double: false, points: '3-1', drawRandom: true, teamMode: false, teamSize: 2, teams: [],
    participants, bracket: null, league: null, elim: null, log: [],
  });
}

// Accepts any object (imported file, code, old version) and returns a valid tournament.
function sanitizeTournament(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const out = {
    id: typeof t.id === 'string' ? t.id : uid(),
    name: String(t.name || 'Torneo').slice(0, 60),
    createdAt: Number(t.createdAt) || Date.now(),
    format: ['league', 'elim'].includes(t.format) ? t.format : 'single',
    places: [1, 2, 3, 4, 8].includes(Number(t.places)) ? Number(t.places) : 3,
    thirdPlace: t.thirdPlace !== false,
    byeSubs: !!t.byeSubs,
    seeded: !!t.seeded,
    double: !!t.double,
    points: ['3-1', '2-1', '1-0'].includes(t.points) ? t.points : '3-1',
    drawRandom: t.drawRandom !== false,
    teamMode: !!t.teamMode,
    teamSize: Math.max(2, Math.min(10, Number(t.teamSize) || 2)),
    teams: [],
    participants: [],
    bracket: null,
    league: null,
    elim: null,
    log: Array.isArray(t.log) ? t.log.filter((l) => typeof l === 'string').slice(-200) : [],
  };
  const seen = new Set();
  (Array.isArray(t.teams) ? t.teams : []).forEach((tm) => {
    if (!tm || typeof tm.id !== 'string' || seen.has(tm.id)) return;
    seen.add(tm.id);
    out.teams.push({ id: tm.id, name: String(tm.name || 'Equipo').trim().slice(0, 40) || 'Equipo' });
  });
  const teamIds = new Set(out.teams.map((x) => x.id));
  (Array.isArray(t.participants) ? t.participants : []).forEach((p) => {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) return;
    let id = typeof p.id === 'string' ? p.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const team = teamIds.has(p.team) ? p.team : null;
    const tw = typeof p.tw === 'string' && /^[a-z0-9_]{1,25}$/.test(p.tw) ? p.tw : undefined;
    out.participants.push({ id, name: p.name.trim().slice(0, 40), sub: !!p.sub, out: !!p.out, team, lock: !!(team && p.lock), ...(tw ? { tw } : {}) });
  });
  const ids = new Set([...out.participants.map((p) => p.id), ...teamIds]);
  const okId = (v) => (typeof v === 'string' && ids.has(v) ? v : null);
  const b = t.bracket;
  if (b && Array.isArray(b.slots) && b.slots.length >= 2 && (b.slots.length & (b.slots.length - 1)) === 0) {
    out.bracket = {
      size: b.slots.length,
      slots: b.slots.map(okId),
      picks: {}, scores: {}, seeds: {},
      third: !!b.third,
    };
    Object.entries(b.picks || {}).forEach(([k, v]) => { if (okId(v)) out.bracket.picks[k] = v; });
    Object.entries(b.scores || {}).forEach(([k, v]) => {
      if (v && typeof v === 'object') out.bracket.scores[k] = { a: okId(v.a), b: okId(v.b), sa: cleanScore(v.sa), sb: cleanScore(v.sb) };
    });
    Object.entries(b.seeds || {}).forEach(([k, v]) => { if (ids.has(k)) out.bracket.seeds[k] = Number(v) || 0; });
  }
  const l = t.league;
  if (l && Array.isArray(l.rounds)) {
    out.league = { rounds: [], results: {} };
    l.rounds.forEach((round) => {
      if (!Array.isArray(round)) return;
      out.league.rounds.push(round.filter((m) => m && typeof m.id === 'string').map((m) => ({ id: m.id, a: okId(m.a), b: okId(m.b) })));
    });
    Object.entries(l.results || {}).forEach(([k, v]) => {
      if (v && typeof v === 'object') out.league.results[k] = { sa: cleanScore(v.sa), sb: cleanScore(v.sb), r: ['a', 'b', 'd'].includes(v.r) ? v.r : null };
    });
  }
  const e = t.elim;
  if (e && Array.isArray(e.pool)) {
    const pool = e.pool.map(okId).filter(Boolean);
    out.elim = { pool, order: (Array.isArray(e.order) ? e.order : []).map(okId).filter((id) => id && pool.includes(id)) };
  }
  return out;
}
function cleanScore(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.max(0, Math.min(9999, Math.round(n)))) : '';
}

// ---------------------------------------------------------------- mutations & undo
function mutate(fn, opts = {}) {
  undoStack.push(JSON.stringify(cur));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  fn(cur);
  render(opts);
  save();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  const t = JSON.parse(snap);
  store.tournaments[t.id] = t;
  cur = t;
  render();
  save();
  toast('Cambio deshecho');
}

const byId = (id) => cur.participants.find((p) => p.id === id) || cur.teams.find((x) => x.id === id);
const nameOf = (id) => (byId(id) ? byId(id).name : '');
const mains = () => cur.participants.filter((p) => !p.sub && !p.out);
const subs = () => cur.participants.filter((p) => p.sub && !p.out);
const membersOf = (teamId, t = cur) => t.participants.filter((p) => p.team === teamId && !p.sub && !p.out);
const isTeam = (id) => cur.teams.some((x) => x.id === id);
// who actually competes: players, or teams that have at least one player
function competitors(t = cur) {
  if (t.teamMode) return t.teams.filter((tm) => membersOf(tm.id, t).length).map((tm) => tm.id);
  return t.participants.filter((p) => !p.sub && !p.out).map((p) => p.id);
}
const started = (t = cur) => !!(t.bracket || t.league || t.elim);
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const hasResults = (t = cur) => (t.elim && t.elim.order.length > 0) || (t.bracket && Object.keys(t.bracket.picks).length > 0)
  || (t.league && Object.values(t.league.results).some((r) => r.r));

// ---------------------------------------------------------------- teams
const TEAM_NAMES = ['Rojo', 'Azul', 'Verde', 'Amarillo', 'Morado', 'Naranja', 'Rosa', 'Celeste', 'Blanco', 'Negro', 'Dorado', 'Plateado', 'Turquesa', 'Lima', 'Coral', 'Granate'];
// Fills the teams: people placed by hand stay where they are, the rest are shuffled into the emptiest teams.
function assignTeams(t) {
  const players = t.participants.filter((p) => !p.sub && !p.out);
  const nTeams = Math.max(2, Math.ceil(players.length / t.teamSize));
  while (t.teams.length < nTeams) {
    const used = new Set(t.teams.map((x) => x.name));
    const name = TEAM_NAMES.map((n) => `Equipo ${n}`).find((n) => !used.has(n)) || `Equipo ${t.teams.length + 1}`;
    t.teams.push({ id: uid(), name });
  }
  t.teams = t.teams.filter((tm, i) => i < nTeams || players.some((p) => p.lock && p.team === tm.id));
  const valid = new Set(t.teams.map((x) => x.id));
  t.participants.forEach((p) => {
    if (p.sub || p.out) { if (!p.out) { p.team = null; p.lock = false; } return; }
    if (!p.lock || !valid.has(p.team)) { p.team = null; p.lock = false; }
  });
  shuffle(players.filter((p) => !p.team)).forEach((p) => {
    const counts = t.teams.map((tm) => [tm, players.filter((x) => x.team === tm.id).length]);
    const min = Math.min(...counts.map((c) => c[1]));
    const options = counts.filter((c) => c[1] === min);
    p.team = options[Math.floor(Math.random() * options.length)][0].id;
  });
}
const teamsReady = (t = cur) => t.participants.every((p) => p.sub || p.out || (p.team && t.teams.some((x) => x.id === p.team)));

// ---------------------------------------------------------------- elimination ("último en pie")
function elimState(t = cur) {
  const out = new Set(t.elim.order);
  const alive = t.elim.pool.filter((id) => !out.has(id));
  return { alive, order: t.elim.order, champion: alive.length === 1 ? alive[0] : null };
}
function elimStandings(t) {
  const st = elimState(t);
  const N = t.elim.pool.length;
  const rows = st.alive.map((id) => ({ id, place: st.champion ? 1 : null, result: st.champion ? 'Campeón' : 'Sigue en juego' }));
  st.order.forEach((id, i) => {
    const place = N - i;
    rows.push({ id, place, result: place === 2 ? 'Subcampeón' : `Eliminado (${i + 1}º en salir)` });
  });
  rows.sort((x, y) => (x.place ?? 0.5) - (y.place ?? 0.5));
  return { rows, finished: !!st.champion };
}

// ---------------------------------------------------------------- single elimination
function seedOrder(size) {
  let s = [1];
  while (s.length < size) {
    const n = s.length * 2;
    s = s.flatMap((x) => [x, n + 1 - x]);
  }
  return s;
}
function roundName(r, R) {
  const fromEnd = R - 1 - r;
  return ['Final', 'Semifinal', 'Cuartos de final', 'Octavos de final', 'Dieciseisavos de final'][fromEnd] || `Ronda ${r + 1}`;
}

function buildBracket(t) {
  let players = t.participants.filter((p) => !p.sub && !p.out);
  if (t.teamMode) players = t.teams.filter((tm) => membersOf(tm.id, t).length);
  if (t.byeSubs && !t.teamMode) {
    const size = nextPow2(Math.max(2, players.length));
    const pool = t.participants.filter((p) => p.sub && !p.out);
    while (players.length < size && pool.length) {
      const s = pool.shift();
      s.sub = false;
      players.push(s);
      t.log.push(`${s.name} entra como jugador para que nadie pase sin jugar`);
    }
  }
  const n = players.length;
  const size = nextPow2(Math.max(2, n));
  const slots = new Array(size).fill(null);
  if (t.seeded) {
    seedOrder(size).forEach((seed, k) => { slots[k] = players[seed - 1] ? players[seed - 1].id : null; });
  } else {
    const m = size / 2;
    const byes = size - n;
    const byeMatch = new Set();
    seedOrder(m).forEach((seed, k) => { if (seed <= byes) byeMatch.add(k); });
    let i = 0;
    for (let k = 0; k < m; k++) {
      slots[2 * k] = players[i] ? players[i++].id : null;
      slots[2 * k + 1] = byeMatch.has(k) ? null : (players[i] ? players[i++].id : null);
    }
  }
  const seeds = {};
  players.forEach((p, i) => { seeds[p.id] = i + 1; });
  t.bracket = { size, slots, picks: {}, scores: {}, seeds, third: t.thirdPlace && n >= 4 };
  t.league = null;
  t.elim = null;
}

// Derives every match from the first-round slots plus the stored picks.
// Picks that no longer fit (because an earlier result changed) are removed here.
function derive(t) {
  const b = t.bracket;
  const R = Math.log2(b.size);
  const rounds = [];
  for (let r = 0; r < R; r++) {
    const count = b.size / 2 ** (r + 1);
    const round = [];
    for (let i = 0; i < count; i++) {
      const key = `${r}-${i}`;
      let a; let bb; let bye = false;
      if (r === 0) {
        a = b.slots[2 * i]; bb = b.slots[2 * i + 1];
        bye = !a || !bb;
      } else {
        const fa = rounds[r - 1][2 * i]; const fb = rounds[r - 1][2 * i + 1];
        a = fa.winner; bb = fb.winner;
        // an empty first-round pair (two byes) would leave a permanent hole
        bye = fa.empty || fb.empty;
      }
      round.push(resolveMatch(b, key, a, bb, bye));
    }
    rounds.push(round);
  }
  let third = null;
  if (b.third && R >= 2) {
    const semis = rounds[R - 2];
    third = resolveMatch(b, 'third', semis[0].loser, semis[1].loser, false);
  }
  const final = rounds[R - 1][0];
  return { R, rounds, third, champion: final.winner, runnerUp: final.loser };
}
function resolveMatch(b, key, a, bb, bye) {
  const m = { key, a: a || null, b: bb || null, bye, winner: null, loser: null, empty: !a && !bb && bye };
  const sc = b.scores[key];
  if (sc && (sc.a !== m.a || sc.b !== m.b)) delete b.scores[key];
  if (bye) {
    m.winner = m.a || m.b;
    delete b.picks[key];
    return m;
  }
  const pick = b.picks[key];
  if (pick && m.a && m.b && (pick === m.a || pick === m.b)) {
    m.winner = pick;
    m.loser = pick === m.a ? m.b : m.a;
  } else if (pick) {
    delete b.picks[key];
  }
  return m;
}

function bracketProgress(d) {
  let played = 0; let total = 0; let currentRound = null;
  d.rounds.forEach((round, r) => round.forEach((m) => {
    if (m.bye) return;
    total++;
    if (m.winner) played++;
    else if (currentRound === null) currentRound = r;
  }));
  if (d.third) { total++; if (d.third.winner) played++; }
  return { played, total, currentRound };
}

// Standings: competition ranking derived from the round each player went out in.
function singleStandings(t) {
  const d = derive(t);
  const b = t.bracket;
  const rows = new Map();
  b.slots.filter(Boolean).forEach((id) => rows.set(id, { id, wins: 0, place: null, result: 'En juego' }));
  const all = [...d.rounds.flat(), ...(d.third ? [d.third] : [])];
  all.forEach((m) => { if (m.winner && !m.bye && rows.has(m.winner)) rows.get(m.winner).wins++; });
  d.rounds.forEach((round, r) => round.forEach((m) => {
    if (!m.loser || !rows.has(m.loser)) return;
    const row = rows.get(m.loser);
    if (r === d.R - 1) { row.place = 2; row.result = 'Subcampeón'; return; }
    if (r === d.R - 2 && d.third) { row.result = 'Juega por el 3er lugar'; return; }
    row.place = 2 ** (d.R - r - 1) + 1;
    row.result = `Eliminado en ${roundName(r, d.R).toLowerCase()}`;
  }));
  if (d.champion && rows.has(d.champion)) Object.assign(rows.get(d.champion), { place: 1, result: 'Campeón' });
  if (d.third && d.third.winner) {
    Object.assign(rows.get(d.third.winner), { place: 3, result: 'Tercer lugar' });
    Object.assign(rows.get(d.third.loser), { place: 4, result: 'Cuarto lugar' });
  }
  const list = [...rows.values()];
  list.sort((x, y) => (x.place ?? 0.5) - (y.place ?? 0.5) || y.wins - x.wins || nameOf(x.id).localeCompare(nameOf(y.id)));
  return { rows: list, finished: !!d.champion && (!d.third || !!d.third.winner) };
}

// ---------------------------------------------------------------- league
function buildLeague(t) {
  const ids = competitors(t);
  if (ids.length % 2) ids.push(null);
  const n = ids.length;
  const rounds = [];
  let arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]; const bb = arr[n - 1 - i];
      // alternate home/away so nobody always plays first
      round.push(r % 2 ? { id: uid(), a: bb, b: a } : { id: uid(), a, b: bb });
    }
    rounds.push(round);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (t.double) rounds.push(...rounds.map((round) => round.map((m) => ({ id: uid(), a: m.b, b: m.a }))));
  t.league = { rounds, results: {} };
  t.bracket = null;
  t.elim = null;
}
function leagueStandings(t) {
  const [win, draw] = t.points.split('-').map(Number);
  const rows = new Map();
  const ids = new Set();
  t.league.rounds.flat().forEach((m) => { if (m.a) ids.add(m.a); if (m.b) ids.add(m.b); });
  ids.forEach((id) => rows.set(id, { id, pj: 0, g: 0, e: 0, p: 0, pf: 0, pc: 0, pts: 0 }));
  let played = 0; let total = 0;
  t.league.rounds.flat().forEach((m) => {
    if (!m.a || !m.b) return;
    total++;
    const res = t.league.results[m.id];
    if (!res || !res.r) return;
    played++;
    const A = rows.get(m.a); const B = rows.get(m.b);
    A.pj++; B.pj++;
    const sa = res.sa === '' ? 0 : Number(res.sa); const sb = res.sb === '' ? 0 : Number(res.sb);
    A.pf += sa; A.pc += sb; B.pf += sb; B.pc += sa;
    if (res.r === 'a') { A.g++; B.p++; A.pts += win; } else if (res.r === 'b') { B.g++; A.p++; B.pts += win; } else { A.e++; B.e++; A.pts += draw; B.pts += draw; }
  });
  const list = [...rows.values()].sort((x, y) => y.pts - x.pts || (y.pf - y.pc) - (x.pf - x.pc) || y.pf - x.pf || y.g - x.g || nameOf(x.id).localeCompare(nameOf(y.id)));
  list.forEach((r, i) => { r.place = i + 1; });
  return { rows: list, played, total, finished: total > 0 && played === total };
}

// ---------------------------------------------------------------- generation
function rosterChanged() {
  const active = new Set(competitors());
  let inPlay = [];
  if (cur.elim) inPlay = cur.elim.pool;
  else if (cur.bracket) inPlay = cur.bracket.slots.filter(Boolean);
  else if (cur.league) inPlay = [...new Set(cur.league.rounds.flat().flatMap((m) => [m.a, m.b]).filter(Boolean))];
  else return false;
  return inPlay.length !== active.size || inPlay.some((id) => !active.has(id));
}
let busy = false; // an animation is on screen
async function generate() {
  if (busy) return;
  if (cur.teamMode && mains().length < 2) { toast('Necesitas al menos 2 jugadores'); return; }
  const n = cur.teamMode ? Math.max(2, Math.ceil(mains().length / cur.teamSize)) : mains().length + (cur.byeSubs && cur.format === 'single' ? subs().length : 0);
  if (n < 2) { toast('Necesitas al menos 2 jugadores'); return; }
  if (hasResults() && !confirm('Este torneo ya tiene resultados. ¿Empezar de nuevo y borrarlos?')) return;
  // teams first: anyone without a team is drawn into one
  if (cur.teamMode && !teamsReady()) await drawTeams(true);
  if (cur.teamMode && competitors().length < 2) { toast('Hacen falta al menos 2 equipos con gente'); return; }
  mutate((t) => {
    if (t.drawRandom && !t.seeded && t.format !== 'elim') {
      if (t.teamMode) shuffle(t.teams);
      else {
        const ms = shuffle(t.participants.filter((p) => !p.sub && !p.out));
        t.participants = [...ms, ...t.participants.filter((p) => p.sub || p.out)];
      }
    }
    if (t.format === 'league') buildLeague(t);
    else if (t.format === 'elim') { t.elim = { pool: competitors(t), order: [] }; t.bracket = null; t.league = null; }
    else buildBracket(t);
    t.log.push(`Torneo empezado (${formatLabel(t).toLowerCase()})`);
  });
  roundTab = null;
  go('bracket');
  if (settings.animStart && settings.anim !== 'off') await playDraw();
}
// Reveals the first-round pairings (bracket) or the first matchday (league).
async function playDraw() {
  let matches = [];
  if (cur.bracket) matches = derive(cur).rounds[0].map((m) => [m.a, m.b]).filter((x) => x[0] || x[1]);
  else if (cur.league) matches = cur.league.rounds[0].map((m) => [m.a, m.b]);
  if (!matches.length) return;
  matches = [...matches.filter((x) => x[0] && x[1]), ...matches.filter((x) => !(x[0] && x[1]))];
  let pool = matches.flat().filter(Boolean).map(nameOf);
  const steps = matches.map(([a, b], i) => {
    const A = nameOf(a || b); const B = a && b ? nameOf(b) : null;
    const poolA = pool.slice(); pool = pool.filter((x) => x !== A);
    const poolB = pool.slice(); if (B) pool = pool.filter((x) => x !== B);
    return { kind: 'match', title: B ? `${cur.league ? 'Jornada 1 · ' : ''}Combate ${i + 1}` : (cur.league ? 'Descansa' : 'Pasa directo'), a: A, b: B, poolA, poolB };
  });
  busy = true;
  try { await Anim.play(cur.league ? 'Sorteo de la jornada 1' : 'Sorteo de los combates', steps, animCfg()); } finally { busy = false; }
}
// Draws the teams (people placed by hand keep their team) and shows it.
async function drawTeams(silent = false) {
  if (busy) return;
  if (mains().length < 2) { toast('Necesitas al menos 2 jugadores'); return; }
  const before = new Map(cur.participants.map((p) => [p.id, p.lock]));
  mutate((t) => assignTeams(t));
  if (!silent) toast('Equipos listos');
  if (!settings.animTeams || settings.anim === 'off') return;
  let pool = cur.participants.filter((p) => !p.sub && !p.out && !before.get(p.id)).map((p) => p.name);
  const steps = cur.teams.map((tm) => {
    const ms = membersOf(tm.id);
    // people placed by hand appear without spinning
    const ordered = [...ms.filter((p) => before.get(p.id)), ...ms.filter((p) => !before.get(p.id))];
    const pools = ordered.map((p) => {
      if (before.get(p.id)) return [p.name];
      const pl = pool.slice(); pool = pool.filter((x) => x !== p.name); return pl;
    });
    return { kind: 'team', title: tm.name, members: ordered.map((p) => p.name), pools };
  }).filter((x) => x.members.length);
  busy = true;
  try { await Anim.play('Sorteo de equipos', steps, animCfg()); } finally { busy = false; }
}
async function elimRandom() {
  if (busy || !cur.elim) return;
  const st = elimState();
  if (st.alive.length < 2) return;
  const pick = st.alive[Math.floor(Math.random() * st.alive.length)];
  if (settings.animElim && settings.anim !== 'off') {
    busy = true;
    try { await Anim.play('¿Quién sale?', [{ kind: 'out', title: `Quedan ${st.alive.length}`, pool: st.alive.map(nameOf), pick: nameOf(pick) }], animCfg()); } finally { busy = false; }
  }
  mutate((t) => { t.elim.order.push(pick); });
}

// ---------------------------------------------------------------- substitutions
function substitute(subId, outId) {
  const s = byId(subId); const o = byId(outId);
  if (!s || !o) return;
  let where = '';
  if (cur.bracket) {
    const d = derive(cur);
    const p = bracketProgress(d);
    where = p.currentRound !== null ? ` · ${roundName(p.currentRound, d.R)}` : '';
  }
  mutate((t) => {
    const S = t.participants.find((p) => p.id === subId);
    const O = t.participants.find((p) => p.id === outId);
    S.sub = false; O.out = true; O.sub = false;
    if (t.teamMode) {
      // in teams the substitute simply takes the player's place in the team
      S.team = O.team; S.lock = true; O.team = null; O.lock = false;
      t.participants.splice(t.participants.indexOf(S), 1);
      t.participants.splice(t.participants.indexOf(O), 0, S);
      t.log.push(`${S.name} entra por ${O.name} en ${nameOf(S.team)}${where}`);
      return;
    }
    const swap = (v) => (v === outId ? subId : v);
    if (t.elim) { t.elim.pool = t.elim.pool.map(swap); t.elim.order = t.elim.order.map(swap); }
    if (t.bracket) {
      const b = t.bracket;
      b.slots = b.slots.map(swap);
      Object.keys(b.picks).forEach((k) => { b.picks[k] = swap(b.picks[k]); });
      Object.values(b.scores).forEach((sc) => { sc.a = swap(sc.a); sc.b = swap(sc.b); });
      if (b.seeds[outId]) b.seeds[subId] = b.seeds[outId];
    }
    if (t.league) t.league.rounds.flat().forEach((m) => { m.a = swap(m.a); m.b = swap(m.b); });
    // keep the newcomer in the same spot of the list
    t.participants.splice(t.participants.indexOf(S), 1);
    t.participants.splice(t.participants.indexOf(O), 0, S);
    t.log.push(`${S.name} entra por ${O.name}${where}`);
  });
  toast(`${s.name} entra por ${o.name}`);
}

// ---------------------------------------------------------------- import / export helpers
const SUB_TAIL = /\s*[([]\s*(suplente|sub|s|reserva)\s*[)\]]\s*$/i;
const SUB_HEAD = /^\s*(suplente|sub|reserva)\s*[:\-–]\s*/i;
function parseLine(line) {
  let name = String(line).replace(/^\s*\d{1,3}\s*[.)\-–]\s+/, '').trim();
  let sub = false;
  if (SUB_TAIL.test(name)) { sub = true; name = name.replace(SUB_TAIL, ''); }
  if (SUB_HEAD.test(name)) { sub = true; name = name.replace(SUB_HEAD, ''); }
  if (name.startsWith('*')) { sub = true; name = name.slice(1); }
  name = name.trim().slice(0, 40);
  return name ? { name, sub } : null;
}
function parseList(text, filename = '') {
  const trimmed = text.trim();
  if (/\.json$/i.test(filename) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data) ? data : (Array.isArray(data.participants) ? data.participants : null);
      if (arr) {
        return arr.map((x) => (typeof x === 'string' ? parseLine(x) : (x && x.name ? { name: String(x.name).trim().slice(0, 40), sub: !!x.sub } : null)))
          .filter((x) => x && x.name);
      }
    } catch (e) { /* fall through to text */ }
  }
  const lines = trimmed.split(/\r?\n/);
  const isCsv = /\.csv$/i.test(filename) || lines.some((l) => /[,;]/.test(l) && /(suplente|titular|sub|rol)/i.test(l));
  const out = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    if (isCsv) {
      const cells = line.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim());
      if (i === 0 && /^(nombre|name|participante)$/i.test(cells[0])) return;
      const p = parseLine(cells[0]);
      if (p) { if (/^(suplente|sub|s|reserva)$/i.test(cells[1] || '')) p.sub = true; out.push(p); }
    } else {
      const p = parseLine(line);
      if (p) out.push(p);
    }
  });
  return out;
}
function addParticipants(items, replace = false) {
  let added = 0; let dup = 0;
  mutate((t) => {
    if (replace) t.participants = t.participants.filter((p) => isInPlay(p.id));
    const names = new Set(t.participants.map((p) => p.name.toLowerCase()));
    items.forEach((it) => {
      const key = it.name.toLowerCase();
      if (names.has(key)) { dup++; return; }
      names.add(key);
      t.participants.push({ id: uid(), name: it.name, sub: !!it.sub, out: false, team: null, lock: false });
      added++;
    });
  }, { arrive: true });
  toast(`${added} añadido${added === 1 ? '' : 's'}${dup ? ` · ${dup} repetido${dup === 1 ? '' : 's'} omitido${dup === 1 ? '' : 's'}` : ''}`);
}
function isInPlay(id) {
  if (cur.teamMode) { const p = byId(id); if (p && p.team && !isTeam(id)) id = p.team; }
  if (cur.elim) return cur.elim.pool.includes(id);
  if (cur.bracket) return cur.bracket.slots.includes(id);
  if (cur.league) return cur.league.rounds.some((r) => r.some((m) => m.a === id || m.b === id));
  return false;
}
function slug(s) {
  return (s || 'torneo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'torneo';
}
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function listAsText() {
  return [...mains().map((p) => p.name), ...subs().map((p) => `${p.name} (suplente)`)].join('\n');
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) { toast('No se pudo copiar'); }
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
async function makeCode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const gz = new Uint8Array(await new Response(stream).arrayBuffer());
    return CODE_GZIP + bytesToB64(gz);
  }
  return CODE_PLAIN + bytesToB64(bytes);
}
async function readCode(code) {
  const c = code.trim().replace(/\s+/g, '');
  if (c.startsWith(CODE_GZIP)) {
    const stream = new Blob([b64ToBytes(c.slice(CODE_GZIP.length))]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  if (c.startsWith(CODE_PLAIN)) return JSON.parse(new TextDecoder().decode(b64ToBytes(c.slice(CODE_PLAIN.length))));
  throw new Error('bad code');
}
function adoptTournament(raw) {
  const t = sanitizeTournament(raw);
  if (store.tournaments[t.id]) t.id = uid();
  t.createdAt = Date.now();
  store.tournaments[t.id] = t;
  switchTo(t.id);
  toast(`Torneo "${t.name}" abierto`);
}
function switchTo(id) {
  cur = store.tournaments[id];
  undoStack = [];
  save();
  render();
}

// ---------------------------------------------------------------- rendering
const ICON_UP = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

function render(opts = {}) {
  const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusId : null;
  document.body.dataset.format = cur.format;
  renderTop();
  renderParticipants(opts);
  renderBracket();
  renderStandings();
  fitBracket();
  if (focusId) {
    const el = document.querySelector(`[data-focus-id="${CSS.escape(focusId)}"]`);
    if (el) el.focus();
  }
}

function formatLabel(t) { return { league: 'Liga', elim: 'Eliminación', single: 'Cuadro' }[t.format]; }

function renderTop() {
  if (typeof renderTwitch === 'function' && $('joinHint')) renderTwitch();
  if (document.activeElement !== $('tName')) $('tName').value = cur.name;
  const n = mains().length;
  const nt = cur.teamMode ? cur.teams.filter((tm) => membersOf(tm.id).length).length : 0;
  $('tMeta').textContent = `${formatLabel(cur)} · ${n} jugador${n === 1 ? '' : 'es'}${nt ? ` en ${nt} equipos` : ''}`;
  $('undoBtn').disabled = undoStack.length === 0;
  const list = Object.values(store.tournaments).sort((a, b) => b.createdAt - a.createdAt);
  $('tSwitch').innerHTML = list.map((t) => `<option value="${esc(t.id)}"${t.id === cur.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
}

function renderParticipants(opts) {
  const all = cur.participants;
  const m = mains(); const s = subs(); const outs = all.filter((p) => p.out);
  $('cAll').textContent = m.length + s.length;
  $('cMain').textContent = m.length;
  $('cSub').textContent = s.length;
  document.querySelectorAll('.count-card').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.filter === pFilter)));

  let rows = [];
  if (pFilter === 'all') rows = [...m, ...s, ...outs];
  else if (pFilter === 'main') rows = m;
  else rows = s;
  const visible = rows.filter((p) => !p.out);
  $('pList').innerHTML = rows.map((p) => {
    const vi = visible.indexOf(p);
    const seed = p.out ? '' : (p.sub ? `S${s.indexOf(p) + 1}` : m.indexOf(p) + 1);
    const pill = p.out
      ? '<span class="pill out">Salió</span>'
      : `<button type="button" class="pill${p.sub ? ' sub' : ''}" data-act="role" data-id="${p.id}" title="Pulsa para cambiar a ${p.sub ? 'jugador' : 'suplente'}">${p.sub ? 'Suplente' : 'Jugador'}</button>`;
    const teamSel = cur.teamMode && !p.sub && !p.out
      ? `<select class="team-sel${p.lock ? ' locked' : ''}" data-id="${p.id}" aria-label="Equipo de ${esc(p.name)}"><option value="">${p.team && !p.lock ? `${esc(nameOf(p.team))} (al azar)` : 'Equipo al azar'}</option>${cur.teams.map((tm) => `<option value="${tm.id}"${p.lock && p.team === tm.id ? ' selected' : ''}>${esc(tm.name)}</option>`).join('')}<option value="__new">+ Equipo nuevo</option></select>`
      : '';
    return `<li class="p-row${opts.arrive ? ' arrive' : ''}" style="${opts.arrive ? `animation-delay:${Math.min(vi, 20) * 18}ms` : ''}">
      <span class="p-seed num">${seed}</span>
      <input class="p-name" type="text" value="${esc(p.name)}" data-id="${p.id}" data-focus-id="name-${p.id}" maxlength="40" aria-label="Nombre de ${esc(p.name)}"${p.out ? ' disabled' : ''} />
      ${p.tw ? `<span class="tw-tag" title="Se unió desde el chat de Twitch">@${esc(p.tw)}</span>` : ''}${teamSel}${pill}
      <span class="p-actions">
        <button type="button" class="icon-btn" data-act="up" data-id="${p.id}" aria-label="Subir a ${esc(p.name)}"${vi <= 0 ? ' disabled' : ''}>${ICON_UP}</button>
        <button type="button" class="icon-btn" data-act="down" data-id="${p.id}" aria-label="Bajar a ${esc(p.name)}"${vi < 0 || vi >= visible.length - 1 ? ' disabled' : ''}>${ICON_DOWN}</button>
        <button type="button" class="icon-btn del" data-act="del" data-id="${p.id}" aria-label="Quitar a ${esc(p.name)}">${ICON_DEL}</button>
      </span>
    </li>`;
  }).join('');
  $('pEmpty').hidden = rows.length > 0;
  if (!rows.length && all.length) {
    $('pEmpty').querySelector('.empty-title').textContent = pFilter === 'sub' ? 'No hay suplentes' : 'No hay jugadores';
    $('pEmpty').querySelector('p:last-child').textContent = pFilter === 'sub'
      ? 'Marca "Es suplente" al añadir, o pulsa la etiqueta Jugador de alguien para cambiarlo.'
      : 'Pulsa la etiqueta Suplente de alguien para hacerlo jugador.';
  } else {
    $('pEmpty').querySelector('.empty-title').textContent = 'Aún no hay nadie';
    $('pEmpty').querySelector('p:last-child').textContent = 'Aquí aparecerán los jugadores que añadas.';
  }

  // settings
  document.querySelectorAll('#formatSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.format === cur.format)));
  $('teamInput').checked = cur.teamMode;
  $('teamSizeInput').value = String(cur.teamSize);
  $('teamSizeField').hidden = !cur.teamMode;
  $('drawInput').checked = cur.drawRandom;
  document.body.dataset.teams = cur.teamMode ? 'on' : 'off';
  renderTeams();
  $('placesInput').value = String(cur.places);
  $('thirdInput').checked = cur.thirdPlace;
  $('byeSubsInput').checked = cur.byeSubs;
  $('seededInput').checked = cur.seeded;
  $('doubleInput').checked = cur.double;
  $('pointsInput').value = cur.points;

  // finding + format note
  const n = m.length;
  const generated = started();
  $('generateBtn').textContent = generated ? 'Rehacer el cuadro' : '¡Empezar torneo!';
  // once the tournament runs, rebuilding is the rare (and risky) action: tone the button down
  $('generateBtn').className = `btn big ${!generated || rosterChanged() ? 'primary' : 'ghost'}`;
  let finding;
  if (generated && rosterChanged()) {
    finding = '<strong>La lista cambió</strong> desde que empezó el torneo. Pulsa «Rehacer el cuadro» para usarla.';
  } else if (n < 2) {
    finding = 'Añade al menos <strong>2 jugadores</strong> para empezar.';
  } else {
    const tInfo = cur.teamMode && cur.teams.length ? ` en ${cur.teams.filter((tm) => membersOf(tm.id).length).length} equipos` : '';
    finding = generated
      ? `<strong>${n} jugadores</strong>${tInfo}${s.length ? ` y ${s.length} suplente${s.length === 1 ? '' : 's'}` : ''}. El torneo ya está en marcha: <a href="#cuadro">ver el cuadro</a>.`
      : `<strong>${n} jugadores</strong>${tInfo}${s.length ? ` y ${s.length} suplente${s.length === 1 ? '' : 's'}` : ''}. Cuando estén todos, pulsa ¡Empezar torneo!`;
  }
  $('pFinding').innerHTML = finding;
  $('formatNote').textContent = formatNote(n, s.length);

  // saved lists
  const lists = loadLists();
  $('savedSelect').innerHTML = lists.length
    ? lists.map((l, i) => `<option value="${i}">${esc(l.name)} (${l.participants.length})</option>`).join('')
    : '<option value="">Sin listas guardadas</option>';
  $('loadListBtn').disabled = !lists.length;
  $('deleteListBtn').disabled = !lists.length;
}
function renderTeams() {
  const panel = $('teamsPanel');
  panel.hidden = !cur.teamMode;
  if (!cur.teamMode) return;
  const loose = mains().filter((p) => !p.team);
  const teams = cur.teams.filter((tm) => membersOf(tm.id).length || cur.participants.some((p) => p.team === tm.id));
  $('teamsGrid').innerHTML = teams.length
    ? teams.map((tm) => {
      const ms = membersOf(tm.id);
      return `<div class="team-box" style="--h:${hueOf(tm.name)}">
        <input class="team-title" type="text" value="${esc(tm.name)}" maxlength="40" data-team="${tm.id}" data-focus-id="team-${tm.id}" aria-label="Nombre del equipo" />
        <div class="team-chips">${ms.length ? ms.map((p) => `<span class="chip${p.lock ? ' lock' : ''}" title="${p.lock ? 'Puesto a mano' : 'Al azar'}">${esc(p.name)}</span>`).join('') : '<span class="dim">Vacío</span>'}</div>
      </div>`;
    }).join('')
    : '<p class="note">Pulsa «Armar equipos al azar» o elige un equipo para cada persona en la lista.</p>';
  $('teamsLoose').textContent = loose.length ? `${loose.length} sin equipo todavía (se sortean al empezar).` : '';
}
const memberLine = (id) => (isTeam(id) ? membersOf(id).map((p) => p.name).join(', ') : '');

function formatNote(n, nSubs) {
  if (n < 2) return '';
  const teamNote = cur.teamMode ? `Se formarán ${Math.max(2, Math.ceil(n / cur.teamSize))} equipos de hasta ${cur.teamSize}. ` : '';
  if (cur.teamMode) n = Math.max(2, Math.ceil(n / cur.teamSize));
  return teamNote + formatNoteInner(n, nSubs);
}
function formatNoteInner(n, nSubs) {
  if (cur.format === 'elim') return 'Tocas a quien queda fuera hasta que quede uno. El último en salir es el 2º, el anterior el 3º, y así.';
  if (cur.format === 'league') {
    const even = n % 2 === 0;
    const rounds = (even ? n - 1 : n) * (cur.double ? 2 : 1);
    const matches = (n * (n - 1) / 2) * (cur.double ? 2 : 1);
    return `Se jugarán ${matches} partidas repartidas en ${rounds} jornadas${even ? '' : ' (en cada jornada descansa una persona)'}.`;
  }
  let players = n;
  if (cur.byeSubs && !cur.teamMode) players = Math.min(nextPow2(n), n + nSubs);
  const size = nextPow2(players);
  const byes = size - players;
  const R = Math.log2(size);
  return `Se jugarán ${R} ronda${R === 1 ? '' : 's'}.${byes ? ` Como el número no cuadra, ${byes === 1 ? '1 persona pasa' : `${byes} personas pasan`} a la siguiente ronda sin jugar.` : ''}`;
}

function rowHtml(m, side, d) {
  const id = m[side];
  const b = cur.bracket;
  const sc = b.scores[m.key];
  const val = sc ? (side === 'a' ? sc.sa : sc.sb) : '';
  if (!id) {
    const label = m.bye ? 'Sin rival' : 'Por definir';
    return `<div class="m-row ${m.bye ? 'bye' : 'tbd'}"><span class="av none" aria-hidden="true">?</span><span class="name">${label}</span><span></span></div>`;
  }
  const state = m.winner ? (m.winner === id ? 'win' : (m.bye ? '' : 'lose')) : '';
  const playable = !m.bye && m.a && m.b;
  return `<div class="m-row ${state}">
    ${avatar(id)}
    <button type="button" class="name" data-key="${m.key}" data-pid="${id}" data-focus-id="${m.key}:n:${side}"${playable ? '' : ' disabled'} title="${playable ? `Marcar a ${esc(nameOf(id))} como ganador` : esc(nameOf(id))}${isTeam(id) ? ` · ${esc(memberLine(id))}` : ''}">${esc(nameOf(id))}${isTeam(id) ? `<small>${esc(memberLine(id))}</small>` : ''}</button>
    ${playable ? `<input class="score" type="number" inputmode="numeric" min="0" max="9999" value="${esc(val)}" data-key="${m.key}" data-side="${side}" data-focus-id="${m.key}:s:${side}" aria-label="Puntos de ${esc(nameOf(id))}" />` : '<span></span>'}
  </div>`;
}
function matchHtml(m, d) {
  // a bye is not a match: show only the player who goes through
  if (m.bye && m.key !== 'third') {
    const id = m.a || m.b;
    return `<div class="match bye-match"><div class="m-row bye-row">${id ? avatar(id) : '<span class="av none" aria-hidden="true">?</span>'}<span class="name">${id ? esc(nameOf(id)) : 'Por definir'}</span><span class="bye-tag">pasa</span></div></div>`;
  }
  return `<div class="match${m.bye ? ' bye-match' : ''}${m.winner ? ' decided' : ''}">${rowHtml(m, 'a', d)}${rowHtml(m, 'b', d)}</div>`;
}

// ---------------------------------------------------------------- bracket layouts
// A = "split" (two halves meet at the final in the centre), B = "classic", C = "rounds" (one round at a time)
let roundTab = null; // layout C: round being viewed (null = follow the round in play)
let shownRound = 0;
const TROPHY = '<svg class="trophy" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 21h8M9.5 18h5"/></svg>';

function hueOf(name) { let h = 7; for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360; return h; }
function initials(name) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  const a = Array.from(w[0]);
  const s = w.length > 1 ? a[0] + Array.from(w[1])[0] : a.slice(0, 2).join('');
  return s.toUpperCase();
}
function avatar(id) {
  const n = nameOf(id);
  return `<span class="av" style="--h:${hueOf(n)}" aria-hidden="true">${esc(initials(n))}</span>`;
}
function roundState(d, p, r) {
  const ms = d.rounds[r].filter((m) => !m.bye);
  const done = ms.filter((m) => m.winner).length;
  return { playable: ms.length, done, state: p.currentRound === r ? 'now' : (done === ms.length ? 'done' : 'next') };
}
function roundHead(d, p, r, col) {
  const s = roundState(d, p, r);
  const sub = s.state === 'now' ? 'Jugando ahora' : (s.state === 'done' ? 'Terminada' : `${s.playable} partida${s.playable === 1 ? '' : 's'}`);
  return `<div class="round-head ${s.state}" style="grid-column:${col}"><b>${roundName(r, d.R)}</b><span>${sub}</span></div>`;
}
function slotHtml(m, d) { return `<div class="slot${m.winner && !m.bye ? ' won' : ''}">${matchHtml(m, d)}</div>`; }
function scrollRoundTab() {
  const onTab = document.querySelector('#bracketWrap .r-tab.on');
  if (onTab) onTab.parentElement.scrollLeft = onTab.offsetLeft - onTab.parentElement.offsetLeft - 16;
}
function champHtml(d) {
  const c = d.champion;
  return `<div class="champ-card${c ? '' : ' pending'}">${TROPHY}<span>Campeón</span><strong>${c ? esc(nameOf(c)) : 'Por definir'}</strong></div>`;
}
function thirdHtml(d) {
  return d.third ? `<div class="third-wrap"><p class="m-label">Partida por el 3er lugar</p>${matchHtml(d.third, d)}</div>` : '';
}

function classicHtml(d, p) {
  const cols = [];
  d.rounds.forEach((round, r) => {
    cols.push(roundHead(d, p, r, r + 1));
    cols.push(`<div class="round${r === 0 ? ' first' : ''}${r === d.R - 1 ? ' last' : ''}${p.currentRound === r ? ' now' : ''}" style="grid-column:${r + 1}">${round.map((m) => slotHtml(m, d)).join('')}</div>`);
  });
  cols.push(`<div class="round-head champ-head" style="grid-column:${d.R + 1}"><b>Campeón</b><span>${d.champion ? '¡Tenemos ganador!' : 'Por decidir'}</span></div>`);
  cols.push(`<div class="champion" style="grid-column:${d.R + 1}"><div style="width:100%">${champHtml(d)}${thirdHtml(d)}</div></div>`);
  return `<div class="bracket classic">${cols.join('')}</div>`;
}

function splitHtml(d, p) {
  const R = d.R;
  if (R < 2) return classicHtml(d, p);
  const cols = [];
  let c = 1;
  const side = (r, half, cls) => {
    const round = d.rounds[r];
    const ms = half === 0 ? round.slice(0, round.length / 2) : round.slice(round.length / 2);
    cols.push(roundHead(d, p, r, c));
    cols.push(`<div class="round ${cls}${r === 0 ? ' edge' : ''}${r === R - 2 ? ' inner' : ''}${p.currentRound === r ? ' now' : ''}" style="grid-column:${c}">${ms.map((m) => slotHtml(m, d)).join('')}</div>`);
    c++;
  };
  for (let r = 0; r < R - 1; r++) side(r, 0, 'side-l');
  const final = d.rounds[R - 1][0];
  cols.push(roundHead(d, p, R - 1, c).replace('round-head', 'round-head center-head'));
  cols.push(`<div class="center${p.currentRound === R - 1 ? ' now' : ''}" style="grid-column:${c}">
    <div class="center-top">${champHtml(d)}</div>
    ${slotHtml(final, d).replace('class="slot', 'class="slot final-slot')}
    <div class="center-bottom">${thirdHtml(d)}</div>
  </div>`);
  c++;
  for (let r = R - 2; r >= 0; r--) side(r, 1, 'side-r');
  return `<div class="bracket split" style="--sides:${R - 1}">${cols.join('')}</div>`;
}

function roundsHtml(d, p) {
  const R = d.R;
  let sel = roundTab;
  if (sel === null || sel > R) sel = p.currentRound !== null ? p.currentRound : R;
  shownRound = sel;
  const tabs = d.rounds.map((round, r) => {
    const s = roundState(d, p, r);
    return `<button type="button" class="r-tab ${s.state}${r === sel ? ' on' : ''}" data-rtab="${r}" aria-pressed="${r === sel}"><b>${roundName(r, R)}</b><span class="num">${s.state === 'done' ? 'Terminada' : `${s.done} de ${s.playable}`}</span></button>`;
  });
  tabs.push(`<button type="button" class="r-tab champ-tab${d.champion ? ' done' : ''}${sel === R ? ' on' : ''}" data-rtab="${R}" aria-pressed="${sel === R}">${TROPHY}<b>Campeón</b></button>`);
  let body;
  if (sel < R) {
    const ms = d.rounds[sel];
    const real = ms.filter((m) => !m.bye);
    const byes = ms.filter((m) => m.bye && (m.a || m.b));
    const s = roundState(d, p, sel);
    body = `<div class="vs-grid">${real.map((m, i) => `<div class="vs-card${m.winner ? ' done' : ''}"><p class="vs-num">Partida ${i + 1}${m.winner ? ' · <span class="ok">lista</span>' : ''}</p>${matchHtml(m, d)}</div>`).join('')}</div>
      ${byes.length ? `<p class="byes-line">Pasan sin jugar: ${byes.map((m) => `<b>${esc(nameOf(m.a || m.b))}</b>`).join(', ')}</p>` : ''}
      ${s.state === 'done' ? `<div class="next-row"><button type="button" class="btn primary big" data-rtab="${sel + 1}">${sel + 1 < R ? `Ir a ${roundName(sel + 1, R)}` : 'Ver al campeón'} →</button></div>` : ''}`;
  } else {
    body = `<div class="champ-stage">${champHtml(d)}${thirdHtml(d)}</div>`;
  }
  return `<div class="rounds-view"><div class="r-tabs" role="group" aria-label="Rondas">${tabs.join('')}</div>${body}</div>`;
}

function renderBracket() {
  const wrap = $('bracketWrap');
  const subsPanel = $('subsPanel');
  $('h-bracket').textContent = cur.league ? 'Calendario' : (cur.elim ? 'Eliminación' : 'Cuadro');
  const layout = effLayout();
  if (!started()) {
    wrap.innerHTML = `<div class="empty"><p class="empty-title">El torneo aún no empieza</p><p>Escribe los nombres en Jugadores y pulsa ¡Empezar torneo!</p><p style="margin-top:16px"><button type="button" class="btn primary" data-go="participants">Ir a Jugadores</button></p></div>`;
    $('bFinding').textContent = '';
    subsPanel.hidden = true;
    return;
  }
  subsPanel.hidden = false;
  let alive = [];
  if (cur.elim) {
    const st = elimState();
    const N = cur.elim.pool.length;
    const outPos = new Map(st.order.map((id, i) => [id, N - i]));
    wrap.dataset.layout = 'elim';
    wrap.innerHTML = `<div class="elim">
      ${st.champion ? `<div class="elim-champ">${champHtml({ champion: st.champion })}</div>` : `<div class="elim-bar"><button type="button" class="btn primary big" data-elim-random>Eliminar a alguien al azar</button><span class="elim-left">Quedan <b class="num">${st.alive.length}</b> de ${N}</span></div>`}
      <div class="elim-grid">${cur.elim.pool.map((id) => {
        const pos = outPos.get(id);
        const isChamp = st.champion === id;
        return `<button type="button" class="elim-card${pos ? ' out' : ''}${isChamp ? ' champ' : ''}" data-elim="${id}" data-focus-id="elim-${id}" title="${pos ? 'Pulsa para devolverlo al juego' : 'Pulsa para eliminar'}"${isChamp ? ' disabled' : ''}>
          ${avatar(id)}<span class="elim-name">${esc(nameOf(id))}${isTeam(id) ? `<small>${esc(memberLine(id))}</small>` : ''}</span>
          <span class="elim-tag">${isChamp ? '1º' : (pos ? `Fuera · ${pos}º` : '')}</span>
        </button>`;
      }).join('')}</div>
    </div>`;
    $('bFinding').innerHTML = st.champion
      ? `¡<strong>${esc(nameOf(st.champion))}</strong> es el último en pie!`
      : `Quedan <strong>${st.alive.length}</strong>. Toca a quien queda fuera (otro toque lo devuelve).`;
    alive = st.alive;
  } else if (cur.bracket) {
    const d = derive(cur);
    const p = bracketProgress(d);
    wrap.dataset.layout = layout;
    wrap.innerHTML = layout === 'rounds' ? roundsHtml(d, p) : (layout === 'classic' ? classicHtml(d, p) : splitHtml(d, p));
    scrollRoundTab();
    const champ = d.champion;
    if (champ) {
      $('bFinding').innerHTML = `¡<strong>${esc(nameOf(champ))}</strong> es el campeón!${d.third && !d.third.winner ? ' Falta la partida por el 3er lugar.' : ''}`;
    } else {
      const rn = p.currentRound !== null ? roundName(p.currentRound, d.R) : (d.third ? 'Partida por el 3er lugar' : '');
      $('bFinding').innerHTML = `<strong>${rn}</strong> · ${p.played} de ${p.total} partidas jugadas. Toca el nombre de quien ganó cada partida.`;
    }
    // players still alive can be replaced
    // semifinal losers stay "alive" while a 3rd-place match is still to be played
    const eliminated = new Set();
    d.rounds.forEach((round, r) => round.forEach((m) => {
      if (m.loser && !(d.third && r === d.R - 2)) eliminated.add(m.loser);
    }));
    if (d.third && d.third.loser) eliminated.add(d.third.loser);
    alive = cur.bracket.slots.filter((id) => id && !eliminated.has(id));
  } else if (cur.league) {
    const L = cur.league;
    const st = leagueStandings(cur);
    wrap.innerHTML = `<div class="league">${L.rounds.map((round, r) => `<div class="l-round"><h3>Jornada ${r + 1}</h3>${round.map((m) => leagueMatchHtml(m)).join('')}</div>`).join('')}</div>`;
    const leader = st.rows[0];
    $('bFinding').innerHTML = st.finished
      ? `Campeón: <strong>${esc(nameOf(leader.id))}</strong> con ${leader.pts} puntos`
      : `<strong>${st.played} de ${st.total}</strong> partidas jugadas${st.played && leader ? ` · lidera ${esc(nameOf(leader.id))} con ${leader.pts} pts` : ''}. Toca el nombre de quien ganó cada partida.`;
    alive = st.rows.map((r) => r.id);
  }
  // in teams the substitute replaces a person, not a whole team
  if (cur.teamMode) alive = alive.flatMap((tid) => membersOf(tid).map((p) => p.id));

  const sl = subs();
  $('subsList').innerHTML = sl.length
    ? sl.map((s) => `<li><span class="sub-name">${esc(s.name)}</span><div class="sub-line">
        <label class="sr-only" for="out-${s.id}">Sale para que entre ${esc(s.name)}</label>
        <select id="out-${s.id}"><option value="">Entra por…</option>${alive.map((id) => `<option value="${id}">${esc(nameOf(id))}${cur.teamMode && byId(id).team ? ` (${esc(nameOf(byId(id).team))})` : ''}</option>`).join('')}</select>
        <button type="button" class="btn small" data-sub="${s.id}">Cambiar</button></div></li>`).join('')
    : '<li class="empty-line">No hay suplentes disponibles. Añádelos en Jugadores.</li>';
  const log = cur.log.slice(-12).reverse();
  $('logList').innerHTML = log.length ? log.map((l) => `<li>${esc(l)}</li>`).join('') : '<li class="empty-line">Sin cambios todavía</li>';
}
// Shrinks the bracket (CSS zoom) so the whole tree fits the visible area.
const MIN_ZOOM = 0.65; // below this names stop being readable: scroll instead
function fitBracket() {
  const el = document.querySelector('#bracketWrap .bracket');
  const wrap = $('bracketWrap');
  $('presentBtn').hidden = !started();
  if (!el || wrap.offsetParent === null) return;
  el.style.zoom = '';
  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const top = wrap.getBoundingClientRect().top + window.scrollY;
  const availH = window.innerHeight - top - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (window.innerWidth <= 760 ? 80 : 20);
  const w = el.scrollWidth; const h = el.scrollHeight;
  if (!w || !h) return;
  // on a phone, fitting the width makes names unreadable: fit the height, swipe sideways
  const phone = window.innerWidth <= 760;
  const zoom = phone
    ? Math.max(0.7, Math.min(1, availH / h))
    : Math.max(MIN_ZOOM, Math.min(1, availW / w, availH / h));
  if (zoom < 0.999) el.style.zoom = String(zoom);
}
let fitRaf = 0;
let lastLayout = null;
window.addEventListener('resize', () => {
  cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    if (cur && effLayout() !== lastLayout) { lastLayout = effLayout(); renderBracket(); }
    fitBracket();
  });
});

function leagueMatchHtml(m) {
  if (!m.a || !m.b) {
    const who = m.a || m.b;
    return `<p class="rest">Descansa: ${esc(nameOf(who))}</p>`;
  }
  const res = cur.league.results[m.id] || { sa: '', sb: '', r: null };
  const row = (side) => {
    const id = m[side];
    const state = res.r ? (res.r === side ? 'win' : (res.r === 'd' ? '' : 'lose')) : '';
    return `<div class="m-row ${state}"><span class="seed"></span>
      <button type="button" class="name" data-lid="${m.id}" data-side="${side}" data-focus-id="${m.id}:n:${side}">${esc(nameOf(id))}</button>
      <input class="score" type="number" inputmode="numeric" min="0" max="9999" value="${esc(side === 'a' ? res.sa : res.sb)}" data-lid="${m.id}" data-side="${side}" data-focus-id="${m.id}:s:${side}" aria-label="Puntos de ${esc(nameOf(id))}" /></div>`;
  };
  return `<div class="match">${row('a')}${row('b')}<button type="button" class="draw-btn${res.r === 'd' ? ' on' : ''}" data-draw="${m.id}">${res.r === 'd' ? 'Empate' : 'Marcar empate'}</button></div>`;
}

function ordinal(n) { return `${n}º`; }
function renderStandings() {
  const table = $('standingsTable');
  const podium = $('podium');
  if (!started()) {
    podium.innerHTML = '';
    podium.style.removeProperty('--places');
    table.innerHTML = '<tbody><tr><td class="dim" style="border:0">La clasificación aparece cuando generas el cuadro.</td></tr></tbody>';
    $('sFinding').textContent = 'Sin cuadro todavía.';
    $('copyStandingsBtn').disabled = true;
    return;
  }
  $('copyStandingsBtn').disabled = false;
  let rows; let finished;
  const who = (id) => `${esc(nameOf(id))}${isTeam(id) ? `<small class="members">${esc(memberLine(id))}</small>` : ''}`;
  if (cur.elim) {
    ({ rows, finished } = elimStandings(cur));
    table.innerHTML = `<thead><tr><th>Puesto</th><th>Participante</th><th>Resultado</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.place && r.place <= cur.places ? 'top' : ''}"><td class="pos num">${r.place ? ordinal(r.place) : '—'}</td><td>${who(r.id)}</td><td class="${r.place ? '' : 'dim'}">${r.result}</td></tr>`).join('')}</tbody>`;
  } else if (cur.bracket) {
    ({ rows, finished } = singleStandings(cur));
    const counts = {};
    rows.forEach((r) => { if (r.place) counts[r.place] = (counts[r.place] || 0) + 1; });
    table.innerHTML = `<thead><tr><th>Puesto</th><th>Participante</th><th>Resultado</th><th class="num">Victorias</th></tr></thead><tbody>${rows.map((r) => {
      const label = r.place ? (counts[r.place] > 1 ? `${ordinal(r.place)}–${ordinal(r.place + counts[r.place] - 1)}` : ordinal(r.place)) : '—';
      return `<tr class="${r.place && r.place <= cur.places ? 'top' : ''}"><td class="pos num">${label}</td><td>${who(r.id)}</td><td class="${r.place ? '' : 'dim'}">${r.result}</td><td class="num">${r.wins}</td></tr>`;
    }).join('')}</tbody>`;
  } else {
    const st = leagueStandings(cur);
    rows = st.rows; finished = st.finished;
    table.innerHTML = `<thead><tr><th>Puesto</th><th>Participante</th><th class="num">PJ</th><th class="num">G</th><th class="num">E</th><th class="num">P</th><th class="num">A favor</th><th class="num">En contra</th><th class="num">Dif.</th><th class="num">Pts</th></tr></thead><tbody>${rows.map((r) => {
      const dif = r.pf - r.pc;
      return `<tr class="${r.place <= cur.places && st.played ? 'top' : ''}"><td class="pos num">${ordinal(r.place)}</td><td>${who(r.id)}</td><td class="num">${r.pj}</td><td class="num">${r.g}</td><td class="num">${r.e}</td><td class="num">${r.p}</td><td class="num">${r.pf}</td><td class="num">${r.pc}</td><td class="num">${dif > 0 ? '+' : ''}${dif}</td><td class="num">${r.pts}</td></tr>`;
    }).join('')}</tbody>`;
    if (!st.played) rows = rows.map((r) => ({ ...r, place: null }));
  }

  // podium: one card per place 1..places; shared places show every name
  const cards = [];
  for (let p = 1; p <= cur.places; p++) {
    const group = rows.filter((r) => r.place === p);
    const coveredByShared = rows.some((r) => r.place && r.place < p && rows.filter((x) => x.place === r.place).length > p - r.place);
    if (coveredByShared) continue;
    const label = p === 1 ? (cur.format === 'league' && !finished ? 'Líder' : 'Campeón') : `${ordinal(p)} lugar${group.length > 1 ? ' (compartido)' : ''}`;
    cards.push(`<div class="podium-card${p === 1 ? ' first' : ''}"><div class="place">${label}</div>${group.length
      ? `<div class="who">${group.map((g) => esc(nameOf(g.id))).join(' y ')}</div>${group.length === 1 && isTeam(group[0].id) ? `<div class="detail">${esc(memberLine(group[0].id))}</div>` : ''}`
      : '<div class="who tbd">Por definir</div>'}</div>`);
  }
  podium.innerHTML = cards.join('');
  podium.style.setProperty('--places', String(Math.min(cards.length, 4)));

  const champ = rows.find((r) => r.place === 1);
  $('sFinding').innerHTML = finished && champ
    ? `Torneo terminado. Campeón: <strong>${esc(nameOf(champ.id))}</strong>.`
    : `En juego. ${rows.filter((r) => r.place).length} de ${rows.length} posiciones definidas.`;
}

// ---------------------------------------------------------------- views
const VIEW_HASH = { participants: 'participantes', bracket: 'cuadro', standings: 'clasificacion', backup: 'datos', settings: 'ajustes' };
function go(v) {
  if (!VIEW_HASH[v]) v = 'participants';
  view = v;
  document.querySelectorAll('.view').forEach((s) => { s.hidden = s.id !== `view-${v}`; });
  document.querySelectorAll('.nav-item').forEach((n) => {
    if (n.dataset.view === v) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  if (location.hash.slice(1) !== VIEW_HASH[v]) history.replaceState(null, '', `#${VIEW_HASH[v]}`);
  window.scrollTo(0, 0);
  if (v === 'bracket') { fitBracket(); scrollRoundTab(); }
}
function viewFromHash() {
  const h = location.hash.slice(1);
  return Object.keys(VIEW_HASH).find((k) => VIEW_HASH[k] === h) || 'participants';
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- events
function bind() {
  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => go(n.dataset.view)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) go(g.dataset.go);
  });
  window.addEventListener('hashchange', () => go(viewFromHash()));

  // top bar
  $('tName').addEventListener('change', (e) => {
    const v = e.target.value.trim().slice(0, 60);
    if (!v) { e.target.value = cur.name; return; }
    mutate((t) => { t.name = v; });
  });
  $('tName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('tSwitch').addEventListener('change', (e) => switchTo(e.target.value));
  $('newTournamentBtn').addEventListener('click', () => {
    const count = Object.keys(store.tournaments).length + 1;
    const copy = cur.participants.length && confirm('¿Copiar los participantes del torneo actual al nuevo?');
    const ps = copy ? cur.participants.filter((p) => !p.out).map((p) => ({ id: uid(), name: p.name, sub: p.sub, out: false })) : [];
    const t = newTournament(`Torneo ${count}`, ps);
    t.format = cur.format; t.places = cur.places; t.thirdPlace = cur.thirdPlace;
    store.tournaments[t.id] = t;
    switchTo(t.id);
    go('participants');
    $('tName').focus();
    $('tName').select();
  });
  $('undoBtn').addEventListener('click', undo);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      undo();
    }
    if (e.key === 'Escape' && document.body.classList.contains('present')) exitPresent();
  });

  // participants
  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const items = parseList($('addName').value);
    if (!items.length) return;
    if ($('addAsSub').checked) items.forEach((i) => { i.sub = true; });
    addParticipants(items);
    $('addName').value = '';
    $('addName').focus();
  });
  // pasting several lines into the single-name field adds them all at once
  $('addName').addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/\r?\n/.test(text.trim())) return;
    e.preventDefault();
    const items = parseList(text);
    if (!items.length) return;
    if ($('addAsSub').checked) items.forEach((i) => { i.sub = true; });
    addParticipants(items);
  });
  document.querySelectorAll('.count-card').forEach((c) => c.addEventListener('click', () => { pFilter = c.dataset.filter; render(); }));
  $('shuffleBtn').addEventListener('click', () => {
    if (mains().length < 2) { toast('Necesitas al menos 2 jugadores'); return; }
    mutate((t) => {
      const ms = t.participants.filter((p) => !p.sub && !p.out);
      for (let i = ms.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ms[i], ms[j]] = [ms[j], ms[i]];
      }
      t.participants = [...ms, ...t.participants.filter((p) => p.sub || p.out)];
    }, { arrive: true });
    toast(cur.bracket || cur.league ? 'Lista mezclada. Pulsa «Rehacer el cuadro» para usar el nuevo orden.' : 'Lista mezclada');
  });
  $('sortBtn').addEventListener('click', () => mutate((t) => {
    t.participants.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }, { arrive: true }));
  $('clearBtn').addEventListener('click', () => {
    if (!cur.participants.length) return;
    if (!confirm('¿Quitar a todos los participantes? Se borrará también el cuadro.')) return;
    mutate((t) => { t.participants = []; t.bracket = null; t.league = null; t.log = []; });
  });
  $('bulkToggle').addEventListener('click', () => {
    const box = $('bulkBox');
    box.hidden = !box.hidden;
    $('bulkToggle').setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) $('bulkText').focus();
  });
  $('bulkAdd').addEventListener('click', () => {
    const items = parseList($('bulkText').value);
    if (!items.length) { toast('La lista está vacía'); return; }
    addParticipants(items);
    $('bulkText').value = '';
  });
  $('bulkReplace').addEventListener('click', () => {
    const items = parseList($('bulkText').value);
    if (!items.length) { toast('La lista está vacía'); return; }
    if (cur.participants.length && !confirm('¿Reemplazar la lista actual?')) return;
    addParticipants(items, true);
    $('bulkText').value = '';
  });
  $('pList').addEventListener('change', (e) => {
    const inp = e.target.closest('.p-name');
    if (!inp) return;
    const v = inp.value.trim().slice(0, 40);
    if (!v) { inp.value = nameOf(inp.dataset.id); return; }
    mutate((t) => { t.participants.find((p) => p.id === inp.dataset.id).name = v; });
  });
  $('pList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('p-name')) e.target.blur();
  });
  $('pList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'role') {
      if (isInPlay(id) && !confirm('Esta persona está en el cuadro. Si la pasas a suplente, su lugar quedará vacío al volver a generar. ¿Continuar?')) return;
      mutate((t) => { const p = t.participants.find((x) => x.id === id); p.sub = !p.sub; });
    } else if (act === 'del') {
      if (isInPlay(id) && !confirm(`${nameOf(id)} está en el cuadro. Su lugar quedará vacío. ¿Quitar?`)) return;
      mutate((t) => {
        t.participants = t.participants.filter((p) => p.id !== id);
        if (t.bracket) t.bracket.slots = t.bracket.slots.map((s) => (s === id ? null : s));
        if (t.league) t.league.rounds.flat().forEach((m) => { if (m.a === id) m.a = null; if (m.b === id) m.b = null; });
        if (t.elim) { t.elim.pool = t.elim.pool.filter((x) => x !== id); t.elim.order = t.elim.order.filter((x) => x !== id); }
      });
    } else if (act === 'up' || act === 'down') {
      mutate((t) => {
        const p = t.participants.find((x) => x.id === id);
        const group = t.participants.filter((x) => !x.out && x.sub === p.sub);
        const gi = group.indexOf(p);
        const other = group[act === 'up' ? gi - 1 : gi + 1];
        if (!other) return;
        const i = t.participants.indexOf(p); const j = t.participants.indexOf(other);
        [t.participants[i], t.participants[j]] = [t.participants[j], t.participants[i]];
      });
    }
  });

  // settings
  document.querySelectorAll('#formatSeg button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.format === cur.format) return;
    mutate((t) => { t.format = b.dataset.format; });
  }));
  $('placesInput').addEventListener('change', (e) => mutate((t) => { t.places = Number(e.target.value); }));
  $('thirdInput').addEventListener('change', (e) => mutate((t) => {
    t.thirdPlace = e.target.checked;
    if (t.bracket) t.bracket.third = e.target.checked && t.bracket.slots.filter(Boolean).length >= 4;
  }));
  $('byeSubsInput').addEventListener('change', (e) => mutate((t) => { t.byeSubs = e.target.checked; }));
  $('seededInput').addEventListener('change', (e) => mutate((t) => { t.seeded = e.target.checked; }));
  $('doubleInput').addEventListener('change', (e) => mutate((t) => { t.double = e.target.checked; }));
  $('pointsInput').addEventListener('change', (e) => mutate((t) => { t.points = e.target.value; }));
  $('drawInput').addEventListener('change', (e) => mutate((t) => { t.drawRandom = e.target.checked; }));
  $('generateBtn').addEventListener('click', generate);

  // saved lists
  $('saveListBtn').addEventListener('click', () => {
    const ps = cur.participants.filter((p) => !p.out);
    if (!ps.length) { toast('No hay participantes que guardar'); return; }
    const name = prompt('Nombre de la lista', cur.name);
    if (!name) return;
    const lists = loadLists();
    const entry = { name: name.trim().slice(0, 40), participants: ps.map((p) => ({ name: p.name, sub: p.sub })) };
    const i = lists.findIndex((l) => l.name === entry.name);
    if (i >= 0) lists[i] = entry; else lists.push(entry);
    saveLists(lists);
    render();
    toast(`Lista "${entry.name}" guardada`);
  });
  $('loadListBtn').addEventListener('click', () => {
    const l = loadLists()[Number($('savedSelect').value)];
    if (!l) return;
    const replace = cur.participants.length ? confirm('¿Reemplazar la lista actual? (Cancelar para añadir al final)') : false;
    addParticipants(l.participants, replace);
  });
  $('deleteListBtn').addEventListener('click', () => {
    const lists = loadLists();
    const i = Number($('savedSelect').value);
    if (!lists[i] || !confirm(`¿Borrar la lista "${lists[i].name}"?`)) return;
    lists.splice(i, 1);
    saveLists(lists);
    render();
  });

  // bracket + league interactions
  $('bracketWrap').addEventListener('click', (e) => {
    const nameBtn = e.target.closest('.name[data-key]');
    const ecard = e.target.closest('[data-elim]');
    if (ecard && !ecard.disabled) {
      const id = ecard.dataset.elim;
      mutate((t) => {
        const i = t.elim.order.indexOf(id);
        if (i >= 0) t.elim.order.splice(i, 1);
        else if (elimState(t).alive.length > 1) t.elim.order.push(id);
      });
      return;
    }
    if (e.target.closest('[data-elim-random]')) { elimRandom(); return; }
    const rtab = e.target.closest('[data-rtab]');
    if (rtab) { roundTab = Number(rtab.dataset.rtab); renderBracket(); return; }
    if (nameBtn && !nameBtn.disabled) {
      const { key, pid } = nameBtn.dataset;
      // in "round by round", stay on this round after its last result instead of jumping ahead
      if (effLayout() === 'rounds' && key !== 'third') roundTab = shownRound;
      mutate((t) => {
        if (t.bracket.picks[key] === pid) delete t.bracket.picks[key]; else t.bracket.picks[key] = pid;
      });
      return;
    }
    const lname = e.target.closest('.name[data-lid]');
    if (lname) {
      const { lid, side } = lname.dataset;
      mutate((t) => {
        const r = t.league.results[lid] || (t.league.results[lid] = { sa: '', sb: '', r: null });
        r.r = r.r === side ? null : side;
      });
      return;
    }
    const draw = e.target.closest('[data-draw]');
    if (draw) {
      const lid = draw.dataset.draw;
      mutate((t) => {
        const r = t.league.results[lid] || (t.league.results[lid] = { sa: '', sb: '', r: null });
        r.r = r.r === 'd' ? null : 'd';
      });
    }
  });
  $('bracketWrap').addEventListener('change', (e) => {
    const inp = e.target.closest('.score');
    if (!inp) return;
    const val = cleanScore(inp.value);
    // let focus move to the next field before re-rendering, then restore it
    setTimeout(() => {
      if (inp.dataset.key) {
        const { key, side } = inp.dataset;
        mutate((t) => {
          const d = derive(t);
          const m = key === 'third' ? d.third : d.rounds[Number(key.split('-')[0])][Number(key.split('-')[1])];
          const sc = t.bracket.scores[key] || (t.bracket.scores[key] = { a: m.a, b: m.b, sa: '', sb: '' });
          sc[side === 'a' ? 'sa' : 'sb'] = val;
          if (sc.sa !== '' && sc.sb !== '' && sc.sa !== sc.sb) t.bracket.picks[key] = Number(sc.sa) > Number(sc.sb) ? m.a : m.b;
        });
      } else {
        const { lid, side } = inp.dataset;
        mutate((t) => {
          const r = t.league.results[lid] || (t.league.results[lid] = { sa: '', sb: '', r: null });
          r[side === 'a' ? 'sa' : 'sb'] = val;
          if (r.sa !== '' && r.sb !== '') r.r = Number(r.sa) > Number(r.sb) ? 'a' : (Number(r.sa) < Number(r.sb) ? 'b' : 'd');
        });
      }
    }, 0);
  });
  $('subsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub]');
    if (!btn) return;
    const outId = $(`out-${btn.dataset.sub}`).value;
    if (!outId) { toast('Elige quién sale'); return; }
    substitute(btn.dataset.sub, outId);
  });
  bindSettings();
  bindTeams();
  bindTwitch();
  // close the "Más" menu after picking something in it
  document.querySelectorAll('details.more').forEach((dt) => dt.addEventListener('click', (e) => {
    if (e.target.closest('.more-menu .btn')) dt.open = false;
  }));
  $('presentBtn').addEventListener('click', enterPresent);
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) exitPresent(); else requestAnimationFrame(fitBracket); });

  // standings
  $('copyStandingsBtn').addEventListener('click', () => {
    const lines = [cur.name];
    $('standingsTable').querySelectorAll('tbody tr').forEach((tr) => {
      const c = tr.querySelectorAll('td');
      if (c.length > 2) lines.push(`${c[0].textContent} ${c[1].firstChild ? c[1].firstChild.textContent : c[1].textContent}`);
    });
    copyText(lines.join('\n'), 'Resultados copiados');
  });

  // import / export
  $('importListBtn').addEventListener('click', () => $('listFile').click());
  $('listFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const items = parseList(await file.text(), file.name);
    if (!items.length) { toast('No se encontraron nombres en el archivo'); return; }
    const replace = cur.participants.length ? confirm(`Se encontraron ${items.length} nombres. ¿Reemplazar la lista actual? (Cancelar para añadir al final)`) : false;
    addParticipants(items, replace);
    go('participants');
  });
  $('exportTxtBtn').addEventListener('click', () => {
    if (!cur.participants.length) { toast('La lista está vacía'); return; }
    download(`${slug(cur.name)}.txt`, listAsText(), 'text/plain;charset=utf-8');
  });
  $('exportCsvBtn').addEventListener('click', () => {
    if (!cur.participants.length) { toast('La lista está vacía'); return; }
    const q = (s) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = ['nombre,rol', ...mains().map((p) => `${q(p.name)},titular`), ...subs().map((p) => `${q(p.name)},suplente`)].join('\n');
    download(`${slug(cur.name)}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
  });
  $('copyListBtn').addEventListener('click', () => copyText(listAsText(), 'Lista copiada'));
  $('exportJsonBtn').addEventListener('click', () => {
    download(`${slug(cur.name)}.json`, JSON.stringify({ app: 'HtzTournaments', version: 1, tournament: cur }, null, 2), 'application/json');
  });
  $('importJsonBtn').addEventListener('click', () => $('jsonFile').click());
  $('jsonFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (Array.isArray(data)) { addParticipants(parseList(JSON.stringify(data), 'x.json')); return; }
      adoptTournament(data.tournament || data);
    } catch (err) { toast('El archivo no es un torneo válido'); }
  });
  $('makeCodeBtn').addEventListener('click', async () => {
    $('codeOut').value = await makeCode({ app: 'HtzTournaments', version: 1, tournament: cur });
    $('copyCodeBtn').disabled = false;
  });
  $('copyCodeBtn').addEventListener('click', () => copyText($('codeOut').value, 'Código copiado'));
  $('loadCodeBtn').addEventListener('click', async () => {
    try {
      const data = await readCode($('codeIn').value);
      adoptTournament(data.tournament || data);
      $('codeIn').value = '';
      go('bracket');
    } catch (err) { toast('El código no es válido'); }
  });
  $('deleteTournamentBtn').addEventListener('click', () => {
    if (!confirm(`¿Borrar "${cur.name}" de este navegador?`)) return;
    delete store.tournaments[cur.id];
    let next = Object.values(store.tournaments).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!next) { next = newTournament('Mi torneo'); store.tournaments[next.id] = next; }
    switchTo(next.id);
    go('participants');
    toast('Torneo borrado');
  });
}

function bindTeams() {
  $('teamInput').addEventListener('change', (e) => mutate((t) => { t.teamMode = e.target.checked; }));
  $('teamSizeInput').addEventListener('change', (e) => mutate((t) => { t.teamSize = Number(e.target.value); }));
  $('drawTeamsBtn').addEventListener('click', () => {
    if (started() && !confirm('El torneo ya empezó. Si cambias los equipos tendrás que rehacer el cuadro. ¿Seguir?')) return;
    drawTeams();
  });
  $('clearTeamsBtn').addEventListener('click', () => mutate((t) => {
    t.participants.forEach((p) => { if (!p.out) { p.team = null; p.lock = false; } });
    t.teams = t.teams.filter((tm) => t.participants.some((p) => p.team === tm.id));
  }));
  $('pList').addEventListener('change', (e) => {
    const sel = e.target.closest('.team-sel');
    if (!sel) return;
    const id = sel.dataset.id;
    mutate((t) => {
      const p = t.participants.find((x) => x.id === id);
      let v = sel.value;
      if (v === '__new') {
        const used = new Set(t.teams.map((x) => x.name));
        const tm = { id: uid(), name: TEAM_NAMES.map((n) => `Equipo ${n}`).find((n) => !used.has(n)) || `Equipo ${t.teams.length + 1}` };
        t.teams.push(tm);
        v = tm.id;
      }
      p.team = v || null;
      p.lock = !!v;
    });
  });
  $('teamsGrid').addEventListener('change', (e) => {
    const inp = e.target.closest('.team-title');
    if (!inp) return;
    const v = inp.value.trim().slice(0, 40);
    if (!v) { inp.value = nameOf(inp.dataset.team); return; }
    mutate((t) => { t.teams.find((x) => x.id === inp.dataset.team).name = v; });
  });
  $('teamsGrid').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('team-title')) e.target.blur(); });
}

function renderSettings() {
  $('themeGrid').innerHTML = Object.entries(THEMES).map(([k, th]) => `<button type="button" role="radio" class="swatch" data-set-theme="${k}" aria-checked="${k === settings.theme}" aria-label="${th.name}" title="${th.name}" style="--c:${th.accent}"></button>`).join('');
  $('set-sound').value = settings.sound;
  document.querySelectorAll('[data-set-layout]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.setLayout === settings.layout)));
  document.querySelectorAll('[data-set-anim]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.setAnim === settings.anim)));
  ['appear', 'hold', 'spin'].forEach((k) => {
    $(`set-${k}`).value = String(settings[k]);
    $(`set-${k}-out`).textContent = `${Number(settings[k]).toFixed(1).replace('.', ',')} s`;
  });
  ['animStart', 'animTeams', 'animElim'].forEach((k) => { $(`set-${k}`).checked = !!settings[k]; });
  $('animOpts').classList.toggle('off', settings.anim === 'off');
  $('spinField').hidden = settings.anim === 'clash';
}
function bindSettings() {
  const changed = () => { saveSettings(); renderSettings(); roundTab = null; renderBracket(); fitBracket(); };
  document.querySelectorAll('[data-set-layout]').forEach((b) => b.addEventListener('click', () => { settings.layout = b.dataset.setLayout; changed(); }));
  $('themeGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-theme]');
    if (!b) return;
    settings.theme = b.dataset.setTheme;
    applyTheme();
    changed();
  });
  $('set-sound').addEventListener('change', (e) => { settings.sound = e.target.value; saveSettings(); if (settings.sound !== 'off') Anim.preview(settings.sound, 'select'); });
  $('testSoundBtn').addEventListener('click', () => Anim.preview(settings.sound === 'off' ? 'original' : settings.sound, 'final'));
  document.querySelectorAll('[data-set-anim]').forEach((b) => b.addEventListener('click', () => { settings.anim = b.dataset.setAnim; changed(); }));
  ['appear', 'hold', 'spin'].forEach((k) => $(`set-${k}`).addEventListener('input', (e) => { settings[k] = Number(e.target.value); saveSettings(); renderSettings(); }));
  ['animStart', 'animTeams', 'animElim'].forEach((k) => $(`set-${k}`).addEventListener('change', (e) => { settings[k] = e.target.checked; changed(); }));
  $('testAnimBtn').addEventListener('click', async () => {
    if (busy) return;
    const names = mains().map((p) => p.name);
    const sample = names.length >= 4 ? names.slice(0, 8) : ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Fabián'];
    const cfg = { ...animCfg(), anim: settings.anim === 'off' ? 'clash' : settings.anim };
    busy = true;
    try {
      await Anim.play('Así se verá el sorteo', [
        { kind: 'match', title: 'Partida 1', a: sample[0], b: sample[1], poolA: sample, poolB: sample.slice(1) },
        { kind: 'team', title: 'Equipo Rojo', members: [sample[2], sample[3]], pools: [sample.slice(2), sample.slice(3)] },
        { kind: 'out', title: 'Modo eliminación', pool: sample, pick: sample[sample.length - 1] },
      ], cfg);
    } finally { busy = false; }
  });
  $('resetSettingsBtn').addEventListener('click', () => { settings = { ...DEFAULT_SETTINGS }; applyTheme(); changed(); toast('Ajustes restablecidos'); });
  renderSettings();
}

// ---------------------------------------------------------------- Twitch chat: "!unirme <nick>"
function joinCmd() { return (settings.twCmd || '!unirme').trim().toLowerCase().split(/\s+/)[0] || '!unirme'; }
function onChat({ login, displayName, text }) {
  const cmd = joinCmd();
  const low = text.toLowerCase();
  if (low !== cmd && !low.startsWith(`${cmd} `)) return;
  if (!settings.twAccept || started()) return;
  // the nick they write is the name used in the tournament; their Twitch user only counts once
  const nick = text.slice(cmd.length).trim().replace(/^@+/, '').replace(/\s+/g, ' ').slice(0, 40);
  if (!nick) return;
  if (cur.participants.some((p) => p.tw === login && !p.out)) return;
  if (cur.participants.some((p) => p.name.toLowerCase() === nick.toLowerCase())) return;
  mutate((t) => { t.participants.push({ id: uid(), name: nick, sub: false, out: false, team: null, lock: false, tw: login }); }, { arrive: true });
  toast(`${nick} se unió desde el chat (@${displayName})`);
}
let twState = 'off';
function renderTwitch() {
  const el = $('twStatus');
  const labels = { off: 'Desconectado', connecting: 'Conectando…', connected: `En vivo: #${Twitch.channel}` };
  el.textContent = labels[twState] || twState;
  el.dataset.state = twState in labels ? twState : 'error';
  $('twConnect').checked = twState === 'connected' || twState === 'connecting';
  $('twAccept').checked = !!settings.twAccept;
  $('joinHintCmd').textContent = joinCmd();
  $('joinHint').hidden = !(twState === 'connected' && settings.twAccept && !started());
}
function bindTwitch() {
  $('twChannel').value = settings.twChannel;
  $('twCmd').value = settings.twCmd;
  Twitch.on({
    message: onChat,
    status: (st, info) => {
      twState = st === 'error' ? (info || 'Error') : st;
      if (st === 'error') { toast(`Twitch: ${info || 'no se pudo conectar'}`); Twitch.disconnect(true); }
      renderTwitch();
    },
  });
  $('twConnect').addEventListener('change', (e) => {
    if (e.target.checked) {
      settings.twChannel = $('twChannel').value.trim();
      saveSettings();
      if (!settings.twChannel) { toast('Escribe primero el nombre de tu canal'); e.target.checked = false; $('twChannel').focus(); return; }
      Twitch.connect(settings.twChannel);
    } else Twitch.disconnect();
  });
  $('twChannel').addEventListener('keydown', (e) => { if (e.key === 'Enter') { $('twConnect').checked = true; $('twConnect').dispatchEvent(new Event('change')); } });
  $('twCmd').addEventListener('change', (e) => {
    let v = e.target.value.trim().split(/\s+/)[0] || '!unirme';
    if (!v.startsWith('!')) v = `!${v}`;
    settings.twCmd = v; e.target.value = v; saveSettings(); renderTwitch();
  });
  $('twAccept').addEventListener('change', (e) => { settings.twAccept = e.target.checked; saveSettings(); renderTwitch(); });
  renderTwitch();
}

function enterPresent() {
  go('bracket');
  document.body.classList.add('present');
  if (!document.querySelector('.exit-present')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost exit-present';
    b.textContent = 'Salir (Esc)';
    b.addEventListener('click', exitPresent);
    document.body.appendChild(b);
  }
  fitBracket();
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}
function exitPresent() {
  document.body.classList.remove('present');
  requestAnimationFrame(fitBracket);
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

// ---------------------------------------------------------------- start
(function init() {
  Object.keys(store.tournaments).forEach((id) => {
    const t = sanitizeTournament(store.tournaments[id]);
    t.id = id;
    store.tournaments[id] = t;
  });
  let id = localStorage.getItem(LS_CURRENT);
  if (!store.tournaments[id]) {
    id = Object.keys(store.tournaments)[0];
    if (!id) {
      const t = newTournament('Mi torneo');
      store.tournaments[t.id] = t;
      id = t.id;
    }
  }
  cur = store.tournaments[id];
  bind();
  render();
  go(viewFromHash());
  save();
}());
