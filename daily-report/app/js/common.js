window.DR = window.DR || {};

(function (DR) {
  const pad = (n) => String(n).padStart(2, '0');
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  // 날짜는 모두 로컬 기준 'YYYY-MM-DD' 문자열로 다룬다 (UTC 변환으로 하루 밀리는 문제 방지)
  DR.fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  DR.parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  DR.today = () => DR.fmtDate(new Date());
  DR.addDays = (s, n) => {
    const d = DR.parseDate(s);
    d.setDate(d.getDate() + n);
    return DR.fmtDate(d);
  };
  DR.isWeekend = (s) => {
    const w = DR.parseDate(s).getDay();
    return w === 0 || w === 6;
  };
  DR.shiftWorkday = (s, dir) => {
    let d = DR.addDays(s, dir);
    while (DR.isWeekend(d)) d = DR.addDays(d, dir);
    return d;
  };
  DR.weekStart = (s) => {
    const d = DR.parseDate(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return DR.fmtDate(d);
  };
  DR.weekdayName = (s) => WEEKDAYS[DR.parseDate(s).getDay()];
  DR.labelDate = (s) => {
    const d = DR.parseDate(s);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  };
  DR.shortDate = (s) => {
    const d = DR.parseDate(s);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  DR.nowIso = () => new Date().toISOString();
  DR.fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return DR.fmtDate(d) === DR.today() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  };

  DR.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  DR.tmpId = () => 'tmp-' + Math.random().toString(36).slice(2, 10);

  // 과제번호: 파트코드-등록일-순번  예) P1-261005-01 (1파트, 2026-10-05에 그 파트에서 첫 번째로 등록)
  DR.taskIdPrefix = (part, when = new Date()) => {
    const codes = (window.APP_CONFIG && window.APP_CONFIG.PART_CODES) || {};
    const code = codes[String(part ?? '').trim()] || 'ETC';
    const d = when instanceof Date && !isNaN(when) ? when : new Date();
    return `${code}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`;
  };
  // 이미 쓰인 번호들(used)을 보고 같은 파트·날짜의 다음 순번을 만든다
  DR.nextTaskId = (part, used, when = new Date()) => {
    const prefix = DR.taskIdPrefix(part, when);
    let max = 0;
    for (const id of used) {
      if (!id || !id.startsWith(prefix)) continue;
      const n = parseInt(id.slice(prefix.length), 10);
      if (n > max) max = n;
    }
    return prefix + pad(max + 1);
  };

  // 브라우저 저장소가 막혀 있어도(사생활 보호 모드 등) 앱은 동작해야 한다
  DR.storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* 저장 불가 환경: 무시 */
      }
    },
  };

  let toastTimer;
  DR.toast = (msg, kind = 'ok') => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.dataset.kind = kind;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 2200);
  };

  // window.confirm은 일부 환경에서 막혀 있어 자체 확인창을 쓴다
  DR.confirm = (message, okLabel = '확인') =>
    new Promise((resolve) => {
      const dlg = document.getElementById('dialog');
      dlg.querySelector('.dialog-msg').textContent = message;
      const ok = dlg.querySelector('[data-act="ok"]');
      const cancel = dlg.querySelector('[data-act="cancel"]');
      ok.textContent = okLabel;
      dlg.hidden = false;
      ok.focus();
      const done = (v) => {
        dlg.hidden = true;
        ok.onclick = cancel.onclick = dlg.onkeydown = null;
        resolve(v);
      };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      dlg.onkeydown = (e) => e.key === 'Escape' && done(false);
    });
})(window.DR);
