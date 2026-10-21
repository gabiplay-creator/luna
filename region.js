/* 지역별 일자 통계 — 각 DB의 비고(캠페인명)에 들어 있는 지역 글자로 분류 */
(function () {
  // 위에서부터 먼저 맞는 지역으로 분류. 마지막 줄은 '경기'·MASS·MAIN 같은 메인 캠페인 → 경기남부
  const RULES = [
    ['경기남부', /경기남부|수원|용인|화성|부천|시흥|광명|안산|평택|오산/i],
    ['충청도', /충청|충남|충북|대전|세종/],
    ['서울', /서울/],
    ['전북/강원', /전북|강원/],
    ['경북', /경북|대구/],
    ['경기남부', /경기|mass|main/i]
  ];
  const REGIONS = ['경기남부', '충청도', '서울', '전북/강원', '경북', '기타'];
  const COLORS = ['#2F5BD3', '#0E8F72', '#C2417A', '#E0A100', '#6A4FC9', '#9AA3AF'];
  const st = { period: 'd14', scope: 'all', unit: 'n', end: null };   // end = 기준일 (null이면 오늘)
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '-';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const W = '일월화수목금토';
  const md = d => { const t = new Date(d * 864e5); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + '(' + W[t.getUTCDay()] + ')'; };
  let cacheKey = null, cache = null;

  function classify(text) {
    if (!text) return 5;
    for (let i = 0; i < RULES.length; i++) if (RULES[i][1].test(text)) return REGIONS.indexOf(RULES[i][0]);
    return 5;
  }
  function regionOfRows() {
    if (cacheKey === D) return cache;
    const nr = (D.notes || []).map(classify), cr = (D.campaigns || []).map(classify);
    const A = D.A, out = new Uint8Array(D.n);
    for (let i = 0; i < D.n; i++) {
      let r = A.note[i] >= 0 ? nr[A.note[i]] : 5;
      if (r === 5 && A.camp[i] >= 0) r = cr[A.camp[i]];
      out[i] = r;
    }
    cacheKey = D; cache = out;
    return out;
  }
  const todayDay = () => D.asOf ? D.asOf.day : D.max;
  const endDay = () => { const t = todayDay(); return st.end == null ? t : Math.max(D.min, Math.min(t, st.end)); };
  const iso = d => new Date(d * 864e5).toISOString().slice(0, 10);
  function range() {
    const end = endDay();
    const t = new Date(end * 864e5), y = t.getUTCFullYear(), m = t.getUTCMonth();
    const first = Math.floor(Date.UTC(y, m, 1) / 864e5);
    if (st.period === 'd1') return [end, end];
    if (st.period === 'd7') return [end - 6, end];
    if (st.period === 'd14') return [end - 13, end];
    if (st.period === 'd30') return [end - 29, end];
    if (st.period === 'month') return [first, end];
    return [Math.floor(Date.UTC(y, m - 1, 1) / 864e5), first - 1];
  }
  function scopes() {
    const out = [['all', '전체']];
    [...new Set(D.groups.filter(g => g.idx.length).map(g => g.army))].forEach(a => out.push(['army:' + a, a]));
    D.groups.forEach(g => g.idx.forEach(c => out.push(['ch:' + c, D.names[c]])));
    return out;
  }
  function inScope(c) {
    if (st.scope === 'all') return true;
    if (st.scope.indexOf('army:') === 0) return D.groups[D.groupOf[c]] && D.groups[D.groupOf[c]].army === st.scope.slice(5);
    return String(c) === st.scope.slice(3);
  }

  function render() {
    const box = $('rgTable');
    if (!box || typeof D === 'undefined' || !D) return;
    const sc = scopes();
    if (!sc.some(s => s[0] === st.scope)) st.scope = 'all';
    $('rgScope').innerHTML = sc.map(s => `<button data-k="scope" data-v="${esc(s[0])}" aria-pressed="${s[0] === st.scope}">${esc(s[1])}</button>`).join('');
    document.querySelectorAll('#rgCtrl [data-k="period"], #rgCtrl [data-k="unit"]').forEach(b => b.setAttribute('aria-pressed', String(st[b.dataset.k] === b.dataset.v)));
    const ed = endDay(), di = $('rgDate');
    di.min = iso(D.min); di.max = iso(todayDay()); di.value = iso(ed);
    $('rgPrev').disabled = ed <= D.min; $('rgNext').disabled = ed >= todayDay(); $('rgToday').disabled = ed >= todayDay();
    $('rgDow').textContent = W[new Date(ed * 864e5).getUTCDay()] + '요일' + (ed === todayDay() ? ' · 오늘' : '');
    const pl = { d1: '하루', d7: '7일', d14: '14일', d30: '30일', month: '그 달 1일부터', prev: '전 달' };
    document.querySelectorAll('#rgCtrl [data-k="period"]').forEach(b => { b.textContent = pl[b.dataset.v]; });

    const [from, to] = range(), nd = to - from + 1;
    const reg = regionOfRows(), A = D.A;
    const day = Array.from({ length: nd }, () => new Array(6).fill(0));
    const chm = new Map();
    let noNote = 0;
    for (let i = 0; i < D.n; i++) {
      const d = A.day[i]; if (d < from || d > to) continue;
      const c = A.src[i]; if (!inScope(c)) continue;
      if (S.dedupe && A.dup[i]) continue;
      const r = reg[i];
      day[d - from][r]++;
      if (!chm.has(c)) chm.set(c, new Array(6).fill(0));
      chm.get(c)[r]++;
      if (r === 5 && A.note[i] < 0 && A.camp[i] < 0) noNote++;
    }
    const tot = new Array(6).fill(0); day.forEach(r => r.forEach((v, j) => { tot[j] += v; }));
    const all = tot.reduce((a, b) => a + b, 0);
    const cell = (v, sum) => st.unit === 'n' ? fmt(v) : pct(v, sum);

    // 요약 문장
    const top = REGIONS.slice(0, 5).map((r, j) => [r, tot[j]]).sort((a, b) => b[1] - a[1]);
    $('rgLead').innerHTML = all
      ? `${from === to ? md(from) : md(from) + ' ~ ' + md(to)} <b>${fmt(all)}건</b> 중 <b>${top[0][0]} ${fmt(top[0][1])}건(${pct(top[0][1], all)})</b>이 가장 많고, ${top[1][0]} ${pct(top[1][1], all)}, ${top[2][0]} ${pct(top[2][1], all)} 순이에요.` +
        (tot[5] ? ` 지역을 알 수 없는 DB는 <b>${fmt(tot[5])}건(${pct(tot[5], all)})</b>으로 '기타'에 넣었어요.` : '')
      : '선택한 기간·채널에 DB가 없어요.';

    // 막대 (기간 비중)
    $('rgBar').innerHTML = all ? REGIONS.map((r, j) => tot[j] ? `<i style="width:${tot[j] / all * 100}%;background:${COLORS[j]}" title="${r} ${fmt(tot[j])}건 (${pct(tot[j], all)})"></i>` : '').join('') : '';
    $('rgLegend').innerHTML = REGIONS.map((r, j) => `<span><i style="background:${COLORS[j]}"></i>${r} <b>${pct(tot[j], all)}</b></span>`).join('');

    // 일자 × 지역
    const head = '<thead><tr><th>날짜</th>' + REGIONS.map((r, j) => `<th><i class="rg-dot" style="background:${COLORS[j]}"></i>${r}</th>`).join('') + '<th>합계</th></tr></thead>';
    let body = '<tr class="rg-sum"><td>기간 합계</td>' + tot.map(v => `<td>${cell(v, all)}<span class="m">${st.unit === 'n' ? pct(v, all) : fmt(v) + '건'}</span></td>`).join('') + `<td>${fmt(all)}</td></tr>`;
    if (nd > 1) body += `<tr class="rg-sum rg-avg"><td>일평균</td>` + tot.map(v => `<td>${(v / nd).toFixed(1)}</td>`).join('') + `<td>${(all / nd).toFixed(1)}</td></tr>`;
    for (let k = nd - 1; k >= 0; k--) {
      const r = day[k], s = r.reduce((a, b) => a + b, 0), d = from + k;
      const wk = new Date(d * 864e5).getUTCDay();
      body += `<tr${wk === 0 || wk === 6 ? ' class="rg-we"' : ''}><td>${md(d)}${d === (D.asOf && D.asOf.day) ? ' <span class="m">진행 중</span>' : ''}</td>` +
        r.map((v, j) => { const share = s ? v / s : 0, base = all ? tot[j] / all : 0, diff = share - base; const cls = s >= 10 && Math.abs(diff) >= 0.08 ? (diff > 0 ? ' class="hi"' : ' class="lo"') : ''; return `<td${cls}>${v ? cell(v, s) : '<span class="m">-</span>'}</td>`; }).join('') +
        `<td><b>${fmt(s)}</b></td></tr>`;
    }
    box.innerHTML = head + '<tbody>' + body + '</tbody>';

    // 채널 × 지역
    const chs = [...chm.keys()].sort((a, b) => a - b);
    $('rgChTable').innerHTML = '<thead><tr><th>채널</th>' + REGIONS.map(r => `<th>${r}</th>`).join('') + '<th>합계</th></tr></thead><tbody>' +
      chs.map(c => { const r = chm.get(c), s = r.reduce((a, b) => a + b, 0); return `<tr><td>${esc(D.names[c])}</td>` + r.map(v => `<td>${v ? cell(v, s) : '<span class="m">-</span>'}</td>`).join('') + `<td><b>${fmt(s)}</b></td></tr>`; }).join('') +
      '</tbody>';
    $('rgNote').textContent = '분류 기준: 비고(캠페인명)에 경기남부·수원·용인·화성·부천 등 → 경기남부, 충청 → 충청도, 서울, 전북·강원 → 전북/강원, 경북·대구 → 경북, 그 외 경기·MASS·MAIN → 경기남부, 나머지 → 기타' + (S.dedupe ? ' · 중복 제외 적용' : '');
  }

  document.addEventListener('click', e => {
    const nav = e.target.closest('#rgPrev, #rgNext, #rgToday');
    if (nav && !nav.disabled) {
      st.end = nav.id === 'rgToday' ? null : endDay() + (nav.id === 'rgPrev' ? -1 : 1);
      if (st.end != null && st.end >= todayDay()) st.end = null;
      render(); return;
    }
    const b = e.target.closest('#rgCtrl [data-k]'); if (!b) return;
    st[b.dataset.k] = b.dataset.v; render();
  });
  document.addEventListener('change', e => {
    if (e.target.id !== 'rgDate' || !e.target.value) return;
    const v = e.target.value.split('-');
    const d = Math.floor(Date.UTC(+v[0], +v[1] - 1, +v[2]) / 864e5);
    st.end = d >= todayDay() ? null : d;
    render();
  });
  document.addEventListener('keydown', e => {   // 지역별 화면에서 ← → 키로 하루씩 이동
    if (typeof S === 'undefined' || S.page !== 'region' || /INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowLeft') $('rgPrev').click(); else if (e.key === 'ArrowRight') $('rgNext').click();
  });
  window.renderRegion = render;
  if (typeof D !== 'undefined' && D) render();
})();
