/*
 * 외부 라이브러리 없이 .xlsx(엑셀) 파일을 만든다.
 * 사내망에서 CDN을 못 쓰는 경우를 위해 압축 없이(zip 'stored') 직접 묶는다.
 *
 * DR.buildXlsx({ sheetName, columns: [{ header, width }], rows: [[...], ...] }) → Uint8Array
 * DR.saveFile(filename, data, mime) → 브라우저 다운로드
 */
(function (DR) {
  const enc = new TextEncoder();

  /* ── zip (무압축) ── */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(8, 0, true); // stored
      local.setUint16(12, DOS_DATE, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(14, DOS_DATE, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    for (const p of all) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  /* ── 엑셀 XML ── */
  const xml = (s) =>
    String(s ?? '')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .slice(0, 32000) // 엑셀 한 칸 최대 32,767자
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const colName = (i) => {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  };
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PR = 'http://schemas.openxmlformats.org/package/2006/relationships';

  // 스타일: 0 기본 / 1 머리글(굵게·회색 바탕·가운데) / 2 본문(테두리·줄바꿈·위 정렬)
  const STYLES =
    HEAD +
    `<styleSheet xmlns="${NS}">` +
    '<fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/><family val="3"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/><family val="3"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE3EAE6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFB7C3BD"/></left><right style="thin"><color rgb="FFB7C3BD"/></right>' +
    '<top style="thin"><color rgb="FFB7C3BD"/></top><bottom style="thin"><color rgb="FFB7C3BD"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  DR.buildXlsx = ({ sheetName = 'Sheet1', columns, rows }) => {
    const name = String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
    const lastCol = colName(columns.length - 1);
    const lastRow = rows.length + 1;
    const cell = (v, r, c, s) => `<c r="${colName(c)}${r}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    const sheetRows = [
      `<row r="1">${columns.map((col, c) => cell(col.header, 1, c, 1)).join('')}</row>`,
      ...rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c, 2)).join('')}</row>`),
    ].join('');
    const sheet =
      HEAD +
      `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<dimension ref="A1:${lastCol}${lastRow}"/>` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      `<cols>${columns.map((col, c) => `<col min="${c + 1}" max="${c + 1}" width="${col.width || 12}" customWidth="1"/>`).join('')}</cols>` +
      `<sheetData>${sheetRows}</sheetData>` +
      `<autoFilter ref="A1:${lastCol}${lastRow}"/>` +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
    const quoted = `'${name.replace(/'/g, "''")}'`;
    const workbook =
      HEAD +
      `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xml(quoted)}!$A$1:$${lastCol}$${lastRow}</definedName></definedNames></workbook>`;
    return zip([
      {
        name: '[Content_Types].xml',
        data:
          HEAD +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data:
          HEAD +
          `<Relationships xmlns="${NS_PR}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      { name: 'xl/workbook.xml', data: workbook },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          HEAD +
          `<Relationships xmlns="${NS_PR}">` +
          `<Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`,
      },
      { name: 'xl/styles.xml', data: STYLES },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
  };

  // 파일 내려받기. claude.ai 미리보기 안에서는 그쪽 다운로드 기능을, 그 밖에서는 일반 다운로드를 쓴다
  DR.saveFile = async (filename, data, mime) => {
    const blob = new Blob([data], { type: mime });
    if (window.claude && typeof window.claude.use === 'function') {
      const downloads = await window.claude.use('downloads').catch(() => null);
      if (downloads) {
        try {
          await downloads.save({ filename, data: blob });
          return 'saved';
        } catch (e) {
          if (e && e.code === 'declined') return 'declined';
          if (e && e.code === 'rate_limited') throw new Error('잠시 후 다시 시도하세요.');
          // 그 밖의 경우는 아래 일반 다운로드로 시도
        }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return 'saved';
  };
})(window.DR);
