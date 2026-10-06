/**
 * 구글 애즈 광고비 → 임시CRM '중복보고' 탭 자동 입력
 *
 * 붙여넣는 곳: 구글 애즈 "관리자(MCC) 계정" → 도구 → 일괄 작업 → 스크립트 → + 새 스크립트
 *   (아래 5개 계정을 모두 관리하는 MCC에서 실행하세요. MCC가 없으면 계정마다 따로 넣어도 돼요.)
 * 실행 주기: 스크립트 목록에서 빈도 '매일', 시간 '오전 6시' 권장
 *
 * 동작: 어제·그제 광고비를 계정별로 가져와 '중복보고' 탭의 "GL(○) 광고비" 블록에서
 *       같은 날짜 줄의 '광고비(VAT포함)' 칸에 써넣습니다. 블록 위치는 제목으로 자동으로 찾아요.
 */

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1c973ZwajklJkOSYboMr3CySFMI6jKjoDnc5m-pLcqkU/edit';
const TAB_NAME = '중복보고';

// 구글 애즈 계정 번호 → 채널
const ACCOUNTS = {
  '197-248-6360': 'G',
  '192-187-6815': 'H',   // GL(H)-본계정
  '525-287-8817': 'D',
  '607-579-8962': 'B',
  '902-493-4768': 'U'
  // '620-262-8733': ?,  // GL(O2) — 어느 채널에 합칠지 정해지면 주석을 풀고 채널을 적어 주세요
};

// 기존 중복보고 G 입력값이 구글 애즈 비용과 같은 기준이라 1로 둡니다. 부가세를 곱해 넣으려면 1.1로 바꾸세요.
const VAT = 1;

const DAYS_BACK = 2;      // 어제부터 며칠치를 채울지 (2 = 어제, 그제)
const OVERWRITE = false;  // false: 빈 칸만 채움(직접 입력한 값 보호), true: 구글 애즈 값으로 덮어씀

function main() {
  const tz = 'Asia/Seoul';
  const ymd = function (k) { return Utilities.formatDate(new Date(Date.now() - k * 86400000), tz, 'yyyy-MM-dd'); };
  const to = ymd(1), from = ymd(DAYS_BACK);

  // 1) 계정별·날짜별 비용
  const cost = {}; // 채널 → { 'yyyy-MM-dd': 원 }
  const readCurrent = function () {
    const id = AdsApp.currentAccount().getCustomerId();
    const ch = ACCOUNTS[id];
    if (!ch) return;
    cost[ch] = cost[ch] || {};
    const rows = AdsApp.search(
      "SELECT segments.date, metrics.cost_micros FROM customer " +
      "WHERE segments.date BETWEEN '" + from + "' AND '" + to + "'");
    while (rows.hasNext()) {
      const r = rows.next();
      cost[ch][r.segments.date] = (cost[ch][r.segments.date] || 0) + Number(r.metrics.costMicros || 0) / 1e6;
    }
  };
  if (typeof AdsManagerApp !== 'undefined') {
    const it = AdsManagerApp.accounts().withIds(Object.keys(ACCOUNTS)).get();
    while (it.hasNext()) { AdsManagerApp.select(it.next()); readCurrent(); }
  } else {
    readCurrent();
  }

  // 2) 중복보고 블록에 기록
  const sh = SpreadsheetApp.openByUrl(SHEET_URL).getSheetByName(TAB_NAME);
  if (!sh) throw new Error("'" + TAB_NAME + "' 탭이 없어요");
  const log = [];
  Object.keys(ACCOUNTS).forEach(function (id) {
    const ch = ACCOUNTS[id];
    const re = '^\\s*GL\\s*\\(\\s*' + ch + '\\s*\\)\\s*광고비\\s*$';
    const heads = sh.createTextFinder(re).useRegularExpression(true).findAll();
    if (!heads.length) { log.push(ch + ': "GL(' + ch + ') 광고비" 블록을 못 찾았어요'); return; }
    heads.forEach(function (h) {
      const row0 = h.getRow() + 2, col = h.getColumn();
      const dates = sh.getRange(row0, col, 32, 2).getDisplayValues();
      Object.keys(cost[ch] || {}).forEach(function (d) {
        const key = d.slice(2).replace(/-/g, '.');            // 2026-10-06 → 26.10.06
        const i = dates.findIndex(function (r) { return String(r[0]).trim() === key; });
        if (i < 0) { log.push(ch + ' ' + key + ': 날짜 줄이 없어요'); return; }
        const val = Math.round(cost[ch][d] * VAT);
        const cur = String(dates[i][1]).replace(/[^0-9.\-]/g, '');
        if (cur === '' || OVERWRITE) {
          sh.getRange(row0 + i, col + 1).setValue(val);
          log.push(ch + ' ' + key + ': ' + val.toLocaleString() + (cur === '' ? ' 입력' : ' 덮어씀 (기존 ' + Number(cur).toLocaleString() + ')'));
        } else if (Math.abs(Number(cur) - val) > 1) {
          log.push(ch + ' ' + key + ': 기존 값 ' + Number(cur).toLocaleString() + ' 유지 (구글 애즈 ' + val.toLocaleString() + ')');
        }
      });
    });
  });
  Logger.log(from + ' ~ ' + to + '\n' + (log.join('\n') || '바뀐 칸 없음 (모두 이미 입력돼 있어요)'));
}
