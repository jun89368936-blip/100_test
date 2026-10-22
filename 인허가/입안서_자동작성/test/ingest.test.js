'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFile, IngestError } = require('../src/ingest/parse');
const { samples, skipUnless } = require('./samples');

test('없는 파일은 한국어 오류', async () => {
  await assert.rejects(() => parseFile(path.join(os.tmpdir(), '없는파일.hwp')), (e) => {
    assert.ok(e instanceof IngestError);
    assert.match(e.message, /찾을 수 없습니다/);
    return true;
  });
});

test('지원하지 않는 확장자는 한국어 오류', async () => {
  const f = path.join(os.tmpdir(), `ingest_test_${process.pid}.txt`);
  fs.writeFileSync(f, 'hello');
  try {
    await assert.rejects(() => parseFile(f), (e) => {
      assert.ok(e instanceof IngestError);
      assert.match(e.message, /지원하지 않는 형식/);
      return true;
    });
  } finally {
    fs.unlinkSync(f);
  }
});

test('빈 파일은 한국어 오류', async () => {
  const f = path.join(os.tmpdir(), `ingest_empty_${process.pid}.hwp`);
  fs.writeFileSync(f, '');
  try {
    await assert.rejects(() => parseFile(f), /빈 파일/);
  } finally {
    fs.unlinkSync(f);
  }
});

test('깨진 HWP 는 읽기 오류를 한국어로 알린다', async () => {
  const f = path.join(os.tmpdir(), `ingest_bad_${process.pid}.hwp`);
  fs.writeFileSync(f, Buffer.from('이건 한글 파일이 아닙니다'));
  try {
    await assert.rejects(() => parseFile(f), (e) => {
      assert.ok(e instanceof IngestError);
      assert.match(e.message, /읽/);
      return true;
    });
  } finally {
    fs.unlinkSync(f);
  }
});

test('설계보고서 제1장 총론(HWP) 읽기', { skip: skipUnless('설계1장') }, async () => {
  const d = await parseFile(samples.설계1장);
  assert.match(d.name, /^제1장 총론/);
  assert.ok(d.blocks.length > 50, `blocks=${d.blocks.length}`);
  assert.ok(d.blocks.some((b) => b.type === 'heading'), '제목 블록이 있어야 함');
  assert.ok(d.blocks.some((b) => b.type === 'table'), '표 블록이 있어야 함');
  assert.ok(d.pageCount >= 3, `pageCount=${d.pageCount}`);
  assert.ok(d.images.size >= 1);
  for (const [name, buf] of d.images) {
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0, `이미지 ${name} 바이트가 비어 있음`);
  }
  assert.match(d.markdown, /과업의 목적/);
});

test('05_배수지 조성계획(HWP, 이미지 다수) 읽기', { skip: skipUnless('조성계획') }, async () => {
  const d = await parseFile(samples.조성계획);
  assert.ok(d.blocks.length > 300);
  const heads = d.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
  assert.ok(heads.some((t) => /용수수요량 산정/.test(t)), heads.slice(0, 10).join(' | '));
  assert.ok(d.images.size >= 40, `images=${d.images.size}`);
  assert.equal(d.format, 'hwp');
});

test('HWPX 읽기', { skip: skipUnless('hwpx') }, async () => {
  const d = await parseFile(samples.hwpx);
  assert.equal(d.format, 'hwpx');
  assert.ok(d.blocks.length > 0);
  assert.ok(d.markdown.length > 0);
});
