/* DB 유입 이상 감지 — 실시간 현황 맨 위 '점검 필요' 카드
 * app.js가 데이터를 받을 때마다 renderAlerts()를 호출합니다.
 * 규칙은 아래 RULE 값만 바꾸면 민감도를 조절할 수 있어요.
 */
(function () {
  const RULE = {
    baseDays: 14,        // 평소 = 최근 14일(오늘 제외) 하루 평균
    minBase: 3,          // 평소 하루 3건 미만 채널은 급감 판단에서 제외 (너무 들쭉날쭉)
    zeroDaysWarn: 1,     // 하루 통째로 0건 → 긴급 (평소 하루 minBase 이상인 채널)
    gapHours: 3,         // 오늘 n시간 연속 0건이면서
    gapExpect: 4,        //   평소 그 시간대에 이 건수 이상 들어왔으면 → 긴급
    dropRatio: 0.5,      // 어제가 평소의 50% 미만 → 주의
    lowStreak: 3,        // 3일 연속
    lowRatio: 0.7,       //   평소의 70% 미만 → 주의
    fcRatio: 0.6,        // 오늘 예측이 평소의 60% 미만 (11시 이후) → 주의
    spikeMin: 10,        // 한 시간에 10건 이상이면서
    spikeX: 4,           //   평소 그 시간의 4배 이상 → 확인 (봇·중복 의심)
    cpaX: 1.5            // 어제 CPA가 최근 14일 CPA의 1.5배 이상 → 주의
  };
  const LV = { 2: ['긴급', 'a-crit'], 1: ['주의', 'a-warn'], 0: ['확인', 'a-info'] };
  const KEY = 'luna-alert-ack';

  function ackLoad() { try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function ackSave(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 저장 불가 환경 무시 */ } }

  function detect() {
    const A = D.A, today = D.asOf.day, t = D.asOf.t, nc = D.names.length, W = 60, start = today - W + 1;
    const cnt = Array.from({ length: nc }, () => Array.from({ length: W }, () => new Float64Array(25)));
    for (let i = 0; i < D.n; i++) {
      const d = A.day[i]; if (d < start || d > today) continue;
      if (S.dedupe && A.dup[i]) continue;
      const h = A.hour[i];
      cnt[A.src[i]][d - start][h >= 0 ? h : 24]++;
    }
    const day = (c, d) => { if (d < start || d > today) return 0; let s = 0; const r = cnt[c][d - start]; for (let h = 0; h < 25; h++) s += r[h]; return s; };
    const hr = (c, d, h) => (d < start || d > today) ? 0 : cnt[c][d - start][h];
    const first = D.firstDay;
    const realtime = D.names.map((_, c) => { for (let d = today - 28; d <= today; d++) for (let h = 0; h < 24; h++) if (hr(c, d, h)) return true; return false; });
    const lastIn = D.names.map((_, c) => { for (let d = today; d >= start; d--) if (day(c, d)) return d; return null; });
    function base(c, end, n) { // end 이전 n일 평균 (채널 시작 전 날짜 제외)
      const s = Math.max(end - n, first[c], start); if (!isFinite(s) || end - s < 7) return null;
      let sum = 0; for (let d = s; d < end; d++) sum += day(c, d); return sum / (end - s);
    }
    function hourBase(c, h) { let s = 0, k = 0; for (let d = today - RULE.baseDays; d < today; d++) { if (d < first[c]) continue; s += hr(c, d, h); k++; } return k ? s / k : 0; }
    const dl = d => { const x = new Date(d * 864e5); return (x.getUTCMonth() + 1) + '/' + x.getUTCDate() + '(' + DOW[dowOf(d)] + ')'; };
    const out = [];
    const L = (typeof buildLive === 'function') ? buildLive() : null;

    D.names.forEach((nm, c) => {
      if (!isFinite(first[c]) || today - first[c] < 10) return; // 새 채널은 데이터가 쌓일 때까지 제외
      const b = base(c, today, RULE.baseDays);
      if (b == null) return;

      // 1) 하루 통째로 0건 (수기 채널은 마지막 입력일 이후 '입력 누락'으로 별도 처리)
      if (realtime[c]) {
        let z = 0; for (let d = today - 1; d >= today - 14; d--) { if (day(c, d) === 0) z++; else break; }
        const zeroAlert = z >= RULE.zeroDaysWarn && b >= RULE.minBase;
        if (zeroAlert) {
          const b0 = base(c, today - z, RULE.baseDays) || b, tz = day(c, today) === 0;
          out.push({ lv: 2, id: nm + ':zero:' + (today - z), ch: c, title: `${nm} ${z === 1 ? '어제' : z + '일 연속'} 유입 0건${tz ? ' (오늘도 0건)' : ''}`,
            text: `${dl(today - z)}부터 DB가 한 건도 없어요 (평소 하루 ${fmt(b0)}건). 광고 중단·폼 오류·시트 연동을 점검해 주세요.` });
        }
        // 2) 오늘 n시간 연속 0건
        const nowH = Math.floor(t);
        let g = 0, exp = 0;
        for (let h = nowH - 1; h >= 0; h--) { if (hr(c, today, h) > 0) break; g++; exp += hourBase(c, h); }
        if (!zeroAlert && g >= RULE.gapHours && exp >= RULE.gapExpect) {
          out.push({ lv: 2, id: nm + ':gap:' + today + ':' + (nowH - g), ch: c, title: `${nm} ${nowH - g}시 이후 ${g}시간째 0건`,
            text: `평소 같은 시간대엔 약 ${fmt(exp)}건이 들어와요. 광고 상태와 신청 폼을 확인해 주세요.` });
        }
      } else if (lastIn[c] != null && today - lastIn[c] >= 3 && b >= 1) {
        out.push({ lv: 1, id: nm + ':manual:' + lastIn[c], ch: c, title: `${nm} 수기 입력 ${today - lastIn[c] - 1}일 누락`,
          text: `마지막 입력은 ${dl(lastIn[c])}이에요. 수동DB 입력을 확인해 주세요.` });
      }

      if (b < RULE.minBase) return;
      const y = day(c, today - 1);
      const zeroAlready = realtime[c] && y === 0;
      // 3) 어제 급감
      if (!zeroAlready && y < b * RULE.dropRatio && (realtime[c] || lastIn[c] >= today - 1)) {
        out.push({ lv: 1, id: nm + ':drop:' + (today - 1), ch: c, title: `${nm} 어제 ${fmt(y)}건 — 평소의 ${Math.round(y / b * 100)}%`,
          text: `최근 ${RULE.baseDays}일 평균 ${fmt(b)}건 대비 크게 줄었어요.` });
      }
      // 4) n일 연속 저조
      if (!zeroAlready) {
        const b3 = base(c, today - RULE.lowStreak, 28);
        if (b3 && b3 >= RULE.minBase) {
          let ok = true; const vals = [];
          for (let d = today - RULE.lowStreak; d < today; d++) { const v = day(c, d); vals.push(v); if (v >= b3 * RULE.lowRatio) ok = false; }
          if (ok && realtime[c]) out.push({ lv: 1, id: nm + ':low:' + today, ch: c, title: `${nm} ${RULE.lowStreak}일 연속 저조`,
            text: `최근 ${RULE.lowStreak}일 ${vals.map(fmt).join(' → ')}건, 그 전 4주 평균(${fmt(b3)}건)의 ${Math.round(RULE.lowRatio * 100)}% 미만이에요.` });
        }
      }
      // 5) 오늘 예측 저조
      if (L && realtime[c] && t >= 11 && L.ch && L.ch[c]) {
        const fc = L.ch[c].fc;
        if (fc < b * RULE.fcRatio && !out.some(a => a.ch === c && a.lv === 2)) {
          out.push({ lv: 1, id: nm + ':fc:' + today, ch: c, title: `${nm} 오늘 예상 ${fmt(fc)}건 — 평소의 ${Math.round(fc / b * 100)}%`,
            text: `${D.asOf.label} 현재 ${fmt(L.ch[c].so)}건. 이대로면 평소(${fmt(b)}건)보다 크게 적게 마감해요.` });
        }
      }
      // 6) 한 시간 몰림 (오늘·어제)
      if (realtime[c]) [today, today - 1].forEach(d => {
        for (let h = 0; h < 24; h++) {
          const v = hr(c, d, h), hb = hourBase(c, h);
          if (v >= RULE.spikeMin && v >= Math.max(1, hb) * RULE.spikeX) {
            out.push({ lv: 0, id: nm + ':spike:' + d + ':' + h, ch: c, title: `${nm} ${dl(d)} ${h}시 ${fmt(v)}건 몰림`,
              text: `평소 이 시간 ${fmt(hb)}건의 ${Math.round(v / Math.max(1, hb))}배예요. 봇·중복 제출인지 확인해 주세요.` });
          }
        }
      });
      // 7) CPA 급등 (광고비가 있는 날 기준)
      const sp = D.spendCh && D.spendCh[c];
      if (sp && sp.size) {
        let ld = null; for (let d = today - 1; d >= today - 3; d--) if (sp.get(d) > 0) { ld = d; break; }
        if (ld != null && day(c, ld) > 0) {
          let s = 0, n = 0; for (let d = ld - 14; d < ld; d++) { const v = sp.get(d); if (v > 0) { s += v; n += day(c, d); } }
          const cpa = sp.get(ld) / day(c, ld), avg = n ? s / n : 0;
          if (avg && cpa >= avg * RULE.cpaX) out.push({ lv: 1, id: nm + ':cpa:' + ld, ch: c, title: `${nm} ${dl(ld)} CPA ${fmt(cpa)}원 — 평소의 ${(cpa / avg).toFixed(1)}배`,
            text: `최근 14일 CPA ${fmt(avg)}원. 광고비 ${wonShort(sp.get(ld))}원 · DB ${fmt(day(c, ld))}건.` });
        }
      }
    });
    return out.sort((a, b) => b.lv - a.lv || a.ch - b.ch);
  }

  window.renderAlerts = function () {
    const box = document.getElementById('alertBox'); if (!box || !D) return;
    let list;
    try { list = detect(); } catch (e) { box.innerHTML = ''; console.error(e); return; }
    const ack = ackLoad(), todayKey = String(D.asOf.day);
    Object.keys(ack).forEach(k => { if (ack[k] !== todayKey) delete ack[k]; }); ackSave(ack);
    const vis = list.filter(a => !ack[a.id]), hidden = list.length - vis.length;
    const crit = vis.filter(a => a.lv === 2).length;
    const tab = document.querySelector('.tabs [data-page="live"]');
    if (tab) { let b = tab.querySelector('.a-badge'); if (!b) { b = document.createElement('span'); b.className = 'a-badge'; tab.appendChild(b); } b.textContent = vis.length || ''; b.dataset.crit = crit ? '1' : ''; }
    if (!vis.length) {
      box.innerHTML = `<div class="a-ok">● 유입 이상 없음 <span class="note">${D.asOf.label} 기준 · 채널 ${D.names.length}개 점검${hidden ? ` · 확인 처리 ${hidden}건 숨김 <button class="linkbtn" data-a-reset>다시 보기</button>` : ''}</span></div>`;
      return;
    }
    box.innerHTML = `<div class="chead"><h2>점검 필요 <span class="a-count${crit ? ' crit' : ''}">${vis.length}</span></h2><span class="note">${D.asOf.label} 기준 자동 감지 · 평소 = 최근 ${RULE.baseDays}일 평균${hidden ? ` · 확인 ${hidden}건 숨김 <button class="linkbtn" data-a-reset>다시 보기</button>` : ''}</span></div>` +
      '<ul class="a-list">' + vis.map(a => `<li class="${LV[a.lv][1]}"><span class="a-lv">${LV[a.lv][0]}</span><div class="a-body"><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div><button class="btn a-ack" data-a-ack="${esc(a.id)}" title="오늘 하루 숨기기">확인</button></li>`).join('') + '</ul>';
  };

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-a-ack]');
    if (a) { const o = ackLoad(); o[a.dataset.aAck] = String(D.asOf.day); ackSave(o); window.renderAlerts(); return; }
    if (e.target.closest('[data-a-reset]')) { ackSave({}); window.renderAlerts(); }
  });
  // app.js가 먼저 데이터를 받아 둔 경우 바로 그리기
  try { if (typeof D !== 'undefined' && D) window.renderAlerts(); } catch (e) { /* 무시 */ }
})();
