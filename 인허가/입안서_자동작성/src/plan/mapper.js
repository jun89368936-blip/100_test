'use strict';
// 입안서류 골격(templates/*.json)의 각 절에 원본 보고서의 알맞은 절을 하나(multi 는 여러 개) 배정한다.

const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'templates');
const FROM_SOURCE = new Set(['design', 'status']); // 원본 보고서에서 찾는 절

function loadTemplate(name = 'water-supply') {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.json`), 'utf8'));
}

/**
 * 시설별 반복(repeat: 'facility') 절을 시설마다 풀어 쓴다.
 * 반복 절의 하위 절 id 는 `<부모id>:<시설id>:<하위id>` 가 된다.
 * @returns {object[]} 평탄한 대상 절 목록 [{id,docId,path,number,title,source,match,...,facilityId?}]
 */
function expandTemplate(template, facilities = []) {
  const out = [];
  const facIds = facilities.map((f) => (typeof f === 'string' ? f : f.id));
  const visit = (t, docId, trail, ctx) => {
    const base = { ...t, docId, trail: trail.concat(t.title), children: undefined };
    if (t.repeat === 'facility' && !ctx.facilityId) {
      if (!facIds.length) { out.push({ ...base, id: t.id, needsFacility: true }); return; }
      for (const fid of facIds) {
        const label = `${fid}`;
        if (t.children && t.children.length) {
          out.push({ ...base, id: `${t.id}:${fid}`, source: 'container', facilityId: fid, title: `${t.title} — ${label}` });
          t.children.forEach((c) => visit(c, docId, trail.concat(`${t.title} — ${label}`), { facilityId: fid, parentId: `${t.id}:${fid}` }));
        } else {
          out.push({ ...base, id: `${t.id}:${fid}`, facilityId: fid, title: `${t.title} — ${label}` });
        }
      }
      return;
    }
    const id = ctx.facilityId ? `${ctx.parentId}:${t.id}` : t.id;
    out.push({ ...base, id, facilityId: ctx.facilityId || undefined });
    (t.children || []).forEach((c) => visit(c, docId, trail.concat(t.title), ctx));
  };
  for (const doc of template.documents) doc.targets.forEach((t) => visit(t, doc.id, [doc.title], {}));
  return out;
}

function toRegex(src) {
  return src instanceof RegExp ? src : new RegExp(src);
}

/** 대상 절 하나에 대한 원본 절의 점수. 일치하지 않으면 0 */
function scoreNode(target, node, minScore) {
  if (!target.match || !target.match.length) return 0;
  if (!node.blocks.length && !node.children.length) return 0; // 제목만 있는 빈 절은 쓸모없다
  if (target.exclude && toRegex(target.exclude).test(node.key)) return 0;
  const hasAncestor = (src) => {
    const re = toRegex(src);
    for (let p = node.parent; p && p.level > 0; p = p.parent) if (re.test(p.title) || re.test(p.key)) return true;
    return false;
  };
  if (target.parent && !hasAncestor(target.parent)) return 0;
  if (target.excludeAncestor && hasAncestor(target.excludeAncestor)) return 0;
  if (target.minLevel && node.level < target.minLevel) return 0;
  if (target.maxLevel && node.level > target.maxLevel) return 0;
  let best = 0;
  for (const rule of target.match) {
    if (rule.parent && !hasAncestor(rule.parent)) continue; // 규칙별 상위 절 조건
    const re = toRegex(rule.re);
    const m = re.exec(node.key) || re.exec(node.title);
    if (!m) continue;
    // 제목 전체를 거의 다 덮는 일치일수록 높은 점수(정확 일치 +5), 얕은 절을 약간 선호(+3, +1.5)
    const coverage = Math.min(1, m[0].length / Math.max(node.key.length, 1));
    const s = rule.w + 5 * coverage + 1.5 * Math.max(0, 3 - node.level);
    if (s > best) best = s;
  }
  return best >= minScore ? best : 0;
}

function isAncestor(a, b) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/**
 * @param {{docId:string, role:'design'|'status', name?:string, outline:object, facilityId?:string}[]} outlines
 *   role 'design' 문서는 하나의 보고서로 묶어 장 번호와 무관하게 제목으로 찾는다.
 *   role 'status' 문서는 facilityId 가 있으면 그 시설의 현황분석 보고서이다.
 * @param {object} template  loadTemplate() 결과
 * @param {Object<string,{docId:string,nodeId:string}|null>} [overrides]  대상id → 사용자 지정(null=배정하지 않음)
 * @param {{facilities?:(string|object)[], minScore?:number}} [options]
 */
function mapSections(outlines, template, overrides = {}, options = {}) {
  const minScore = options.minScore != null ? options.minScore : template.minScore || 4;
  const targets = expandTemplate(template, options.facilities || []);
  const warnings = [];
  const nodeOf = new Map(); // `${docId}#${nodeId}` → {doc,node}
  for (const d of outlines) for (const n of d.outline.nodes) nodeOf.set(`${d.docId}#${n.id}`, { doc: d, node: n });

  const assignments = [];
  const taken = []; // {doc, node}
  const conflicts = (doc, node) => taken.some((t) => t.doc.docId === doc.docId && (t.node === node || isAncestor(t.node, node) || isAncestor(node, t.node)));
  const targetDone = new Set();

  // 1) 사용자 지정이 먼저
  for (const [tid, ov] of Object.entries(overrides)) {
    const t = targets.find((x) => x.id === tid);
    if (!t) { warnings.push(`지정한 대상 절 '${tid}' 이(가) 골격에 없습니다.`); continue; }
    targetDone.add(tid);
    if (ov === null) continue;
    const hit = nodeOf.get(`${ov.docId}#${ov.nodeId}`);
    if (!hit) { warnings.push(`'${tid}' 에 지정한 원본 절(${ov.docId} ${ov.nodeId})을 찾지 못했습니다.`); targetDone.delete(tid); continue; }
    assignments.push({ targetId: tid, docId: ov.docId, nodeId: ov.nodeId, nodeNumber: hit.node.number, nodeTitle: hit.node.title, score: Infinity, via: 'override' });
    taken.push(hit);
  }

  // 2) 자동 후보를 점수순으로
  const cands = [];
  targets.forEach((t, ti) => {
    if (!FROM_SOURCE.has(t.source) || targetDone.has(t.id) || !t.match) return;
    outlines.forEach((d, di) => {
      if (d.role !== t.source) return;
      if (t.source === 'status' && t.facilityId && d.facilityId && d.facilityId !== t.facilityId) return;
      // 시설별 절은 그 시설의 현황분석 보고서에서만, 시설과 무관한 절은 시설을 지정하지 않은 보고서에서만 가져온다
      if (t.source === 'status' && t.facilityId && !d.facilityId) return;
      if (t.source === 'status' && !t.facilityId && d.facilityId) return;
      d.outline.nodes.forEach((node, ni) => {
        const s = scoreNode(t, node, minScore);
        if (s > 0) cands.push({ t, ti, d, di, node, ni, s });
      });
    });
  });
  cands.sort((a, b) => b.s - a.s || a.ti - b.ti || a.di - b.di || a.ni - b.ni);
  const assignedAuto = new Set();
  for (const c of cands) {
    if (targetDone.has(c.t.id) && !c.t.multi) continue;
    if (assignedAuto.has(c.t.id) && !c.t.multi) continue;
    if (conflicts(c.d, c.node)) continue;
    assignments.push({ targetId: c.t.id, docId: c.d.docId, nodeId: c.node.id, nodeNumber: c.node.number, nodeTitle: c.node.title, score: Math.round(c.s * 100) / 100, via: 'auto' });
    taken.push({ doc: c.d, node: c.node });
    assignedAuto.add(c.t.id);
  }

  // 3) 못 찾은 절·성격별 목록
  const assigned = new Set(assignments.map((a) => a.targetId));
  const unmatched = [];
  const generated = [];
  for (const t of targets) {
    if (FROM_SOURCE.has(t.source)) {
      if (!assigned.has(t.id) && !(t.id in overrides)) {
        let reason = `${t.source === 'design' ? '설계보고서' : '현황분석 보고서'}에서 해당 내용을 찾지 못함`;
        if (t.source === 'status' && t.facilityId && !outlines.some((d) => d.role === 'status' && d.facilityId === t.facilityId)) reason = `${t.facilityId} 의 현황분석 보고서가 등록되지 않음`;
        unmatched.push({ targetId: t.id, number: t.number, title: t.title, trail: t.trail, source: t.source, reason });
      }
    } else if (t.source !== 'container') {
      generated.push({ targetId: t.id, number: t.number, title: t.title, trail: t.trail, source: t.source });
    }
  }
  return { assignments, unmatched, generated, targets, warnings };
}

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

function mappingToJson(result) {
  return {
    assignments: result.assignments.map((a) => ({ ...a, score: a.score === Infinity ? 'override' : a.score })),
    unmatched: result.unmatched,
    generated: result.generated,
    warnings: result.warnings,
  };
}

/** 사람이 읽는 마크다운 표 */
function mappingToMarkdown(result) {
  const byId = new Map(result.targets.map((t) => [t.id, t]));
  const L = [];
  L.push('## 대상 절 ← 원본 절');
  L.push('');
  L.push('| 입안서류 절 | 원본 | 원본 절 | 점수 | 방식 |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const a of result.assignments) {
    const t = byId.get(a.targetId);
    const name = `${t.number ? `${t.number}. ` : ''}${t.title}`;
    L.push(`| ${t.trail.slice(1, -1).concat(name).join(' › ')} | ${a.docId} | ${a.nodeNumber ? `${a.nodeNumber} ` : ''}${a.nodeTitle} | ${a.score === Infinity ? '지정' : a.score} | ${a.via === 'override' ? '사용자 지정' : '자동'} |`);
  }
  L.push('');
  L.push(`## 못 찾은 절 (${result.unmatched.length})`);
  L.push('');
  if (!result.unmatched.length) L.push('없음');
  for (const u of result.unmatched) L.push(`- ${u.trail.slice(1).join(' › ')} — ${u.reason}`);
  L.push('');
  L.push(`## 자동 생성·외부 자료 절 (${result.generated.length})`);
  L.push('');
  for (const g of result.generated) L.push(`- ${g.trail.slice(1).join(' › ')} — ${g.source === 'external' ? '[외부 자료 필요]' : g.source === 'library' ? '문안 라이브러리' : '자동 생성'}`);
  if (result.warnings.length) { L.push(''); L.push('## 경고'); L.push(''); result.warnings.forEach((w) => L.push(`- ${w}`)); }
  return L.join('\n');
}

module.exports = { loadTemplate, expandTemplate, mapSections, mappingToJson, mappingToMarkdown, scoreNode };
