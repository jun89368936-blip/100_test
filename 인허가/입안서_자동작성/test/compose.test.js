'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadTemplate } = require('../src/plan/mapper');
const { buildToc, tocToMarkdown } = require('../src/compose/toc');
const { composePackage, loadChapters } = require('../src/compose');
const { loadProject, prepare } = require('../src/compose/context');
const { markdownToHtml } = require('../src/preview/markdown');
const { samples, skipUnless } = require('./samples');

const VARS = { 계획: '군관리계획', 시설군: '수도공급설비' };

/** 샘플 입안서와 비교하는 시험용 프로젝트: 필지는 샘플 결정안 표(교동 5필지·삼산 3필지)만 쓴다 */
function sampleProject() {
  const project = loadProject(path.join(__dirname, '..', 'examples', '교동삼산.project.json'));
  project.parcels = [{ file: samples.결정안 }];
  return project;
}

test('목차: 샘플 목차와 같은 장·절 구성', () => {
  const toc = buildToc(loadTemplate(), VARS);
  assert.deepEqual(toc.chapters.map((c) => `${c.number}. ${c.title}`), [
    'Ⅰ. 군관리계획 결정(안)', 'Ⅱ. 계획의 개요', 'Ⅲ. 상위 및 관련계획 검토', 'Ⅳ. 현황 및 여건분석',
    'Ⅴ. 배수시설 조성계획', 'Ⅵ. 기초자료 조사서', 'Ⅶ. 편입토지조서 및 용지도', 'Ⅷ. 첨부서류',
  ]);
  const sub = (n) => toc.chapters.find((c) => c.number === n).children.map((c) => c.title);
  assert.deepEqual(sub('Ⅰ'), ['군관리계획(시설: 수도공급설비) 결정 조서', '군관리계획(시설: 수도공급설비) 결정(안)도']);
  assert.deepEqual(sub('Ⅱ'), ['계획의 개요', '계획의 수립절차']);
  assert.deepEqual(sub('Ⅲ'), ['상위계획 검토', '관련계획 검토', '관련법규 검토']);
  assert.deepEqual(sub('Ⅴ'), ['계획의 개요', '용수수요량 산정', '배수지 시설설계', '건축계획', '부분별계획', '사업계획']);
  assert.deepEqual(sub('Ⅵ'), ['환경성 검토서', '교통성 검토서', '경관성 검토서']);
  assert.deepEqual(sub('Ⅶ'), ['편입토지조서 및 용지도', '토지대장']);
  assert.deepEqual(sub('Ⅷ'), ['배수지 설계도']);
  // 샘플 목차에는 빠져 있지만 본문에 있는 절(Ⅳ.3)은 목차에도 넣는다
  assert.deepEqual(sub('Ⅳ'), ['일반 현황', '인문·사회현황', '계획대상지 현황분석']);

  const md = tocToMarkdown(toc);
  assert.match(md, /^# 목　　차/);
  assert.match(md, /### Ⅰ\. 군관리계획 결정\(안\)\n\n1\. 군관리계획\(시설: 수도공급설비\) 결정 조서/);
  assert.match(md, /### Ⅷ\. 첨부서류\n\n◯ 배수지 설계도/);
  // 변수를 모르면 [작성 필요]
  assert.match(tocToMarkdown(buildToc(loadTemplate(), {})), /\[작성 필요: 계획\] 결정\(안\)/);
});

test('장별 작업 목록: 모든 장이 골격에 있고 상태가 정해진 값', () => {
  const chapters = loadChapters();
  const t = loadTemplate();
  const ids = new Set(t.documents.flatMap((d) => [d.id, ...d.targets.map((x) => x.id)]));
  for (const c of chapters) {
    assert.ok(ids.has(c.id), c.id);
    assert.ok(['대기', '작업중', '완료'].includes(c.status), `${c.id}: ${c.status}`);
  }
  assert.equal(new Set(chapters.map((c) => c.id)).size, chapters.length);
});

test('미리보기 마크다운: 표·인용·목록·표시 칠하기, 원본 표는 병합 속성만 남긴다', () => {
  const html = markdownToHtml([
    '# 제목', '> 안내', '- 하나 [작성 필요: 위치]', '| 가 | 나 |', '| --- | --- |', '| 1<br>2 | [외부 자료 필요: 사진] |',
    '<table><tr><td rowspan="2" onclick="x()">셀</td><td><script>bad()</script></td></tr></table>', '![image](설계1장/image_001.jpg)', '<b>글</b>',
  ].join('\n'), { imgBase: '/img/' });
  assert.match(html, /<h1>제목<\/h1>/);
  assert.match(html, /<blockquote>안내<\/blockquote>/);
  assert.match(html, /<li>하나 <mark class="need">\[작성 필요: 위치\]<\/mark><\/li>/);
  assert.match(html, /<td>1<br>2<\/td><td><mark class="ext">/);
  assert.match(html, /<td rowspan="2">셀<\/td>/);
  assert.doesNotMatch(html, /onclick|<script/);
  assert.match(html, /src="\/img\/%EC%84%A4%EA%B3%841%EC%9E%A5\/image_001\.jpg"/);
  assert.match(html, /&lt;b&gt;글&lt;\/b&gt;/);
});

test('샘플 프로젝트 조립: 목차는 완성 장, 나머지는 들어갈 재료 초안', {
  skip: skipUnless('설계1장', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  // 시험 시간을 줄이려고 설계보고서는 1장만 쓴다
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.status = [];
  const ctx = await prepare(project);
  const out = composePackage(ctx);
  const toc = out.parts.find((p) => p.id === 'pkg.toc');
  assert.equal(toc.built, true);
  assert.match(toc.markdown, /### Ⅰ\. 군관리계획 결정\(안\)/);
  assert.equal(toc.flags.작성필요, 0);

  const p8draft = out.parts.find((p) => p.id === 'pkg.8');
  assert.equal(p8draft.built, false);
  assert.match(p8draft.markdown, /> 아직 조립하지 않은 장입니다/);
  const p6 = out.parts.find((p) => p.id === 'pkg.6');
  assert.equal(p6.built, false);
  assert.match(p6.markdown, /## 1\. 환경성 검토서\n\n- 자동 생성/);
  const p8 = out.parts.find((p) => p.id === 'pkg.8');
  assert.match(p8.markdown, /\[외부 자료 필요: 배수지 설계도\]/);
  assert.ok(out.parts.every((p) => !p.error), out.warnings.join('\n'));
  assert.equal(ctx.parcels.length, 8);
});

test('Ⅰ. 결정(안) 장: 간지 → 조서·사유서(시설 종류별) → 결정(안)도(그림 또는 외부 자료)', {
  skip: skipUnless('설계1장', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.status = [];
  const ctx = await prepare(project);
  const part = composePackage(ctx).parts.find((p) => p.id === 'pkg.1');
  assert.equal(part.built, true);
  const md = part.markdown;
  const order = ['# Ⅰ. 군관리계획 결정(안)', '## 강화 군관리계획(시설: 수도공급설비) 결정(안)',
    '### 1. 군관리계획(시설: 수도공급설비) 결정 조서 및 사유서', '#### 가. 수도공급설비(배수지)', '▣ 결정(변경) 사유서',
    '### 2. 군관리계획 결정(안)도 : 첨부도면 별첨', '#### 교동배수지 결정(안)도', '#### 삼산배수지 결정(안)도'];
  const at = order.map((h) => md.indexOf(h));
  assert.ok(at.every((i) => i >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.match(md, /1\. 군관리계획\(시설: 수도공급설비\) 결정 조서<br>2\. 군관리계획\(시설: 수도공급설비\) 결정\(안\)도/);
  assert.match(md, /<td>증\)19,341<\/td><td>19,341<\/td>/);
  // 사유서: 같은 사유는 한 칸, 삼산 결정내용은 삼산배수지(샘플 PDF 는 '교동배수지 신설'로 잘못 적음)
  assert.match(md, /<td rowspan="2">교동면 및 삼산면 일대 안정적인 수도 공급을 위한 배수지 신설<\/td>/);
  assert.match(md, /･ 삼산배수지 신설<br>･ 위치 : 강화군 삼산면 석모리 산70번지 일원<br>･ 면적 : 10,965㎡/);
  assert.equal(part.flags.외부자료, 2);
  assert.ok(part.notes.some((n) => /"drawings"/.test(n)));

  // 결정(안)도 그림을 지정하면 그림이 들어가고 외부 자료 표시가 사라진다
  const png = path.join(require('os').tmpdir(), `ipansuh-drawing-${process.pid}.png`);
  require('fs').writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
  project.drawings = { 교동배수지: png, 삼산배수지: png };
  const ctx2 = await prepare(project);
  const part2 = composePackage(ctx2).parts.find((p) => p.id === 'pkg.1');
  assert.equal(part2.flags.외부자료, 0);
  assert.match(part2.markdown, /!\[교동배수지 결정\(안\)도\]\(첨부\/교동배수지\.png\)/);
  assert.ok(ctx2.attachments.parsed.images.get('교동배수지.png').length > 0);
  require('fs').unlinkSync(png);
});

test('Ⅱ. 계획의 개요 장: 명칭~내용적 범위, 위치도 그림, 수립절차 표', {
  skip: skipUnless('설계1장', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.status = [];
  const ctx = await prepare(project);
  const part = composePackage(ctx).parts.find((p) => p.id === 'pkg.2');
  assert.equal(part.built, true);
  const md = part.markdown;
  const order = ['# Ⅱ. 계획의 개요', '## 1. 계획의 개요', '### 가. 계획의 명칭', '### 나. 계획시행자',
    '### 다. 군관리계획(시설: 수도공급설비) 결정권자', '### 라. 계획의 범위', '∙ 공간적 범위', '∙ 시간적 범위',
    '### 마. 계획의 목적', '< 위치도 >', '### 바. 내용적 범위', '## 2. 계획의 수립절차'];
  const at = order.map((h) => md.indexOf(h));
  assert.ok(at.every((i) => i >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.match(md, /∙ 사업명 : 교동·삼산배수지 건설공사/);
  assert.match(md, /\| 교동배수지 \| 강화군 교동면 상용리 산4번지 일원 \| 19,341㎡ \|  \|/);
  assert.match(md, /- 계획목표년도 : 2040년\n- 사업목표년도 : \[작성 필요: 사업목표연도\]년/);
  // 계획의 목적은 설계보고서 '과업의 목적' 3문단, 위치도는 '과업대상지역' 그림(괄호·공백이 든 문서 id 는 인코딩)
  assert.equal((md.match(/^∙ (현재|시설계획은|이에)/gm) || []).length, 3);
  assert.match(md, /!\[위치도\]\(%EC%A0%9C1%EC%9E%A5%20%EC%B4%9D%EB%A1%A0%28%EC%99%84%29\/image_002\.jpg\)/);
  assert.match(md, /\| 계획의 개요 \| ⦁ 계획의 배경 및 목적<br>⦁ 계획의 범위<br>⦁ 계획의 수립절차 \|/);
  assert.match(md, /\| 2\. 군관리계획 입안 \| \[작성 필요: 입안기관\] \|/);
  assert.ok(part.notes.some((n) => /결정권자 '강화군수'는 .*추정/.test(n)), part.notes.join('\n'));
  assert.ok(part.notes.some((n) => /채울 값.*결정권자주소.*입안기관/.test(n)), part.notes.join('\n'));
  // 미리보기에서 그림 주소가 서버 경로로 바뀐다
  assert.match(markdownToHtml(md, { imgBase: '/img/' }), /src="\/img\/%EC%A0%9C1%EC%9E%A5%20%EC%B4%9D%EB%A1%A0\(%EC%99%84\)\/image_002\.jpg"/);
});

test('원본 절 옮기기: 번호를 입안서 체계로, 장식 그림·쪽번호 줄은 빼고 그림 경로는 문서 id 로', () => {
  const { transplant } = require('../src/compose/md');
  const { planKey } = require('../src/compose/chapters/plans');
  const P = (text) => ({ type: 'paragraph', text });
  const leaf = (title, blocks) => ({ title, blocks, children: [] });
  const node = { title: '2040 수도정비기본계획', blocks: [P('본문'), P('Ⅲ - 2')], children: [
    { title: '과업의 범위', blocks: [P('![image](deco.jpg) 범위'), P('![image](map.png)')], children: [leaf('계획기간', [P('2040년')])] },
    leaf('과업의 목적', [P('목적')]),
  ] };
  const big = Buffer.alloc(10);
  const doc = { docId: '제3장 관련(완)', parsed: { images: new Map([['deco.jpg', big], ['map.png', big]]), markdown: '![a](deco.jpg) ![a](deco.jpg) ![a](deco.jpg) ![a](map.png)' } };
  const md = transplant(doc, node, { level: 3, index: 1 });
  assert.match(md, /^### 나\. 2040 수도정비기본계획\n\n본문\n\n#### 1\) 과업의 범위/);
  assert.match(md, /##### 가\) 계획기간\n\n2040년/);
  assert.match(md, /#### 2\) 과업의 목적/);
  assert.doesNotMatch(md, /Ⅲ - 2|deco\.jpg/);
  assert.match(md, /!\[image\]\(%EC%A0%9C3%EC%9E%A5%20%EA%B4%80%EB%A0%A8%28%EC%99%84%29\/map\.png\)/);
  assert.equal(planKey('2040 인천시 수도정비기본계획(2022. 06)'), planKey('2040 인천 수도정비 기본계획(2022.06)'));
  assert.notEqual(planKey('2040 인천시 수도정비기본계획'), planKey('2045 인천시 수도정비기본계획'));
});

test('Ⅲ. 상위 및 관련계획 검토 장: 관련계획은 설계보고서에서 옮기고, 없는 절은 문안 + [작성 필요]', {
  skip: skipUnless('설계1장', '설계3장', '설계5장', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제[135]장/.test(d.file));
  project.status = [];
  const ctx = await prepare(project);
  const part = composePackage(ctx).parts.find((p) => p.id === 'pkg.3');
  assert.equal(part.built, true);
  const md = part.markdown;
  const order = ['# Ⅲ. 상위 및 관련계획 검토', '## 1. 상위계획 검토', '### 가. 국토종합계획', '### 나. 인천광역시 도시기본계획',
    '## 2. 관련계획 검토', '### 가. 2040 인천시 수도정비기본계획(2022. 06)', '#### 1) 과업의 목적',
    '### 나. 2045 인천시 수도정비기본계획(2025. 07, 수립중)', '## 3. 관련법규 검토', '### 가. 국토의 계획 및 이용에 관한 법률',
    '### 마. 수도법', '### 기초조사 항목 검토'];
  const at = order.map((h) => md.indexOf(h));
  assert.ok(at.every((i) => i >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // 관련계획에 수도정비기본계획이 있으면 상위계획 머리글에서는 빠지고, 5장의 같은 계획은 한 번만
  assert.doesNotMatch(md.slice(0, md.indexOf('## 2. 관련계획 검토')), /수도정비/);
  assert.equal((md.match(/^### .*2040 인천.*수도정비/gm) || []).length, 1);
  assert.ok(part.notes.some((n) => /이미 옮긴 계획과 같아서 뺐습니다/.test(n)));
  assert.match(md, /\[작성 필요: 국토종합계획 본문/);
  assert.match(md, /\| 재해영향평가 \| 「자연재해대책법」시행령 제6조 \| ○ \| 사업면적 5천㎡ 이상으로 재해영향평가 대상 \|/);
  // 현황분석 보고서가 없으면 용도지역을 몰라 판정은 [작성 필요]
  assert.match(md, /\| 토지적성평가 \| .* \| \[작성 필요\] \| 교동배수지: \[작성 필요: 대상 판정 — 용도지역 면적을 모름\]/);
  // 관련계획은 목적·범위와 시설계획 중 교동·삼산 부분만 남긴다
  const related = md.slice(md.indexOf('## 2. 관련계획 검토'), md.indexOf('## 3. 관련법규 검토'));
  for (const h of ['#### 1) 과업의 목적', '#### 2) 과업의 범위', '#### 3) 시설확충계획', '(1) 교동 배수지', '(2) 삼산 배수지']) assert.ok(related.includes(h), h);
  for (const h of ['용수수요량 산정', '계획급수인구', '화도 배수지', '내가 배수지', '사업시행계획']) assert.ok(!related.includes(h), h);
  assert.ok(related.length < 10000, related.length);
  assert.ok((related.match(/!\[/g) || []).length >= 2, '시설 절의 그림은 남는다');
  assert.ok(part.notes.some((n) => /남김 — 과업의 목적, 과업의 범위, 시설확충계획 \/ 뺌 — .*용수수요량 산정/.test(n)), part.notes.join('\n'));

  // project.json "trim": {"pkg.3.2": false} 면 통째로 옮긴다
  project.trim = { 'pkg.3.2': false };
  const all = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.3').markdown;
  assert.match(all, /용수수요량 산정/);
  assert.match(all, /화도 배수지/);
});

test('필요한 부분만 남기기: keep 규칙 절만, 시설 규칙 절 안에서는 이 사업 시설과 그 위 절만', () => {
  const { trimSection } = require('../src/compose/md');
  const n = (title, children = []) => ({ title, blocks: [], children });
  const root = n('2040 수도정비기본계획', [
    n('과업의 목적'), n('과업의 범위', [n('계획기간')]), n('용수수요량 산정', [n('원단위')]),
    n('시설확충계획', [n('사업시행계획'), n('배수지 신·증설 계획', [n('화도 배수지'), n('교동 배수지', [n('시설개요')]), n('삼산 배수지')])]),
  ]);
  const keep = [{ re: '(과업|계획)의\\s*목적' }, { re: '(과업|계획)의\\s*범위' }, { re: '시설\\s*(확충|정비)\\s*계획', only: 'facility' }];
  const t = trimSection(root, keep, ['교동배수지', '삼산배수지']);
  const titles = (x) => [x.title, ...x.children.flatMap(titles)];
  assert.deepEqual(titles(t.node), ['2040 수도정비기본계획', '과업의 목적', '과업의 범위', '계획기간', '시설확충계획', '배수지 신·증설 계획', '교동 배수지', '시설개요', '삼산 배수지']);
  assert.deepEqual(t.kept, ['과업의 목적', '과업의 범위', '시설확충계획']);
  assert.deepEqual(t.dropped.sort(), ['사업시행계획', '용수수요량 산정', '화도 배수지'].sort());
  assert.equal(root.children.length, 4, '원본은 그대로');
  // 시설계획에 이 사업 시설이 없으면 그 절은 뺀다, 남길 절이 하나도 없으면 null
  assert.ok(!titles(trimSection(root, keep, ['가평배수지']).node).includes('시설확충계획'));
  assert.equal(trimSection(n('다른 계획', [n('개요')]), keep, []).node, null);
});

test('필요한 부분만 남기기: children 규칙으로 하위 절도 거르고, flatten 이면 한 단계 끌어올린다', () => {
  const { trimSection, transplant } = require('../src/compose/md');
  const n = (title, children = [], number = '') => ({ title, number, blocks: [], children });
  const root = n('일반현황', [n('지역의 연혁'), n('지역의 개황', [n('위  치'), n('행정구역 면적'), n('지형 및 지세')]), n('기상개황', [n('기온')]), n('사회적 특성', [n('인구현황')])]);
  const t = trimSection(root, [
    { re: '^지역의?\\s*개황$', flatten: true, children: [{ re: '위\\s*치' }, { re: '지형' }] }, { re: '기상' },
  ]);
  assert.deepEqual(t.node.children.map((c) => c.title), ['위  치', '지형 및 지세', '기상개황']);
  assert.deepEqual(t.kept, ['지역의 개황 › 위  치', '지역의 개황 › 지형 및 지세', '기상개황']);
  assert.ok(t.dropped.includes('행정구역 면적') && t.dropped.includes('사회적 특성'));
  // 각주('주 …')는 제목이 아니라 글이고 번호를 차지하지 않는다
  const doc = { docId: 'd', parsed: { images: new Map(), markdown: '' } };
  const md = transplant(doc, n('인구', [n('외국인 제외', [], '주'), n('세대수')]), { level: 3, index: 0 });
  assert.match(md, /주\) 외국인 제외\n\n#### 1\) 세대수/);
});

test('지목별·소유별 현황: 편입토지 집계 문장·표, 소유자 미상은 [작성 필요]', () => {
  const { parcelTables } = require('../src/compose/chapters/status');
  const P = (지목, 면적, 소유구분, 소유자) => ({ 소재지: '교동면', 지번: String(면적), 지목, 공부면적: 면적, 편입면적: 면적, 소유구분, 소유자 });
  const t = parcelTables([P('임', 9000, '공유지', '강화군'), P('대', 1000, '사유지', '홍길동'), P('임', 100, '미상')], '교동배수지');
  assert.match(t.jimokMd, /전체면적 10,100㎡\(100\.0%\) 중 임이 9,100㎡\(90\.1%\), 대가 1,000㎡\(9\.9%\)로 되어 있음/);
  assert.match(t.jimokMd, /\| 합 계 \| 3 \| 10,100 \| 100\.0 \|  \|\n\| 임 \| 2 \| 9,100 \| 90\.1 \|/);
  assert.match(t.ownerMd, /공유지는 9,000㎡\(89\.1%\), 사유지는 1,000㎡\(9\.9%\)를 차지하고 있음 \[작성 필요: 소유자 미상 1필지 100㎡/);
  assert.match(t.ownerMd, /\| 공유지 \| 1 \| 9,000 \| 89\.1 \| 강화군 \|/);
  assert.match(t.ownerMd, /\| 국유지 \| - \| - \| - \|  \|/);
});

test('Ⅳ. 현황 및 여건분석 장: 설계보고서에서 필요한 절만, 시설별 현황분석, 지목·소유는 편입토지로', {
  skip: skipUnless('설계1장', '설계2장', '현황분석', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제[12]장/.test(d.file));
  const ctx = await prepare(project);
  const part = composePackage(ctx).parts.find((p) => p.id === 'pkg.4');
  assert.equal(part.built, true);
  const md = part.markdown;
  const order = ['# Ⅳ. 현황 및 여건분석', '## 1. 일반 현황', '### 가. 위  치', '### 나. 지형 및 지세', '### 라. 기상개황',
    '## 2. 인문·사회현황', '### 가. 행정구역 및 인구현황', '### 다. 토지이용현황', '## 3. 계획대상지 현황분석',
    '### 가. 교동배수지', '#### 1) 광역입지여건 분석', '##### 가) 표고분석', '##### 나) 경사분석', '##### 다) 생태자연도',
    '##### 가) 지목별현황', '##### 나) 소유별현황', '###### (1) 용도지역 현황', '#### 4) 현황종합분석', '### 나. 삼산배수지'];
  const at = order.map((h) => md.indexOf(h));
  assert.ok(at.every((i) => i >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  const general = md.slice(md.indexOf('## 1. 일반 현황'), md.indexOf('## 2. 인문·사회현황'));
  for (const h of ['지진발생', '지역의 연혁', '행정구역 및 인구']) assert.ok(!general.includes(h), h);
  assert.doesNotMatch(md, /#### \d\) 외국인 세대수/);
  assert.match(md, /교동배수지의 지목별 분포현황은 전체면적 19,341㎡\(100\.0%\) 중 임이 19,044㎡\(98\.5%\), 대가 297㎡\(1\.5%\)/);
  // 삼산은 현황분석 보고서가 없어 [작성 필요], 지목별은 편입토지로 채워진다
  const samsan = md.slice(md.indexOf('### 나. 삼산배수지'));
  assert.match(samsan, /\[작성 필요: 삼산배수지 표고분석 — 현황분석 보고서가 등록되지 않음\]/);
  assert.match(samsan, /삼산배수지의 지목별 분포현황은 전체면적 10,965㎡/);
  assert.ok(part.notes.some((n) => /교동배수지 현황분석: 「report」 — /.test(n)), part.notes.join('\n'));
  assert.ok(part.notes.some((n) => /일반 현황: .* 남김 — 지역의 개황 › 위  치/.test(n)));
});

test('Ⅳ장: 교동배수지 현황분석 보고서를 연결하면 그 내용이 교동 절에 들어가고 표고 0 은 알린다', {
  skip: skipUnless('설계1장', '교동현황', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.status = [{ file: samples.교동현황, facility: '교동배수지', useForFacts: false }];
  const part = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.4');
  const md = part.markdown;
  const gyodong = md.slice(md.indexOf('### 가. 교동배수지'), md.indexOf('### 나. 삼산배수지'));
  assert.match(gyodong, /위치: 인천광역시 강화군 교동면 상용리 산 3번지 일원/);
  assert.match(gyodong, /보전관리지역이 5,873㎡ \(96\.2%\)/);
  assert.doesNotMatch(gyodong, /현황분석 보고서가 등록되지 않음/);
  assert.ok(part.notes.some((n) => /교동배수지 표고분석: 현황분석 보고서의 값이 모두 0/.test(n)), part.notes.join('\n'));
});

test('필지 자료를 시설별로 지정: 교동=현황분석 도구 필지 엑셀, 삼산=샘플 표, 겹치지 않는다', {
  skip: skipUnless('설계1장', '교동현황', '교동필지', '결정안'), timeout: 600000,
}, async () => {
  const project = loadProject(path.join(__dirname, '..', 'examples', '교동삼산.project.json'));
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.parcels = [{ file: samples.교동필지, facility: '교동배수지' }, { file: samples.결정안 }];
  project.status = [{ file: samples.교동현황, facility: '교동배수지', useForFacts: false }];
  const ctx = await prepare(project);
  assert.deepEqual(ctx.parcelDocs.map((d) => [d.facility, d.count]), [['교동배수지', 10], [null, 3]]);
  assert.ok(ctx.parcels.filter((p) => p.시설 === '교동배수지').every((p) => /교동면/.test(p.소재지)));
  assert.equal(ctx.decision.rows[0].변경후, '6,197');
  assert.equal(ctx.decision.rows[1].변경후, '10,965');
  const out = composePackage(ctx);
  const p4 = out.parts.find((p) => p.id === 'pkg.4');
  const gyodong = p4.markdown.slice(p4.markdown.indexOf('### 가. 교동배수지'), p4.markdown.indexOf('### 나. 삼산배수지'));
  assert.match(gyodong, /공유지는 2,911㎡\(47\.0%\), 사유지는 3,285㎡\(53\.0%\)/);
  assert.match(gyodong, /\| 공유지 \| 1 \| 2,911 \| 47\.0 \| 군유지 \|/);
  // 표고·경사 값이 모두 0 인 보고서는 표를 넣지 않고 [작성 필요]
  assert.match(gyodong, /##### 가\) 표고분석\n\n\[작성 필요: 교동배수지 표고분석 — 현황분석 보고서에 수치표고\(DEM\)/);
  assert.doesNotMatch(gyodong, /표고별 면적표/);
  assert.ok(p4.notes.some((n) => /교동배수지 위치: 현황분석 보고서는 .*산 3번지.*설계보고서는 .*산4번지/.test(n)), p4.notes.join('\n'));
  assert.ok(p4.notes.some((n) => /교동배수지 면적: 현황분석 보고서 6,102㎡, 편입토지 합계 6,197㎡/.test(n)));
  // 입안서의 시설면적도 같이 바뀐다
  assert.match(out.parts.find((p) => p.id === 'pkg.app').markdown, /- 교동배수지 : A = 6,197㎡\n- 삼산배수지 : A = 10,965㎡/);
  // 교동 용도지역(현황분석 보고서)으로 Ⅲ장 관련법규 판정이 채워진다
  const p3 = out.parts.find((p) => p.id === 'pkg.3').markdown;
  assert.match(p3, /교동배수지: 보전관리지역 5,873㎡, 계획관리지역 229㎡, 산출수치 5,873\/5,000 \+ 229\/10,000 = 1\.20로 소규모환경영향평가 대상/);
  assert.match(p3, /교동배수지: 보전관리지역 5,873㎡\(1만㎡ 미만\), 계획관리지역 229㎡\(3만㎡ 미만\)로 개발행위허가 규모 이하/);
  assert.match(p3, /\| 환경영향평가 \| .* \| ○ \| 교동배수지: .*산출수치 1\.20로 소규모환경영향평가 대상 사업<br>삼산배수지: \[작성 필요/);
  // 삼산 용도지역을 project.json zones 로 넣으면 기호까지 정해진다
  project.zones = { 삼산배수지: { 계획관리지역: 10965 } };
  const p3b = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.3').markdown;
  assert.match(p3b, /\| 토지적성평가 \| .* \| ☓ \| 교동배수지: .*미만으로 대상 제외<br>삼산배수지: 계획관리지역 10,965㎡ — 용도지역별 개발행위규모 미만으로 대상 제외 \|/);
  assert.match(p3b, /삼산배수지: 계획관리지역 10,965㎡\(기준 10,000㎡\)로 소규모환경영향평가 대상/);
});

test('Ⅴ. 배수시설 조성계획 장: 절마다 parts 순서로 설계보고서 절을 모으고, 없는 것은 표시', {
  skip: skipUnless('설계1장', '설계5장', '설계7장', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제[157]장/.test(d.file));
  project.status = [];
  const part = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.5');
  assert.equal(part.built, true);
  const md = part.markdown;
  // 샘플 Ⅴ장과 같은 구성
  const order = ['# Ⅴ. 배수시설 조성계획', '## 1. 계획의 개요', '### 가. 개요', '### 나. 사업의 배경 및 목적', '### 다. 계획급수구역',
    '## 2. 용수수요량 산정', '### 가. 장래인구계획', '### 나. 장래용수 수요량 산정',
    '## 3. 배수지 시설설계', '### 가. 배수지 용량계획', '### 나. 배수지 수위계획', '### 다. 배수지 위치 검토',
    '## 4. 건축계획', '## 5. 부분별계획', '### 라. 교통처리계획', '## 6. 사업계획', '### 가. 소요사업비', '### 나. 공사 예정공정표'];
  const at = order.map((h) => md.indexOf(h));
  assert.ok(at.every((i) => i >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // 원본 위치: 개요·급수구역·시설설계는 7장, 인구·수요량은 5장, 사업비는 1장
  for (const re of [/1\.가 개요: .*제7장/, /2\.가 장래인구계획: .*제5장/, /3\.다 배수지 위치 검토: .*제7장/, /6\.가 소요사업비: .*제1장/]) {
    assert.ok(part.notes.some((n) => re.test(n)), `${re}\n${part.notes.join('\n')}`);
  }
  assert.match(md, /### 라\. 교통처리계획\n\n\[외부 자료 필요: 교통처리계획 — 교통성 검토서의 교통처리계획\]/);
  assert.match(md, /### 나\. 공사 예정공정표\n\n\[작성 필요: 공사 예정공정표 — 설계보고서에서 찾지 못함\]/);
  assert.match(md, /### 나\. 사업의 배경 및 목적\n\n∙ 현재 교동면/);
});

test('Ⅶ. 편입토지조서 장: 시설마다 조서 표·지목별·소유자별·용지도·토지대장', {
  skip: skipUnless('설계1장', '결정안', '교동필지'), timeout: 600000,
}, async () => {
  const { ownerCell } = require('../src/compose/chapters/land');
  assert.equal(ownerCell({ 소유구분: '공유지', 소유자: '강화군' }), '공(강화군)');
  assert.equal(ownerCell({ 소유구분: '사유지' }), '사');
  assert.equal(ownerCell({ 소유구분: '미상' }), '[작성 필요: 소유자]');

  const project = sampleProject();
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.status = [];
  project.parcels = [{ file: samples.교동필지, facility: '교동배수지' }, { file: samples.결정안 }];
  const part = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.7');
  assert.equal(part.built, true);
  const md = part.markdown;
  const order = ['# Ⅶ. 편입토지조서 및 용지도', '## ■ 교동배수지 편입조서', '### 편입토지조서', '### 지목별 편입토지조서', '### 소유자별 편입토지조서',
    '### 용지도(교동배수지)', '### 교동배수지 - 토지대장 -', '## ■ 삼산배수지 편입조서', '### 삼산배수지 - 토지대장 -'];
  const at = order.map((h) => md.indexOf(h));
  assert.ok(at.every((i) => i >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // 조서 표: 시도 뗀 주소, 소수 면적, 소유자 칸, 합계(결정조서와 같은 자료)
  assert.match(md, /<tr><td>3<\/td><td>강화군 교동면 상용리<\/td><td>산4<\/td><td>임<\/td><td>22,612<\/td><td>2,911\.4<\/td><td>공\(군유지\)<\/td><td><\/td><\/tr>/);
  assert.match(md, /<tr><td colspan="3">합 계<\/td><td><\/td><td>65,169<\/td><td>6,196\.8<\/td>/);
  assert.match(md, /\| 임 \| 7 \| 6,018\.4 \| 97\.1 \|  \|\n\| 합 계 \| 10 \| 6,196\.8 \| 100\.0 \|/);
  assert.match(md, /\| 공유지 \| 1 \| 2,911\.4 \| 47\.0 \| 군유지 \|/);
  // 삼산(샘플 표): 도 725 를 전에 합치지 않고 따로 센다
  assert.match(md.slice(md.indexOf('## ■ 삼산배수지')), /\| 도 \| 1 \| 725 \| 6\.6 \|/);
  assert.equal(part.flags.외부자료, 4); // 용지도 2 + 토지대장 2
  // 용지도 그림을 지정하면 들어간다
  const png = path.join(require('os').tmpdir(), `ipansuh-landmap-${process.pid}.png`);
  require('fs').writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
  project.landmaps = { 교동배수지: png };
  const md2 = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.7').markdown;
  assert.match(md2, /### 용지도\(교동배수지\)\n\n!\[교동배수지 용지도\]\(첨부\/landmaps_교동배수지\.png\)/);
  require('fs').unlinkSync(png);
});

test('표지 4종: 샘플 표지와 같은 줄 구성, 쪽 나눔, 날짜·로고는 vars·project.json', {
  skip: skipUnless('설계1장', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.status = [];
  const part = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.cover');
  assert.equal(part.built, true);
  const covers = part.markdown.split('\n\n---\n\n');
  assert.equal(covers.length, 4);
  assert.deepEqual(covers.map((c) => /^# (.+)$/m.exec(c)[1]), ['입안신청서', '환경성검토서', '교통성검토서', '경관성검토서']);
  assert.match(covers[0], /^### 강화 군관리계획\(시설: 수도공급설비\)결정\n\n# 입안신청서\n\n### - 교동·삼산배수지 건설공사 -\n\n\[작성 필요: 표지일자\]$/);
  assert.ok(part.notes.some((n) => /표지일자/.test(n)));

  // 표지 사업명·날짜·로고를 넣으면 샘플과 같아진다
  const png = path.join(require('os').tmpdir(), `ipansuh-logo-${process.pid}.png`);
  require('fs').writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
  project.vars = { 표지사업명: '교동·삼산 배수지 건설공사', 표지일자: '2025. 12' };
  project.logo = png;
  const md = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.cover').markdown;
  assert.match(md, /### - 교동·삼산 배수지 건설공사 -\n\n2025\. 12\n\n!\[로고\]\(첨부\/logo\.png\)/);
  assert.equal((md.match(/\[작성 필요/g) || []).length, 0);
  require('fs').unlinkSync(png);
  // 미리보기에서 '---' 는 쪽 나눔 선
  assert.equal((markdownToHtml(md).match(/<hr class="page">/g) || []).length, 3);
});

test('결정조서 일부만 뽑기: 사유서 칸 합치기를 다시 계산한다', () => {
  const { subsetDecision } = require('../src/plan/decision');
  const d = {
    rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    reasons: [{ 결정사유: 'x', rowSpan: 3 }, { 결정사유: 'x', merged: true }, { 결정사유: 'x', merged: true }],
  };
  const s = subsetDecision(d, ['b', 'c']);
  assert.deepEqual(s.rows.map((r) => r.id), ['b', 'c']);
  assert.deepEqual(s.reasons.map((r) => [r.rowSpan, r.merged]), [[2, false], [1, true]]);
});

test('입안서 장: 샘플 입안서와 같은 순서·문구, 면적은 편입토지 합계, 비면 [작성 필요]', {
  skip: skipUnless('설계1장', '결정안'), timeout: 600000,
}, async () => {
  const project = sampleProject();
  project.design = project.design.filter((d) => /제1장/.test(d.file));
  project.status = [];
  const ctx = await prepare(project);
  const app = composePackage(ctx).parts.find((p) => p.id === 'pkg.app');
  assert.equal(app.built, true);
  const md = app.markdown;
  const order = ['# 군관리계획(시설: 수도공급설비) 결정(신설) 입안서', '### ■ 입안사유', '### ■ 입안내용', '### ■ 사업의 기대효과',
    '### ■ 군관리계획(시설: 수도공급설비) 결정(안) 도서 : 별첨'];
  const at = order.map((h) => md.indexOf(h));
  assert.ok(at.every((i) => i >= 0), at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.match(md, /1\. 위 치 : 교동배수지 – 인천광역시 강화군 교동면 상용리 산4번지 일원<br>삼산배수지 – 인천광역시 강화군 삼산면 석모리 산70번지 일원/);
  assert.match(md, /2\. 목표연도 : 2040년/);
  assert.match(md, /- 교동배수지 : A = 19,341㎡\n- 삼산배수지 : A = 10,965㎡/);
  assert.match(md, /4\. 강화 군관리계획\(시설: 수도공급설비\) 결정\(안\)/);
  assert.match(md, /가\. 군계획시설\(수도공급설비: 배수지\) 결정\(신설\) 조서/);
  assert.match(md, /<td>신설<\/td><td>①<\/td><td>수도공급설비<br>\(교동배수지\)<\/td>/);
  assert.doesNotMatch(md, /사유서/, '입안서에는 조서만 들어간다');
  assert.match(md, /\[작성 필요: 급수지역\]/);
  assert.match(md, /\[작성 필요: 작성일\]/);
  assert.match(md, /# \[작성 필요: 입안신청자\(시행자\)\]$/);
  // 설계보고서 '사업의 효과' 7항목을 쓰고, 어느 쪽을 썼는지 확인할 것에 남긴다
  assert.equal((md.match(/^∙ /gm) || []).length, 7);
  assert.ok(app.notes.some((n) => /기대효과: 설계보고서 「제1장 총론\(완\)」/.test(n)), app.notes.join('\n'));

  // 사용자가 값을 넣고 라이브러리 기대효과를 고르면 [작성 필요]가 사라진다
  project.vars = { 급수지역: '강화도', 상위계획목록: ['2040 수도정비 기본계획', '2045 수도정비 기본계획(변경)'], 작성일: '2026. 08.', 입안신청자: '인천광역시상수도사업본부' };
  project.prefer = { effect: 'library' };
  const app2 = composePackage(await prepare(project)).parts.find((p) => p.id === 'pkg.app');
  assert.equal(app2.flags.작성필요, 0, app2.markdown);
  assert.match(app2.markdown, /∙ 건설사업의 실시에 따른 고용 창출 효과/);
  assert.match(app2.markdown, /2026\. 08\.\n\n# 인천광역시상수도사업본부$/);
});
