/*
 * 팀장용 과제관리 대시보드 (독립 모듈)
 *
 * 일반 화면과 분리해 둔 모듈입니다. 필요한 것은 아래뿐입니다.
 *   js/config.js, js/util.js, js/model.js, js/store-*.js  (공통)
 *   dashboard/dashboard.js, dashboard/dashboard.css       (이 모듈)
 *
 * 쓰는 방법 두 가지
 *   1) 일반 화면의 탭으로: index.html에 이 파일과 css를 넣으면 '대시보드' 탭이 생깁니다.
 *      (config.js의 DASHBOARD.TAB_IN_MAIN_APP = false 이면 탭을 만들지 않습니다)
 *   2) 팀장 전용 페이지로: dashboard/index.html 을 엽니다.
 *
 * 보고 데이터를 읽기만 하고, 쓰지 않습니다.
 */
(function (DR) {
  const M = DR.model;
  const cfg = () => window.APP_CONFIG;
  const opts = () => ({ TAB_IN_MAIN_APP: true, DEFAULT_WEEKS: 0, ...(cfg().DASHBOARD || {}) });
  const $ = (sel, root) => root.querySelector(sel);

  const STATUS = {
    active: { label: '진행 중', mark: '●' },
    stalled: { label: '정체', mark: '!' },
    done: { label: '완료', mark: '✓' },
  };

  // 과제 상태 판단은 공통 규칙(js/model.js)을 쓴다
  const buildTasks = (rows, today) => M.buildTasks(rows, today);
  const stallDays = () => M.rules().STALL_DAYS;

  /* ───────── 그리기 도구 ───────── */

  const firstLine = (s) => String(s || '').split('\n')[0];
  const niceMax = (v) => {
    if (v <= 4) return 4;
    const step = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
    return 10 * step;
  };

  // 가로 누적 막대 한 줄. segs: [{key, value, tip}]
  function hbar(label, segs, max, extra = '') {
    const total = segs.reduce((s, x) => s + x.value, 0);
    const pct = max ? (total / max) * 100 : 0;
    const parts = segs
      .filter((s) => s.value > 0)
      .map((s) => `<span class="seg s-${s.key}" style="flex:${s.value}" data-tip="${DR.esc(s.tip)}"></span>`)
      .join('');
    return `<div class="hb-row">
      <span class="hb-label">${DR.esc(label)}${extra}</span>
      <span class="hb-track"><span class="hb-bar" style="width:${pct}%">${parts}</span><b class="hb-total">${total}</b></span>
    </div>`;
  }

  const legend = (keys) =>
    `<div class="legend">${keys.map((k) => `<span><i class="sw s-${k}"></i>${STATUS[k] ? STATUS[k].label : k}</span>`).join('')}</div>`;

  /* ───────── 대시보드 ───────── */

  function create(store) {
    const st = {
      weeks: DR.storage.get('dr-dash-period', opts().DEFAULT_WEEKS), // 0 = 설정의 기준 범위(기본 올해 1월 1일부터)
      part: '',
      status: 'open', // open = 진행 중 + 정체
      q: '',
      tasks: [],
      loadedAt: null,
      loading: false,
    };
    let root;

    function shell() {
      root.innerHTML = `
        <div class="dash">
          <div class="dash-toolbar">
            <div class="dash-title"><h2>과제 관리 대시보드</h2><span class="meta" data-ref="when"></span></div>
            <label class="field"><span>기간</span>
              <select data-ref="weeks">
                ${[[0, M.baseLabel()], [4, '최근 4주'], [8, '최근 8주'], [12, '최근 12주']]
                  .map(([w, t]) => `<option value="${w}" ${w === st.weeks ? 'selected' : ''}>${t}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="field"><span>소속파트</span><select data-ref="part"></select></label>
            <button type="button" class="btn" data-ref="refresh">새로고침</button>
          </div>
          <div class="dash-kpis" data-ref="kpis"></div>
          <div class="dash-grid">
            <section class="dash-card">
              <header><h3>파트별 과제</h3><p class="meta">진행 중·정체는 현재 기준, 완료는 기간 안에 끝난 과제</p></header>
              ${legend(['active', 'stalled', 'done'])}
              <div data-ref="byPart" class="hbars"></div>
            </section>
            <section class="dash-card">
              <header><h3>주별 신규 등록과 완료</h3><p class="meta">과제번호의 등록일과 처음 완료로 보고된 날 기준</p></header>
              <div class="legend"><span><i class="sw s-active"></i>신규 등록</span><span><i class="sw s-done"></i>완료</span></div>
              <div data-ref="weekly" class="cols"></div>
            </section>
            <section class="dash-card dash-wide">
              <header><h3>담당자별 진행 중 과제</h3><p class="meta">공동 과제는 담당자마다 한 건으로 셉니다</p></header>
              ${legend(['active', 'stalled'])}
              <div data-ref="byOwner" class="hbars"></div>
            </section>
          </div>
          <section class="dash-card">
            <header class="list-head">
              <h3>과제 목록</h3>
              <div class="seg" data-ref="statusSeg" role="group" aria-label="상태">
                <button type="button" data-status="open">진행 중·정체</button>
                <button type="button" data-status="stalled">정체만</button>
                <button type="button" data-status="done">완료</button>
                <button type="button" data-status="all">전체</button>
              </div>
              <input type="search" data-ref="q" placeholder="제목·과제번호·담당자 검색" aria-label="과제 검색">
            </header>
            <div class="grid-wrap" data-ref="table"></div>
          </section>
        </div>
        <div class="dash-tip" data-ref="tip" role="tooltip" hidden></div>
        <div class="dialog-backdrop" data-ref="hist" hidden>
          <div class="dialog dash-hist" role="dialog" aria-modal="true">
            <header class="loader-head"><h2 data-ref="histTitle"></h2><button type="button" class="icon-btn del" data-ref="histClose" aria-label="닫기">×</button></header>
            <div data-ref="histBody" class="hist-body"></div>
          </div>
        </div>`;
      const ref = (n) => $(`[data-ref="${n}"]`, root);
      ref('weeks').onchange = (e) => {
        st.weeks = Number(e.target.value);
        DR.storage.set('dr-dash-period', st.weeks);
        load();
      };
      ref('part').onchange = (e) => {
        st.part = e.target.value;
        render();
      };
      ref('refresh').onclick = load;
      ref('statusSeg').onclick = (e) => {
        const b = e.target.closest('[data-status]');
        if (!b) return;
        st.status = b.dataset.status;
        render();
      };
      let t;
      ref('q').oninput = (e) => {
        clearTimeout(t);
        t = setTimeout(() => {
          st.q = e.target.value.trim().toLowerCase();
          renderTable();
        }, 150);
      };
      ref('table').onclick = (e) => {
        const tr = e.target.closest('[data-key]');
        if (tr) openHistory(tr.dataset.key);
      };
      ref('table').onkeydown = (e) => {
        const tr = e.target.closest('[data-key]');
        if (tr && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openHistory(tr.dataset.key);
        }
      };
      ref('histClose').onclick = () => (ref('hist').hidden = true);
      ref('hist').onclick = (e) => e.target === ref('hist') && (ref('hist').hidden = true);
      ref('hist').onkeydown = (e) => e.key === 'Escape' && (ref('hist').hidden = true);
      bindTips();
    }

    const ref = (n) => $(`[data-ref="${n}"]`, root);

    async function load() {
      st.loading = true;
      ref('when').textContent = '불러오는 중…';
      try {
        const today = DR.today();
        // 기준 범위(기본 올해 1월 1일~오늘) 데이터를 일반 화면과 함께 쓴다
        const rows = await M.baseRows(store, { force: true });
        st.tasks = buildTasks(rows, today);
        st.loadedAt = new Date();
      } catch (e) {
        st.tasks = [];
        (DR.toast || console.error)(e.message || String(e), 'error');
      }
      st.loading = false;
      render();
    }

    // 화면에 쓰는 과제: 현재 진행 중·정체 전부 + 기간 안에 완료된 것
    function scoped() {
      const since = st.weeks ? DR.addDays(DR.weekStart(DR.today()), -7 * (st.weeks - 1)) : M.baseStart();
      return {
        since,
        tasks: st.tasks.filter((t) => (!st.part || t.part === st.part) && (t.status !== 'done' || t.doneDate >= since)),
      };
    }

    function render() {
      const parts = M.partList(st.tasks.map((t) => ({ part: t.part })));
      ref('part').innerHTML =
        `<option value="">전체</option>` + parts.map((p) => `<option ${p === st.part ? 'selected' : ''}>${DR.esc(p)}</option>`).join('');
      [...ref('statusSeg').querySelectorAll('[data-status]')].forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.status === st.status))
      );
      ref('when').textContent = st.loadedAt ? `${DR.labelDate(DR.today())} · ${DR.fmtTime(st.loadedAt.toISOString())} 기준` : '';
      renderKpis();
      renderByPart();
      renderWeekly();
      renderByOwner();
      renderTable();
    }

    function renderKpis() {
      const { tasks } = scoped();
      const wk = DR.weekStart(DR.today());
      const prevWk = DR.addDays(wk, -7);
      const inWeek = (d, s) => d && d >= s && d < DR.addDays(s, 7);
      const open = tasks.filter((t) => t.status !== 'done');
      const stalled = open.filter((t) => t.status === 'stalled');
      const pool = st.tasks.filter((t) => !st.part || t.part === st.part);
      const newThis = pool.filter((t) => inWeek(t.registered, wk)).length;
      const newPrev = pool.filter((t) => inWeek(t.registered, prevWk)).length;
      const doneThis = pool.filter((t) => inWeek(t.doneDate, wk)).length;
      const donePrev = pool.filter((t) => inWeek(t.doneDate, prevWk)).length;
      const avg = open.length ? Math.round(open.reduce((s, t) => s + (t.pct ?? 0), 0) / open.length) : null;
      ref('kpis').innerHTML = `
        <div class="kpi"><span class="kpi-label">진행 중인 과제</span><span class="kpi-val">${open.length}<small>건</small></span>
          <span class="kpi-sub">평균 진행율 ${avg ?? '-'}%</span></div>
        <div class="kpi ${stalled.length ? 'is-warn' : ''}"><span class="kpi-label">${stalled.length ? '<i class="warn-icon" aria-hidden="true">!</i>' : ''}정체 과제</span>
          <span class="kpi-val">${stalled.length}<small>건</small></span>
          <span class="kpi-sub">${stallDays()}일 이상 진행율 변화 없음</span></div>
        <div class="kpi"><span class="kpi-label">이번 주 신규 등록</span><span class="kpi-val">${newThis}<small>건</small></span>
          <span class="kpi-sub">지난주 ${newPrev}건</span></div>
        <div class="kpi"><span class="kpi-label">이번 주 완료</span><span class="kpi-val">${doneThis}<small>건</small></span>
          <span class="kpi-sub">지난주 ${donePrev}건</span></div>`;
    }

    function renderByPart() {
      const { tasks } = scoped();
      const parts = M.partList(tasks.map((t) => ({ part: t.part }))).filter((p) => !st.part || p === st.part);
      const rows = parts.map((p) => {
        const mine = tasks.filter((t) => t.part === p);
        const c = (k) => mine.filter((t) => t.status === k).length;
        return { p, segs: ['active', 'stalled', 'done'].map((k) => ({ key: k, value: c(k), tip: `${p} · ${STATUS[k].label} ${c(k)}건` })) };
      });
      const max = Math.max(1, ...rows.map((r) => r.segs.reduce((s, x) => s + x.value, 0)));
      ref('byPart').innerHTML = rows.length ? rows.map((r) => hbar(r.p, r.segs, max)).join('') : '<p class="muted">과제가 없습니다.</p>';
    }

    function renderWeekly() {
      const pool = st.tasks.filter((t) => !st.part || t.part === st.part);
      const thisWk = DR.weekStart(DR.today());
      const weeks = [];
      // 기준 범위면 그 시작일(기본 1월 1일)이 속한 주부터 이번 주까지
      const n = st.weeks || Math.round((DR.parseDate(thisWk) - DR.parseDate(DR.weekStart(M.baseStart()))) / (7 * 86400000)) + 1;
      for (let i = n - 1; i >= 0; i--) weeks.push(DR.addDays(thisWk, -7 * i));
      const every = Math.ceil(n / 12); // 주가 많으면 아래 날짜는 띄엄띄엄
      const data = weeks.map((w) => {
        const end = DR.addDays(w, 7);
        return {
          w,
          added: pool.filter((t) => t.registered >= w && t.registered < end).length,
          done: pool.filter((t) => t.doneDate && t.doneDate >= w && t.doneDate < end).length,
        };
      });
      const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.added, d.done])));
      const ticks = [0, max / 2, max];
      const label = (w) => `${DR.shortDate(w)}주`;
      ref('weekly').innerHTML = `
        <div class="cols-plot">
          ${ticks.map((v) => `<span class="gridline" style="bottom:${(v / max) * 100}%"><em>${v}</em></span>`).join('')}
          <div class="cols-groups">
            ${data
              .map(
                (d) => `<div class="cols-group ${d.w === thisWk ? 'is-now' : ''}">
                  <span class="col s-active" style="height:${(d.added / max) * 100}%" data-tip="${label(d.w)} · 신규 등록 ${d.added}건"></span>
                  <span class="col s-done" style="height:${(d.done / max) * 100}%" data-tip="${label(d.w)} · 완료 ${d.done}건"></span>
                </div>`
              )
              .join('')}
          </div>
        </div>
        <div class="cols-x">${data
          .map((d, i) => {
            const now = d.w === thisWk;
            const show = now || (i % every === 0 && n - 1 - i >= every); // 시작 주부터 띄엄띄엄, '이번 주' 바로 앞은 비움
            const start = d.w < M.baseStart() ? M.baseStart() : d.w; // 시작일이 낀 주는 시작일로 표시 (예: 1/1)
            return `<span class="${now ? 'is-now' : ''}">${now ? '이번 주' : show ? DR.shortDate(start) : ''}</span>`;
          })
          .join('')}</div>`;
    }

    function renderByOwner() {
      const open = scoped().tasks.filter((t) => t.status !== 'done');
      const names = [...new Set(open.flatMap((t) => t.owners))];
      const order = cfg().MEMBERS;
      names.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b));
      const rows = names.map((n) => {
        const mine = open.filter((t) => t.owners.includes(n));
        const a = mine.filter((t) => t.status === 'active').length;
        const s = mine.length - a;
        return {
          n,
          segs: [
            { key: 'active', value: a, tip: `${n} · 진행 중 ${a}건` },
            { key: 'stalled', value: s, tip: `${n} · 정체 ${s}건` },
          ],
        };
      });
      const max = Math.max(1, ...rows.map((r) => r.segs[0].value + r.segs[1].value));
      ref('byOwner').innerHTML = rows.length ? rows.map((r) => hbar(r.n, r.segs, max)).join('') : '<p class="muted">진행 중인 과제가 없습니다.</p>';
    }

    function renderTable() {
      const { tasks } = scoped();
      const rank = { stalled: 0, active: 1, done: 2 };
      let list = tasks.filter((t) =>
        st.status === 'all' ? true : st.status === 'open' ? t.status !== 'done' : t.status === st.status
      );
      if (st.q)
        list = list.filter((t) => `${t.id} ${t.title} ${t.owners.join(' ')} ${t.part}`.toLowerCase().includes(st.q));
      list.sort(
        (a, b) =>
          rank[a.status] - rank[b.status] ||
          (a.status === 'done' ? String(b.doneDate).localeCompare(String(a.doneDate)) : b.idle - a.idle) ||
          a.registered.localeCompare(b.registered)
      );
      const pill = (t) => `<span class="st st-${t.status}"><i aria-hidden="true">${STATUS[t.status].mark}</i>${STATUS[t.status].label}</span>`;
      const prog = (t) =>
        t.pct == null
          ? DR.esc(t.progress)
          : `<span class="pbar"><span class="s-${t.status}" style="width:${t.pct}%"></span></span><b>${DR.esc(t.progress)}</b>`;
      const ago = (t) => {
        if (t.status === 'done') return `${DR.shortDate(t.doneDate)} 완료`;
        return t.idle ? `${t.idle}일째 변화 없음` : '오늘 갱신';
      };
      ref('table').innerHTML = `<table class="sheet dash-table">
        <thead><tr><th>상태</th><th>과제번호</th><th>소속파트</th><th>제목</th><th>담당자</th><th class="c">진행율</th><th>등록일</th><th>최근 보고</th><th>진행율 변화</th></tr></thead>
        <tbody>${
          list
            .map(
              (t) => `<tr data-key="${DR.esc(t.key)}" tabindex="0" title="눌러서 과제 이력 보기">
                <td>${pill(t)}</td>
                <td class="tid-cell">${DR.esc(t.id)}</td>
                <td class="nowrap">${DR.esc(t.part)}</td>
                <td class="title">${DR.esc(firstLine(t.title))}</td>
                <td>${t.owners.map((n) => `<span class="chip">${DR.esc(n)}</span>`).join('')}</td>
                <td class="prog nowrap">${prog(t)}</td>
                <td class="num">${DR.shortDate(t.registered)}</td>
                <td class="num">${DR.shortDate(t.lastSeen)}</td>
                <td class="nowrap ${t.status === 'stalled' ? 'warn' : 'muted'}">${ago(t)}</td>
              </tr>`
            )
            .join('') || `<tr><td colspan="9" class="grid-empty">조건에 맞는 과제가 없습니다.</td></tr>`
        }</tbody></table>
        <p class="meta">${list.length}건 · 행을 누르면 그 과제의 날짜별 보고 이력을 봅니다</p>`;
    }

    function openHistory(key) {
      const t = st.tasks.find((x) => x.key === key);
      if (!t) return;
      ref('histTitle').textContent = `${t.id ? t.id + ' · ' : ''}${firstLine(t.title)}`;
      ref('histBody').innerHTML = `
        <p class="meta">${DR.esc(t.part)} · 담당 ${DR.esc(t.owners.join(', '))} · 등록 ${DR.shortDate(t.registered)} · 현재 ${STATUS[t.status].label}</p>
        <div class="grid-wrap"><table class="sheet">
          <thead><tr><th>날짜</th><th class="c">진행율</th><th>내용</th><th>비고</th><th>수정자</th></tr></thead>
          <tbody>${[...t.history]
            .reverse()
            .map(
              (r) => `<tr><td class="num nowrap">${DR.shortDate(r.date)} (${DR.weekdayName(r.date)})</td>
                <td class="prog">${DR.esc(r.progress)}</td>
                <td class="content">${DR.esc(r.content)}</td>
                <td class="note">${DR.esc(r.note)}</td>
                <td class="nowrap">${DR.esc(r.editor || r.author)}</td></tr>`
            )
            .join('')}</tbody></table></div>`;
      ref('hist').hidden = false;
      ref('histClose').focus();
    }

    // 막대에 마우스를 올리면 값 표시
    function bindTips() {
      const tip = ref('tip');
      root.addEventListener('mousemove', (e) => {
        const el = e.target.closest('[data-tip]');
        if (!el) return (tip.hidden = true);
        tip.textContent = el.dataset.tip;
        tip.hidden = false;
        const pad = 12;
        const w = tip.offsetWidth;
        const x = Math.min(e.clientX + pad, window.innerWidth - w - 8);
        tip.style.left = `${x}px`;
        tip.style.top = `${e.clientY + pad}px`;
      });
      root.addEventListener('mouseleave', () => (tip.hidden = true));
    }

    return {
      mount(el) {
        root = el;
        shell();
      },
      show: load,
      refresh: load,
    };
  }

  DR.Dashboard = { create, buildTasks };

  // 일반 화면 안의 탭으로 붙이기 (core가 등록 함수를 제공하고, 설정이 허락할 때만)
  if (typeof DR.registerTab === 'function' && opts().TAB_IN_MAIN_APP) {
    let dash;
    DR.registerTab({
      id: 'dashboard',
      label: '대시보드',
      mount(view, { store }) {
        dash = create(store);
        dash.mount(view);
      },
      show: () => dash && dash.show(),
    });
  }
})(window.DR);
