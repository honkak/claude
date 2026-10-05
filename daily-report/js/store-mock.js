/*
 * 예시 저장소 (mock)
 * goodocs 없이 화면을 체험하기 위한 저장소. 데이터는 이 브라우저에만 저장된다.
 * goodocs 어댑터와 똑같은 함수(list/create/update/remove)를 제공한다.
 */
(function (DR) {
  const KEY = 'dr-mock-rows-v5';
  let rows = null;

  // 예시 업무: [분야(참고용), 제목, 내용]
  const TASKS = [
    ['수변전', '154kV 변전소 정기점검\n- GIS 가스압력·부분방전', '1. GIS SF6 가스압력 측정: 전 구간 정상 (0.5MPa)\n2. 부분방전(UHF) 측정: 특이사항 없음\n3. 차단기 동작횟수 기록\n4. 점검 결과서 작성'],
    ['수변전', '변압기 TR-3 절연유 분석\n- 정기 샘플링', '- 절연유 샘플 채취 및 분석 의뢰\n- 유중가스(DGA) 결과: C2H2 미검출\n- 수분 12ppm (기준 이내)\n- 결과 이력표 갱신'],
    ['배전', '신규 라인 전기 부하 계산\n- 설비 리스트 rev.3 반영', '- 총 부하 1,240kW → 1,315kW (+75kW)\n- 변압기 TR-3 여유율 18% → 12%\n- 분전반 MCC-07 차단기 용량 검토 필요\n- 보고서 초안 작성'],
    ['배전', 'MCC-07 차단기 교체 검토\n- 용량 부족', '- 현 차단기 400AF/350AT\n- 신규 부하 반영 시 420A 예상\n- 630AF 교체안 / 부하 분산안 비교\n- 정전 작업 일정 협의 필요'],
    ['배전', '분전반 열화상 측정\n- B동 1~3층', '- 분전반 36면 측정\n- 최고 온도 52℃ (LP-2F-07, 단자 체결 불량 의심)\n- 재체결 작업 요청\n- 측정 사진 정리'],
    ['계장제어', 'PLC 알람 이력 분석\n- 월간', '- 총 알람 1,532건\n- 상위 3개 알람이 전체의 61%\n- 반복 알람 원인: 센서 채터링 추정\n- 필터 타이머 적용 검토'],
    ['계장제어', '전력감시(PMS) 화면 개선\n- 수변전 단선도 갱신', '- 신규 피더 4개 반영\n- 태그 매핑 확인 32점\n- 알람 등급 재분류\n- 운영팀 검수 요청'],
    ['전력품질', '고조파 측정 및 분석\n- 인버터 부하 증가 구간', '- 측정 지점: MCC-03, MCC-05\n- THD(V) 4.2%, THD(I) 18.5%\n- 5차 고조파 우세\n- 능동필터 적용 검토'],
    ['전력품질', '순간전압강하 이력 정리\n- 한전 계통 이벤트', '- 9월 이벤트 3건 (최저 72%, 120ms)\n- 영향 설비: 진공펌프 2대 정지\n- UPS/DVR 적용 범위 검토'],
    ['설계', '증설 라인 단선결선도 검토\n- 설계사 2차 도면', '- 단선결선도 rev.B 검토\n- 보호계전기 정정값 확인 필요 3건\n- 케이블 사이징 재계산 요청\n- 검토 의견서 송부'],
    ['설계', '비상발전기 용량 검토\n- 부하 증설 반영', '- 현 2,000kW × 2대\n- 비상부하 합계 3,420kW → 3,610kW\n- 기동 순서(시퀀스) 조정안 작성\n- 증설 필요성 보고 예정'],
    ['안전', '전기 작업허가서 검토\n- 협력사 정전 작업', '- 작업허가 5건 검토\n- LOTO 절차 누락 1건 보완 요청\n- 작업 전 안전교육 실시'],
    ['안전', '접지저항 정기 측정', '- 측정 지점 18개소\n- 최대 8.2Ω (기준 10Ω 이내)\n- 측정 기록 시스템 등록'],
    ['수변전', 'UPS 배터리 교체 검토\n- 2호기 내용연수 초과', '- 배터리 192셀, 설치 2019년\n- 내부저항 상승 셀 14개\n- 교체 견적 2개 업체 요청\n- 교체 시 바이패스 운전 계획 수립'],
  ];
  const NOTES = ['', '', '', '', '업체 회신 대기', '부품 납기 2주 지연, 대체품 검토 필요', '정전 일정 협의 필요', '예산 확인 요청'];

  // 새로고침해도 같은 예시가 나오도록 고정 시드 난수 사용
  function rng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  }
  const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

  // 구성원마다 업무 2~3건을 들고, 날마다 진행율이 오르다가 완료되면 새 업무로 바뀌는 흐름을 만든다
  function seed() {
    const cfg = window.APP_CONFIG;
    const rand = rng(7);
    const out = [];
    const today = DR.today();
    const days = [];
    let day = DR.shiftWorkday(today, -1); // 어제까지만 채우고 오늘은 비워 둔다
    for (let i = 0; i < 70; i++) {
      days.unshift(day);
      day = DR.shiftWorkday(day, -1);
    }
    const active = Object.fromEntries(cfg.MEMBERS.map((m) => [m, []]));
    // 예시용: 구성원을 파트에 고르게 배정
    const partOf = Object.fromEntries(cfg.MEMBERS.map((m, i) => [m, cfg.PARTS[i % cfg.PARTS.length]]));
    const newTask = (author) => {
      const [, title, content] = pick(rand, TASKS);
      const mates = cfg.MEMBERS.filter((m) => m !== author && partOf[m] === partOf[author]);
      const owners = rand() < 0.3 && mates.length ? [author, pick(rand, mates)] : [author];
      return { taskId: DR.taskId(), part: partOf[author], title, content, owners: owners.join(', '), p: 10 * (1 + Math.floor(rand() * 3)), note: pick(rand, NOTES) };
    };
    days.forEach((date) => {
      cfg.MEMBERS.forEach((author) => {
        const list = active[author];
        while (list.length < 2 + (rand() < 0.4 ? 1 : 0)) list.push(newTask(author));
        if (rand() < 0.06) return; // 가끔 미제출
        const at = new Date(DR.parseDate(date).setHours(16 + Math.floor(rand() * 3), Math.floor(rand() * 60))).toISOString();
        list.forEach((t) => {
          t.p = Math.min(100, t.p + 10 * Math.floor(rand() * 4));
          out.push({
            id: 'm-' + out.length,
            taskId: t.taskId,
            date,
            author,
            editor: author,
            part: t.part,
            title: t.title,
            content: t.content,
            progress: t.p >= 100 ? '완료' : `${t.p}%`,
            note: t.p >= 100 ? '' : t.note,
            owners: t.owners,
            createdAt: at,
            updatedAt: at,
          });
          if (rand() < 0.15) t.note = pick(rand, NOTES);
        });
        active[author] = list.filter((t) => t.p < 100);
      });
    });
    // 오늘은 앞의 4명만 이미 제출한 상태로 시작 (이월 업무를 그대로 제출했다고 가정)
    const last = days[days.length - 1];
    const now = new Date().toISOString();
    cfg.MEMBERS.slice(0, 4).forEach((author) => {
      out
        .filter((r) => r.author === author && r.date === last && r.progress !== '완료')
        .forEach((r) => out.push({ ...r, id: 'm-' + out.length, date: today, createdAt: now, updatedAt: now }));
    });
    return out;
  }

  // 다른 탭(=다른 사람 역할)에서 저장한 내용도 보이도록 매번 저장소에서 다시 읽는다
  function load() {
    const saved = DR.storage.get(KEY, null);
    if (saved) rows = saved;
    if (!rows) {
      rows = seed();
      persist();
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
