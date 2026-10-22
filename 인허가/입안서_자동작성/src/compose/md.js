'use strict';
// 장 조립기가 함께 쓰는 마크다운 도구.

const { sectionToMarkdown, ownMarkdown } = require('../ingest/outline');

const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const PAGE_NO = /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\dIVX]+\s*-\s*\d+$/;

/** 그림 참조 경로 '<문서id>/<그림>' — 문서 id 의 공백·괄호가 마크다운 그림 문법을 깨지 않게 인코딩한다 */
function imageRef(docId, name) {
  const enc = (s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `${enc(docId)}/${enc(name)}`;
}

/** 절(하위 포함)에 나오는 그림 이름 목록. 작은 그림(글머리 장식 등)은 minBytes 로 거른다 */
function imagesIn(doc, node, minBytes = 50000) {
  const names = [...sectionToMarkdown(node).matchAll(IMG_RE)].map((m) => m[2]);
  return [...new Set(names)].filter((n) => { const buf = doc.parsed.images.get(n); return buf && buf.length >= minBytes; });
}

/** 문서 전체에서 3번 이상 되풀이되는 그림 = 글머리표·장식 그림 */
function decorativeImages(doc) {
  if (doc._decorative) return doc._decorative;
  const count = new Map();
  for (const m of String(doc.parsed.markdown || '').matchAll(IMG_RE)) count.set(m[2], (count.get(m[2]) || 0) + 1);
  doc._decorative = new Set([...count].filter(([, c]) => c >= 3).map(([n]) => n));
  return doc._decorative;
}

// 입안서 번호 체계: 절 아래로 가. → 1) → 가) → (1) → ①
const GANA = '가나다라마바사아자차카타파하';
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const LABELS = [
  (i) => `${GANA[i] || i + 1}.`,
  (i) => `${i + 1})`,
  (i) => `${GANA[i] || i + 1})`,
  (i) => `(${i + 1})`,
  (i) => CIRCLED[i] || `(${i + 1})`,
];

/**
 * 원본 보고서의 절을 입안서로 옮긴다: 제목 번호를 입안서 체계로 다시 매기고, 그림 경로를 문서 id 로 바꾸고,
 * 장식 그림·쪽번호 줄은 뺀다.
 * @param {object} doc  ctx.docs 의 문서({docId, parsed})
 * @param {object} node  옮길 절
 * @param {{level:number, index:number, depth?:number, noHeading?:boolean, title?:string}} opts
 *   level: 이 절 제목의 마크다운 레벨, index: 같은 단계에서 몇 번째(0부터), depth: 번호 체계 단계(0=가.)
 *   noHeading: 이 절 제목은 빼고 본문·하위 절만(하위 절은 level+1, depth+1), title: 이 절 제목을 바꿔 쓴다
 */
function transplant(doc, node, opts) {
  const decorative = decorativeImages(doc);
  const out = [];
  const emit = (n, level, depth, index, top) => {
    const label = (LABELS[depth] || LABELS[LABELS.length - 1])(index);
    // '주 …' 꼴 절(표 아래 각주를 제목으로 잘못 읽은 것)은 제목이 아니라 글로 둔다
    if (!top && n.number === '주') out.push(`주) ${n.title}`);
    else if (!(top && opts.noHeading)) out.push(`${'#'.repeat(Math.min(level, 6))} ${label} ${top && opts.title ? opts.title : n.title}`);
    const own = ownMarkdown(n)
      .split('\n')
      .filter((line) => !PAGE_NO.test(line.trim()))
      .join('\n')
      .replace(IMG_RE, (m, alt, name) => {
        if (decorative.has(name) || !doc.parsed.images.get(name)) return '';
        return `![${alt}](${imageRef(doc.docId, name)})`;
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (own) out.push(own);
    // 각주 절은 번호를 차지하지 않는다
    let i = 0;
    n.children.forEach((c) => emit(c, level + 1, depth + 1, c.number === '주' ? 0 : i++, false));
  };
  emit(node, opts.level, opts.depth || 0, opts.index || 0, true);
  return out.join('\n\n');
}

const squashTitle = (s) => String(s || '').replace(/[\s·・ㆍ]/g, '');

/**
 * 절을 입안서에 필요한 부분만 남긴 사본으로 만든다(원본은 그대로).
 * keep 규칙에 맞는 하위 절만 남기고(규칙은 위에서부터 처음 맞는 것), only:'facility' 규칙의 절 안에서는 제목에 이 사업 시설
 * 이름이 든 절과 그 위 절(제목·짧은 본문)만 남긴다. children 규칙이 있으면 그 절의 하위 절도 같은 방식으로 거르고,
 * flatten 이면 그 절 제목은 빼고 남긴 하위 절을 한 단계 끌어올린다.
 * @param {object} node  원본 절
 * @param {{re:string, only?:'facility', children?:object[], flatten?:boolean}[]} keep
 * @param {string[]} facilityNames  예: ['교동배수지','삼산배수지']
 * @returns {{node:object|null, kept:string[], dropped:string[]}}  맞는 하위 절이 하나도 없으면 node:null
 */
function trimSection(node, keep, facilityNames = []) {
  const kept = [];
  const dropped = [];
  const names = facilityNames.map(squashTitle).filter(Boolean);
  const mentionsFacility = (n) => names.some((f) => squashTitle(n.title).includes(f));
  const hasFacility = (n) => mentionsFacility(n) || n.children.some(hasFacility);
  const onlyFacility = (n) => {
    if (mentionsFacility(n)) return n; // 시설 절은 통째로
    return { ...n, children: n.children.filter((c) => { const ok = hasFacility(c); if (!ok) dropped.push(c.title); return ok; }).map(onlyFacility) };
  };
  const children = [];
  for (const c of node.children) {
    const rule = keep.find((r) => new RegExp(r.re).test(c.title) || new RegExp(r.re).test(squashTitle(c.title)));
    if (!rule) { dropped.push(c.title); continue; }
    let picked = c;
    if (rule.only === 'facility') {
      if (!hasFacility(c)) { dropped.push(c.title); continue; }
      picked = onlyFacility(c);
    } else if (rule.children) {
      const sub = trimSection(c, rule.children, facilityNames);
      dropped.push(...sub.dropped);
      if (!sub.node) { dropped.push(c.title); continue; }
      picked = sub.node;
      kept.push(...sub.kept.map((t) => `${c.title} › ${t}`));
    }
    if (!rule.children) kept.push(c.title);
    if (rule.flatten) children.push(...picked.children);
    else children.push(picked);
  }
  if (!children.length) return { node: null, kept, dropped };
  return { node: { ...node, children }, kept, dropped };
}

module.exports = { imageRef, imagesIn, transplant, trimSection, decorativeImages, LABELS };
