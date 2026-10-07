(function (DR) {
  const cfg = window.APP_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const store = DR.createStore();

  // 구성원이 입력하는 칸 (저장·비교·내보내기에 공통 사용)
  const FIELDS = ['taskId', 'part', 'title', 'content', 'progress', 'note', 'owners'];

  const state = {
    tab: DR.storage.get('dr-tab', 'input'),
    me: DR.storage.get('dr-me-v2', ''),
    myPart: '',
    inDate: DR.today(),
    server: [], // 서버에 저장된 내 행
    draft: [], // 화면에서 편집 중인 내 행
    carryFrom: null, // 이월해 온 보고의 날짜
    paused: [], // 쉬고 있는 내 과제 (끝나지 않았지만 오늘 목록에 없는 것)
    pausedAll: false, // 쉬고 있는 과제를 모두 펼쳐 볼지
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

  state.myPart = DR.storage.get(`dr-part:${state.me}`, '');

  // 담당자로 쓴 이름은 기억해 두었다가 자동완성에 함께 보여준다
  const knownNames = () => [...new Set([...cfg.MEMBERS, ...DR.storage.get('dr-names', [])])];
  function rememberNames(names) {
    DR.storage.set('dr-names', [...new Set([...names, ...DR.storage.get('dr-names', [])])].slice(0, 50));
    $('#member-list').innerHTML = knownNames().map((m) => `<option value="${DR.esc(m)}">`).join('');
  }

  // 데이터 해석 규칙은 js/task-rules.js에서 (팀장 대시보드와 공유)
  const { byTime, percentOf, isDone, splitOwners, ownersOf, NO_PART, partOf, partList, byOwner } = DR.model;
  const isBlank = (r) => !r.title.trim() && !r.content.trim();
  // 내가 작성했거나 담당자로 들어간 과제 → 내 입력 화면에 보이고 수정할 수 있다
  const involves = (r, name = state.me) => r.author === name || ownersOf(r).includes(name);
  const tagId = (id) => (id ? `#${id}` : '');
  // 좁은 칸에서 보기 좋게 날짜 뒤에서 줄바꿈될 수 있게
  const tagIdHtml = (id) => (id ? DR.esc(tagId(id)) : '새 과제');

  /* ───────────── 공통 ───────────── */

  function setTab(tab) {
    state.tab = tab;
    DR.storage.set('dr-tab', tab);
    $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('.app > .view').forEach((v) => (v.hidden = v.id !== `view-${tab}`));
    if (tab === 'leader') loadLeader();
    else if (tab === 'input') autosizeAll();
    else extraTabs.get(tab)?.show?.();
  }

  /* ── 바깥 모듈이 탭을 붙이는 자리 (예: leader-dashboard/leader-dashboard.js) ──
   * 기본 화면은 이 모듈들을 몰라도 동작한다. 모듈 스크립트를 빼면 탭도 사라진다.
   * DR.registerTab({ id, label, mount(viewEl, { store, cfg }), show(), before? })
   *   before: 이 탭 id 앞에 끼워 넣기 (없으면 맨 뒤)
   */
  const savedTab = DR.storage.get('dr-tab', 'input');
  const extraTabs = new Map();
  DR.registerTab = ({ id, label, mount, show, before }) => {
    if (extraTabs.has(id) || $(`#view-${id}`)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.id = `tab-${id}`;
    btn.dataset.tab = id;
    btn.textContent = label;
    btn.setAttribute('aria-selected', 'false');
    btn.onclick = () => setTab(id);
    $('.tabs').insertBefore(btn, (before && $(`.tabs [data-tab="${before}"]`)) || null);
    const view = document.createElement('main');
    view.id = `view-${id}`;
    view.className = 'view';
    view.setAttribute('role', 'tabpanel');
    view.hidden = true;
    $('.app').appendChild(view);
    extraTabs.set(id, { show });
    mount(view, { store, cfg });
    if (savedTab === id) setTab(id);
  };

  function showError(err) {
    console.error(err);
    DR.toast(err.message || String(err), 'error');
  }

  // 글자 수만큼 칸이 늘어나되, 한 줄의 제목·내용·비고 칸은 가장 긴 칸에 맞춰 같은 높이로 둔다
  function autosizeRow(entry) {
    if (!entry) return;
    const areas = [...entry.querySelectorAll('textarea')];
    areas.forEach((el) => (el.style.height = 'auto'));
    // 휴대폰처럼 칸이 위아래로 쌓이는 좁은 화면에서는 각자 내용만큼만
    if (window.matchMedia('(max-width: 640px)').matches) return areas.forEach((el) => (el.style.height = el.scrollHeight + 2 + 'px'));
    const h = Math.max(...areas.map((el) => el.scrollHeight + 2));
    areas.forEach((el) => (el.style.height = h + 'px'));
  }
  const autosize = (el) => autosizeRow(el.closest('.entry'));
  const autosizeAll = () => $$('#entries .entry').forEach(autosizeRow);

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

  function partSelect(value, dis) {
    const v = String(value ?? '').trim();
    const opts = [...cfg.PARTS, ...(v && !cfg.PARTS.includes(v) ? [v] : [])];
    return `<select data-f="part" aria-label="소속파트" class="${v ? '' : 'unset'}" ${dis}><option value="">파트 선택</option>${opts
      .map((p) => `<option ${p === v ? 'selected' : ''}>${DR.esc(p)}</option>`)
      .join('')}</select>`;
  }

  // 담당자: 이름 칩 + 이름 추가칸 (여러 명 가능)
  function ownersHtml(r, ro) {
    const chips = splitOwners(r.owners)
      .map(
        (n) =>
          `<span class="chip">${DR.esc(n)}${ro ? '' : `<button type="button" data-rm-owner="${DR.esc(n)}" aria-label="${DR.esc(n)} 빼기">×</button>`}</span>`
      )
      .join('');
    return `<div class="owners">${chips}${
      ro ? '' : `<input type="text" class="owner-add" list="member-list" placeholder="+ 이름" aria-label="담당자 추가" autocomplete="off">`
    }</div>`;
  }

  function entryHtml(r, i, ro) {
    const dis = ro ? 'disabled' : '';
    const done = isDone(r.progress);
    const area = (f, label, ph, rows) =>
      `<label class="cell c-${f}"><span class="cell-label">${label}</span><textarea data-f="${f}" rows="${rows}" placeholder="${ph}" ${dis}>${DR.esc(r[f])}</textarea></label>`;
    const line = (f, label, ph, extra = '') =>
      `<input type="text" data-f="${f}" value="${DR.esc(r[f])}" placeholder="${ph}" aria-label="${label}" ${extra} ${dis}>`;
    const doneBtn = ro
      ? ''
      : `<button type="button" class="done-btn" data-done aria-pressed="${done}">${done ? '✓ 완료됨' : '완료'}</button>`;
    const cls = ['entry', r.carried ? 'carried' : '', done ? 'is-done' : ''].join(' ');
    return `<div class="${cls}" data-id="${r.id}">
      <span class="entry-no">${i + 1}<small class="tid" title="과제번호">${tagIdHtml(r.taskId)}</small>${r.carried ? '<small>이월</small>' : ''}${r.resumed ? '<small class="resumed">재개</small>' : ''}${
        !r.id.startsWith('tmp-') && r.editor && r.editor !== state.me ? `<small class="by">${DR.esc(r.editor)} 수정</small>` : ''
      }</span>
      <label class="cell c-part"><span class="cell-label">소속파트</span>${partSelect(r.part, dis)}</label>
      ${area('title', '제목', '업무 제목 (여러 줄 가능)', 3)}
      ${area('content', '내용', '세부 내용', 3)}
      <div class="cell c-progress"><span class="cell-label">진행율</span>${line('progress', '진행율', '예: 70%')}${doneBtn}</div>
      ${area('note', '비고', '', 3)}
      <div class="cell c-owners"><span class="cell-label">담당자</span>${ownersHtml(r, ro)}</div>
      ${ro ? '<span></span>' : '<button type="button" class="icon-btn del" data-del aria-label="이 업무 삭제">×</button>'}
    </div>`;
  }

  function renderInput() {
    const hasMe = !!state.me;
    $('#me-empty').hidden = hasMe;
    $('#whoami').hidden = !hasMe;
    renderMeChip();
    $('#in-body').hidden = !hasMe;
    $('#me-name').textContent = state.me;
    $('#my-part').innerHTML = partOptions(state.myPart);
    $('#my-part').classList.toggle('unset', !state.myPart);
    $('#in-date').value = state.inDate;
    if (!hasMe) return;

    const ro = !editable();
    $('#in-heading').textContent = `${DR.labelDate(state.inDate)} · ${state.me}`;
    $('#in-notice').hidden = !ro;
    $('#in-notice').textContent = ro ? '지난 날짜의 보고입니다. 수정이 필요하면 팀장에게 요청하세요.' : '';
    const carried = state.draft.filter((r) => r.carried).length;
    $('#carry-notice').hidden = ro || !state.carryFrom;
    $('#carry-notice').innerHTML = state.carryFrom
      ? `<b>${DR.shortDate(state.carryFrom)} 보고에서 미완료 업무를 이월했습니다.</b> 회색 글자는 아직 손대지 않은 업무입니다(${carried}건). 내용을 고치면 검은 글자로 바뀌고, 끝난 업무는 <b>완료</b>를 누르세요. 완료한 업무는 다음 날 이월되지 않습니다.`
      : '';
    $('#entries').innerHTML = state.draft.length
      ? state.draft.map((r, i) => entryHtml(r, i, ro)).join('')
      : '<p class="rows-empty">이 날짜에 작성한 업무가 없습니다.</p>';
    $('#view-input .add-row').hidden = ro;
    renderPaused();
    autosizeAll();
    updateSavebar();
  }

  // 새 행의 소속파트: 저장해 둔 내 파트 → 없으면 직전 행의 파트
  const lastPart = () => state.myPart || [...state.draft].reverse().find((r) => r.part.trim())?.part || '';

  const blank = (fill = {}) => ({
    id: DR.tmpId(),
    date: state.inDate,
    author: state.me,
    part: lastPart(),
    title: '',
    content: '',
    progress: '',
    note: '',
    owners: state.me,
    ...fill,
    taskId: fill.taskId || '', // 새 과제의 번호는 처음 저장할 때 파트·시각으로 만든다
  });

  // 오늘 내 보고가 아직 없으면, 가장 최근 보고의 미완료 과제를 회색(이월)으로 띄운다.
  // 내가 담당자인 공동 과제도 포함하되, 오늘 이미 누가 올린 과제(같은 번호)는 뺀다
  async function carryOver() {
    const from = DR.addDays(state.inDate, -cfg.CARRY_LOOKBACK_DAYS);
    const prev = (await DR.model.rangeRows(store, from, DR.addDays(state.inDate, -1))).filter((r) => involves(r));
    if (!prev.length) return;
    const last = prev.reduce((m, r) => (r.date > m ? r.date : m), '');
    const have = new Set(state.draft.map((r) => r.taskId).filter(Boolean));
    const open = [];
    for (const r of prev.filter((x) => x.date === last && !isDone(x.progress)).sort(byTime)) {
      if (r.taskId && have.has(r.taskId)) continue;
      if (r.taskId) have.add(r.taskId);
      open.push(r);
    }
    if (!open.length) return;
    state.carryFrom = last;
    open.forEach((r) => state.draft.push(blank({ ...clean(r), carried: true })));
  }

  // 쉬고 있는 내 과제: 기준 범위(기본 올해 1월 1일~) 안에서 끝나지 않은 내 과제 (오늘 목록에 있는 것은 화면에서 뺀다)
  async function loadPaused() {
    state.paused = [];
    state.pausedAll = false;
    if (!editable()) return;
    const rows = (await DR.model.rangeRows(store, DR.model.baseStart(state.inDate), DR.addDays(state.inDate, -1))).filter((r) => involves(r));
    state.paused = DR.model
      .buildTasks(rows, state.inDate)
      .filter((t) => t.status !== 'done')
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  function renderPaused() {
    const box = $('#paused');
    const inToday = new Set(state.draft.map((r) => r.taskId).filter(Boolean));
    const list = editable() ? state.paused.filter((t) => !t.id || !inToday.has(t.id)) : [];
    box.hidden = !list.length;
    if (!list.length) return (box.innerHTML = '');
    const shown = state.pausedAll ? list : list.slice(0, 5);
    box.innerHTML = `
      <div class="paused-head">
        <b>쉬고 있는 내 과제 ${list.length}건</b>
        <span class="meta">끝나지 않았지만 오늘 목록에 없는 과제입니다. 다시 추진할 과제는 [이어서 하기]를 누르면 같은 과제번호로 이어집니다.</span>
      </div>
      <ul class="paused-list">${shown
        .map((t) => {
          const rest = DR.model.daysBetween(t.lastSeen, state.inDate);
          return `<li>
            <span class="tid-cell">${DR.esc(t.id)}</span>
            <span class="paused-title">${DR.esc(String(t.title).split('\n')[0])}</span>
            <span class="meta">${DR.esc(t.part)} · 진행율 ${DR.esc(t.progress || '-')} · 마지막 보고 ${DR.shortDate(t.lastSeen)} <b class="${rest >= 20 ? 'rest-long' : ''}">(${rest}일 쉼)</b></span>
            <button type="button" class="btn small" data-resume="${DR.esc(t.key)}">이어서 하기</button>
          </li>`;
        })
        .join('')}</ul>
      ${list.length > shown.length ? `<button type="button" class="btn ghost small" data-paused-all>${list.length - shown.length}건 더 보기</button>` : ''}`;
  }

  // 쉬던 과제를 오늘 목록으로: 마지막 보고 내용·진행율을 그대로 가져오고 과제번호를 유지한다
  function resumeTask(key) {
    const t = state.paused.find((x) => x.key === key);
    if (!t) return;
    state.draft = state.draft.filter((x) => !(x.id.startsWith('tmp-') && isBlank(x)));
    const r = blank({ ...clean(t.last), resumed: true });
    state.draft.push(r);
    renderInput();
    const el = $(`#entries [data-id="${r.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      el.querySelector('[data-f="progress"]')?.focus({ preventScroll: true });
    }
    DR.toast(`${DR.shortDate(t.lastSeen)} 보고에서 이어서 합니다 (${DR.model.daysBetween(t.lastSeen, state.inDate)}일 만). 진행율을 고친 뒤 저장하세요.`);
  }

  async function loadMine() {
    state.carryFrom = null;
    if (!state.me) return renderInput();
    try {
      const rows = (await store.list({ from: state.inDate, to: state.inDate })).filter((r) => involves(r));
      rows.sort(byTime);
      // 예전 데이터에 과제번호가 없으면 붙여 둔다 (다음 저장 때 함께 기록됨)
      rows.forEach((r) => r.taskId || (r.taskId = DR.nextTaskId(r.part, rows.map((x) => x.taskId), new Date(r.createdAt))));
      state.server = rows;
      state.draft = rows.map((r) => ({ ...r }));
      if (editable() && !rows.some((r) => r.author === state.me)) await carryOver();
      if (editable() && !state.draft.length) state.draft.push(blank());
      await loadPaused();
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

  const CMP_FIELDS = [
    ['part', '소속파트'],
    ['title', '제목'],
    ['content', '내용'],
    ['progress', '진행율'],
    ['note', '비고'],
    ['owners', '담당자'],
  ];
  const sameContent = (a, b) => CMP_FIELDS.every(([f]) => String(a[f] ?? '').trim() === String(b[f] ?? '').trim());

  // 같은 과제를 동료가 먼저 올렸거나 그사이 고쳤을 때: 나란히 비교하고 고르게 한다
  function resolveConflict(c, i, n) {
    const dlg = $('#conflict');
    const who = c.theirs.editor || c.theirs.author;
    $('#cf-title').textContent = `같은 과제를 ${who}님이 ${c.kind === 'create' ? '먼저 등록했습니다' : '그사이 수정했습니다'}${n > 1 ? ` (${i + 1}/${n})` : ''}`;
    $('#cf-sub').textContent = `${tagId(c.theirs.taskId)} · ${who}님이 ${DR.fmtTime(c.theirs.updatedAt || c.theirs.createdAt)}에 저장. 어느 쪽 내용을 남길지 고르세요. 다른 칸은 색으로 표시됩니다.`;
    $('#cf-their-h').textContent = `${who}님이 쓴 것`;
    $('#cf-body').innerHTML = CMP_FIELDS.map(([f, label]) => {
      const a = String(c.mine[f] ?? '').trim();
      const b = String(c.theirs[f] ?? '').trim();
      return `<tr class="${a === b ? '' : 'diff'}"><th>${label}</th><td>${DR.esc(a) || '<span class="muted">(비어 있음)</span>'}</td><td>${
        DR.esc(b) || '<span class="muted">(비어 있음)</span>'
      }</td></tr>`;
    }).join('');
    dlg.hidden = false;
    dlg.querySelector('[data-cf="mine"]').focus();
    return new Promise((resolve) => {
      dlg.onclick = (e) => {
        const act = e.target.closest('[data-cf]')?.dataset.cf;
        if (!act) return;
        dlg.hidden = true;
        dlg.onclick = dlg.onkeydown = null;
        resolve(act);
      };
      dlg.onkeydown = (e) => e.key === 'Escape' && dlg.querySelector('[data-cf="cancel"]').click();
    });
  }

  // 같은 파트의 두 사람이 정확히 같은 순간에 저장하면 순번이 겹칠 수 있다.
  // 저장 직후 다시 확인해, 겹친 번호가 있으면 내 쪽 과제에 다음 순번을 새로 붙인다
  async function fixSameMomentIds(newIds) {
    const rows = await store.list({ from: state.inDate, to: state.inDate });
    const used = rows.map((r) => r.taskId);
    for (const id of newIds) {
      const same = rows.filter((r) => r.taskId === id);
      if (same.length < 2) continue;
      for (const r of same.filter((x) => x.author === state.me)) {
        const next = DR.nextTaskId(r.part, used);
        used.push(next);
        await store.update(r.id, { taskId: next });
      }
    }
  }

  async function save() {
    if (!editable() || state.saving) return;
    const { creates, updates, removes, count } = diff();
    if (!count) return;
    state.saving = true;
    updateSavebar();
    try {
      // 저장 직전에 오늘 보고를 다시 읽어, 같은 과제번호나 그사이 바뀐 행이 있는지 확인
      const fresh = await store.list({ from: state.inDate, to: state.inDate });
      const freshById = new Map(fresh.map((r) => [r.id, r]));
      const freshByTask = new Map(fresh.filter((r) => r.taskId).map((r) => [r.taskId, r]));
      const loadedById = new Map(state.server.map((r) => [r.id, r]));
      const toCreate = [];
      const toUpdate = []; // [id, row]
      const conflicts = [];
      for (const d of creates) {
        if (!d.taskId) {
          toCreate.push(d); // 새 과제: 번호는 아래에서 실제로 저장할 때 부여
          continue;
        }
        const other = freshByTask.get(d.taskId);
        if (!other) toCreate.push(d);
        else if (!sameContent(d, other)) conflicts.push({ kind: 'create', mine: d, theirs: other });
      }
      for (const d of updates) {
        const cur = freshById.get(d.id);
        if (!cur) toCreate.push(d); // 그사이 누가 지웠으면 새로 올린다
        else if (cur.updatedAt !== loadedById.get(d.id)?.updatedAt && !sameContent(d, cur))
          conflicts.push({ kind: 'update', mine: d, theirs: cur });
        else toUpdate.push([d.id, d]);
      }
      let skippedRemoves = 0;
      const toRemove = removes.filter((id) => {
        const cur = freshById.get(id);
        if (!cur) return false;
        const changed = cur.updatedAt !== loadedById.get(id)?.updatedAt;
        if (changed) skippedRemoves++;
        return !changed; // 그사이 동료가 고친 과제는 지우지 않는다
      });

      for (let i = 0; i < conflicts.length; i++) {
        const c = conflicts[i];
        const pick = await resolveConflict(c, i, conflicts.length);
        if (pick === 'cancel') {
          DR.toast('저장을 취소했습니다. 입력한 내용은 화면에 그대로 있습니다.', 'warn');
          return;
        }
        if (pick === 'mine') toUpdate.push([c.theirs.id, c.mine]);
        // 'theirs': 내 것은 버리고 동료 것을 그대로 둔다
      }

      const stamp = { editor: state.me };
      // 등록 시점의 파트·날짜로 과제번호 부여. 순번은 오늘 이미 쓰인 번호 다음부터
      const used = fresh.map((r) => r.taskId);
      toCreate.forEach((d) => {
        if (d.taskId) return;
        d.taskId = DR.nextTaskId(d.part, used);
        used.push(d.taskId);
      });
      if (toCreate.length) {
        await store.create(toCreate.map((r) => ({ date: state.inDate, author: state.me, ...clean(r), ...stamp })));
        await fixSameMomentIds(toCreate.map((r) => r.taskId));
      }
      for (const [id, r] of toUpdate) await store.update(id, { ...clean(r), ...stamp });
      for (const id of toRemove) await store.remove(id);
      DR.toast(skippedRemoves ? `저장했습니다. 동료가 그사이 수정한 과제 ${skippedRemoves}건은 지우지 않았습니다.` : '저장했습니다.');
      DR.model.invalidate(store); // 저장했으니 공유 데이터를 새로 읽게 한다
      await loadMine();
      document.dispatchEvent(new CustomEvent('dr:saved'));
    } catch (e) {
      showError(e);
    } finally {
      state.saving = false;
      updateSavebar();
    }
  }

  // 다른 화면(예: 내 현황)에서 "이 과제 업데이트"를 눌렀을 때: 오늘 보고의 그 과제로 이동
  // 오늘 목록에 없으면 마지막 보고 내용을 복사해 새 줄로 넣는다 (과제번호 유지)
  async function openTaskInInput(lastRow) {
    if (state.inDate !== DR.today()) {
      if (!(await guard())) return;
      state.inDate = DR.today();
      await loadMine();
    }
    setTab('input');
    let r = lastRow.taskId && state.draft.find((x) => x.taskId === lastRow.taskId);
    if (!r) {
      state.draft = state.draft.filter((x) => !(x.id.startsWith('tmp-') && isBlank(x)));
      r = blank(clean(lastRow));
      state.draft.push(r);
      renderInput();
    }
    const el = $(`#entries [data-id="${r.id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // 애니메이션 다시 시작
    el.classList.add('flash');
    el.querySelector('[data-f="progress"]')?.focus({ preventScroll: true });
  }
  DR.app = { openTaskInInput, me: () => state.me, store };

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

  // 이름과 내 소속파트는 브라우저(크롬)에 저장해 다음에도 그대로 쓴다
  function setMe(name, part) {
    const changed = state.me !== name;
    state.me = name;
    DR.storage.set('dr-me-v2', name);
    if (changed) setTimeout(() => document.dispatchEvent(new CustomEvent('dr:me-changed')));
    if (part !== undefined) setMyPart(part);
    else state.myPart = DR.storage.get(`dr-part:${name}`, '');
  }
  function renderMeChip() {
    const chip = $('#me-chip');
    chip.innerHTML = state.me
      ? `<span class="me-label">작성자</span> <b>${DR.esc(state.me)}</b>${state.myPart ? ` · ${DR.esc(state.myPart)}` : ''}`
      : '<b>이름 입력</b>';
    chip.classList.toggle('needs', !state.me);
    chip.title = '이름·소속파트 변경';
  }

  function openMeDialog() {
    $('#me-input').value = state.me;
    $('#setup-part').innerHTML = partOptions(state.myPart);
    $('#me-cancel').hidden = !state.me; // 처음에는 이름을 넣어야 넘어간다
    $('#me-dialog').hidden = false;
    $('#me-input').focus();
    $('#me-input').select();
  }
  function closeMeDialog() {
    if (!state.me) return $('#me-input').focus();
    $('#me-dialog').hidden = true;
  }

  function setMyPart(part) {
    state.myPart = part;
    if (state.me) DR.storage.set(`dr-part:${state.me}`, part);
    // 아직 파트를 고르지 않은 행은 바로 채워 준다
    state.draft.forEach((r) => {
      if (!r.part.trim()) r.part = part;
    });
  }
  const partOptions = (v) =>
    `<option value="">파트 선택</option>` + cfg.PARTS.map((p) => `<option ${p === v ? 'selected' : ''}>${DR.esc(p)}</option>`).join('');

  /* ── 지난 업무에서 불러오기 ── */

  const loader = { cache: new Map(), items: [], picked: new Map() };

  async function fetchLoaderRows() {
    const who = $('#ldr-who').value;
    const period = $('#ldr-period').value; // 'base' = 설정의 기준 범위(기본 올해 1월 1일부터), 숫자 = 최근 N일, '0' = 전체
    const key = `${who}|${period}|${state.inDate}`;
    if (!loader.cache.has(key)) {
      const to = DR.addDays(state.inDate, -1);
      const from =
        period === 'base' ? DR.model.baseStart(state.inDate) : Number(period) ? DR.addDays(state.inDate, -Number(period)) : undefined;
      const rows = await DR.model.rangeRows(store, from, to);
      // 작성자이거나 담당자로 들어간 업무
      const mine = who === '*' ? rows : rows.filter((r) => r.author === who || ownersOf(r).includes(who));
      // 같은 사람의 같은 업무는 여러 날 반복되므로, 가장 최근 것 하나만 남긴다
      const latest = new Map();
      for (const r of mine) {
        const k = r.taskId || `${r.author}|${r.title.trim()}|${r.part.trim()}`;
        const cur = latest.get(k);
        if (!cur || r.date > cur.date) latest.set(k, r);
      }
      loader.cache.set(key, [...latest.values()].sort((a, b) => b.date.localeCompare(a.date) || byTime(b, a)));
    }
    return loader.cache.get(key);
  }

  async function refreshLoader() {
    $('#ldr-list').innerHTML = '<p class="meta">불러오는 중…</p>';
    try {
      const all = await fetchLoaderRows();
      const words = $('#ldr-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const openOnly = $('#ldr-open').checked;
      const hit = (r) => {
        if (openOnly && isDone(r.progress)) return false;
        const hay = `${r.taskId} ${r.part} ${r.title} ${r.content} ${r.note} ${ownersOf(r).join(' ')}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      };
      loader.items = all.filter(hit).slice(0, 200);
      const total = all.filter(hit).length;
      $('#ldr-count').textContent = total
        ? `${total}건${total > 200 ? ' 중 최근 200건' : ''} · 같은 업무는 가장 최근 보고 하나만 보입니다`
        : '';
      $('#ldr-list').innerHTML = loader.items.length
        ? loader.items
            .map((r, i) => {
              const on = loader.picked.has(r.id);
              const already = r.taskId && !isDone(r.progress) && state.draft.some((d) => d.taskId === r.taskId);
              const rest = DR.model.daysBetween(r.date, state.inDate);
              return `<label class="ldr-item ${on ? 'on' : ''} ${already ? 'is-in' : ''}">
                <input type="checkbox" data-i="${i}" ${on ? 'checked' : ''} ${already ? 'disabled' : ''}>
                <span class="ldr-meta">${already ? '<b class="ok">오늘 목록에 있음</b> · ' : ''}${DR.esc(tagId(r.taskId))} · ${DR.shortDate(r.date)} (${rest}일 전) · ${DR.esc(ownersOf(r).join(', '))}${r.part ? ` · ${DR.esc(r.part)}` : ''}${
                  r.progress ? ` · <span class="${isDone(r.progress) ? 'ok' : ''}">${DR.esc(r.progress)}</span>` : ''
                }</span>
                <span class="ldr-title">${DR.esc(r.title)}</span>
                <span class="ldr-content">${DR.esc(r.content)}</span>
              </label>`;
            })
            .join('')
        : '<p class="rows-empty">조건에 맞는 업무가 없습니다. 기간을 늘리거나 검색어를 바꿔 보세요.</p>';
    } catch (e) {
      $('#ldr-list').innerHTML = '';
      showError(e);
    }
    updateLoaderFoot();
  }

  function updateLoaderFoot() {
    const n = loader.picked.size;
    $('#ldr-picked').textContent = n ? `${n}건 선택` : '추가할 업무를 고르세요';
    $('#ldr-add').disabled = !n;
  }

  function openLoader() {
    $('#ldr-period option[value="base"]').textContent = DR.model.baseLabel();
    const others = cfg.MEMBERS.filter((m) => m !== state.me);
    $('#ldr-who').innerHTML =
      `<option value="${DR.esc(state.me)}">내 업무</option><option value="*">팀 전체</option>` +
      others.map((m) => `<option value="${DR.esc(m)}">${DR.esc(m)}</option>`).join('');
    $('#ldr-q').value = '';
    loader.picked = new Map();
    loader.cache.clear();
    $('#loader').hidden = false;
    $('#ldr-q').focus();
    refreshLoader();
  }
  const closeLoader = () => ($('#loader').hidden = true);

  function addFromLoader() {
    const picked = [...loader.picked.values()];
    if (!picked.length) return;
    state.draft = state.draft.filter((r) => !(r.id.startsWith('tmp-') && isBlank(r)));
    const have = new Set(state.draft.map((r) => r.taskId).filter(Boolean));
    let added = 0;
    let dup = 0;
    picked.forEach((r) => {
      // 끝나지 않은 과제는 이어서 하는 것이므로 번호를 유지, 끝난 과제는 양식만 빌려 새 번호
      const taskId = !isDone(r.progress) && r.taskId ? r.taskId : undefined;
      if (taskId && have.has(taskId)) return dup++;
      if (taskId) have.add(taskId);
      state.draft.push(
        taskId
          ? blank({ ...clean(r), note: '', resumed: true }) // 이어서 하기: 마지막 진행율까지 가져온다
          : blank({ part: r.part, title: r.title, content: r.content, owners: state.me })
      );
      added++;
    });
    closeLoader();
    renderInput();
    DR.toast(
      [added && `${added}건을 추가했습니다. 진행율과 내용을 고친 뒤 저장하세요.`, dup && `이미 목록에 있는 과제 ${dup}건은 빼고 넣었습니다.`]
        .filter(Boolean)
        .join(' '),
      dup && !added ? 'warn' : 'ok'
    );
  }

  function bindLoader() {
    $('#open-loader').onclick = openLoader;
    $('#loader-close').onclick = $('#ldr-cancel').onclick = closeLoader;
    $('#ldr-add').onclick = addFromLoader;
    $('#ldr-who').onchange = $('#ldr-period').onchange = $('#ldr-open').onchange = refreshLoader;
    let t;
    $('#ldr-q').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(refreshLoader, 200);
    });
    $('#ldr-list').addEventListener('change', (e) => {
      const r = loader.items[Number(e.target.dataset.i)];
      if (!r) return;
      if (e.target.checked) loader.picked.set(r.id, r);
      else loader.picked.delete(r.id);
      e.target.closest('.ldr-item').classList.toggle('on', e.target.checked);
      updateLoaderFoot();
    });
    $('#loader').addEventListener('keydown', (e) => e.key === 'Escape' && closeLoader());
  }

  function bindInput() {
    rememberNames([]);
    $('#me-setup').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#me-input').value.trim();
      if (!name) return $('#me-input').focus();
      if (name !== state.me && !(await guard())) return;
      const changed = name !== state.me;
      setMe(name, $('#setup-part').value);
      rememberNames([name]);
      closeMeDialog();
      DR.toast(`${name}(${state.myPart || '파트 미지정'})으로 저장했습니다.`);
      if (changed) loadMine();
      else renderInput();
    });
    // 예전에 이 PC에서 쓴 이름이면 그때의 파트를 미리 골라 준다
    $('#me-input').addEventListener('input', (e) => {
      const saved = DR.storage.get(`dr-part:${e.target.value.trim()}`, '');
      if (saved) $('#setup-part').value = saved;
    });
    $('#me-cancel').onclick = closeMeDialog;
    $('#me-dialog').addEventListener('keydown', (e) => e.key === 'Escape' && closeMeDialog());
    $('#me-chip').onclick = $('#me-open').onclick = $('#me-change').onclick = openMeDialog;
    $('#my-part').addEventListener('change', (e) => {
      setMyPart(e.target.value);
      renderInput();
      renderMeChip();
      DR.toast(e.target.value ? `내 소속파트를 ${e.target.value}(으)로 저장했습니다.` : '내 소속파트를 비웠습니다.');
    });
    $('#in-date').addEventListener('change', (e) => goInputDate(e.target.value));
    $('#in-prev').onclick = () => goInputDate(DR.shiftWorkday(state.inDate, -1));
    $('#in-next').onclick = () => goInputDate(DR.shiftWorkday(state.inDate, 1));
    $('#in-today').onclick = () => goInputDate(DR.today());
    $('#add-entry').onclick = addEntry;
    $('#save-btn').onclick = save;

    $('#paused').addEventListener('click', (e) => {
      const b = e.target.closest('[data-resume]');
      if (b) return resumeTask(b.dataset.resume);
      if (e.target.closest('[data-paused-all]')) {
        state.pausedAll = true;
        renderPaused();
      }
    });

    const box = $('#entries');
    const rowOf = (el) => state.draft.find((x) => x.id === el.closest('[data-id]')?.dataset.id);
    box.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      const r = rowOf(e.target);
      if (!f || !r) return;
      r[f] = e.target.value;
      if (f === 'part') e.target.classList.toggle('unset', !r.part);
      if (r.carried) {
        r.carried = false; // 손댄 이월 업무는 검은 글자로
        e.target.closest('.entry').classList.remove('carried');
      }
      if (f === 'progress') e.target.closest('.entry').classList.toggle('is-done', isDone(r.progress));
      if (e.target.tagName === 'TEXTAREA') autosize(e.target);
      updateSavebar();
    });
    const addOwner = (input) => {
      const r = rowOf(input);
      const names = splitOwners(input.value);
      if (!r || !names.length) return;
      r.owners = splitOwners([r.owners, ...names].join(',')).join(', ');
      rememberNames(names);
      r.carried = false;
      renderInput();
      $(`[data-id="${r.id}"] .owner-add`)?.focus();
    };
    box.addEventListener('keydown', (e) => {
      if (!e.target.matches('.owner-add')) return;
      if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) {
        e.preventDefault();
        addOwner(e.target);
      } else if (e.key === 'Backspace' && !e.target.value) {
        const r = rowOf(e.target);
        const list = splitOwners(r.owners);
        list.pop();
        r.owners = list.join(', ');
        renderInput();
        $(`[data-id="${r.id}"] .owner-add`)?.focus();
      }
    });
    // 목록에서 이름을 고르거나 칸을 벗어나면 추가
    box.addEventListener('change', (e) => e.target.matches('.owner-add') && addOwner(e.target));
    box.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-rm-owner]');
      if (rm) {
        const r = rowOf(rm);
        r.owners = splitOwners(r.owners).filter((n) => n !== rm.dataset.rmOwner).join(', ');
        r.carried = false;
        return renderInput();
      }
      if (e.target.closest('[data-done]')) {
        const r = rowOf(e.target);
        if (isDone(r.progress)) r.progress = r.prevProgress ?? '';
        else {
          r.prevProgress = r.progress;
          r.progress = '완료';
        }
        r.carried = false;
        return renderInput();
      }
      if (!e.target.closest('[data-del]')) return;
      const r = rowOf(e.target);
      const shared = ownersOf(r).length > 1 || (r.author && r.author !== state.me);
      const msg = shared
        ? '공동 과제입니다. 지우면 다른 담당자의 보고에서도 사라집니다. 지울까요? (저장해야 반영됩니다)'
        : '이 업무를 목록에서 지울까요? 저장해야 반영됩니다.';
      if (!r.carried && !isBlank(r) && !(await DR.confirm(msg, '지우기'))) return;
      state.draft = state.draft.filter((x) => x !== r);
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
    bindLoader();
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


  // 보고에 이름이 나온 사람(작성자 + 담당자). 모든 사람이 따로 쓸 필요는 없다
  const peopleIn = (rows) => {
    const set = new Set(rows.flatMap((r) => [r.author, ...ownersOf(r)]).filter(Boolean));
    return [...cfg.MEMBERS.filter((m) => set.has(m)), ...[...set].filter((m) => !cfg.MEMBERS.includes(m)).sort()];
  };


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

  const visibleParts = (rows) => partList(rows).filter((p) => !state.ld.part || p === state.ld.part);

  // 화면·복사·CSV가 같은 데이터를 쓴다
  function dayGroups() {
    const rows = state.ld.rows.filter((r) => r.date === state.ld.date);
    return visibleParts(rows).map((part) => ({ part, rows: rows.filter((r) => partOf(r) === part).sort(byOwner) }));
  }

  const multi = (s) => DR.esc(s); // 줄바꿈은 CSS(pre-wrap)로 살린다
  const ownerChips = (r) => ownersOf(r).map((n) => `<span class="chip">${DR.esc(n)}</span>`).join('');

  function renderDay() {
    const cols = ['소속파트', '과제번호', '제목', '내용', '진행율', '비고', '담당자', '최종 수정'];
    let n = 0;
    const body = dayGroups()
      .map((g) => {
        const partCell = (span) =>
          `<td class="part-group" rowspan="${span}"><b>${DR.esc(g.part)}</b><small>${g.rows.length}건</small></td>`;
        if (!g.rows.length) {
          n++;
          return `<tr class="group-end empty-part"><th class="rn">${n}</th>${partCell(1)}<td colspan="7" class="muted">보고된 업무 없음</td></tr>`;
        }
        return g.rows
          .map((r, i) => {
            n++;
            const cls = [i === g.rows.length - 1 ? 'group-end' : '', isDone(r.progress) ? 'is-done' : ''].join(' ');
            return `<tr class="${cls}"><th class="rn">${n}</th>${i === 0 ? partCell(g.rows.length) : ''}
              <td class="tid-cell">${DR.esc(r.taskId)}</td>
              <td class="title">${multi(r.title)}</td>
              <td class="content">${multi(r.content)}</td>
              <td class="prog">${progressHtml(r.progress)}</td>
              <td class="note">${multi(r.note)}</td>
              <td class="owners-cell">${ownerChips(r)}</td>
              <td class="time">${DR.fmtTime(r.updatedAt || r.createdAt)}<small>${DR.esc(r.editor || r.author)}</small></td></tr>`;
          })
          .join('');
      })
      .join('');
    return `<table class="sheet sheet-day">
      <thead><tr class="letters"><th class="corner"></th>${cols.map((_, i) => `<th>${'ABCDEFGH'[i]}</th>`).join('')}</tr>
      <tr><th class="corner"></th>${cols.map((c) => `<th${c === '진행율' ? ' class="c"' : ''}>${c}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function weekTable() {
    const ld = state.ld;
    const days = weekDays(ld.date);
    return visibleParts(ld.rows).map((part) => ({
      part,
      cells: days.map((date) => ({
        date,
        items: ld.rows.filter((r) => r.date === date && partOf(r) === part).sort(byOwner),
      })),
    }));
  }

  const firstLine = (s) => String(s || '').split('\n')[0];

  function renderWeek() {
    const days = weekDays(state.ld.date);
    const t = DR.today();
    const rows = weekTable()
      .map((m, i) => {
        const cells = m.cells
          .map((c) => {
            if (!c.items.length) return c.date <= t ? `<td class="wk"><span class="muted">-</span></td>` : `<td class="wk future"></td>`;
            const items = c.items
              .map(
                (r) =>
                  `<li><span class="wk-text">${DR.esc(firstLine(r.title) || firstLine(r.content))}</span><span class="wk-p ${
                    isDone(r.progress) ? 'ok' : ''
                  }">${DR.esc(r.progress)}</span><span class="wk-owner">${DR.esc(ownersOf(r).join(', '))}</span></li>`
              )
              .join('');
            return `<td class="wk"><button type="button" class="wk-open" data-go="${c.date}" aria-label="${DR.esc(m.part)} ${DR.shortDate(c.date)} 일간 보기"></button><ul>${items}</ul></td>`;
          })
          .join('');
        return `<tr><th class="rn">${i + 1}</th><td class="part-group"><b>${DR.esc(m.part)}</b></td>${cells}</tr>`;
      })
      .join('');
    const head = days
      .map((d) => `<th class="${d === t ? 'is-today' : ''}"><button type="button" class="day-link" data-go="${d}">${DR.weekdayName(d)} ${DR.shortDate(d)}</button></th>`)
      .join('');
    return `<table class="sheet sheet-week">
      <thead><tr class="letters"><th class="corner"></th>${'ABCDEF'.split('').map((l) => `<th>${l}</th>`).join('')}</tr>
      <tr><th class="corner"></th><th>소속파트</th>${head}</tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function renderSummary() {
    const ld = state.ld;
    const rows = ld.mode === 'day' ? ld.rows.filter((r) => r.date === ld.date) : ld.rows;
    const byPart = partList(rows).map((p) => [p, rows.filter((r) => partOf(r) === p).length]);
    const done = rows.filter((r) => isDone(r.progress)).length;
    const people = peopleIn(rows);
    const authors = new Set(rows.map((r) => r.author)).size;
    return `
      <div class="stat"><span class="stat-label">${ld.mode === 'day' ? '업무' : '이번 주 업무'}</span><span class="stat-val">${rows.length}<small>건 · 작성 ${authors}명</small></span></div>
      <div class="stat"><span class="stat-label">파트별 업무</span><span class="chips">${byPart
        .map(([p, n]) => `<span class="pill pill-part">${DR.esc(p)} <b>${n}</b></span>`)
        .join('')}</span></div>
      <div class="stat"><span class="stat-label">${ld.mode === 'day' ? '오늘 완료' : '이번 주 완료'}</span><span class="stat-val ok">${done}<small>/${rows.length}건</small></span></div>
      <div class="stat"><span class="stat-label">담당자</span><span class="chips">${
        people.length ? people.map((m) => `<span class="chip">${DR.esc(m)}</span>`).join('') : '<span class="muted">보고 없음</span>'
      }</span></div>`;
  }

  function renderPartFilter() {
    const parts = partList(state.ld.rows);
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
    updateXlsxLabel();
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
      const out = [['날짜', '소속파트', '과제번호', '제목', '내용', '진행율', '비고', '담당자', '최종 수정', '수정자']];
      for (const g of dayGroups())
        for (const r of g.rows)
          out.push([r.date, g.part, r.taskId, r.title, r.content, r.progress, r.note, ownersOf(r).join(', '), DR.fmtTime(r.updatedAt || r.createdAt), r.editor || r.author]);
      return out;
    }
    const days = weekDays(state.ld.date);
    const out = [['소속파트', ...days.map((d) => `${DR.weekdayName(d)} ${DR.shortDate(d)}`)]];
    for (const m of weekTable())
      out.push([
        m.part,
        ...m.cells.map((c) =>
          c.items.map((r) => `${firstLine(r.title)}${r.progress ? ` (${r.progress})` : ''} - ${ownersOf(r).join(', ')}`).join('\n')
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
      DR.toast('이 환경에서는 클립보드 복사가 막혀 있습니다. 엑셀 내려받기를 이용하세요.', 'error');
    }
  }

  // 팀 전체(파트 필터와 무관) 보고를 엑셀 파일로. 일간이면 그날, 주간이면 그 주 전체
  async function downloadXlsx() {
    const btn = $('#dl-xlsx');
    btn.disabled = true;
    try {
      const { from, to } = range();
      const rows = await store.list({ from, to }); // 화면 필터와 상관없이 최신 데이터로
      const order = partList(rows);
      rows.sort(
        (a, b) => a.date.localeCompare(b.date) || order.indexOf(partOf(a)) - order.indexOf(partOf(b)) || byOwner(a, b)
      );
      const columns = [
        { header: '날짜', width: 11 },
        { header: '소속파트', width: 10 },
        { header: '과제번호', width: 15 },
        { header: '제목', width: 32 },
        { header: '내용', width: 60 },
        { header: '진행율', width: 9, align: 'center' },
        { header: '비고', width: 24 },
        { header: '담당자', width: 16 },
        { header: '작성자', width: 9 },
        { header: '최종 수정', width: 16 },
        { header: '수정자', width: 9 },
      ];
      const stamp = (r) => {
        const d = new Date(r.updatedAt || r.createdAt);
        return isNaN(d) ? '' : `${DR.fmtDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      const data = rows.map((r) => [
        r.date,
        partOf(r),
        r.taskId,
        r.title,
        r.content,
        r.progress,
        r.note,
        ownersOf(r).join(', '),
        r.author,
        stamp(r),
        r.editor || r.author,
      ]);
      const span = from === to ? from : `${from}~${to}`;
      const bytes = DR.buildXlsx({ sheetName: span, columns, rows: data });
      const filename = `${cfg.TEAM_NAME}_일일업무보고_${from === to ? from : `${from}_${to}`}.xlsx`;
      const result = await DR.saveFile(filename, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (result === 'saved') DR.toast(`${span} 팀 전체 ${rows.length}건을 엑셀로 내려받았습니다.`);
    } catch (e) {
      showError(e);
    } finally {
      btn.disabled = false;
    }
  }

  function updateXlsxLabel() {
    const ld = state.ld;
    $('#dl-xlsx').textContent =
      ld.mode === 'week' ? '이번 주 엑셀 내려받기' : ld.date === DR.today() ? '오늘 엑셀 내려받기' : `${DR.shortDate(ld.date)} 엑셀 내려받기`;
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
    $('#dl-xlsx').onclick = downloadXlsx;
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
    setTab(savedTab === 'leader' ? 'leader' : 'input'); // 바깥 모듈 탭은 등록될 때 복원
    loadMine();
    renderMeChip();
    if (!state.me) openMeDialog(); // 처음 접속: 어느 탭이든 이름부터 묻는다
  }

  init();
})(window.DR);
