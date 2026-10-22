'use strict';
// Ⅱ. 계획의 개요 장: 간지 → 1. 계획의 개요(가 명칭·나 시행자·다 결정권자·라 범위·마 목적(+위치도)·바 내용적 범위) → 2. 계획의 수립절차.
// 샘플 Ⅱ장과 같은 순서. 샘플은 '다.'가 두 번 나오는 번호 오기가 있어 가~바로 바로잡았다.

const { fillTemplate, findDesignSection } = require('../../plan/narrative');
const { buildToc } = require('../toc');
const { imageRef, imagesIn } = require('../md');

const need = (name) => `[작성 필요: ${name}]`;
const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)].join('\n');

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildPlanChapter(ctx) {
  const { narrative, facts } = ctx;
  const vars = narrative.vars;
  const fill = (t) => fillTemplate(t, vars).text;
  const notes = [];
  const L = [];

  const ch = buildToc(ctx.template, vars, 'pkg').chapters.find((c) => c.id === 'pkg.2');
  L.push(`# ${ch.number}. ${ch.title}`);
  L.push(ch.children.map((c) => `${c.number}. ${c.title}`).join('<br>'));

  L.push('## 1. 계획의 개요');
  L.push('### 가. 계획의 명칭', `∙ 사업명 : ${vars.사업명 || need('사업명')}`);
  L.push('### 나. 계획시행자', `∙ 시행자 : ${vars.시행자 || need('시행자')}`);
  L.push(`### 다. ${fill('{{계획}}(시설: {{시설군}}) 결정권자')}`,
    `∙ 결정권자 : ${vars.결정권자 || need('결정권자')}<br>∙ 주 소 : ${vars.결정권자주소 || need('결정권자주소')}`);
  const auth = facts.fields && facts.fields.결정권자;
  if (auth && auth.derived && narrative.varSources.결정권자 !== 'user') {
    notes.push(`결정권자 '${vars.결정권자}'는 지자체 이름으로 추정한 값입니다. 광역시의 군은 광역시장이 결정할 수 있으니 확인하고 project.json vars.결정권자 에 넣으세요.`);
  }

  // 라. 계획의 범위
  const scope = narrative.sections.scope;
  L.push('### 라. 계획의 범위');
  L.push('∙ 공간적 범위', table(['구 분', '위 치', '면적(㎡)', '비고'], scope.space.map((r) => [r.구분, r.위치, r.면적, ''])));
  L.push('∙ 시간적 범위', scope.time.map((t) => `- ${t}`).join('\n'));

  // 마. 계획의 목적 (+ 위치도)
  const purpose = narrative.sections.purpose;
  L.push('### 마. 계획의 목적');
  purpose.paragraphs.forEach((p) => L.push(`∙ ${p}`));
  notes.push(purpose.source.kind === 'design'
    ? `계획의 목적: 설계보고서 「${purpose.source.docId}」 › ${purpose.source.section} 문장을 그대로 썼습니다(보고서 문체 '~하였다'). 입안서 문체('~함')로 다듬을지 확인하세요.`
    : `계획의 목적: 문안 라이브러리(${purpose.source.pack}/${purpose.source.entry})${purpose.missing.length ? ` — 채울 값: ${purpose.missing.join(', ')}` : ''}`);
  const designOutlines = ctx.outlines.filter((o) => o.role === 'design');
  const loc = findDesignSection(designOutlines, /과업\s*대상\s*지역|사업\s*대상\s*지|위치도/);
  const locDoc = loc && ctx.docs.find((d) => d.docId === loc.docId);
  const pics = locDoc ? imagesIn(locDoc, loc.node) : [];
  L.push('< 위치도 >');
  if (pics.length) {
    pics.forEach((n) => L.push(`![위치도](${imageRef(loc.docId, n)})`));
    notes.push(`위치도: 설계보고서 「${loc.docId}」 › ${loc.node.title} 의 그림 ${pics.length}개`);
  } else {
    L.push('[외부 자료 필요: 위치도]');
  }

  // 바. 내용적 범위
  L.push('### 바. 내용적 범위', table(['항 목', '내용적 범위'], scope.content.map((c) => [c.구분, c.항목.map((h) => `⦁ ${h}`).join('\n')])));

  // 2. 계획의 수립절차
  const proc = narrative.sections.procedure;
  L.push('## 2. 계획의 수립절차');
  L.push(table(['단 계', '주 체', '내 용'], proc.steps.map((s, i) => [`${i + 1}. ${s.단계}`, s.주체, s.내용.map((l) => (l.startsWith('-') ? l : `∙ ${l}`)).join('\n')])));
  if (proc.reviewNote) notes.push(`수립절차: ${proc.reviewNote}`);
  const own = ['사업명', '시행자', '결정권자', '결정권자주소'].filter((k) => !vars[k]);
  const missing = [...new Set([...own, ...scope.missing, ...proc.missing])];
  if (missing.length) notes.push(`채울 값(project.json vars): ${missing.join(', ')}`);

  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildPlanChapter };
