/*
 * goodocs 저장소 어댑터
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 이 파일의 API 형식(주소 경로, 요청/응답 모양)은 "가정"입니다.        │
 * │ 사내 goodocs 코드에 맞춰 [1] goodocsRequest 와 [3] 경로/응답 해석만 │
 * │ 고치면 되고, 화면 코드(app.js)는 건드릴 필요가 없습니다.            │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 가정한 API
 *   GET    {ENDPOINT}/docs/{DOC_ID}/sheets/{SHEET}/rows?from=&to=&author=
 *            → { rows: [ { rowId, values: { '날짜': ..., '작성자': ..., ... } } ] }
 *   POST   {ENDPOINT}/docs/{DOC_ID}/sheets/{SHEET}/rows      body { rows: [ { values } ] }
 *   PATCH  {ENDPOINT}/docs/{DOC_ID}/sheets/{SHEET}/rows/{rowId} body { values }
 *   DELETE {ENDPOINT}/docs/{DOC_ID}/sheets/{SHEET}/rows/{rowId}
 *   인증: Authorization: Bearer {TOKEN}
 */
(function (DR) {
  /* ── [1] 사내 goodocs 호출 함수 ────────────────────────────────────
   * 사내에 엔드포인트·토큰을 넣어 호출하는 코드가 이미 있다면
   * 이 함수 본문을 그 코드로 바꾸세요. (method, path, body) → JSON 응답
   */
  async function goodocsRequest(method, path, body) {
    const { ENDPOINT, TOKEN } = window.APP_CONFIG.GOODOCS;
    const res = await fetch(ENDPOINT.replace(/\/+$/, '') + path, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`goodocs ${method} 요청 실패 (HTTP ${res.status}) ${detail.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  /* ── [2] 시트 열 이름 ↔ 앱 필드 ────────────────────────────────────
   * goodocs 시트 1행(머리글)에 아래 열 이름을 그대로 만들어 두세요.
   */
  const COLUMNS = {
    date: '날짜',
    author: '작성자',
    part: '소속파트',
    title: '제목',
    content: '내용',
    progress: '진행율', // 자유입력 문자열 (예: 70%, 완료)
    note: '비고',
    owners: '담당자', // 여러 명이면 쉼표로 구분 (예: 김민준, 이서연)
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

  // 시트가 날짜를 '2026.10.05', '2026/10/05', Date 문자열 등으로 돌려줘도 'YYYY-MM-DD'로 맞춘다
  function normalizeDate(v) {
    const s = String(v ?? '').trim();
    const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d) ? s : DR.fmtDate(d);
  }

  /* ── [3] 응답 해석 ──────────────────────────────────────────────── */
  function fromRecord(rec) {
    const values = rec.values || rec;
    const row = { id: String(rec.rowId ?? rec.id ?? rec._id) };
    for (const [field, col] of Object.entries(COLUMNS)) row[field] = values[col] ?? '';
    for (const f of ['part', 'title', 'content', 'progress', 'note', 'owners']) row[f] = String(row[f]);
    row.date = normalizeDate(row.date);
    return row;
  }
  const recordsOf = (res) => (Array.isArray(res) ? res : res?.rows || res?.data || res?.items || []);

  DR.createGoodocsStore = () => {
    const g = window.APP_CONFIG.GOODOCS;
    const base = `/docs/${encodeURIComponent(g.DOC_ID)}/sheets/${encodeURIComponent(g.SHEET_NAME)}/rows`;

    return {
      kind: 'goodocs',
      label: 'goodocs 연결',

      checkConfig() {
        const missing = ['ENDPOINT', 'TOKEN', 'DOC_ID', 'SHEET_NAME'].filter((k) => !g[k]);
        return missing.length ? `config.js의 GOODOCS 설정이 비어 있습니다: ${missing.join(', ')}` : '';
      },

      async list({ from, to, author } = {}) {
        const q = new URLSearchParams();
        if (from) q.set('from', from);
        if (to) q.set('to', to);
        if (author) q.set('author', author);
        const res = await goodocsRequest('GET', `${base}?${q}`);
        // 서버가 필터를 지원하지 않아도 결과가 맞도록 한 번 더 거른다
        return recordsOf(res)
          .map(fromRecord)
          .filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!author || r.author === author));
      },

      async create(rows) {
        const now = DR.nowIso();
        const res = await goodocsRequest('POST', base, {
          rows: rows.map((r) => ({ values: toValues({ ...r, createdAt: now, updatedAt: now }) })),
        });
        return recordsOf(res).map(fromRecord);
      },

      async update(id, patch) {
        await goodocsRequest('PATCH', `${base}/${encodeURIComponent(id)}`, {
          values: toValues({ ...patch, updatedAt: DR.nowIso() }),
        });
      },

      async remove(id) {
        await goodocsRequest('DELETE', `${base}/${encodeURIComponent(id)}`);
      },
    };
  };
})(window.DR);
