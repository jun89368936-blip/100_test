'use strict';
// Ⅰ. 결정(안) 장: 간지(장 제목·절 목록) → '강화 군관리계획(시설: …) 결정(안)'
// → 1. 결정 조서 및 사유서(시설 종류별 '가. 수도공급설비(배수지)' 마다 조서 표 + ▣ 결정(변경) 사유서 표)
// → 2. 결정(안)도: 시설마다 그림(project.json drawings) 또는 [외부 자료 필요].

const { fillTemplate } = require('../../plan/narrative');
const { subsetDecision, decisionTableHtml, reasonTableHtml } = require('../../plan/decision');
const { buildToc } = require('../toc');
const { shortSigungu } = require('./application');

const GANA = '가나다라마바사아자차카타파하';

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildDecisionChapter(ctx) {
  const { decision, narrative } = ctx;
  const vars = narrative.vars;
  const fill = (t) => fillTemplate(t, vars).text;
  const notes = [];
  const L = [];

  // 간지: 목차와 같은 장 제목·절 목록
  const ch = buildToc(ctx.template, vars, 'pkg').chapters.find((c) => c.id === 'pkg.1');
  L.push(`# ${ch.number}. ${ch.title}`);
  L.push(ch.children.map((c) => `${c.number}. ${c.title}`).join('<br>'));

  const area = shortSigungu(vars.시군구);
  L.push(`## ${area ? `${area} ` : ''}${fill('{{계획}}(시설: {{시설군}}) 결정(안)')}`);

  // 1. 결정 조서 및 사유서 — 시설 종류별로 표를 나눈다
  L.push(`### 1. ${fill('{{계획}}(시설: {{시설군}}) 결정 조서 및 사유서')}`);
  const groups = [];
  for (const r of decision.rows) {
    const key = `${r.시설군 || '시설'}(${r.종류 || '시설'})`;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, ids: [] }; groups.push(g); }
    g.ids.push(r.id);
  }
  if (!groups.length) L.push('[작성 필요: 결정 조서 — 시설을 찾지 못함]');
  groups.forEach((g, i) => {
    const sub = subsetDecision(decision, g.ids);
    L.push(`#### ${GANA[i] || i + 1}. ${g.key}`);
    L.push(decisionTableHtml(sub));
    L.push('▣ 결정(변경) 사유서');
    L.push(reasonTableHtml(sub));
  });
  if (decision.warnings.length) notes.push(...decision.warnings.map((w) => `결정조서: ${w}`));
  notes.push(`결정사유 문구는 시설군별 기본 문구입니다: '${decision.reasons[0] ? decision.reasons[0].결정사유 : '-'}'. 바꾸려면 decision.js 의 reasonFor 를 고치거나 이후 화면에서 직접 고칩니다.`);

  // 2. 결정(안)도
  L.push(`### 2. ${fill('{{계획}} 결정(안)도')} : 첨부도면 별첨`);
  const drawings = (ctx.attachments && ctx.attachments.drawings) || {};
  for (const r of decision.rows) {
    L.push(`#### ${r.이름} 결정(안)도`);
    L.push(fill('{{계획}}(시설: {{시설군}}) 결정(안)도'));
    if (drawings[r.id]) L.push(`![${r.이름} 결정(안)도](${drawings[r.id]})`);
    else {
      L.push(`[외부 자료 필요: ${r.이름} 결정(안)도]`);
      notes.push(`${r.이름} 결정(안)도 그림이 없습니다. project.json 에 "drawings": {"${r.id}": "그림 파일 경로"} 를 넣으면 이 자리에 들어갑니다.`);
    }
  }
  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildDecisionChapter };
