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
      const note = cNote >= 0 ? notes.id(r[cNote]) : -1;
      const plat = cPlat >= 0 ? platforms.id(r[cPlat]) : -1;
      const camp = cCamp >= 0 ? campaigns.id(r[cCamp]) : -1;

      out.push(s + ',' + t.day + ',' + t.hour + ',' + note + ',' + plat + ',' + camp + ',' + dup);
      rows++;
      if (t.hour < 0) noTime++;
    }
    report.push({ name: name, rows: rows, skipped: skipped, noTime: noTime, dup: dupCount });
  });

  return JSON.stringify({
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy.MM.dd HH:mm'),
    buildSec: Math.round((Date.now() - t0) / 100) / 10,
    sources: SOURCE_SHEETS,
    notes: notes.list,
    platforms: platforms.list,
    campaigns: campaigns.list,
    report: report,
    rows: out.join(';'),
    spend: readSpend_(ss)
  });
}

// 같은 날짜·채널 광고비가 여러 탭에 있으면 앞쪽 탭 값을 씁니다 (API 자동 수집 > 수기 입력).
const SPEND_TAB_PRIORITY = ['광고비_구글', '광고비_메타', '광고비_틱톡', '광고비_수동'];
// 매체 API 금액은 부가세 미포함이라, 수기 입력(VAT 포함)과 맞추기 위해 곱합니다. 미포함으로 보고 싶으면 1로 바꾸세요.
const SPEND_VAT = { '광고비_구글': 1.1, '광고비_메타': 1.1, '광고비_틱톡': 1.1 };

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
      local.set(k, (local.get(k) || 0) + amt * vat);
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
    return CHANNEL_PATTERN.test(String(n).trim()) && EXCLUDE_SHEETS.indexOf(n) < 0;
  });
  const pref = PREFERRED_ORDER.filter(function (n) { return names.indexOf(n) >= 0; });
  return pref.concat(names.filter(function (n) { return pref.indexOf(n) < 0; }));
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
