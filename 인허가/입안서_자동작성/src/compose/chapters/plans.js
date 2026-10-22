'use strict';
// Ⅲ. 상위 및 관련계획 검토 장: 간지 → 1. 상위계획 검토 → 2. 관련계획 검토 → 3. 관련법규 검토(+ 기초조사 항목 검토 표).
// 절마다 설계보고서에서 배정된 절이 있으면 번호를 입안서 체계로 다시 매겨 옮기고, 없으면 문안 라이브러리 + [작성 필요] 로 채운다.

const { buildToc } = require('../toc');
const { transplant, trimSection } = require('../md');

const GANA = '가나다라마바사아자차카타파하';
const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)].join('\n');
const num = (n) => Math.round(n).toLocaleString('en-US');

/** 같은 계획을 두 번 옮기지 않게 비교하는 열쇠: '2040 인천시 수도정비기본계획(2022. 06)' → '2040인천수도정비기본계획' */
function planKey(title) {
  return String(title)
    .replace(/\([^)]*\)/g, '')
    .replace(/([가-힣]+?)(특별시|광역시|시)(?=\s)/g, '$1')
    .replace(/[\s·・ㆍ]/g, '');
}

/** 대상 절에 배정된 원본 절들(점수순 → 문서 순서), 같은 계획은 하나만 */
function assignedNodes(ctx, targetId, notes) {
  const seen = new Set();
  const out = [];
  // 보고서 순서(문서 순서 → 문서 안 절 순서)로 옮긴다
  const found = ctx.mapping.assignments.filter((x) => x.targetId === targetId).map((a) => {
    const di = ctx.docs.findIndex((d) => d.docId === a.docId);
    const doc = ctx.docs[di];
    const ni = doc ? doc.outline.nodes.findIndex((n) => n.id === a.nodeId) : -1;
    return { a, doc, node: ni >= 0 ? doc.outline.nodes[ni] : null, di, ni };
  }).filter((x) => x.node).sort((x, y) => x.di - y.di || x.ni - y.ni);
  for (const { a, doc, node } of found) {
    const k = planKey(node.title);
    if (seen.has(k)) { notes.push(`'${node.title}'(「${a.docId}」)는 이미 옮긴 계획과 같아서 뺐습니다.`); continue; }
    seen.add(k);
    out.push({ doc, node, a });
  }
  return out;
}

/**
 * 기초조사 항목 검토 표. 시설별 용도지역 판정(ctx.zoning)으로 토지적성평가·재해취약성분석·환경영향평가를 채우고,
 * 용도지역을 모르는 시설이 있으면 그 시설만 [작성 필요].
 */
function basicSurveyRows(ctx) {
  const areas = ctx.decision.rows.map((r) => r.면적.변경후).filter((a) => a != null);
  const max = areas.length ? Math.max(...areas) : null;
  const law27 = '「국토의 계획 및 이용에 관한 법률」제27조';
  const law21 = '「국토의 계획 및 이용에 관한 법률」<br>시행령 제21조 및 동법 제55조';
  const facs = (ctx.zoning && ctx.zoning.facilities) || [];
  const need = (f, what) => `${f.name}: [작성 필요: ${what} — 용도지역 면적을 모름]`;
  const zoneText = (rows) => rows.map((r) => `${r.zone} ${num(r.area)}㎡`).join(', ');
  // 판정 기호: 모두 아는데 하나라도 해당하면 ○, 모두 아니면 ☓, 모르는 시설이 있으면 [작성 필요]
  const mark = (key, isTarget) => {
    if (!facs.length || facs.some((f) => !f[key])) return facs.some((f) => f[key] && isTarget(f[key])) ? '○' : '[작성 필요]';
    return facs.some((f) => isTarget(f[key])) ? '○' : '☓';
  };
  const exemptNote = facs.length
    ? facs.map((f) => (f.exempt ? `${f.name}: ${zoneText(f.exempt.rows)} — 용도지역별 개발행위규모 ${f.exempt.ok ? '미만으로 대상 제외' : '이상으로 대상'}` : need(f, '대상 판정'))).join('<br>')
    : '[작성 필요: 용도지역 확인 — 관리지역 내 30,000㎡ 미만이면 대상 제외]';
  const eiaNote = facs.length
    ? facs.map((f) => (f.eia
      ? `${f.name}: ${zoneText(f.eia.rows)}${f.eia.rows.length > 1 ? ` 산출수치 ${f.eia.index.toFixed(2)}` : ''}로 소규모환경영향평가 ${f.eia.target ? '대상 사업' : '대상 아님'}`
      : need(f, '소규모환경영향평가 판정'))).join('<br>')
    : '[작성 필요: 용도지역별 면적으로 소규모환경영향평가 대상 판정]';
  return [
    ['환경성검토서', law27, '○', '환경성검토 대상'],
    ['경관성검토서', law27, '○', '경관성검토 대상'],
    ['교통성검토서', law27, '○', '교통성검토 대상'],
    ['토지적성평가', law21, mark('exempt', (x) => !x.ok), exemptNote],
    ['재해취약성분석', law21, mark('exempt', (x) => !x.ok), exemptNote],
    ['환경영향평가', '「환경영향평가법」제43조,<br>시행령 제59조 및 별표 4', mark('eia', (x) => x.target), eiaNote],
    ['재해영향평가', '「자연재해대책법」시행령 제6조', max == null ? '[작성 필요]' : (max >= 5000 ? '○' : '☓'),
      max == null ? '[작성 필요: 시설면적]' : (max >= 5000 ? '사업면적 5천㎡ 이상으로 재해영향평가 대상' : '사업면적 5천㎡ 미만')],
  ];
}

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildPlansChapter(ctx) {
  const { narrative } = ctx;
  const vars = narrative.vars;
  const notes = [];
  const L = [];

  const ch = buildToc(ctx.template, vars, 'pkg').chapters.find((c) => c.id === 'pkg.3');
  L.push(`# ${ch.number}. ${ch.title}`);
  L.push(ch.children.map((c) => `${c.number}. ${c.title}`).join('<br>'));

  // 1. 상위계획 검토
  L.push('## 1. 상위계획 검토');
  const upper = assignedNodes(ctx, 'pkg.3.1', notes);
  const related = assignedNodes(ctx, 'pkg.3.2', notes);
  if (upper.length) {
    upper.forEach((u, i) => L.push(transplant(u.doc, u.node, { level: 3, index: i })));
    notes.push(`상위계획: 설계보고서 ${upper.map((u) => `「${u.a.docId}」 › ${u.node.title}`).join(', ')}`);
  } else {
    // 수도정비기본계획을 관련계획에서 옮기면 상위계획 머리글에서는 뺀다(샘플도 관련계획에 둠)
    const relatedKeys = related.map((r) => planKey(r.node.title)).join('|');
    const plans = narrative.sections.upper.plans.filter((p) => !(/수도정비/.test(p.계획) && /수도정비/.test(relatedKeys)));
    plans.forEach((p, i) => {
      L.push(`### ${GANA[i]}. ${p.계획}`, p.문단, `[작성 필요: ${p.계획} 본문 — 계획서에서 이 사업과 관련된 내용을 옮김]`);
    });
    notes.push('상위계획: 설계보고서에 상위계획 검토 절이 없어 문안 라이브러리의 머리글만 넣었습니다. 국토종합계획·도시기본계획 본문은 계획서에서 옮겨야 합니다.');
  }

  // 2. 관련계획 검토
  L.push('## 2. 관련계획 검토');
  if (related.length) {
    // 템플릿 keep 규칙으로 입안서에 필요한 부분만 남긴다. project.json "trim": {"pkg.3.2": false} 면 통째로 옮긴다
    const target = ctx.mapping.targets.find((t) => t.id === 'pkg.3.2');
    const trimOn = target && target.keep && !(ctx.project.trim && ctx.project.trim['pkg.3.2'] === false);
    const names = (ctx.facts.facilities || []).map((f) => (f.명칭 && f.명칭.value) || f.id);
    related.forEach((r, i) => {
      let node = r.node;
      if (trimOn) {
        const t = trimSection(r.node, target.keep, names);
        if (t.node) {
          node = t.node;
          notes.push(`관련계획 「${r.node.title}」: 남김 — ${t.kept.join(', ')} / 뺌 — ${t.dropped.join(', ') || '없음'}`);
        } else {
          notes.push(`관련계획 「${r.node.title}」: 남길 절(목적·범위·기본방침·시설계획)을 찾지 못해 통째로 옮겼습니다.`);
        }
      }
      L.push(transplant(r.doc, node, { level: 3, index: i }));
    });
    notes.push(trimOn
      ? `관련계획: ${target.keepNote || '필요한 부분만 남겼습니다.'} 전부 옮기려면 project.json 에 "trim": {"pkg.3.2": false}.`
      : `관련계획: 설계보고서 ${related.map((r) => `「${r.a.docId}」 › ${r.node.title}`).join(', ')} 를 통째로 옮겼습니다.`);
  } else {
    L.push('[작성 필요: 관련계획 검토 — 설계보고서에서 해당 내용을 찾지 못함]');
  }

  // 3. 관련법규 검토
  L.push('## 3. 관련법규 검토');
  const lawsFrom = assignedNodes(ctx, 'pkg.3.3', notes);
  if (lawsFrom.length) {
    lawsFrom.forEach((r, i) => L.push(transplant(r.doc, r.node, { level: 3, index: i })));
    notes.push(`관련법규: 설계보고서 「${lawsFrom[0].a.docId}」 › ${lawsFrom[0].node.title}`);
  } else {
    const laws = narrative.sections.laws;
    laws.laws.forEach((l, i) => {
      L.push(`### ${GANA[i]}. ${l.법령}`, table(['검토항목', '검토 내용(요지)', '검토 결과'], l.rows.map((r) => [r.항목, r.요지, r.결과])));
    });
    notes.push(`관련법규: 문안 라이브러리(${laws.source.pack}/${laws.source.entry}). ${laws.reviewNote || ''}`);
    if (laws.missing.length) notes.push(`채울 값(project.json vars): ${laws.missing.join(', ')}`);
  }
  L.push('### 기초조사 항목 검토', table(['기초조사 항목', '관련법령', '대상여부', '비 고'], basicSurveyRows(ctx)));
  for (const f of (ctx.zoning && ctx.zoning.facilities) || []) {
    notes.push(f.zones
      ? `${f.name} 용도지역: ${Object.entries(f.zones).map(([z, a]) => `${z} ${num(a)}㎡`).join(', ')} (${f.source})로 관련법규 판정을 채웠습니다.`
      : `${f.name} 용도지역을 몰라 관련법규 판정을 [작성 필요]로 두었습니다. 현황분석 보고서를 연결하거나 project.json "zones": {"${f.id}": {"계획관리지역": 면적}} 로 넣으세요.`);
  }
  if (ctx.zoning && ctx.zoning.ordinance) notes.push(`개발행위허가 규모는 ${ctx.zoning.ordinance} 값을 썼습니다(관리지역·농림지역). 현행 조례로 확인하세요.`);

  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildPlansChapter, planKey, assignedNodes, table };
