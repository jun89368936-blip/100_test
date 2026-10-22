'use strict';
// 결정(변경) 조서와 결정(변경) 사유서 생성.
// 입력: extractFacts() 결과(facts), 편입 필지(parcels), 옵션. 출력: 조서 행·사유서 행 + HTML 표 / 마크다운.

const { aggregate } = require('../extract/parcels');
const { squash } = require('../extract/text');

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿';
const circled = (n) => (n >= 1 && n <= CIRCLED.length ? CIRCLED[n - 1] : `(${n})`);

const num = (n) => Math.round(n).toLocaleString('en-US');
const EPS = 0.5;

/** 결정권자 → 용어. 군수: 군관리계획·군계획시설 / 시장(그 밖): 도시관리계획·도시계획시설 */
function termsFor(authority) {
  const a = squash(authority || '');
  if (/군수$/.test(a)) return { 계획: '군관리계획', 시설: '군계획시설' };
  return { 계획: '도시관리계획', 시설: '도시계획시설' };
}

/** 시·군·구가 앞에 붙은 위치에서 시·도만 뗀다 ('인천광역시 강화군 …' → '강화군 …') */
function stripSido(address, sido) {
  let s = String(address || '').trim();
  if (sido && s.startsWith(sido)) s = s.slice(sido.length).trim();
  return s;
}

/** '교동면', '삼산면' → '교동면 및 삼산면' */
function joinKo(items) {
  const list = [...new Set(items.filter(Boolean))];
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} 및 ${list[list.length - 1]}`;
}

/**
 * 필지를 시설별로 나눈다.
 * - parcels 가 {시설id: 필지[]} 이면 그대로
 * - 배열이면 시설이 하나일 때 전부, 여럿이면 소재지(읍·면)나 시트 이름으로 나눈다
 */
function splitParcels(facilities, parcels, warnings) {
  const out = {};
  facilities.forEach((f) => { out[f.id] = []; });
  if (!parcels) return out;
  if (!Array.isArray(parcels)) {
    for (const f of facilities) out[f.id] = parcels[f.id] || [];
    return out;
  }
  if (facilities.length === 1) { out[facilities[0].id] = parcels; return out; }
  const lost = [];
  for (const p of parcels) {
    if (p.시설 && out[p.시설]) { out[p.시설].push(p); continue; } // 자료에서 시설을 지정한 필지
    const hit = facilities.filter((f) => {
      const a = f.위치 && f.위치.주소;
      const place = f.place || (f.명칭 && f.명칭.value) || '';
      if (a && a.eupmyeon && String(p.소재지 || '').includes(a.eupmyeon)) return true;
      return !!(p.출처 && p.출처.sheet && place && String(p.출처.sheet).includes(String(place).replace(/배수지|정수장|가압장|취수장|하수.*$/g, '')));
    });
    if (hit.length === 1) out[hit[0].id].push(p);
    else lost.push(p);
  }
  if (lost.length) warnings.push(`시설에 배정하지 못한 필지가 ${lost.length}개 있습니다(소재지가 시설 위치와 다릅니다).`);
  return out;
}

/** 시설군별 결정사유 문구 */
function reasonFor(facility, ctx) {
  const kind = facility.종류 && facility.종류.value ? facility.종류.value : '시설';
  const act = ctx.act; // 신설 | 확장 | 축소 | 변경
  const place = ctx.places ? `${ctx.places} 일대 ` : '';
  const body = ctx.group === '수도공급설비' ? '안정적인 수도 공급을 위한' : ctx.group === '하수도' ? '원활한 하수 처리를 위한' : '주민 편의 증진을 위한';
  return `${place}${body} ${kind} ${act}`.replace(/\s+/g, ' ').trim();
}

/**
 * @param {object} facts  extractFacts() 결과
 * @param {object[]|Object<string,object[]>} parcels  편입 필지(배열 또는 시설id→필지[])
 * @param {object} [options]
 * @param {Object<string,{기정:number, 종류?:'확장'|'축소'}>} [options.변경]  변경(확장·축소) 사업의 시설별 기정 면적. 이때 필지 합계는 증감분으로 본다.
 * @param {Object<string,string>} [options.최초결정일]  시설별 최초결정일
 * @param {Object<string,string>} [options.비고]  시설별 비고
 * @param {string} [options.결정권자]  결정권자(없으면 facts 에서)
 * @returns {{terms:object,title:string,rows:object[],reasons:object[],warnings:string[],mode:string}}
 */
function buildDecision(facts, parcels, options = {}) {
  const warnings = [];
  const facilities = (facts && facts.facilities) || [];
  const authority = options.결정권자 || (facts && facts.fields && facts.fields.결정권자 && facts.fields.결정권자.value) || '';
  const terms = termsFor(authority);
  const sido = facts && facts.region && facts.region.시도 && facts.region.시도.value;
  const changes = options.변경 || {};
  const byFac = splitParcels(facilities, parcels, warnings);

  const rows = [];
  facilities.forEach((f, idx) => {
    const id = f.id;
    const name = (f.명칭 && f.명칭.value) || id;
    const group = (f.시설군 && f.시설군.value) || '';
    const ch = changes[id];

    // 면적: 편입토지 합계 우선, 없으면 보고서 값(경고)
    const ps = byFac[id] || [];
    const agg = ps.length ? aggregate(ps) : null;
    const parcelArea = agg ? agg.합계.편입면적 : null;
    const reported = f.보고면적 && f.보고면적.value != null ? Number(f.보고면적.value) : null;
    let area = parcelArea;
    if (area == null && reported != null) {
      area = reported;
      warnings.push(`${name}: 편입토지 자료가 없어 보고서의 시설면적(${num(reported)}㎡)을 썼습니다.`);
    } else if (area != null && reported != null && Math.abs(area - reported) > EPS) {
      warnings.push(`${name}: 편입토지 합계(${num(area)}㎡)가 보고서에 적힌 시설면적(${num(reported)}㎡)과 다릅니다. 편입토지 합계를 썼습니다.`);
    }
    if (area == null) warnings.push(`${name}: 시설면적을 알 수 없습니다([작성 필요]).`);

    let 구분 = '신설';
    let 기정 = null;
    let 변경 = null;
    let 변경후 = null;
    let act = '신설';
    if (area != null) {
      if (ch && ch.기정 != null) {
        기정 = Number(ch.기정);
        const shrink = ch.종류 === '축소';
        구분 = '변경';
        act = shrink ? '축소' : '확장';
        변경 = shrink ? -area : area;
        변경후 = 기정 + 변경;
        if (변경후 < 0) warnings.push(`${name}: 축소 면적이 기정 면적보다 큽니다.`);
      } else {
        변경 = area;
        변경후 = area;
      }
    }
    const addr = f.위치 && !f.위치.missing ? stripSido(f.위치.value, sido) : '';
    if (!addr) warnings.push(`${name}: 위치를 알 수 없습니다([작성 필요]).`);

    rows.push({
      id,
      구분,
      번호: circled(idx + 1),
      시설군: group,
      시설명: `${group || '시설'}\n(${name})`,
      이름: name,
      종류: (f.종류 && f.종류.value) || '',
      위치: addr || '[작성 필요: 위치]',
      eupmyeon: f.위치 && f.위치.주소 ? f.위치.주소.eupmyeon : null,
      기정: 기정 == null ? '-' : num(기정),
      변경: 변경 == null ? '[작성 필요]' : `${변경 >= 0 ? '증)' : '감)'}${num(Math.abs(변경))}`,
      변경후: 변경후 == null ? '[작성 필요]' : num(변경후),
      면적: { 기정, 변경, 변경후 },
      최초결정일: (options.최초결정일 && options.최초결정일[id]) || '-',
      비고: (options.비고 && options.비고[id]) || '',
      act,
    });
  });

  // 사유서 — 같은 사유는 한 칸으로 합친다(rowSpan)
  const places = joinKo(rows.map((r) => r.eupmyeon));
  const reasons = rows.map((r) => {
    const f = facilities.find((x) => x.id === r.id);
    return {
      번호: r.번호,
      시설명: r.시설명,
      결정내용: [
        `${r.이름} ${r.act}`,
        `위치 : ${r.위치}`,
        `면적 : ${r.면적.변경후 == null ? '[작성 필요]' : `${num(r.면적.변경후)}㎡`}`,
      ],
      결정사유: reasonFor(f, { act: r.act, places, group: r.시설군 }),
      rowSpan: 1,
      merged: false,
    };
  });
  for (let i = 0; i < reasons.length; i++) {
    if (reasons[i].merged) continue;
    let span = 1;
    while (i + span < reasons.length && reasons[i + span].결정사유 === reasons[i].결정사유) {
      reasons[i + span].merged = true;
      span++;
    }
    reasons[i].rowSpan = span;
  }

  const kinds = [...new Set(rows.map((r) => r.구분))];
  const mode = kinds.length === 1 ? kinds[0] : '신설·변경';
  const groupName = rows[0] && rows[0].시설군 ? rows[0].시설군 : '시설';
  const title = `${terms.계획}(시설: ${groupName}) 결정(${mode}) 조서`;
  return { terms, title, mode, rows, reasons, warnings };
}

/** 시설 일부만 뽑은 결정조서(시설 종류별로 표를 나눌 때). 사유서의 칸 합치기는 다시 계산한다 */
function subsetDecision(d, ids) {
  const keep = new Set(ids);
  const idx = d.rows.map((r, i) => (keep.has(r.id) ? i : -1)).filter((i) => i >= 0);
  const reasons = idx.map((i) => ({ ...d.reasons[i], rowSpan: 1, merged: false }));
  for (let i = 0; i < reasons.length; i++) {
    if (reasons[i].merged) continue;
    let span = 1;
    while (i + span < reasons.length && reasons[i + span].결정사유 === reasons[i].결정사유) { reasons[i + span].merged = true; span++; }
    reasons[i].rowSpan = span;
  }
  return { ...d, rows: idx.map((i) => d.rows[i]), reasons };
}

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (s) => esc(s).replace(/\n/g, '<br>');

/** 조서 HTML 표 (구분·번호·시설명·위치·최초결정일·비고 = 2행 병합, 면적 = 3열 병합) */
function decisionTableHtml(d) {
  const head = '<tr><th rowspan="2">구분</th><th rowspan="2">도면표시번호</th><th rowspan="2">시설명</th><th rowspan="2">위치</th>'
    + '<th colspan="3">면적(㎡)</th><th rowspan="2">최초결정일</th><th rowspan="2">비고</th></tr>'
    + '<tr><th>기정</th><th>변경</th><th>변경후</th></tr>';
  const body = d.rows.map((r) => `<tr><td>${cell(r.구분)}</td><td>${cell(r.번호)}</td><td>${cell(r.시설명)}</td><td>${cell(r.위치)}</td>`
    + `<td>${cell(r.기정)}</td><td>${cell(r.변경)}</td><td>${cell(r.변경후)}</td><td>${cell(r.최초결정일)}</td><td>${cell(r.비고)}</td></tr>`).join('');
  return `<table>${head}${body}</table>`;
}

/** 사유서 HTML 표 (같은 사유는 rowspan) */
function reasonTableHtml(d) {
  const head = '<tr><th>도면표시번호</th><th>시설명</th><th>결정내용</th><th>결정사유</th></tr>';
  const body = d.reasons.map((r) => {
    const why = r.merged ? '' : `<td rowspan="${r.rowSpan}">${cell(r.결정사유)}</td>`;
    return `<tr><td>${cell(r.번호)}</td><td>${cell(r.시설명)}</td><td>${r.결정내용.map((l) => `･ ${cell(l)}`).join('<br>')}</td>${why}</tr>`;
  }).join('');
  return `<table>${head}${body}</table>`;
}

const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');

/** 마크다운 표 (병합 셀은 표현할 수 없어 면적 열은 풀어 쓰고, 같은 사유는 반복한다) */
function decisionToMarkdown(d) {
  const lines = [];
  lines.push('| 구분 | 도면표시번호 | 시설명 | 위치 | 기정(㎡) | 변경(㎡) | 변경후(㎡) | 최초결정일 | 비고 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of d.rows) {
    lines.push(`| ${[r.구분, r.번호, r.시설명, r.위치, r.기정, r.변경, r.변경후, r.최초결정일, r.비고].map(mdCell).join(' | ')} |`);
  }
  lines.push('');
  lines.push('▣ 결정(변경) 사유서');
  lines.push('');
  lines.push('| 도면표시번호 | 시설명 | 결정내용 | 결정사유 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of d.reasons) {
    lines.push(`| ${[r.번호, r.시설명, r.결정내용.map((l) => `･ ${l}`).join('\n'), r.결정사유].map(mdCell).join(' | ')} |`);
  }
  return lines.join('\n');
}

module.exports = { buildDecision, subsetDecision, decisionTableHtml, reasonTableHtml, decisionToMarkdown, termsFor, circled, splitParcels, joinKo };
