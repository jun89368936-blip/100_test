'use strict';
// 설계보고서·현황분석 보고서에서 입안서류에 필요한 사업 사실을 뽑는다.
// 모든 값은 {value, source:{file,page,quote}, confidence} 로 출처를 달고,
// 못 찾으면 값을 지어내지 않고 {value:null, missing:true} 로 남긴다.

const { norm, stripBullet, squash, toNumber, fmt, linesOf, tablesOf, parseAddress, formatAddress } = require('./text');

// 도시·군계획시설로 결정하는 '부지형' 시설 종류
const FAC_KINDS = [
  '공공하수처리시설', '하수처리시설', '하수처리장', '분뇨처리시설', '빗물펌프장', '하수펌프장',
  '배수지', '가압장', '정수장', '취수장', '정수시설', '저류시설', '펌프장',
];
const KIND_ALT = FAC_KINDS.join('|');
// 공백 제거한 셀 전체가 '교동배수지' 꼴일 때만 시설명으로 본다
const FAC_NAME_SQUASHED = new RegExp(`^([가-힣0-9]{1,8}?)(${KIND_ALT})$`);

const KIND_GROUP = {
  배수지: '수도공급설비', 가압장: '수도공급설비', 정수장: '수도공급설비', 취수장: '수도공급설비', 정수시설: '수도공급설비',
  공공하수처리시설: '하수도', 하수처리시설: '하수도', 하수처리장: '하수도', 분뇨처리시설: '하수도',
  하수펌프장: '하수도', 빗물펌프장: '하수도', 저류시설: '하수도', 펌프장: '하수도',
};

const MISSING = (hint) => ({ value: null, missing: true, confidence: 'none', source: null, hint });

function mkField(doc, line, value, confidence = 'high', extra = {}) {
  return {
    value,
    source: line ? { file: doc.name, page: line.page, quote: String(line.text).slice(0, 140) } : null,
    confidence,
    ...extra,
  };
}

function matchFacName(text) {
  const s = squash(text).replace(/^[○◦❍\d.]+(?=[가-힣])/, '');
  const m = FAC_NAME_SQUASHED.exec(s);
  if (!m) return null;
  return { name: m[1] + m[2], place: m[1], kind: m[2] };
}

/** '⋅V= 1,000㎥' → 'V=1,000㎥' */
function parseCapacity(text) {
  const t = norm(text);
  const m = /([VQ])\s*=\s*([\d,]+(?:\.\d+)?)\s*(㎥\/일|㎥\/분|㎥\/시|㎥|㎡|m³|m3|톤)/.exec(t);
  if (!m) return null;
  return `${m[1]}=${m[2]}${m[3] === 'm³' || m[3] === 'm3' ? '㎥' : m[3]}`;
}

// ---------------------------------------------------------------------------
// 시설 후보 수집
// ---------------------------------------------------------------------------

/** 표 헤더(첫 3행)에 시설명이 열로 놓인 표: 열마다 위치·용량 행을 읽는다 */
function facilitiesFromColumnTables(doc) {
  const found = [];
  for (const t of tablesOf(doc)) {
    const g = t.grid;
    for (let r = 0; r < Math.min(3, g.length); r++) {
      const cols = [];
      g[r].forEach((txt, c) => {
        if (c === 0) return;
        const m = matchFacName(txt);
        if (m) cols.push({ c, ...m });
      });
      if (!cols.length) continue;
      const rowOf = (re) => {
        for (let i = r + 1; i < g.length; i++) {
          const label = squash(stripBullet(g[i][0]));
          if (re.test(label)) return i;
        }
        return -1;
      };
      const locRow = rowOf(/^(위치|소재지|사업위치|입지)$/);
      const capRow = rowOf(/^(용량|시설용량|규모|시설규모)$/);
      if (locRow < 0 && capRow < 0) continue;
      for (const col of cols) {
        const loc = locRow >= 0 ? stripBullet(g[locRow][col.c]) : '';
        const cap = capRow >= 0 ? g[capRow][col.c] : '';
        found.push({
          ...col, doc, page: t.page, via: 'table-columns',
          위치text: loc, 용량: parseCapacity(cap), 용량text: stripBullet(cap),
          line: { page: t.page, text: `${g[r][col.c]} | 위치 ${loc}` },
        });
      }
      break;
    }
  }
  return found;
}

/** 행마다 시설명·주소(·면적)가 있는 표 (공간적 범위 표 등) */
function facilitiesFromRowTables(doc) {
  const found = [];
  for (const t of tablesOf(doc)) {
    const g = t.grid;
    let areaCol = -1;
    for (let r = 0; r < Math.min(2, g.length); r++) {
      g[r].forEach((txt, c) => { if (/면적/.test(txt) && areaCol < 0) areaCol = c; });
    }
    g.forEach((row) => {
      let nameCell = -1;
      let nm = null;
      row.forEach((txt, c) => { if (nameCell < 0) { const m = matchFacName(txt); if (m) { nameCell = c; nm = m; } } });
      if (!nm) return;
      let addr = null;
      let addrText = '';
      row.forEach((txt, c) => {
        if (c === nameCell || addr) return;
        const a = parseAddress(txt);
        if (a) { addr = a; addrText = txt; }
      });
      if (!addr) return;
      let area = null;
      const pick = (txt) => (/[\d,]+\s*㎡/.test(txt) || /^[\d,]+(\.\d+)?$/.test(norm(txt)) ? toNumber(txt) : null);
      if (areaCol >= 0) area = pick(row[areaCol]);
      if (area == null) row.forEach((txt, c) => { if (area == null && c !== nameCell) area = /㎡/.test(txt) ? toNumber(txt) : null; });
      found.push({
        ...nm, doc, page: t.page, via: 'table-rows', 위치text: addrText, 보고면적: area,
        line: { page: t.page, text: row.join(' | ') },
      });
    });
  }
  return found;
}

/** 본문 문장: '교동배수지 – 인천광역시 강화군 …', '교동배수지 : A = 19,341㎡' */
function facilitiesFromText(doc, lines) {
  const found = [];
  const addrRe = new RegExp(`([가-힣0-9·\\s]{1,12}?(?:${KIND_ALT}))\\s*[–—\\-:：]\\s*(.+)`);
  for (const ln of lines) {
    if (ln.kind === 'cell') continue;
    const t = stripBullet(ln.text).replace(/^위\s*치\s*[:：]\s*/, '');
    const m = addrRe.exec(t);
    if (!m) continue;
    const nm = matchFacName(m[1]);
    if (!nm) continue;
    const a = parseAddress(m[2]);
    const area = /^A\s*=/.test(m[2].trim()) ? toNumber(m[2]) : null;
    if (a) found.push({ ...nm, doc, page: ln.page, via: 'text', 위치text: m[2], line: ln });
    else if (area != null) found.push({ ...nm, doc, page: ln.page, via: 'text', 보고면적: area, line: ln });
  }
  return found;
}

function mergeFacilities(cands) {
  const byId = new Map();
  const order = [];
  const prio = { 'table-columns': 3, 'table-rows': 2, text: 1 };
  for (const c of cands) {
    const id = c.name;
    if (!byId.has(id)) { byId.set(id, { id, 명칭: c.name, place: c.place, kind: c.kind, cands: [] }); order.push(id); }
    byId.get(id).cands.push(c);
  }
  const out = [];
  for (const id of order) {
    const f = byId.get(id);
    const sorted = f.cands.slice().sort((a, b) => prio[b.via] - prio[a.via]);
    const pickBy = (fn) => sorted.find(fn);

    const locCand = pickBy((c) => c.위치text && parseAddress(c.위치text));
    const addr = locCand ? parseAddress(locCand.위치text) : null;
    const capCand = pickBy((c) => c.용량);
    const areaCand = pickBy((c) => c.보고면적 != null);

    const nameCand = sorted[0];
    const fac = {
      id,
      명칭: mkField(nameCand.doc, nameCand.line, f.명칭, nameCand.via === 'table-columns' ? 'high' : 'medium'),
      종류: mkField(nameCand.doc, nameCand.line, f.kind, 'high'),
      시설군: mkField(nameCand.doc, nameCand.line, KIND_GROUP[f.kind] || null, 'medium'),
      위치: locCand
        ? mkField(locCand.doc, locCand.line, formatAddress(addr, { withSido: !!addr.sido }), locCand.via === 'table-columns' ? 'high' : 'medium', { 주소: addr })
        : MISSING('설계보고서의 시설물 개요 표(위치)'),
      용량: capCand ? mkField(capCand.doc, capCand.line, capCand.용량, 'high') : MISSING('설계보고서의 시설물 개요 표(용량)'),
      보고면적: areaCand ? mkField(areaCand.doc, areaCand.line, areaCand.보고면적, 'medium') : MISSING('편입토지 합계에서 계산'),
      출처수: f.cands.length,
    };
    // 위치 후보가 서로 다르면 충돌로 남긴다
    const locs = new Set(sorted.filter((c) => c.위치text && parseAddress(c.위치text)).map((c) => formatAddress(parseAddress(c.위치text))));
    if (locs.size > 1) fac.위치.conflict = [...locs];
    out.push(fac);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 단일 값 항목
// ---------------------------------------------------------------------------

function kvOf(lines) {
  const out = [];
  for (const ln of lines) {
    const t = stripBullet(ln.text);
    const m = /^([가-힣\s]{2,14}?)\s*[:：]\s*(.+)$/.exec(t);
    if (m) out.push({ label: squash(m[1]), value: m[2].trim(), line: ln });
  }
  return out;
}

/** 후보들을 정규화 키로 세어 다수결, 나머지는 대안으로 */
function vote(cands, keyFn = (c) => squash(c.value)) {
  if (!cands.length) return null;
  const groups = new Map();
  for (const c of cands) {
    const k = keyFn(c);
    if (!groups.has(k)) groups.set(k, { items: [], weight: 0 });
    const g = groups.get(k);
    g.items.push(c);
    g.weight += c.weight || 1;
  }
  const ranked = [...groups.values()].sort((a, b) => b.weight - a.weight || b.items[0].value.length - a.items[0].value.length);
  const best = ranked[0];
  const alternatives = ranked.slice(1).map((g) => ({ value: g.items[0].value, count: g.items.length, source: g.items[0].source }));
  return { best: best.items[0], count: best.items.length, alternatives };
}

const TITLE_RE = new RegExp(
  `([가-힣0-9·\\s]{1,24}?(?:${KIND_ALT}|상수도|하수관로|관로)[가-힣0-9·\\s]{0,10}?(?:건설공사|신설공사|설치공사|증설공사|개량공사|정비사업|건설사업|신설사업|설치사업|사업))`
);

function projectNameCandidates(doc, lines) {
  const cands = [];
  const clean = (s) => norm(s)
    .replace(/\s*·\s*/g, '·')
    .replace(/기본\s*및\s*실시\s*설계(용역)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const push = (raw, line, weight, conf) => {
    const v = clean(raw);
    if (v.length >= 5 && v.length <= 40) cands.push({ value: v, line, weight, conf, doc });
  };
  // 라벨이 붙은 값
  for (const kv of kvOf(lines)) {
    if (/^(사업명|과업명|공사명|용역명|사업의명칭|계획의명칭)$/.test(kv.label)) push(kv.value, kv.line, 3, 'high');
  }
  // 문서 첫머리·표지 줄과 본문 문장
  lines.slice(0, 14).forEach((ln) => {
    const m = TITLE_RE.exec(norm(ln.text).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^[\s/]+/, ''));
    if (m) push(m[1], ln, 1, 'medium');
  });
  for (const ln of lines) {
    const m = /본\s*과업은\s*(.+?)\s*사업(?:으로|이며|이다|이고)/.exec(ln.text);
    if (m) push(m[1], ln, 2, 'medium');
  }
  return cands;
}

function yearCandidates(lines, re) {
  const out = [];
  for (const ln of lines) {
    const m = re.exec(norm(ln.text));
    if (m) out.push({ value: m[1], line: ln });
  }
  return out;
}

function moneyCandidates(lines, re) {
  const out = [];
  for (const ln of lines) {
    const m = re.exec(norm(ln.text));
    if (m) out.push({ value: toNumber(m[1]), unit: m[2], line: ln });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/**
 * @param {Array<{role?:string, parsed:object}>} inputs  role: 'design' | 'status' | 'other'
 * @param {object} [overrides] {fields:{사업명:'..'}, facilities:{'교동배수지':{위치:'..'}}}
 */
function extractFacts(inputs, overrides = {}) {
  const docs = inputs.map((i) => ({ role: i.role || 'other', doc: i.parsed, lines: linesOf(i.parsed) }));
  const designFirst = docs.slice().sort((a, b) => (a.role === 'design' ? -1 : 0) - (b.role === 'design' ? -1 : 0));

  // --- 시설
  const cands = [];
  for (const d of designFirst) {
    cands.push(...facilitiesFromColumnTables(d.doc));
    cands.push(...facilitiesFromRowTables(d.doc));
    cands.push(...facilitiesFromText(d.doc, d.lines));
  }
  const facilities = mergeFacilities(cands);

  const fields = {};

  // --- 사업명
  const nameCands = [];
  for (const d of designFirst) for (const c of projectNameCandidates(d.doc, d.lines)) nameCands.push({ value: c.value, source: { file: d.doc.name, page: c.line && c.line.page, quote: c.line && c.line.text.slice(0, 140) }, weight: c.weight });
  const nv = vote(nameCands);
  if (nv) {
    fields.사업명 = {
      value: nv.best.value, source: nv.best.source,
      confidence: nv.count >= 2 ? 'high' : 'medium',
      alternatives: nv.alternatives,
    };
  } else fields.사업명 = MISSING('설계보고서 표지 또는 본문 "본 과업은 ○○ 사업으로"');

  // --- 시행자 / 결정권자(라벨)
  const kvAll = [];
  for (const d of designFirst) for (const kv of kvOf(d.lines)) kvAll.push({ ...kv, doc: d.doc });
  const byLabel = (re) => kvAll.find((k) => re.test(k.label));
  const sh = byLabel(/^(시행자|사업시행자|발주처|발주기관|사업주체|계획시행자)$/);
  if (sh) fields.시행자 = mkField(sh.doc, sh.line, norm(sh.value), 'high');
  else {
    let best = null;
    for (const d of designFirst) for (const ln of d.lines) {
      const m = /([가-힣]+(?:특별시|광역시|도|시|군)\s*(?:상하수도|상수도|수도|하수도)(?:사업)?본부)/.exec(ln.text);
      if (m) { best = { d, ln, v: m[1].replace(/\s+/g, ' ') }; break; }
    }
    fields.시행자 = best ? mkField(best.d.doc, best.ln, best.v, 'low') : MISSING('입안서에 쓸 시행자(발주처)');
  }
  const gw = byLabel(/^(결정권자|도시관리계획결정권자|도시군관리계획결정권자)$/);
  if (gw) fields.결정권자 = mkField(gw.doc, gw.line, norm(gw.value), 'high');

  // --- 연도
  // 보고서마다 '목표연도'/'목표년도' 표기가 섞여 있다
  const yearHits = (...res) => {
    const hits = [];
    for (const d of designFirst) {
      for (const ln of d.lines) {
        const t = norm(ln.text);
        for (const re of res) {
          const m = re.exec(t);
          if (m) { hits.push({ value: m[1], source: { file: d.doc.name, page: ln.page, quote: t.slice(0, 140) } }); break; }
        }
      }
    }
    return hits;
  };
  const yearField = (hits) => {
    if (!hits.length) return null;
    const v = vote(hits);
    return { value: Number(v.best.value), source: v.best.source, confidence: v.count >= 2 ? 'high' : 'medium', alternatives: v.alternatives };
  };
  fields.목표연도 = yearField(yearHits(
    /계획\s*목표\s*[년연]\s*도\s*[:：]?\s*(\d{4})\s*년/,
    /^목표\s*[년연]\s*도\s*[:：]?\s*(\d{4})\s*년/
  )) || MISSING('계획 목표년도');
  fields.사업목표연도 = yearField(yearHits(/사업\s*목표\s*[년연]\s*도\s*[:：]?\s*(\d{4})\s*년/)) || MISSING('사업 목표년도');

  // --- 사업비(백만원)
  const unitToMillion = (n, unit) => (unit === '억원' ? n * 100 : unit === '천원' ? n / 1000 : n);
  const allLines = designFirst.flatMap((d) => d.lines.map((l) => ({ l, d })));
  const moneyField = (re) => {
    const hits = [];
    for (const { l, d } of allLines) {
      const m = re.exec(norm(l.text));
      if (m) hits.push({ value: unitToMillion(toNumber(m[1]), m[2]), line: l, d });
    }
    if (!hits.length) return null;
    const v = vote(hits.map((h) => ({ value: String(h.value), source: { file: h.d.doc.name, page: h.line.page, quote: h.line.text.slice(0, 140) } })));
    return { value: Number(v.best.value), unit: '백만원', source: v.best.source, confidence: v.count >= 2 ? 'high' : 'medium', alternatives: v.alternatives };
  };
  fields.총사업비 = moneyField(/총\s*소요\s*사업비는?\s*([\d,]+)\s*(백만원|억원|천원)/) || MISSING('총사업비');
  fields.총공사비 = moneyField(/총\s*공사비는?\s*([\d,]+)\s*(백만원|억원|천원)/) || MISSING('총공사비');

  // --- 지자체
  const withAddr = facilities.find((f) => f.위치 && f.위치.주소);
  const first = withAddr ? withAddr.위치.주소 : null;
  const region = {
    시도: first && first.sido ? { ...fieldFrom(withAddr.위치, first.sido) } : MISSING('시·도'),
    시군구: first ? { ...fieldFrom(withAddr.위치, first.sigungu) } : MISSING('시·군'),
    읍면: [...new Set(facilities.filter((f) => f.위치.주소).map((f) => f.위치.주소.eupmyeon))],
  };
  if (!fields.결정권자) {
    if (first) {
      const sg = first.sigungu;
      const suffix = sg.endsWith('군') ? '수' : sg.endsWith('시') ? '장' : '';
      fields.결정권자 = suffix ? { value: `${sg}${suffix}`, source: withAddr.위치.source, confidence: 'medium', derived: true } : MISSING('결정권자');
    } else fields.결정권자 = MISSING('결정권자(시장·군수)');
  }

  // --- 시설군
  const groups = [...new Set(facilities.map((f) => f.시설군.value).filter(Boolean))];
  fields.시설군 = groups.length
    ? { value: groups[0], source: facilities[0].시설군.source, confidence: groups.length === 1 ? 'medium' : 'low', alternatives: groups.slice(1).map((v) => ({ value: v })) }
    : MISSING('시설 종류');

  const facts = { fields, facilities, region, conflicts: [], missing: [] };
  for (const f of facilities) if (f.위치.conflict) facts.conflicts.push({ item: `${f.명칭.value} 위치`, values: f.위치.conflict });
  for (const [k, f] of Object.entries(fields)) {
    if (f.alternatives && f.alternatives.length && k !== '시설군') facts.conflicts.push({ item: k, values: [f.value, ...f.alternatives.map((a) => a.value)] });
  }

  applyOverrides(facts, overrides);
  collectMissing(facts);
  return facts;
}

function fieldFrom(src, value) {
  return { value, source: src.source, confidence: src.confidence };
}

function collectMissing(facts) {
  facts.missing = [];
  for (const [k, f] of Object.entries(facts.fields)) if (f.missing) facts.missing.push(k);
  for (const fac of facts.facilities) {
    for (const k of ['위치', '용량']) if (fac[k] && fac[k].missing) facts.missing.push(`${fac.명칭.value} ${k}`);
  }
}

/** 사용자 수정값이 추출값보다 우선한다 */
function applyOverrides(facts, overrides = {}) {
  const user = (v) => ({ value: v, source: { user: true }, confidence: 'user' });
  for (const [k, v] of Object.entries(overrides.fields || {})) {
    if (v == null || v === '') continue;
    const prev = facts.fields[k];
    facts.fields[k] = { ...user(v), replaced: prev && !prev.missing ? prev.value : undefined };
  }
  for (const [id, patch] of Object.entries(overrides.facilities || {})) {
    const fac = facts.facilities.find((f) => f.id === id || squash(f.명칭.value) === squash(id));
    if (!fac) continue;
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') continue;
      fac[k] = { ...user(v), replaced: fac[k] && !fac[k].missing ? fac[k].value : undefined };
      if (k === '위치') {
        const a = parseAddress(String(v));
        if (a) fac[k].주소 = a;
      }
    }
  }
  collectMissing(facts);
  return facts;
}

/** 현황분석 보고서(입지검토서)에서 대상지 위치·면적·필지수 */
function extractSite(parsed) {
  const lines = linesOf(parsed);
  const out = {};
  for (const ln of lines) {
    const t = stripBullet(ln.text);
    let m;
    if (!out.위치 && (m = /^위\s*치\s*[:：]\s*(.+)$/.exec(t))) out.위치 = { value: m[1].trim(), address: parseAddress(m[1]), source: { file: parsed.name, page: ln.page, quote: t.slice(0, 140) }, confidence: 'high' };
    if (!out.면적 && (m = /^면\s*적\s*[:：]\s*([\d,.]+)\s*㎡/.exec(t))) out.면적 = { value: toNumber(m[1]), source: { file: parsed.name, page: ln.page, quote: t.slice(0, 140) }, confidence: 'high' };
    if (!out.필지수 && (m = /^총\s*필지수\s*[•·]?\s*([\d,]+)\s*필지/.exec(t))) out.필지수 = { value: toNumber(m[1]), source: { file: parsed.name, page: ln.page, quote: t.slice(0, 140) }, confidence: 'high' };
  }
  // 표 셀: '총 필지수' 다음 칸 '• 178필지'
  for (const t of tablesOf(parsed)) {
    for (const row of t.grid) {
      const i = row.findIndex((c) => squash(c) === '총필지수');
      if (i >= 0 && !out.필지수) {
        const n = toNumber(row.slice(i + 1).join(' '));
        if (n != null) out.필지수 = { value: n, source: { file: parsed.name, page: t.page, quote: row.join(' | ').slice(0, 140) }, confidence: 'high' };
      }
      const j = row.findIndex((c) => squash(c) === '면적');
      if (j >= 0 && !out.면적) {
        const n = /㎡/.test(row.slice(j + 1).join(' ')) ? toNumber(row.slice(j + 1).join(' ')) : null;
        if (n != null) out.면적 = { value: n, source: { file: parsed.name, page: t.page, quote: row.join(' | ').slice(0, 140) }, confidence: 'high' };
      }
    }
  }
  return out;
}

module.exports = { extractFacts, applyOverrides, extractSite, parseCapacity, matchFacName, FAC_KINDS, KIND_GROUP, fmt };
