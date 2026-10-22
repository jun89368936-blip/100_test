'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFile } = require('../src/ingest/parse');
const { extractFacts, applyOverrides, extractSite, parseCapacity, matchFacName } = require('../src/extract/facts');
const { squash } = require('../src/extract/text');
const { samples, skipUnless } = require('./samples');

test('시설명·용량 단위 파서', () => {
  assert.deepEqual(matchFacName('교 동\n배수지'.replace('\n', '')), { name: '교동배수지', place: '교동', kind: '배수지' });
  assert.equal(matchFacName('송·배수관로'), null);
  assert.equal(matchFacName('내가 배수지로부터'), null);
  assert.equal(parseCapacity('⋅V= 1,000㎥'), 'V=1,000㎥');
  assert.equal(parseCapacity('⋅배수가압장 개량 : Q=2.72㎥/분x25mH'), 'Q=2.72㎥/분');
  assert.equal(parseCapacity('계단실 1동'), null);
});

test('설계보고서 제1장 총론(완): 두 배수지 위치·용량, 목표연도, 사업비', { skip: skipUnless('설계1장') }, async () => {
  const d = await parseFile(samples.설계1장);
  const facts = extractFacts([{ role: 'design', parsed: d }]);

  const ids = facts.facilities.map((f) => f.id);
  assert.deepEqual(ids, ['교동배수지', '삼산배수지']);
  const [gd, ss] = facts.facilities;
  assert.equal(gd.위치.value, '인천광역시 강화군 교동면 상용리 산4번지 일원');
  assert.equal(gd.위치.주소.jibun, '산4');
  assert.equal(gd.위치.주소.eupmyeon, '교동면');
  assert.equal(ss.위치.value, '인천광역시 강화군 삼산면 석모리 산70번지 일원');
  assert.equal(gd.용량.value, 'V=1,000㎥');
  assert.equal(ss.용량.value, 'V=1,000㎥');
  assert.equal(gd.종류.value, '배수지');
  assert.equal(gd.시설군.value, '수도공급설비');
  assert.ok(gd.위치.source.page >= 1 && gd.위치.source.quote.includes('교동'));
  assert.equal(gd.위치.confidence, 'high');

  assert.equal(facts.fields.목표연도.value, 2040);
  assert.equal(facts.fields.총사업비.value, 18127);
  assert.equal(facts.fields.총공사비.value, 14201);
  assert.equal(facts.fields.총사업비.unit, '백만원');
  assert.equal(facts.fields.결정권자.value, '강화군수');
  assert.equal(facts.region.시도.value, '인천광역시');
  assert.equal(facts.region.시군구.value, '강화군');
  assert.deepEqual(facts.region.읍면.sort(), ['교동면', '삼산면']);
});

test('사업명: 표지에 남은 다른 사업명(화도배수지)은 대안으로 남기고 다수를 고른다', { skip: skipUnless('설계1장') }, async () => {
  const d = await parseFile(samples.설계1장);
  const facts = extractFacts([{ role: 'design', parsed: d }]);
  const f = facts.fields.사업명;
  assert.ok(/교동/.test(f.value) && /삼산/.test(f.value) && /배수지/.test(f.value), f.value);
  assert.ok(!/화도/.test(f.value));
  const alt = (f.alternatives || []).map((a) => squash(a.value));
  assert.ok(alt.some((v) => v.includes('화도배수지')), `대안: ${JSON.stringify(f.alternatives)}`);
  assert.ok(facts.conflicts.some((c) => c.item === '사업명'));
});

test('설계보고서 1~7장 전체를 함께 넣어도 같은 시설·연도, 값 충돌 보고', {
  skip: skipUnless('설계1장', '설계2장', '설계3장', '설계4장', '설계5장', '설계6장', '설계7장'),
  timeout: 120000,
}, async () => {
  const keys = ['설계1장', '설계2장', '설계3장', '설계4장', '설계5장', '설계6장', '설계7장'];
  const inputs = [];
  for (const k of keys) inputs.push({ role: 'design', parsed: await parseFile(samples[k]) });
  const facts = extractFacts(inputs);
  assert.deepEqual(facts.facilities.map((f) => f.id), ['교동배수지', '삼산배수지']);
  assert.equal(facts.fields.목표연도.value, 2040);
  assert.equal(facts.fields.사업목표연도.value, 2030);
  assert.equal(facts.fields.총사업비.value, 18127);
  assert.match(facts.fields.사업명.value, /교동·삼산\s?배수지 건설공사/);
  // 값을 찾지 못한 항목은 지어내지 않고 missing 으로
  assert.ok(Array.isArray(facts.missing));
});

test('입안서 샘플 02_계획의 개요: 시행자·결정권자·연도·보고 면적', { skip: skipUnless('개요') }, async () => {
  const d = await parseFile(samples.개요);
  const facts = extractFacts([{ role: 'other', parsed: d }]);
  assert.equal(facts.fields.시행자.value, '인천광역시상하수도본부');
  assert.equal(facts.fields.시행자.confidence, 'high');
  assert.equal(facts.fields.결정권자.value, '강화군수');
  assert.equal(facts.fields.목표연도.value, 2040);
  assert.equal(facts.fields.사업목표연도.value, 2030);
  const gd = facts.facilities.find((f) => f.id === '교동배수지');
  const ss = facts.facilities.find((f) => f.id === '삼산배수지');
  assert.equal(gd.보고면적.value, 19341);
  assert.equal(ss.보고면적.value, 10014);
});

test('사용자 수정값(overrides)이 추출값보다 우선하고 source 가 user', { skip: skipUnless('설계1장') }, async () => {
  const d = await parseFile(samples.설계1장);
  const facts = extractFacts([{ role: 'design', parsed: d }], {
    fields: { 시행자: '인천광역시 상수도사업본부', 총사업비: 18000 },
    facilities: { 교동배수지: { 위치: '인천광역시 강화군 교동면 상용리 산5번지 일원' } },
  });
  assert.equal(facts.fields.시행자.value, '인천광역시 상수도사업본부');
  assert.deepEqual(facts.fields.시행자.source, { user: true });
  assert.equal(facts.fields.시행자.confidence, 'user');
  assert.equal(facts.fields.총사업비.value, 18000);
  assert.equal(facts.fields.총사업비.replaced, 18127);
  const gd = facts.facilities[0];
  assert.equal(gd.위치.value, '인천광역시 강화군 교동면 상용리 산5번지 일원');
  assert.equal(gd.위치.주소.jibun, '산5');
  assert.ok(!facts.missing.includes('시행자'));
});

test('시설 정보가 없는 문서는 값을 지어내지 않고 missing 으로 남긴다', { skip: skipUnless('현황분석') }, async () => {
  const d = await parseFile(samples.현황분석);
  const facts = extractFacts([{ role: 'status', parsed: d }]);
  assert.deepEqual(facts.facilities, []);
  assert.equal(facts.fields.사업명.missing, true);
  assert.equal(facts.fields.총사업비.missing, true);
  assert.equal(facts.fields.목표연도.missing, true);
  assert.ok(facts.missing.includes('사업명'));
});

test('현황분석 보고서 대상지 위치·면적·필지수', { skip: skipUnless('현황분석') }, async () => {
  const d = await parseFile(samples.현황분석);
  const s = extractSite(d);
  assert.equal(s.위치.value, '전라남도 여수시 화정면 여자리 214번지 일원');
  assert.equal(s.위치.address.eupmyeon, '화정면');
  assert.equal(s.면적.value, 430743);
  assert.equal(s.필지수.value, 178);
});

test('applyOverrides: 빈 값은 무시', () => {
  const facts = { fields: { 시행자: { value: 'A', source: null, confidence: 'low' } }, facilities: [], missing: [] };
  applyOverrides(facts, { fields: { 시행자: '' } });
  assert.equal(facts.fields.시행자.value, 'A');
});
