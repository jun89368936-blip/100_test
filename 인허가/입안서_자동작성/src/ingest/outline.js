'use strict';
// 읽은 문서(blocks)에서 제목 트리를 복원하고, 절 단위로 마크다운·이미지를 뽑는다.
//
// 보고서마다 제목 번호 체계가 다르다(제1장 / Ⅰ. / 1.0 / 1.1 / 1. / 가. / 1) / 가) …).
// 번호 모양을 '스타일'로 분류하고, 스타일의 상하 순서로 계층을 세운다.
// kordoc 이 heading 으로 준 블록 + 번호 패턴을 가진 짧은 문단을 제목으로 삼는다.

const { blocksToMarkdown } = require('kordoc');

// 스타일 순서 = 상위 → 하위. 같은 rank 는 같은 계층(예: 제N장, Ⅰ.)
const STYLES = [
  { key: 'chapter', rank: 1, re: /^제\s*(\d+)\s*(?:장|편)\s*(.*)$/ },
  { key: 'circled', rank: 1, re: /^([①-⑳])\s*(.+)$/ },
  { key: 'roman', rank: 1, re: /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|[IVX]{1,4})\s*[.．]\s*(.+)$/ },
  { key: 'n_dot_n_n', rank: 4, re: /^(\d+\.\d+\.\d+)\.?\s+(.+)$/ },
  { key: 'n_dot_n', rank: 3, re: /^(\d+\.(?:[1-9]\d*|0))\s+(.+)$/ },
  { key: 'n_dot', rank: 2, re: /^(\d+)\s*[.．]\s*(.+)$/ },
  { key: 'kor_dot', rank: 5, re: /^([가-하])\s*[.．]\s*(.+)$/ },
  { key: 'n_paren', rank: 6, re: /^(\d+)\s*\)\s*(.+)$/ },
  { key: 'kor_paren', rank: 7, re: /^([가-하])\s*\)\s*(.+)$/ },
  { key: 'sq', rank: 5, re: /^(▣|■|▶)\s*(.+)$/ },
  { key: 'paren_n', rank: 8, re: /^\((\d+)\)\s+(.+)$/ },
  { key: 'paren_kor', rank: 9, re: /^\(([가-하])\)\s+(.+)$/ },
];

// 숫자만 있는 'N.0 제목' 은 n_dot_n 보다 n_dot 에 가깝다(1.0 사업의 개요 > 1.1 과업의 목적)
function classify(text) {
  const t = text.trim();
  const dotZero = /^(\d+)\.0\s+(.+)$/.exec(t);
  if (dotZero) return { style: 'n_dot', rank: 2, number: `${dotZero[1]}.0`, title: dotZero[2].trim() };
  for (const s of STYLES) {
    const m = s.re.exec(t);
    if (m) {
      const title = (m[2] != null ? m[2] : '').trim();
      return { style: s.key, rank: s.rank, number: m[1], title: title || t };
    }
  }
  return null;
}

// 원문에 적힌 번호 표기(예: '2.', '가.', '1)', 'Ⅴ.')를 그대로 돌려준다
function labelOf(text, title) {
  const t = text.trim();
  if (title && t.endsWith(title)) return t.slice(0, t.length - title.length).trim();
  return '';
}

const key = (s) => String(s || '').replace(/[\s ·∙⋅･ㆍ]/g, '');

// 본문 문장이 번호로 시작하는 경우를 걸러낸다
function looksLikeHeadingText(text) {
  const t = text.trim();
  if (!t || t.length > 48) return false;
  if (/[다음함됨임]\.?$/.test(t) && t.length > 25) return false;
  if (/[.。]$/.test(t) && t.length > 12) return false;
  if (/^[\d.,\s]+$/.test(t)) return false;
  return true;
}

// 목차 줄 끝의 '⇥ 12' / '······ 12' 같은 쪽번호는 제목이 아니다
const TRAILING_PAGE_RE = /(?:\t\s*|[ ]{2,}|[·․.…]{3,}\s*)\d{1,4}\s*$/;

// 문단 앞에 붙는 이미지 참조('![image](x.png) / 제목')는 글이 아니다
const IMG_PREFIX_RE = /!\[[^\]]*\]\([^)]*\)/g;

// 한컴 글꼴 전용 원문자(U+F02B1~F02BA)는 일반 원문자(①~⑩)로 바꿔 읽는다
const HNC_CIRCLED_RE = /[\u{F02B1}-\u{F02BA}]/gu;
const hncCircled = (ch) => String.fromCharCode(0x2460 + ch.codePointAt(0) - 0xf02b1);

function firstText(block) {
  if (!block) return '';
  const raw = String(block.text || '').replace(IMG_PREFIX_RE, '').replace(HNC_CIRCLED_RE, hncCircled).replace(/^[\s/]+/, '');
  return raw.split('\n')[0].replace(TRAILING_PAGE_RE, '').trim();
}

// 연혁·목록 줄: '01. 01 ∙ 수도국 신설', '∙' 앞뒤가 띄어진 불릿. 단어 안의 '송⋅배수'는 제목일 수 있어 제외하지 않는다
function isListLine(text) {
  return /^\d{1,2}\.\s*\d{1,2}\s*[∙⋅·•]/.test(text) || /\s[∙•]\s/.test(text);
}

/** 블록 순서에서 제목 후보를 모은다. 반환: [{index, text, style, rank, number, title, kordocLevel}] */
function collectHeadings(blocks) {
  const out = [];
  blocks.forEach((b, index) => {
    if (b.type !== 'heading' && b.type !== 'paragraph') return;
    const text = firstText(b);
    if (!text || isListLine(text)) return;
    const c = classify(text);
    if (b.type === 'heading') {
      // 연혁·목록 줄을 kordoc 이 제목으로 잘못 표시한 경우(번호 체계 없음 + 불릿/날짜/긴 문장)는 제외
      if (!c && (/[∙⋅·]\s/.test(text) && text.length > 20 || /^\d{4}\s+\d{1,2}\.\s*\d{1,2}/.test(text) || text.length > 80)) return;
      out.push({
        index, text,
        style: c ? c.style : 'plain', rank: c ? c.rank : null,
        number: c ? c.number : '', title: c ? c.title : text,
        label: c ? labelOf(text, c.title) : '',
        kordocLevel: b.level || 1, fromKordoc: true,
        pageNumber: b.pageNumber,
      });
    } else if (c && looksLikeHeadingText(text) && !b.table && !(c.style === 'circled' && text.length > 24)) {
      // 문단이 번호 패턴으로 시작하고 짧으면 제목 후보. 한 줄짜리만.
      if (String(b.text).includes('\n')) return;
      out.push({
        index, text,
        style: c.style, rank: c.rank, number: c.number, title: c.title,
        kordocLevel: null, fromKordoc: false,
        pageNumber: b.pageNumber,
      });
    }
  });
  return out;
}

/** 목차 나열(연속된 제목 3개 이상이 본문 없이 이어지고, 같은 제목이 뒤에 다시 나옴)을 제거 */
function dropTocRuns(heads, blocks) {
  const seen = new Map(); // 정규화 제목 → 등장 인덱스 목록
  heads.forEach((h, i) => {
    const k = key(h.title);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(i);
  });
  const drop = new Set();
  let i = 0;
  while (i < heads.length) {
    // 연속 run: 제목 사이에 제목이 아닌 의미 있는 블록(표 제외)이 없는 구간
    let j = i;
    while (j + 1 < heads.length && isTocGap(blocks, heads[j].index, heads[j + 1].index)) j++;
    const len = j - i + 1;
    if (len >= 3) {
      // 목차 바로 뒤에 본문이 이어지면 run 안에서 첫 제목이 다시 나온다 → 거기까지가 목차
      let restart = -1;
      for (let r = i + 1; r <= j; r++) {
        if (key(heads[r].title) === key(heads[i].title) && heads[r].number === heads[i].number) { restart = r; break; }
      }
      if (restart >= i + 3) {
        for (let t = i; t < restart; t++) drop.add(t);
      } else {
        let repeated = 0;
        for (let t = i; t <= j; t++) {
          const idxs = seen.get(key(heads[t].title)) || [];
          if (idxs.some((x) => x > j)) repeated++;
        }
        if (repeated >= Math.ceil(len * 0.6)) for (let t = i; t <= j; t++) drop.add(t);
      }
    }
    i = j + 1;
  }
  return heads.filter((_, idx) => !drop.has(idx));
}

function isTocGap(blocks, a, b) {
  // a, b 사이 블록들이 모두 비어 있거나 쪽번호/점선뿐이면 목차형 연속
  for (let i = a + 1; i < b; i++) {
    const bl = blocks[i];
    const t = firstText(bl);
    if (bl.type === 'image' || bl.type === 'table') return false;
    if (t && !/^[\d\s.·…\-–ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/.test(t)) return false;
  }
  return true;
}

/** 같은 제목이 연달아 두 번 잡힌 것(예: kordoc 이 제1장을 두 레벨로 냄)을 하나로 */
function mergeAdjacentDuplicates(heads) {
  const out = [];
  for (const h of heads) {
    const prev = out[out.length - 1];
    if (prev && key(prev.text) === key(h.text) && h.index - prev.index <= 2) {
      // 번호 스타일이 있는 쪽을 남긴다
      if (prev.rank == null && h.rank != null) out[out.length - 1] = h;
      continue;
    }
    out.push(h);
  }
  return out;
}

/**
 * @typedef {object} OutlineNode
 * @property {string} id
 * @property {string} number
 * @property {string} title
 * @property {string} key        공백 제거한 제목(매칭용)
 * @property {number} level      1부터
 * @property {string} style
 * @property {object[]} blocks   이 절 자신의 블록(하위 절 제외, 제목 블록 제외)
 * @property {OutlineNode[]} children
 * @property {OutlineNode|null} parent
 * @property {number|null} pageStart
 * @property {number|null} pageEnd
 */

function buildOutline(parsed) {
  const blocks = parsed.blocks || [];
  let heads = collectHeadings(blocks);
  // 원문자(①)는 문서가 원문자 장 체계(입지검토서 등)일 때만 장 제목이다.
  // 그 밖의 문서에서는 목록 항목이므로 제목에서 빼거나(문단) 번호 없는 제목으로 취급(kordoc 제목)한다.
  const firstStyled = heads.find((h) => h.rank != null);
  const circledTop = !!firstStyled && firstStyled.style === 'circled';
  if (!circledTop) {
    heads = heads.filter((h) => h.style !== 'circled' || h.fromKordoc);
    heads.forEach((h) => { if (h.style === 'circled') { h.style = 'plain'; h.rank = null; } });
  }
  heads = dropTocRuns(heads, blocks);
  heads = mergeAdjacentDuplicates(heads);

  const root = { id: 'root', number: '', title: parsed.name || '', key: '', level: 0, style: 'root',
    blocks: [], children: [], parent: null, pageStart: null, pageEnd: null };

  // 번호 없는 kordoc 제목의 rank 는 kordoc 레벨로 추정(깊이 보정은 스택에서)
  const numbered = heads.filter((h) => h.rank != null).length;
  const mostlyUnnumbered = heads.length > 0 && numbered / heads.length < 0.3;
  const stack = [{ node: root, rank: 0 }];
  const nodes = [];
  const preamble = [];
  let current = root;
  let lastIndex = 0;

  const firstHeadIndex = heads.length ? heads[0].index : blocks.length;
  for (let i = 0; i < firstHeadIndex; i++) preamble.push(blocks[i]);

  heads.forEach((h, n) => {
    let rank = h.rank;
    if (rank == null) {
      // 번호 없는 제목: 번호 체계가 거의 없는 문서면 kordoc 레벨을 따르고,
      // 번호 체계가 있는 문서면 현재 절의 하위로 둔다(뒤따르는 번호 제목이 알아서 끌어올린다)
      rank = mostlyUnnumbered ? (h.kordocLevel || 1) : (stack[stack.length - 1].rank || 0) + 1;
    }
    while (stack.length > 1 && stack[stack.length - 1].rank >= rank) stack.pop();
    const parent = stack[stack.length - 1].node;
    const node = {
      id: `n${n + 1}`, number: h.number, label: h.label || h.number, title: h.title, key: key(h.title),
      level: parent.level + 1, style: h.style,
      blocks: [], children: [], parent,
      pageStart: h.pageNumber != null ? h.pageNumber : null, pageEnd: null,
      headingIndex: h.index,
    };
    parent.children.push(node);
    stack.push({ node, rank });
    nodes.push(node);
  });

  // 블록 배정: 제목 사이 블록은 앞 제목의 소유
  heads.forEach((h, n) => {
    const node = nodes[n];
    const end = n + 1 < heads.length ? heads[n + 1].index : blocks.length;
    for (let i = h.index + 1; i < end; i++) node.blocks.push(blocks[i]);
  });

  // 쪽 범위
  const pageOf = (b) => (b && b.pageNumber != null ? b.pageNumber : null);
  for (const node of nodes) {
    let max = node.pageStart;
    const upd = (p) => { if (p != null && (max == null || p > max)) max = p; };
    node.blocks.forEach((b) => upd(pageOf(b)));
    node.pageEnd = max;
  }
  // 하위 절의 쪽이 상위 pageEnd 에 반영되게 역순 전파
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.parent && n.parent !== root && n.pageEnd != null) {
      if (n.parent.pageEnd == null || n.pageEnd > n.parent.pageEnd) n.parent.pageEnd = n.pageEnd;
    }
  }

  return { root, nodes, preamble, docName: parsed.name };
}

/** 트리를 평탄하게 돌며 callback(node, depth) */
function walk(node, fn, depth = 0) {
  for (const c of node.children) {
    fn(c, depth);
    walk(c, fn, depth + 1);
  }
}

/** 제목 정규식·문자열로 절을 찾는다. 반환: 일치 노드 배열(트리 순서) */
function findSections(outline, matcher) {
  const test = typeof matcher === 'function'
    ? matcher
    : matcher instanceof RegExp
      ? (n) => matcher.test(n.title) || matcher.test(n.key)
      : (n) => n.key.includes(key(String(matcher)));
  const found = [];
  walk(outline.root, (n) => { if (test(n)) found.push(n); });
  return found;
}

// --- 마크다운 ---------------------------------------------------------

const IMG_RE = /(!\[[^\]]*\]\()([^)\s]+)(\))/g;

function headingMd(level, text) {
  return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
}

/** 노드 하나(자기 블록만)의 마크다운 */
function ownMarkdown(node) {
  return blocksToMarkdown(node.blocks).trim();
}

/**
 * 절을 마크다운으로. 하위 절 포함.
 * @param {OutlineNode} node
 * @param {{includeHeading?:boolean, baseLevel?:number, renumber?:(n:OutlineNode)=>string,
 *          imagePrefix?:string, usedImages?:Set<string>}} [opts]
 *   baseLevel: 이 절 제목에 줄 마크다운 헤딩 레벨(기본 node.level)
 *   renumber: 제목 앞에 붙일 새 번호/제목 문자열을 돌려주는 함수(기본: 원래 번호+제목)
 *   imagePrefix: 이미지 참조명 앞에 붙일 접두어(문서가 달라도 이름이 겹치지 않게)
 */
function sectionToMarkdown(node, opts = {}) {
  const { includeHeading = true, imagePrefix = '', usedImages } = opts;
  const baseLevel = opts.baseLevel != null ? opts.baseLevel : node.level;
  const titleOf = opts.renumber || ((n) => `${n.label ? `${n.label} ` : ''}${n.title}`.trim());
  const parts = [];

  const emit = (n, level, withHeading) => {
    if (withHeading) parts.push(headingMd(level, titleOf(n)));
    const own = ownMarkdown(n);
    if (own) parts.push(own);
    for (const c of n.children) emit(c, level + 1, true);
  };
  emit(node, baseLevel, includeHeading);

  let md = parts.join('\n\n');
  md = md.replace(IMG_RE, (_m, a, name, c) => {
    if (usedImages) usedImages.add(name);
    return `${a}${imagePrefix}${name}${c}`;
  });
  return md;
}

/** 마크다운 안에서 참조한 이미지 이름 → 바이트(접두어 포함 키) */
function collectImages(parsed, markdown, imagePrefix = '') {
  const out = new Map();
  for (const m of markdown.matchAll(IMG_RE)) {
    const ref = m[2];
    const name = imagePrefix && ref.startsWith(imagePrefix) ? ref.slice(imagePrefix.length) : ref;
    const buf = parsed.images.get(name);
    if (buf) out.set(ref, buf);
  }
  return out;
}

module.exports = {
  buildOutline, findSections, sectionToMarkdown, ownMarkdown, collectImages, walk,
  classify, key,
};
