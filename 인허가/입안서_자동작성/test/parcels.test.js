'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFile } = require('../src/ingest/parse');
const { readParcels, readParcelSheets, aggregate, classifyOwner, normJimok, normJibun, percentages } = require('../src/extract/parcels');
const { samples, skipUnless } = require('./samples');

test('지목 약칭·지번·소유구분 정규화', () => {
  assert.equal(normJimok('임야'), '임');
  assert.equal(normJimok('대지'), '대');
  assert.equal(normJimok('공장용지'), '장');
  assert.equal(normJimok('주차장'), '차');
  assert.equal(normJimok('도'), '도');
  assert.equal(normJibun('4', '산'), '산4');
  assert.equal(normJibun('산 4', '산'), '산4');
  assert.equal(normJibun('197-1번지', '일반'), '197-1');
  assert.equal(classifyOwner('개인'), '사유지');
  assert.equal(classifyOwner('국유지'), '국유지');
  assert.equal(classifyOwner('대한민국'), '국유지');
  assert.equal(classifyOwner('군유지'), '공유지');
  assert.equal(classifyOwner('강화군'), '공유지');
  assert.equal(classifyOwner('인천광역시'), '공유지');
  assert.equal(classifyOwner('홍길동'), '사유지');
  assert.equal(classifyOwner('㈜대한건설'), '사유지');
  assert.equal(classifyOwner(''), '미상');
});

test('비율은 소수 첫째 자리이고 합이 100.0', () => {
  for (const vals of [[297, 19044], [10019, 221, 725], [1, 1, 1], [5, 3, 2], [100]]) {
    const p = percentages(vals);
    const s = Math.round(p.reduce((a, b) => a + b, 0) * 10) / 10;
    assert.equal(s, 100, `${vals} → ${p}`);
  }
  assert.deepEqual(percentages([297, 19044]), [1.5, 98.5]);
  assert.deepEqual(percentages([10019, 221, 725]).map((x) => x), [91.4, 2, 6.6]);
});

test('샘플 입안서의 편입토지조서 표(교동 5필지·삼산 3필지) 읽기 + 집계', { skip: skipUnless('결정안') }, async () => {
  const d = await parseFile(samples.결정안);
  const { sheets } = readParcelSheets(d);
  assert.equal(sheets.length, 2, `표 ${sheets.length}개`);
  const [gd, ss] = sheets.map((s) => s.parcels);
  assert.equal(gd.length, 5);
  assert.equal(ss.length, 3);
  assert.deepEqual(gd.map((p) => p.지번), ['산4', '산3', '산151', '557', '558']);
  assert.deepEqual(gd.map((p) => p.지목), ['임', '임', '임', '대', '대']);
  assert.deepEqual(gd.map((p) => p.편입면적), [6751, 4801, 7492, 273, 24]);
  assert.equal(gd[0].소재지, '강화군 교동면 상용리');

  const a = aggregate(gd);
  assert.deepEqual(a.합계, { 필지수: 5, 공부면적: 48150, 편입면적: 19341 });
  assert.deepEqual(a.지목별, [
    { 지목: '대', 필지수: 2, 편입면적: 297, 비율: 1.5 },
    { 지목: '임', 필지수: 3, 편입면적: 19044, 비율: 98.5 },
  ]);
  // 소유자 열이 비어 있는 샘플 → 미상 경고
  assert.ok(a.warnings.some((w) => /소유자를 알 수 없는/.test(w)));

  const b = aggregate(ss);
  assert.deepEqual(b.합계, { 필지수: 3, 공부면적: 116507, 편입면적: 10965 });
  assert.deepEqual(b.지목별, [
    { 지목: '도', 필지수: 1, 편입면적: 725, 비율: 6.6 },
    { 지목: '임', 필지수: 1, 편입면적: 10019, 비율: 91.4 },
    { 지목: '전', 필지수: 1, 편입면적: 221, 비율: 2 },
  ]);
});

test('여수 샘플 1_estate_list.xlsx: 편입 토지 178필지, 산 지번, 소유구분, 합계', { skip: skipUnless('필지엑셀') }, async () => {
  const d = await parseFile(samples.필지엑셀);
  const { parcels, outside, sheets } = readParcels(d);
  assert.deepEqual(sheets.map((s) => `${s.kind}:${s.name}`), ['편입:편입 토지', '미편입:미편입 인근토지']);
  assert.equal(parcels.length, 178);
  assert.equal(outside.length, 49);
  const p0 = parcels[0];
  assert.equal(p0.소재지, '전라남도 여수시 화정면 여자리');
  assert.equal(p0.지번, '197');
  assert.equal(p0.지목, '전');
  assert.equal(p0.공부면적, 1012);
  assert.equal(p0.편입면적, 1012);
  assert.equal(p0.편입구분, '완전');
  assert.equal(p0.소유구분, '사유지');
  assert.equal(p0.PNU, '4613035030101970000');
  assert.equal(p0.공시지가, 5740);
  // 산 지번에는 '산' 이 붙는다
  const san = parcels.filter((p) => p.지번.startsWith('산'));
  assert.ok(san.length > 0, '산 지번 없음');

  const a = aggregate(parcels);
  assert.equal(a.합계.필지수, 178);
  const sumPct = (rows) => Math.round(rows.reduce((s, r) => s + r.비율, 0) * 10) / 10;
  assert.equal(sumPct(a.지목별), 100);
  assert.equal(sumPct(a.소유자별.filter((r) => r.필지수 > 0)), 100);
  assert.equal(a.합계.편입면적, Math.round(parcels.reduce((s, p) => s + p.편입면적, 0) * 100) / 100);
  // 지목은 모두 약칭이다
  for (const j of a.지목별) assert.ok(j.지목.length === 1, `지목 약칭 아님: ${j.지목}`);
  // 현황분석 보고서의 필지수(178)와 같다
});

test('필지 표가 없는 문서는 경고만 하고 비어 있다', { skip: skipUnless('조성계획') }, async () => {
  const d = await parseFile(samples.조성계획);
  const r = readParcels(d);
  assert.deepEqual(r.parcels, []);
  assert.ok(r.warnings.length >= 1);
});

test('aggregate 경고: 편입 > 공부, 중복 지번, 소유 미상', () => {
  const mk = (지번, 공부, 편입, 소유자) => ({ 소재지: 'A리', 지번, 지목: '임', 공부면적: 공부, 편입면적: 편입, 소유자, 소유구분: classifyOwner(소유자) });
  const a = aggregate([mk('1', 100, 150, '개인'), mk('1', 50, 50, ''), mk('2', 10, 10, '국유지')]);
  assert.ok(a.warnings.some((w) => /편입면적\(150\)이 공부면적\(100\)보다 큽니다/.test(w)));
  assert.ok(a.warnings.some((w) => /같은 지번이 두 번/.test(w)));
  assert.ok(a.warnings.some((w) => /소유자를 알 수 없는/.test(w)));
  assert.deepEqual(a.소유자별.map((r) => r.소유구분), ['국유지', '공유지', '사유지', '미상']);
  assert.equal(a.소유자별[1].필지수, 0); // 공유지 없음 → 0
});
