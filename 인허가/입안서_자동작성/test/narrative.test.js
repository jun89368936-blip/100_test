'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFile } = require('../src/ingest/parse');
const { buildOutline, key } = require('../src/ingest/outline');
const { extractFacts } = require('../src/extract/facts');
const { readParcelSheets } = require('../src/extract/parcels');
const { buildDecision } = require('../src/plan/decision');
const { buildNarrative, fillTemplate, facilityList, planList, loadPack, sectionToMd } = require('../src/plan/narrative');
const { samples, skipUnless } = require('./samples');

// 비교용: 공백·불릿을 없앤다(PDF 추출은 '결정(안 )'처럼 공백이 엉뚱하게 끼어 있다)
const flat = (s) => String(s).replace(/^[-\s]*○\s*/, '').replace(/\s+/g, '');

function fakeFacts(group = '수도공급설비', kind = '배수지') {
  const fac = (name, eup) => ({
    id: name,
    명칭: { value: name },
    종류: { value: kind },
    시설군: { value: group },
    위치: { value: `인천광역시 강화군 ${eup} 산1번지 일원`, 주소: { sido: '인천광역시', sigungu: '강화군', eupmyeon: eup } },
  });
  return {
    fields: { 결정권자: { value: '강화군수' }, 시설군: { value: group }, 목표연도: { value: 2040 }, 사업목표연도: { value: null, missing: true } },
    region: { 시도: { value: '인천광역시' }, 시군구: { value: '강화군' }, 읍면: ['교동면', '삼산면'] },
    facilities: [fac(`교동${kind}`, '교동면'), fac(`삼산${kind}`, '삼산면')],
  };
}

/** 설계보고서 개요 흉내: 제목과 문단만 */
function fakeOutline(sections) {
  const children = sections.map(([title, paras], i) => ({
    id: `n${i + 1}`, title, key: key(title), level: 1, pageStart: 3, children: [],
    blocks: paras.map((text) => ({ type: 'paragraph', text })),
  }));
  return [{ docId: 'design1', role: 'design', outline: { root: { id: 'root', children } } }];
}

test('변수 채우기: 없는 변수는 [작성 필요: 변수명], 시설·계획 목록 잇기', () => {
  const r = fillTemplate('{{가}}와 {{나}}', { 가: '하나' });
  assert.equal(r.text, '하나와 [작성 필요: 나]');
  assert.deepEqual([...r.missing], ['나']);
  assert.equal(facilityList(['교동배수지', '삼산배수지'], ['배수지', '배수지']), '교동 및 삼산배수지');
  assert.equal(facilityList(['가배수지', '나가압장'], ['배수지', '가압장']), '가배수지 및 나가압장');
  assert.equal(facilityList(['교동배수지'], ['배수지']), '교동배수지');
  assert.equal(planList(['A 계획', '「B 계획」']), '「A 계획」 및 「B 계획」');
});

test('라이브러리: 항목마다 needsReview·적용 시설이 있고, 하수 팩은 샘플 미검증', () => {
  for (const name of ['water-supply', 'sewer']) {
    const pack = loadPack(name);
    for (const e of pack.entries) {
      assert.equal(typeof e.needsReview, 'boolean', `${name}/${e.id}`);
      assert.ok(e.appliesTo && Array.isArray(e.appliesTo.facilityGroups), `${name}/${e.id}`);
    }
  }
  const water = loadPack('water-supply');
  for (const id of ['reason', 'effect', 'purpose', 'scope', 'procedure', 'laws', 'upper']) {
    assert.ok(water.entries.some((e) => e.id === id), id);
  }
  assert.equal(water.entries.find((e) => e.id === 'effect').items.length, 7);
  const sewer = loadPack('sewer');
  assert.equal(sewer.verified, false);
  assert.match(sewer.verifiedNote, /샘플 미검증/);
  assert.ok(['하수처리시설', '하수관로', '펌프장'].every((k) => sewer.terms.kinds.some((x) => x.includes(k))));
});

test('빈 변수는 출력에 [작성 필요: …] 로 남고 경고에 모인다', () => {
  const n = buildNarrative(fakeFacts());
  const reason = n.sections.reason.paragraphs.join('\n');
  assert.match(reason, /\[작성 필요: 급수지역\]/);
  assert.match(reason, /\[작성 필요: 상위계획목록\]/);
  assert.match(reason, /교동 및 삼산배수지 신설을 계획하였으며,$/m);
  assert.match(reason, /강화군 군관리계획\(군계획시설 : 수도공급설비\) 결정\(신설\)을 입안하고자 함\.$/);
  assert.match(n.sections.scope.time.join('\n'), /사업목표년도 : \[작성 필요: 사업목표연도\]년/);
  assert.ok(n.missing.includes('급수지역'));
  assert.ok(n.warnings.some((w) => /급수지역/.test(w)));
  assert.equal(n.pack.verified, true);
  assert.equal(n.sections.reason.source.kind, 'library');
});

test('설계보고서에 사업의 효과·과업의 목적이 있으면 먼저 쓰고, 어느 쪽을 썼는지 남긴다', () => {
  const outlines = fakeOutline([
    ['과업의 목적', ['현재 교동면은 내가 배수지로부터 공급 중이다.', '시설계획은 『2040 인천 수도정비기본계획(2022.6, 인천광역시)』와 『2045 인천 수도정비기본계획』을 검토하였다.', 'Ⅰ- 3']],
    ['사업의 효과', ['본 사업의 효과는 다음과 같다.', '○ 상수도 신뢰도 증진', '수요량 증가에 능동적으로 대처', 'Ⅱ - 3']],
  ]);
  const n = buildNarrative(fakeFacts(), { outlines });
  assert.equal(n.sections.effect.source.kind, 'design');
  assert.equal(n.sections.effect.intro, '본 사업의 효과는 다음과 같다.');
  assert.deepEqual(n.sections.effect.items, ['상수도 신뢰도 증진', '수요량 증가에 능동적으로 대처']);
  assert.equal(n.sections.purpose.source.kind, 'design');
  assert.equal(n.sections.purpose.paragraphs.length, 2);
  assert.equal(n.vars.상위계획목록, '「2040 인천 수도정비기본계획」 및 「2045 인천 수도정비기본계획」');
  assert.equal(n.vars.기존배수권역, '내가배수권역');
  assert.match(n.varSources.기존배수권역, /^design:design1:과업의 목적/);
  assert.deepEqual(n.log.find((l) => l.section === 'effect').used, 'design');

  // 사용자 입력이 설계보고서 값보다 우선
  const u = buildNarrative(fakeFacts(), { outlines, vars: { 상위계획목록: ['2040 수도정비 기본계획'] } });
  assert.equal(u.vars.상위계획목록, '「2040 수도정비 기본계획」');
  assert.equal(u.varSources.상위계획목록, 'user');

  // 라이브러리 강제 / 절이 없을 때
  const lib = buildNarrative(fakeFacts(), { outlines, prefer: { effect: 'library', purpose: 'library' } });
  assert.equal(lib.sections.effect.source.kind, 'library');
  assert.equal(lib.sections.effect.items.length, 7);
  assert.equal(lib.log.find((l) => l.section === 'purpose').used, 'library');
  assert.match(lib.sections.purpose.paragraphs[0], /\[작성 필요: 사업배경\]/);
});

test('하수 계열: 하수 팩 문안을 쓰고 샘플 미검증·검토 필요로 표시한다', () => {
  const n = buildNarrative(fakeFacts('하수도', '하수처리시설'));
  assert.equal(n.pack.id, 'sewer');
  assert.equal(n.pack.verified, false);
  assert.ok(n.warnings.some((w) => /샘플 미검증/.test(w)));
  assert.equal(n.sections.reason.needsReview, true);
  assert.match(n.sections.reason.paragraphs[0], /교동 및 삼산하수처리시설 신설/);
  assert.equal(n.sections.procedure.source.fallback, true);
  assert.equal(n.sections.laws.source.kind, 'none');
  assert.match(sectionToMd(n.sections.reason, 'reason'), /※ 검토 필요/);
});

test('결정조서가 있으면 결정구분·공간적 범위·재해영향 판정을 채우고 마크다운 표가 깨지지 않는다', () => {
  const facts = fakeFacts();
  const P = (소재지, 면적) => ({ 소재지, 지번: '산1', 지목: '임', 공부면적: 면적 * 2, 편입면적: 면적, 소유구분: '사유지' });
  const decision = buildDecision(facts, [P('강화군 교동면', 19341), P('강화군 삼산면', 4000)]);
  const n = buildNarrative(facts, { decision });
  assert.deepEqual(n.sections.scope.space[0], { 구분: '교동배수지', 위치: '강화군 교동면 산1번지 일원', 면적: '19,341㎡' });
  const law = n.sections.laws.laws.find((l) => l.법령 === '자연재해대책법').rows[0].결과;
  assert.match(law, /교동배수지 19,341㎡, 삼산배수지 4,000㎡ — 교동배수지은\(는\) 5천㎡ 이상/);
  const md = sectionToMd(n.sections.scope, 'scope');
  assert.match(md, /\| 구 분 \| 위 치 \| 면적\(㎡\) \| 비고 \|\n\| --- \| --- \| --- \| --- \|\n\| 교동배수지 \|/);
  assert.match(sectionToMd(n.sections.procedure, 'procedure'), /\| 군관리계획 입안 \| \[작성 필요: 입안기관\] \|/);
});

test('샘플: 설계보고서 1장 facts 로 만든 입안사유가 샘플 PDF 입안사유와 문장 단위로 일치', {
  skip: skipUnless('설계1장', '결정안', '입안신청서'),
  timeout: 600000,
}, async () => {
  const design = await parseFile(samples.설계1장);
  const facts = extractFacts([{ role: 'design', parsed: design }]);
  const outlines = [{ docId: '설계1장', role: 'design', outline: buildOutline(design) }];
  const { sheets } = readParcelSheets(await parseFile(samples.결정안));
  const decision = buildDecision(facts, sheets.flatMap((s) => s.parcels));

  // 보고서에서 자동으로 찾은 값
  const auto = buildNarrative(facts, { outlines, decision });
  assert.equal(auto.vars.상위계획목록, '「2040 인천 수도정비기본계획」 및 「2045 인천 수도정비기본계획」');
  assert.equal(auto.vars.기존배수권역, '내가배수권역');
  assert.equal(auto.vars.시설목록, '교동 및 삼산배수지');
  assert.equal(auto.sections.effect.source.kind, 'design');
  assert.equal(auto.sections.effect.items.length, 7);
  assert.equal(auto.sections.purpose.source.kind, 'design');
  assert.ok(auto.missing.includes('급수지역'), auto.missing.join(','));

  // 샘플 PDF 의 입안사유·기대효과
  const pdf = await parseFile(samples.입안신청서);
  const md = pdf.markdown;
  const reasonPart = md.slice(md.indexOf('■ 입안사유'), md.indexOf('■ 입안내용'));
  const expected = reasonPart.split('\n').filter((l) => /^-?\s*○/.test(l.trim())).map(flat);
  assert.equal(expected.length, 2);
  const effPart = md.slice(md.indexOf('■ 사업의 기대효과'), md.indexOf('결정(안 ) 도서'));
  const expectedItems = effPart.split('\n').filter((l) => /^∙/.test(l.trim())).map((l) => flat(l.replace(/^\s*∙/, '')));

  // 사용자가 화면에서 고쳐 넣는 값(샘플 문구)으로 채우면 샘플과 같아야 한다
  const n = buildNarrative(facts, {
    outlines, decision, prefer: { effect: 'library' },
    vars: { 급수지역: '강화도', 상위계획목록: ['2040 수도정비 기본계획', '2045 수도정비 기본계획(변경)'] },
  });
  assert.deepEqual(n.sections.reason.paragraphs.map(flat), expected);
  assert.deepEqual(n.sections.reason.missing, []);
  assert.deepEqual(n.sections.effect.items.map(flat), expectedItems);
});
