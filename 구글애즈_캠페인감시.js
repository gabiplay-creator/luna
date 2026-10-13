/**
 * 구글 애즈 캠페인·지역 감시 데이터 → 대시보드 시트 '캠페인_일별' 탭
 *
 * 붙여넣는 곳: 구글 애즈 관리자(MCC) 계정 → 도구 → 일괄 작업 → 스크립트 → + 새 스크립트
 *   (기존 '중복보고 자동입력' 스크립트와 별개로 새로 만드세요. 기존 스크립트는 그대로 둡니다.)
 * 실행 주기: 스크립트 목록에서 빈도 '매시간'
 *
 * 하는 일: 최근 35일 + 오늘(진행 중)의 캠페인별 비용·클릭·노출·전환을 한 번에 다시 적습니다.
 *         대시보드는 이 표로 "비용은 나가는데 전환 0" 같은 지역·캠페인 이상을 찾아 '점검 필요'에 띄워요.
 * 시트는 이 탭 하나만 지우고 다시 쓰며, 다른 탭은 건드리지 않습니다.
 */

const DASHBOARD_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GgecwoK7Fp5Px_DSFFPgq0a3zYnx6KLgkrqe18k32nk/edit';
const TAB = '캠페인_일별';
const DAYS = 35;

// 구글 애즈 계정 번호 → 채널 (중복보고 스크립트와 같은 표)
const ACCOUNTS = {
  '197-248-6360': 'G',
  '192-187-6815': 'H',
  '525-287-8817': 'D',
  '607-579-8962': 'B',
  '902-493-4768': 'U'
};

// 캠페인 이름 → 지역 (위에서부터 먼저 맞는 것). 새 지역이 생기면 한 줄 추가하세요.
const REGIONS = [
  ['경기남부', '경기남부'], ['수원용인', '수원·용인'], ['수원', '수원·용인'], ['서울', '서울'], ['경기', '경기'],
  ['충청', '충청'], ['충남', '충청'], ['충북', '충청'],
  ['전북강원', '전북·강원'], ['전북/강원', '전북·강원'], ['전북', '전북·강원'], ['강원', '전북·강원'],
  ['경북', '경북'], ['경남', '경남'], ['부산', '경남'], ['대구', '경북'],
  ['MASS', '전국'], ['mass', '전국']
];

function region_(name) {
  const s = String(name || '');
  for (let i = 0; i < REGIONS.length; i++) if (s.indexOf(REGIONS[i][0]) >= 0) return REGIONS[i][1];
  return '기타';
}

function main() {
  const tz = 'Asia/Seoul';
  const ymd = function (k) { return Utilities.formatDate(new Date(Date.now() - k * 86400000), tz, 'yyyy-MM-dd'); };
  const from = ymd(DAYS), to = ymd(0);
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const out = [];

  const readCurrent = function () {
    const ch = ACCOUNTS[AdsApp.currentAccount().getCustomerId()];
    if (!ch) return;
    const it = AdsApp.search(
      "SELECT segments.date, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions " +
      "FROM campaign WHERE segments.date BETWEEN '" + from + "' AND '" + to + "' AND metrics.impressions > 0");
    let n = 0;
    while (it.hasNext()) {
      const r = it.next();
      out.push([r.segments.date, ch, r.campaign.name, region_(r.campaign.name), String(r.campaign.status || ''),
        Math.round(Number(r.metrics.costMicros || 0) / 1e6), Number(r.metrics.clicks || 0),
        Number(r.metrics.impressions || 0), Math.round(Number(r.metrics.conversions || 0) * 100) / 100]);
      n++;
    }
    Logger.log(ch + ': ' + n + '행');
  };
  if (typeof AdsManagerApp !== 'undefined') {
    const acc = AdsManagerApp.accounts().withIds(Object.keys(ACCOUNTS)).get();
    while (acc.hasNext()) { AdsManagerApp.select(acc.next()); readCurrent(); }
  } else {
    readCurrent();
  }

  const ss = SpreadsheetApp.openByUrl(DASHBOARD_SHEET_URL);
  const sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sh.clearContents();
  const head = [['일자', '채널', '캠페인', '지역', '상태', '비용(VAT별도)', '클릭', '노출', '전환', '갱신 ' + now]];
  sh.getRange(1, 1, 1, head[0].length).setValues(head);
  if (out.length) {
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] + a[2]).localeCompare(b[1] + b[2]); });
    sh.getRange(2, 1, out.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, out.length, 9).setValues(out);
  }
  Logger.log(from + ' ~ ' + to + ' 캠페인 행 ' + out.length + '개 기록 (' + now + ')');
}
