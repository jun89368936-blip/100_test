'use strict';
// 표지 4종(입안신청서·환경성검토서·교통성검토서·경관성검토서). 샘플 0_표지(완)-교동 삼산배수지.hwp 와 같은 줄 구성:
//   강화 군관리계획(시설: 수도공급설비)결정 / 문서 이름 / - 사업명 - / 날짜 / (로고)
// 표지 사이는 '---'(쪽 나눔).

const { fillTemplate } = require('../../plan/narrative');
const { shortSigungu } = require('./application');

const DOCS = ['입안신청서', '환경성검토서', '교통성검토서', '경관성검토서'];

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildCover(ctx) {
  const vars = ctx.narrative.vars;
  const notes = [];
  const area = shortSigungu(vars.시군구);
  const head = `${area ? `${area} ` : ''}${fillTemplate('{{계획}}(시설: {{시설군}})결정', vars).text}`;
  const name = vars.표지사업명 || vars.사업명 || '[작성 필요: 사업명]';
  const date = vars.표지일자 || vars.작성일 || '[작성 필요: 표지일자]';
  const logo = ctx.attachments && ctx.attachments.logo;
  const covers = DOCS.map((doc) => [
    `### ${head}`,
    `# ${doc}`,
    `### - ${name} -`,
    date,
    logo ? `![로고](${logo})` : '',
  ].filter(Boolean).join('\n\n'));
  if (!vars.표지일자 && !vars.작성일) notes.push('표지 날짜: project.json vars 에 "표지일자"(예: "2025. 12") 또는 "작성일"을 넣으세요.');
  if (!vars.표지사업명) notes.push(`표지 사업명은 '${name}'입니다. 표지에만 다르게 쓰려면 vars.표지사업명(예: "교동·삼산 배수지 건설공사").`);
  if (!logo) notes.push('표지 로고(발주처 상징)는 project.json "logo": "그림 파일" 로 넣으면 표지마다 들어갑니다.');
  return { markdown: covers.join('\n\n---\n\n'), notes };
}

module.exports = { buildCover, COVER_DOCS: DOCS };
