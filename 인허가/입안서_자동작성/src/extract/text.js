'use strict';
// 추출기가 공통으로 쓰는 텍스트 도구: 정규화, 줄 모으기, 표 격자, 주소 파싱, 숫자 파싱.

const MIDDOT = /[․∙⋅ㆍ･•‧·]/g;

/** 가운뎃점 변형 통일, 공백 정리 */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(MIDDOT, '·')
    .replace(/[ 　]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 줄머리 불릿 제거 */
function stripBullet(s) {
  return norm(s).replace(/^[○◦❍▪■□▣※\-–·*]+\s*/, '').trim();
}

/** 공백·가운뎃점 제거(비교용) */
function squash(s) {
  return norm(s).replace(/[\s·]/g, '');
}

/** '1,234.5' → 1234.5, 숫자 없으면 null */
function toNumber(s) {
  if (s == null) return null;
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(s));
  if (!m) return null;
  return Number(m[0].replace(/,/g, ''));
}

/** 천단위 쉼표 */
function fmt(n) {
  if (n == null || Number.isNaN(n)) return '';
  const [i, d] = String(n).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? `.${d}` : '');
}

/**
 * 문서에서 글줄을 모은다(문단·제목·표 셀). 각 줄: {text, page, kind:'p'|'h'|'cell', block}
 */
function linesOf(parsed) {
  const out = [];
  const push = (text, page, kind, block) => {
    for (const raw of String(text || '').split('\n')) {
      const t = norm(raw);
      if (t) out.push({ text: t, page: page != null ? page : null, kind, block });
    }
  };
  parsed.blocks.forEach((b) => {
    if (b.type === 'paragraph' || b.type === 'heading') push(b.text, b.pageNumber, b.type === 'heading' ? 'h' : 'p', b);
    else if (b.type === 'table' && b.table) {
      for (const row of b.table.cells) for (const c of row) push(c.text, b.pageNumber, 'cell', b);
    }
  });
  return out;
}

/** 표 목록: [{block, page, grid: string[][]}] — 병합 셀은 격자에 이미 펼쳐져 있다 */
function tablesOf(parsed) {
  const out = [];
  parsed.blocks.forEach((b, index) => {
    if (b.type !== 'table' || !b.table || !b.table.cells) return;
    const grid = b.table.cells.map((row) => row.map((c) => norm(c.text)));
    out.push({ block: b, index, page: b.pageNumber != null ? b.pageNumber : null, grid, table: b.table });
  });
  return out;
}

const SIDO = '(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)';
// 시군구 → 읍면동 → (리) → 지번 → (번지) → (일원)
const ADDR_RE = new RegExp(
  `(?:(${SIDO})\\s*)?` +
  '([가-힣]{1,6}(?:시|군))\\s*' +
  '(?:([가-힣]{1,6}구)\\s*)?' +
  '([가-힣0-9]{1,8}(?:읍|면|동))\\s*' +
  '(?:([가-힣0-9]{1,8}리)\\s*)?' +
  '(산?\\s?\\d+(?:-\\d+)?)\\s*(?:번지)?\\s*(?:일원)?'
);

/** '인천광역시 강화군 교동면 상용리 산4번지 일원' → 구성요소 */
function parseAddress(text) {
  const t = norm(text);
  const m = ADDR_RE.exec(t);
  if (!m) return null;
  const jibun = (m[6] || '').replace(/\s+/g, '');
  const ilwon = /일원/.test(m[0]);
  return {
    sido: m[1] || null,
    sigungu: m[2],
    gu: m[3] || null,
    eupmyeon: m[4],
    ri: m[5] || null,
    jibun: jibun || null,
    ilwon,
    raw: m[0].trim(),
  };
}

/** 주소 구성요소 → '강화군 교동면 상용리 산4번지 일원' (시도 포함 옵션) */
function formatAddress(a, { withSido = false, ilwon = true } = {}) {
  if (!a) return '';
  const parts = [];
  if (withSido && a.sido) parts.push(a.sido);
  parts.push(a.sigungu);
  if (a.gu) parts.push(a.gu);
  parts.push(a.eupmyeon);
  if (a.ri) parts.push(a.ri);
  if (a.jibun) parts.push(`${a.jibun}번지`);
  let s = parts.join(' ');
  if (ilwon && (a.ilwon || a.jibun)) s += ' 일원';
  return s;
}

module.exports = { norm, stripBullet, squash, toNumber, fmt, linesOf, tablesOf, parseAddress, formatAddress, ADDR_RE };
