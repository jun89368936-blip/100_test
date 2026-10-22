'use strict';
// 입안서 장: 제목 → ■ 입안사유 → ■ 입안내용(위치·목표연도·시설면적·결정 조서) → ■ 사업의 기대효과 → 도서 별첨 → 날짜·신청자.
// 샘플(교동·삼산 입안신청서 2쪽)과 같은 순서·문구를 따른다.

const { fillTemplate } = require('../../plan/narrative');
const { decisionTableHtml } = require('../../plan/decision');

const need = (name) => `[작성 필요: ${name}]`;
const num = (n) => Math.round(n).toLocaleString('en-US');
const val = (f) => (f && !f.missing && f.value != null ? f.value : null);

/** '강화군' → '강화', '수원시' → '수원' (샘플: '강화 군관리계획') */
const shortSigungu = (s) => (s ? String(s).replace(/(군|시|구)$/, '') : null);

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildApplication(ctx) {
  const { facts, decision, narrative } = ctx;
  const vars = narrative.vars;
  const fill = (t) => fillTemplate(t, vars).text;
  const notes = [];
  const L = [];

  L.push(`# ${fill('{{계획}}(시설: {{시설군}}) 결정({{결정구분}}) 입안서')}`);

  // ■ 입안사유
  const reason = narrative.sections.reason;
  L.push('### ■ 입안사유');
  reason.paragraphs.forEach((p) => L.push(`○ ${p}`));
  notes.push(`입안사유: 문안 라이브러리(${reason.source.pack}/${reason.source.entry})${reason.missing.length ? ` — 채울 값: ${reason.missing.join(', ')}` : ''}`);

  // ■ 입안내용
  L.push('### ■ 입안내용');
  const rows = decision.rows;
  const facilities = facts.facilities || [];
  const locLines = rows.map((r) => {
    const f = facilities.find((x) => x.id === r.id);
    return `${r.이름} – ${val(f && f.위치) || need(`${r.이름} 위치`)}`;
  });
  L.push(`1. 위 치 : ${locLines.length ? locLines.join('<br>') : need('위치')}`);
  L.push(`2. 목표연도 : ${vars.목표연도 ? `${vars.목표연도}년` : need('목표연도')}`);
  L.push(`3. 시설면적 :\n${rows.length ? rows.map((r) => `- ${r.이름} : A = ${r.면적.변경후 == null ? need('면적') : `${num(r.면적.변경후)}㎡`}`).join('\n') : `- ${need('시설면적')}`}`);
  const area = shortSigungu(vars.시군구);
  L.push(`4. ${area ? `${area} ` : ''}${fill('{{계획}}(시설: {{시설군}}) 결정(안)')}`);
  L.push(`가. ${fill('{{시설용어}}({{시설군}}: {{시설종류}}) 결정({{결정구분}}) 조서')}`);
  L.push(decisionTableHtml(decision));
  if (decision.warnings.length) notes.push(...decision.warnings.map((w) => `결정조서: ${w}`));

  // ■ 사업의 기대효과
  const effect = narrative.sections.effect;
  L.push('### ■ 사업의 기대효과');
  if (effect.intro) L.push(`○ ${effect.intro}`);
  effect.items.forEach((t) => L.push(`∙ ${t}`));
  notes.push(effect.source.kind === 'design'
    ? `기대효과: 설계보고서 「${effect.source.docId}」 › ${effect.source.section} 문장을 썼습니다(라이브러리 문안을 쓰려면 project.json 에 "prefer": {"effect": "library"}).`
    : `기대효과: 문안 라이브러리(${effect.source.pack}/${effect.source.entry})`);

  L.push(`### ■ ${fill('{{계획}}(시설: {{시설군}}) 결정(안)')} 도서 : 별첨`);
  L.push(vars.작성일 || need('작성일'));
  L.push(`# ${vars.입안신청자 || vars.시행자 || need('입안신청자(시행자)')}`);

  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildApplication, shortSigungu };
