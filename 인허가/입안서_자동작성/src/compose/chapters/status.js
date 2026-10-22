'use strict';
// Ⅳ. 현황 및 여건분석 장: 간지 → 1. 일반 현황 → 2. 인문·사회현황(설계보고서, 템플릿 keep 규칙으로 필요한 절만)
// → 3. 계획대상지 현황분석: 시설마다 1) 광역입지여건 2) 자연환경(표고·경사·생태자연도) 3) 인문환경(지목별·소유별·도시관리계획 지정)
//    4) 현황종합분석. 내용은 그 시설의 현황분석 보고서에서, 지목별·소유별은 편입토지(결정조서와 같은 자료)로 만든다.

const { buildToc } = require('../toc');
const { transplant, trimSection } = require('../md');
const { assignedNodes, table } = require('./plans');
const { splitParcels } = require('../../plan/decision');
const { aggregate } = require('../../extract/parcels');

const GANA = '가나다라마바사아자차카타파하';
const num = (n) => Math.round(n).toLocaleString('en-US');
const pct = (n) => Number(n).toFixed(1);
/** 받침이 있으면 '이', 없으면 '가' ('임이', '대가') */
const josa = (word) => {
  const c = String(word).charCodeAt(String(word).length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '이' : '가';
};

/** 1·2절: 배정된 원본 절에서 keep 규칙으로 필요한 절만 남겨 '가.'부터 옮긴다 */
function designSection(ctx, targetId, notes) {
  const target = ctx.mapping.targets.find((t) => t.id === targetId);
  let found = assignedNodes(ctx, targetId, notes);
  if (!found.length && target.sourceFrom) found = assignedNodes(ctx, target.sourceFrom, []);
  if (!found.length) return `[작성 필요: ${target.title} — 설계보고서에서 해당 내용을 찾지 못함]`;
  const names = (ctx.facts.facilities || []).map((f) => (f.명칭 && f.명칭.value) || f.id);
  const parts = [];
  let index = 0;
  for (const f of found) {
    let node = f.node;
    if (target.keep) {
      const t = trimSection(f.node, target.keep, names);
      if (t.node) {
        node = t.node;
        notes.push(`${target.title}: 「${f.a.docId}」 › ${f.node.title} 에서 남김 — ${t.kept.join(', ')} / 뺌 — ${t.dropped.join(', ') || '없음'}`);
      } else {
        notes.push(`${target.title}: 「${f.a.docId}」 › ${f.node.title} 에서 남길 절을 찾지 못했습니다.`);
        continue;
      }
    }
    // 원본 절 제목(예: '2.0 일반현황')은 입안서 절 제목과 겹치므로 빼고 하위 절을 '가.'부터
    const body = transplant(f.doc, node, { level: 2, depth: -1, index: 0, noHeading: true });
    parts.push(body.replace(/^(#{3,6}) ([가-하])\./gm, (m, h, g) => (h === '###' ? `### ${GANA[index++] || g}.` : m)));
  }
  return parts.length ? parts.join('\n\n') : `[작성 필요: ${target.title} — 설계보고서에서 해당 내용을 찾지 못함]`;
}

/** 지목별·소유별 현황: 편입토지 집계(결정조서와 같은 면적) */
function parcelTables(ps, facName) {
  const agg = aggregate(ps);
  const total = agg.합계.편입면적;
  const jimok = agg.지목별.slice().sort((a, b) => b.편입면적 - a.편입면적);
  const jimokText = jimok.map((r) => `${r.지목}${josa(r.지목)} ${num(r.편입면적)}㎡(${pct(r.비율)}%)`).join(', ');
  const owners = agg.소유자별.filter((r) => r.필지수 > 0 && r.소유구분 !== '미상');
  const unknown = agg.소유자별.find((r) => r.소유구분 === '미상');
  const unknownText = unknown ? ` [작성 필요: 소유자 미상 ${unknown.필지수}필지 ${num(unknown.편입면적)}㎡ — 토지대장으로 확인]` : '';
  const ownerNames = (k) => [...new Set(ps.filter((p) => p.소유구분 === k).map((p) => p.소유자).filter(Boolean))].join(', ');
  const jimokMd = [
    `∙ ${facName}의 지목별 분포현황은 전체면적 ${num(total)}㎡(100.0%) 중 ${jimokText}로 되어 있음`,
    '지목별 면적 및 비율',
    table(['구 분', '필지수(개소)', '면 적(㎡)', '비 율(%)', '비 고'], [
      ['합 계', agg.합계.필지수, num(total), '100.0', ''],
      ...jimok.map((r) => [r.지목, r.필지수, num(r.편입면적), pct(r.비율), '']),
    ]),
  ].join('\n\n');
  const ownerMd = [
    owners.length
      ? `∙ ${facName} 내 소유별 분포현황은 총 ${agg.합계.필지수}필지로 이루어져 있으며, 전체면적 ${num(total)}㎡ 중 ${owners.map((r) => `${r.소유구분}는 ${num(r.편입면적)}㎡(${pct(r.비율)}%)`).join(', ')}를 차지하고 있음${unknownText}`
      : `∙ ${facName} 내 소유별 분포현황은 총 ${agg.합계.필지수}필지로 이루어져 있음${unknownText}`,
    '소유별 면적 및 비율',
    table(['구 분', '필지수(개소)', '면 적(㎡)', '비 율(%)', '비 고'], [
      ['합 계', agg.합계.필지수, num(total), '100.0', ''],
      ...agg.소유자별.map((r) => [r.소유구분, r.필지수 || '-', r.필지수 ? num(r.편입면적) : '-', r.필지수 ? pct(r.비율) : '-', r.소유구분 === '사유지' ? '' : ownerNames(r.소유구분)]),
    ]),
  ].join('\n\n');
  return { jimokMd, ownerMd, warnings: agg.warnings };
}

/** 시설 하나의 현황분석 절 */
function facilitySection(ctx, fac, i, parcels, notes) {
  const name = (fac.명칭 && fac.명칭.value) || fac.id;
  const L = [`### ${GANA[i] || i + 1}. ${name}`];
  const statusDoc = ctx.docs.find((d) => d.role === 'status' && d.facilityId === fac.id);
  if (statusDoc && statusDoc.note) notes.push(`${name} 현황분석: 「${statusDoc.docId}」 — ${statusDoc.note}`);

  // 대상 절 id `pkg.4.3:<시설>:<하위>` 에 배정된 현황분석 보고서 절
  const pick = (sub) => {
    const a = ctx.mapping.assignments.find((x) => x.targetId === `pkg.4.3:${fac.id}:${sub}`);
    if (!a) return null;
    const doc = ctx.docs.find((d) => d.docId === a.docId);
    const node = doc && doc.outline.nodes.find((n) => n.id === a.nodeId);
    return node ? { doc, node } : null;
  };
  const missing = (title) => `[작성 필요: ${name} ${title} — ${statusDoc ? '현황분석 보고서에서 찾지 못함' : '현황분석 보고서가 등록되지 않음'}]`;
  const body = (sub, title, level, depth) => {
    const p = pick(sub);
    return p ? transplant(p.doc, p.node, { level, depth, index: 0, noHeading: true }) : missing(title);
  };

  const loc = body('loc', '광역입지여건(위치 및 면적)', 4, 1);
  L.push('#### 1) 광역입지여건 분석', loc);
  // 현황분석 보고서의 위치·면적이 설계보고서 위치·편입토지 합계와 맞는지
  const ps = parcels[fac.id] || [];
  const locMatch = /위치\s*:\s*(.+)/.exec(loc);
  const areaMatch = /면적\s*:\s*([\d,.]+)\s*㎡/.exec(loc);
  const jibun = fac.위치 && fac.위치.주소 ? fac.위치.주소.jibun : null;
  if (locMatch && jibun && !locMatch[1].replace(/\s+/g, '').includes(`${jibun}번지`) && !locMatch[1].replace(/\s+/g, '').endsWith(jibun)) {
    notes.push(`${name} 위치: 현황분석 보고서는 '${locMatch[1].trim()}', 설계보고서는 '${fac.위치.value}'입니다. 대표 지번을 확인하세요.`);
  }
  if (areaMatch && ps.length) {
    const rep = Number(areaMatch[1].replace(/,/g, ''));
    const sum = aggregate(ps).합계.편입면적;
    if (Math.abs(rep - sum) > Math.max(1, rep * 0.005)) notes.push(`${name} 면적: 현황분석 보고서 ${num(rep)}㎡, 편입토지 합계 ${num(sum)}㎡로 다릅니다. 결정조서는 편입토지 합계를 씁니다.`);
  }

  L.push('#### 2) 자연환경');
  // 현황분석 도구가 수치표고(DEM) 없이 돌면 표고·경사 표가 모두 0 이 된다 → 0 표 대신 [작성 필요]
  const zeroTotal = (md) => /합계<\/td><td>0<\/td>|\| 합계 \| 0 \|/.test(md);
  for (const [sub, title, mark] of [['elev', '표고분석', '가)'], ['slope', '경사분석', '나)']]) {
    let md = body(sub, title, 5, 2);
    if (zeroTotal(md)) {
      md = `[작성 필요: ${name} ${title} — 현황분석 보고서에 수치표고(DEM) 자료가 없어 값이 0으로 나옴. DEM 을 넣어 현황분석 도구를 다시 돌리거나 지형도로 작성]`;
      notes.push(`${name} ${title}: 현황분석 보고서의 값이 모두 0이라(수치표고 자료 없음) 넣지 않고 [작성 필요]로 두었습니다.`);
    }
    L.push(`##### ${mark} ${title}`, md);
  }
  L.push('##### 다) 생태자연도', body('eco', '생태자연도', 5, 2));
  L.push('#### 3) 인문환경');
  if (ps.length) {
    const t = parcelTables(ps, name);
    L.push('##### 가) 지목별현황', t.jimokMd, '##### 나) 소유별현황', t.ownerMd);
    notes.push(`${name} 지목별·소유별 현황: 편입토지 ${ps.length}필지 집계(결정조서와 같은 면적)로 만들었습니다.${pick('jimok') ? ' 현황분석 보고서의 지목별·소유자 현황 절은 쓰지 않았습니다.' : ''}`);
    t.warnings.forEach((w) => notes.push(`${name} 편입토지: ${w}`));
  } else {
    L.push('##### 가) 지목별현황', body('jimok', '지목별 현황', 5, 2), '##### 나) 소유별현황', body('owner', '소유자 현황', 5, 2));
  }
  L.push('##### 다) 도시관리계획 지정현황');
  L.push('###### (1) 용도지역 현황', body('zone', '용도지역 현황', 6, 3));
  L.push('###### (2) 용도지구 현황', body('district', '용도지구 현황', 6, 3));
  L.push('#### 4) 현황종합분석', body('summary', '현황종합', 4, 1));
  return L.join('\n\n');
}

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildStatusChapter(ctx) {
  const vars = ctx.narrative.vars;
  const notes = [];
  const L = [];
  const ch = buildToc(ctx.template, vars, 'pkg').chapters.find((c) => c.id === 'pkg.4');
  L.push(`# ${ch.number}. ${ch.title}`);
  L.push(ch.children.map((c) => `${c.number}. ${c.title}`).join('<br>'));

  L.push('## 1. 일반 현황', designSection(ctx, 'pkg.4.1', notes));
  L.push('## 2. 인문·사회현황', designSection(ctx, 'pkg.4.2', notes));

  L.push('## 3. 계획대상지 현황분석');
  const facilities = ctx.facts.facilities || [];
  const warn = [];
  const parcels = splitParcels(facilities, ctx.parcels, warn);
  warn.forEach((w) => notes.push(`편입토지: ${w}`));
  if (!facilities.length) L.push('[작성 필요: 계획대상지 현황분석 — 시설을 찾지 못함]');
  facilities.forEach((f, i) => L.push(facilitySection(ctx, f, i, parcels, notes)));
  if (!ctx.docs.some((d) => d.role === 'status')) notes.push('현황분석 보고서가 하나도 등록되지 않았습니다. project.json "status" 에 시설별로 넣으세요({"file": "...", "facility": "교동배수지"}).');
  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildStatusChapter, parcelTables };
