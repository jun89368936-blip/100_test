'use strict';
// 편입토지(필지) 읽기와 지목별·소유자별 집계.
// 입력: 사용자의 현황분석 도구가 만드는 1_estate_list.xlsx('편입 토지' 시트), 일반 엑셀/CSV, 보고서 안의 편입토지조서 표.

const { norm, squash, toNumber } = require('./text');

// 지목 전체 명칭 → 지적 약칭 (공간정보의 구축 및 관리 등에 관한 법률 시행령 제58조)
const JIMOK_SHORT = {
  전: '전', 답: '답', 과수원: '과', 목장용지: '목', 임야: '임', 광천지: '광', 염전: '염', 대지: '대', 대: '대',
  공장용지: '장', 학교용지: '학', 주차장: '차', 주유소용지: '주', 창고용지: '창', 도로: '도', 철도용지: '철',
  제방: '제', 하천: '천', 구거: '구', 유지: '유', 양어장: '양', 수도용지: '수', 공원: '공', 체육용지: '체',
  유원지: '원', 종교용지: '종', 사적지: '사', 묘지: '묘', 잡종지: '잡',
  임: '임', 장: '장', 학: '학', 차: '차', 주: '주', 창: '창', 도: '도', 철: '철', 제: '제', 천: '천', 구: '구',
  유: '유', 양: '양', 수: '수', 공: '공', 체: '체', 원: '원', 종: '종', 사: '사', 묘: '묘', 잡: '잡', 과: '과', 목: '목', 광: '광', 염: '염',
};

function normJimok(s) {
  const t = squash(s).replace(/용지$/, (m) => m); // 그대로
  if (!t) return '';
  if (JIMOK_SHORT[t]) return JIMOK_SHORT[t];
  // 'ㅇㅇ용지' 처럼 접미가 달린 경우의 앞부분
  const key = Object.keys(JIMOK_SHORT).find((k) => t.startsWith(k) && k.length >= 2);
  return key ? JIMOK_SHORT[key] : t;
}

const STATE = /^(대한민국|국|국가|국유지?)$|국토교통부|기획재정부|산림청|국방부|농림축산식품부|환경부|해양수산부|조달청|한국철도|국토부/;
const LOCAL = /(군유지|시유지|도유지|구유지|공유지|시|군|구|특별시|광역시|특별자치시|특별자치도)(?:유지)?$|^(?:[가-힣]+(?:특별시|광역시|특별자치시|도|시|군|구))$/;

/** 소유자 문자열 → '국유지' | '공유지' | '사유지' | '미상' */
function classifyOwner(owner) {
  const t = squash(owner);
  if (!t) return '미상';
  if (/^국유지?$|^대한민국/.test(t) || STATE.test(t)) return '국유지';
  if (/군유지|시유지|도유지|구유지|공유지/.test(t)) return '공유지';
  if (/^사유지?$|^개인$|^법인$|종중|문중|교회|조합|주식회사|\(주\)|㈜|재단|학교법인/.test(t)) return '사유지';
  if (/^[가-힣]{2,8}(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/.test(t)) return '공유지';
  return '사유지';
}

function normJibun(jibun, gubun) {
  let j = squash(jibun).replace(/번지$/, '');
  const isSan = /산/.test(squash(gubun)) && !/^산/.test(j);
  if (isSan) j = `산${j}`;
  return j;
}

// ---------------------------------------------------------------------------
// 표 → 필지
// ---------------------------------------------------------------------------

const COLS = [
  ['소재지', [/^소재지/, /법정동/, /^주소$/, /소재지주소/, /소재지\(법정동\)/]],
  ['지번', [/^지번$/, /^번지$/, /소재지지번/, /^지번$/]],
  ['지번구분', [/지번구분/]],
  ['지목', [/^지목/]],
  ['공부면적', [/공부면적/, /대장면적/, /^면적\(?㎡?\)?$/]],
  ['편입면적', [/최종편입/, /편입면적/, /^편입\(?㎡/, /편입구적/]],
  ['소유자', [/^소유자/, /^소유구분/, /^소유$/]],
  ['편입구분', [/편입구분/]],
  ['PNU', [/^pnu$/i]],
  ['공시지가', [/공시지가\(?원\/㎡/, /^공시지가$/]],
];

function norm1(s) {
  return squash(String(s || '').replace(/\n/g, '')).replace(/\(㎡\)/g, '(㎡)');
}

/** 첫 몇 행을 합친 머리글에서 열 번호를 찾는다. 머리글이 두 줄인 표(소재지: 주소|지번)도 처리 */
function headerMap(grid) {
  for (let r = 0; r < Math.min(4, grid.length); r++) {
    for (const span of [1, 2]) {
      if (r + span > grid.length) continue;
      const ncols = grid[r].length;
      const heads = [];
      for (let c = 0; c < ncols; c++) {
        const parts = [];
        for (let k = 0; k < span; k++) parts.push(norm1(grid[r + k][c]));
        heads.push(parts.filter(Boolean));
      }
      const map = {};
      const used = new Set();
      for (const [name, res] of COLS) {
        // 열 순서가 아니라 정규식 우선순위로 고른다(최종편입 → 편입면적 → 편입구적)
        for (const re of res) {
          if (map[name] != null) break;
          for (let c = 0; c < ncols; c++) {
            if (used.has(c)) continue;
            if (heads[c].some((h) => re.test(h))) { map[name] = c; used.add(c); break; }
          }
        }
      }
      if (map.지번 != null && map.지목 != null && (map.공부면적 != null || map.편입면적 != null)) {
        return { map, dataStart: r + span };
      }
    }
  }
  return null;
}

function rowToParcel(row, map, meta) {
  const get = (name) => (map[name] != null ? norm(row[map[name]]) : '');
  const jibunRaw = get('지번');
  if (!jibunRaw || /^(합\s*계|계|소\s*계)$/.test(squash(row[0])) || /합계/.test(squash(row.join('')).slice(0, 6))) return null;
  const 공부 = toNumber(get('공부면적'));
  const 편입raw = toNumber(get('편입면적'));
  const gubun = get('편입구분');
  let 편입 = 편입raw;
  if (편입 == null) 편입 = 공부; // 편입면적 열이 없으면 전체 편입으로 본다
  const owner = get('소유자');
  return {
    소재지: get('소재지'),
    지번: normJibun(jibunRaw, get('지번구분')),
    지목: normJimok(get('지목')),
    공부면적: 공부,
    편입면적: 편입,
    편입구분: gubun || (공부 != null && 편입 != null ? (편입 >= 공부 ? '완전' : '일부') : ''),
    소유자: owner,
    소유구분: classifyOwner(owner),
    PNU: get('PNU'),
    공시지가: toNumber(get('공시지가')),
    출처: meta,
  };
}

/**
 * 읽은 문서에서 필지 표를 모두 찾아 시트(표)별로 돌려준다.
 * @returns {{sheets: Array<{name:string, kind:'편입'|'미편입', parcels:object[]}>, warnings:string[]}}
 */
function readParcelSheets(parsed) {
  const sheets = [];
  const warnings = [];
  let heading = '';
  parsed.blocks.forEach((b, i) => {
    if (b.type === 'heading' || (b.type === 'paragraph' && b.text && b.text.length < 30)) heading = String(b.text).split('\n')[0].trim() || heading;
    if (b.type !== 'table' || !b.table || !b.table.cells) return;
    const grid = b.table.cells.map((row) => row.map((c) => norm(c.text)));
    const hm = headerMap(grid);
    if (!hm) return;
    if (/건축물/.test(heading)) return; // 건축물 시트는 필지 조서가 아니다
    const kind = /미\s*편입|인근/.test(heading) ? '미편입' : '편입';
    const parcels = [];
    for (let r = hm.dataStart; r < grid.length; r++) {
      const p = rowToParcel(grid[r], hm.map, { file: parsed.name, sheet: heading || null, row: r + 1, page: b.pageNumber != null ? b.pageNumber : null });
      if (p) parcels.push(p);
    }
    if (parcels.length) sheets.push({ name: heading, kind, parcels, columns: Object.keys(hm.map) });
  });
  if (!sheets.length) warnings.push(`${parsed.name}: 필지 표(지번·지목·면적 열)를 찾지 못했습니다.`);
  return { sheets, warnings };
}

/** 편의 함수: 편입 필지만 */
function readParcels(parsed) {
  const { sheets, warnings } = readParcelSheets(parsed);
  const inside = sheets.filter((s) => s.kind === '편입');
  const parcels = inside.flatMap((s) => s.parcels);
  const outside = sheets.filter((s) => s.kind === '미편입').flatMap((s) => s.parcels);
  return { parcels, outside, sheets, warnings };
}

// ---------------------------------------------------------------------------
// 집계
// ---------------------------------------------------------------------------

/** 합이 100.0 이 되도록 소수 첫째 자리 비율(최대잔여법) */
function percentages(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 1000);
  const floor = raw.map(Math.floor);
  let rest = 1000 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) floor[order[k].i] += 1;
  return floor.map((x) => x / 10);
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {object[]} parcels
 * @returns {{합계:{필지수:number,공부면적:number,편입면적:number}, 지목별:object[], 소유자별:object[], warnings:string[]}}
 */
function aggregate(parcels) {
  const warnings = [];
  const sum = (arr, k) => round(arr.reduce((a, p) => a + (p[k] || 0), 0));
  const total = { 필지수: parcels.length, 공부면적: sum(parcels, '공부면적'), 편입면적: sum(parcels, '편입면적') };

  const group = (keyFn, order) => {
    const m = new Map();
    for (const p of parcels) {
      const k = keyFn(p);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    let keys = [...m.keys()];
    keys = order ? order.filter((k) => m.has(k)).concat(keys.filter((k) => !order.includes(k))) : keys.sort((a, b) => a.localeCompare(b, 'ko'));
    const areas = keys.map((k) => sum(m.get(k), '편입면적'));
    const pcts = percentages(areas);
    return keys.map((k, i) => ({ key: k, 필지수: m.get(k).length, 편입면적: areas[i], 비율: pcts[i] }));
  };

  const 지목별 = group((p) => p.지목 || '미상').map((r) => ({ 지목: r.key, 필지수: r.필지수, 편입면적: r.편입면적, 비율: r.비율 }));
  // 소유자별은 국·공·사 순서를 고정하고 없는 구분은 0으로 둔다(샘플 서식의 '-' 행)
  const base = group((p) => p.소유구분, ['국유지', '공유지', '사유지', '미상']);
  const 소유자별 = ['국유지', '공유지', '사유지'].map((k) => {
    const r = base.find((x) => x.key === k);
    return r ? { 소유구분: k, 필지수: r.필지수, 편입면적: r.편입면적, 비율: r.비율 } : { 소유구분: k, 필지수: 0, 편입면적: 0, 비율: 0 };
  });
  const unknown = base.find((x) => x.key === '미상');
  if (unknown) {
    소유자별.push({ 소유구분: '미상', 필지수: unknown.필지수, 편입면적: unknown.편입면적, 비율: unknown.비율 });
    warnings.push(`소유자를 알 수 없는 필지가 ${unknown.필지수}개 있습니다(토지대장 확인 필요).`);
  }

  parcels.forEach((p) => {
    if (p.공부면적 != null && p.편입면적 != null && p.편입면적 > p.공부면적 + 0.5) {
      warnings.push(`${p.소재지} ${p.지번}: 편입면적(${p.편입면적})이 공부면적(${p.공부면적})보다 큽니다.`);
    }
  });
  if (total.공부면적 && total.편입면적 > total.공부면적 + 0.5) {
    warnings.push(`공부면적 합계(${total.공부면적})가 편입면적 합계(${total.편입면적})보다 작습니다.`);
  }
  const seen = new Set();
  for (const p of parcels) {
    const k = `${p.소재지}|${p.지번}`;
    if (seen.has(k)) warnings.push(`같은 지번이 두 번 들어 있습니다: ${p.소재지} ${p.지번}`);
    seen.add(k);
  }
  return { 합계: total, 지목별, 소유자별, warnings };
}

module.exports = { readParcels, readParcelSheets, aggregate, classifyOwner, normJimok, normJibun, percentages, headerMap };
