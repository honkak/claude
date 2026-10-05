/*
 * 예시 저장소 (mock)
 * goodocs 없이 화면을 체험하기 위한 저장소. 데이터는 이 브라우저에만 저장된다.
 * goodocs 어댑터와 똑같은 함수(list/create/update/remove)를 제공한다.
 */
(function (DR) {
  const KEY = 'dr-mock-rows-v2';
  let rows = null;

  // 예시 업무: [소속파트, 제목, 내용]
  const TASKS = [
    ['공조', '공조기 AHU-12 필터 교체\n- 차압 상승 알람 대응', '1. 차압 측정: 전단 180Pa → 기준 150Pa 초과\n2. 필터 재고 확인: 프리필터 12EA, 미디엄 6EA\n3. 교체 일정 협의: 10/8(수) 야간\n4. 생산팀 공지 요청 완료'],
    ['전기', '신규 라인 전기 부하 계산\n- 2차 변경안 반영', '- 설비 리스트 rev.3 기준 재산정\n- 총 부하 1,240kW → 1,315kW (+75kW)\n- 변압기 TR-3 여유율 18% → 12%\n- 분전반 MCC-07 차단기 용량 검토 필요\n- 결과 보고서 초안 작성 중'],
    ['배기', '스크러버 약품 투입량 점검', '- 일 평균 투입량 42L (전주 대비 +8%)\n- pH 제어 편차 확인: 설정 7.0 / 실측 6.6~7.4\n- 투입 펌프 스트로크 조정 예정'],
    ['수처리', '수처리 pH 센서 교정\n- 3개 지점', '- 1차 반응조, 2차 반응조, 방류조 센서 교정\n- 표준액 pH 4 / 7 / 10 사용\n- 방류조 센서 응답 지연 → 교체 검토\n- 교정 기록서 작성 완료'],
    ['가스', '가스 누출 감지기 정기 점검', '- 대상 24개소 중 18개소 완료\n- 감도 이상 1개소 (B동 2층) → 업체 수리 요청\n- 잔여 6개소 내일 진행'],
    ['전기', '변전실 열화상 측정', '- 수배전반 12면 측정\n- 최고 온도 48℃ (기준 이내)\n- 측정 사진 정리 후 공유 예정'],
    ['공조', '냉동기 부품 견적 비교\n- 압축기 오버홀 부품', '- 3개 업체 견적 접수\n  A사 3,200만원 / B사 2,950만원 / C사 3,480만원\n- 납기: A사 4주, B사 6주, C사 3주\n- 기술 사양 비교표 작성 중\n- 구매팀 검토 요청 예정'],
    ['건설기획', 'BIM 모델 배관 간섭 검토\n- 3층 유틸리티 구간', '- 간섭 23건 검출\n- 중대 간섭 4건: 덕트 vs 케이블트레이\n- 설계사에 수정 요청 송부\n- 회신 후 재검토 일정 수립'],
    ['전기', 'PLC 알람 이력 분석\n- 9월분', '- 총 알람 1,532건\n- 상위 3개 알람이 전체의 61%\n- 반복 알람 원인: 센서 채터링 추정\n- 필터 타이머 적용 검토'],
    ['공조', '설비 PM 일정표 업데이트', '- 4분기 PM 일정 확정\n- 협력사 인력 배정 협의 완료'],
  ];
  const NOTES = ['', '', '', '업체 회신 대기', '부품 납기 2주 지연, 대체품 검토 필요', '현장 출입 승인 필요', '예산 확인 요청'];
  const PROGRESS = ['30%', '50%', '70%', '80%', '100%', '완료', '진행중'];

  // 새로고침해도 같은 예시가 나오도록 고정 시드 난수 사용
  function rng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  }
  const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

  function seed() {
    const cfg = window.APP_CONFIG;
    const rand = rng(42);
    const out = [];
    const today = DR.today();
    let day = DR.isWeekend(today) ? DR.shiftWorkday(today, -1) : today;
    const days = [];
    for (let i = 0; i < 8; i++) {
      days.unshift(day);
      day = DR.shiftWorkday(day, -1);
    }
    days.forEach((date, di) => {
      const isLast = di === days.length - 1;
      cfg.MEMBERS.forEach((author, mi) => {
        if (isLast && mi >= 4) return; // 오늘은 일부만 제출한 상태로 시작
        if (!isLast && rand() < 0.08) return; // 과거에도 가끔 미제출
        const at = new Date(DR.parseDate(date).setHours(16 + Math.floor(rand() * 3), Math.floor(rand() * 60)));
        const stamp = at.toISOString();
        const n = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const [part, title, content] = pick(rand, TASKS);
          out.push({
            id: 'm-' + out.length,
            date,
            author,
            part,
            title,
            content,
            progress: pick(rand, PROGRESS),
            note: pick(rand, NOTES),
            createdAt: stamp,
            updatedAt: stamp,
          });
        }
      });
    });
    return out;
  }

  function load() {
    if (!rows) {
      rows = DR.storage.get(KEY, null);
      if (!rows) {
        rows = seed();
        persist();
      }
    }
    return rows;
  }
  const persist = () => DR.storage.set(KEY, rows);
  const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  let seq = Date.now();

  DR.createMockStore = () => ({
    kind: 'mock',
    label: '예시 데이터',

    async list({ from, to, author } = {}) {
      await wait();
      return load()
        .filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!author || r.author === author))
        .map((r) => ({ ...r }));
    },

    async create(newRows) {
      await wait();
      const now = DR.nowIso();
      const created = newRows.map((r) => ({ ...r, id: 'm-' + seq++, createdAt: now, updatedAt: now }));
      load().push(...created);
      persist();
      return created;
    },

    async update(id, patch) {
      await wait();
      const row = load().find((r) => r.id === id);
      if (!row) throw new Error(`수정할 행을 찾지 못했습니다 (ID ${id})`);
      Object.assign(row, patch, { updatedAt: DR.nowIso() });
      persist();
      return { ...row };
    },

    async remove(id) {
      await wait();
      const i = load().findIndex((r) => r.id === id);
      if (i >= 0) load().splice(i, 1);
      persist();
    },

    reset() {
      rows = seed();
      persist();
    },
  });
})(window.DR);
