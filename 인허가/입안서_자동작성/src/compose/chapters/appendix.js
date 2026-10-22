'use strict';
// Ⅵ. 기초자료 조사서: 간지 → 환경성·교통성·경관성 검토서를 차례로(샘플은 검토서 3권을 표지째 이 장에 묶는다).
//   검토서 장(env·traffic·landscape)이 만들어져 있으면 그 내용을 그대로 넣고, 아직이면 [작성 필요] 로 자리만.
// Ⅷ. 첨부서류: 간지 → ▣ 배수지 설계도 → 시설마다 '- 설계도면 -'(project.json designs 그림 또는 [외부 자료 필요]).

const { buildToc } = require('../toc');

const REVIEWS = [
  { id: 'env', title: '환경성 검토서' },
  { id: 'traffic', title: '교통성 검토서' },
  { id: 'landscape', title: '경관성 검토서' },
];

/** 장 머리 간지: '# Ⅵ. 기초자료 조사서' + 절 목록 */
function divider(ctx, id) {
  const ch = buildToc(ctx.template, ctx.narrative.vars, 'pkg').chapters.find((c) => c.id === id);
  return [`# ${ch.number}. ${ch.title}`, ch.children.map((c) => `${/^\d+$/.test(c.number) ? `${c.number}.` : c.number} ${c.title}`).join('<br>')];
}

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildSurveyChapter(ctx) {
  const { BUILDERS } = require('./index'); // 검토서 조립기(나중에 등록되는 것 포함)를 실행할 때 찾는다
  const notes = [];
  const L = divider(ctx, 'pkg.6');
  REVIEWS.forEach((r, i) => {
    const build = BUILDERS[r.id];
    if (build) {
      const out = build(ctx, { id: r.id, title: r.title });
      L.push(typeof out === 'string' ? out : out.markdown);
      notes.push(`${i + 1}. ${r.title}: '${r.title}' 장 내용을 넣었습니다.`);
    } else {
      L.push(`## ${i + 1}. ${r.title}`, `[작성 필요: ${r.title} — '${r.title}' 장을 만들면 이 자리에 표지째 들어감]`);
      notes.push(`${i + 1}. ${r.title}: 검토서 장이 아직 없어 자리만 두었습니다.`);
    }
    if (i < REVIEWS.length - 1) L.push('---');
  });
  return { markdown: L.join('\n\n'), notes };
}

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildAttachmentChapter(ctx) {
  const notes = [];
  const L = divider(ctx, 'pkg.8');
  L.push('## ▣ 배수지 설계도');
  const designs = (ctx.attachments && ctx.attachments.designs) || {};
  for (const f of ctx.facts.facilities || []) {
    const name = (f.명칭 && f.명칭.value) || f.id;
    L.push(`### ${name}`, '**- 설계도면 -**'); // 줄머리 '-' 는 목록으로 읽히므로 굵게
    if (designs[f.id]) L.push(`![${name} 설계도면](${designs[f.id]})`);
    else {
      L.push(`[외부 자료 필요: ${name} 설계도면]`);
      notes.push(`${name} 설계도면이 없습니다. project.json 에 "designs": {"${f.id}": "그림 파일 경로"} 를 넣으면 들어갑니다(여러 장이면 HWPX 출력 때 묶음).`);
    }
  }
  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildSurveyChapter, buildAttachmentChapter, REVIEWS };
