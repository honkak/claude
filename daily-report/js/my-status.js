/*
 * 내 현황 (구성원용)
 * 팀장 대시보드와 같은 기준(js/model.js의 TASK_RULES)으로 내 과제를 계산해,
 * 팀장 화면에 '정체'로 뜨기 전에 본인이 먼저 확인하고 손볼 수 있게 한다.
 * 일반 화면의 기능이며, 팀장 대시보드(dashboard/)를 떼어내도 그대로 동작한다.
 */
(function (DR) {
  if (typeof DR.registerTab !== 'function') return;
  const M = DR.model;
  const firstLine = (s) => String(s || '').split('\n')[0];

  // 먼저 확인할 과제와 그 이유
  function checks(tasks) {
    const { NO_REPORT_DAYS } = M.rules();
    const out = [];
    for (const t of tasks) {
      if (t.status === 'done') continue;
      if (t.status === 'stalled')
        out.push({ t, level: 'critical', order: 0, label: '팀장 화면에 정체로 표시 중', why: `${t.idle}일째 진행율 ${t.progress || '(빈칸)'} 그대로` });
      else if (t.warn)
        out.push({ t, level: 'warn', order: 1, label: `${t.stallIn}일 후 팀장 화면에 정체로 표시`, why: `${t.idle}일째 진행율 ${t.progress || '(빈칸)'} 그대로 (${DR.shortDate(t.changeDate)}부터)` });
      else if (t.sinceReport >= NO_REPORT_DAYS)
        out.push({ t, level: 'info', order: 2, label: `${t.sinceReport}일째 보고 없음`, why: `마지막 보고 ${DR.shortDate(t.lastSeen)}. 계속 진행 중이면 오늘 보고에 넣어 주세요` });
    }
    return out.sort((a, b) => a.order - b.order || a.t.stallIn - b.t.stallIn);
  }

  function create(store) {
    const st = { tasks: [], todayRows: [], loadedAt: null, me: '' };
    let root;
    const $ = (sel) => root.querySelector(sel);

    async function load() {
      st.me = DR.app.me();
      if (!st.me) return render();
      const today = DR.today();
      try {
        // 기준 범위(기본 올해 1월 1일~) 데이터를 공유해서 쓴다
        const rows = await M.baseRows(store);
        const mine = rows.filter((r) => r.author === st.me || M.ownersOf(r).includes(st.me));
        st.tasks = M.buildTasks(mine, today);
        st.todayRows = mine.filter((r) => r.date === today);
        st.loadedAt = new Date();
      } catch (e) {
        st.tasks = [];
        DR.toast(e.message || String(e), 'error');
      }
      render();
      updateBadge();
    }

    function updateBadge() {
      const btn = document.getElementById('tab-mine');
      if (!btn) return;
      const n = checks(st.tasks).filter((c) => c.level !== 'info').length;
      btn.innerHTML = `내 현황${n ? ` <span class="tab-badge" title="정체이거나 곧 정체로 표시될 과제">${n}</span>` : ''}`;
    }

    function render() {
      if (!st.me) {
        root.innerHTML = '<div class="empty-state"><strong>먼저 이름을 입력하세요.</strong><span>상단 오른쪽 이름 버튼에서 입력할 수 있습니다.</span></div>';
        return;
      }
      const { STALL_DAYS, WARN_DAYS } = M.rules();
      const open = st.tasks.filter((t) => t.status !== 'done');
      const list = checks(st.tasks);
      const stalled = open.filter((t) => t.status === 'stalled').length;
      const avg = open.length ? Math.round(open.reduce((s, t) => s + (t.pct ?? 0), 0) / open.length) : null;
      const wk = DR.weekStart(DR.today());
      const doneWeek = st.tasks.filter((t) => t.doneDate && t.doneDate >= wk).length;
      const todayDone = st.todayRows.length;

      const card = (c) => `<div class="ms-item lv-${c.level}">
          <span class="ms-flag"><i aria-hidden="true">${c.level === 'info' ? '…' : '!'}</i>${DR.esc(c.label)}</span>
          <div class="ms-body">
            <div class="ms-title"><span class="tid-cell">${DR.esc(c.t.id)}</span> ${DR.esc(firstLine(c.t.title))}</div>
            <div class="meta">${DR.esc(c.t.part)} · 담당 ${DR.esc(c.t.owners.join(', '))} · ${DR.esc(c.why)}</div>
          </div>
          <button type="button" class="btn" data-open="${DR.esc(c.t.key)}">오늘 보고에서 업데이트</button>
        </div>`;

      const pill = (t) =>
        t.status === 'done'
          ? '<span class="pill pill-ok">✓ 완료</span>'
          : t.status === 'stalled'
            ? '<span class="pill pill-danger">! 정체</span>'
            : t.warn
              ? '<span class="pill pill-warn">! 주의</span>'
              : '<span class="pill pill-part">진행 중</span>';
      const visible = st.tasks
        .filter((t) => t.status !== 'done' || M.daysBetween(t.doneDate, DR.today()) <= 14)
        .sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.idle - a.idle);

      root.innerHTML = `
        <div class="ms">
          <div class="ms-head">
            <div><h2>내 현황 · ${DR.esc(st.me)}</h2>
              <p class="meta">팀장 대시보드와 같은 기준으로 계산합니다${st.loadedAt ? ` · ${DR.fmtTime(st.loadedAt.toISOString())} 기준` : ''}</p></div>
            <button type="button" class="btn" data-act="refresh">새로고침</button>
          </div>
          <div class="banner banner-carry">진행율이 <b>${STALL_DAYS}일</b> 이상 그대로인 과제는 팀장 대시보드에 <b>정체</b>로 표시됩니다.
            ${WARN_DAYS}일째부터 여기서 먼저 알려드리니, 그 전에 진행율을 갱신하거나 끝난 과제는 완료 처리하세요.</div>
          <div class="summary">
            <div class="stat"><span class="stat-label">내 진행 중 과제</span><span class="stat-val">${open.length}<small>건 · 평균 ${avg ?? '-'}%</small></span></div>
            <div class="stat"><span class="stat-label">먼저 확인할 과제</span><span class="stat-val ${list.length ? 'warn' : ''}">${list.length}<small>건</small></span></div>
            <div class="stat"><span class="stat-label">팀장 화면에 정체로 표시 중</span><span class="stat-val ${stalled ? 'danger' : ''}">${stalled}<small>건</small></span></div>
            <div class="stat"><span class="stat-label">오늘 보고 / 이번 주 완료</span><span class="stat-val">${todayDone ? `${todayDone}<small>건 저장됨</small>` : '<small>아직 안 함</small>'} · ${doneWeek}<small>건 완료</small></span></div>
          </div>
          <section class="block">
            <header class="block-head"><h2>먼저 확인할 과제</h2></header>
            ${list.length ? `<div class="ms-list">${list.map(card).join('')}</div>` : '<p class="rows-empty">확인할 과제가 없습니다. 팀장 대시보드에도 문제없이 보입니다.</p>'}
          </section>
          <section class="block">
            <header class="block-head"><h2>내 과제 전체</h2><span class="meta">진행 중 과제와 최근 2주 안에 완료한 과제</span></header>
            <div class="grid-wrap"><table class="sheet ms-table">
              <thead><tr><th>상태</th><th>과제번호</th><th>제목</th><th class="c">진행율</th><th>최근 보고</th><th>진행율 변화</th><th>정체까지</th><th></th></tr></thead>
              <tbody>${
                visible
                  .map(
                    (t) => `<tr>
                      <td>${pill(t)}</td>
                      <td class="tid-cell">${DR.esc(t.id)}</td>
                      <td class="title">${DR.esc(firstLine(t.title))}</td>
                      <td class="prog">${DR.esc(t.progress)}</td>
                      <td class="nowrap">${DR.shortDate(t.lastSeen)}</td>
                      <td class="nowrap">${t.status === 'done' ? `${DR.shortDate(t.doneDate)} 완료` : t.idle ? `${t.idle}일째 그대로` : '오늘 갱신'}</td>
                      <td class="nowrap">${t.status === 'done' ? '-' : t.stallIn > 0 ? `${t.stallIn}일 남음` : '정체 중'}</td>
                      <td>${t.status === 'done' ? '' : `<button type="button" class="btn small" data-open="${DR.esc(t.key)}">업데이트</button>`}</td>
                    </tr>`
                  )
                  .join('') || '<tr><td colspan="8" class="grid-empty">최근 과제가 없습니다.</td></tr>'
              }</tbody>
            </table></div>
          </section>
        </div>`;
    }

    return {
      mount(el) {
        root = el;
        root.addEventListener('click', (e) => {
          if (e.target.closest('[data-act="refresh"]')) return load();
          const b = e.target.closest('[data-open]');
          if (!b) return;
          const t = st.tasks.find((x) => x.key === b.dataset.open);
          if (t) DR.app.openTaskInInput(t.last);
        });
        // 저장하거나 작성자를 바꾸면 다시 계산 (탭 배지도 함께 갱신)
        document.addEventListener('dr:saved', load);
        document.addEventListener('dr:me-changed', load);
        load();
      },
      show: load,
    };
  }

  let view;
  DR.registerTab({
    id: 'mine',
    label: '내 현황',
    before: 'leader',
    mount(el, { store }) {
      view = create(store);
      view.mount(el);
    },
    show: () => view && view.show(),
  });
})(window.DR);
