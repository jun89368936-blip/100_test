'use strict';
// Ⅴ. 배수시설 조성계획 장: 절마다 템플릿 parts(가·나·다…에 들어갈 원본 절 목록)를 설계보고서에서 찾아 옮긴다.
// 샘플처럼 1. 계획의 개요(개요·배경 및 목적·계획급수구역) 2. 용수수요량(장래인구·장래용수 수요량) 3. 시설설계(용량·수위·위치 검토)
// 4. 건축계획 5. 부분별계획 6. 사업계획(소요사업비·예정공정표). 못 찾은 부분은 [작성 필요] 또는 [외부 자료 필요].

const { buildToc, titleOf } = require('../toc');
const { transplant } = require('../md');

const GANA = '가나다라마바사아자차카타파하';
const re = (s) => new RegExp(s);

/** 설계보고서(문서 순서)에서 part 규칙에 맞는 첫 절 */
function findPart(ctx, part, used) {
  const has = (node, src) => { for (let p = node.parent; p && p.level > 0; p = p.parent) if (re(src).test(p.title) || re(src).test(p.key)) return true; return false; };
  for (const doc of ctx.docs.filter((d) => d.role === 'design')) {
    for (const node of doc.outline.nodes) {
      if (!(re(part.re).test(node.title) || re(part.re).test(node.key))) continue;
      if (!node.blocks.length && !node.children.length) continue;
      if (part.parent && !has(node, part.parent)) continue;
      if (part.excludeAncestor && has(node, part.excludeAncestor)) continue;
      if (used.has(node)) continue;
      return { doc, node };
    }
  }
  return null;
}

/** 절 하나(예: 2. 용수수요량 산정)를 parts 순서로 조립 */
function buildSection(ctx, target, notes, used) {
  const vars = ctx.narrative.vars;
  const L = [`## ${target.number}. ${titleOf(target, vars)}`];
  (target.parts || []).forEach((part, i) => {
    const head = `### ${GANA[i] || i + 1}. ${part.title}`;
    if (part.use === 'purpose') {
      const sec = ctx.narrative.sections.purpose;
      L.push(head, sec.paragraphs.map((p) => `∙ ${p}`).join('\n\n'));
      return;
    }
    const hit = findPart(ctx, part, used);
    if (hit) {
      used.add(hit.node);
      L.push(transplant(hit.doc, hit.node, { level: 3, index: i, title: part.title }));
      notes.push(`${target.number}.${GANA[i]} ${part.title}: 설계보고서 「${hit.doc.docId}」 › ${hit.node.number ? `${hit.node.number} ` : ''}${hit.node.title}`);
    } else {
      const what = `${part.title}${part.hint ? ` — ${part.hint}` : ''}`;
      L.push(head, part.missing === 'external' ? `[외부 자료 필요: ${what}]` : `[작성 필요: ${what} — 설계보고서에서 찾지 못함]`);
    }
  });
  return L.join('\n\n');
}

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildWorksChapter(ctx) {
  const vars = ctx.narrative.vars;
  const notes = [];
  const L = [];
  const ch = buildToc(ctx.template, vars, 'pkg').chapters.find((c) => c.id === 'pkg.5');
  L.push(`# ${ch.number}. ${ch.title}`);
  L.push(ch.children.map((c) => `${c.number}. ${c.title}`).join('<br>'));
  const used = new Set();
  const targets = ctx.mapping.targets.filter((t) => /^pkg\.5\.\d+$/.test(t.id));
  for (const t of targets) L.push(buildSection(ctx, t, notes, used));
  notes.push('건축·조경계획, 구역경계 사유도, 환경영향 저감계획, 교통처리계획은 설계보고서에 없어 표시만 해 두었습니다(건축·조경 도서, 환경성·교통성 검토서에서 가져와야 함).');
  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildWorksChapter, findPart };
