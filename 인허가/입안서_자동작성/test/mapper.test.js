'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFile } = require('../src/ingest/parse');
const { buildOutline } = require('../src/ingest/outline');
const { loadTemplate, expandTemplate, mapSections, mappingToJson, mappingToMarkdown } = require('../src/plan/mapper');
const { samples, skipUnless } = require('./samples');

const cache = new Map();
async function load(key, docId, role, extra = {}) {
  if (!cache.has(key)) cache.set(key, buildOutline(await parseFile(samples[key])));
  return { docId, role, outline: cache.get(key), ...extra };
}
const nodeTitle = (res, targetId) => res.assignments.filter((a) => a.targetId === targetId).map((a) => a.nodeTitle);
const FACS = ['교동배수지', '삼산배수지'];

test('골격 템플릿: Ⅰ~Ⅷ과 검토서 3종, 시설별 반복 풀기', () => {
  const t = loadTemplate();
  assert.deepEqual(t.documents.map((d) => d.id), ['pkg', 'env', 'traffic', 'landscape']);
  const pkgTop = t.documents[0].targets.filter((x) => x.number).map((x) => `${x.number} ${x.title}`);
  assert.deepEqual(pkgTop, [
    'Ⅰ 결정(안)', 'Ⅱ 계획의 개요', 'Ⅲ 상위 및 관련계획 검토', 'Ⅳ 현황 및 여건분석', 'Ⅴ 배수시설 조성계획',
    'Ⅵ 기초자료 조사서', 'Ⅶ 편입토지조서 및 용지도', 'Ⅷ 첨부서류',
  ]);
  const ex = expandTemplate(t, FACS);
  const ids = ex.map((x) => x.id);
  assert.ok(ids.includes('pkg.4.3:교동배수지'));
  assert.ok(ids.includes('pkg.4.3:삼산배수지:summary'));
  assert.ok(ids.includes('pkg.7.1:교동배수지'));
  assert.equal(new Set(ids).size, ids.length, '대상 절 id 가 겹친다');
  // 시설을 모르면 반복 절은 하나로 남고 표시된다
  assert.ok(expandTemplate(t, []).find((x) => x.id === 'pkg.4.3').needsFacility);
});

test('샘플 03·04·05 장을 원본으로: 각 절이 올바른 절에 배정된다', { skip: skipUnless('상위계획', '현황', '조성계획'), timeout: 120000 }, async () => {
  const docs = [await load('상위계획', 'd3', 'design'), await load('현황', 'd4', 'design'), await load('조성계획', 'd5', 'design')];
  const res = mapSections(docs, loadTemplate());
  const only = (id) => { const a = res.assignments.filter((x) => x.targetId === id); assert.equal(a.length, 1, `${id}: ${JSON.stringify(a)}`); return a[0]; };

  assert.deepEqual([only('pkg.3.1').docId, only('pkg.3.1').nodeTitle], ['d3', '상위계획 검토']);
  assert.equal(only('pkg.3.3').nodeTitle, '관련법규검토');
  assert.deepEqual([only('pkg.4.1').docId, only('pkg.4.1').nodeTitle], ['d4', '일반현황']);
  assert.deepEqual([only('pkg.4.2').docId, only('pkg.4.2').nodeTitle], ['d4', '인문·사회 현황']);
  assert.deepEqual([only('pkg.5.2').docId, only('pkg.5.2').nodeTitle], ['d5', '용수수요량 산정']);
  assert.deepEqual([only('pkg.5.3').docId, only('pkg.5.3').nodeTitle], ['d5', '배수지 시설계획']);
  assert.equal(only('pkg.5.1').nodeTitle, '계획의 개요');
  assert.equal(only('pkg.5.4').nodeTitle, '건축계획');

  // 관련계획 검토(multi)는 상위 절 하나만 잡고 그 하위 절은 중복 배정하지 않는다
  assert.deepEqual(nodeTitle(res, 'pkg.3.2'), ['관련계획 검토']);

  // 같은 원본 절이 두 대상에 배정되지 않는다
  const keys = res.assignments.map((a) => `${a.docId}#${a.nodeId}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('설계보고서 제1장 총론: 시설물 개요·사업의 개요 → Ⅱ 계획의 개요, 사업의 효과 → 기대효과', { skip: skipUnless('설계1장') }, async () => {
  const res = mapSections([await load('설계1장', 'g1', 'design')], loadTemplate());
  assert.deepEqual(nodeTitle(res, 'pkg.2.1').sort(), ['사업의 개요', '시설물 개요']);
  assert.deepEqual(nodeTitle(res, 'pkg.app.effect'), ['사업의 효과']);
  // 못 찾은 절은 이유와 함께 나온다
  const miss = res.unmatched.find((u) => u.targetId === 'pkg.5.2');
  assert.ok(miss && /설계보고서에서 해당 내용을 찾지 못함/.test(miss.reason));
});

test('설계보고서 1~7장을 하나로 묶어 장 번호와 무관하게 제목으로 찾는다', {
  skip: skipUnless('설계1장', '설계2장', '설계3장', '설계4장', '설계5장', '설계6장', '설계7장'), timeout: 120000,
}, async () => {
  const keys = ['설계1장', '설계2장', '설계3장', '설계4장', '설계5장', '설계6장', '설계7장'];
  const docs = [];
  for (const k of keys) docs.push(await load(k, k, 'design'));
  const res = mapSections(docs, loadTemplate());
  const demand = res.assignments.filter((a) => a.targetId === 'pkg.5.2');
  assert.equal(demand.length, 1);
  assert.ok(['설계5장', '설계7장'].includes(demand[0].docId), demand[0].docId);
  assert.match(demand[0].nodeTitle, /수요량\s*산정/);
  assert.ok(nodeTitle(res, 'pkg.5.3').some((t) => /배수지/.test(t)), JSON.stringify(nodeTitle(res, 'pkg.5.3')));
  assert.ok(nodeTitle(res, 'pkg.3.2').some((t) => /수도정비기본계획/.test(t)));
  const dup = res.assignments.map((a) => `${a.docId}#${a.nodeId}`);
  assert.equal(new Set(dup).size, dup.length);
});

test('사용자 지정(overrides)이 자동 결과보다 우선하고, null 은 배정하지 않는다', { skip: skipUnless('상위계획', '현황', '조성계획'), timeout: 120000 }, async () => {
  const docs = [await load('상위계획', 'd3', 'design'), await load('현황', 'd4', 'design'), await load('조성계획', 'd5', 'design')];
  const auto = mapSections(docs, loadTemplate());
  const other = docs[2].outline.nodes.find((n) => n.title === '장래용수 수요량 산정');
  assert.ok(other);
  const res = mapSections(docs, loadTemplate(), { 'pkg.5.2': { docId: 'd5', nodeId: other.id }, 'pkg.5.6': null, 'pkg.zzz': null });
  const a = res.assignments.filter((x) => x.targetId === 'pkg.5.2');
  assert.deepEqual([a.length, a[0].nodeId, a[0].via], [1, other.id, 'override']);
  assert.notEqual(a[0].nodeId, auto.assignments.find((x) => x.targetId === 'pkg.5.2').nodeId);
  assert.ok(!res.assignments.some((x) => x.targetId === 'pkg.5.6'));
  assert.ok(!res.unmatched.some((x) => x.targetId === 'pkg.5.6'), '사용자가 비운 절은 못 찾은 절이 아니다');
  assert.ok(res.warnings.some((w) => /pkg\.zzz/.test(w)));
  // 지정한 절의 하위 절(장래용수 수요량 산정 아래)은 다른 대상에 중복 배정되지 않는다
  const taken = res.assignments.map((x) => `${x.docId}#${x.nodeId}`);
  assert.equal(new Set(taken).size, taken.length);
});

test('시설별 반복: 시설마다 지정한 현황분석 보고서에서 재배열해 가져온다', { skip: skipUnless('현황분석') }, async () => {
  const docs = [
    await load('현황분석', 's1', 'status', { facilityId: '교동배수지' }),
    await load('현황분석', 's2', 'status', { facilityId: '삼산배수지' }),
  ];
  const res = mapSections(docs, loadTemplate(), {}, { facilities: FACS });
  const pick = (fac, sub) => res.assignments.find((a) => a.targetId === `pkg.4.3:${fac}:${sub}`);
  const expect = { loc: '위치 및 면적', elev: '표고분석', slope: '경사분석', eco: '생태자연도', owner: '소유자 현황', jimok: '지목별 현황', zone: '용도지역 현황', district: '용도지구 현황', summary: '현황종합 및 입지제한' };
  for (const [fac, doc] of [['교동배수지', 's1'], ['삼산배수지', 's2']]) {
    for (const [sub, title] of Object.entries(expect)) {
      const a = pick(fac, sub);
      assert.ok(a, `${fac} ${sub}`);
      assert.equal(a.docId, doc);
      assert.equal(a.nodeTitle.replace(/\s+/g, ''), title.replace(/\s+/g, ''));
    }
  }
  // 현황분석 보고서가 없는 시설은 못 찾은 절로 올라온다
  const one = mapSections([docs[0]], loadTemplate(), {}, { facilities: FACS });
  const miss = one.unmatched.filter((u) => /삼산배수지/.test(u.targetId) && u.source === 'status');
  assert.equal(miss.length, Object.keys(expect).length);
  assert.ok(miss.every((u) => /현황분석 보고서가 등록되지 않음/.test(u.reason)));
  assert.ok(!one.unmatched.some((u) => /교동배수지/.test(u.targetId) && u.source === 'status'));
});

test('매핑 결과를 JSON·마크다운으로 내보낸다', { skip: skipUnless('설계1장') }, async () => {
  const res = mapSections([await load('설계1장', 'g1', 'design')], loadTemplate());
  const j = mappingToJson(res);
  assert.ok(Array.isArray(j.assignments) && Array.isArray(j.unmatched) && Array.isArray(j.generated));
  JSON.stringify(j);
  const md = mappingToMarkdown(res);
  assert.match(md, /## 대상 절 ← 원본 절/);
  assert.match(md, /## 못 찾은 절 \(\d+\)/);
  assert.match(md, /\[외부 자료 필요\]/);
  assert.match(md, /사업의 효과/);
});
