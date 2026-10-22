'use strict';
// Ⅶ. 편입토지조서 및 용지도 장: 간지 → 시설마다 ■ ○○배수지 편입조서
//   (편입토지조서 표 · 지목별 편입토지조서 · 소유자별 편입토지조서 · 용지도 · 토지대장).
// 표는 편입 필지(결정조서와 같은 자료)로 만들고, 용지도는 project.json landmaps 그림, 토지대장은 외부 자료.

const { buildToc } = require('../toc');
const { table } = require('./plans');
const { splitParcels } = require('../../plan/decision');
const { aggregate } = require('../../extract/parcels');

/** 면적: 소수 첫째 자리까지(필지 면적은 소수가 있다) */
const area = (n) => (n == null || Number.isNaN(n) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const pct = (n) => Number(n).toFixed(1);

/** '인천광역시 강화군 교동면 상용리' → '강화군 교동면 상용리' */
const stripSido = (s, sido) => (sido && String(s || '').startsWith(sido) ? String(s).slice(sido.length).trim() : String(s || '').trim());

/** 소유자 칸: '공(군유지)', '사(개인)' (샘플: '공(강화군)', '사(홍길동)') */
function ownerCell(p) {
  const head = { 국유지: '국', 공유지: '공', 사유지: '사' }[p.소유구분];
  if (!head) return p.소유자 ? `${p.소유자}` : '[작성 필요: 소유자]';
  return p.소유자 ? `${head}(${p.소유자})` : head;
}

function facilityBlock(ctx, fac, ps, notes) {
  const name = (fac.명칭 && fac.명칭.value) || fac.id;
  const sido = ctx.facts.region && ctx.facts.region.시도 ? ctx.facts.region.시도.value : null;
  const L = [`## ■ ${name} 편입조서`];
  if (!ps.length) {
    L.push(`[작성 필요: ${name} 편입토지 — 필지 자료가 없음(project.json parcels)]`);
    return L.join('\n\n');
  }
  const agg = aggregate(ps);

  // 편입토지조서 — 병합 머리글(소재지 = 주소·지번)이라 HTML 표
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = '<tr><th rowspan="2">구 분</th><th colspan="2">소재지</th><th rowspan="2">지목</th><th rowspan="2">공부면적<br>(㎡)</th>'
    + '<th rowspan="2">편입면적<br>(㎡)</th><th rowspan="2">소유자</th><th rowspan="2">용지번호</th></tr><tr><th>주 소</th><th>지 번</th></tr>';
  const rows = ps.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(stripSido(p.소재지, sido))}</td><td>${esc(p.지번 || '')}</td><td>${esc(p.지목 || '')}</td>`
    + `<td>${area(p.공부면적)}</td><td>${area(p.편입면적)}</td><td>${esc(ownerCell(p))}</td><td>${esc(p.용지번호 || '')}</td></tr>`).join('');
  const total = `<tr><td colspan="3">합 계</td><td></td><td>${area(agg.합계.공부면적)}</td><td>${area(agg.합계.편입면적)}</td><td></td><td></td></tr>`;
  L.push('### 편입토지조서', `<table>${head}${rows}${total}</table>`);

  // 지목별·소유자별 (샘플 서식: 합계가 아래)
  L.push('### 지목별 편입토지조서', table(['지 목', '필지수', '편입면적(㎡)', '비율(%)', '비 고'], [
    ...agg.지목별.map((r) => [r.지목, r.필지수, area(r.편입면적), pct(r.비율), '']),
    ['합 계', agg.합계.필지수, area(agg.합계.편입면적), '100.0', ''],
  ]));
  const ownerNames = (k) => [...new Set(ps.filter((p) => p.소유구분 === k).map((p) => p.소유자).filter(Boolean))].join(', ');
  L.push('### 소유자별 편입토지조서', table(['소유자', '필지수', '편입면적(㎡)', '비율(%)', '비 고'], [
    ...agg.소유자별.map((r) => [r.소유구분, r.필지수 || '-', r.필지수 ? area(r.편입면적) : '-', r.필지수 ? pct(r.비율) : '-', r.소유구분 === '사유지' ? '' : ownerNames(r.소유구분)]),
    ['합 계', agg.합계.필지수, area(agg.합계.편입면적), '100.0', ''],
  ]));
  agg.warnings.forEach((w) => notes.push(`${name} 편입토지: ${w}`));
  if (ps.some((p) => !p.용지번호)) notes.push(`${name}: 용지번호는 필지 자료에 없어 비워 두었습니다(용지도와 맞춰 채움).`);

  // 용지도·토지대장
  const map = ctx.attachments && ctx.attachments.landmaps && ctx.attachments.landmaps[fac.id];
  L.push(`### 용지도(${name})`, map ? `![${name} 용지도](${map})` : `[외부 자료 필요: ${name} 용지도]`);
  if (!map) notes.push(`${name} 용지도 그림이 없습니다. project.json 에 "landmaps": {"${fac.id}": "그림 파일 경로"} 를 넣으면 들어갑니다.`);
  L.push(`### ${name} - 토지대장 -`, `[외부 자료 필요: ${name} 토지대장(${ps.length}필지)]`);
  return L.join('\n\n');
}

/**
 * @param {object} ctx  prepare() 결과
 * @returns {{markdown:string, notes:string[]}}
 */
function buildLandChapter(ctx) {
  const vars = ctx.narrative.vars;
  const notes = [];
  const L = [];
  const ch = buildToc(ctx.template, vars, 'pkg').chapters.find((c) => c.id === 'pkg.7');
  L.push(`# ${ch.number}. ${ch.title}`);
  L.push(ch.children.map((c) => `${c.number}. ${c.title}`).join('<br>'));
  const facilities = ctx.facts.facilities || [];
  const warn = [];
  const byFac = splitParcels(facilities, ctx.parcels, warn);
  warn.forEach((w) => notes.push(`편입토지: ${w}`));
  if (!facilities.length) L.push('[작성 필요: 편입토지조서 — 시설을 찾지 못함]');
  for (const f of facilities) L.push(facilityBlock(ctx, f, byFac[f.id] || [], notes));
  for (const d of ctx.parcelDocs || []) notes.push(`필지 자료: 「${d.docId}」 ${d.count}필지${d.facility ? ` → ${d.facility}` : ''}${d.note ? ` (${d.note})` : ''}`);
  return { markdown: L.join('\n\n'), notes };
}

module.exports = { buildLandChapter, ownerCell };
