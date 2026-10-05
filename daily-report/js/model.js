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

  DR.model = M;

  // 설정에 따라 저장소를 고른다 (store-*.js가 먼저 로드되어 있어야 함)
  DR.createStore = () => (cfg().STORE === 'goodocs' ? DR.createGoodocsStore() : DR.createMockStore());
})(window.DR);
