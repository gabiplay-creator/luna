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
const S = { from: 0, to: 0, src: new Set(), dedupe: false, trend: 'day', stack: 'channel', dim: 'source', preset: 'all', liveKey: 'all', auto: true, open: new Set() };
const charts = {};
const CFG = window.DASHBOARD_CONFIG || {};

const $ = id => document.getElementById(id);
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
let loading = false;
let lastLoad = 0;
async function load(force, silent) {
  if (loading) return;
  loading = true;
  if (!silent) {
    $('overlay').classList.remove('hidden');
    $('loadMsg').className = '';
    $('loadMsg').textContent = '시트에서 데이터를 불러오는 중입니다…';
  } else {
    $('liveMeta').textContent = '최신 데이터 확인 중…';
  }
  try {
    if (!CFG.API_URL || CFG.API_URL.indexOf('script.google.com') < 0) throw new Error('config.js 파일의 API_URL에 Apps Script 웹 앱 주소를 넣어 주세요.');
    const u = new URL(CFG.API_URL);
    if (CFG.TOKEN) u.searchParams.set('token', CFG.TOKEN);
    if (force) u.searchParams.set('refresh', '1');
    const res = await fetch(u.toString());
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('API 응답을 읽을 수 없습니다. 웹 앱 액세스 권한이 "모든 사용자"로 배포됐는지 확인해 주세요.'); }
    if (data.error) throw new Error(data.error === 'unauthorized' ? 'TOKEN이 Apps Script의 ACCESS_TOKEN과 다릅니다.' : data.error);
    onData(data);
  } catch (e) {
    if (silent && D) { $('liveMeta').textContent = '자동 갱신에 실패했어요. 다음 주기에 다시 시도합니다.'; }
    else onErr(e);
  } finally {
    loading = false;
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
  $('meta').textContent = '데이터 기준 ' + D.generatedAt + '   |   범위 ' + fmtDay(D.min) + ' ~ ' + fmtDay(D.max) +
    (D.newNames.length ? '   |   새 채널 ' + D.newNames.join(', ') + ' 인식됨 (지원군)' : '');
  renderReport();
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
  press('#dimSeg button', 'v', S.dim);
  document.querySelectorAll('#chips .chip').forEach(b => b.setAttribute('aria-pressed', String(S.src.has(+b.dataset.i))));
}

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
$('dedupe').addEventListener('change', e => { S.dedupe = e.target.checked; render(); renderLive(); });
const segHandler = (id, key) => $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S[key] = b.dataset.v; syncControls(); render(); } });
segHandler('trendSeg', 'trend'); segHandler('stackSeg', 'stack'); segHandler('dimSeg', 'dim');
$('reload').addEventListener('click', () => load(true, false));
$('autoRefresh').addEventListener('change', e => { S.auto = e.target.checked; });
$('liveTable').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-key]'); if (!tr) return;
  const key = tr.dataset.key;
  if (tr.dataset.kids === '1') { if (S.open.has(key)) S.open.delete(key); else S.open.add(key); }
  S.liveKey = key; renderLive();
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
  function forecast(c, day, x, F, withUntimed) {
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
    // 내일: 최근 6일 + 오늘 예측의 평균 × 내일 요일 보정
    const s = Math.max(today - (FC.levelDays - 1), first[c]);
    let sum = r.fc, k = 1;
    if (isFinite(s)) for (let d = s; d < today; d++) { sum += dayTotal(c, d); k++; }
    r.tomorrow = isFinite(first[c]) ? (sum / k) * weekdayFactor(c, today, dowOf(today + 1)) : 0;
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

  return { today, t, Fnow, ch, rowStats, curves };
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
    `내일(${DOW[dowOf(L.today + 1)]})은 <b>${fmt(all.tomorrow)}건</b> 정도로 예상돼요.`;

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
  renderDow(dowC, total);
  renderHour(hourC, noTime);
  renderShare(dimC);
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

  draw('trendChart', {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 16, maxRotation: 0 } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12 } },
        tooltip: {
          filter: c => c.raw > 0,
          callbacks: {
            title: items => titles[items[0].dataIndex],
            label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + '건',
            footer: items => '합계 ' + fmt(items.reduce((a, c) => a + c.raw, 0)) + '건'
          }
        }
      }
    }
  });
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
      const auto = c >= 0 && !CHANNEL_COLORS[D.names[c]] ? ' (자동 인식)' : '';
      return `<tr><td>${esc(shortName(r.name))}${r.missing ? ' (탭 없음)' : ''}${auto}</td><td>${g ? esc(g.name) : '-'}</td><td>${fmt(r.rows)}</td><td>${fmt(r.skipped)}</td><td>${fmt(r.noTime)}</td><td>${fmt(r.dup)}</td></tr>`;
    }).join('') + '</tbody>';
}

/* ---------- 자동 갱신 ---------- */
setInterval(() => { if (S.auto && D && document.visibilityState === 'visible') load(false, true); }, AUTO_REFRESH_MIN * 60000);
document.addEventListener('visibilitychange', () => {
  if (S.auto && D && document.visibilityState === 'visible' && Date.now() - lastLoad > AUTO_REFRESH_MIN * 60000) load(false, true);
});

load(false, false);
