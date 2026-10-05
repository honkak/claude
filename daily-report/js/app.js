(function (DR) {
  const cfg = window.APP_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const store = cfg.STORE === 'goodocs' ? DR.createGoodocsStore() : DR.createMockStore();

  // 구성원이 입력하는 칸 (저장·비교·내보내기에 공통 사용)
  const FIELDS = ['part', 'title', 'content', 'progress', 'note'];

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
      part: '',
      rows: [],
      loadedAt: null,
      loading: false,
    },
  };
  if (!cfg.MEMBERS.includes(state.me)) state.me = '';

  const byTime = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));
  const isBlank = (r) => !r.title.trim() && !r.content.trim();
  // 진행율은 자유입력. 숫자로 읽히면(예: 70, 70%) 막대도 그린다
  const percentOf = (v) => {
    const m = String(v ?? '').trim().match(/^(\d{1,3})\s*%?$/);
    return m ? Math.min(100, Number(m[1])) : /완료/.test(v) ? 100 : null;
  };

  /* ───────────── 공통 ───────────── */

  function setTab(tab) {
    state.tab = tab;
    DR.storage.set('dr-tab', tab);
    $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('#view-input').hidden = tab !== 'input';
    $('#view-leader').hidden = tab !== 'leader';
    if (tab === 'leader') loadLeader();
    else autosizeAll();
  }

  function showError(err) {
    console.error(err);
    DR.toast(err.message || String(err), 'error');
  }

  // 글자 수만큼 칸이 늘어나는 입력칸
  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }
  const autosizeAll = () => $$('#entries textarea').forEach(autosize);

  /* ───────────── 구성원: 내 업무 입력 ───────────── */

  const editable = () => state.inDate >= DR.addDays(DR.today(), -cfg.EDIT_PAST_DAYS);
  const clean = (r) => Object.fromEntries(FIELDS.map((f) => [f, String(r[f] ?? '').trim()]));

  function diff() {
    const serverById = new Map(state.server.map((r) => [r.id, r]));
    const keep = new Set();
    const creates = [];
    const updates = [];
    const removes = [];
    for (const d of state.draft) {
      if (d.id.startsWith('tmp-')) {
        if (!isBlank(d)) creates.push(d);
        continue;
      }
      keep.add(d.id);
      const s = serverById.get(d.id);
      if (isBlank(d)) removes.push(d.id);
      else if (s) {
        const a = clean(d);
        const b = clean(s);
        if (FIELDS.some((f) => a[f] !== b[f])) updates.push(d);
      }
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

  function entryHtml(r, i, ro) {
    const dis = ro ? 'disabled' : '';
    const area = (f, label, ph, rows) =>
      `<label class="cell c-${f}"><span class="cell-label">${label}</span><textarea data-f="${f}" rows="${rows}" placeholder="${ph}" ${dis}>${DR.esc(r[f])}</textarea></label>`;
    const line = (f, label, ph, extra = '') =>
      `<label class="cell c-${f}"><span class="cell-label">${label}</span><input type="text" data-f="${f}" value="${DR.esc(r[f])}" placeholder="${ph}" ${extra} ${dis}></label>`;
    return `<div class="entry" data-id="${r.id}">
      <span class="entry-no">${i + 1}</span>
      ${line('part', '소속파트', '예: 공조', 'list="part-list"')}
      ${area('title', '제목', '업무 제목 (여러 줄 가능)', 3)}
      ${area('content', '내용', '세부 내용', 3)}
      ${line('progress', '진행율', '예: 70%')}
      ${area('note', '비고', '', 3)}
      ${ro ? '<span></span>' : '<button type="button" class="icon-btn del" data-del aria-label="이 업무 삭제">×</button>'}
    </div>`;
  }

  function renderInput() {
    $('#me-select').innerHTML =
      `<option value="">이름 선택</option>` +
      cfg.MEMBERS.map((m) => `<option ${m === state.me ? 'selected' : ''}>${DR.esc(m)}</option>`).join('');
    $('#in-date').value = state.inDate;
    $('#in-empty').hidden = !!state.me;
    $('#in-body').hidden = !state.me;
    if (!state.me) return;

    const ro = !editable();
    $('#in-heading').textContent = `${DR.labelDate(state.inDate)} · ${state.me}`;
    $('#in-notice').hidden = !ro;
    $('#in-notice').textContent = ro ? '지난 날짜의 보고입니다. 수정이 필요하면 팀장에게 요청하세요.' : '';
    $('#entries').innerHTML = state.draft.length
      ? state.draft.map((r, i) => entryHtml(r, i, ro)).join('')
      : '<p class="rows-empty">이 날짜에 작성한 업무가 없습니다.</p>';
    $('#add-entry').hidden = $('#pull-prev').hidden = ro;
    autosizeAll();
    updateSavebar();
  }

  // 새 행의 소속파트는 직전에 쓴 파트로 미리 채운다
  const lastPart = () =>
    [...state.draft].reverse().find((r) => r.part.trim())?.part || DR.storage.get(`dr-part:${state.me}`, '');

  const blank = (fill = {}) => ({
    id: DR.tmpId(),
    date: state.inDate,
    author: state.me,
    part: lastPart(),
    title: '',
    content: '',
    progress: '',
    note: '',
    ...fill,
  });

  async function loadMine() {
    if (!state.me) return renderInput();
    try {
      const rows = await store.list({ from: state.inDate, to: state.inDate, author: state.me });
      rows.sort(byTime);
      state.server = rows;
      state.draft = rows.map((r) => ({ ...r }));
      if (editable() && !state.draft.length) state.draft.push(blank());
    } catch (e) {
      state.server = [];
      state.draft = [];
      showError(e);
    }
    renderInput();
  }

  function addEntry() {
    const r = blank();
    state.draft.push(r);
    renderInput();
    $(`[data-id="${r.id}"] [data-f="title"]`)?.focus();
  }

  // 직전 보고(최근 2주 이내)의 업무를 그대로 복사해 오늘 칸에 넣는다
  async function pullPrev() {
    try {
      const rows = await store.list({ from: DR.addDays(state.inDate, -14), to: DR.addDays(state.inDate, -1), author: state.me });
      if (!rows.length) return DR.toast('최근 2주 안에 작성한 보고가 없습니다.', 'warn');
      const last = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
      const have = new Set(state.draft.map((r) => r.title.trim()));
      const picked = rows.filter((r) => r.date === last && !have.has(r.title.trim())).sort(byTime);
      if (!picked.length) return DR.toast('불러올 업무가 없습니다. 이미 모두 들어가 있습니다.', 'warn');
      state.draft = state.draft.filter((r) => !(r.id.startsWith('tmp-') && isBlank(r)));
      picked.forEach((p) => state.draft.push(blank(clean(p))));
      renderInput();
      DR.toast(`${DR.shortDate(last)} 보고 ${picked.length}건을 불러왔습니다. 내용과 진행율을 고친 뒤 저장하세요.`);
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
      if (creates.length) await store.create(creates.map((r) => ({ date: state.inDate, author: state.me, ...clean(r) })));
      for (const r of updates) await store.update(r.id, clean(r));
      for (const id of removes) await store.remove(id);
      const part = lastPart();
      if (part) DR.storage.set(`dr-part:${state.me}`, part);
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
    $('#pull-prev').onclick = pullPrev;
    $('#add-entry').onclick = addEntry;
    $('#save-btn').onclick = save;
    $('#part-list').innerHTML = cfg.PARTS.map((p) => `<option value="${DR.esc(p)}">`).join('');

    const box = $('#entries');
    box.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      const r = state.draft.find((x) => x.id === e.target.closest('[data-id]')?.dataset.id);
      if (!f || !r) return;
      r[f] = e.target.value;
      if (e.target.tagName === 'TEXTAREA') autosize(e.target);
      updateSavebar();
    });
    box.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-del]')) return;
      const id = e.target.closest('[data-id]').dataset.id;
      const r = state.draft.find((x) => x.id === id);
      if (!isBlank(r) && !(await DR.confirm('이 업무를 목록에서 지울까요? 저장해야 반영됩니다.', '지우기'))) return;
      state.draft = state.draft.filter((x) => x.id !== id);
      renderInput();
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
    window.addEventListener('resize', autosizeAll);
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

  // 설정의 팀원 순서 + 목록에 없는 작성자(전입 등)
  function members(rows) {
    const extra = [...new Set(rows.map((r) => r.author))].filter((a) => !cfg.MEMBERS.includes(a)).sort();
    return [...cfg.MEMBERS, ...extra];
  }

  const partMatch = (r) => !state.ld.part || r.part.trim() === state.ld.part;

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

  function progressHtml(v) {
    if (!String(v ?? '').trim()) return '';
    const p = percentOf(v);
    if (p == null) return `<span class="ptext">${DR.esc(v)}</span>`;
    const tone = p >= 100 ? 'done' : p >= 50 ? 'mid' : 'low';
    return `<div class="pbar" data-tone="${tone}"><span style="width:${p}%"></span></div><b>${DR.esc(v)}</b>`;
  }

  // 화면·복사·CSV가 같은 데이터를 쓴다
  function dayGroups() {
    const ld = state.ld;
    const rows = ld.rows.filter((r) => r.date === ld.date);
    return members(rows)
      .map((name) => {
        const all = rows.filter((r) => r.author === name).sort(byTime);
        return { name, submitted: all.length > 0, rows: all.filter(partMatch) };
      })
      .filter((g) => (ld.part ? g.rows.length : g.submitted || cfg.MEMBERS.includes(g.name)));
  }

  const multi = (s) => DR.esc(s); // 줄바꿈은 CSS(pre-wrap)로 살린다

  function renderDay() {
    const cols = ['이름', '소속파트', '제목', '내용', '진행율', '비고', '작성시각'];
    let n = 0;
    const body = dayGroups()
      .map((g) => {
        if (!g.submitted) {
          n++;
          return `<tr class="missing group-end"><th class="rn">${n}</th><td class="name">${DR.esc(g.name)}</td><td colspan="6"><span class="pill pill-danger">미제출</span></td></tr>`;
        }
        return g.rows
          .map((r, i) => {
            n++;
            const nameCell = i === 0 ? `<td class="name" rowspan="${g.rows.length}">${DR.esc(g.name)}</td>` : '';
            const end = i === g.rows.length - 1 ? ' class="group-end"' : '';
            return `<tr${end}><th class="rn">${n}</th>${nameCell}
              <td class="part">${DR.esc(r.part)}</td>
              <td class="title">${multi(r.title)}</td>
              <td class="content">${multi(r.content)}</td>
              <td class="prog">${progressHtml(r.progress)}</td>
              <td class="note">${multi(r.note)}</td>
              <td class="time">${DR.fmtTime(r.updatedAt || r.createdAt)}</td></tr>`;
          })
          .join('');
      })
      .join('');
    const empty = `<tr><th class="rn">1</th><td colspan="7" class="grid-empty">이 파트의 보고가 없습니다.</td></tr>`;
    return `<table class="sheet sheet-day">
      <thead><tr class="letters"><th class="corner"></th>${cols.map((_, i) => `<th>${'ABCDEFG'[i]}</th>`).join('')}</tr>
      <tr><th class="corner"></th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${body || empty}</tbody></table>`;
  }

  function weekTable() {
    const ld = state.ld;
    const days = weekDays(ld.date);
    return members(ld.rows)
      .map((name) => ({
        name,
        cells: days.map((date) => {
          const mine = ld.rows.filter((r) => r.author === name && r.date === date).sort(byTime);
          return { date, submitted: mine.length > 0, items: mine.filter(partMatch) };
        }),
      }))
      .filter((m) => !ld.part || m.cells.some((c) => c.items.length));
  }

  const firstLine = (s) => String(s || '').split('\n')[0];

  function renderWeek() {
    const days = weekDays(state.ld.date);
    const t = DR.today();
    const rows = weekTable()
      .map((m, i) => {
        const cells = m.cells
          .map((c) => {
            if (!c.submitted)
              return c.date <= t ? `<td class="wk missing-cell"><span class="pill pill-danger">미제출</span></td>` : `<td class="wk future"></td>`;
            const items = c.items
              .map(
                (r) =>
                  `<li><span class="wk-text">${DR.esc(firstLine(r.title) || firstLine(r.content))}</span><span class="wk-p">${DR.esc(r.progress)}</span>${
                    r.note.trim() ? `<span class="wk-note">비고: ${DR.esc(firstLine(r.note))}</span>` : ''
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
      const sub = total - missing.length;
      const parts = new Set(rows.map((r) => r.part.trim()).filter(Boolean));
      const notes = rows.filter((r) => r.note.trim()).length;
      return `
        <div class="stat"><span class="stat-label">제출</span><span class="stat-val">${sub}<small>/${total}명</small></span>
          <span class="meter"><span style="width:${total ? (sub / total) * 100 : 0}%"></span></span></div>
        <div class="stat"><span class="stat-label">미제출</span><span class="chips">${
          missing.length ? missing.map((m) => `<span class="pill pill-danger">${DR.esc(m)}</span>`).join('') : '<span class="pill pill-ok">전원 제출</span>'
        }</span></div>
        <div class="stat"><span class="stat-label">업무 / 파트</span><span class="stat-val">${rows.length}<small>건</small> · ${parts.size}<small>개 파트</small></span></div>
        <div class="stat"><span class="stat-label">비고 작성</span><span class="stat-val ${notes ? 'warn' : ''}">${notes}<small>건</small></span></div>`;
    }
    const days = weekDays(ld.date).filter((d) => d <= DR.today());
    const expect = total * days.length;
    const got = cfg.MEMBERS.reduce((s, m) => s + days.filter((d) => ld.rows.some((r) => r.author === m && r.date === d)).length, 0);
    return `
      <div class="stat"><span class="stat-label">주간 제출률 (오늘까지)</span><span class="stat-val">${expect ? Math.round((got / expect) * 100) : 0}<small>%</small></span>
        <span class="meter"><span style="width:${expect ? (got / expect) * 100 : 0}%"></span></span></div>
      <div class="stat"><span class="stat-label">제출 건수 (사람 × 일)</span><span class="stat-val">${got}<small>/${expect}</small></span></div>
      <div class="stat"><span class="stat-label">이번 주 업무</span><span class="stat-val">${ld.rows.length}<small>건</small></span></div>`;
  }

  function renderPartFilter() {
    const parts = [...new Set([...cfg.PARTS, ...state.ld.rows.map((r) => r.part.trim()).filter(Boolean)])];
    if (state.ld.part && !parts.includes(state.ld.part)) parts.push(state.ld.part);
    $('#part-filter').innerHTML =
      `<option value="">전체</option>` +
      parts.map((p) => `<option ${p === state.ld.part ? 'selected' : ''}>${DR.esc(p)}</option>`).join('');
  }

  function renderLeader() {
    const ld = state.ld;
    $$('.seg [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ld.mode)));
    $('#ld-date').value = ld.date;
    renderPartFilter();
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
      const out = [['날짜', '이름', '소속파트', '제목', '내용', '진행율', '비고', '작성시각']];
      for (const g of dayGroups()) {
        if (!g.submitted) out.push([state.ld.date, g.name, '', '미제출', '', '', '', '']);
        for (const r of g.rows)
          out.push([r.date, g.name, r.part, r.title, r.content, r.progress, r.note, DR.fmtTime(r.updatedAt || r.createdAt)]);
      }
      return out;
    }
    const days = weekDays(state.ld.date);
    const out = [['이름', ...days.map((d) => `${DR.weekdayName(d)} ${DR.shortDate(d)}`)]];
    for (const m of weekTable())
      out.push([
        m.name,
        ...m.cells.map((c) =>
          !c.submitted
            ? c.date <= DR.today() ? '미제출' : ''
            : c.items.map((r) => `${firstLine(r.title)}${r.progress ? ` (${r.progress})` : ''}`).join('\n')
        ),
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
    $('#part-filter').addEventListener('change', (e) => {
      state.ld.part = e.target.value;
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
