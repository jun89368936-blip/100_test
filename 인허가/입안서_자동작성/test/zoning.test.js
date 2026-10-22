'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { judge, zoningVars, zonesFromMarkdown, nationalDevLimit, ORDINANCE } = require('../src/plan/zoning');

const INCHEON = ORDINANCE.인천광역시;

test('개발행위규모(시행령 제55조) 용도지역별 기준', () => {
  assert.equal(nationalDevLimit('보전관리지역'), 30000);
  assert.equal(nationalDevLimit('제1종일반주거지역'), 10000);
  assert.equal(nationalDevLimit('자연환경보전지역'), 5000);
  assert.equal(nationalDevLimit('일반공업지역'), 30000);
  assert.equal(nationalDevLimit('개발제한구역'), null);
});

test('샘플 교동(보전관리 9,112·계획관리 694): 산출수치 1.89 로 소규모환경영향평가 대상, 개발행위규모 이하', () => {
  // 샘플 입안서 Ⅲ.3 의 판정과 같은 값
  const j = judge({ 보전관리지역: 9112, 계획관리지역: 694 }, INCHEON);
  assert.equal(j.eia.index.toFixed(2), '1.89');
  assert.equal(j.eia.target, true);
  assert.equal(j.dev.ok, true);
  assert.deepEqual(j.dev.rows.map((r) => [r.zone, r.limit]), [['보전관리지역', 10000], ['계획관리지역', 30000]]);
  assert.equal(j.exempt.ok, true);
  // 삼산(계획관리 10,502): 단일 지역 10,000㎡ 이상 → 대상
  assert.equal(judge({ 계획관리지역: 10502 }, INCHEON).eia.target, true);
  assert.equal(judge({ 계획관리지역: 9000 }, INCHEON).eia.target, false);
  // 조례 없는 지역은 시행령 값, 보전관리 1만 넘어도 3만 미만이면 이하
  assert.equal(judge({ 보전관리지역: 15000 }, null).dev.ok, true);
  assert.equal(judge({ 보전관리지역: 15000 }, INCHEON).dev.ok, false);
  // 모르는 지역이 섞이면 그 판정은 null
  assert.equal(judge({ 개발제한구역: 100 }, INCHEON).eia, null);
  assert.deepEqual(judge(null, INCHEON), { dev: null, exempt: null, eia: null });
});

test('판정 문장: 시설마다 한 줄, 모르는 시설은 [작성 필요]', () => {
  const f = (id, zones) => ({ id, name: id, zones, ...judge(zones, INCHEON) });
  const v = zoningVars({ facilities: [f('교동배수지', { 보전관리지역: 5873, 계획관리지역: 229 }), f('삼산배수지', null)] });
  assert.match(v.소규모판정, /^교동배수지: 보전관리지역 5,873㎡, 계획관리지역 229㎡, 산출수치 5,873\/5,000 \+ 229\/10,000 = 1\.20로 소규모환경영향평가 대상\n삼산배수지: \[작성 필요: 소규모환경영향평가 판정/);
  assert.match(v.개발행위판정, /교동배수지: 보전관리지역 5,873㎡\(1만㎡ 미만\), 계획관리지역 229㎡\(3만㎡ 미만\)로 개발행위허가 규모 이하/);
  assert.match(v.면적판정, /교동배수지: .*용도지역별 개발행위규모 미만 → 토지적성평가·재해취약성분석 제외/);
});

test('현황분석 보고서 용도지역 표에서 면적 읽기(마크다운 표·HTML 표, 합계·구역계 제외)', () => {
  const md = '| 구분 | 면적(㎡) | 비율(%) |\n| --- | --- | --- |\n| 계획관리지역 | 229 | 3.8 |\n| 보전관리지역 | 5,873 | 96.2 |\n| 합계 | 6,102 | 100.0 |';
  assert.deepEqual(zonesFromMarkdown(md), { 계획관리지역: 229, 보전관리지역: 5873 });
  const html = '<table><tr><th>구분</th><th>면적</th></tr><tr><td>생산관리지역</td><td>1,200.5</td></tr><tr><td>구역계</td><td>9</td></tr></table>';
  assert.deepEqual(zonesFromMarkdown(html), { 생산관리지역: 1200.5 });
});
