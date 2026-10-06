/*
 * 보고 데이터 해석 규칙 (일반 화면과 팀장 대시보드가 함께 쓴다)
 * 완료 판단, 담당자, 파트 같은 규칙을 한곳에 두어 두 화면의 계산이 어긋나지 않게 한다.
 */
(function (DR) {
  const cfg = () => window.APP_CONFIG;
  const M = {};

  M.byTime = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));

  // 진행율은 자유입력. 숫자로 읽히면(예: 70, 70%) 그 값, '완료'는 100
  M.percentOf = (v) => {
    const m = String(v ?? '').trim().match(/^(\d{1,3})\s*%?$/);
    return m ? Math.min(100, Number(m[1])) : /완료/.test(v) ? 100 : null;
  };
  M.isDone = (v) => M.percentOf(v) === 100;

  // 담당자는 '김민준, 이서연'처럼 쉼표로 이어 저장한다. 비어 있으면 작성자가 담당자
  M.splitOwners = (s) => [...new Set(String(s ?? '').split(/[,，;/]/).map((x) => x.trim()).filter(Boolean))];
  M.ownersOf = (r) => {
    const list = M.splitOwners(r.owners);
    return list.length ? list : r.author ? [r.author] : [];
  };

  M.NO_PART = '파트 미지정';
  M.partOf = (r) => String(r.part ?? '').trim() || M.NO_PART;

  // 설정의 파트 순서 + 설정에 없는 파트 + 파트 미지정
  M.partList = (rows) => {
    const used = [...new Set(rows.map(M.partOf))];
    const extra = used.filter((p) => !cfg().PARTS.includes(p) && p !== M.NO_PART).sort();
    return [...cfg().PARTS, ...extra, ...(used.includes(M.NO_PART) ? [M.NO_PART] : [])];
  };

  // 같은 파트 안에서는 담당자 순(설정의 팀원 순서) → 작성 순
  M.memberRank = (r) => {
    const i = cfg().MEMBERS.indexOf(M.ownersOf(r)[0]);
    return i < 0 ? 999 : i;
  };
  M.byOwner = (a, b) => M.memberRank(a) - M.memberRank(b) || M.byTime(a, b);

  /* ── 과제 상태 판단 (팀장 대시보드와 '내 현황'이 같은 기준을 쓴다) ── */
  M.rules = () => ({ STALL_DAYS: 30, WARN_DAYS: 21, NO_REPORT_DAYS: 7, ...(cfg().TASK_RULES || {}) });

  // a에서 b까지 지난 날수 (달력 기준)
  M.daysBetween = (a, b) => Math.round((DR.parseDate(b) - DR.parseDate(a)) / 86400000);

  // 과제번호(P1-261005-01)에 담긴 등록일
  M.registeredOf = (id, fallback) => {
    const m = String(id || '').match(/-(\d{2})(\d{2})(\d{2})-/);
    return m ? `20${m[1]}-${m[2]}-${m[3]}` : fallback;
  };

  // 날마다 쌓인 보고 줄을 과제번호 단위로 묶어, 과제마다 현재 상태를 계산한다
  //   status: active(진행 중) / stalled(정체: 진행율이 STALL_DAYS 이상 그대로) / done(완료)
  //   warn: 아직 정체는 아니지만 WARN_DAYS 이상 그대로 → 곧 팀장 화면에 정체로 뜸
  M.buildTasks = (rows, today = DR.today()) => {
    const { STALL_DAYS, WARN_DAYS } = M.rules();
    const groups = new Map();
    for (const r of rows) {
      const key = r.taskId || `${r.author}|${String(r.title).trim()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const tasks = [];
    for (const [key, list] of groups) {
      list.sort((a, b) => a.date.localeCompare(b.date) || M.byTime(a, b));
      const last = list[list.length - 1];
      const done = M.isDone(last.progress);
      // 진행율이 마지막으로 바뀐 날 (뒤에서부터 같은 진행율이 이어진 첫날)
      let changeDate = last.date;
      for (let i = list.length - 2; i >= 0; i--) {
        if (String(list[i].progress).trim() !== String(last.progress).trim()) break;
        changeDate = list[i].date;
      }
      const doneRow = done ? list.find((r) => M.isDone(r.progress)) : null;
      const idle = M.daysBetween(changeDate, today);
      const status = done ? 'done' : idle >= STALL_DAYS ? 'stalled' : 'active';
      tasks.push({
        id: last.taskId || '',
        key,
        part: M.partOf(last),
        title: String(last.title || last.content || '').trim(),
        owners: M.ownersOf(last),
        authors: [...new Set(list.map((r) => r.author).filter(Boolean))],
        progress: String(last.progress || '').trim(),
        pct: M.percentOf(last.progress),
        registered: M.registeredOf(last.taskId, list[0].date),
        lastSeen: last.date,
        sinceReport: M.daysBetween(last.date, today),
        changeDate,
        idle,
        stallIn: STALL_DAYS - idle, // 정체로 잡히기까지 남은 날
        warn: status === 'active' && idle >= WARN_DAYS,
        doneDate: doneRow ? doneRow.date : null,
        status,
        last,
        history: list,
      });
    }
    return tasks;
  };

  DR.model = M;

  // 설정에 따라 저장소를 고른다 (store-*.js가 먼저 로드되어 있어야 함)
  DR.createStore = () => (cfg().STORE === 'goodocs' ? DR.createGoodocsStore() : DR.createMockStore());
})(window.DR);
