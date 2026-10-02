const DOW = ['월', '화', '수', '목', '금', '토', '일'];
const SRC_COLORS = ['#2F5BD3', '#12A38B', '#E0A100', '#C2417A', '#6A4FC9', '#E2612E', '#3B8FB8', '#7A8B2E', '#9C4DCC', '#4C6A92'];
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
const S = { from: 0, to: 0, src: new Set(), dedupe: false, trend: 'day', dim: 'source', preset: 'all' };
const charts = {};

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '0%';
const pad = n => String(n).padStart(2, '0');
const dayToStr = d => new Date(d * 864e5).toISOString().slice(0, 10);
const strToDay = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 864e5);
const dowOf = d => (d + 3) % 7; // 0=월 … 6=일 (1970-01-01은 목요일)
const fmtDay = d => { const t = new Date(d * 864e5); return t.getUTCFullYear() + '.' + pad(t.getUTCMonth() + 1) + '.' + pad(t.getUTCDate()); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CFG = window.DASHBOARD_CONFIG || {};

async function load(force) {
  $('overlay').classList.remove('hidden');
  $('loadMsg').className = '';
  $('loadMsg').textContent = '시트에서 데이터를 불러오는 중입니다…';
  if (!CFG.API_URL || CFG.API_URL.indexOf('script.google.com') < 0) {
    onErr(new Error('assets/config.js 파일의 API_URL에 Apps Script 웹 앱 주소를 넣어 주세요.'));
    return;
  }
  try {
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
  } catch (e) { onErr(e); }
}

function onErr(e) {
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
  D = Object.assign(raw, { A: A, n: n, min: n ? min : 0, max: n ? max : 0 });

  if (first) {
    S.src = new Set(D.sources.map((_, i) => i));
    buildChips();
  }
  applyPreset(S.preset);
  $('meta').textContent = '업데이트 ' + D.generatedAt + ' · 데이터 범위 ' + fmtDay(D.min) + ' ~ ' + fmtDay(D.max);
  renderReport();
  $('overlay').classList.add('hidden');
}

/* ---------- 필터 ---------- */
function buildChips() {
  $('chips').innerHTML = D.sources.map((s, i) =>
    `<button class="chip" data-i="${i}" aria-pressed="true" style="--c:${SRC_COLORS[i % SRC_COLORS.length]}"><i></i>${esc(s)}</button>`).join('');
}

function applyPreset(p) {
  S.preset = p;
  if (p === 'all') { S.from = D.min; S.to = D.max; }
  else if (p) { S.to = D.max; S.from = Math.max(D.min, D.max - (+p) + 1); }
  syncControls();
  render();
}

function syncControls() {
  $('from').value = dayToStr(S.from); $('to').value = dayToStr(S.to);
  $('from').min = $('to').min = dayToStr(D.min);
  $('from').max = $('to').max = dayToStr(D.max);
  document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === S.preset)));
  document.querySelectorAll('#trendSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.trend)));
  document.querySelectorAll('#dimSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.dim)));
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
  const b = e.target.closest('.chip'); if (!b) return;
  const i = +b.dataset.i;
  if (S.src.has(i)) S.src.delete(i); else S.src.add(i);
  syncControls(); render();
});
$('allSrc').addEventListener('click', () => { S.src = new Set(D.sources.map((_, i) => i)); syncControls(); render(); });
$('dedupe').addEventListener('change', e => { S.dedupe = e.target.checked; render(); });
$('trendSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.trend = b.dataset.v; syncControls(); render(); } });
$('dimSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.dim = b.dataset.v; syncControls(); render(); } });
$('reload').addEventListener('click', () => load(true));

/* ---------- 집계 & 렌더 ---------- */
function render() {
  const A = D.A, ns = D.sources.length, days = S.to - S.from + 1;
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
    else if (S.dim === 'note') k = A.note[i];
    else if (S.dim === 'platform') { k = A.plat[i]; if (k < 0) continue; }
    else { k = A.camp[i]; if (k < 0) continue; }
    dimC.set(k, (dimC.get(k) || 0) + 1);
  }

  $('empty').style.display = total ? 'none' : 'block';
  renderKpis(total, days, hourC, dowC, dupSeen, noTime);
  renderTrend(dayBySrc);
  renderDow(dowC, total);
  renderHour(hourC, noTime);
  renderShare(dimC);
}

function argmax(arr) { let m = -1, k = -1; arr.forEach((v, i) => { if (v > m) { m = v; k = i; } }); return k; }

function renderKpis(total, days, hourC, dowC, dupSeen, noTime) {
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
  $('kDupN').textContent = S.dedupe ? '집계에서 제외됨' : '집계에 포함됨 · 비율 ' + pct(dupSeen, total);
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
  const sel = D.sources.map((_, i) => i).filter(i => S.src.has(i));
  const datasets = sel.map(s => {
    const arr = new Array(labels.length).fill(0);
    const src = dayBySrc[s];
    for (let j = 0; j < src.length; j++) arr[bucketOfDay[j]] += src[j];
    return { label: D.sources[s], data: arr, backgroundColor: SRC_COLORS[s % SRC_COLORS.length], stack: 'a', borderRadius: 2, maxBarThickness: 48 };
  });

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
  $('hourNote').textContent = noTime ? '시간 정보 없는 ' + fmt(noTime) + '건 제외' : '';
  draw('hourChart', {
    type: 'bar',
    data: { labels: hourC.map((_, h) => h + '시'), datasets: [{ data: hourC, backgroundColor: barColors(hourC), borderRadius: 2 }] },
    options: {
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { tooltip: { callbacks: { title: i => i[0].dataIndex + ':00 ~ ' + i[0].dataIndex + ':59', label: c => ' ' + fmt(c.raw) + '건 (' + pct(c.raw, hTotal) + ')' } } }
    }
  });
}

function dimName(k) {
  if (S.dim === 'source') return D.sources[k];
  if (S.dim === 'note') return k < 0 ? '(비고 없음)' : D.notes[k];
  if (S.dim === 'platform') { const p = D.platforms[k]; return PLATFORM_NAMES[p] || p; }
  return D.campaigns[k];
}

function renderShare(dimC) {
  const items = [...dimC.entries()].sort((a, b) => b[1] - a[1]);
  const sum = items.reduce((a, x) => a + x[1], 0);
  const colorOf = (k, rank) => S.dim === 'source' ? SRC_COLORS[k % SRC_COLORS.length]
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
  $('shareTable').innerHTML = '<thead><tr><th>항목</th><th>건수</th><th>비율</th><th class="bar"></th></tr></thead><tbody>' +
    (items.length ? items.map((x, r) => {
      const c = colorOf(x[0], r);
      return `<tr><td class="name"><i style="background:${c}"></i>${esc(dimName(x[0]))}</td><td>${fmt(x[1])}</td><td>${pct(x[1], sum)}</td>` +
        `<td class="bar"><div><span style="width:${(x[1] / max * 100).toFixed(1)}%;background:${c}"></span></div></td></tr>`;
    }).join('') : '<tr><td colspan="4" class="note">표시할 항목이 없습니다.</td></tr>') + '</tbody>';

  const notes = {
    source: '선택한 채널 기준 비율입니다.',
    note: '비고 칸의 값 그대로 묶었습니다. 표기가 조금만 달라도 별도 항목으로 잡혀요.',
    platform: 'META 광고 컬럼이 있는 탭(GL(M))만 해당합니다.',
    campaign: 'META 광고 컬럼이 있는 탭(GL(M))만 해당합니다.'
  };
  $('shareNote').textContent = notes[S.dim] + ' 합계 ' + fmt(sum) + '건, 항목 ' + items.length + '개.';
}

function renderReport() {
  $('reportTable').innerHTML = '<thead><tr><th>탭</th><th>인식</th><th>날짜 인식 실패</th><th>시간 없음</th><th>중복 연락처</th></tr></thead><tbody>' +
    D.report.map(r => `<tr><td>${esc(r.name)}${r.missing ? ' (탭 없음)' : ''}</td><td>${fmt(r.rows)}</td><td>${fmt(r.skipped)}</td><td>${fmt(r.noTime)}</td><td>${fmt(r.dup)}</td></tr>`).join('') +
    '</tbody>';
}

load(false);
