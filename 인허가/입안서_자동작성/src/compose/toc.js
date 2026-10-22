'use strict';
// 목차: 골격 템플릿의 장(Ⅰ~Ⅷ)과 그 아래 절(1, 2, …)로 샘플 목차와 같은 구성을 만든다.
// 쪽번호는 HWPX 를 렌더해야 알 수 있으므로(US-012) 지금은 비워 둔다.

const { fillTemplate } = require('../plan/narrative');

/** tocTitle({{변수}}) 이 있으면 채우고, 없으면 title */
function titleOf(t, vars) {
  return t.tocTitle ? fillTemplate(t.tocTitle, vars).text : t.title;
}

/**
 * @param {object} template  loadTemplate() 결과
 * @param {object} vars  문안 변수(계획·시설군 등)
 * @param {string} [docId]  'pkg' | 'env' | 'traffic' | 'landscape'
 * @returns {{docId:string, title:string, chapters:{id,number,title,page,children:{id,number,title,page}[]}[]}}
 */
function buildToc(template, vars = {}, docId = 'pkg') {
  const doc = template.documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`골격에 문서 '${docId}' 가 없습니다.`);
  const chapters = doc.targets
    .filter((t) => t.number && t.toc !== false)
    .map((t) => ({
      id: t.id,
      number: t.number,
      title: titleOf(t, vars),
      page: null,
      children: (t.children || []).filter((c) => c.toc !== false).map((c) => ({ id: c.id, number: c.number, title: titleOf(c, vars), page: null })),
    }));
  return { docId, title: doc.title, chapters };
}

const label = (n) => (/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\d]+$/.test(n) ? `${n}.` : n);

/** 목차 마크다운 (쪽번호 칸은 비어 있으면 생략) */
function tocToMarkdown(toc) {
  const L = ['# 목　　차', ''];
  for (const ch of toc.chapters) {
    L.push(`### ${label(ch.number)} ${ch.title}${ch.page != null ? ` ····· ${ch.page}` : ''}`, '');
    for (const c of ch.children) L.push(`${label(c.number)} ${c.title}${c.page != null ? ` ····· ${c.page}` : ''}`, '');
  }
  return L.join('\n').trim();
}

module.exports = { buildToc, tocToMarkdown, titleOf };
