/* =========================================================
 * 글로벌랩스 DB 대시보드 v2
 * - 채널 짧은 이름(G, H …), 그룹(주력1팀·주력2팀·지원군)
 * - 오늘 마감·내일 DB 예측 (5분마다 자동 갱신)
 * ========================================================= */

/* ---------- 설정: 그룹과 색상은 여기서 바꾸면 됩니다 ---------- */
const GROUPS = [
  { id: 'main1', name: '주력1팀', army: '주력군', members: ['G', 'H'], color: '#2F5BD3' },
  { id: 'main2', name: '주력2팀', army: '주력군', members: ['D', 'B', 'U'], color: '#0E8F72' },
  { id: 'support', name: '지원군', army: '지원군', members: null, color: '#E2612E' } // null = 위에 없는 나머지 전부
];
const CHANNEL_COLORS = { G: '#2F5BD3', H: '#86A2F2', D: '#0E8F72', B: '#3DBB93', U: '#9AD9C1', M: '#E2612E', T: '#F0A83A' };
// 새로 인식된 채널(자동으로 지원군)에 차례로 쓰는 색
const EXTRA_COLORS = ['#C2417A', '#B5651D', '#D98C5F', '#9E7B2F', '#E07A9E', '#8C5A3C', '#CC5A3A', '#B89A3E'];
const AUTO_REFRESH_MIN = 5;
const FC = { profileDays: 28, levelDays: 7, weekdayDays: 56, backtestDays: 14, shrink: 200, window: 100 };

const DOW = ['월', '화', '수', '목', '금', '토', '일'];
const RANK_COLORS = ['#2F5BD3', '#12A38B', '#E0A100', '#C2417A', '#6A4FC9', '#E2612E', '#3B8FB8', '#7A8B2E', '#9C4DCC', '#B5651D'];
const OTHER = '#C3CBD5';
const PLATFORM_NAMES = { fb: 'Facebook', ig: 'Instagram', an: 'Audience Network', ms: 'Messenger', wa: 'WhatsApp' };
const TOP_N = 10;

Chart.defaults.font.family = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.color = '#5D6878';
Chart.defaults.borderColor = '#E7ECF2';
Chart.defaults.animation = false;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.display = false;

let D = null;
const S = { from: 0, to: 0, src: new Set(), dedupe: false, trend: 'day', stack: 'channel', dim: 'source', preset: 'all', liveKey: 'all', auto: true, open: new Set(), cmpBase: 'month', cmpMetric: 'share', page: ['#rank', '#goal'].includes(location.hash) ? location.hash.slice(1) : 'live', rankKey: 'all' };
const charts = {};
const CFG = window.DASHBOARD_CONFIG || {};

const $ = id => document.getElementById(id) || ghost(id);
// index.html과 app.js 버전이 어긋나 요소가 없어도 멈추지 않도록, 없는 요소는 화면에 안 보이는 임시 요소로 대신합니다.
const ghosts = {};
function ghost(id) {
  if (!ghosts[id]) {
    const el = document.createElement(/Chart$/.test(id) ? 'canvas' : /Table|Strip/.test(id) ? 'table' : 'div');
    el.id = id; el.hidden = true; ghosts[id] = el;
    console.warn('index.html에 #' + id + ' 요소가 없어요. index.html을 app.js와 같은 버전으로 올려 주세요.');
  }
  return ghosts[id];
}
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '0%';
const pad = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dayToStr = d => new Date(d * 864e5).toISOString().slice(0, 10);
const strToDay = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 864e5);
const dowOf = d => (d + 3) % 7; // 0=월 … 6=일
const fmtDay = d => { const t = new Date(d * 864e5); return t.getUTCFullYear() + '.' + pad(t.getUTCMonth() + 1) + '.' + pad(t.getUTCDate()); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortName = s => { const m = String(s).match(/^GL\s*[\(\[]\s*(.+?)\s*[\)\]]$/i); return m ? m[1] : String(s); };
const chColor = c => {
  const n = D.names[c];
  if (CHANNEL_COLORS[n]) return CHANNEL_COLORS[n];
  const extras = D.names.filter(x => !CHANNEL_COLORS[x]);
  return EXTRA_COLORS[extras.indexOf(n) % EXTRA_COLORS.length];
};

/* ---------- 데이터 불러오기 ---------- */
window.addEventListener('error', e => {
  const m = document.getElementById('loadMsg');
  if (m && !document.getElementById('overlay').classList.contains('hidden')) {
    m.className = 'err';
    m.textContent = '화면을 그리는 중 오류가 났어요: ' + (e.message || e) + ' — GitHub의 index.html, style.css, app.js가 같은 버전인지 확인해 주세요.';
  }
});
let loading = false;
let lastLoad = 0;
async function load(force, silent) {
  if (loading) return;
  loading = true;
  let tick = null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => ctrl && ctrl.abort(), 150000);
  if (!silent) {
    $('overlay').classList.remove('hidden');
    $('loadMsg').className = '';
    const t0 = Date.now();
    const show = () => {
      const sec = Math.round((Date.now() - t0) / 1000);
      $('loadMsg').textContent = '시트에서 데이터를 불러오는 중입니다… ' + sec + '초' +
        (sec >= 45 ? ' (저장된 결과가 없어 시트 전체를 새로 읽고 있어요. 조금만 더 기다려 주세요)' : '');
    };
    show(); tick = setInterval(show, 1000);
  } else {
    $('liveMeta').textContent = '최신 데이터 확인 중…';
  }
  try {
    if (!CFG.API_URL || CFG.API_URL.indexOf('script.google.com') < 0) throw new Error('config.js 파일의 API_URL에 Apps Script 웹 앱 주소를 넣어 주세요.');
    const u = new URL(CFG.API_URL);
    if (CFG.TOKEN) u.searchParams.set('token', CFG.TOKEN);
    if (force) u.searchParams.set('refresh', '1');
    const res = await fetch(u.toString(), ctrl ? { signal: ctrl.signal } : {});
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('API 응답을 읽을 수 없습니다. 웹 앱 액세스 권한이 "모든 사용자"로 배포됐는지 확인해 주세요.'); }
    if (data.error) throw new Error(data.error === 'unauthorized' ? 'TOKEN이 Apps Script의 ACCESS_TOKEN과 다릅니다.' : data.error);
    onData(data);
  } catch (e) {
    if (e && e.name === 'AbortError') e = new Error('응답이 2분 30초 넘게 없어요. Apps Script의 실행 기록에서 doGet 오류를 확인해 주세요.');
    if (silent && D) { $('liveMeta').textContent = '자동 갱신에 실패했어요. 다음 주기에 다시 시도합니다.'; }
    else onErr(e);
  } finally {
    loading = false;
    clearInterval(tick); clearTimeout(timeout);
  }
}

function onErr(e) {
  $('overlay').classList.remove('hidden');
  $('loadMsg').className = 'err';
  $('loadMsg').textContent = '데이터를 불러오지 못했습니다: ' + (e && e.message ? e.message : e);
}

function onData(raw) {
  const parts = raw.rows ? raw.rows.split(';') : [];
  const n = parts.length;
  const A = {
    src: new Uint8Array(n), day: new Int32Array(n), hour: new Int8Array(n),
    note: new Int32Array(n), plat: new Int32Array(n), camp: new Int32Array(n), dup: new Uint8Array(n)
  };
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = parts[i].split(',');
    A.src[i] = +p[0]; A.day[i] = +p[1]; A.hour[i] = +p[2];
    A.note[i] = +p[3]; A.plat[i] = +p[4]; A.camp[i] = +p[5]; A.dup[i] = +p[6];
    if (A.day[i] < min) min = A.day[i];
    if (A.day[i] > max) max = A.day[i];
  }
  const first = !D;
  const prevNames = D ? D.names : [];
  const prevSel = D ? new Set([...S.src].map(i => D.names[i])) : null;
  lastLoad = Date.now();
  D = Object.assign(raw, { A: A, n: n, min: n ? min : 0, max: n ? max : 0 });
  D.names = D.sources.map(shortName);
  parseSpend();
  D.firstDay = D.names.map(() => Infinity);
  for (let i = 0; i < n; i++) if (A.day[i] < D.firstDay[A.src[i]]) D.firstDay[A.src[i]] = A.day[i];
  setupGroups();
  parseAsOf();
  D.max = Math.max(D.max, D.asOf.day);

  // 선택 상태는 채널 이름 기준으로 유지하고, 새로 생긴 채널은 켜진 상태로 추가
  D.newNames = first ? [] : D.names.filter(nm => prevNames.indexOf(nm) < 0);
  S.src = new Set(D.names.map((nm, i) => i).filter(i => first || prevSel.has(D.names[i]) || prevNames.indexOf(D.names[i]) < 0));
  if (!D.hier.some(r => r.key === S.liveKey)) S.liveKey = 'all';
  buildChips();
  applyPreset(S.preset);
  renderLive();
  renderSpend();
  $('meta').textContent = '데이터 기준 ' + D.generatedAt + (D.buildSec ? ' (계산 ' + D.buildSec + '초)' : '') + '   |   범위 ' + fmtDay(D.min) + ' ~ ' + fmtDay(D.max) +
    (D.newNames.length ? '   |   새 채널 ' + D.newNames.join(', ') + ' 인식됨 (지원군)' : '');
  renderReport();
  buildRankTarget();
  renderRank();
  showPage(S.page, false);
  $('overlay').classList.add('hidden');
}

/** 서버가 시트를 읽은 시각(KST)을 예측 기준 시각으로 사용 */
function parseAsOf() {
  const m = String(D.generatedAt || '').match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) {
    D.asOf = { day: Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5), t: +m[4] + (+m[5]) / 60, label: m[4] + ':' + m[5] };
  } else {
    const k = new Date(Date.now() + 9 * 3600e3);
    D.asOf = { day: Math.floor(k.getTime() / 864e5), t: k.getUTCHours() + k.getUTCMinutes() / 60, label: pad(k.getUTCHours()) + ':' + pad(k.getUTCMinutes()) };
  }
  D.asOf.t = clamp(D.asOf.t, 0, 23.99);
}

/* ---------- 그룹 ---------- */
function setupGroups() {
  const used = new Set();
  D.groups = GROUPS.map(g => Object.assign({}, g, { idx: [] }));
  D.groupOf = D.names.map(() => -1);
  D.groups.forEach((g, gi) => {
    if (!g.members) return;
    g.members.forEach(m => {
      const c = D.names.indexOf(m);
      if (c >= 0 && !used.has(c)) { g.idx.push(c); used.add(c); D.groupOf[c] = gi; }
    });
  });
  const rest = D.groups.findIndex(g => !g.members);
  D.names.forEach((_, c) => { if (!used.has(c) && rest >= 0) { D.groups[rest].idx.push(c); D.groupOf[c] = rest; } });

  // 표에 쓸 계층: 전체 → 군 → 팀 → 채널
  const all = D.names.map((_, i) => i);
  const H = [{ key: 'all', lv: 0, name: '전체', ch: all }];
  [...new Set(D.groups.map(g => g.army))].forEach(army => {
    const teams = D.groups.filter(g => g.army === army && g.idx.length);
    const ch = teams.flatMap(t => t.idx);
    if (!ch.length) return;
    const single = teams.length === 1 && teams[0].name === army;
    H.push({ key: 'army:' + army, lv: 1, name: army, ch: ch, color: single ? teams[0].color : null, kids: single });
    teams.forEach(t => {
      const parent = single ? 'army:' + army : 'team:' + t.id;
      if (!single) H.push({ key: parent, lv: 2, name: t.name, ch: t.idx, color: t.color, kids: true });
      t.idx.forEach(c => H.push({ key: 'ch:' + D.names[c], lv: 3, name: D.names[c], ch: [c], color: chColor(c), parent: parent }));
    });
  });
  D.hier = H;
}

/* ---------- 필터 ---------- */
function buildChips() {
  $('chips').innerHTML = D.groups.filter(g => g.idx.length).map(g =>
    `<div class="cg"><button class="cg-name" data-g="${g.id}" style="--gc:${g.color}" title="${esc(g.army)} 전체 켜기/끄기">${esc(g.name)}</button>` +
    g.idx.map(c => `<button class="chip" data-i="${c}" aria-pressed="true" style="--c:${chColor(c)}"><i></i>${esc(D.names[c])}</button>`).join('') +
    '</div>').join('');
  syncControls();
}

function applyPreset(p) {
  S.preset = p;
  if (p === 'all') { S.from = D.min; S.to = D.max; }
  else if (p === 'yesterday') { S.from = S.to = Math.min(D.max, D.asOf.day - 1); }
  else if (p === 'month' || p === 'lastmonth') {
    const t = new Date(D.asOf.day * 864e5), y = t.getUTCFullYear(), m = t.getUTCMonth();
    const r = monthRange(p === 'month' ? y : (m ? y : y - 1), p === 'month' ? m : (m ? m - 1 : 11));
    S.from = r[0]; S.to = Math.min(r[1], D.max);
  }
  else if (p) { S.to = D.max; S.from = Math.max(D.min, D.max - (+p) + 1); }
  S.from = clamp(S.from, D.min, D.max); S.to = clamp(S.to, D.min, D.max);
  syncControls();
  render();
}

function syncControls() {
  $('from').value = dayToStr(S.from); $('to').value = dayToStr(S.to);
  $('from').min = $('to').min = dayToStr(D.min);
  $('from').max = $('to').max = dayToStr(D.max);
  const press = (sel, attr, val) => document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));
  press('#presets button', 'p', S.preset);
  press('#trendSeg button', 'v', S.trend);
  press('#stackSeg button', 'v', S.stack);
  press('#dailySeg button', 'v', S.stack);
  $('prevRange').disabled = S.from <= D.min;
  $('nextRange').disabled = S.to >= D.max;
  press('#dimSeg button', 'v', S.dim);
  press('#cmpBaseSeg button', 'v', S.cmpBase);
  press('#cmpMetricSeg button', 'v', S.cmpMetric);
  document.querySelectorAll('#chips .chip').forEach(b => b.setAttribute('aria-pressed', String(S.src.has(+b.dataset.i))));
}

function monthRange(y, m) { // m: 0~11
  return [Math.floor(Date.UTC(y, m, 1) / 864e5), Math.floor(Date.UTC(y, m + 1, 0) / 864e5)];
}
function shiftRange(dir) {
  // 한 달 단위로 선택돼 있으면 달 단위로 이동
  const f0 = new Date(S.from * 864e5);
  const mr = monthRange(f0.getUTCFullYear(), f0.getUTCMonth());
  if (S.from === mr[0] && (S.to === mr[1] || (S.to === D.max && S.to < mr[1]))) {
    const r = monthRange(f0.getUTCFullYear(), f0.getUTCMonth() + dir);
    if (r[0] > D.max || r[1] < D.min) return;
    S.from = Math.max(r[0], D.min); S.to = Math.min(r[1], D.max); S.preset = null;
    syncControls(); render(); return;
  }
  const span = S.to - S.from + 1;
  let f = S.from + dir * span, t = S.to + dir * span;
  if (t > D.max) { t = D.max; f = t - span + 1; }
  if (f < D.min) { f = D.min; t = Math.min(D.max, f + span - 1); }
  S.from = f; S.to = t; S.preset = null;
  syncControls(); render();
}
$('prevRange').addEventListener('click', () => shiftRange(-1));
$('nextRange').addEventListener('click', () => shiftRange(1));
$('dailySeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.stack = b.dataset.v; syncControls(); render(); } });
$('presets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) applyPreset(b.dataset.p); });
['from', 'to'].forEach(id => $(id).addEventListener('change', () => {
  let f = strToDay($('from').value), t = strToDay($('to').value);
  if (isNaN(f)) f = D.min; if (isNaN(t)) t = D.max;
  if (f > t) [f, t] = [t, f];
  S.from = f; S.to = t; S.preset = null;
  syncControls(); render();
}));
$('chips').addEventListener('click', e => {
  const g = e.target.closest('.cg-name');
  if (g) {
    const grp = D.groups.find(x => x.id === g.dataset.g);
    const allOn = grp.idx.every(c => S.src.has(c));
    grp.idx.forEach(c => allOn ? S.src.delete(c) : S.src.add(c));
  } else {
    const b = e.target.closest('.chip'); if (!b) return;
    const i = +b.dataset.i;
    if (S.src.has(i)) S.src.delete(i); else S.src.add(i);
  }
  syncControls(); render();
});
$('allSrc').addEventListener('click', () => { S.src = new Set(D.names.map((_, i) => i)); syncControls(); render(); });
function setDedupe(v) { S.dedupe = v; $('dedupe').checked = v; $('dedupe2').checked = v; render(); renderLive(); renderSpend(); renderRank(); renderGoal(); }
$('dedupe').addEventListener('change', e => setDedupe(e.target.checked));
$('dedupe2').addEventListener('change', e => setDedupe(e.target.checked));
$('rankTarget').addEventListener('change', e => { S.rankKey = e.target.value; renderRank(); });
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) showPage(b.dataset.page, true); });
window.addEventListener('hashchange', () => showPage(['#rank', '#goal'].includes(location.hash) ? location.hash.slice(1) : 'live', false));

function showPage(p, push) {
  S.page = p;
  ['live', 'rank', 'goal'].forEach(k => { $('page-' + k).hidden = p !== k; });
  document.querySelectorAll('.tabs [data-page]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.page === p)));
  if (push) history.replaceState(null, '', p === 'live' ? location.pathname + location.search : '#' + p);
  if (p === 'rank') renderRank();
  else if (p === 'goal') renderGoal();
  else Object.values(charts).forEach(c => c.resize());
  if (push) window.scrollTo(0, 0);
}
$('goalTable').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-kids="1"]'); if (!tr) return;
  const key = tr.dataset.key;
  if (S.open.has(key)) S.open.delete(key); else S.open.add(key);
  renderGoal(); renderLive(); renderSpend();
});
const segHandler = (id, key) => $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S[key] = b.dataset.v; syncControls(); render(); } });
segHandler('trendSeg', 'trend'); segHandler('stackSeg', 'stack'); segHandler('dimSeg', 'dim');
segHandler('cmpBaseSeg', 'cmpBase'); segHandler('cmpMetricSeg', 'cmpMetric');
$('cmpStrip').addEventListener('click', e => { const tr = e.target.closest('tr[data-base]'); if (tr) { S.cmpBase = tr.dataset.base; syncControls(); render(); } });
$('reload').addEventListener('click', () => load(true, false));
$('autoRefresh').addEventListener('change', e => { S.auto = e.target.checked; });
$('spendTable').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-kids="1"]'); if (!tr) return;
  const key = tr.dataset.key;
  if (S.open.has(key)) S.open.delete(key); else S.open.add(key);
  renderLive(); renderSpend();
});
$('liveTable').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-key]'); if (!tr) return;
  const key = tr.dataset.key;
  if (tr.dataset.kids === '1') { if (S.open.has(key)) S.open.delete(key); else S.open.add(key); }
  S.liveKey = key; renderLive(); renderSpend();
});

/* =========================================================
 * 실시간 예측
 * ========================================================= */
function buildLive() {
  const nc = D.names.length, W = FC.window;
  const today = D.asOf.day, t = D.asOf.t, start = today - W + 1;
  const M = new Float64Array(nc * W * 25); // [채널][일][시간 0~23, 24=시간없음]
  const A = D.A;
  for (let i = 0; i < D.n; i++) {
    const d = A.day[i];
    if (d < start || d > today) continue;
    if (S.dedupe && A.dup[i]) continue;
    const h = A.hour[i];
    M[(A.src[i] * W + (d - start)) * 25 + (h >= 0 ? h : 24)]++;
  }
  const first = D.firstDay;
  const cell = (c, d, h) => (d < start || d > today) ? 0 : M[(c * W + (d - start)) * 25 + h];
  const timedTotal = (c, d) => { let s = 0; for (let h = 0; h < 24; h++) s += cell(c, d, h); return s; };
  const dayTotal = (c, d) => timedTotal(c, d) + cell(c, d, 24);
  const cumBefore = (c, d, x) => {
    const fl = Math.min(24, Math.floor(x)); let s = 0;
    for (let h = 0; h < fl; h++) s += cell(c, d, h);
    if (fl < 24) s += (x - fl) * cell(c, d, fl);
    return s;
  };

  // x시 이전에 하루 DB의 몇 %가 들어오는지 (ref일 이전 profileDays일 기준, 적은 채널은 전체 패턴으로 보정)
  function profile(ref, x) {
    const num = new Float64Array(nc), den = new Float64Array(nc);
    let na = 0, da = 0;
    for (let c = 0; c < nc; c++) {
      for (let d = ref - FC.profileDays; d < ref; d++) { num[c] += cumBefore(c, d, x); den[c] += timedTotal(c, d); }
      na += num[c]; da += den[c];
    }
    const fAll = da > 0 ? na / da : x / 24;
    return Array.from(num, (v, c) => (v + FC.shrink * fAll) / (den[c] + FC.shrink));
  }
  function level(c, ref, days) {
    const s = Math.max(ref - days, first[c]);
    if (!isFinite(s) || s >= ref) return null;
    let sum = 0; for (let d = s; d < ref; d++) sum += dayTotal(c, d);
    return sum / (ref - s);
  }
  function weekdayFactor(c, ref, dow) {
    const s = Math.max(ref - FC.weekdayDays, first[c]);
    if (!isFinite(s)) return 1;
    let sa = 0, na = 0, sd = 0, nd = 0;
    for (let d = s; d < ref; d++) { const v = dayTotal(c, d); sa += v; na++; if (dowOf(d) === dow) { sd += v; nd++; } }
    if (nd < 2 || sa <= 0) return 1;
    return clamp((sd / nd) / (sa / na), 0.5, 1.8);
  }
  // 실시간 채널(시간 정보 있음) vs 수기 채널(다음 날 하루치를 입력, 시간 없음) 구분
  const realtime = D.names.map((_, c) => {
    for (let d = today - FC.profileDays; d <= today; d++) for (let h = 0; h < 24; h++) if (cell(c, d, h) > 0) return true;
    return false;
  });
  // 수기 채널은 마지막으로 입력된 날을 기준으로 평균을 냄 (아직 입력 안 된 어제를 0으로 보지 않도록)
  const lastDay = D.names.map((_, c) => { for (let d = today - 1; d >= start; d--) if (dayTotal(c, d) > 0) return d; return null; });

  function forecast(c, day, x, F, withUntimed) {
    if (!realtime[c]) {
      const so = dayTotal(c, day) * (day === today ? 1 : 0);
      const ref = lastDay[c] == null ? day : Math.min(day, lastDay[c] + 1);
      const lv = level(c, ref, FC.levelDays);
      const base = lv == null ? 0 : lv * weekdayFactor(c, ref, dowOf(day));
      const fc = Math.max(so, base);
      return { so: so, fc: fc, rem: fc - so, manual: true };
    }
    // 오늘은 현재 시간대에 이미 들어온 DB를 모두 포함, 과거일 검증은 같은 시각까지만 비례 계산
    const timed = withUntimed ? cumBefore(c, day, Math.min(24, Math.floor(x) + 1)) : cumBefore(c, day, x);
    const so = timed + (withUntimed ? cell(c, day, 24) : 0);
    const f = F[c];
    const lv = level(c, day, FC.levelDays);
    let rate;
    if (lv == null) rate = f > 0.05 ? timed / f : timed;
    else {
      const base = lv * weekdayFactor(c, day, dowOf(day));
      const pace = f > 0.03 ? timed / f : base;
      rate = f * pace + (1 - f) * base; // 시간이 지날수록 오늘 페이스 비중 ↑
    }
    const rem = Math.max(0, (1 - f) * rate);
    return { so: so, fc: so + rem, rem: rem };
  }

  // 오늘
  const Fnow = profile(today, t);
  const ch = D.names.map((_, c) => {
    const r = forecast(c, today, t, Fnow, true);
    if (r.manual) {
      // 수기 채널: 마지막 입력일 기준 최근 7일 평균 × 내일 요일 보정
      const ref = lastDay[c] == null ? today : lastDay[c] + 1;
      const lv = level(c, ref, FC.levelDays);
      r.tomorrow = lv == null ? 0 : lv * weekdayFactor(c, ref, dowOf(today + 1));
    } else {
      // 내일: 최근 6일 + 오늘 예측의 평균 × 내일 요일 보정
      const s = Math.max(today - (FC.levelDays - 1), first[c]);
      let sum = r.fc, k = 1;
      if (isFinite(s)) for (let d = s; d < today; d++) { sum += dayTotal(c, d); k++; }
      r.tomorrow = isFinite(first[c]) ? (sum / k) * weekdayFactor(c, today, dowOf(today + 1)) : 0;
    }
    r.yAt = cumBefore(c, today - 1, t);
    r.yTotal = dayTotal(c, today - 1);
    return r;
  });

  // 과거 14일 같은 시각으로 같은 예측을 해서 오차 측정
  const bt = [];
  for (let k = 1; k <= FC.backtestDays; k++) {
    const day = today - k, F = profile(day, t);
    bt.push({
      fc: D.names.map((_, c) => forecast(c, day, t, F, false).fc),
      act: D.names.map((_, c) => dayTotal(c, day))
    });
  }

  function rowStats(chs) {
    const sum = key => chs.reduce((a, c) => a + ch[c][key], 0);
    let es = 0, en = 0;
    bt.forEach(b => {
      let f = 0, a = 0;
      chs.forEach(c => { f += b.fc[c]; a += b.act[c]; });
      if (a >= 5) { es += Math.abs(f - a) / a; en++; }
    });
    return { so: sum('so'), fc: sum('fc'), rem: sum('rem'), tomorrow: sum('tomorrow'), yAt: sum('yAt'), yTotal: sum('yTotal'), err: en >= 3 ? es / en : null };
  }

  // 차트용 누적 곡선
  const Fgrid = [];
  for (let h = 0; h <= 24; h++) Fgrid.push(profile(today, h));
  function curves(chs) {
    const actual = [], path = [], yest = [], avg4 = [];
    const so = chs.reduce((a, c) => a + ch[c].so, 0);
    for (let h = 0; h <= 24; h++) {
      yest.push({ x: h, y: chs.reduce((a, c) => a + cumBefore(c, today - 1, h), 0) });
      let s4 = 0; for (let w = 1; w <= 4; w++) s4 += chs.reduce((a, c) => a + cumBefore(c, today - 7 * w, h), 0);
      avg4.push({ x: h, y: s4 / 4 });
      if (h <= t) actual.push({ x: h, y: chs.reduce((a, c) => a + cumBefore(c, today, h), 0) });
    }
    actual.push({ x: t, y: so });
    path.push({ x: t, y: so });
    for (let h = Math.ceil(t); h <= 24; h++) {
      if (h <= t) continue;
      let y = so;
      chs.forEach(c => {
        const f0 = Fnow[c], f1 = Fgrid[h][c];
        y += ch[c].rem * (1 - f0 > 1e-6 ? clamp((f1 - f0) / (1 - f0), 0, 1) : 1);
      });
      path.push({ x: h, y: y });
    }
    return { actual, path, yest, avg4 };
  }

  return { today, t, Fnow, ch, rowStats, curves, manualChs: D.names.filter((n, c) => !realtime[c] && lastDay[c] != null) };
}

function renderLive() {
  const L = buildLive();
  const rows = D.hier.map(r => Object.assign({}, r, { st: L.rowStats(r.ch) }));
  const all = rows[0].st;
  const remainMin = Math.round((24 - L.t) * 60);
  const shareDone = D.names.reduce((a, _, c) => a + L.Fnow[c] * L.ch[c].fc, 0) / Math.max(1, all.fc);

  $('liveMeta').textContent = fmtDay(L.today) + ' (' + DOW[dowOf(L.today)] + ') ' + D.asOf.label + ' 기준, 마감까지 ' +
    Math.floor(remainMin / 60) + '시간 ' + (remainMin % 60) + '분 남음';

  const range = all.err != null ? ` (예상 범위 ${fmt(Math.max(all.so, all.fc * (1 - all.err)))}~${fmt(all.fc * (1 + all.err))}건)` : '';
  $('liveLead').innerHTML =
    `${D.asOf.label} 현재 <b>${fmt(all.so)}건</b>이 들어왔어요. 평소 이 시각이면 하루 DB의 약 ${Math.round(shareDone * 100)}%가 들어오는 시점이라, ` +
    `자정까지 <b>${fmt(all.rem)}건</b> 정도 더 들어와 <b class="hl">${fmt(all.fc)}건</b>으로 마감할 것으로 보여요${range}. ` +
    `내일(${DOW[dowOf(L.today + 1)]})은 <b>${fmt(all.tomorrow)}건</b> 정도로 예상돼요.` +
    (L.manualChs.length ? ` <span class="dim">(수기 입력 채널 ${L.manualChs.join(', ')}은 다음 날 입력되므로, 오늘·내일은 최근 입력 평균으로 예측에 포함했어요.)</span>` : '');

  const delta = (a, b) => {
    if (!b) return '';
    const v = (a - b) / b * 100;
    return `<span class="delta ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${v.toFixed(0)}%</span>`;
  };
  $('liveTable').innerHTML =
    '<thead><tr><th>구분</th><th>현재</th><th class="prog">진행</th><th>오늘 예측</th><th class="x">예상 범위</th><th class="x">남은 예상</th><th class="x">어제 같은 시각</th><th class="x">어제 마감</th><th>내일 예측</th></tr></thead><tbody>' +
    rows.filter(r => !r.parent || S.open.has(r.parent)).map(r => {
      const s = r.st;
      const rg = s.err != null ? `${fmt(Math.max(s.so, s.fc * (1 - s.err)))}~${fmt(s.fc * (1 + s.err))}` : '-';
      const dot = r.color ? `<i style="background:${r.color}"></i>` : '';
      const isOpen = S.open.has(r.key);
      const caret = r.kids ? `<span class="caret${isOpen ? ' open' : ''}" aria-hidden="true">▸</span>` : '';
      return `<tr class="lv${r.lv}${r.key === S.liveKey ? ' sel' : ''}${r.kids ? ' parent' : ''}" data-key="${esc(r.key)}"` +
        (r.kids ? ` data-kids="1" aria-expanded="${isOpen}" title="눌러서 채널 ${isOpen ? '접기' : '펼치기'}"` : '') + '>' +
        `<td class="name">${caret}${dot}${esc(r.name)}</td>` +
        `<td>${fmt(s.so)}<span class="m">어제 ${fmt(s.yAt)}${delta(s.so, s.yAt)}</span></td>` +
        `<td class="prog"><div><span style="width:${s.fc ? clamp(s.so / s.fc * 100, 0, 100).toFixed(0) : 0}%"></span></div></td>` +
        `<td class="fc">${fmt(s.fc)}<span class="m">${rg === '-' ? '' : rg}</span></td>` +
        `<td class="dim x" title="${s.err != null ? '최근 14일 같은 시각 예측의 평균 오차 ±' + (s.err * 100).toFixed(0) + '%' : '데이터가 부족해 범위를 계산하지 않았어요'}">${rg}</td>` +
        `<td class="x">+${fmt(s.rem)}</td>` +
        `<td class="x">${fmt(s.yAt)}${delta(s.so, s.yAt)}</td>` +
        `<td class="dim x">${fmt(s.yTotal)}</td>` +
        `<td>${fmt(s.tomorrow)}<span class="m">어제 마감 ${fmt(s.yTotal)}</span></td></tr>`;
    }).join('') + '</tbody>';

  const sel = rows.find(r => r.key === S.liveKey) || rows[0];
  $('liveChartTitle').textContent = sel.name + ' 시간대별 누적';
  const cv = L.curves(sel.ch);
  const nowLine = {
    id: 'nowLine',
    afterDatasetsDraw(chart) {
      const x = chart.scales.x.getPixelForValue(L.t), a = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = '#18212E'; ctx.globalAlpha = 0.35; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
      ctx.globalAlpha = 0.8; ctx.setLineDash([]); ctx.fillStyle = '#18212E'; ctx.font = '600 11px Pretendard, sans-serif';
      ctx.fillText('지금 ' + D.asOf.label, Math.min(x + 4, a.right - 64), a.top + 12); ctx.restore();
    }
  };
  draw('liveChart', {
    type: 'line',
    data: {
      datasets: [
        { label: '오늘 실적', data: cv.actual, borderColor: '#18212E', borderWidth: 2.5, pointRadius: 0, tension: 0 },
        { label: '오늘 예측', data: cv.path, borderColor: '#2F5BD3', borderWidth: 2.5, borderDash: [6, 4], pointRadius: 0, tension: 0.2 },
        { label: '어제', data: cv.yest, borderColor: '#A3AEBD', borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
        { label: '최근 4주 같은 요일 평균', data: cv.avg4, borderColor: '#D3DAE3', borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, tension: 0.2 }
      ]
    },
    options: {
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: 24, ticks: { stepSize: 3, callback: v => v + '시' }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } }
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 14, boxHeight: 2, padding: 14 } },
        tooltip: { callbacks: { title: i => { const x = i[0].parsed.x; return Math.floor(x) + ':' + pad(Math.round((x % 1) * 60)) + ' 까지'; }, label: c => ' ' + c.dataset.label + ': ' + fmt(c.parsed.y) + '건' } }
      }
    },
    plugins: [nowLine]
  });
}

/* =========================================================
 * 기간 분석 (필터 적용)
 * ========================================================= */
function render() {
  const A = D.A, ns = D.names.length, days = S.to - S.from + 1;
  const dayBySrc = Array.from({ length: ns }, () => new Float64Array(days));
  const hourC = new Array(24).fill(0), dowC = new Array(7).fill(0);
  const dimC = new Map();
  let total = 0, dupSeen = 0, noTime = 0;

  for (let i = 0; i < D.n; i++) {
    const d = A.day[i];
    if (d < S.from || d > S.to) continue;
    const s = A.src[i];
    if (!S.src.has(s)) continue;
    if (A.dup[i]) { dupSeen++; if (S.dedupe) continue; }
    total++;
    dayBySrc[s][d - S.from]++;
    const h = A.hour[i];
    if (h >= 0) hourC[h]++; else noTime++;
    dowC[dowOf(d)]++;
    let k;
    if (S.dim === 'source') k = s;
    else if (S.dim === 'group') k = D.groupOf[s];
    else if (S.dim === 'note') k = A.note[i];
    else if (S.dim === 'platform') { k = A.plat[i]; if (k < 0) continue; }
    else { k = A.camp[i]; if (k < 0) continue; }
    dimC.set(k, (dimC.get(k) || 0) + 1);
  }

  $('empty').style.display = total ? 'none' : 'block';
  renderKpis(total, days, hourC, dowC, dupSeen);
  renderTrend(dayBySrc);
  renderSpendTrend(dayBySrc);
  renderDaily(dayBySrc);
  renderDow(dowC, total);
  renderHour(hourC, noTime);
  renderShare(dimC);
  renderHourCompare();
}

function argmax(arr) { let m = -1, k = -1; arr.forEach((v, i) => { if (v > m) { m = v; k = i; } }); return k; }

function renderKpis(total, days, hourC, dowC, dupSeen) {
  $('kTotal').textContent = fmt(total);
  $('kTotalN').textContent = fmtDay(S.from) + ' ~ ' + fmtDay(S.to);
  $('kAvg').textContent = (total / days).toFixed(1);
  $('kAvgN').textContent = days + '일 기준';
  const hTotal = hourC.reduce((a, b) => a + b, 0);
  const ph = argmax(hourC), pd = argmax(dowC);
  $('kHour').textContent = hTotal ? ph + '시' : '-';
  $('kHourN').textContent = hTotal ? '전체의 ' + pct(hourC[ph], hTotal) : '';
  $('kDow').textContent = total ? DOW[pd] + '요일' : '-';
  $('kDowN').textContent = total ? '전체의 ' + pct(dowC[pd], total) : '';
  $('kDup').textContent = fmt(dupSeen);
  $('kDupN').textContent = S.dedupe ? '집계에서 제외됨' : '집계에 포함됨, 비율 ' + pct(dupSeen, total);
}

function draw(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), cfg);
}

function renderTrend(dayBySrc) {
  const labels = [], titles = [], bucketOfDay = [], index = new Map();
  for (let d = S.from; d <= S.to; d++) {
    const t = new Date(d * 864e5), y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, dd = t.getUTCDate();
    let k, lab, tit;
    if (S.trend === 'day') { k = d; lab = m + '/' + dd; tit = fmtDay(d) + ' (' + DOW[dowOf(d)] + ')'; }
    else if (S.trend === 'week') {
      k = d - dowOf(d);
      const w = new Date(k * 864e5);
      lab = (w.getUTCMonth() + 1) + '/' + w.getUTCDate() + '주';
      tit = fmtDay(k) + ' ~ ' + fmtDay(k + 6) + ' (월~일)';
    } else { k = y * 12 + m; lab = y + '.' + pad(m); tit = y + '년 ' + m + '월'; }
    if (!index.has(k)) { index.set(k, labels.length); labels.push(lab); titles.push(tit); }
    bucketOfDay.push(index.get(k));
  }
  const bucket = chs => {
    const arr = new Array(labels.length).fill(0);
    chs.forEach(s => { const src = dayBySrc[s]; for (let j = 0; j < src.length; j++) arr[bucketOfDay[j]] += src[j]; });
    return arr;
  };
  const bar = { stack: 'a', borderRadius: 2, maxBarThickness: 48 };
  let datasets;
  if (S.stack === 'group') {
    datasets = D.groups.map(g => ({ g, chs: g.idx.filter(c => S.src.has(c)) })).filter(x => x.chs.length)
      .map(x => Object.assign({ label: x.g.name, data: bucket(x.chs), backgroundColor: x.g.color }, bar));
  } else {
    datasets = D.groups.flatMap(g => g.idx).filter(c => S.src.has(c))
      .map(c => Object.assign({ label: D.names[c], data: bucket([c]), backgroundColor: chColor(c) }, bar));
  }

  const names = { day: '일별', week: '주간', month: '월별' };
  $('trendTitle').textContent = names[S.trend] + ' 유입 추이';
  $('trendNote').textContent = S.trend === 'week' ? '주는 월요일 시작 기준이며, 기간 양 끝의 주는 일부 일자만 포함될 수 있어요.'
    : S.trend === 'month' ? '기간 양 끝의 월은 선택한 일자만 포함됩니다.' : '';

  // 막대 위 라벨용: 구간별 DB 합계, 광고비, CPA(광고비가 있는 날·채널의 DB 기준)
  const selCh = D.groups.flatMap(g => g.idx).filter(c => S.src.has(c));
  const nb = labels.length;
  const bDb = new Array(nb).fill(0), bSp = new Array(nb).fill(0), bMdb = new Array(nb).fill(0);
  selCh.forEach(c => {
    const src = dayBySrc[c];
    for (let j = 0; j < src.length; j++) {
      const b = bucketOfDay[j], n = src[j];
      bDb[b] += n;
      const v = D.spendCh && D.spendCh[c] && D.spendCh[c].get(S.from + j);
      if (v) { bSp[b] += v; bMdb[b] += n; }
    }
  });
  const bCpa = bSp.map((v, i) => v && bMdb[i] ? v / bMdb[i] : 0);
  const man = v => v >= 1e4 ? (v / 1e4).toFixed(v >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '만' : fmt(v);
  const barLabels = {
    id: 'barLabels',
    afterDatasetsDraw(chart) {
      const xs = chart.scales.x, ys = chart.scales.y, ctx = chart.ctx;
      const w = nb > 1 ? Math.abs(xs.getPixelForValue(1) - xs.getPixelForValue(0)) : chart.chartArea.width;
      const mode = w >= 60 ? 3 : w >= 30 ? 2 : w >= 18 ? 1 : 0;
      if (!mode) return;
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (let i = 0; i < nb; i++) {
        if (!bDb[i]) continue;
        const x = xs.getPixelForValue(i);
        let y = ys.getPixelForValue(bDb[i]) - 4;
        const lines = [];
        if (mode >= 3 && bCpa[i]) lines.push(['CPA ' + fmt(bCpa[i]), '500 10.5px', '#2F5BD3']);
        else if (mode === 2 && bCpa[i]) lines.push([man(bCpa[i]), '500 10px', '#2F5BD3']);
        if (mode >= 3 && bSp[i]) lines.push([wonShort(bSp[i]) + '원', '400 10.5px', '#5D6878']);
        lines.push([fmt(bDb[i]), '700 ' + (mode >= 2 ? 12 : 10.5) + 'px', '#18212E']);
        lines.forEach(([txt, font, color]) => {
          ctx.font = font + ' "Pretendard Variable", Pretendard, sans-serif';
          ctx.fillStyle = color; ctx.fillText(txt, x, y);
          y -= parseFloat(font.split(' ')[1]) + 3;
        });
      }
      ctx.restore();
    }
  };
  const hasCpa = bCpa.some(v => v > 0);
  // 막대 위 라벨이 잘리지 않도록, 예상되는 줄 수만큼 위쪽 여백을 픽셀로 확보
  const estW = Math.max(0, ($('trendChart').parentNode.clientWidth || 800) - 60) / Math.max(1, nb);
  const estMode = estW >= 60 ? 3 : estW >= 30 ? 2 : estW >= 18 ? 1 : 0;
  const lines = !estMode ? 0 : !hasCpa ? 1 : estMode >= 3 ? 3 : estMode === 2 ? 2 : 1;
  const topPad = lines ? 10 + lines * 15 : 4;

  draw('trendChart', {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    plugins: [barLabels],
    options: {
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: topPad } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 16, maxRotation: 0 } },
        y: { stacked: true, beginAtZero: true, grace: '4%', ticks: { precision: 0 } }
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12 } },
        tooltip: {
          filter: c => c.raw > 0,
          callbacks: {
            title: items => titles[items[0].dataIndex],
            label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + '건',
            footer: items => { const i = items[0].dataIndex; return ['합계 ' + fmt(bDb[i]) + '건'].concat(bSp[i] ? ['광고비 ' + fmt(bSp[i]) + '원', 'CPA ' + (bCpa[i] ? fmt(bCpa[i]) + '원' : '-')] : []); }
          }
        }
      }
    }
  });
  $('trendNote').textContent = ($('trendNote').textContent ? $('trendNote').textContent + ' ' : '') +
    (hasCpa ? '막대 위 숫자는 DB 수, 광고비, CPA예요. 막대가 좁으면 DB 수와 CPA(만원 단위)만, 더 좁으면 DB 수만 보여요.' : '막대 위 숫자는 DB 수예요.');
}

function barColors(arr) {
  const k = argmax(arr), has = arr.some(v => v > 0);
  return arr.map((v, i) => has && i === k ? '#2F5BD3' : '#A9BDEE');
}

function renderDow(dowC, total) {
  $('dowNote').textContent = '월~일, 선택 기간 합계';
  draw('dowChart', {
    type: 'bar',
    data: { labels: DOW, datasets: [{ data: dowC, backgroundColor: barColors(dowC), borderRadius: 3, maxBarThickness: 44 }] },
    options: {
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { tooltip: { callbacks: { title: i => i[0].label + '요일', label: c => ' ' + fmt(c.raw) + '건 (' + pct(c.raw, total) + ')' } } }
    }
  });
}

function renderHour(hourC, noTime) {
  const hTotal = hourC.reduce((a, b) => a + b, 0);
  const t = D.asOf.t, fl = Math.floor(t);
  // 현재 시각 이후(남은 시간)에 들어오는 비율: 현재 시간대는 남은 분만큼만 반영
  const remCount = hourC.reduce((a, v, h) => a + (h > fl ? v : h === fl ? v * (fl + 1 - t) : 0), 0);
  const remPct = hTotal ? remCount / hTotal * 100 : 0;
  const remMin = Math.round((24 - t) * 60);
  const remLabel = (remMin >= 60 ? Math.floor(remMin / 60) + '시간 ' : '') + (remMin % 60) + '분';
  const peak = argmax(hourC);
  $('hourNote').textContent = (noTime ? '시간 정보 없는 ' + fmt(noTime) + '건 제외, ' : '') + '선택 기간 합계 기준';

  const colors = hourC.map((_, h) => h > fl ? '#2F5BD3' : h === fl ? '#7D9AE8' : '#C9D5F3');
  const nowMark = {
    id: 'nowMark',
    afterDatasetsDraw(chart) {
      if (!hTotal) return;
      const xs = chart.scales.x, a = chart.chartArea, ctx = chart.ctx;
      const step = xs.getPixelForValue(1) - xs.getPixelForValue(0);
      const x = xs.getPixelForValue(fl) + (t - fl - 0.5) * step;
      ctx.save();
      ctx.strokeStyle = '#18212E'; ctx.globalAlpha = 0.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      const l1 = '지금 ' + D.asOf.label + ' 이후', l2 = '하루의 ' + remPct.toFixed(1) + '%';
      ctx.font = '600 13px Pretendard, sans-serif';
      const w = Math.max(ctx.measureText(l2).width, (ctx.font = '500 11px Pretendard, sans-serif', ctx.measureText(l1).width)) + 16;
      let bx = x - w - 6; if (bx < a.left) bx = Math.min(x + 6, a.right - w);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.strokeStyle = '#2F5BD3'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, a.top + 2, w, 40, 6) : ctx.rect(bx, a.top + 2, w, 40); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5D6878'; ctx.font = '500 11px Pretendard, sans-serif'; ctx.fillText(l1, bx + 8, a.top + 18);
      ctx.fillStyle = '#2F5BD3'; ctx.font = '700 13px Pretendard, sans-serif'; ctx.fillText(l2, bx + 8, a.top + 35);
      ctx.restore();
    }
  };
  draw('hourChart', {
    type: 'bar',
    data: {
      labels: hourC.map((_, h) => h + '시'),
      datasets: [{ data: hourC, backgroundColor: colors, borderRadius: 2}]
    },
    options: {
      layout: { padding: { top: 6 } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { beginAtZero: true, grace: '18%', ticks: { precision: 0 } } },
      plugins: {
        tooltip: {
          callbacks: {
            title: i => i[0].dataIndex + ':00 ~ ' + i[0].dataIndex + ':59' + (i[0].dataIndex === peak ? ' (피크)' : ''),
            label: c => ' ' + fmt(c.raw) + '건 (' + pct(c.raw, hTotal) + ')',
            footer: i => { const h = i[0].dataIndex; return h + '시~24시 합계 ' + pct(hourC.slice(h).reduce((a, b) => a + b, 0), hTotal); }
          }
        }
      }
    },
    plugins: [nowMark]
  });
  $('hourSummary').innerHTML = hTotal
    ? `${D.asOf.label} 기준 마감까지 남은 <b>${remLabel}</b> 동안 평소 하루 DB의 <b class="hl">${remPct.toFixed(1)}%</b>가 들어와요. 지금까지의 시간대가 ${(100 - remPct).toFixed(1)}%를 차지합니다.`
    : '';
}

function dimName(k) {
  if (S.dim === 'source') return D.names[k];
  if (S.dim === 'group') return k < 0 ? '(그룹 없음)' : D.groups[k].name;
  if (S.dim === 'note') return k < 0 ? '(비고 없음)' : D.notes[k];
  if (S.dim === 'platform') { const p = D.platforms[k]; return PLATFORM_NAMES[p] || p; }
  return D.campaigns[k];
}

function renderShare(dimC) {
  const items = [...dimC.entries()].sort((a, b) => b[1] - a[1]);
  const sum = items.reduce((a, x) => a + x[1], 0);
  const colorOf = (k, rank) => S.dim === 'source' ? chColor(k)
    : S.dim === 'group' ? (k >= 0 ? D.groups[k].color : OTHER)
    : (S.dim === 'note' && k < 0) ? OTHER : (rank < TOP_N ? RANK_COLORS[rank] : OTHER);

  const top = items.slice(0, TOP_N);
  const rest = items.slice(TOP_N).reduce((a, x) => a + x[1], 0);
  const labels = top.map(x => dimName(x[0])), data = top.map(x => x[1]), colors = top.map((x, r) => colorOf(x[0], r));
  if (rest > 0) { labels.push('기타 ' + (items.length - TOP_N) + '개'); data.push(rest); colors.push(OTHER); }

  draw('shareChart', {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] },
    options: { cutout: '60%', plugins: { tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) + '건 (' + pct(c.raw, sum) + ')' } } } }
  });

  const max = items.length ? items[0][1] : 1;
  const sub = k => S.dim === 'group' && k >= 0 ? ` <span class="note">${esc(D.groups[k].idx.map(c => D.names[c]).join(', '))}</span>` : '';
  $('shareTable').innerHTML = '<thead><tr><th>항목</th><th>건수</th><th>비율</th><th class="bar"></th></tr></thead><tbody>' +
    (items.length ? items.map((x, r) => {
      const c = colorOf(x[0], r);
      return `<tr><td class="name"><i style="background:${c}"></i>${esc(dimName(x[0]))}${sub(x[0])}</td><td>${fmt(x[1])}</td><td>${pct(x[1], sum)}</td>` +
        `<td class="bar"><div><span style="width:${(x[1] / max * 100).toFixed(1)}%;background:${c}"></span></div></td></tr>`;
    }).join('') : '<tr><td colspan="4" class="note">표시할 항목이 없습니다.</td></tr>') + '</tbody>';

  const notes = {
    source: '선택한 채널 기준 비율입니다.',
    group: D.groups.filter(g => g.idx.length).map(g => g.name + '(' + g.idx.map(c => D.names[c]).join(', ') + ')').join(', ') + ' 기준입니다.',
    note: '비고 칸의 값 그대로 묶었습니다. 표기가 조금만 달라도 별도 항목으로 잡혀요.',
    platform: 'META 광고 컬럼(platform)이 있는 탭만 해당합니다.',
    campaign: 'META 광고 컬럼(campaign_name)이 있는 탭만 해당합니다.'
  };
  $('shareNote').textContent = notes[S.dim] + ' 합계 ' + fmt(sum) + '건, 항목 ' + items.length + '개.';
}

function renderReport() {
  $('reportTable').innerHTML = '<thead><tr><th>채널</th><th>그룹</th><th>인식</th><th>날짜 인식 실패</th><th>시간 없음</th><th>중복 연락처</th></tr></thead><tbody>' +
    D.report.map(r => {
      const c = D.sources.indexOf(r.name), g = c >= 0 ? D.groups[D.groupOf[c]] : null;
      const auto = r.manual ? ' (수동 입력)' : (c >= 0 && !CHANNEL_COLORS[D.names[c]] ? ' (자동 인식)' : '') + (r.manualRows ? ' + 수동 ' + fmt(r.manualRows) + '건' : '');
      return `<tr><td>${esc(shortName(r.name))}${r.missing ? ' (탭 없음)' : ''}${auto}</td><td>${g ? esc(g.name) : '-'}</td><td>${fmt(r.rows)}</td><td>${fmt(r.skipped)}</td><td>${fmt(r.noTime)}</td><td>${fmt(r.dup)}</td></tr>`;
    }).join('') + '</tbody>';
}


/* =========================================================
 * 시간대별 유입률 · 어제 증감 비교 (채널 필터 적용, 기간은 어제 기준 고정)
 * ========================================================= */
const BASES = {
  all: { name: '전체', color: '#A3AEBD' },
  month: { name: '한달', color: '#86A2F2' },
  week: { name: '주간', color: '#2F5BD3' },
  y: { name: '어제', color: '#E2612E' },
  yy: { name: '전전일', color: '#8C5A3C' }
};
const CMP_NAMES = { month: '한달 평균', week: '주간 평균', yy: '전전일' };

function hourBases() {
  const Y = D.asOf.day - 1, A = D.A;
  const win = { all: [D.min, Y], month: [Y - 30, Y - 1], week: [Y - 7, Y - 1], y: [Y, Y], yy: [Y - 1, Y - 1] };
  const keys = Object.keys(win), cnt = {}, tot = {}, days = {}, share = {};
  keys.forEach(k => { cnt[k] = new Array(24).fill(0); });
  for (let i = 0; i < D.n; i++) {
    const h = A.hour[i]; if (h < 0) continue;
    if (!S.src.has(A.src[i])) continue;
    if (S.dedupe && A.dup[i]) continue;
    const d = A.day[i]; if (d > Y) continue;
    for (const k of keys) if (d >= win[k][0] && d <= win[k][1]) cnt[k][h]++;
  }
  keys.forEach(k => {
    tot[k] = cnt[k].reduce((a, b) => a + b, 0);
    days[k] = Math.max(1, win[k][1] - Math.max(win[k][0], D.min) + 1);
    share[k] = cnt[k].map(v => tot[k] ? v / tot[k] * 100 : null);
  });
  return { Y, win, cnt, tot, days, share };
}

function heatCell(v, maxAbs, txt, rgb) {
  if (v == null || !isFinite(v)) return '<td class="hc">-</td>';
  const a = maxAbs ? Math.min(1, Math.abs(v) / maxAbs) * 0.82 + 0.06 : 0.06;
  const col = rgb || (v >= 0 ? '14,143,114' : '194,65,58');
  return `<td class="hc" style="background:rgba(${col},${a.toFixed(2)});color:${a > 0.5 ? '#fff' : 'var(--ink)'}">${txt}</td>`;
}

function renderHourCompare() {
  const B = hourBases();
  const yLabel = fmtDay(B.Y).slice(5) + ' ' + DOW[dowOf(B.Y)];
  const hours = [...Array(24).keys()];
  const hdr = '<thead><tr><th>기준</th>' + hours.map(h => `<th>${h}시</th>`).join('') + '</tr></thead>';

  /* ---- 유입률 ---- */
  $('rateNote').textContent = `어제(${yLabel}) 기준, 한달·주간은 어제를 뺀 직전 30일·7일`;
  draw('rateChart', {
    type: 'line',
    data: {
      labels: hours.map(h => h + '시'),
      datasets: ['all', 'month', 'week', 'y'].map(k => ({
        label: BASES[k].name + (k === 'y' ? '' : ''), data: B.share[k], borderColor: BASES[k].color, backgroundColor: BASES[k].color,
        borderWidth: k === 'y' ? 3 : 1.8, borderDash: k === 'all' ? [4, 3] : [], pointRadius: 0, pointHoverRadius: 4, tension: 0.25
      }))
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { beginAtZero: true, ticks: { callback: v => v + '%' } } },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 14, boxHeight: 2, padding: 14 } },
        tooltip: { callbacks: { title: i => i[0].dataIndex + ':00 ~ ' + i[0].dataIndex + ':59', label: c => ' ' + c.dataset.label + ': ' + (c.raw == null ? '-' : c.raw.toFixed(1) + '%') } }
      }
    }
  });
  $('rateStrip').innerHTML = hdr + '<tbody>' + ['all', 'month', 'week', 'y'].map(k => {
    const vals = B.share[k].filter(v => v != null), mn = Math.min(...vals), mx = Math.max(...vals);
    return `<tr><th><i style="background:${BASES[k].color}"></i>${BASES[k].name}<span class="sub">${fmt(B.tot[k])}건</span></th>` +
      B.share[k].map(v => heatCell(v == null ? null : v - mn, mx - mn, v == null ? '-' : v.toFixed(1), '47,91,211')).join('') + '</tr>';
  }).join('') + '</tbody>';

  /* ---- 어제 증감 ---- */
  const isShare = S.cmpMetric === 'share';
  const diffOf = (base, h) => {
    if (isShare) { const a = B.share.y[h], b = B.share[base][h]; return a == null || b == null ? null : a - b; }
    const avg = B.cnt[base][h] / B.days[base];
    return avg > 0 ? (B.cnt.y[h] - avg) / avg * 100 : null;
  };
  const unit = isShare ? '%p' : '%';
  const sign = v => (Math.abs(v) < 0.05 ? '' : v > 0 ? '+' : '') + (Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1));
  const diffs = hours.map(h => diffOf(S.cmpBase, h));
  const baseAvgDay = B.tot[S.cmpBase] / B.days[S.cmpBase];

  const valid = hours.filter(h => diffs[h] != null);
  const ups = valid.filter(h => diffs[h] > 0).sort((a, b) => diffs[b] - diffs[a]).slice(0, 3);
  const downs = valid.filter(h => diffs[h] < 0).sort((a, b) => diffs[a] - diffs[b]).slice(0, 3);
  const list = arr => arr.map(h => `${h}시 <b class="${diffs[h] >= 0 ? 'up' : 'down'}">${sign(diffs[h])}${unit}</b>`).join(', ');
  const volDiff = baseAvgDay ? (B.tot.y - baseAvgDay) / baseAvgDay * 100 : null;
  const what = isShare ? '유입 비중이' : '유입 건수가';
  $('cmpLead').innerHTML = !B.tot.y ? '어제 데이터가 없어요.' :
    `어제(${yLabel})는 총 <b>${fmt(B.tot.y)}건</b>으로 ${CMP_NAMES[S.cmpBase]}(${fmt(baseAvgDay)}건)보다 ` +
    (volDiff == null ? '' : `<b class="${volDiff >= 0 ? 'up' : 'down'}">${sign(volDiff)}%</b> ${volDiff >= 0 ? '많았어요' : '적었어요'}. `) +
    (ups.length ? `${what} 늘어난 시간대는 ${list(ups)}` : `${what} 늘어난 시간대는 없고`) +
    (downs.length ? `${ups.length ? '이고, ' : ', '}줄어든 시간대는 ${list(downs)}예요.` : '예요.');

  draw('cmpChart', {
    type: 'bar',
    data: { labels: hours.map(h => h + '시'), datasets: [{ data: diffs, backgroundColor: diffs.map(v => v == null ? OTHER : v >= 0 ? '#0E8F72' : '#C2413A'), borderRadius: 2 }] },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { ticks: { callback: v => (v > 0 ? '+' : '') + v + unit }, grid: { color: c => c.tick.value === 0 ? '#9AA5B4' : '#E7ECF2' } }
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: i => i[0].dataIndex + ':00 ~ ' + i[0].dataIndex + ':59',
            label: c => {
              const h = c.dataIndex;
              if (c.raw == null) return ' 비교할 데이터가 없어요';
              return isShare
                ? [` 어제 ${B.share.y[h].toFixed(1)}%, ${CMP_NAMES[S.cmpBase]} ${B.share[S.cmpBase][h].toFixed(1)}%`, ` 차이 ${sign(c.raw)}%p`]
                : [` 어제 ${fmt(B.cnt.y[h])}건, ${CMP_NAMES[S.cmpBase]} ${(B.cnt[S.cmpBase][h] / B.days[S.cmpBase]).toFixed(1)}건`, ` 증감 ${sign(c.raw)}%`];
            }
          }
        }
      }
    }
  });

  const all3 = ['month', 'week', 'yy'].map(k => hours.map(h => diffOf(k, h)));
  const cap = isShare ? 2 : 60; // 색 농도 기준 (이 이상이면 가장 진하게)
  const maxAbs = Math.min(cap, Math.max(0.1, ...all3.flat().filter(v => v != null).map(Math.abs)));
  $('cmpStrip').innerHTML = hdr.replace('기준', '어제 대비') + '<tbody>' + ['month', 'week', 'yy'].map((k, r) =>
    `<tr data-base="${k}" class="${k === S.cmpBase ? 'sel' : ''}"><th>${CMP_NAMES[k]}</th>` +
    all3[r].map(v => heatCell(v, maxAbs, v == null ? '-' : isShare ? sign(v) : (Math.round(v) > 0 ? '+' : '') + Math.round(v))).join('') + '</tr>'
  ).join('') + '</tbody>';
  $('cmpNote').textContent = isShare
    ? '유입 비중 차이(%p): 하루 중 그 시간대가 차지하는 비율이 비교 기준보다 몇 %p 높거나 낮은지예요. 전체 양과 상관없이 패턴 변화만 봅니다.'
    : '건수 증감(%): 어제 그 시간대 건수가 비교 기준의 하루 평균 건수보다 몇 % 많거나 적은지예요. 새벽처럼 건수가 적은 시간대는 변동이 크게 나올 수 있어요.';
}


/* =========================================================
 * 2페이지: 순위
 * ========================================================= */
function buildRankTarget() {
  if (!D.hier.some(r => r.key === S.rankKey)) S.rankKey = 'all';
  $('rankTarget').innerHTML = D.hier.map(r =>
    `<option value="${esc(r.key)}"${r.key === S.rankKey ? ' selected' : ''}>${'\u00A0\u00A0\u00A0'.repeat(r.lv)}${esc(r.name)}</option>`).join('');
}

function renderRank() {
  if (!D || S.page !== 'rank') return;
  $('dedupe2').checked = S.dedupe;
  const row = D.hier.find(r => r.key === S.rankKey) || D.hier[0];
  const chs = new Set(row.ch);

  // 막대 구성: 전체·주력군 → 팀, 팀·지원군 → 채널, 채널 → 자기 자신
  let parts;
  const teams = D.groups.filter(g => g.idx.some(c => chs.has(c)));
  if ((row.lv === 0 || row.lv === 1) && teams.length > 1) parts = teams.map(g => ({ name: g.name, color: g.color, ch: g.idx.filter(c => chs.has(c)) }));
  else parts = row.ch.map(c => ({ name: D.names[c], color: chColor(c), ch: [c] }));
  const np = parts.length, partOf = new Map();
  parts.forEach((p, i) => p.ch.forEach(c => partOf.set(c, i)));

  const today = D.asOf.day, tHour = Math.floor(D.asOf.t);
  const curWeek = today - dowOf(today);
  const tt = new Date(today * 864e5), curMonth = tt.getUTCFullYear() * 12 + tt.getUTCMonth() + 1;
  const maps = { day: new Map(), week: new Map(), month: new Map(), hour: new Map() };
  const add = (m, k, p) => { let a = m.get(k); if (!a) { a = new Float64Array(np + 1); m.set(k, a); } a[p]++; a[np]++; };
  const A = D.A;
  let start = Infinity;
  for (let i = 0; i < D.n; i++) {
    const c = A.src[i];
    if (!chs.has(c)) continue;
    if (S.dedupe && A.dup[i]) continue;
    const d = A.day[i], p = partOf.get(c);
    if (d < start) start = d;
    add(maps.day, d, p);
    add(maps.week, d - dowOf(d), p);
    const t = new Date(d * 864e5);
    add(maps.month, t.getUTCFullYear() * 12 + t.getUTCMonth() + 1, p);
    if (A.hour[i] >= 0) add(maps.hour, d * 24 + A.hour[i], p);
  }
  if (!isFinite(start)) start = today;

  const types = {
    day: { el: 'rkDay', partial: k => k === today, label: k => fmtDay(k) + ' (' + DOW[dowOf(k)] + ')', unit: '하루', tag: '오늘' },
    week: { el: 'rkWeek', partial: k => k === curWeek, label: k => fmtDay(k) + ' ~ ' + fmtDay(k + 6).slice(5), unit: '주', tag: '이번 주' },
    month: { el: 'rkMonth', partial: k => k === curMonth, label: k => Math.floor((k - 1) / 12) + '년 ' + ((k - 1) % 12 + 1) + '월', unit: '월', tag: '이번 달' },
    hour: { el: 'rkHour', partial: k => k === today * 24 + tHour, label: k => { const d = Math.floor(k / 24); return fmtDay(d) + ' (' + DOW[dowOf(d)] + ') ' + (k % 24) + '시'; }, unit: '시간', tag: '진행 중' }
  };
  // 평균: 진행 중인 기간을 뺀, 시작일부터의 모든 기간(0건 포함)
  const sMonth = (() => { const t = new Date(start * 864e5); return t.getUTCFullYear() * 12 + t.getUTCMonth() + 1; })();
  const periods = {
    day: Math.max(1, today - start),
    week: Math.max(1, (curWeek - (start - dowOf(start))) / 7),
    month: Math.max(1, curMonth - sMonth),
    hour: Math.max(1, (today - start) * 24 + tHour)
  };
  const recs = {};

  Object.keys(types).forEach(type => {
    const T = types[type], m = maps[type];
    let sum = 0; m.forEach((a, k) => { if (!T.partial(k)) sum += a[np]; });
    const avg = sum / periods[type];
    const list = [...m.entries()].sort((x, y) => y[1][np] - x[1][np] || y[0] - x[0]).slice(0, 10);
    const max = list.length ? list[0][1][np] : 1;
    let prevN = null, prevRank = 0;
    recs[type] = list[0] ? { k: list[0][0], n: list[0][1][np], label: T.label(list[0][0]), avg: avg } : null;
    $(T.el).innerHTML = list.length ? list.map(([k, a], i) => {
      const n = a[np];
      const rank = n === prevN ? prevRank : i + 1; prevN = n; prevRank = rank;
      const vs = avg > 0 ? (n - avg) / avg * 100 : null;
      const segs = parts.map((p, j) => a[j] ? `<span style="width:${(a[j] / max * 100).toFixed(2)}%;background:${p.color}" title="${esc(p.name)} ${fmt(a[j])}건"></span>` : '').join('');
      const tip = parts.map((p, j) => p.name + ' ' + fmt(a[j])).join(', ');
      return `<li class="${rank === 1 ? 'top' : ''}" title="${esc(tip)}"><span class="rk">${rank}</span>` +
        `<div class="rb"><div class="rl"><span class="lab">${T.label(k)}</span>${T.partial(k) ? `<span class="tag">${T.tag}</span>` : ''}</div>` +
        `<div class="sbar">${segs}</div></div>` +
        `<div class="rv"><b>${fmt(n)}</b>${vs == null ? '' : `<span class="${vs >= 0 ? 'up' : 'down'}">평균 대비 ${vs >= 0 ? '+' : ''}${vs.toFixed(0)}%</span>`}</div></li>`;
    }).join('') : '<li class="empty-li">데이터가 없어요.</li>';
    $(T.el.replace('rk', 'rk') + 'Note').textContent = `${T.unit} 평균 ${avg >= 10 ? fmt(avg) : avg.toFixed(1)}건`;
  });

  $('rankMeta').textContent = '통계 기간 ' + fmtDay(start) + ' ~ ' + fmtDay(today) + ' (' + fmt(today - start + 1) + '일)';
  const recCard = (title, r) => !r ? '' :
    `<div class="rec"><div class="rec-t">${title}</div><div class="rec-v">${fmt(r.n)}<small>건</small></div><div class="rec-l">${r.label}</div>` +
    `<div class="rec-a">평균 ${r.avg >= 10 ? fmt(r.avg) : r.avg.toFixed(1)}건의 ${(r.n / Math.max(r.avg, 1e-9)).toFixed(1)}배</div></div>`;
  $('records').innerHTML = recCard('역대 최고의 날', recs.day) + recCard('최고의 달', recs.month) + recCard('최고의 주', recs.week) + recCard('최고의 1시간', recs.hour);
  $('rankLegend').innerHTML = parts.length > 1 ? '막대 구성 ' + parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.name)}</span>`).join('') : '';
}


/* =========================================================
 * 광고비 · CPA
 * ========================================================= */
const wonShort = n => n >= 1e8 ? (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억' : n >= 1e4 ? (n / 1e4).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + '만' : fmt(n);
const cpaText = (sp, db) => db > 0 && sp > 0 ? fmt(sp / db) + '원' : '-';

function parseSpend() {
  D.spendCh = D.names.map(() => new Map());
  D.spendOther = new Map(); // DB 탭과 연결되지 않은 채널(미분류 포함): 이름 → Map(day → 금액)
  D.hasSpend = false;
  const raw = D.spend && D.spend.rows ? D.spend.rows.split(';') : [];
  raw.forEach(r => {
    const p = r.split(','); if (p.length < 3) return;
    const day = +p[0], amt = +p[p.length - 1], name = p.slice(1, -1).join(',');
    if (!isFinite(day) || !isFinite(amt)) return;
    D.hasSpend = true;
    const c = D.names.indexOf(name);
    const m = c >= 0 ? D.spendCh[c] : (D.spendOther.get(name) || D.spendOther.set(name, new Map()).get(name));
    m.set(day, (m.get(day) || 0) + amt);
  });
}

function spendSum(chs, d0, d1) {
  let s = 0;
  chs.forEach(c => D.spendCh[c].forEach((v, d) => { if (d >= d0 && d <= d1) s += v; }));
  return s;
}

function renderSpend() {
  if (!D.hasSpend) {
    $('spendLead').innerHTML = '아직 광고비 데이터가 없어요. 시트에 <b>광고비_수동</b>(또는 광고비_구글·메타·틱톡) 탭이 생기면 자동으로 채널별 광고비와 CPA가 표시됩니다.';
    $('spendTable').innerHTML = ''; $('spendWarn').textContent = '';
    return;
  }
  const today = D.asOf.day, nc = D.names.length, A = D.A;
  // 기준일: 광고비가 입력된 가장 최근 날 (오늘은 광고비가 다음 날 입력되므로 제외)
  let B = -Infinity;
  D.spendCh.forEach(m => m.forEach((v, d) => { if (d < today && d > B) B = d; }));
  if (!isFinite(B)) { $('spendLead').innerHTML = '지난 날짜의 광고비가 아직 없어요.'; $('spendTable').innerHTML = ''; return; }
  const bt = new Date(B * 864e5), mStart = B - (bt.getUTCDate() - 1);
  const win = { b: [B, B], p: [B - 1, B - 1], w: [B - 6, B], mo: [mStart, B] };
  const lo = Math.min(B - 6, mStart);

  // 채널·일자별 DB 수
  const dbDay = D.names.map(() => new Map());
  for (let i = 0; i < D.n; i++) {
    if (S.dedupe && A.dup[i]) continue;
    const d = A.day[i]; if (d < lo || d > B) continue;
    const c = A.src[i];
    dbDay[c].set(d, (dbDay[c].get(d) || 0) + 1);
  }
  // 각 채널은 자기 광고비 ÷ 자기 DB, 그룹은 광고비가 있는 날·채널끼리만 합산
  const stat = chs => {
    const o = {};
    for (const k in win) {
      let sp = 0, db = 0, have = 0, days = 0;
      chs.forEach(c => {
        for (let d = win[k][0]; d <= win[k][1]; d++) {
          if (d < D.firstDay[c]) continue;
          days++;
          if (D.spendCh[c].has(d)) { sp += D.spendCh[c].get(d); db += dbDay[c].get(d) || 0; have++; }
        }
      });
      o[k + 'S'] = sp; o[k + 'D'] = db; o[k + 'Cov'] = days ? have / days : 0;
    }
    return o;
  };
  const cpaOf = (s, k) => s[k + 'D'] > 0 && s[k + 'S'] > 0 ? s[k + 'S'] / s[k + 'D'] : 0;
  const cov = (s, k) => s[k + 'Cov'] > 0 && s[k + 'Cov'] < 0.999
    ? `<span class="cov" title="기간 중 광고비가 입력된 날·채널 비율이에요. 입력된 부분의 광고비와 DB로만 계산했어요.">입력 ${Math.round(s[k + 'Cov'] * 100)}%</span>` : '';
  const cpaCell = (s, k) => { const v = cpaOf(s, k); return v ? fmt(v) + '원' + cov(s, k) : '<span class="dim">' + (s[k + 'S'] ? '-' : '미입력') + '</span>'; };
  const delta = (cur, base) => {
    if (!cur || !base) return '';
    const v = (cur - base) / base * 100;
    return `<span class="delta ${v <= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${v.toFixed(0)}%</span>`; // CPA는 낮을수록 좋음
  };
  const rows = D.hier.map(r => Object.assign({}, r, { st: stat(r.ch) }));
  const a = rows[0].st;
  const dayLabel = d => { const t = new Date(d * 864e5); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + '(' + DOW[dowOf(d)] + ')'; };
  const miss = D.names.filter((n, c) => D.firstDay[c] <= B && !D.spendCh[c].has(B));
  const cB = cpaOf(a, 'b'), cP = cpaOf(a, 'p'), cM = cpaOf(a, 'mo');
  $('spendLead').innerHTML =
    (B < today - 1 ? `어제 ${dayLabel(today - 1)} 광고비는 아직 입력 전이라 마지막 입력일 기준으로 보여드려요. ` : '') +
    `<b>${dayLabel(B)}</b> 광고비 <b>${wonShort(a.bS)}원</b>, DB ${fmt(a.bD)}건으로 CPA <b class="hl">${cB ? fmt(cB) + '원' : '-'}</b>` +
    (cB && cP ? `, 전일 대비 <b class="${cB <= cP ? 'up' : 'down'}">${cB >= cP ? '+' : ''}${((cB - cP) / cP * 100).toFixed(0)}%</b>` : '') + '예요. ' +
    (cM ? `당월(${dayLabel(mStart)}~${dayLabel(B)}) 누적 CPA는 <b>${fmt(cM)}원</b>이에요.` : '') +
    (miss.length ? ` <span class="dim">(${dayLabel(B)} 광고비 미입력: ${miss.join(', ')})</span>` : '');

  $('spendTable').innerHTML =
    `<thead><tr><th>구분</th><th>${dayLabel(B)} 광고비</th><th class="xm">DB</th><th>CPA</th><th class="x">전일 CPA</th><th class="xm">7일 CPA</th><th class="x">당월 광고비</th><th>당월 CPA</th></tr></thead><tbody>` +
    rows.filter(r => !r.parent || S.open.has(r.parent)).map(r => {
      const s = r.st;
      const isOpen = S.open.has(r.key);
      const caret = r.kids ? `<span class="caret${isOpen ? ' open' : ''}" aria-hidden="true">▸</span>` : '';
      const dot = r.color ? `<i style="background:${r.color}"></i>` : '';
      return `<tr class="lv${r.lv}${r.kids ? ' parent' : ''}" data-key="${esc(r.key)}"${r.kids ? ' data-kids="1"' : ''}>` +
        `<td class="name">${caret}${dot}${esc(r.name)}</td>` +
        `<td>${s.bS ? wonShort(s.bS) : '<span class="dim">-</span>'}<span class="m">DB ${fmt(s.bD)}건</span></td>` +
        `<td class="xm dim">${fmt(s.bD)}</td>` +
        `<td class="fc">${cpaCell(s, 'b')}${delta(cpaOf(s, 'b'), cpaOf(s, 'p'))}<span class="m">전일 ${cpaOf(s, 'p') ? fmt(cpaOf(s, 'p')) + '원' : '-'}</span></td>` +
        `<td class="x">${cpaCell(s, 'p')}</td>` +
        `<td class="xm">${cpaCell(s, 'w')}</td>` +
        `<td class="x dim">${s.moS ? wonShort(s.moS) : '-'}</td>` +
        `<td>${cpaCell(s, 'mo')}<span class="m">7일 ${cpaOf(s, 'w') ? fmt(cpaOf(s, 'w')) + '원' : '-'}</span></td></tr>`;
    }).join('') + '</tbody>';

  // DB 탭과 연결 안 된 광고비 안내
  const others = [...D.spendOther.entries()].map(([n, m]) => { let t = 0; m.forEach((v, d) => { if (d >= mStart && d <= B) t += v; }); return [n, t]; }).filter(x => x[1] > 0);
  $('spendWarn').textContent = others.length
    ? `당월 광고비 중 대시보드에 DB 탭이 없는 채널: ${others.map(([n, t]) => `${n} ${wonShort(t)}원`).join(', ')}. 대시보드 시트에 GL(${others.map(x => x[0]).join('), GL(')}) 탭이 생기면 CPA가 계산돼요.`
    : '';
  $('spendMeta').textContent = '광고비는 VAT 포함, 전날분까지 입력 기준. 출처 탭: ' + ((D.spend && D.spend.tabs) || []).join(', ');
}

function renderSpendTrend(dayBySrc) {
  const card = $('spendTrendCard');
  card.hidden = !D.hasSpend;
  if (!D.hasSpend) return;
  const labels = [], index = new Map(), bucketOfDay = [];
  for (let d = S.from; d <= S.to; d++) {
    const t = new Date(d * 864e5), y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
    const k = S.trend === 'day' ? d : S.trend === 'week' ? d - dowOf(d) : y * 12 + m;
    const lab = S.trend === 'day' ? m + '/' + t.getUTCDate() : S.trend === 'week' ? (() => { const w = new Date(k * 864e5); return (w.getUTCMonth() + 1) + '/' + w.getUTCDate() + '주'; })() : y + '.' + pad(m);
    if (!index.has(k)) { index.set(k, labels.length); labels.push(lab); }
    bucketOfDay.push(index.get(k));
  }
  const nb = labels.length;
  const spendOf = chs => { const arr = new Array(nb).fill(0); chs.forEach(c => D.spendCh[c].forEach((v, d) => { if (d >= S.from && d <= S.to) arr[bucketOfDay[d - S.from]] += v; })); return arr; };
  const sel = D.groups.flatMap(g => g.idx).filter(c => S.src.has(c));
  const units = S.stack === 'group'
    ? D.groups.map(g => ({ name: g.name, color: g.color, chs: g.idx.filter(c => S.src.has(c)) })).filter(u => u.chs.length)
    : sel.map(c => ({ name: D.names[c], color: chColor(c), chs: [c] }));
  const totS = new Array(nb).fill(0), totD = new Array(nb).fill(0);
  const ds = units.map(u => { const data = spendOf(u.chs); data.forEach((v, i) => totS[i] += v); return { type: 'bar', label: u.name, data: data, backgroundColor: u.color, stack: 's', yAxisID: 'y', borderRadius: 2, maxBarThickness: 48, order: 2 }; });
  sel.forEach(c => { const src = dayBySrc[c]; for (let j = 0; j < src.length; j++) if (D.spendCh[c].has(S.from + j)) totD[bucketOfDay[j]] += src[j]; });
  const cpa = totS.map((v, i) => totD[i] && v ? v / totD[i] : null);
  ds.push({ type: 'line', label: 'CPA', data: cpa, borderColor: '#18212E', backgroundColor: '#18212E', borderWidth: 2, pointRadius: S.trend === 'day' ? 0 : 3, tension: 0.25, yAxisID: 'y1', order: 1, spanGaps: true });
  const sumS = totS.reduce((a, b) => a + b, 0), sumD = totD.reduce((a, b) => a + b, 0);
  $('spendTrendNote').textContent = `선택 기간 광고비 ${wonShort(sumS)}원, 광고비 입력된 날의 DB ${fmt(sumD)}건, 평균 CPA ${cpaText(sumS, sumD)}`;
  draw('spendTrendChart', {
    type: 'bar',
    data: { labels: labels, datasets: ds },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 16, maxRotation: 0 } },
        y: { stacked: true, beginAtZero: true, position: 'left', ticks: { callback: v => wonShort(v) } },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { callback: v => fmt(v) + '원' } }
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12 } },
        tooltip: { filter: c => c.raw != null && c.raw > 0, callbacks: { label: c => ' ' + c.dataset.label + ': ' + (c.dataset.label === 'CPA' ? fmt(c.raw) + '원' : wonShort(c.raw) + '원') } }
      }
    }
  });
}

/* =========================================================
 * 3페이지: 목표
 * ========================================================= */
function goalTargetRow(name) {
  const n = String(name).trim();
  if (n === '전체') return D.hier[0];
  return D.hier.find(r => r.name === n || 'GL(' + r.name + ')' === n) || null;
}

function renderGoal() {
  if (!D || S.page !== 'goal') return;
  buildManualForm();
  const today = D.asOf.day, tt = new Date(today * 864e5);
  const y = tt.getUTCFullYear(), m = tt.getUTCMonth() + 1, mKey = y + '-' + pad(m);
  const mStart = today - (tt.getUTCDate() - 1);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), mEnd = mStart + dim - 1;
  const passed = today - mStart;            // 어제까지 지난 날 수
  const daysLeft = mEnd - today + 1;        // 오늘 포함 남은 날 수
  const goals = (D.goals || []).filter(g => g.month === mKey);
  const goalOf = name => { const g = goals.find(x => x.target === name || x.target === 'GL(' + name + ')'); return g ? g.db : null; };

  // 채널별 이번 달 일별 DB
  const nc = D.names.length, A = D.A;
  const daily = D.names.map(() => new Float64Array(dim));
  for (let i = 0; i < D.n; i++) {
    if (S.dedupe && A.dup[i]) continue;
    const d = A.day[i]; if (d < mStart || d > today) continue;
    daily[A.src[i]][d - mStart]++;
  }
  const L = buildLive();
  const stat = chs => {
    let done = 0, todayNow = 0;
    chs.forEach(c => {
      for (let j = 0; j < passed; j++) done += daily[c][j];
      todayNow += daily[c][passed] || 0;
    });
    const st = L.rowStats(chs);
    return { done, todayNow, todayFc: st.fc, tomorrow: st.tomorrow };
  };
  // 최근 7일(어제까지) 채널별 합계
  const sum7 = new Float64Array(nc);
  for (let i = 0; i < D.n; i++) {
    if (S.dedupe && A.dup[i]) continue;
    const d = A.day[i]; if (d >= today - 7 && d < today) sum7[A.src[i]]++;
  }
  const calc = (chs, goal) => {
    const s = stat(chs);
    const avg7 = chs.reduce((a, c) => a + sum7[c], 0) / 7;
    const proj = s.done + Math.max(s.todayFc, s.todayNow) + avg7 * (mEnd - today);
    const o = Object.assign(s, { goal, avg7, proj });
    if (goal) {
      o.rate = s.done / goal;
      o.left = Math.max(0, goal - s.done);
      o.need = o.left / daysLeft;
      o.paceTarget = goal * passed / dim;     // 어제까지 있어야 할 누적
      o.projRate = proj / goal;
    }
    return o;
  };

  const monthLabel = m + '월';
  const totalGoal = goalOf('전체');
  const all = calc(D.hier[0].ch, totalGoal);
  const yLabel = (() => { const t = new Date((today - 1) * 864e5); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate(); })();
  $('goalMeta').textContent = `${fmtDay(mStart)} ~ ${fmtDay(mEnd)} | 오늘 포함 남은 ${daysLeft}일` +
    (D.manualDb && D.manualDb.used ? ` | 수동 입력 ${fmt(D.manualDb.used)}건 포함` : '');

  if (!totalGoal) {
    $('goalLead').innerHTML = `${monthLabel} 목표가 아직 없어요. 시트의 <b>목표</b> 탭에 <b>${mKey} | 전체 | 목표 DB 수</b>를 입력하면 여기에 표시돼요. (어제까지 ${fmt(all.done)}건)`;
    $('goalKpis').innerHTML = ''; $('goalBar').innerHTML = ''; $('goalTable').innerHTML = '';
    ['goalCumChart', 'goalDailyChart'].forEach(id => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
    return;
  }
  const ahead = all.done - all.paceTarget;
  const todayGap = all.todayFc - all.need;
  $('goalLead').innerHTML =
    `${monthLabel} 목표 <b>${fmt(totalGoal)}건</b> 중 어제(${yLabel})까지 <b>${fmt(all.done)}건</b>(${(all.rate * 100).toFixed(1)}%)을 달성했어요. ` +
    `남은 <b>${fmt(all.left)}건</b>을 채우려면 오늘부터 <b class="hl">하루 ${fmt(Math.ceil(all.need))}건</b>씩 필요해요. ` +
    `날짜 기준으로는 어제까지 ${fmt(all.paceTarget)}건이 있어야 해서 <b class="${ahead >= 0 ? 'up' : 'down'}">${ahead >= 0 ? fmt(ahead) + '건 앞서' : fmt(-ahead) + '건 뒤처져'}</b> 있어요. ` +
    `최근 7일 평균(하루 ${fmt(all.avg7)}건)이 이어지면 월말 약 <b>${fmt(all.proj)}건</b>(${(all.projRate * 100).toFixed(0)}%)으로 예상돼요.`;

  const kpi = (l, v, n, cls) => `<div class="kpi${cls ? ' ' + cls : ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="n">${n}</div></div>`;
  $('goalKpis').innerHTML =
    kpi(monthLabel + ' 목표', fmt(totalGoal), '목표 기준 하루 ' + fmt(totalGoal / dim) + '건 (' + dim + '일)') +
    kpi('어제까지 달성', fmt(all.done), (all.rate * 100).toFixed(1) + '%, ' + passed + '일간 실제 하루 평균 ' + fmt(passed ? all.done / passed : 0) + '건') +
    kpi('남은 수량', fmt(all.left), '오늘 포함 ' + daysLeft + '일') +
    kpi('하루 필요', fmt(Math.ceil(all.need)), '최근 7일 평균 ' + fmt(all.avg7) + '건', 'hero') +
    kpi('오늘', fmt(all.todayNow) + ' / ' + fmt(all.todayFc), `예측 마감, 필요 대비 <span class="${todayGap >= 0 ? 'up' : 'down'}">${todayGap >= 0 ? '+' : ''}${fmt(todayGap)}</span>`);

  const pct = v => clamp(v * 100, 0, 100).toFixed(2) + '%';
  $('goalBar').innerHTML =
    `<div class="gb-track"><span class="gb-done" style="width:${pct(all.rate)}"></span>` +
    `<span class="gb-today" style="left:${pct(all.rate)};width:${pct(all.todayNow / totalGoal)}"></span>` +
    `<i class="gb-mark" style="left:${pct(all.paceTarget / totalGoal)}" title="어제까지 있어야 할 위치"></i></div>` +
    `<div class="gb-legend"><span><i class="lg-done"></i>어제까지 ${(all.rate * 100).toFixed(1)}%</span><span><i class="lg-today"></i>오늘 현재 +${fmt(all.todayNow)}</span><span><i class="lg-mark"></i>날짜 기준 목표 위치 ${(all.paceTarget / totalGoal * 100).toFixed(1)}%</span></div>`;

  // 누적 차트: 실제 누적, 목표 직선, 필요 경로, 예상 경로
  const days = [...Array(dim).keys()];
  const dayTot = days.map(j => D.hier[0].ch.reduce((a, c) => a + daily[c][j], 0));
  let acc = 0;
  const cum = days.map(j => { if (j > passed) return null; acc += dayTot[j]; return acc; });
  const target = days.map(j => totalGoal * (j + 1) / dim);
  const needPath = days.map(j => j < passed - 1 ? null : j === passed - 1 ? all.done : all.done + all.need * (j - passed + 1));
  const projPath = days.map(j => j < passed - 1 ? null : j === passed - 1 ? all.done : j === passed ? all.done + all.todayFc : all.done + all.todayFc + all.avg7 * (j - passed));
  const labels = days.map(j => (m) + '/' + (j + 1));
  draw('goalCumChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '실제 누적', data: cum, borderColor: '#18212E', backgroundColor: '#18212E', borderWidth: 2.5, pointRadius: 0, tension: 0.15 },
        { label: '목표(날짜 비례)', data: target, borderColor: '#A3AEBD', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0 },
        { label: '목표 달성 필요 경로', data: needPath, borderColor: '#0E8F72', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, spanGaps: true },
        { label: '현재 페이스 예상', data: projPath, borderColor: '#2F5BD3', borderWidth: 2, borderDash: [2, 3], pointRadius: 0, spanGaps: true }
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 11 } }, y: { beginAtZero: true, ticks: { callback: v => fmt(v) } } },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 14, boxHeight: 2, padding: 14 } },
        tooltip: { filter: c => c.raw != null, callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + '건' } }
      }
    }
  });
  draw('goalDailyChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'bar', label: '일별 DB', data: days.map(j => j <= passed ? dayTot[j] : null), backgroundColor: days.map(j => j === passed ? '#A9BDEE' : dayTot[j] >= totalGoal / dim ? '#2F5BD3' : '#7D9AE8'), borderRadius: 2, order: 2 },
        { type: 'line', label: '남은 기간 하루 필요', data: days.map(j => j >= passed ? all.need : null), borderColor: '#0E8F72', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, order: 1 },
        { type: 'line', label: '월 목표 하루 평균', data: days.map(() => totalGoal / dim), borderColor: '#A3AEBD', borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, order: 1 }
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 11 } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12, boxHeight: 8, padding: 14 } },
        tooltip: { filter: c => c.raw != null, callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + '건' + (c.dataIndex === passed && c.dataset.type === 'bar' ? ' (오늘, 진행 중)' : '') } }
      }
    }
  });

  // 그룹·채널별 표 (목표 탭에 해당 구분 목표가 있으면 달성률 계산)
  $('goalTable').innerHTML =
    '<thead><tr><th>구분</th><th class="xm">목표</th><th>어제까지</th><th class="x">비중</th><th>달성률</th><th class="x">남은</th><th>하루 필요</th><th class="xm">최근 7일 평균</th><th class="x">월말 예상</th></tr></thead><tbody>' +
    D.hier.filter(r => !r.parent || S.open.has(r.parent)).map(r => {
      const g = r.lv === 0 ? totalGoal : goalOf(r.name);
      const s = calc(r.ch, g);
      const isOpen = S.open.has(r.key);
      const caret = r.kids ? `<span class="caret${isOpen ? ' open' : ''}" aria-hidden="true">▸</span>` : '';
      const dot = r.color ? `<i style="background:${r.color}"></i>` : '';
      const share = all.done ? s.done / all.done : 0;
      return `<tr class="lv${r.lv}${r.kids ? ' parent' : ''}" data-key="${esc(r.key)}"${r.kids ? ' data-kids="1"' : ''}>` +
        `<td class="name">${caret}${dot}${esc(r.name)}</td>` +
        `<td class="xm">${g ? fmt(g) : '<span class="dim">-</span>'}</td>` +
        `<td>${fmt(s.done)}<span class="m">${g ? '목표 ' + fmt(g) : (share * 100).toFixed(1) + '%'}</span></td>` +
        `<td class="x dim">${(share * 100).toFixed(1)}%</td>` +
        `<td>${g ? `<div class="mini"><span style="width:${pct(s.rate)}"></span></div>${(s.rate * 100).toFixed(1)}%` : '<span class="dim">목표 없음</span>'}</td>` +
        `<td class="x">${g ? fmt(s.left) : '-'}</td>` +
        `<td class="fc">${g ? fmt(Math.ceil(s.need)) : '<span class="dim">-</span>'}<span class="m">7일 평균 ${fmt(s.avg7)}</span></td>` +
        `<td class="xm">${fmt(s.avg7)}</td>` +
        `<td class="x">${fmt(s.proj)}${g ? ` <span class="${s.projRate >= 1 ? 'up' : 'down'}">${(s.projRate * 100).toFixed(0)}%</span>` : ''}</td></tr>`;
    }).join('') + '</tbody>';
}


/* ---------- 수동 DB 입력 (목표 탭) ---------- */
const KNOWN_EXTRA = ['K', 'MT', 'TB', 'PLAN', 'MJ', '홈페이지', '네이버', '구방송', 'BIG'];
let miBuilt = false;
function miRowHtml(date, ch, n) {
  return `<div class="mi-row"><input type="date" class="mi-date" value="${date}" aria-label="일자">` +
    `<input type="text" class="mi-ch" list="miChannels" value="${esc(ch || '')}" placeholder="채널 (예: K, PLAN)" aria-label="채널">` +
    `<input type="number" class="mi-n" min="0" step="1" value="${n == null ? '' : n}" placeholder="DB수" aria-label="DB수">` +
    `<button class="mi-del" title="이 줄 빼기" aria-label="이 줄 빼기">×</button></div>`;
}
function buildManualForm() {
  if (!D) return;
  const names = [...new Set(D.names.concat(KNOWN_EXTRA))];
  $('miChannels').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
  if (!miBuilt) {
    const y = dayToStr(D.asOf.day - 1);
    $('miRows').innerHTML = miRowHtml(y, '', '') + miRowHtml(y, '', '');
    try { const p = localStorage.getItem('dash_pin'); if (p) { $('miPin').value = p; $('miRemember').checked = true; } } catch (e) {}
    miBuilt = true;
  }
  const ent = (D.manualDb && D.manualDb.entries) || [];
  $('miTable').innerHTML = '<thead><tr><th>일자</th><th>채널</th><th>DB수</th><th>상태</th><th></th></tr></thead><tbody>' +
    (ent.length ? ent.slice().sort((a, b) => b.day - a.day || String(a.ch).localeCompare(b.ch)).map(e =>
      `<tr><td>${fmtDay(e.day)} (${DOW[dowOf(e.day)]})</td><td>${esc(e.ch)}</td><td>${fmt(e.n)}</td>` +
      `<td>${e.used ? '<span class="up">반영 중</span>' : '<span class="dim">자동 데이터 우선 (미사용)</span>'}</td>` +
      `<td><button class="linkbtn mi-edit" data-d="${dayToStr(e.day)}" data-c="${esc(e.ch)}" data-n="${e.n}">수정</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="note">아직 입력된 내역이 없어요.</td></tr>') + '</tbody>';
}
$('miAdd').addEventListener('click', () => {
  const rows = $('miRows').querySelectorAll('.mi-date');
  const last = rows.length ? rows[rows.length - 1].value : dayToStr(D.asOf.day - 1);
  $('miRows').insertAdjacentHTML('beforeend', miRowHtml(last, '', ''));
});
$('miRows').addEventListener('click', e => {
  const b = e.target.closest('.mi-del'); if (!b) return;
  const row = b.closest('.mi-row');
  if ($('miRows').children.length > 1) row.remove(); else row.querySelectorAll('input:not(.mi-date)').forEach(i => i.value = '');
});
$('miTable').addEventListener('click', e => {
  const b = e.target.closest('.mi-edit'); if (!b) return;
  $('miRows').insertAdjacentHTML('afterbegin', miRowHtml(b.dataset.d, b.dataset.c, b.dataset.n));
  $('miRows').firstElementChild.querySelector('.mi-n').focus();
  $('miMsg').textContent = '숫자를 고친 뒤 저장하세요. 0으로 저장하면 그 줄이 지워져요.';
});
$('miSave').addEventListener('click', async () => {
  const rows = [...$('miRows').querySelectorAll('.mi-row')].map(r => ({
    date: r.querySelector('.mi-date').value, ch: r.querySelector('.mi-ch').value.trim(), n: r.querySelector('.mi-n').value
  })).filter(r => r.date && r.ch && r.n !== '');
  const msg = $('miMsg');
  if (!rows.length) { msg.className = 'mi-msg err'; msg.textContent = '일자, 채널, DB수를 모두 입력한 줄이 없어요.'; return; }
  const pin = $('miPin').value.trim();
  if (!pin) { msg.className = 'mi-msg err'; msg.textContent = '입력 비밀번호를 넣어 주세요.'; $('miPin').focus(); return; }
  try { if ($('miRemember').checked) localStorage.setItem('dash_pin', pin); else localStorage.removeItem('dash_pin'); } catch (e) {}
  $('miSave').disabled = true;
  msg.className = 'mi-msg'; msg.textContent = `${rows.length}줄 저장 중… 대시보드 데이터도 다시 계산하느라 10~20초 걸려요.`;
  try {
    const res = await fetch(CFG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'manualDb', pin, rows, token: CFG.TOKEN || undefined })
    });
    let data; try { data = JSON.parse(await res.text()); } catch (_) { throw new Error('응답을 읽을 수 없어요. Apps Script를 새 버전으로 배포했는지 확인해 주세요.'); }
    if (data.error) throw new Error(data.error);
    msg.className = 'mi-msg ok'; msg.textContent = `${data.saved}줄 저장했어요. 대시보드에 반영 중이에요.`;
    const y = dayToStr(D.asOf.day - 1);
    $('miRows').innerHTML = miRowHtml(y, '', '') + miRowHtml(y, '', '');
    await load(false, true);
    msg.textContent = `${data.saved}줄 저장하고 대시보드에 반영했어요.`;
  } catch (err) {
    msg.className = 'mi-msg err'; msg.textContent = '저장하지 못했어요: ' + (err.message || err);
  } finally { $('miSave').disabled = false; }
});


/* ---------- 일자별 DB · CPA 표 ---------- */
function renderDaily(dayBySrc) {
  const sel = D.groups.flatMap(g => g.idx).filter(c => S.src.has(c));
  const units = S.stack === 'group'
    ? D.groups.map(g => ({ name: g.name, color: g.color, chs: g.idx.filter(c => S.src.has(c)) })).filter(u => u.chs.length)
    : sel.map(c => ({ name: D.names[c], color: chColor(c), chs: [c] }));
  const hasSpend = !!D.hasSpend;
  const cell = (chs, d0, d1) => {
    let db = 0, sp = 0, mdb = 0;
    chs.forEach(c => {
      for (let d = d0; d <= d1; d++) {
        const n = dayBySrc[c][d - S.from] || 0; db += n;
        const v = D.spendCh[c] && D.spendCh[c].get(d);
        if (v) { sp += v; mdb += n; }
      }
    });
    return { db, sp, cpa: mdb > 0 && sp > 0 ? sp / mdb : 0 };
  };
  const fmtCell = o => `<b>${fmt(o.db)}</b>` + (hasSpend ? `<span class="cpa">${o.cpa ? fmt(o.cpa) + '원' : '-'}</span>` : '');
  const today = D.asOf.day;
  const head = '<thead><tr><th class="dcol">일자</th><th class="tot">전체</th>' + (hasSpend ? '<th class="sp">광고비</th>' : '') +
    units.map(u => `<th><i style="background:${u.color}"></i>${esc(u.name)}</th>`).join('') + '</tr></thead>';
  const rowHtml = (label, cls, d0, d1) => {
    const t = cell(sel, d0, d1);
    return `<tr class="${cls}"><th class="dcol">${label}</th><td class="tot">${fmtCell(t)}</td>` +
      (hasSpend ? `<td class="sp">${t.sp ? wonShort(t.sp) : '-'}</td>` : '') +
      units.map(u => `<td>${fmtCell(cell(u.chs, d0, d1))}</td>`).join('') + '</tr>';
  };
  let body = '';
  if (S.to > S.from) body += rowHtml(`기간 합계<span class="sub">${S.to - S.from + 1}일</span>`, 'sum', S.from, S.to);
  for (let d = S.to; d >= S.from; d--) {
    const w = dowOf(d), t = new Date(d * 864e5);
    const label = `${t.getUTCMonth() + 1}/${t.getUTCDate()} <span class="dw${w >= 5 ? ' we' : ''}">${DOW[w]}</span>` + (d === today ? '<span class="tag">진행 중</span>' : '');
    body += rowHtml(label, w === 6 ? 'sun' : '', d, d);
  }
  $('dailyTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  const days = S.to - S.from + 1;
  $('dailyNote').textContent = days === 1 ? fmtDay(S.from) + ' (' + DOW[dowOf(S.from)] + ')' : fmtDay(S.from) + ' ~ ' + fmtDay(S.to) + ', ' + days + '일';
}

/* ---------- 자동 갱신 ---------- */
setInterval(() => { if (S.auto && D && document.visibilityState === 'visible') load(false, true); }, AUTO_REFRESH_MIN * 60000);
document.addEventListener('visibilitychange', () => {
  if (S.auto && D && document.visibilityState === 'visible' && Date.now() - lastLoad > AUTO_REFRESH_MIN * 60000) load(false, true);
});

load(false, false);
