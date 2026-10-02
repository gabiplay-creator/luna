# 글로벌랩스 DB 대시보드

구글 시트의 DB를 날짜별·주간·월별·요일별·시간대별로 보고, 채널·비고·META 플랫폼·캠페인별 비율을 확인하는 대시보드입니다.

## 구조

```
index.html   대시보드 화면 (GitHub Pages가 보여주는 페이지)
style.css    디자인
app.js       집계·차트 로직 (기능 추가는 주로 여기서)
config.js    API 주소·토큰 설정
Code.gs      구글 시트에 붙여넣는 데이터 API (GitHub에서는 실행되지 않음, 보관용)
```

데이터 흐름: 구글 시트 → Apps Script 웹 앱(개인정보 제외 JSON) → GitHub Pages 대시보드

## 설정

1. 구글 시트에서 확장 프로그램 → Apps Script를 열고 `Code.gs` 내용을 붙여넣어 저장합니다.
2. 배포 → 새 배포 → 웹 앱. 실행 사용자는 "나", 액세스 권한은 "모든 사용자"로 배포하고 웹 앱 URL을 복사합니다.
3. `config.js`의 `API_URL`에 그 URL을 넣습니다. `ACCESS_TOKEN`을 정했다면 `TOKEN`도 같은 값으로 맞춥니다.

Apps Script 코드를 수정한 뒤에는 배포 → 배포 관리 → 수정(연필) → 버전 "새 버전"으로 다시 배포해야 반영됩니다. 이렇게 하면 URL은 그대로 유지됩니다.

## 탭 추가

새 채널 탭은 `Code.gs`의 `SOURCE_SHEETS`에 탭 이름을 추가하고 새 버전으로 배포하면 됩니다.
