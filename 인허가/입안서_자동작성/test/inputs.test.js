'use strict';
// 사용자가 넣어 준 실제 입력(설계보고서 1~7장, 현황분석 보고서, 필지 엑셀)과 CSV 읽기 시험
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFile, splitCsv } = require('../src/ingest/parse');
const { buildOutline, walk } = require('../src/ingest/outline');
const { samples, skipUnless } = require('./samples');

test('현황분석 보고서(report.hwpx): ①~⑧ 장 트리 복원(한컴 글리프 원문자)', { skip: skipUnless('현황분석') }, async () => {
  const d = await parseFile(samples.현황분석);
  const o = buildOutline(d);
  const top = o.root.children.map((c) => c.title);
  assert.deepEqual(top, [
    '사업개요', '지형지세 현황', '생태 및 자연환경 현황', '토지이용 현황',
    '토지이용규제 현황', '건축물 현황', '공법제한 현황', '도시 및 주거환경 현황',
  ]);
  assert.deepEqual(o.root.children.map((c) => c.label), ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']);
  const first = o.root.children[0].children.map((c) => c.title);
  assert.deepEqual(first, ['위치 및 면적', '주변 개발사업 현황', '현황종합 및 입지제한']);
  const jihyeong = o.root.children[1].children.map((c) => c.title);
  assert.deepEqual(jihyeong, ['표고분석', '경사분석']);
});

test('설계보고서 2장: 연혁 목록 줄이 제목으로 잡히지 않는다', { skip: skipUnless('설계2장') }, async () => {
  const d = await parseFile(samples.설계2장);
  const o = buildOutline(d);
  const noisy = [];
  walk(o.root, (n) => { if (/^\d{4}\s+\d{1,2}\./.test(n.title) || /[∙⋅]/.test(n.title)) noisy.push(n.title); });
  assert.deepEqual(noisy, []);
  const ch = o.root.children.find((c) => /기초자료조사/.test(c.title) && c.children.length);
  assert.ok(ch, '제2장 노드');
  const sec = ch.children.map((c) => c.title);
  assert.ok(sec.some((t) => /조사목적/.test(t)) && sec.some((t) => /일반현황/.test(t)), sec.join(' | '));
});

test('설계보고서 1~7장 모두 읽히고 장별 1.0·2.0 구조가 나온다', {
  skip: skipUnless('설계1장', '설계2장', '설계3장', '설계4장', '설계5장', '설계6장', '설계7장'),
  timeout: 120000,
}, async () => {
  const expect = {
    설계1장: ['사업의 개요', '시설물 개요', '소요사업비', '사업의 효과'],
    설계3장: ['2040 인천시 수도정비기본계획', '2045 인천시 수도정비기본계획'],
    설계5장: ['개 요', '장래인구계획', '장래용수 수요량 산정'],
    설계7장: ['개 요', '계획목표년도', '계획급수구역', '용수수요량 산정', '배수지 신설계획', '송⋅배수시설 계획'],
  };
  for (const [key, want] of Object.entries(expect)) {
    const d = await parseFile(samples[key]);
    const o = buildOutline(d);
    const all = [];
    walk(o.root, (n) => all.push(n.title.replace(/\s+/g, '')));
    for (const w of want) {
      const k = w.replace(/\s+/g, '');
      assert.ok(all.some((t) => t.includes(k)), `${key}: '${w}' 절 없음 — ${all.slice(0, 12).join(' | ')}`);
    }
  }
});

test('필지 엑셀(1_estate_list.xlsx)이 시트별 표로 읽힌다', { skip: skipUnless('필지엑셀') }, async () => {
  const d = await parseFile(samples.필지엑셀);
  assert.equal(d.format, 'xlsx');
  const heads = d.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
  assert.deepEqual(heads, ['편입 토지', '미편입 인근토지', '편입 건축물', '미편입 인근건축물']);
  const tables = d.blocks.filter((b) => b.type === 'table');
  assert.equal(tables.length, 4);
  const header = tables[0].table.cells[0].map((c) => c.text);
  for (const h of ['PNU', '법정동', '지번', '지번구분', '지목', '공부면적(㎡)', '최종편입(㎡)', '소유자']) {
    assert.ok(header.includes(h), `헤더 '${h}' 없음: ${header.join(',')}`);
  }
  assert.equal(tables[0].table.rows, 179); // 헤더 + 178필지
});

test('CSV: UTF-8·CP949 모두 읽고 따옴표/쉼표 처리', async () => {
  const text = '지번,지목,면적\n"산4","임","1,234"\n5-1,대,22\n';
  assert.deepEqual(splitCsv(text), [['지번', '지목', '면적'], ['산4', '임', '1,234'], ['5-1', '대', '22']]);

  const f8 = path.join(os.tmpdir(), `csv_utf8_${process.pid}.csv`);
  fs.writeFileSync(f8, '﻿' + text, 'utf8');
  const fe = path.join(os.tmpdir(), `csv_euckr_${process.pid}.csv`);
  // '지번,지목\n산4,임' 을 CP949(euc-kr) 바이트로
  const eucBytes = Buffer.from([
    0xc1, 0xf6, 0xb9, 0xf8, 0x2c, 0xc1, 0xf6, 0xb8, 0xf1, 0x0a, // 지번,지목\n
    0xbb, 0xea, 0x34, 0x2c, 0xc0, 0xd3, 0x0a, // 산4,임\n
  ]);
  fs.writeFileSync(fe, eucBytes);
  try {
    const a = await parseFile(f8);
    assert.equal(a.format, 'csv');
    assert.equal(a.blocks[1].table.cells[0][0].text, '지번');
    assert.equal(a.blocks[1].table.cells[1][2].text, '1,234');
    const b = await parseFile(fe);
    assert.equal(b.blocks[1].table.cells[0][0].text, '지번');
    assert.equal(b.blocks[1].table.cells[1][0].text, '산4');
    assert.equal(b.blocks[1].table.cells[1][1].text, '임');
  } finally {
    fs.unlinkSync(f8);
    fs.unlinkSync(fe);
  }
});
