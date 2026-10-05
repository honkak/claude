(function (DR) {
  const cfg = window.APP_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const store = cfg.STORE === 'goodocs' ? DR.createGoodocsStore() : DR.createMockStore();

  const state = {
    tab: DR.storage.get('dr-tab', 'input'),
    me: DR.storage.get('dr-me', ''),
    inDate: DR.today(),
    server: [], // 서버에 저장된 내 행
    draft: [], // 화면에서 편집 중인 내 행
    saving: false,
    ld: {
      mode: DR.storage.get('dr-ld-mode', 'day'),
      date: DR.today(),
      issuesOnly: false,
      rows: [],
      loadedAt: null,
      loading: false,
    },
  };
  if (!cfg.MEMBERS.includes(state.me)) state.me = '';

  const PROGRESS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const byKindThenTime = (a, b) =>
    (a.kind === b.kind ? 0 : a.kind === '오늘' ? -1 : 1) || String(a.createdAt).localeCompare(String(b.createdAt));

  /* ───────────── 공통 ───────────── */

  function setTab(tab) {
    state.tab = tab;
    DR.storage.set('dr-tab', tab);
    $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('#view-input').hidden = tab !== 'input';
    $('#view-leader').hidden = tab !== 'leader';
    if (tab === 'leader') loadLeader();
  }

  function showError(err) {
    console.error(err);
    DR.toast(err.message || String(err), 'error');
  }

  /* ───────────── 팀원: 내 업무 입력 ───────────── */

  const editable = () => state.inDate >= DR.addDays(DR.today(), -cfg.EDIT_PAST_DAYS);

  function diff() {
    const serverById = new Map(state.server.map((r) => [r.id, r]));
    const keep = new Set();
    const creates = [];
    const updates = [];
    const removes = [];
    for (const d of state.draft) {
      const content = d.content.trim();
      if (d.id.startsWith('tmp-')) {
        if (content) creates.push(d);
        continue;
      }
      keep.add(d.id);
      const s = serverById.get(d.id);
      if (!content) removes.push(d.id);
      else if (
        s &&
        (s.content !== content || s.kind !== d.kind || (s.progress ?? null) !== (d.progress ?? null) || (s.issue || '') !== d.issue.trim())
      )
        updates.push(d);
    }
    for (const s of state.server) if (!keep.has(s.id)) removes.push(s.id);
    return { creates, updates, removes, count: creates.length + updates.length + removes.length };
  }
  const isDirty = () => diff().count > 0;

  function updateSavebar() {
    const n = diff().count;
    $('#dirty-text').textContent = !editable()
      ? '지난 보고는 볼 수만 있습니다'
      : n
        ? `저장하지 않은 변경 ${n}건`
        : state.server.length
          ? '모두 저장됨'
          : '';
    $('#dirty-text').classList.toggle('pending', n > 0);
    $('#save-btn').disabled = !editable() || n === 0 || state.saving;
    $('#save-btn').textContent = state.saving ? '저장 중…' : '저장';
  }

  function rowHtml(r, ro) {
    const dis = ro ? 'disabled' : '';
    const content = `<input type="text" class="cell-content" data-f="content" value="${DR.esc(r.content)}" placeholder="${
      r.kind === '오늘' ? '예: 냉각수 펌프 #3 진동 점검' : '내일 할 업무'
    }" aria-label="업무 내용" ${dis}>`;
    const del = ro ? '<span></span>' : `<button type="button" class="icon-btn del" data-del aria-label="행 삭제">×</button>`;
    if (r.kind === '내일') return `<div class="row row-plan" data-id="${r.id}">${content}${del}</div>`;
    const opts = PROGRESS.map((p) => `<option value="${p}" ${r.progress === p ? 'selected' : ''}>${p}%</option>`).join('');
    return `<div class="row row-today" data-id="${r.id}">
      ${content}
      <select data-f="progress" aria-label="진행률" ${dis}>${opts}</select>
      <input type="text" data-f="issue" value="${DR.esc(r.issue)}" placeholder="없으면 비워두기" aria-label="이슈·지원요청" ${dis}>
      ${del}
    </div>`;
  }

  function renderInput() {
    const sel = $('#me-select');
    sel.innerHTML =
      `<option value="">이름 선택</option>` +
      cfg.MEMBERS.map((m) => `<option ${m === state.me ? 'selected' : ''}>${DR.esc(m)}</option>`).join('');
    $('#in-date').value = state.inDate;
    $('#in-empty').hidden = !!state.me;
    $('#in-body').hidden = !state.me;
    if (!state.me) return;

    const ro = !editable();
    $('#in-heading').textContent = `${DR.labelDate(state.inDate)} · ${state.me}`;
    const notice = $('#in-notice');
    notice.hidden = !ro;
    notice.textContent = ro ? '지난 날짜의 보고입니다. 수정이 필요하면 팀장에게 요청하세요.' : '';

    for (const [kind, box] of [['오늘', '#rows-today'], ['내일', '#rows-plan']]) {
      const rows = state.draft.filter((r) => r.kind === kind);
      $(box).innerHTML = rows.length
        ? rows.map((r) => rowHtml(r, ro)).join('')
        : `<p class="rows-empty">${kind === '오늘' ? '아직 입력한 업무가 없습니다.' : '내일 계획이 없습니다.'}</p>`;
    }
    $$('#view-input [data-add], #pull-plan').forEach((b) => (b.hidden = ro));
    updateSavebar();
  }

  async function loadMine() {
    if (!state.me) return renderInput();
    try {
      const rows = await store.list({ from: state.inDate, to: state.inDate, author: state.me });
      rows.sort(byKindThenTime);
      state.server = rows;
      state.draft = rows.map((r) => ({ ...r, issue: r.issue || '' }));
      if (editable() && !state.draft.some((r) => r.kind === '오늘')) state.draft.push(blank('오늘'));
    } catch (e) {
      state.server = [];
      state.draft = [];
      showError(e);
    }
    renderInput();
  }

  const blank = (kind) => ({
    id: DR.tmpId(),
    date: state.inDate,
    author: state.me,
    kind,
    content: '',
    progress: kind === '오늘' ? 0 : null,
    issue: '',
  });

  function addRow(kind, focus = true) {
    const r = blank(kind);
    state.draft.push(r);
    renderInput();
    if (focus) $(`[data-id="${r.id}"] .cell-content`)?.focus();
  }

  async function pullPlan() {
    try {
      const from = DR.addDays(state.inDate, -14);
      const to = DR.addDays(state.inDate, -1);
      const rows = (await store.list({ from, to, author: state.me })).filter((r) => r.kind === '내일');
      if (!rows.length) return DR.toast('최근 2주 안에 적어 둔 계획이 없습니다.', 'warn');
      const last = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
      const have = new Set(state.draft.map((r) => r.content.trim()));
      const picked = rows.filter((r) => r.date === last && !have.has(r.content.trim()));
      if (!picked.length) return DR.toast('불러올 새 계획이 없습니다. 이미 모두 들어가 있습니다.', 'warn');
      // 비어 있는 첫 행은 불러온 계획으로 대체
      state.draft = state.draft.filter((r) => !(r.id.startsWith('tmp-') && !r.content.trim() && r.kind === '오늘'));
      picked.forEach((p) => state.draft.push({ ...blank('오늘'), content: p.content }));
      renderInput();
      DR.toast(`${DR.shortDate(last)} 계획 ${picked.length}건을 불러왔습니다. 진행률을 입력하고 저장하세요.`);
    } catch (e) {
      showError(e);
    }
  }

  async function save() {
    if (!editable() || state.saving) return;
    const { creates, updates, removes, count } = diff();
    if (!count) return;
    state.saving = true;
    updateSavebar();
    try {
      const clean = (r) => ({
        date: state.inDate,
        author: state.me,
        kind: r.kind,
        content: r.content.trim(),
        progress: r.kind === '오늘' ? r.progress ?? 0 : null,
        issue: r.kind === '오늘' ? r.issue.trim() : '',
      });
      if (creates.length) await store.create(creates.map(clean));
      for (const r of updates) {
        const { date, author, ...patch } = clean(r);
        await store.update(r.id, patch);
      }
      for (const id of removes) await store.remove(id);
      DR.toast('저장했습니다.');
      await loadMine();
    } catch (e) {
      showError(e);
    } finally {
      state.saving = false;
      updateSavebar();
    }
  }

  // 저장 안 된 변경이 있으면 이동 전에 확인
  async function guard() {
    return !isDirty() || DR.confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?', '버리고 이동');
  }

  async function goInputDate(date) {
    if (!date || date === state.inDate) return renderInput();
    if (!(await guard())) return renderInput();
    state.inDate = date;
    loadMine();
  }

  function bindInput() {
    $('#me-select').addEventListener('change', async (e) => {
      if (!(await guard())) return renderInput();
      state.me = e.target.value;
      DR.storage.set('dr-me', state.me);
      loadMine();
    });
    $('#in-date').addEventListener('change', (e) => goInputDate(e.target.value));
    $('#in-prev').onclick = () => goInputDate(DR.shiftWorkday(state.inDate, -1));
    $('#in-next').onclick = () => goInputDate(DR.shiftWorkday(state.inDate, 1));
    $('#in-today').onclick = () => goInputDate(DR.today());
    $('#pull-plan').onclick = pullPlan;
    $('#save-btn').onclick = save;
    $$('#view-input [data-add]').forEach((b) => (b.onclick = () => addRow(b.dataset.add)));

    const body = $('#in-body');
    body.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      const id = e.target.closest('[data-id]')?.dataset.id;
      const r = state.draft.find((x) => x.id === id);
      if (!f || !r) return;
      r[f] = f === 'progress' ? Number(e.target.value) : e.target.value;
      updateSavebar();
    });
    body.addEventListener('click', (e) => {
      if (!e.target.closest('[data-del]')) return;
      const id = e.target.closest('[data-id]').dataset.id;
      state.draft = state.draft.filter((x) => x.id !== id);
      renderInput();
    });
    // 업무 내용에서 Enter → 아래에 새 행
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.target.matches('.cell-content')) {
        e.preventDefault();
        const id = e.target.closest('[data-id]').dataset.id;
        addRow(state.draft.find((x) => x.id === id).kind);
      }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.tab === 'input') {
        e.preventDefault();
        save();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ───────────── 팀장: 팀 현황 ───────────── */

  function weekDays(date) {
    const mon = DR.weekStart(date);
    return [0, 1, 2, 3, 4].map((i) => DR.addDays(mon, i));
  }

  function range() {
    const ld = state.ld;
    if (ld.mode === 'day') return { from: ld.date, to: ld.date };
    const days = weekDays(ld.date);
    return { from: days[0], to: days[4] };
  }

  // 설정의 팀원 순서 + 목록에 없는 작성자(퇴사·전입 등)
  function members(rows) {
    const extra = [...new Set(rows.map((r) => r.author))].filter((a) => !cfg.MEMBERS.includes(a)).sort();
    return [...cfg.MEMBERS, ...extra];
  }

  async function loadLeader() {
    const ld = state.ld;
    ld.loading = true;
    renderLeader();
    try {
      ld.rows = await store.list(range());
      ld.loadedAt = new Date();
    } catch (e) {
      ld.rows = [];
      showError(e);
    }
    ld.loading = false;
    renderLeader();
  }

  function progressCell(p) {
    if (p == null) return '';
    const tone = p >= 100 ? 'done' : p >= 50 ? 'mid' : 'low';
    return `<div class="pbar" data-tone="${tone}"><span style="width:${p}%"></span></div><b>${p}%</b>`;
  }

  // 표 데이터(머리글 + 행)를 만든다. 화면, 복사, CSV가 같은 데이터를 쓴다
  function dayTable() {
    const ld = state.ld;
    const rows = ld.rows.filter((r) => r.date === ld.date);
    const groups = members(rows).map((name) => {
      let mine = rows.filter((r) => r.author === name).sort(byKindThenTime);
      const submitted = mine.length > 0;
      if (ld.issuesOnly) mine = mine.filter((r) => r.issue);
      return { name, submitted, rows: mine };
    });
    return groups.filter((g) => (ld.issuesOnly ? g.rows.length : g.submitted || cfg.MEMBERS.includes(g.name)));
  }

  function renderDay() {
    const groups = dayTable();
    const cols = ['이름', '구분', '업무 내용', '진행률', '이슈 · 지원요청', '작성시각'];
    const letters = 'ABCDEF';
    let n = 0;
    const body = groups
      .map((g) => {
        if (!g.submitted) {
          n++;
          return `<tr class="missing"><th class="rn">${n}</th><td class="name">${DR.esc(g.name)}</td><td colspan="5"><span class="pill pill-danger">미제출</span></td></tr>`;
        }
        return g.rows
          .map((r, i) => {
            n++;
            const nameCell =
              i === 0 ? `<td class="name" rowspan="${g.rows.length}">${DR.esc(g.name)}</td>` : '';
            const kindCell = `<td class="kind"><span class="pill ${r.kind === '오늘' ? 'pill-today' : 'pill-plan'}">${r.kind === '오늘' ? '오늘 한 일' : '내일 할 일'}</span></td>`;
            const last = i === g.rows.length - 1 ? ' class="group-end"' : '';
            return `<tr${last}><th class="rn">${n}</th>${nameCell}${kindCell}<td class="content">${DR.esc(r.content)}</td><td class="prog">${progressCell(r.progress)}</td><td class="issue">${
              r.issue ? `<span class="issue-mark">!</span>${DR.esc(r.issue)}` : ''
            }</td><td class="time">${DR.fmtTime(r.updatedAt || r.createdAt)}</td></tr>`;
          })
          .join('');
      })
      .join('');
    const empty = `<tr><th class="rn">1</th><td colspan="6" class="grid-empty">이슈가 등록된 업무가 없습니다.</td></tr>`;
    return `<table class="sheet sheet-day">
      <thead><tr class="letters"><th class="corner"></th>${cols.map((_, i) => `<th>${letters[i]}</th>`).join('')}</tr>
      <tr><th class="corner"></th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${body || empty}</tbody></table>`;
  }

  function weekTable() {
    const ld = state.ld;
    const days = weekDays(ld.date);
    return members(ld.rows).map((name) => ({
      name,
      cells: days.map((date) => {
        const mine = ld.rows.filter((r) => r.author === name && r.date === date);
        const today = mine.filter((r) => r.kind === '오늘');
        return {
          date,
          submitted: mine.length > 0,
          items: ld.issuesOnly ? today.filter((r) => r.issue) : today,
        };
      }),
    }));
  }

  function renderWeek() {
    const days = weekDays(state.ld.date);
    const t = DR.today();
    const rows = weekTable()
      .map((m, i) => {
        const cells = m.cells
          .map((c) => {
            if (!c.submitted) {
              return c.date <= t
                ? `<td class="wk missing-cell"><span class="pill pill-danger">미제출</span></td>`
                : `<td class="wk future"></td>`;
            }
            const items = c.items
              .map(
                (r) =>
                  `<li><span class="wk-text">${DR.esc(r.content)}</span><span class="wk-p">${r.progress ?? 0}%</span>${
                    r.issue ? `<span class="wk-issue" title="${DR.esc(r.issue)}">이슈: ${DR.esc(r.issue)}</span>` : ''
                  }</li>`
              )
              .join('');
            return `<td class="wk"><button type="button" class="wk-open" data-go="${c.date}" aria-label="${DR.esc(m.name)} ${DR.shortDate(c.date)} 일간 보기"></button><ul>${items || '<li class="muted">-</li>'}</ul></td>`;
          })
          .join('');
        return `<tr><th class="rn">${i + 1}</th><td class="name">${DR.esc(m.name)}</td>${cells}</tr>`;
      })
      .join('');
    const head = days
      .map((d) => `<th class="${d === t ? 'is-today' : ''}"><button type="button" class="day-link" data-go="${d}">${DR.weekdayName(d)} ${DR.shortDate(d)}</button></th>`)
      .join('');
    return `<table class="sheet sheet-week">
      <thead><tr class="letters"><th class="corner"></th>${'ABCDEF'.split('').map((l) => `<th>${l}</th>`).join('')}</tr>
      <tr><th class="corner"></th><th>이름</th>${head}</tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function renderSummary() {
    const ld = state.ld;
    const total = cfg.MEMBERS.length;
    if (ld.mode === 'day') {
      const rows = ld.rows.filter((r) => r.date === ld.date);
      const done = new Set(rows.map((r) => r.author));
      const missing = cfg.MEMBERS.filter((m) => !done.has(m));
      const issues = rows.filter((r) => r.issue);
      const today = rows.filter((r) => r.kind === '오늘');
      const avg = today.length ? Math.round(today.reduce((s, r) => s + (r.progress || 0), 0) / today.length) : null;
      const sub = cfg.MEMBERS.filter((m) => done.has(m)).length;
      return `
        <div class="stat"><span class="stat-label">제출</span><span class="stat-val">${sub}<small>/${total}명</small></span>
          <span class="meter"><span style="width:${total ? (sub / total) * 100 : 0}%"></span></span></div>
        <div class="stat"><span class="stat-label">미제출</span><span class="chips">${
          missing.length ? missing.map((m) => `<span class="pill pill-danger">${DR.esc(m)}</span>`).join('') : '<span class="pill pill-ok">전원 제출</span>'
        }</span></div>
        <div class="stat"><span class="stat-label">이슈 · 지원요청</span><span class="stat-val ${issues.length ? 'warn' : ''}">${issues.length}<small>건</small></span></div>
        <div class="stat"><span class="stat-label">오늘 업무 / 평균 진행률</span><span class="stat-val">${today.length}<small>건</small> · ${avg ?? '-'}<small>%</small></span></div>`;
    }
    const days = weekDays(ld.date).filter((d) => d <= DR.today());
    const expect = total * days.length;
    const got = cfg.MEMBERS.reduce((s, m) => s + days.filter((d) => ld.rows.some((r) => r.author === m && r.date === d)).length, 0);
    const issues = ld.rows.filter((r) => r.issue).length;
    return `
      <div class="stat"><span class="stat-label">주간 제출률 (지난 근무일 기준)</span><span class="stat-val">${expect ? Math.round((got / expect) * 100) : 0}<small>%</small></span>
        <span class="meter"><span style="width:${expect ? (got / expect) * 100 : 0}%"></span></span></div>
      <div class="stat"><span class="stat-label">제출 건수</span><span class="stat-val">${got}<small>/${expect}</small></span></div>
      <div class="stat"><span class="stat-label">이슈 · 지원요청</span><span class="stat-val ${issues ? 'warn' : ''}">${issues}<small>건</small></span></div>`;
  }

  function renderLeader() {
    const ld = state.ld;
    $$('.seg [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ld.mode)));
    $('#ld-date').value = ld.date;
    $('#issues-only').checked = ld.issuesOnly;
    $('#summary').innerHTML = renderSummary();
    $('#grid').innerHTML = ld.mode === 'day' ? renderDay() : renderWeek();
    $('#grid').setAttribute('aria-busy', String(ld.loading));
    const { from, to } = range();
    $('#loaded-at').textContent =
      (ld.mode === 'day' ? DR.labelDate(from) : `${DR.labelDate(from)} ~ ${DR.labelDate(to)}`) +
      (ld.loading ? ' · 불러오는 중…' : ld.loadedAt ? ` · ${DR.fmtTime(ld.loadedAt.toISOString())} 기준` : '');
  }

  // 복사·CSV용 2차원 배열
  function exportRows() {
    if (state.ld.mode === 'day') {
      const out = [['날짜', '이름', '구분', '업무 내용', '진행률', '이슈·지원요청', '작성시각']];
      for (const g of dayTable()) {
        if (!g.submitted) out.push([state.ld.date, g.name, '미제출', '', '', '', '']);
        for (const r of g.rows)
          out.push([r.date, g.name, r.kind === '오늘' ? '오늘 한 일' : '내일 할 일', r.content, r.progress == null ? '' : `${r.progress}%`, r.issue, DR.fmtTime(r.updatedAt || r.createdAt)]);
      }
      return out;
    }
    const days = weekDays(state.ld.date);
    const out = [['이름', ...days.map((d) => `${DR.weekdayName(d)} ${DR.shortDate(d)}`)]];
    for (const m of weekTable())
      out.push([
        m.name,
        ...m.cells.map((c) => (!c.submitted ? (c.date <= DR.today() ? '미제출' : '') : c.items.map((r) => `${r.content} (${r.progress ?? 0}%)${r.issue ? ` [이슈: ${r.issue}]` : ''}`).join('\n'))),
      ]);
    return out;
  }

  async function copyTsv() {
    const cell = (v) => {
      const s = String(v ?? '');
      return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const tsv = exportRows().map((r) => r.map(cell).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      DR.toast('복사했습니다. 엑셀에 붙여넣기(Ctrl+V) 하세요.');
    } catch {
      DR.toast('이 환경에서는 클립보드 복사가 막혀 있습니다. CSV 저장을 이용하세요.', 'error');
    }
  }

  function downloadCsv() {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + exportRows().map((r) => r.map(cell).join(',')).join('\r\n'); // BOM: 엑셀 한글 깨짐 방지
    const { from, to } = range();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `일일업무보고_${from === to ? from : `${from}_${to}`}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function goLeader(date, mode) {
    if (mode) {
      state.ld.mode = mode;
      DR.storage.set('dr-ld-mode', mode);
    }
    if (date) state.ld.date = date;
    loadLeader();
  }

  function bindLeader() {
    $$('.seg [data-mode]').forEach((b) => (b.onclick = () => goLeader(null, b.dataset.mode)));
    const step = (dir) =>
      state.ld.mode === 'day' ? DR.shiftWorkday(state.ld.date, dir) : DR.addDays(DR.weekStart(state.ld.date), dir * 7);
    $('#ld-prev').onclick = () => goLeader(step(-1));
    $('#ld-next').onclick = () => goLeader(step(1));
    $('#ld-today').onclick = () => goLeader(DR.today());
    $('#ld-date').addEventListener('change', (e) => e.target.value && goLeader(e.target.value));
    $('#issues-only').addEventListener('change', (e) => {
      state.ld.issuesOnly = e.target.checked;
      renderLeader();
    });
    $('#ld-refresh').onclick = loadLeader;
    $('#copy-tsv').onclick = copyTsv;
    $('#dl-csv').onclick = downloadCsv;
    $('#grid').addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) goLeader(go.dataset.go, 'day');
    });
    if (cfg.AUTO_REFRESH_SEC > 0) {
      setInterval(() => {
        if (state.tab === 'leader' && document.visibilityState === 'visible' && !state.ld.loading) loadLeader();
      }, cfg.AUTO_REFRESH_SEC * 1000);
    }
  }

  /* ───────────── 시작 ───────────── */

  function init() {
    $('#team-name').textContent = cfg.TEAM_NAME;
    const badge = $('#store-badge');
    badge.textContent = store.label;
    badge.dataset.kind = store.kind;
    badge.title =
      store.kind === 'mock' ? '예시 데이터입니다. 입력 내용은 이 브라우저에만 저장됩니다.' : 'goodocs 시트에 저장됩니다.';

    const configError = store.checkConfig?.();
    if (configError) {
      $('#config-error').hidden = false;
      $('#config-error').textContent = configError;
    }

    $$('.tabs [data-tab]').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
    bindInput();
    bindLeader();
    setTab(state.tab === 'leader' ? 'leader' : 'input');
    loadMine();
  }

  init();
})(window.DR);
