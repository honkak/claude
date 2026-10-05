/*
 * 일일업무보고 설정 파일
 * 사내 배포 시 이 파일만 수정하면 됩니다.
 */
window.APP_CONFIG = {
  TEAM_NAME: '설비기술팀',

  // 팀원 목록 (팀 현황의 표 순서이자, 미제출자 판단 기준)
  MEMBERS: ['김민준', '이서연', '박지훈', '최수아', '정도윤', '한예린'],

  // 소속파트 입력칸의 추천 목록 (자유입력이라 목록에 없어도 입력 가능)
  PARTS: ['전기', '공조', '배기', '수처리', '가스', '건설기획'],

  // 저장소 선택: 'mock' = 예시 데이터(이 브라우저에만 저장), 'goodocs' = 사내 goodocs 시트
  STORE: 'mock',

  GOODOCS: {
    ENDPOINT: 'https://goodocs.example.local/api/v1', // 사내 goodocs API 주소
    TOKEN: '',                                        // 발급받은 토큰
    DOC_ID: '',                                       // 문서(스프레드시트) ID
    SHEET_NAME: '일일업무',                            // 시트(탭) 이름
  },

  // 며칠 전 보고까지 수정을 허용할지 (0 = 오늘 것만 수정 가능)
  EDIT_PAST_DAYS: 0,

  // 팀 현황 화면 자동 새로고침 간격(초). 0이면 끔
  AUTO_REFRESH_SEC: 60,
};
