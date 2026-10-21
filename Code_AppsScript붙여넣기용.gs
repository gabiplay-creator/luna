/**
 * 글로벌랩스 DB 대시보드 — 데이터 API (Apps Script)
 *
 * 이 파일은 GitHub가 아니라 구글 시트의 [확장 프로그램 → Apps Script]에 붙여넣어 사용합니다.
 * 시트를 읽어 개인정보(이름·연락처)를 뺀 집계용 JSON을 반환합니다.
 * 연락처는 중복 판별에만 서버 안에서 사용하고 밖으로 내보내지 않습니다.
 */

// 간단한 접근 키. 대시보드 config.js의 TOKEN과 같은 값으로 맞추세요.
// 공개 저장소에서는 이 값도 보이므로, URL을 우연히 발견한 사람을 막는 정도의 용도입니다.
const ACCESS_TOKEN = '';

// 탭 이름이 GL(…) 또는 GL[…] 형식이면 채널로 자동 인식합니다. (예: GL(K), GL(AB))
// 'GL[G]_DB', 'GL(J) 4월1일 -> GL(H)'처럼 뒤에 다른 글자가 붙은 탭은 제외됩니다.
const CHANNEL_PATTERN = /^GL\s*[\(\[]\s*[^\)\]]+?\s*[\)\]]$/i;

// 표시 순서. 여기에 없는 새 채널은 시트의 탭 순서대로 뒤에 붙습니다.
const PREFERRED_ORDER = ['GL(G)', 'GL(H)', 'GL(D)', 'GL(B)', 'GL(U)', 'GL(M)', 'GL(T)', 'GL(K)', 'GL(MT)', 'GL(TB)'];

// 형식은 맞지만 대시보드에서 빼고 싶은 탭이 있으면 여기에 이름을 적으세요. 예: ['GL(X)']
const EXCLUDE_SHEETS = [];

// 이름이 GL(…) 형식은 아니지만 DB 원본으로 읽을 탭 (A열 일자 · C열 연락처 형식이면 됨)
const EXTRA_SOURCE_TABS = ['PLAN', '홈페이지'];

// 칸 이름 후보 (새 탭의 칸 이름이 조금 달라도 찾을 수 있게)
const DATE_HEADERS = ['일자', '제출일시', '날짜', '일시', '접수일시', '신청일시', '등록일시', '타임스탬프', 'timestamp', 'date', 'created_time', 'created_at'];
const PHONE_HEADERS = ['연락처', '전화번호', '휴대폰', '휴대폰번호', '핸드폰', 'phone', 'phone_number', 'tel'];

// 결과 저장 시간(초). 10분마다 warmCache 트리거가 미리 계산해 두므로 대시보드는 저장된 값을 바로 가져갑니다.
const CACHE_SECONDS = 21600; // 6시간(최대값)
const WARM_MINUTES = 10;     // 미리 계산 주기 (1, 5, 10, 15, 30 중 선택)

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (ACCESS_TOKEN && p.token !== ACCESS_TOKEN) return json_({ error: 'unauthorized' });
  try {
    return ContentService.createTextOutput(getCachedData_(p.refresh === '1'))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 처음 한 번만 실행: 10분마다 데이터를 미리 계산해 두는 트리거 등록 */
function setupCacheTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'warmCache') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('warmCache').timeBased().everyMinutes(WARM_MINUTES).create();
  warmCache();
}

/** 트리거가 실행: 시트를 읽어 결과를 저장 (실행 시간이 로그에 남아요) */
function warmCache() {
  const t0 = Date.now();
  try { syncCrmSpendThrottled_(); } catch (e) { Logger.log('CRM 광고비 가져오기 실패: ' + e.message); }
  const json = buildAndCache_(true);
  Logger.log('미리 계산 완료: ' + ((Date.now() - t0) / 1000).toFixed(1) + '초, ' + Math.round(json.length / 1024) + 'KB');
}

function getCachedData_(force) {
  if (!force) { const hit = readCache_(); if (hit) return hit; }
  return buildAndCache_(false);
}

/** CacheService는 항목당 100KB 제한이 있어 결과를 잘게 나눠 저장하고, 'dash:cur'가 최신 묶음을 가리킵니다. */
function readCache_() {
  const cache = CacheService.getScriptCache();
  const cur = cache.get('dash:cur');
  if (!cur) return null;
  const p = cur.split('|'), keys = [];
  for (let i = 0; i < Number(p[1]); i++) keys.push('dash:' + p[0] + ':' + i);
  const got = cache.getAll(keys);
  if (!keys.every(function (k) { return got[k] != null; })) return null;
  return keys.map(function (k) { return got[k]; }).join('');
}

function buildAndCache_(isWarm) {
  const cache = CacheService.getScriptCache();
  // 다른 실행이 이미 계산 중이면 그 결과를 기다렸다가 사용 (여러 명이 동시에 열어도 시트는 한 번만 읽음)
  if (!isWarm && cache.get('dash:building')) {
    for (let i = 0; i < 45; i++) {
      Utilities.sleep(2000);
      if (!cache.get('dash:building')) { const hit = readCache_(); if (hit) return hit; break; }
    }
  }
  cache.put('dash:building', '1', 180);
  try {
    const json = getDashboardData();
    try {
      const id = Date.now().toString(36), size = 30000, parts = {};
      let n = 0;
      for (let i = 0; i < json.length; i += size) parts['dash:' + id + ':' + (n++)] = json.slice(i, i + size);
      cache.putAll(parts, CACHE_SECONDS);
      const old = cache.get('dash:cur');
      cache.put('dash:cur', id + '|' + n, CACHE_SECONDS);
      if (old) { const o = old.split('|'), ks = []; for (let i = 0; i < Number(o[1]); i++) ks.push('dash:' + o[0] + ':' + i); cache.removeAll(ks); }
    } catch (err) { /* 저장 실패는 무시하고 결과만 반환 */ }
    return json;
  } finally {
    cache.remove('dash:building');
  }
}

/** 모든 채널 탭을 읽어 압축된 JSON 문자열로 반환 */
function getDashboardData() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.openById('1GgecwoK7Fp5Px_DSFFPgq0a3zYnx6KLgkrqe18k32nk');
  const notes = new Dict();
  const platforms = new Dict();
  const campaigns = new Dict();
  const out = [];
  const report = [];
  const maxDay = Math.floor(Date.now() / 86400000) + 2; // 미래 날짜 오입력 방지
  const SOURCE_SHEETS = getSourceSheets_(ss);
  const autoHas = new Set(); // 자동 탭에 데이터가 있는 '채널,일자'

  SOURCE_SHEETS.forEach(function (name, s) {
    const sh = ss.getSheetByName(name);
    if (!sh) { report.push({ name: name, rows: 0, skipped: 0, noTime: 0, dup: 0, missing: true }); return; }

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(1, sh.getLastColumn());
    if (lastRow < 2) { report.push({ name: name, rows: 0, skipped: 0, noTime: 0, dup: 0 }); return; }

    const header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    const lower = header.map(function (h) { return h.toLowerCase(); });
    const findCol = function (cands) {
      for (let k = 0; k < cands.length; k++) { const i = lower.indexOf(cands[k].toLowerCase()); if (i >= 0) return i; }
      return -1;
    };
    const cDate = Math.max(0, findCol(DATE_HEADERS));
    const cPhone = findCol(PHONE_HEADERS);
    const cNote = header.indexOf('비고');
    const cPlat = header.indexOf('platform');
    const cCamp = header.indexOf('campaign_name');
    const width = Math.max(1, cDate, cPhone, cNote, cPlat, cCamp) + 1;
    const values = sh.getRange(2, 1, lastRow - 1, width).getValues();

    const seen = new Set();
    let rows = 0, skipped = 0, noTime = 0, dupCount = 0;
    const copyNote = copyNoteMap_(ss, name);   // GL(G) → GL(G_1) 복사 탭의 비고(캠페인명)로 빈 비고 채우기 (지역 통계용)

    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      const t = parseTs(r[cDate]);
      if (!t || t.day > maxDay) {
        if (r.some(function (v) { return v !== '' && v !== null; })) skipped++;
        continue;
      }
      const phone = cPhone >= 0 ? normPhone(r[cPhone]) : '';
      let dup = 0;
      if (phone) {
        if (seen.has(phone)) { dup = 1; dupCount++; } else { seen.add(phone); }
      }
      let noteText = cNote >= 0 ? String(r[cNote] == null ? '' : r[cNote]).trim() : '';
      if (!noteText && copyNote && phone) noteText = copyNote.get(phone + '|' + t.day) || '';
      const note = notes.id(noteText);
      const plat = cPlat >= 0 ? platforms.id(r[cPlat]) : -1;
      const camp = cCamp >= 0 ? campaigns.id(r[cCamp]) : -1;

      out.push(s + ',' + t.day + ',' + t.hour + ',' + note + ',' + plat + ',' + camp + ',' + dup);
      autoHas.add(s + ',' + t.day);
      rows++;
      if (t.hour < 0) noTime++;
    }
    report.push({ name: name, rows: rows, skipped: skipped, noTime: noTime, dup: dupCount });
  });

  // ---- 수동DB 탭: 자동 시트가 아직 없는 채널·날짜를 손으로 채움 (같은 채널·날짜에 자동 데이터가 있으면 자동 우선) ----
  const manualInfo = { tab: MANUAL_DB_TAB, used: 0, skipped: 0, entries: [] };
  const recentFrom = Math.floor(Date.now() / 86400000) - 62;
  const idxByShort = {};
  SOURCE_SHEETS.forEach(function (n, i) { idxByShort[shortName_(n)] = i; });
  readManualDb_(ss).forEach(function (m) {
    const key = shortName_(m.ch);
    let s = idxByShort[key];
    if (s === undefined) {
      s = SOURCE_SHEETS.length; SOURCE_SHEETS.push(key); idxByShort[key] = s;
      report.push({ name: key, rows: 0, skipped: 0, noTime: 0, dup: 0, manual: true });
    }
    const autoWins = autoHas.has(s + ',' + m.day);
    if (m.day >= recentFrom) manualInfo.entries.push({ day: m.day, ch: key, n: m.n, used: !autoWins });
    if (autoWins) { manualInfo.skipped += m.n; return; }
    for (let i = 0; i < m.n; i++) out.push(s + ',' + m.day + ',-1,-1,-1,-1,0');
    const rep = report.filter(function (r) { return shortName_(r.name) === key; })[0];
    if (rep) { rep.manualRows = (rep.manualRows || 0) + m.n; if (rep.manual) { rep.rows += m.n; rep.noTime += m.n; } }
    manualInfo.used += m.n;
  });

  return JSON.stringify({
    goals: readGoals_(ss),
    manualDb: manualInfo,
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy.MM.dd HH:mm'),
    buildSec: Math.round((Date.now() - t0) / 100) / 10,
    sources: SOURCE_SHEETS,
    notes: notes.list,
    platforms: platforms.list,
    campaigns: campaigns.list,
    report: report,
    rows: out.join(';'),
    spend: readSpend_(ss),
    camp: readCampaigns_(ss)
  });
}

// 구글 애즈 캠페인 감시 탭(구글애즈_캠페인감시 스크립트가 매시간 기록) → 대시보드 '점검 필요'용
const CAMPAIGN_TAB = '캠페인_일별';
function readCampaigns_(ss) {
  const sh = ss.getSheetByName(CAMPAIGN_TAB);
  if (!sh || sh.getLastRow() < 2) return null;
  const head = sh.getRange(1, 1, 1, Math.max(10, sh.getLastColumn())).getDisplayValues()[0];
  const upd = (String(head[9] || '').match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/) || [''])[0];
  const names = new Dict(), rows = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().forEach(function (r) {
    const t = parseTs(r[0]); if (!t || !r[1] || !r[2]) return;
    // 일 | 채널 | 캠페인번호 | 지역 | 상태(1=사용) | 비용(VAT 포함) | 클릭 | 전환
    rows.push([t.day, String(r[1]).trim(), names.id(r[2]), String(r[3] || '기타').trim(),
      String(r[4]).toUpperCase() === 'ENABLED' ? 1 : 0, Math.round(Number(r[5] || 0) * 1.1), Number(r[6] || 0),
      Math.round(Number(r[8] || 0) * 100) / 100].join(','));
  });
  return { updated: upd, names: names.list, rows: rows.join(';') };
}

// 수동 DB 입력 탭: A열 일자 | B열 채널(K, MT, PLAN, 홈페이지 …) | C열 DB수
const MANUAL_DB_TAB = '수동DB';
// 목표 탭: A열 월(2026-10) | B열 구분(전체, 주력군, 주력1팀, 지원군, G …) | C열 목표DB
const GOAL_TAB = '목표';

function shortName_(n) {
  const m = String(n == null ? '' : n).trim().match(/^GL\s*[\(\[]\s*(.+?)\s*[\)\]]$/i);
  return m ? m[1] : String(n == null ? '' : n).trim();
}

/** '26.10.01'처럼 두 자리 연도도 받는 날짜 변환 */
function dayOf_(v) {
  const t = parseTs(v);
  if (t) return t.day;
  const m = String(v == null ? '' : v).trim().match(/^(\d{2})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);
  return m ? Math.floor(Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : null;
}

function readManualDb_(ss) {
  const sh = ss.getSheetByName(MANUAL_DB_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const sum = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    const day = dayOf_(r[0]);
    const ch = String(r[1] == null ? '' : r[1]).trim();
    const n = Math.round(Number(String(r[2] == null ? '' : r[2]).replace(/[^0-9.\-]/g, '')));
    if (day == null || !ch || !(n > 0)) return;
    const k = day + '|' + ch;
    sum[k] = (sum[k] || 0) + n;
  });
  return Object.keys(sum).map(function (k) { const p = k.split('|'); return { day: Number(p[0]), ch: p.slice(1).join('|'), n: sum[k] }; });
}

function readGoals_(ss) {
  const sh = ss.getSheetByName(GOAL_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    let month = null;
    if (r[0] instanceof Date && !isNaN(r[0])) month = Utilities.formatDate(r[0], 'Asia/Seoul', 'yyyy-MM');
    else { const m = String(r[0] == null ? '' : r[0]).match(/(\d{4})\D+(\d{1,2})/); if (m) month = m[1] + '-' + ('0' + m[2]).slice(-2); }
    const target = String(r[1] == null ? '' : r[1]).trim() || '전체';
    const db = Number(String(r[2] == null ? '' : r[2]).replace(/[^0-9.]/g, ''));
    if (month && db > 0) out.push({ month: month, target: target, db: db });
  });
  return out;
}

// 같은 날짜·채널 광고비가 여러 탭에 있으면 앞쪽 탭 값을 씁니다 (API 자동 수집 > 수기 입력).
const SPEND_TAB_PRIORITY = ['광고비_구글', '광고비_메타', '광고비_틱톡', '광고비_수동', '광고비_CRM'];
// 매체 API 금액은 부가세 미포함이라, 수기 입력(VAT 포함)과 맞추기 위해 곱합니다. 미포함으로 보고 싶으면 1로 바꾸세요.
const SPEND_VAT = { '광고비_구글': 1.1, '광고비_메타': 1.1, '광고비_틱톡': 1.1, '광고비_CRM': 1 };
// 탭 전체가 아니라 특정 채널만 VAT를 더해야 할 때 (중복보고의 M은 메타 지출 원금 = VAT 별도)
const SPEND_VAT_CH = { '광고비_수동': { 'M': 1.1 }, '광고비_CRM': { 'M': 1.1 } }; // CRM의 M도 중복보고와 같은 VAT 별도 금액

/**
 * '광고비'로 시작하는 탭을 읽어 일자·채널별 금액을 'day,채널,금액;…' 형태로 반환합니다.
 * 각 탭은 A열 일자, B열 채널(G, H … 또는 GL(G)), D열 광고비 형식입니다.
 */
function readSpend_(ss) {
  const rank = function (n) { const i = SPEND_TAB_PRIORITY.indexOf(n); return i < 0 ? SPEND_TAB_PRIORITY.length - 0.5 : i; };
  const sheets = ss.getSheets().filter(function (sh) { return sh.getName().indexOf('광고비') === 0 && sh.getLastRow() >= 2; })
    .sort(function (a, b) { return rank(a.getName()) - rank(b.getName()); });
  const final = new Map();
  const tabs = [];
  sheets.forEach(function (sh) {
    const name = sh.getName(), vat = SPEND_VAT[name] || 1;
    tabs.push(name);
    const local = new Map();
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
      const t = parseTs(r[0]);
      const ch = String(r[1] == null ? '' : r[1]).trim().replace(/^GL\s*[\(\[]\s*(.+?)\s*[\)\]]$/i, '$1');
      const amt = Number(String(r[3] == null ? '' : r[3]).replace(/[^0-9.\-]/g, ''));
      if (!t || !ch || !isFinite(amt)) return;
      const k = t.day + ',' + ch;
      const v2 = (SPEND_VAT_CH[name] && SPEND_VAT_CH[name][ch]) || vat;
      local.set(k, (local.get(k) || 0) + amt * v2);
    });
    local.forEach(function (v, k) { if (!final.has(k)) final.set(k, v); });
  });
  const rows = [];
  final.forEach(function (v, k) { if (v) rows.push(k + ',' + Math.round(v)); });
  return { tabs: tabs, rows: rows.join(';') };
}

/** GL(…) 형식의 탭을 찾아 표시 순서대로 반환 */
function getSourceSheets_(ss) {
  const names = ss.getSheets().map(function (sh) { return sh.getName(); }).filter(function (n) {
    if (EXTRA_SOURCE_TABS.indexOf(String(n).trim()) >= 0) return true;
    return CHANNEL_PATTERN.test(String(n).trim()) && EXCLUDE_SHEETS.indexOf(n) < 0 && !/_\d*\s*[\)\]]\s*$/.test(String(n).trim()); // GL(G_1) 같은 복사 탭 제외
  });
  const pref = PREFERRED_ORDER.filter(function (n) { return names.indexOf(n) >= 0; });
  const rest = names.filter(function (n) { return pref.indexOf(n) < 0 && EXTRA_SOURCE_TABS.indexOf(n) < 0; });
  const extra = EXTRA_SOURCE_TABS.filter(function (n) { return names.indexOf(n) >= 0; });
  return pref.concat(rest, extra);
}

/**
 * 탭마다 다른 날짜 형식을 { day: 1970-01-01부터의 일수, hour: 0~23 또는 -1(시간 없음) }로 변환.
 * 지원: Date 객체, 시리얼 숫자, '2025-12-23 7:04:53', '2026. 3. 26 오후 4:50:12',
 *       '2025-12-13T14:38:44+09:00', '2026. 8. 11', '2026년 3월 5일 14:00'
 */
function parseTs(v) {
  let y, mo, d, h = -1;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    y = v.getFullYear(); mo = v.getMonth() + 1; d = v.getDate();
    if (v.getHours() || v.getMinutes() || v.getSeconds()) h = v.getHours();
  } else if (typeof v === 'number') {
    if (v < 30000 || v > 80000) return null;
    const dt = new Date(Math.round((v - 25569) * 86400000));
    y = dt.getUTCFullYear(); mo = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    if (v % 1 > 0) h = dt.getUTCHours();
  } else {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    const m = s.match(/(\d{4})\s*[-.\/년]\s*(\d{1,2})\s*[-.\/월]\s*(\d{1,2})/);
    if (!m) return null;
    y = +m[1]; mo = +m[2]; d = +m[3];
    const rest = s.slice(m.index + m[0].length);
    const tm = rest.match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (tm) {
      h = +tm[1];
      if (/오후|PM/i.test(rest) && h < 12) h += 12;
      if (/오전|AM/i.test(rest) && h === 12) h = 0;
      if (h > 23) h = -1;
    }
  }
  if (y < 2015 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { day: Math.floor(Date.UTC(y, mo - 1, d) / 86400000), hour: h };
}

/** 연락처를 010XXXXXXXX 형태로 통일 (p:+8210..., 1050..., 010-xxxx-xxxx 모두 처리) */
function normPhone(v) {
  let p = String(v == null ? '' : v).replace(/\D/g, '');
  if (p.indexOf('82') === 0 && p.length >= 11) p = '0' + p.slice(2);
  if (p && p.charAt(0) !== '0') p = '0' + p;
  return p.length >= 10 ? p : '';
}

/** 문자열 → 번호 사전 (전송량을 줄이기 위해 반복 텍스트를 번호로 보냄) */
function Dict() { this.list = []; this.map = new Map(); }
Dict.prototype.id = function (v) {
  const k = String(v == null ? '' : v).trim();
  if (!k) return -1;
  if (!this.map.has(k)) { this.map.set(k, this.list.length); this.list.push(k); }
  return this.map.get(k);
};

/* ================= 대시보드에서 수동 DB 입력 (POST) ================= */
// 비밀번호: Apps Script 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성 → INPUT_PIN 에 원하는 숫자/문자 입력
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (ACCESS_TOKEN && body.token !== ACCESS_TOKEN) return json_({ error: 'unauthorized' });
    const pin = PropertiesService.getScriptProperties().getProperty('INPUT_PIN');
    if (!pin) return json_({ error: 'Apps Script 스크립트 속성에 INPUT_PIN(입력 비밀번호)을 먼저 설정해 주세요.' });
    if (String(body.pin || '') !== String(pin)) return json_({ error: '비밀번호가 맞지 않아요.' });
    if (body.action === 'manualDb') {
      const saved = upsertManualDb_(Array.isArray(body.rows) ? body.rows.slice(0, 200) : []);
      buildAndCache_(true); // 저장 즉시 대시보드 데이터 다시 계산
      return json_({ ok: true, saved: saved });
    }
    return json_({ error: '알 수 없는 요청이에요.' });
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) });
  }
}

/** 같은 일자·채널이 이미 있으면 덮어쓰고, DB수 0이면 그 줄을 지웁니다. */
function upsertManualDb_(rows) {
  const ss = SpreadsheetApp.openById('1GgecwoK7Fp5Px_DSFFPgq0a3zYnx6KLgkrqe18k32nk');
  let sh = ss.getSheetByName(MANUAL_DB_TAB);
  if (!sh) { sh = ss.insertSheet(MANUAL_DB_TAB); sh.getRange(1, 1, 1, 3).setValues([['일자', '채널', 'DB수']]); }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const fmtDay = function (day) { return Utilities.formatDate(new Date(day * 86400000), 'UTC', 'yyyy-MM-dd'); };
    const map = {}, order = [];
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
        const day = dayOf_(r[0]), ch = shortName_(r[1]);
        if (day == null || !ch) return;
        const k = day + '|' + ch;
        if (!(k in map)) order.push(k);
        map[k] = [fmtDay(day), ch, Number(String(r[2]).replace(/[^0-9.\-]/g, '')) || 0, r[3] == null ? '' : r[3]];
      });
    }
    let saved = 0;
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
    rows.forEach(function (x) {
      const day = dayOf_(x.date), ch = shortName_(x.ch), n = Math.round(Number(x.n));
      if (day == null || !ch || !isFinite(n) || n < 0) return;
      const k = day + '|' + ch;
      if (n === 0) { delete map[k]; saved++; return; }
      if (!(k in map)) order.push(k);
      map[k] = [fmtDay(day), ch, n, '대시보드 입력 ' + now];
      saved++;
    });
    const all = order.filter(function (k) { return k in map; }).map(function (k) { return map[k]; })
      .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 4).clearContent();
    if (all.length) {
      sh.getRange(2, 1, all.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, all.length, 4).setValues(all);
    }
    return saved;
  } finally { lock.releaseLock(); }
}


/* ================= 오전 보고(tiger_2) → '광고비_CRM' 탭 =================
 * 아임웹 tiger_2에 매일 붙여넣는 CRM '전일 하루' 표의 채널별 광고비를 가져옵니다.
 * tiger_2는 업무보고서버(Apps Script)에 날짜별로 저장되므로 그 주소에서 읽습니다. 이름·연락처는 없습니다.
 * 처음 한 번: 함수 목록에서 syncCrmSpend 를 선택해 ▷ 실행 → 권한 허용 (외부 주소 읽기 권한)
 * 그 뒤로는 warmCache 트리거가 30분마다 자동으로 다시 가져옵니다.
 */
const CRM_REPORT_URL = 'https://script.google.com/macros/s/AKfycby8UcfEX-9GRYMEaymEHZL5nDf7KXRitDkk8t1x7-W8lD5mRsfmZJDXaW9BmJbMR9bZ/exec?ns=tiger2&since=0';
const CRM_TAB = '광고비_CRM';
const CRM_DAY_OFFSET = 0;    // 확인 결과 tiger_2 날짜 = 광고비·DB가 발생한 날짜 (중복보고 값과 일치)
const CRM_FROM = '2026-09-30'; // tiger_2를 매일 쓰기 시작한 날. 그 전 기록(월말 몇 건)은 형식이 달라 제외
const CRM_OUTLIER = 3;       // 채널 평소(중앙값)의 3배를 넘는 날은 '당월 누적'을 잘못 붙여넣은 것으로 보고 제외
const CRM_EVERY_MIN = 30;
const CRM_CH_NAME = { HOME: '홈페이지' };   // tiger_2 키 → 대시보드 채널 이름 (ETC=기타매체는 제외)

function syncCrmSpendThrottled_() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('crm_spend_at') || 0);
  if (Date.now() - last < CRM_EVERY_MIN * 60000) return;
  props.setProperty('crm_spend_at', String(Date.now()));
  syncCrmSpend();
}

function syncCrmSpend() {
  const res = UrlFetchApp.fetch(CRM_REPORT_URL, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('응답 ' + res.getResponseCode());
  const body = JSON.parse(res.getContentText());
  if (!body.ok) throw new Error(body.error || '업무보고서버 응답 오류');
  const num = function (x) { const n = Number(String(x == null ? '' : x).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  let diag = '';
  const out = [];
  const addDay = function (key, d) {
    const m = String(key).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m || !d || typeof d !== 'object' || !d.rows) return false;
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + CRM_DAY_OFFSET));
    const day = Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd'), rep = m[0];
    Object.keys(d.rows).forEach(function (k) {
      if (k === 'ETC' || !d.rows[k]) return;
      const cost = num(d.rows[k].cost);
      if (cost > 0) out.push([day, CRM_CH_NAME[k] || k, 'CRM', Math.round(cost), rep, num(d.rows[k].in), now]);
    });
    return true;
  };
  const rows = body.rows || [];
  rows.forEach(function (r) {
    let d = r.v;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
    if (addDay(r.k, d)) return;
    // 한 키에 여러 날짜가 통째로 저장된 경우 { '2026-10-16': {...}, ... }
    if (d && typeof d === 'object') Object.keys(d).forEach(function (k2) { addDay(k2, d[k2]); });
  });
  // 진단: 하나도 못 찾으면 서버가 준 키 모양을 I열에 남김 (값 내용은 남기지 않음)
  diag = '받은 행 ' + rows.length + ' / 키 예시: ' + rows.slice(0, 8).map(function (r) {
    let t = typeof r.v; try { const o = JSON.parse(r.v); t = Array.isArray(o) ? 'array' : typeof o; if (o && typeof o === 'object' && !Array.isArray(o)) t += '{' + Object.keys(o).slice(0, 6).join(',') + '}'; } catch (e) {}
    return r.k + ':' + t;
  }).join(' | ');
  // 시작일 이전 제외 + 채널별 중앙값의 CRM_OUTLIER배를 넘는 날 제외 (당월 누적 오입력 방지)
  const byCh = {};
  out.forEach(function (r) { (byCh[r[1]] = byCh[r[1]] || []).push(r[3]); });
  const med = {};
  Object.keys(byCh).forEach(function (c) { const a = byCh[c].slice().sort(function (x, y) { return x - y; }); med[c] = a[Math.floor(a.length / 2)]; });
  const skipped = [];
  for (let i = out.length - 1; i >= 0; i--) {
    const r = out[i];
    if (r[0] < CRM_FROM) { out.splice(i, 1); continue; }
    // PLAN은 DB당 단가제라 DB가 많으면 금액도 커져서 이상치 검사에서 제외
    if (r[1] !== 'PLAN' && med[r[1]] && r[3] > med[r[1]] * CRM_OUTLIER) { skipped.push(r[0] + ' ' + r[1]); out.splice(i, 1); }
  }
  if (skipped.length) diag = '이상치로 제외: ' + skipped.join(', ');
  out.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[1]).localeCompare(String(b[1])); });
  const ss = SpreadsheetApp.openById('1GgecwoK7Fp5Px_DSFFPgq0a3zYnx6KLgkrqe18k32nk');
  const sh = ss.getSheetByName(CRM_TAB) || ss.insertSheet(CRM_TAB);
  sh.clearContents();
  sh.getRange(1, 1, 1, 7).setValues([['일자', '채널', '매체', '광고비', 'tiger_2 날짜', 'CRM DB수', '갱신시각']]);
  if (out.length) {
    sh.getRange(2, 1, out.length, 1).setNumberFormat('@');
    sh.getRange(2, 5, out.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, out.length, 7).setValues(out);
  }
  sh.getRange(1, 9).setValue(diag);
  Logger.log('CRM 광고비 ' + out.length + '행 기록 (' + now + ') ' + diag);
  return out.length;
}


/* ================= 복사 탭(GL(G_1) 등)의 비고 → 원본 행에 붙이기 =================
 * GL(G)·GL(M)처럼 원본에 캠페인명(비고)이 없는 채널은, 같은 데이터에 캠페인명이 붙은 복사 탭(GL(G_1))이 있어요.
 * 복사 탭은 DB 수량에는 넣지 않고, '연락처 + 날짜'가 같은 행의 비고만 가져와 지역별 통계에 씁니다.
 */
function copyNoteMap_(ss, name) {
  const m = String(name).match(/^(GL\s*[\(\[]\s*)(.+?)(\s*[\)\]])$/i);
  if (!m) return null;
  const sh = ss.getSheetByName(m[1] + m[2] + '_1' + m[3]);
  if (!sh || sh.getLastRow() < 2) return null;
  const lastCol = Math.max(1, sh.getLastColumn());
  const lower = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const find = function (cands) { for (let k = 0; k < cands.length; k++) { const i = lower.indexOf(cands[k].toLowerCase()); if (i >= 0) return i; } return -1; };
  const cD = Math.max(0, find(DATE_HEADERS)), cP = find(PHONE_HEADERS), cN = lower.indexOf('비고');
  if (cP < 0 || cN < 0) return null;
  const width = Math.max(cD, cP, cN) + 1;
  const map = new Map();
  sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(function (r) {
    const note = String(r[cN] == null ? '' : r[cN]).trim(); if (!note) return;
    const t = parseTs(r[cD]), p = normPhone(r[cP]); if (!t || !p) return;
    const k = p + '|' + t.day; if (!map.has(k)) map.set(k, note);
  });
  return map;
}
