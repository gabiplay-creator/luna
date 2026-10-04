/**
 * 광고비 자동 수집
 *  1) 임시CRM 시트 '중복보고' 탭에 수기로 적는 채널별 광고비 → '광고비_수동' 탭 (지금 바로 사용)
 *  2) 메타 · 틱톡 API → '광고비_메타', '광고비_틱톡' 탭 (토큰을 넣으면 사용)
 *
 * 붙여넣는 곳: 대시보드 API와 같은 Apps Script 프로젝트에 '새 파일(스크립트)'로 추가
 * 토큰 보관: 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성
 *   META_TOKEN   : 메타 비즈니스 관리자 시스템 사용자 토큰 (ads_read 권한)
 *   TIKTOK_TOKEN : 틱톡 for Business 개발자 앱의 Access Token
 * 처음 한 번: 함수 목록에서 setupAdSpendTrigger 실행 → 이후 1시간마다 syncAdSpend 자동 실행
 *
 * ⚠️ 토큰은 절대 이 코드나 GitHub에 직접 적지 마세요. 스크립트 속성에만 넣습니다.
 */

const AD_SHEET_ID = '1GgecwoK7Fp5Px_DSFFPgq0a3zYnx6KLgkrqe18k32nk';
const AD_DAYS_BACK = 3; // 오늘 포함 최근 3일을 매번 다시 기록

/* ---------- 중복보고(수기 입력) ---------- */
// 'GL(○) 광고비' 제목 아래 '날짜 | 광고비(VAT포함)' 블록을 자동으로 찾아 읽습니다. 새 채널 블록을 추가해도 자동 인식돼요.
const MANUAL_SOURCE = { sheetId: '1c973ZwajklJkOSYboMr3CySFMI6jKjoDnc5m-pLcqkU', tab: '중복보고' };
const MANUAL_TAB = '광고비_수동';

/* ---------- 메타: 광고 계정 → 채널 ---------- */
const META_API_VERSION = 'v23.0'; // 오류에 버전 만료 안내가 나오면 최신 버전 번호로 바꾸세요
const META_RULES = [
  { channel: 'M', accountId: 'act_0000000000' }
  // 계정 하나에서 캠페인 이름으로 나눌 때: { channel: 'M', accountId: 'act_…', campaignContains: '[M]' }
];

/* ---------- 틱톡: 광고주 계정 → 채널 ---------- */
const TIKTOK_RULES = [
  { channel: 'T', advertiserId: '0000000000000000000' },
  { channel: 'K', advertiserId: '0000000000000000000' },
  { channel: 'MT', advertiserId: '0000000000000000000' }
  // 계정 하나에서 캠페인 이름으로 나눌 때: { channel: 'K', advertiserId: '…', campaignContains: '[K]' }
];

/** 1시간마다 실행되는 함수 */
function syncAdSpend() {
  const range = adRange_();
  const props = PropertiesService.getScriptProperties();
  const log = [];
  try { log.push('중복보고 ' + syncManualSpend_() + '행'); }
  catch (e) { log.push('중복보고 실패: ' + e.message); }
  if (props.getProperty('META_TOKEN')) {
    try { log.push('메타 ' + syncMeta_(props.getProperty('META_TOKEN'), range) + '행'); }
    catch (e) { log.push('메타 실패: ' + e.message); }
  } else log.push('메타 건너뜀 (META_TOKEN 없음)');
  if (props.getProperty('TIKTOK_TOKEN')) {
    try { log.push('틱톡 ' + syncTikTok_(props.getProperty('TIKTOK_TOKEN'), range) + '행'); }
    catch (e) { log.push('틱톡 실패: ' + e.message); }
  } else log.push('틱톡 건너뜀 (TIKTOK_TOKEN 없음)');
  Logger.log(range.from + ' ~ ' + range.to + ' | ' + log.join(' | '));
}

/** 처음 한 번만 실행: 1시간마다 syncAdSpend가 돌도록 등록 */
function setupAdSpendTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncAdSpend') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAdSpend').timeBased().everyHours(1).create();
  syncAdSpend();
}

/* ================= 중복보고(수기 입력) ================= */
function syncManualSpend_() {
  const src = SpreadsheetApp.openById(MANUAL_SOURCE.sheetId).getSheetByName(MANUAL_SOURCE.tab);
  if (!src) throw new Error("'" + MANUAL_SOURCE.tab + "' 탭을 찾을 수 없어요");
  const found = readManualBlocks_(src.getDataRange().getValues());
  return mergeManualTab_(found.rows, found.conflicts);
}

/** 시트 값 배열에서 'GL(○) 광고비' 블록을 찾아 { 'yyyy-MM-dd|채널': 금액 } 으로 반환 */
function readManualBlocks_(v) {
  const rows = {}, conflicts = [];
  for (let r = 0; r < v.length; r++) {
    for (let c = 0; c < v[r].length - 1; c++) {
      const m = String(v[r][c]).trim().match(/^GL\s*[\(\[]\s*([^\)\]]+?)\s*[\)\]]\s*광고비/);
      if (!m) continue;
      const ch = m[1];
      let start = r + 1;
      while (start < Math.min(v.length, r + 4) && String(v[start][c]).trim() !== '날짜') start++;
      if (start >= Math.min(v.length, r + 4)) continue;
      for (let i = start + 1; i < v.length; i++) {
        const d = shortDate_(v[i][c]);
        if (!d) break; // '합계' 행이나 빈칸에서 블록 끝
        const raw = v[i][c + 1];
        if (raw === '' || raw === null) continue; // 아직 입력 안 된 날
        const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
        if (!isFinite(n)) continue;
        const k = d + '|' + ch;
        if (k in rows) { if (Math.round(rows[k]) !== Math.round(n)) conflicts.push(ch + ' ' + d + ': ' + rows[k] + ' / ' + n); continue; }
        rows[k] = n;
      }
    }
  }
  return { rows: rows, conflicts: conflicts };
}

/** '26.10.01', '2026-10-01', 날짜 셀 → 'yyyy-MM-dd' */
function shortDate_(x) {
  if (x instanceof Date && !isNaN(x)) return Utilities.formatDate(x, 'Asia/Seoul', 'yyyy-MM-dd');
  const m = String(x == null ? '' : x).trim().match(/^(\d{2}|\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);
  if (!m) return null;
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** 광고비_수동 탭에 병합: 새로 읽은 날짜·채널은 덮어쓰고, 지난달처럼 원본에서 사라진 기록은 그대로 보관 */
function mergeManualTab_(rows, conflicts) {
  const ss = SpreadsheetApp.openById(AD_SHEET_ID);
  let sh = ss.getSheetByName(MANUAL_TAB);
  if (!sh) sh = ss.insertSheet(MANUAL_TAB);
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const map = {};
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
        const d = String(r[0]).slice(0, 10);
        if (d && r[1]) map[d + '|' + r[1]] = r;
      });
    }
    Object.keys(rows).forEach(function (k) {
      const p = k.split('|');
      map[k] = [p[0], p[1], '중복보고', Math.round(rows[k]), now];
    });
    const all = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
    sh.clearContents();
    sh.getRange(1, 1, 1, 5).setValues([['일자', '채널', '매체', '광고비(VAT포함)', '갱신시각']]);
    if (all.length) {
      sh.getRange(2, 1, all.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, all.length, 5).setValues(all);
    }
  } finally { lock.releaseLock(); }
  if (conflicts.length) Logger.log('같은 채널 블록이 두 곳 이상인데 값이 달라요 (먼저 나온 블록 값 사용):\n' + conflicts.join('\n'));
  return Object.keys(rows).length;
}

/** 수기 광고비만 지금 바로 한 번 가져오기 (테스트용) */
function syncManualSpendNow() { Logger.log('중복보고 → 광고비_수동: ' + syncManualSpend_() + '행'); }

/* ================= 메타 ================= */
function syncMeta_(token, range) {
  const sum = {}, unmatched = {};
  const accounts = uniq_(META_RULES.map(function (r) { return r.accountId; }));
  accounts.forEach(function (acc) {
    let url = 'https://graph.facebook.com/' + META_API_VERSION + '/' + acc + '/insights?' + qs_({
      level: 'campaign', fields: 'campaign_name,spend', time_increment: 1, limit: 500,
      time_range: JSON.stringify({ since: range.from, until: range.to }), access_token: token
    });
    while (url) {
      const res = fetchJson_(url, {});
      if (res.error) throw new Error(acc + ': ' + res.error.message);
      (res.data || []).forEach(function (r) {
        const ch = matchRule_(META_RULES, 'accountId', acc, r.campaign_name);
        if (ch === '미분류') unmatched[acc + ' / ' + r.campaign_name] = true;
        addSum_(sum, r.date_start, ch, Number(r.spend));
      });
      url = res.paging && res.paging.next ? res.paging.next : null;
    }
  });
  logUnmatched_('메타', unmatched);
  return writeSpendTab_('광고비_메타', '메타', sum, range);
}

/* ================= 틱톡 ================= */
function syncTikTok_(token, range) {
  const sum = {}, unmatched = {};
  const advertisers = uniq_(TIKTOK_RULES.map(function (r) { return r.advertiserId; }));
  advertisers.forEach(function (adv) {
    let page = 1, totalPage = 1;
    do {
      const url = 'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?' + qs_({
        advertiser_id: adv, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'campaign_name']),
        start_date: range.from, end_date: range.to, page: page, page_size: 1000
      });
      const res = fetchJson_(url, { headers: { 'Access-Token': token } });
      if (res.code !== 0) throw new Error(adv + ': ' + res.message);
      (res.data.list || []).forEach(function (r) {
        const name = r.metrics.campaign_name;
        const ch = matchRule_(TIKTOK_RULES, 'advertiserId', adv, name);
        if (ch === '미분류') unmatched[adv + ' / ' + name] = true;
        addSum_(sum, String(r.dimensions.stat_time_day).slice(0, 10), ch, Number(r.metrics.spend));
      });
      totalPage = (res.data.page_info && res.data.page_info.total_page) || 1;
      page++;
    } while (page <= totalPage);
  });
  logUnmatched_('틱톡', unmatched);
  return writeSpendTab_('광고비_틱톡', '틱톡', sum, range);
}

/* ================= 공통 ================= */
function adRange_() {
  const f = function (k) { return Utilities.formatDate(new Date(Date.now() - k * 86400000), 'Asia/Seoul', 'yyyy-MM-dd'); };
  return { from: f(AD_DAYS_BACK - 1), to: f(0) };
}

function matchRule_(rules, idKey, id, campaign) {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (String(r[idKey]) !== String(id)) continue;
    if (r.campaignContains && String(campaign || '').indexOf(r.campaignContains) < 0) continue;
    return r.channel;
  }
  return '미분류';
}

function addSum_(sum, date, ch, amt) {
  if (!isFinite(amt) || !amt) return;
  const k = date + '|' + ch;
  sum[k] = (sum[k] || 0) + amt;
}

function writeSpendTab_(tab, media, sum, range) {
  const ss = SpreadsheetApp.openById(AD_SHEET_ID);
  let sh = ss.getSheetByName(tab);
  if (!sh) sh = ss.insertSheet(tab);
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const fresh = Object.keys(sum).map(function (k) { const p = k.split('|'); return [p[0], p[1], media, Math.round(sum[k]), now]; });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let keep = [];
    if (sh.getLastRow() > 1) {
      keep = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().filter(function (r) {
        const d = String(r[0]).slice(0, 10);
        return d && (d < range.from || d > range.to);
      });
    }
    const all = keep.concat(fresh).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
    sh.clearContents();
    sh.getRange(1, 1, 1, 5).setValues([['일자', '채널', '매체', '광고비', '갱신시각']]);
    if (all.length) {
      sh.getRange(2, 1, all.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, all.length, 5).setValues(all);
    }
  } finally { lock.releaseLock(); }
  return fresh.length;
}

function fetchJson_(url, opt) {
  const res = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opt));
  try { return JSON.parse(res.getContentText()); }
  catch (e) { throw new Error('응답을 읽을 수 없어요 (HTTP ' + res.getResponseCode() + ')'); }
}

function qs_(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
function uniq_(a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }); }
function logUnmatched_(media, m) {
  const k = Object.keys(m);
  if (k.length) Logger.log(media + ' 규칙에 안 맞는 캠페인 ' + k.length + '개 → 미분류:\n' + k.join('\n'));
}
