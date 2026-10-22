'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFile } = require('../src/ingest/parse');
const { extractFacts } = require('../src/extract/facts');
const { readParcelSheets } = require('../src/extract/parcels');
const { buildDecision, decisionTableHtml, reasonTableHtml, decisionToMarkdown, termsFor, circled, joinKo } = require('../src/plan/decision');
const { samples, skipUnless } = require('./samples');

const line = (r) => [r.구분, r.번호, r.시설명.replace(/\n/g, ''), r.위치, r.기정, r.변경, r.변경후, r.최초결정일].join('|');

function fakeFacts(extra = {}) {
  const fac = (id, eup, ri, jibun, rep) => ({
    id,
    명칭: { value: id },
    종류: { value: '배수지' },
    시설군: { value: '수도공급설비' },
    위치: { value: `인천광역시 강화군 ${eup} ${ri} ${jibun}번지 일원`, 주소: { sido: '인천광역시', sigungu: '강화군', eupmyeon: eup, ri, jibun } },
    보고면적: rep == null ? { value: null, missing: true } : { value: rep },
    place: id.replace('배수지', ''),
  });
  return {
    fields: { 결정권자: { value: '강화군수' } },
    region: { 시도: { value: '인천광역시' } },
    facilities: [fac('교동배수지', '교동면', '상용리', '산4', null), fac('삼산배수지', '삼산면', '석모리', '산70', null)],
    ...extra,
  };
}

const P = (소재지, 지번, 면적) => ({ 소재지, 지번, 지목: '임', 공부면적: 면적 * 2, 편입면적: 면적, 소유구분: '사유지' });

test('용어: 군수는 군관리계획·군계획시설, 시장은 도시관리계획·도시계획시설', () => {
  assert.deepEqual(termsFor('강화군수'), { 계획: '군관리계획', 시설: '군계획시설' });
  assert.deepEqual(termsFor('인천광역시장'), { 계획: '도시관리계획', 시설: '도시계획시설' });
  assert.equal(circled(1), '①');
  assert.equal(joinKo(['교동면', '삼산면', '교동면']), '교동면 및 삼산면');
  assert.equal(joinKo(['가면', '나면', '다면']), '가면, 나면 및 다면');
});

test('신설: 기정 -, 증)n, 변경후 n, 읍면으로 필지를 나눈다', () => {
  const parcels = [P('강화군 교동면 상용리', '산4', 100), P('강화군 교동면 상용리', '산3', 50), P('강화군 삼산면 석모리', '산70', 30)];
  const d = buildDecision(fakeFacts(), parcels);
  assert.equal(d.terms.계획, '군관리계획');
  assert.equal(d.title, '군관리계획(시설: 수도공급설비) 결정(신설) 조서');
  assert.equal(line(d.rows[0]), '신설|①|수도공급설비(교동배수지)|강화군 교동면 상용리 산4번지 일원|-|증)150|150|-');
  assert.equal(line(d.rows[1]), '신설|②|수도공급설비(삼산배수지)|강화군 삼산면 석모리 산70번지 일원|-|증)30|30|-');
});

test('변경(확장·축소): 기정 면적과 증)/감) 차이', () => {
  const parcels = [P('강화군 교동면 상용리', '산4', 100), P('강화군 삼산면 석모리', '산70', 40)];
  const d = buildDecision(fakeFacts(), parcels, { 변경: { 교동배수지: { 기정: 1000 }, 삼산배수지: { 기정: 500, 종류: '축소' } } });
  assert.equal(d.mode, '변경');
  assert.deepEqual([d.rows[0].기정, d.rows[0].변경, d.rows[0].변경후], ['1,000', '증)100', '1,100']);
  assert.deepEqual([d.rows[1].기정, d.rows[1].변경, d.rows[1].변경후], ['500', '감)40', '460']);
  assert.match(d.reasons[0].결정사유, /확장$/);
  assert.match(d.reasons[1].결정사유, /축소$/);
});

test('시설면적: 편입토지 합계 우선, 보고서 값과 다르면 경고, 자료가 없으면 [작성 필요]', () => {
  const facts = fakeFacts();
  facts.facilities[0].보고면적 = { value: 9806 };
  const d = buildDecision(facts, [P('강화군 교동면 상용리', '산4', 19341), P('강화군 삼산면 석모리', '산70', 10)]);
  assert.equal(d.rows[0].변경후, '19,341');
  assert.ok(d.warnings.some((w) => /교동배수지.*19,341.*9,806/.test(w)), d.warnings.join('\n'));

  const e = buildDecision(fakeFacts(), []);
  assert.equal(e.rows[0].변경, '[작성 필요]');
  assert.ok(e.warnings.some((w) => /시설면적을 알 수 없습니다/.test(w)));

  facts.facilities[1].보고면적 = { value: 777 };
  const f = buildDecision(facts, [P('강화군 교동면 상용리', '산4', 5)]);
  assert.equal(f.rows[1].변경후, '777');
  assert.ok(f.warnings.some((w) => /보고서의 시설면적\(777/.test(w)));
});

test('배정 못 한 필지는 경고', () => {
  const d = buildDecision(fakeFacts(), [P('강화군 송해면 하리', '1', 10)]);
  assert.ok(d.warnings.some((w) => /배정하지 못한 필지가 1개/.test(w)));
});

test('사유서: 같은 사유는 한 칸으로 합치고 HTML·마크다운으로 낸다', () => {
  const d = buildDecision(fakeFacts(), [P('강화군 교동면 상용리', '산4', 100), P('강화군 삼산면 석모리', '산70', 30)]);
  assert.equal(d.reasons[0].결정사유, '교동면 및 삼산면 일대 안정적인 수도 공급을 위한 배수지 신설');
  assert.equal(d.reasons[0].rowSpan, 2);
  assert.equal(d.reasons[1].merged, true);
  assert.deepEqual(d.reasons[0].결정내용, ['교동배수지 신설', '위치 : 강화군 교동면 상용리 산4번지 일원', '면적 : 100㎡']);

  const html = decisionTableHtml(d) + reasonTableHtml(d);
  assert.match(html, /<th colspan="3">면적\(㎡\)<\/th>/);
  assert.match(html, /<th rowspan="2">구분<\/th>/);
  assert.equal((html.match(/rowspan="2">교동면 및 삼산면/g) || []).length, 1);
  const md = decisionToMarkdown(d);
  assert.match(md, /\| 신설 \| ① \| 수도공급설비<br>\(교동배수지\) \|/);
  assert.match(md, /▣ 결정\(변경\) 사유서/);
});

test('샘플: 설계보고서 1장 + 샘플 입안서 편입토지조서 → 조서 첫 행과 사유서', {
  skip: skipUnless('설계1장', '결정안'),
  timeout: 120000,
}, async () => {
  const facts = extractFacts([{ role: 'design', parsed: await parseFile(samples.설계1장) }]);
  const doc = await parseFile(samples.결정안);
  const { sheets } = readParcelSheets(doc);
  const parcels = sheets.flatMap((s) => s.parcels);
  const d = buildDecision(facts, parcels);
  assert.equal(line(d.rows[0]), '신설|①|수도공급설비(교동배수지)|강화군 교동면 상용리 산4번지 일원|-|증)19,341|19,341|-');
  assert.equal(d.rows[1].번호, '②');
  assert.equal(d.rows[1].위치, '강화군 삼산면 석모리 산70번지 일원');
  // 샘플 PDF 의 삼산 면적은 10,502/10,965/10,014 로 엇갈린다 → 필지 합계(10,965)를 쓴다
  assert.equal(d.rows[1].변경후, '10,965');
  assert.match(d.reasons[0].결정사유, /교동면 및 삼산면 일대 안정적인 수도 공급을 위한 배수지 신설/);
  assert.equal(d.reasons[0].rowSpan, 2);
  assert.match(d.title, /^군관리계획\(시설: 수도공급설비\) 결정\(신설\) 조서$/);
});
