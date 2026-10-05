/*
 * 예시 저장소 (mock)
 * goodocs 없이 화면을 체험하기 위한 저장소. 데이터는 이 브라우저에만 저장된다.
 * goodocs 어댑터와 똑같은 함수(list/create/update/remove)를 제공한다.
 */
(function (DR) {
  const KEY = 'dr-mock-rows-v1';
  let rows = null;

  const TASKS = [
    '냉각수 펌프 #3 진동 점검',
    '공조기 AHU-12 필터 교체 일정 협의',
    '월간 전력 사용량 보고서 작성',
    '배기 스크러버 약품 투입량 확인',
    '협력사 작업허가서 검토',
    '수처리 pH 센서 교정',
    '신규 라인 전기 부하 계산',
    '설비 PM 일정표 업데이트',
    '안전 점검 체크리스트 정리',
    '냉동기 부품 견적 비교',
    'BIM 모델 배관 간섭 검토',
    'PLC 알람 이력 분석',
    '가스 누출 감지기 정기 점검',
    '변전실 열화상 측정',
  ];
  const ISSUES = ['업체 회신 대기', '부품 납기 2주 지연, 대체품 검토 필요', '현장 출입 승인 필요', '예산 확인 요청'];

  // 새로고침해도 같은 예시가 나오도록 고정 시드 난수 사용
  function rng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  }

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
        const hour = 16 + Math.floor(rand() * 3);
        const at = new Date(DR.parseDate(date).setHours(hour, Math.floor(rand() * 60)));
        const stamp = at.toISOString();
        const n = 2 + Math.floor(rand() * 2);
        for (let k = 0; k < n; k++) {
          out.push({
            id: 'm-' + out.length,
            date,
            author,
            kind: '오늘',
            content: TASKS[Math.floor(rand() * TASKS.length)],
            progress: Math.min(100, Math.floor(rand() * 11) * 10 + 20),
            issue: rand() < 0.15 ? ISSUES[Math.floor(rand() * ISSUES.length)] : '',
            createdAt: stamp,
            updatedAt: stamp,
          });
        }
        out.push({
          id: 'm-' + out.length,
          date,
          author,
          kind: '내일',
          content: TASKS[Math.floor(rand() * TASKS.length)],
          progress: null,
          issue: '',
          createdAt: stamp,
          updatedAt: stamp,
        });
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
