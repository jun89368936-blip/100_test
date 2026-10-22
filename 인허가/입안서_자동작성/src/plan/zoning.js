'use strict';
// 시설별 용도지역 면적으로 관련법규 판정을 만든다.
//  - 개발행위허가 규모(국토계획법 시행령 제55조, 지자체 도시계획 조례가 있으면 조례 값)
//  - 토지적성평가·재해취약성분석 제외(시행령 제21조: 용도지역별 개발행위규모(시행령 제55조) 미만인 기반시설)
//  - 소규모환경영향평가 대상(환경영향평가법 시행령 별표 4: 관리지역 등 기준면적 이상, 둘 이상 지역에 걸치면 Σ(면적/기준면적) ≥ 1)
// 용도지역 면적은 현황분석 보고서의 '용도지역 현황' 표에서 읽거나 project.json "zones" 로 받는다.

const { sectionToMarkdown } = require('../ingest/outline');

const num = (n) => Math.round(n).toLocaleString('en-US');
const man = (n) => (n % 10000 === 0 ? `${n / 10000}만㎡` : `${num(n)}㎡`);

/** 국토계획법 시행령 제55조제1항 — 용도지역별 개발행위허가 규모(미만) */
function nationalDevLimit(zone) {
  if (/주거지역$|상업지역$|자연녹지지역$|생산녹지지역$/.test(zone)) return 10000;
  if (/공업지역$/.test(zone)) return 30000;
  if (/보전녹지지역$|자연환경보전지역$/.test(zone)) return 5000;
  if (/관리지역$|농림지역$/.test(zone)) return 30000;
  return null;
}

/** 지자체 도시계획 조례로 정한 관리지역·농림지역 개발행위허가 규모(샘플 입안서가 인용한 인천광역시 조례 제19조) */
const ORDINANCE = {
  인천광역시: { source: '인천광역시 도시계획 조례 제19조', limits: { 보전관리지역: 10000, 생산관리지역: 20000, 계획관리지역: 30000, 농림지역: 30000 } },
};

/** 환경영향평가법 시행령 별표 4 — 소규모환경영향평가 기준면적(이상) */
const SMALL_EIA = { 보전관리지역: 5000, 생산관리지역: 7500, 계획관리지역: 10000, 농림지역: 7500, 자연환경보전지역: 5000 };

/** 현황분석 보고서 '용도지역 현황' 절의 표에서 {용도지역: 면적} */
function zonesFromSection(node) {
  return zonesFromMarkdown(sectionToMarkdown(node));
}

/** 마크다운(파이프 표·HTML 표)에서 '…지역 | 면적' 행을 모은다. 합계·구역계 등 '지역'으로 끝나지 않는 행은 뺀다 */
function zonesFromMarkdown(md) {
  const zones = {};
  const add = (name, area) => {
    const n = String(name).replace(/\s+/g, '');
    const a = Number(String(area).replace(/,/g, ''));
    if (/지역$/.test(n) && a > 0) zones[n] = (zones[n] || 0) + a;
  };
  for (const m of md.matchAll(/^\|\s*([^|]+?)\s*\|\s*([\d,.]+)\s*\|/gm)) add(m[1], m[2]);
  for (const m of md.matchAll(/<tr><td>([^<]+)<\/td><td>([\d,.]+)<\/td>/g)) add(m[1], m[2]);
  return zones;
}

/**
 * @param {object} ctx  {facts, docs, mapping, project}
 * @returns {{facilities: {id,name,zones,source,dev,exempt,eia}[], sido:string|null}}
 */
function zoningFor(ctx) {
  const sido = ctx.facts.region && ctx.facts.region.시도 ? ctx.facts.region.시도.value : null;
  const ord = ORDINANCE[sido] || null;
  const facilities = (ctx.facts.facilities || []).map((f) => {
    const name = (f.명칭 && f.명칭.value) || f.id;
    let zones = null;
    let source = null;
    const user = ctx.project && ctx.project.zones && ctx.project.zones[f.id];
    if (user) { zones = { ...user }; source = 'project.json zones'; } else {
      const a = ctx.mapping.assignments.find((x) => x.targetId === `pkg.4.3:${f.id}:zone`);
      const doc = a && ctx.docs.find((d) => d.docId === a.docId);
      const node = doc && doc.outline.nodes.find((n) => n.id === a.nodeId);
      if (node) {
        const z = zonesFromSection(node);
        if (Object.keys(z).length) { zones = z; source = `현황분석 보고서 「${a.docId}」 › ${node.title}`; }
      }
    }
    return { id: f.id, name, zones, source, ...judge(zones, ord) };
  });
  return { facilities, sido, ordinance: ord ? ord.source : null };
}

/** 용도지역 면적 → 판정 세 가지. 모르는 용도지역이 있으면 그 판정은 null */
function judge(zones, ord) {
  if (!zones || !Object.keys(zones).length) return { dev: null, exempt: null, eia: null };
  const list = Object.entries(zones).sort((a, b) => b[1] - a[1]);
  const devLimit = (z) => (ord && ord.limits[z] != null ? ord.limits[z] : nationalDevLimit(z));
  const devRows = list.map(([z, a]) => ({ zone: z, area: a, limit: devLimit(z) }));
  const dev = devRows.some((r) => r.limit == null) ? null : { ok: devRows.every((r) => r.area < r.limit), rows: devRows };
  const exRows = list.map(([z, a]) => ({ zone: z, area: a, limit: nationalDevLimit(z) }));
  const exempt = exRows.some((r) => r.limit == null) ? null : { ok: exRows.every((r) => r.area < r.limit), rows: exRows };
  const eiaRows = list.map(([z, a]) => ({ zone: z, area: a, limit: SMALL_EIA[z] }));
  let eia = null;
  if (!eiaRows.some((r) => r.limit == null)) {
    const index = eiaRows.reduce((s, r) => s + r.area / r.limit, 0);
    eia = { target: eiaRows.length > 1 ? index >= 1 : eiaRows[0].area >= eiaRows[0].limit, index, rows: eiaRows };
  }
  return { dev, exempt, eia };
}

const zoneList = (rows) => rows.map((r) => `${r.zone} ${num(r.area)}㎡`).join(', ');
const missing = (f, what) => `${f.name}: [작성 필요: ${what} — 용도지역 면적을 모름(현황분석 보고서 또는 project.json zones)]`;

/** 문안 변수로 쓸 판정 문장(시설마다 한 줄) */
function zoningVars(z) {
  if (!z.facilities.length) return {};
  const lines = (fn) => z.facilities.map(fn).join('\n');
  return {
    개발행위판정: lines((f) => (f.dev
      ? `${f.name}: ${f.dev.rows.map((r) => `${r.zone} ${num(r.area)}㎡(${man(r.limit)} 미만)`).join(', ')}로 개발행위허가 규모 ${f.dev.ok ? '이하' : '초과 — 확인 필요'}`
      : missing(f, '개발행위허가 규모 판정'))),
    면적판정: lines((f) => (f.exempt
      ? `${f.name}: ${zoneList(f.exempt.rows)}로 용도지역별 개발행위규모 ${f.exempt.ok ? '미만 → 토지적성평가·재해취약성분석 제외' : '이상 → 토지적성평가·재해취약성분석 대상'}`
      : missing(f, '토지적성평가 제외 판정'))),
    소규모판정: lines((f) => {
      if (!f.eia) return missing(f, '소규모환경영향평가 판정');
      const how = f.eia.rows.length > 1
        ? `산출수치 ${f.eia.rows.map((r) => `${num(r.area)}/${num(r.limit)}`).join(' + ')} = ${f.eia.index.toFixed(2)}`
        : `${f.eia.rows[0].zone} ${num(f.eia.rows[0].area)}㎡(기준 ${num(f.eia.rows[0].limit)}㎡)`;
      return `${f.name}: ${f.eia.rows.length > 1 ? `${zoneList(f.eia.rows)}, ` : ''}${how}로 소규모환경영향평가 ${f.eia.target ? '대상' : '대상 아님'}`;
    }),
  };
}

module.exports = { zoningFor, zoningVars, zonesFromSection, zonesFromMarkdown, judge, nationalDevLimit, SMALL_EIA, ORDINANCE };
