/* 지역별 일자 통계 — 각 DB의 비고(캠페인명)에 들어 있는 지역 글자로 분류 */
(function () {
  // 위에서부터 먼저 맞는 지역으로 분류. 마지막 줄은 '경기'·MASS·MAIN 같은 메인 캠페인 → 경기남부
  const RULES = [
    ['경기남부', /^260914_SA$/],      // 지역 글자 없는 캠페인을 직접 지정 (H 계정 SA)
    ['경기남부', /경기남부|수원|용인|화성|부천|시흥|광명|안산|평택|오산/i],
    ['충청도', /충청|충남|충북|대전|세종/],
    ['서울', /서울/],
    ['전북/강원', /전북|강원/],
    ['경북', /경북|대구/],
    ['전국', /전국/],                 // 캠페인 이름에 '전국'이 들어가면 전국
    ['경기남부', /경기|mass|main/i],
    ['전국', /meta|메타/i]          // 지역이 없는 메타 캠페인 → 전국
  ];
  const REGIONS = ['경기남부', '충청도', '서울', '전북/강원', '경북', '전국', '기타'];
  const COLORS = ['#2F5BD3', '#0E8F72', '#C2417A', '#E0A100', '#6A4FC9', '#2BA3B8', '#9AA3AF'];
  const NR = REGIONS.length, ETC = NR - 1, NATION = REGIONS.indexOf('전국');
  const NATION_CH = ['M'];   // 이 채널은 지역 글자가 없으면 '전국' (메타)
  const st = { period: 'd14', scope: 'all', unit: 'n', end: null, cFrom: null, cTo: null, cmp: false, kFrom: null, kTo: null, chg: false, chgType: 'all' };   // cmp = 비교, kFrom~kTo = 직접 지정 비교 기간(null이면 자동), chg = 변경이력   // cFrom~cTo = 직접 지정 기간   // end = 기준일 (null이면 오늘)
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '-';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const W = '일월화수목금토';
  const md = d => { const t = new Date(d * 864e5); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + '(' + W[t.getUTCDay()] + ')'; };
  let cacheKey = null, cache = null;

  function classify(text) {
    if (!text) return ETC;
    for (let i = 0; i < RULES.length; i++) if (RULES[i][1].test(text)) return REGIONS.indexOf(RULES[i][0]);
    return ETC;
  }
  function regionOfRows() {
    if (cacheKey === D) return cache;
    const nr = (D.notes || []).map(classify), cr = (D.campaigns || []).map(classify);
    const A = D.A, out = new Uint8Array(D.n);
    const natCh = new Set(D.names.map((n, c) => NATION_CH.indexOf(n) >= 0 ? c : -1).filter(c => c >= 0));
    for (let i = 0; i < D.n; i++) {
      let r = A.note[i] >= 0 ? nr[A.note[i]] : ETC;
      if (r === ETC && A.camp[i] >= 0) r = cr[A.camp[i]];
      if (r === ETC && natCh.has(A.src[i])) r = NATION;
      out[i] = r;
    }
    cacheKey = D; cache = out;
    return out;
  }
  let spKey = null, sp = null;   // 캠페인별 광고비 (구글 애즈 스크립트 → 캠페인비용_ 탭)
  function spend() {
    if (spKey === D) return sp;
    spKey = D; sp = null;
    const cs = D.cspend || {}, rows = [], chs = new Set(), nat = new Set();
    const reg = (cs.names || []).map(classify);
    if (cs.rows) cs.rows.split(';').forEach(t => { const p = t.split(','); const c = D.names.indexOf(p[1]); if (c < 0) return; rows.push([+p[0], c, reg[+p[2]], +p[3], +p[2], +p[4] || 0, +p[5] || 0, +p[6] || 0]); chs.add(c); });
    // 메타(M)는 캠페인별 비용이 없어 '광고비_메타' 일자별 금액(VAT 포함)을 통째로 '전국'에 넣어요.
    NATION_CH.forEach(n => { const c = D.names.indexOf(n); if (c < 0 || chs.has(c) || !D.spendCh || !D.spendCh[c] || !D.spendCh[c].size) return;
      D.spendCh[c].forEach((v, d) => { if (v) rows.push([d, c, NATION, v, -1, 0, 0, 0]); }); chs.add(c); nat.add(c); });
    if (!rows.length) return null;
    const last = rows.reduce((m, r) => Math.max(m, r[0]), 0);
    sp = { rows: rows, chs: chs, nat: nat, names: cs.names || [], last: last };
    return sp;
  }
  const man = v => v >= 1e4 ? (v / 1e4).toFixed(v >= 1e6 ? 0 : 1) + '만' : fmt(v);
  const todayDay = () => D.asOf ? D.asOf.day : D.max;
  const endDay = () => { const t = todayDay(); return st.end == null ? t : Math.max(D.min, Math.min(t, st.end)); };
  const iso = d => new Date(d * 864e5).toISOString().slice(0, 10);
  function range() {
    const end = endDay();
    const t = new Date(end * 864e5), y = t.getUTCFullYear(), m = t.getUTCMonth();
    const first = Math.floor(Date.UTC(y, m, 1) / 864e5);
    if (st.period === 'custom' && st.cFrom != null && st.cTo != null) return [Math.max(D.min, Math.min(st.cFrom, st.cTo)), Math.min(todayDay(), Math.max(st.cFrom, st.cTo))];
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

  // 비교 기간 기본값: 하루 → 전일, 7일 → 전주, 그 달 1일부터 → 전월 같은 기간, 전 달 → 그 전 달, 나머지 → 바로 앞 같은 길이
  function cmpRange(from, to) {
    if (st.kFrom != null && st.kTo != null) return [Math.min(st.kFrom, st.kTo), Math.max(st.kFrom, st.kTo), '직접 지정'];
    const ymd = d => { const t = new Date(d * 864e5); return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()]; };
    const dd = (y, m, d) => Math.floor(Date.UTC(y, m, d) / 864e5);
    if (st.period === 'month') { const [y, m, d] = ymd(to), last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [dd(y, m - 1, 1), dd(y, m - 1, Math.min(d, last)), '전월 같은 기간']; }
    if (st.period === 'prev') { const [y, m] = ymd(from); return [dd(y, m - 1, 1), from - 1, '그 전 달']; }
    const n = to - from + 1;
    return [from - n, from - 1, { d1: '전일', d7: '전주', d14: '직전 14일', d30: '직전 30일' }[st.period] || '직전 같은 기간'];
  }
  // 기간 합계용 집계 (비교 기간 계산에 사용)
  function agg(f, t, reg, SP) {
    const z = () => new Array(NR).fill(0), O = { tot: z(), cTot: z(), dTot: z(), imp: z(), clk: z(), conv: z() }, A = D.A;
    for (let i = 0; i < D.n; i++) {
      const d = A.day[i]; if (d < f || d > t) continue;
      const c = A.src[i]; if (!inScope(c)) continue;
      if (S.dedupe && A.dup[i]) continue;
      O.tot[reg[i]]++;
      if (SP && SP.chs.has(c)) O.dTot[SP.nat.has(c) ? NATION : reg[i]]++;
    }
    if (SP) SP.rows.forEach(r => { if (r[0] < f || r[0] > t || !inScope(r[1])) return; O.cTot[r[2]] += r[3]; O.imp[r[2]] += r[5]; O.clk[r[2]] += r[6]; O.conv[r[2]] += r[7]; });
    return O;
  }
  const sumA = a => a.reduce((x, y) => x + y, 0);
  const MET = {
    n: (O, j) => j < 0 ? sumA(O.tot) : O.tot[j],
    cost: (O, j) => j < 0 ? sumA(O.cTot) : O.cTot[j],
    cpa: (O, j) => { const c = j < 0 ? sumA(O.cTot) : O.cTot[j], d = j < 0 ? sumA(O.dTot) : O.dTot[j]; return c && d ? c / d : null; },
    imp: (O, j) => j < 0 ? sumA(O.imp) : O.imp[j],
    clk: (O, j) => j < 0 ? sumA(O.clk) : O.clk[j],
    ctr: (O, j) => { const i = j < 0 ? sumA(O.imp) : O.imp[j]; return i ? (j < 0 ? sumA(O.clk) : O.clk[j]) / i * 100 : null; },
    cvr: (O, j) => { const k = j < 0 ? sumA(O.clk) : O.clk[j]; return k ? (j < 0 ? sumA(O.conv) : O.conv[j]) / k * 100 : null; }
  };
  const GOOD = { n: 1, cost: 0, cpa: -1, imp: 1, clk: 1, ctr: 1, cvr: 1 };   // 1 = 늘면 좋음, -1 = 줄면 좋음, 0 = 색 없음
  // 비교 칸: 비교 기간 값 + 증감 (비율 지표는 %p)
  function cmpHtml(V, K, k, j) {
    if (!K) return '';
    const a = MET[k](V, j), b = MET[k](K, j), rate = k === 'ctr' || k === 'cvr';
    const show = v => k === 'cost' || k === 'imp' ? man(v) : rate ? v.toFixed(2) + '%' : fmt(v);
    if (!a && !b) return '';   // 두 기간 모두 0·없음이면 표시 안 함
    if (b == null) return '<span class="rg-cmp">비교 -</span>';
    if (a == null) return `<span class="rg-cmp">${show(b)}</span>`;
    const diff = a - b, dir = Math.abs(diff) < 1e-9 ? 0 : Math.sign(diff);
    const txt = rate ? (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%p' : b ? (diff >= 0 ? '+' : '') + (diff / b * 100).toFixed(1) + '%' : (a ? '신규' : '0%');
    const cls = !dir || !GOOD[k] ? '' : dir * GOOD[k] > 0 ? 'good' : 'bad';
    return `<span class="rg-cmp">${show(b)} <b class="${cls}">${dir > 0 ? '▲' : dir < 0 ? '▼' : ''}${txt}</b></span>`;
  }

  // 변경이력 (구글 애즈 → '변경이력_채널' 탭)
  const CHG_MAIN = /^(캠페인|예산|광고그룹|입찰 조정)$/;
  function chgList(f, t) {
    const C = (D.chg && D.chg.rows) || [];
    const chs = D.names.filter((n, c) => inScope(c) && C.some(r => r[2] === n));
    return { chs: chs, list: C.filter(r => r[0] >= f && r[0] <= t && chs.indexOf(r[2]) >= 0 && (st.chgType === 'all' || CHG_MAIN.test(r[5]))) };
  }
  function renderChg(from, to, cmp) {
    const side = $('rgSide');
    $('rgMain').classList.toggle('side', st.chg); side.hidden = !st.chg;
    if (!st.chg) return;
    if (!D.chg || !D.chg.rows || !D.chg.rows.length) { side.innerHTML = '<div class="rg-side-h"><b>변경이력</b></div><p class="m">아직 변경이력이 없어요. 구글 애즈 「광고비 기록」 스크립트를 새 버전으로 바꾸면 매시간 쌓여요.</p>'; return; }
    const f0 = cmp ? Math.min(from, cmp[0]) : from, t0 = cmp ? Math.max(to, cmp[1]) : to;
    const { chs, list } = chgList(f0, t0);
    if (!chs.length) { side.innerHTML = '<div class="rg-side-h"><b>변경이력</b></div><p class="m">채널에서 구글 계정(G·H·D·B·U)을 고르면 그 계정의 변경이력이 보여요. 전체·주력군을 고르면 해당 구글 계정이 모두 나와요.</p>'; return; }
    const multi = chs.length > 1, opc = { '추가': 'add', '변경': 'upd', '삭제': 'del' }, byDay = new Map();
    list.forEach(r => { if (!byDay.has(r[0])) byDay.set(r[0], []); byDay.get(r[0]).push(r); });
    const days = [...byDay.keys()].sort((a, b) => b - a);
    let shown = 0, html = '';
    for (const d of days) {
      if (shown >= 300) break;
      const items = byDay.get(d), inCmp = cmp && d >= cmp[0] && d <= cmp[1] && !(d >= from && d <= to);
      html += `<div class="rg-chg-day${inCmp ? ' cmp' : ''}">${md(d)}<span class="m">${items.length}건${inCmp ? ' · 비교 기간' : ''}</span></div><ul class="rg-chg">`;
      items.slice(0, 300 - shown).forEach(r => {
        const reg = classify(r[3]);
        html += `<li><div class="rg-chg-top"><span class="t">${esc(r[1])}</span><span class="op op-${opc[r[6]] || 'upd'}">${esc(r[6])}</span><b>${esc(r[5])}</b>${multi ? `<span class="ch">${esc(r[2])}</span>` : ''}</div>` +
          (r[3] ? `<div class="nm"><i style="background:${COLORS[reg]}" title="${REGIONS[reg]}"></i>${esc(r[3])}${r[4] ? ' <span class="m">› ' + esc(r[4]) + '</span>' : ''}</div>` : '') +
          (r[7] ? `<div class="dt">${esc(r[7])}</div>` : '') +
          `<div class="by">${esc(r[8] || '-')} · ${esc(r[9] || '')}</div></li>`;
      });
      shown += items.length; html += '</ul>';
    }
    side.innerHTML = `<div class="rg-side-h"><b>변경이력</b><span class="m">${esc(chs.join('·'))} · ${md(f0)}${f0 !== t0 ? ' ~ ' + md(t0) : ''} · ${fmt(list.length)}건</span></div>` +
      `<div class="seg rg-chg-f"><button data-chg="all" aria-pressed="${st.chgType === 'all'}">전체</button><button data-chg="main" aria-pressed="${st.chgType === 'main'}">캠페인·예산·광고그룹</button></div>` +
      (html || '<p class="m">이 기간에 변경 내역이 없어요.</p>') + (list.length > 300 ? `<p class="m">최근 300건만 보여요 (전체 ${fmt(list.length)}건).</p>` : '') +
      '<p class="m rg-chg-foot">구글 애즈 「변경 내역」 기준 · 매시간 갱신 · 구글은 최근 30일까지만 제공해서, 스크립트를 넣은 날의 29일 전부터 쌓여요.</p>';
  }

  function render() {
    const box = $('rgTable');
    if (!box || typeof D === 'undefined' || !D) return;
    const sc = scopes();
    if (!sc.some(s => s[0] === st.scope)) st.scope = 'all';
    $('rgScope').innerHTML = sc.map(s => `<button data-k="scope" data-v="${esc(s[0])}" aria-pressed="${s[0] === st.scope}">${esc(s[1])}</button>`).join('');
    document.querySelectorAll('#rgCtrl [data-k="period"], #rgCtrl [data-k="unit"]').forEach(b => b.setAttribute('aria-pressed', String(st[b.dataset.k] === b.dataset.v)));
    const ed = st.period === 'custom' ? range()[1] : endDay(), di = $('rgDate');
    di.min = iso(D.min); di.max = iso(todayDay()); di.value = iso(ed);
    $('rgPrev').disabled = ed <= D.min; $('rgNext').disabled = ed >= todayDay(); $('rgToday').disabled = ed >= todayDay();
    $('rgDow').textContent = W[new Date(ed * 864e5).getUTCDay()] + '요일' + (ed === todayDay() ? ' · 오늘' : '');
    const [rf, rt] = range();
    $('rgFrom').value = iso(rf); $('rgTo').value = iso(rt); $('rgFrom').min = $('rgTo').min = iso(D.min); $('rgFrom').max = $('rgTo').max = iso(todayDay());
    $('rgDays').textContent = (rt - rf + 1) + '일';
    $('rgCustom').classList.toggle('on', st.period === 'custom');
    const pl = { custom: '직접 지정', d1: '하루', d7: '7일', d14: '14일', d30: '30일', month: '그 달 1일부터', prev: '전 달' };
    document.querySelectorAll('#rgCtrl [data-k="period"]').forEach(b => { b.textContent = pl[b.dataset.v]; });

    const [from, to] = range(), nd = to - from + 1;
    const reg = regionOfRows(), A = D.A;
    const day = Array.from({ length: nd }, () => new Array(NR).fill(0));
    const chm = new Map();
    let noNote = 0;
    const etcNotes = new Map();
    for (let i = 0; i < D.n; i++) {
      const d = A.day[i]; if (d < from || d > to) continue;
      const c = A.src[i]; if (!inScope(c)) continue;
      if (S.dedupe && A.dup[i]) continue;
      const r = reg[i];
      day[d - from][r]++;
      if (!chm.has(c)) chm.set(c, new Array(NR).fill(0));
      chm.get(c)[r]++;
      if (r === ETC && A.note[i] < 0 && A.camp[i] < 0) noNote++;
      if (r === ETC) { const t = (A.note[i] >= 0 ? D.notes[A.note[i]] : '') || (A.camp[i] >= 0 ? D.campaigns[A.camp[i]] : '') || '(비고 없음)'; const k = D.names[c] + '\u0001' + t; etcNotes.set(k, (etcNotes.get(k) || 0) + 1); }
    }
    const tot = new Array(NR).fill(0); day.forEach(r => r.forEach((v, j) => { tot[j] += v; }));
    // 광고비·CPA (구글 애즈 캠페인 비용이 있는 채널만 비교)
    const SP = spend(), cost = Array.from({ length: nd }, () => new Array(NR).fill(0)), cdb = Array.from({ length: nd }, () => new Array(NR).fill(0));
    const chCost = new Map(), chDb = new Map(), etcCamp = new Map();
    const imp = new Array(NR).fill(0), clk = new Array(NR).fill(0), conv = new Array(NR).fill(0);   // 구글 애즈 노출·클릭·전환
    if (SP) {
      SP.rows.forEach(r => { if (r[0] < from || r[0] > to || !inScope(r[1])) return; cost[r[0] - from][r[2]] += r[3];
        imp[r[2]] += r[5]; clk[r[2]] += r[6]; conv[r[2]] += r[7];
        if (!chCost.has(r[1])) chCost.set(r[1], new Array(NR).fill(0)); chCost.get(r[1])[r[2]] += r[3];
        if (r[2] === ETC) { const k = D.names[r[1]] + '\u0001' + SP.names[r[4]]; etcCamp.set(k, (etcCamp.get(k) || 0) + r[3]); } });
      for (let i = 0; i < D.n; i++) {
        const d = A.day[i]; if (d < from || d > to) continue;
        const c = A.src[i]; if (!SP.chs.has(c) || !inScope(c)) continue;
        if (S.dedupe && A.dup[i]) continue;
        const rr = SP.nat.has(c) ? NATION : reg[i];   // 메타는 광고비를 나눌 수 없어 DB도 전부 '전국'으로 맞춰 CPA 계산
        cdb[d - from][rr]++;
        if (!chDb.has(c)) chDb.set(c, new Array(NR).fill(0)); chDb.get(c)[rr]++;
      }
    }
    const cTot = new Array(NR).fill(0), dTot = new Array(NR).fill(0);
    cost.forEach(r => r.forEach((v, j) => { cTot[j] += v; })); cdb.forEach(r => r.forEach((v, j) => { dTot[j] += v; }));
    const cAll = cTot.reduce((a, b) => a + b, 0), dAll = dTot.reduce((a, b) => a + b, 0);
    const CR = st.cmp ? cmpRange(from, to) : null;
    const V = { tot: tot, cTot: cTot, dTot: dTot, imp: imp, clk: clk, conv: conv }, K = CR ? agg(CR[0], CR[1], reg, SP) : null;
    const chgDay = new Map();
    if (st.chg) chgList(from, to).list.forEach(r => chgDay.set(r[0], (chgDay.get(r[0]) || 0) + 1));
    const cpa = (c, n) => c && n ? fmt(c / n) : (c ? '<span class="m">DB 0</span>' : '<span class="m">-</span>');
    const money = st.unit === 'cost' || st.unit === 'cpa';
    if (money && !SP) st.unit = 'n';
    const all = tot.reduce((a, b) => a + b, 0);
    const cell = (v, sum) => st.unit === 'pct' ? pct(v, sum) : fmt(v);

    // 요약 문장
    const top = REGIONS.slice(0, ETC).map((r, j) => [r, tot[j]]).sort((a, b) => b[1] - a[1]);
    $('rgLead').innerHTML = all
      ? `${from === to ? md(from) : md(from) + ' ~ ' + md(to)} <b>${fmt(all)}건</b> 중 <b>${top[0][0]} ${fmt(top[0][1])}건(${pct(top[0][1], all)})</b>이 가장 많고, ${top[1][0]} ${pct(top[1][1], all)}, ${top[2][0]} ${pct(top[2][1], all)} 순이에요.` +
        (tot[ETC] ? ` 지역을 알 수 없는 DB는 <b>${fmt(tot[ETC])}건(${pct(tot[ETC], all)})</b>으로 '기타'에 넣었어요.` : '')
      : '선택한 기간·채널에 DB가 없어요.';
    if (CR) { const kb = sumA(K.tot); $('rgLead').innerHTML += ` <span class="rg-cmp-lead">${CR[2]}(${CR[0] === CR[1] ? md(CR[0]) : md(CR[0]) + ' ~ ' + md(CR[1])}) ${fmt(kb)}건 대비 ${cmpHtml(V, K, 'n', -1).replace(/^<span class="rg-cmp">[^<]*/, '').replace(/<\/span>$/, '')}</span>`; }

    // 막대 (기간 비중)
    $('rgBar').innerHTML = all ? REGIONS.map((r, j) => tot[j] ? `<i style="width:${tot[j] / all * 100}%;background:${COLORS[j]}" title="${r} ${fmt(tot[j])}건 (${pct(tot[j], all)})"></i>` : '').join('') : '';
    $('rgLegend').innerHTML = REGIONS.map((r, j) => `<span><i style="background:${COLORS[j]}"></i>${r} <b>${pct(tot[j], all)}</b></span>`).join('');

    // 일자 × 지역
    const head = '<thead><tr><th>날짜</th>' + REGIONS.map((r, j) => `<th><i class="rg-dot" style="background:${COLORS[j]}"></i>${r}</th>`).join('') + '<th>합계</th></tr></thead>';
    let body = '<tr class="rg-sum"><td>기간 합계</td>' + tot.map((v, j) => `<td>${cell(v, all)}<span class="m">${st.unit === 'pct' ? fmt(v) + '건' : pct(v, all)}</span>${cmpHtml(V, K, 'n', j)}</td>`).join('') + `<td>${fmt(all)}${cmpHtml(V, K, 'n', -1)}</td></tr>`;
    if (SP) {
      body += '<tr class="rg-sum rg-money"><td>CPA <span class="m">광고비 있는 채널 DB 기준</span></td>' + cTot.map((v, j) => `<td>${cpa(v, dTot[j])}<span class="m">${dTot[j] ? fmt(dTot[j]) + '건' : ''}</span>${cmpHtml(V, K, 'cpa', j)}</td>`).join('') + `<td>${cpa(cAll, dAll)}<span class="m">${fmt(dAll)}건</span>${cmpHtml(V, K, 'cpa', -1)}</td></tr>`;
      body += '<tr class="rg-sum rg-money"><td>광고비 <span class="m">구글·메타·VAT포함</span></td>' + cTot.map((v, j) => `<td>${v ? man(v) : '<span class="m">-</span>'}${cmpHtml(V, K, 'cost', j)}</td>`).join('') + `<td>${man(cAll)}${cmpHtml(V, K, 'cost', -1)}</td></tr>`;
      const sum = a => a.reduce((x, y) => x + y, 0), iA = sum(imp), kA = sum(clk), vA = sum(conv);
      if (iA) {
        const dash = '<span class="m">-</span>', rate = (a, b) => b ? (a / b * 100).toFixed(2) + '%' : dash;
        const cnt = v => Math.round(v * 10) / 10;
        body += '<tr class="rg-sum rg-ads"><td>노출수 <span class="m">구글</span></td>' + imp.map((v, j) => `<td>${v ? man(v) : dash}${cmpHtml(V, K, 'imp', j)}</td>`).join('') + `<td>${man(iA)}${cmpHtml(V, K, 'imp', -1)}</td></tr>`;
        body += '<tr class="rg-sum rg-ads"><td>클릭수 <span class="m">구글</span></td>' + clk.map((v, j) => `<td>${v ? fmt(v) : dash}${cmpHtml(V, K, 'clk', j)}</td>`).join('') + `<td>${fmt(kA)}${cmpHtml(V, K, 'clk', -1)}</td></tr>`;
        body += '<tr class="rg-sum rg-ads"><td>클릭률 <span class="m">클릭÷노출</span></td>' + clk.map((v, j) => `<td>${rate(v, imp[j])}${cmpHtml(V, K, 'ctr', j)}</td>`).join('') + `<td>${rate(kA, iA)}${cmpHtml(V, K, 'ctr', -1)}</td></tr>`;
        body += '<tr class="rg-sum rg-ads"><td>전환율 <span class="m">구글 전환÷클릭</span></td>' + conv.map((v, j) => `<td>${rate(v, clk[j])}<span class="m">${v ? fmt(cnt(v)) + '건' : ''}</span>${cmpHtml(V, K, 'cvr', j)}</td>`).join('') + `<td>${rate(vA, kA)}<span class="m">${fmt(cnt(vA))}건</span>${cmpHtml(V, K, 'cvr', -1)}</td></tr>`;
      }
    }
    if (nd > 1) body += `<tr class="rg-sum rg-avg"><td>일평균</td>` + tot.map(v => `<td>${(v / nd).toFixed(1)}</td>`).join('') + `<td>${(all / nd).toFixed(1)}</td></tr>`;
    for (let k = nd - 1; k >= 0; k--) {
      const r = day[k], s = r.reduce((a, b) => a + b, 0), d = from + k;
      const wk = new Date(d * 864e5).getUTCDay();
      body += `<tr${wk === 0 || wk === 6 ? ' class="rg-we"' : ''}><td>${md(d)}${d === (D.asOf && D.asOf.day) ? ' <span class="m">진행 중</span>' : ''}${chgDay.get(d) ? ` <span class="rg-chgmark" title="구글 애즈 변경 ${chgDay.get(d)}건">변경 ${chgDay.get(d)}</span>` : ''}</td>` +
        (st.unit === 'cost' ? cost[k].map(v => `<td>${v ? man(v) : '<span class="m">-</span>'}</td>`).join('') + `<td><b>${man(cost[k].reduce((a, b) => a + b, 0))}</b></td></tr>`
        : st.unit === 'cpa' ? cost[k].map((v, j) => { const x = v && cdb[k][j] ? v / cdb[k][j] : 0, base = dTot[j] ? cTot[j] / dTot[j] : 0; const cls = x && base && cdb[k][j] >= 3 && Math.abs(x / base - 1) >= 0.25 ? (x < base ? ' class="hi"' : ' class="lo"') : ''; return `<td${cls}>${cpa(v, cdb[k][j])}</td>`; }).join('') + `<td><b>${cpa(cost[k].reduce((a, b) => a + b, 0), cdb[k].reduce((a, b) => a + b, 0))}</b></td></tr>`
        : r.map((v, j) => { const share = s ? v / s : 0, base = all ? tot[j] / all : 0, diff = share - base; const cls = s >= 10 && Math.abs(diff) >= 0.08 ? (diff > 0 ? ' class="hi"' : ' class="lo"') : ''; return `<td${cls}>${v ? cell(v, s) : '<span class="m">-</span>'}</td>`; }).join('') +
        `<td><b>${fmt(s)}</b></td></tr>`);
    }
    box.innerHTML = head + '<tbody>' + body + '</tbody>';

    // 채널 × 지역
    const chs = [...chm.keys()].sort((a, b) => a - b);
    $('rgChTable').innerHTML = '<thead><tr><th>채널</th>' + REGIONS.map(r => `<th>${r}</th>`).join('') + '<th>합계</th></tr></thead><tbody>' +
      chs.map(c => { const r = chm.get(c), s = r.reduce((a, b) => a + b, 0);
        if (money && SP && SP.chs.has(c)) { const cc = chCost.get(c) || new Array(NR).fill(0), dd = chDb.get(c) || new Array(NR).fill(0), cs = cc.reduce((a, b) => a + b, 0), ds = dd.reduce((a, b) => a + b, 0);
          return `<tr><td>${esc(D.names[c])}</td>` + cc.map((v, j) => `<td>${st.unit === 'cost' ? (v ? man(v) : '<span class="m">-</span>') : cpa(v, dd[j])}</td>`).join('') + `<td><b>${st.unit === 'cost' ? man(cs) : cpa(cs, ds)}</b></td></tr>`; }
        if (money) return `<tr><td>${esc(D.names[c])}</td>` + r.map(() => '<td><span class="m">-</span></td>').join('') + '<td><span class="m">비용 없음</span></td></tr>';
        return `<tr><td>${esc(D.names[c])}</td>` + r.map(v => `<td>${v ? cell(v, s) : '<span class="m">-</span>'}</td>`).join('') + `<td><b>${fmt(s)}</b></td></tr>`; }).join('') +
      '</tbody>';
    const etcTop = [...etcNotes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15);
    $('rgEtc').innerHTML = etcTop.length ? '<summary>기타로 분류된 비고 보기 (' + fmt(tot[ETC]) + '건)</summary><table class="rg-tbl"><thead><tr><th>채널</th><th>비고(캠페인명)</th><th>건수</th></tr></thead><tbody>' +
      etcTop.map(([k, n]) => { const p = k.split('\u0001'); return `<tr><td>${esc(p[0])}</td><td style="text-align:left;white-space:normal">${esc(p[1])}</td><td>${fmt(n)}</td></tr>`; }).join('') + '</tbody></table>' : '';
    if (SP && etcCamp.size) {
      const ec = [...etcCamp.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
      $('rgEtc').innerHTML += '<p class="m" style="margin:10px 0 4px">기타로 분류된 캠페인 광고비</p><table class="rg-tbl"><thead><tr><th>채널</th><th>캠페인</th><th>광고비</th></tr></thead><tbody>' +
        ec.map(([k, v]) => { const p = k.split('\u0001'); return `<tr><td>${esc(p[0])}</td><td style="text-align:left;white-space:normal">${esc(p[1])}</td><td>${man(v)}</td></tr>`; }).join('') + '</tbody></table>';
      if (!$('rgEtc').querySelector('summary')) $('rgEtc').insertAdjacentHTML('afterbegin', '<summary>세부정보</summary>');
    }
    $('rgSpNote').textContent = SP ? '광고비·CPA: 구글 애즈 캠페인 이름의 지역 글자로 나눈 금액(부가세 포함) ÷ 같은 지역 DB (' + [...SP.chs].filter(c => !SP.nat.has(c)).map(c => D.names[c]).join('·') + ')' + (SP.nat.size ? ' · 메타(' + [...SP.nat].map(c => D.names[c]).join('·') + ')는 광고비·DB 모두 전국으로 계산' : '') + ' · 광고비 ' + md(SP.last) + '까지 · 노출·클릭·전환은 구글 애즈 값(전환은 구글 애즈 전환 기준)' : '광고비·CPA는 구글 애즈 「광고비 기록」 스크립트를 새 버전으로 바꾸면 나와요.';
    $('rgCmpOn').checked = st.cmp; $('rgChgOn').checked = st.chg; $('rgCmpRow').hidden = !st.cmp;
    if (CR) { $('rgKFrom').value = iso(CR[0]); $('rgKTo').value = iso(CR[1]); $('rgKFrom').max = $('rgKTo').max = iso(todayDay());
      $('rgKLab').textContent = (CR[1] - CR[0] + 1) + '일 · ' + CR[2]; $('rgKAuto').hidden = st.kFrom == null; }
    $('rgCmpNote').hidden = !CR;
    if (CR) $('rgCmpNote').innerHTML = `각 칸 아래 작은 글씨는 <b>비교 기간(${CR[2]} ${md(CR[0])}${CR[0] !== CR[1] ? ' ~ ' + md(CR[1]) : ''})</b> 값과 증감이에요. <span class="good">파란색</span>은 좋아짐, <span class="bad">빨간색</span>은 나빠짐 (CPA는 낮아지면 좋음, 광고비는 색 없음, 클릭률·전환율은 %p 차이).`;
    renderChg(from, to, CR);
    $('rgNote').textContent = '분류 기준: 비고(캠페인명)에 경기남부·수원·용인·화성·부천 등 → 경기남부, 충청 → 충청도, 서울, 전북·강원 → 전북/강원, 경북·대구 → 경북, 그 외 경기·MASS·MAIN → 경기남부, 메타(META·M 채널) → 전국, 나머지 → 기타' + (S.dedupe ? ' · 중복 제외 적용' : '');
  }

  document.addEventListener('click', e => {
    const nav = e.target.closest('#rgPrev, #rgNext, #rgToday');
    if (nav && !nav.disabled) {
      if (st.period === 'custom') {   // 직접 지정 기간은 통째로 하루씩 이동, [오늘]은 끝을 오늘로
        const [f, t] = range(), n = nav.id === 'rgToday' ? todayDay() - t : (nav.id === 'rgPrev' ? -1 : 1);
        st.cFrom = f + n; st.cTo = t + n; if (st.cTo > todayDay()) { st.cFrom -= st.cTo - todayDay(); st.cTo = todayDay(); }
        render(); return;
      }
      st.end = nav.id === 'rgToday' ? null : endDay() + (nav.id === 'rgPrev' ? -1 : 1);
      if (st.end != null && st.end >= todayDay()) st.end = null;
      render(); return;
    }
    if (e.target.id === 'rgKAuto') { st.kFrom = st.kTo = null; render(); return; }
    const cf = e.target.closest('#rgSide [data-chg]'); if (cf) { st.chgType = cf.dataset.chg; render(); return; }
    const b = e.target.closest('#rgCtrl [data-k]'); if (!b) return;
    if (b.dataset.v === 'custom' && st.period !== 'custom') { const [f, t] = range(); st.cFrom = f; st.cTo = t; }
    if (b.dataset.k === 'period' && b.dataset.v !== 'custom' && st.period === 'custom') { const t = range()[1]; st.end = t >= todayDay() ? null : t; }   // 직접 지정 → 다른 기간: 끝 날짜를 기준일로 유지
    st[b.dataset.k] = b.dataset.v; render();
  });
  document.addEventListener('change', e => {
    if ((e.target.id === 'rgFrom' || e.target.id === 'rgTo') && e.target.value) {
      const [f, t] = range(), x = e.target.value.split('-'), d = Math.floor(Date.UTC(+x[0], +x[1] - 1, +x[2]) / 864e5);
      st.cFrom = e.target.id === 'rgFrom' ? d : f; st.cTo = e.target.id === 'rgTo' ? d : t;
      if (st.cFrom > st.cTo) { const z = st.cFrom; st.cFrom = st.cTo; st.cTo = z; }
      st.period = 'custom'; render(); return;
    }
    if (e.target.id === 'rgCmpOn') { st.cmp = e.target.checked; render(); return; }
    if (e.target.id === 'rgChgOn') { st.chg = e.target.checked; render(); return; }
    if ((e.target.id === 'rgKFrom' || e.target.id === 'rgKTo') && e.target.value) {
      const [f, t] = range(), c0 = cmpRange(f, t), x = e.target.value.split('-'), d = Math.floor(Date.UTC(+x[0], +x[1] - 1, +x[2]) / 864e5);
      st.kFrom = e.target.id === 'rgKFrom' ? d : c0[0]; st.kTo = e.target.id === 'rgKTo' ? d : c0[1];
      render(); return;
    }
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
