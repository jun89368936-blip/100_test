'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFile } = require('../src/ingest/parse');
const { buildOutline, findSections, sectionToMarkdown, collectImages, walk, classify, key } = require('../src/ingest/outline');
const { samples, skipUnless } = require('./samples');

const titles = (outline) => {
  const out = [];
  walk(outline.root, (n, d) => out.push(`${'  '.repeat(d)}${n.number} ${n.title}`));
  return out;
};

test('번호 패턴 분류', () => {
  assert.deepEqual(
    ['제1장 총 론', 'Ⅴ. 배수시설 조성계획', '1.0 사업의 개요', '1.1 과업의 목적', '1. 계획의 개요', '가. 개요', '1) 인구추정방법', '가) 과거인구 추이']
      .map((t) => classify(t).style),
    ['chapter', 'roman', 'n_dot', 'n_dot_n', 'n_dot', 'kor_dot', 'n_paren', 'kor_paren']
  );
  assert.equal(classify('본 과업은 설계에 필요한 모든 자료를 수집한다.'), null);
  assert.equal(key(' 총   론 '), '총론');
});

test('05_배수지 조성계획: 장→절→항 트리', { skip: skipUnless('조성계획') }, async () => {
  const d = await parseFile(samples.조성계획);
  const o = buildOutline(d);
  const top = o.root.children;
  assert.ok(top.length >= 1);
  const ch = top.find((n) => /배수시설 조성계획/.test(n.title));
  assert.ok(ch, titles(o).slice(0, 10).join('\n'));
  const sec = ch.children.map((c) => c.title);
  for (const want of ['계획의 개요', '용수수요량 산정', '배수지 시설계획', '건축계획', '사업계획']) {
    assert.ok(sec.some((s) => s.includes(want)), `절 '${want}' 없음: ${sec.join(' | ')}`);
  }
  const yong = findSections(o, /용수수요량 산정/)[0];
  assert.ok(yong.children.some((c) => /장래인구계획/.test(c.title)), '용수수요량 산정 아래 장래인구계획');
  assert.ok(yong.pageStart >= 1 && yong.pageEnd >= yong.pageStart);
});

test("'2. 용수수요량 산정' 절 마크다운에 장래인구 표가 들어 있다", { skip: skipUnless('조성계획') }, async () => {
  const d = await parseFile(samples.조성계획);
  const o = buildOutline(d);
  const yong = findSections(o, /용수수요량 산정/)[0];
  const used = new Set();
  const md = sectionToMarkdown(yong, { imagePrefix: 'doc1_', usedImages: used });
  assert.match(md, /^#+ 2\. 용수수요량 산정/);
  assert.match(md, /군･구별 장래 계획인구|장래 계획인구/);
  assert.match(md, /<table>|\| 구 분 \|/, '표가 마크다운에 있어야 함');
  assert.match(md, /2,985,400|3,296,600/, '장래인구 수치');
  // 이미지가 있으면 접두어가 붙고 바이트를 모을 수 있다
  const imgs = collectImages(d, md, 'doc1_');
  for (const ref of imgs.keys()) assert.ok(ref.startsWith('doc1_'));
});

test('제1장 총론: 과업의 목적·사업의 효과 절', { skip: skipUnless('설계1장') }, async () => {
  const d = await parseFile(samples.설계1장);
  const o = buildOutline(d);
  const t = titles(o);
  assert.ok(findSections(o, /과업의 목적/).length === 1, t.join('\n'));
  assert.ok(findSections(o, /사업의 효과/).length === 1, t.join('\n'));
  assert.ok(findSections(o, /시설물 개요/).length >= 1, t.join('\n'));
  const eff = findSections(o, /사업의 효과/)[0];
  const md = sectionToMarkdown(eff);
  assert.match(md, /상수도의 신뢰도 증진/);
});

test('환경성 검토서: 목차 나열이 본문 제목과 중복되지 않는다', { skip: skipUnless('환경성') }, async () => {
  const d = await parseFile(samples.환경성);
  const o = buildOutline(d);
  const all = [];
  walk(o.root, (n) => all.push(n));
  const gaeyo = all.filter((n) => /^사업의 개요$/.test(n.title));
  assert.equal(gaeyo.length, 1, `사업의 개요 제목이 ${gaeyo.length}번 나옴\n${titles(o).join('\n')}`);
  const top = o.root.children.map((c) => c.title);
  assert.ok(top.includes('사업의 개요') && top.includes('지역개황'), top.join(' | '));
});

test('교통성 검토서: 로마숫자 장 아래 번호·가나다 구조', { skip: skipUnless('교통성') }, async () => {
  const d = await parseFile(samples.교통성);
  const o = buildOutline(d);
  const rom = o.root.children.filter((c) => c.style === 'roman');
  assert.ok(rom.length >= 5, titles(o).slice(0, 12).join('\n'));
  const jo = rom.find((r) => /교통환경 조사분석/.test(r.title));
  assert.ok(jo && jo.children.some((c) => /도로 및 교통시설 현황/.test(c.title)));
});
