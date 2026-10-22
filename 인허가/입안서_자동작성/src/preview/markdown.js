'use strict';
// 미리보기용 마크다운 → HTML. 조립 결과에 나오는 것만 다룬다:
// 제목, 문단, 인용(>), 목록(-), 파이프 표, 원본에서 옮긴 <table> HTML, 이미지, **굵게**, <br>.
// [작성 필요 …]·[외부 자료 필요 …] 표시는 눈에 띄게 칠한다.

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 글줄 안쪽: 이스케이프 후 <br>·굵게·표시만 살린다 */
function inline(s, imgBase) {
  return esc(s)
    .replace(/&lt;br\s*\/?&gt;/g, '<br>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => `<img alt="${alt}" src="${imgBase}${src.split('/').map((s) => encodeURIComponent(safeDecode(s))).join('/')}" loading="lazy">`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[작성 필요[^\]]*\]/g, (m) => `<mark class="need">${m}</mark>`)
    .replace(/\[외부 자료 필요[^\]]*\]/g, (m) => `<mark class="ext">${m}</mark>`);
}

/** 원본에서 옮긴 <table> HTML: 태그 구조는 두고 셀 글자만 표시를 칠한다 */
function rawTable(html) {
  return html
    .replace(/<(?!\/?(table|tr|td|th|br|thead|tbody)\b)[^>]*>/gi, '')
    // 남긴 태그도 병합 속성(rowspan·colspan)만 둔다
    .replace(/<(\/?)(table|tr|td|th|br|thead|tbody)\b([^>]*)>/gi, (_m, close, tag, attrs) => {
      const keep = (attrs.match(/\b(rowspan|colspan)="\d+"/gi) || []).join(' ');
      return `<${close}${tag}${keep ? ` ${keep}` : ''}>`;
    })
    .replace(/\[작성 필요[^\]<]*\]/g, (m) => `<mark class="need">${m}</mark>`)
    .replace(/\[외부 자료 필요[^\]<]*\]/g, (m) => `<mark class="ext">${m}</mark>`);
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/**
 * @param {string} md
 * @param {{imgBase?:string}} [opts]  imgBase: 이미지 주소 앞에 붙일 경로(예: '/img/')
 */
function markdownToHtml(md, opts = {}) {
  const imgBase = opts.imgBase || '';
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    if (/^<table\b/i.test(t)) {
      const buf = [];
      while (i < lines.length) { buf.push(lines[i]); if (/<\/table>/i.test(lines[i])) { i++; break; } i++; }
      out.push(rawTable(buf.join('\n')));
      continue;
    }
    if (/^-{3,}$/.test(t)) { out.push('<hr class="page">'); i++; continue; } // 쪽 나눔
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2], imgBase)}</h${h[1].length}>`); i++; continue; }
    if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|\s*:?-{3,}/.test(lines[i + 1].trim())) {
      const head = splitRow(t);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(splitRow(lines[i])); i++; }
      out.push(`<table><tr>${head.map((c) => `<th>${inline(c, imgBase)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, imgBase)}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (/^>\s?/.test(t)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${buf.map((b) => inline(b, imgBase)).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
      out.push(`<ul>${buf.map((b) => `<li>${inline(b, imgBase)}</li>`).join('')}</ul>`);
      continue;
    }
    out.push(`<p>${inline(t, imgBase)}</p>`);
    i++;
  }
  return out.join('\n');
}

module.exports = { markdownToHtml };
