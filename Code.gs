/**
 * 글로벌랩스 DB 대시보드 — 데이터 API (Apps Script)
 *
 * 이 파일은 GitHub가 아니라 구글 시트의 [확장 프로그램 → Apps Script]에 붙여넣어 사용합니다.
 * 시트를 읽어 개인정보(이름·연락처)를 뺀 집계용 JSON을 반환합니다.
 * 연락처는 중복 판별에만 서버 안에서 사용하고 밖으로 내보내지 않습니다.
 */

// 간단한 접근 키. 대시보드 assets/config.js의 TOKEN과 같은 값으로 맞추세요.
// 공개 저장소에서는 이 값도 보이므로, URL을 우연히 발견한 사람을 막는 정도의 용도입니다.
const ACCESS_TOKEN = '';

// 대시보드에 포함할 탭. 새 채널 탭이 생기면 여기에 이름만 추가하면 됩니다.
const SOURCE_SHEETS = ['GL(G)', 'GL(H)', 'GL(D)', 'GL(B)', 'GL(U)', 'GL(M)', 'GL(T)'];

// 같은 데이터를 반복 계산하지 않도록 잠시 저장(초). 새로고침 버튼은 이 저장을 건너뜁니다.
const CACHE_SECONDS = 300;

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

/** CacheService는 항목당 100KB 제한이 있어 결과를 잘게 나눠 저장합니다. */
function getCachedData_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const n = Number(cache.get('dash:n') || 0);
    if (n > 0) {
      const keys = [];
      for (let i = 0; i < n; i++) keys.push('dash:' + i);
      const got = cache.getAll(keys);
      if (keys.every(function (k) { return got[k] != null; })) return keys.map(function (k) { return got[k]; }).join('');
    }
  }
  const json = getDashboardData();
  try {
    const size = 30000, parts = {};
    let n = 0;
    for (let i = 0; i < json.length; i += size) parts['dash:' + (n++)] = json.slice(i, i + size);
    parts['dash:n'] = String(n);
    cache.putAll(parts, CACHE_SECONDS);
  } catch (err) { /* 캐시 실패는 무시하고 결과만 반환 */ }
  return json;
}

/** 모든 채널 탭을 읽어 압축된 JSON 문자열로 반환 */
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const notes = new Dict();
  const platforms = new Dict();
  const campaigns = new Dict();
  const out = [];
  const report = [];
  const maxDay = Math.floor(Date.now() / 86400000) + 2; // 미래 날짜 오입력 방지

  SOURCE_SHEETS.forEach(function (name, s) {
    const sh = ss.getSheetByName(name);
    if (!sh) { report.push({ name: name, rows: 0, skipped: 0, noTime: 0, dup: 0, missing: true }); return; }

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(1, sh.getLastColumn());
    if (lastRow < 2) { report.push({ name: name, rows: 0, skipped: 0, noTime: 0, dup: 0 }); return; }

    const header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    const cPhone = header.indexOf('연락처');
    const cNote = header.indexOf('비고');
    const cPlat = header.indexOf('platform');
    const cCamp = header.indexOf('campaign_name');
    const width = Math.max(1, cPhone, cNote, cPlat, cCamp) + 1;
    const values = sh.getRange(2, 1, lastRow - 1, width).getValues();

    const seen = new Set();
    let rows = 0, skipped = 0, noTime = 0, dupCount = 0;

    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      const t = parseTs(r[0]);
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
    sources: SOURCE_SHEETS,
    notes: notes.list,
    platforms: platforms.list,
    campaigns: campaigns.list,
    report: report,
    rows: out.join(';')
  });
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
