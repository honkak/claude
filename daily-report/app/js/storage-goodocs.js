/*
 * Goodocs 저장소 어댑터
 *
 * 화면은 Goodocs를 직접 부르지 않고, 같은 PC에서 도는 중계 서버(goodocs-relay/goodocs-relay-server.ps1)를 부른다.
 * 중계 서버가 인증 정보(사번·토큰)를 붙여 Goodocs API로 전달한다. 토큰은 브라우저로 오지 않는다.
 *
 *   화면                         중계 서버(goodocs-relay-server.ps1)             Goodocs API ({BASE_URL}/{DOC_ID})
 *   GET    /api/rows          →  GET  {인증, ROW_INDEX} 5000건씩 반복 (read_all)
 *   POST   /api/rows  {행}    →  POST {인증, ROW_DATA: 행}           (create: 맨 아래에 행 추가)
 *   PUT    /api/rows  {행}    →  PUT  {인증, ROW_DATA: 행}           (update: ROW_ID로 찾아 수정)
 *   DELETE /api/rows/{ROW_ID} →  DELETE /{ROW_ID} {인증}             (delete)
 *
 * 조회 응답: 행 목록 [{ ROW_INDEX, ROW_ID, '날짜': ..., '작성자': ..., ... }, ...]
 */
(function (DR) {
  const conf = () => ({ API_BASE: '/api', UPDATE_KEY: 'ROW_ID', ...((window.APP_CONFIG || {}).GOODOCS || {}) });
  const apiBase = () => ((window.APP_RUNTIME && window.APP_RUNTIME.apiBase) || conf().API_BASE).replace(/\/+$/, '');

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(apiBase() + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch (e) {
      throw new Error('중계 서버(goodocs-relay-server.ps1)에 연결하지 못했습니다. start-daily-report.bat 창이 켜져 있는지 확인하세요.');
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = (data && data.error) || String(text).slice(0, 200);
      throw new Error(`Goodocs ${method} 실패 (HTTP ${res.status}) ${msg}`);
    }
    return data;
  }

  /* ── 시트 열 이름 ↔ 앱 필드 ──
   * Goodocs 시트 1행(머리글)에 아래 열 이름을 그대로 만들어 두세요.
   */
  const COLUMNS = {
    taskId: '과제번호', // 같은 과제는 날짜가 달라도 같은 번호
    date: '날짜',
    author: '작성자',
    part: '소속파트',
    title: '제목',
    content: '내용',
    progress: '진행율', // 자유입력 문자열 (예: 70%, 완료)
    note: '비고',
    owners: '담당자', // 여러 명이면 쉼표로 구분 (예: 김민준, 이서연)
    editor: '수정자', // 마지막으로 저장한 사람
    createdAt: '작성시각',
    updatedAt: '수정시각',
  };

  function toValues(row) {
    const values = {};
    for (const [field, col] of Object.entries(COLUMNS)) {
      if (row[field] !== undefined) values[col] = row[field] ?? '';
    }
    return values;
  }

  // 날짜가 '2026.10.05', '2026/10/05', '2026-10-05 00:00:00', 1790000000000(밀리초) 등으로 와도 'YYYY-MM-DD'로 맞춘다
  function normalizeDate(v) {
    if (v == null) return '';
    if (typeof v === 'number' || /^\d{10,13}$/.test(String(v).trim())) {
      const n = Number(v);
      const d = new Date(n < 1e12 ? n * 1000 : n);
      return isNaN(d) ? String(v) : DR.fmtDate(d);
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d) ? s : DR.fmtDate(d);
  }
  const str = (v) => (v == null || (typeof v === 'number' && isNaN(v)) ? '' : String(v));

  // 응답이 행 목록이 아니라 열 묶음({열: [값...]} 또는 {열: {번호: 값}})으로 와도 행 목록으로 바꾼다
  function recordsOf(res) {
    if (Array.isArray(res)) return res;
    if (!res || typeof res !== 'object') return [];
    for (const k of ['rows', 'data', 'items', 'result']) if (Array.isArray(res[k])) return res[k];
    const cols = Object.keys(res);
    if (!cols.length) return [];
    const first = res[cols[0]];
    const keys = Array.isArray(first) ? first.map((_, i) => i) : first && typeof first === 'object' ? Object.keys(first) : [];
    return keys.map((k) => Object.fromEntries(cols.map((c) => [c, (res[c] || {})[k]])));
  }

  DR.createGoodocsStore = () => {
    // 마지막으로 읽은 원본 행 (수정할 때 다른 열 값을 지우지 않도록 원본에 덮어써서 보낸다)
    const rawById = new Map();
    const idOf = (rec) => str(rec.ROW_ID) || (rec.ROW_INDEX != null ? `idx:${rec.ROW_INDEX}` : '');

    function fromRecord(rec) {
      const row = { id: idOf(rec) };
      for (const [field, col] of Object.entries(COLUMNS)) row[field] = str(rec[col]);
      row.date = normalizeDate(rec[COLUMNS.date]);
      return row;
    }

    async function readAll() {
      const recs = recordsOf(await api('GET', '/rows'));
      rawById.clear();
      const rows = [];
      for (const rec of recs) {
        if (!rec || typeof rec !== 'object') continue;
        const row = fromRecord(rec);
        if (!row.id || !row.date) continue; // 날짜가 없는 행(빈 행·메모 행)은 건너뛴다
        rawById.set(row.id, rec);
        rows.push(row);
      }
      return rows;
    }

    return {
      kind: 'goodocs',
      label: 'Goodocs 연결',

      checkConfig() {
        if (location.protocol === 'file:')
          return 'Goodocs에 연결하려면 start-daily-report.bat 으로 실행하세요. (파일을 직접 열면 저장되지 않습니다)';
        return '';
      },

      // Goodocs는 조건 조회가 없어 전체를 읽고 화면에서 거른다 (같은 데이터는 task-rules.js가 잠시 재사용)
      async list({ from, to, author } = {}) {
        const rows = await readAll();
        return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!author || r.author === author));
      },

      async create(rows) {
        const now = DR.nowIso();
        for (const r of rows) await api('POST', '/rows', toValues({ ...r, createdAt: now, updatedAt: now }));
        return [];
      },

      async update(id, patch) {
        if (!rawById.has(id)) await readAll();
        const base = rawById.get(id);
        if (!base) throw new Error('수정할 행을 Goodocs에서 찾지 못했습니다. 새로고침 후 다시 저장하세요.');
        const data = { ...base, ...toValues({ ...patch, updatedAt: DR.nowIso() }) };
        // 행을 찾는 열: 기본은 ROW_ID (삭제로 ROW_INDEX가 밀려도 안전). 설정 UPDATE_KEY로 바꿀 수 있다
        if (conf().UPDATE_KEY === 'ROW_ID' && data.ROW_ID != null) delete data.ROW_INDEX;
        await api('PUT', '/rows', data);
        rawById.set(id, data);
      },

      async remove(id) {
        const base = rawById.get(id);
        const rowId = (base && base.ROW_ID) || id;
        if (String(rowId).startsWith('idx:')) throw new Error('이 행은 ROW_ID가 없어 삭제할 수 없습니다.');
        await api('DELETE', `/rows/${encodeURIComponent(rowId)}`);
        rawById.delete(id);
      },
    };
  };

})(window.DR);
