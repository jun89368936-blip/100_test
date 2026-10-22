'use strict';
// 프로젝트 파일(project.json)을 읽어 조립에 필요한 재료를 한 번에 준비한다.
// 재료: 보고서 개요·사업 사실·편입 필지·결정조서·절 매핑·문안. 읽은 문서는 cache 에 두고 다시 쓴다(미리보기 서버가 같은 cache 를 계속 넘긴다).

const fs = require('fs');
const path = require('path');
const { parseFile } = require('../ingest/parse');
const { buildOutline } = require('../ingest/outline');
const { extractFacts } = require('../extract/facts');
const { readParcels } = require('../extract/parcels');
const { buildDecision } = require('../plan/decision');
const { loadTemplate, mapSections } = require('../plan/mapper');
const { buildNarrative } = require('../plan/narrative');
const { zoningFor, zoningVars } = require('../plan/zoning');

/** project.json 을 읽고 파일 경로를 그 파일 위치 기준 절대경로로 바꾼다 */
function loadProject(file) {
  const abs = path.resolve(file);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const dir = path.dirname(abs);
  const entry = (e) => (typeof e === 'string' ? { file: e } : { ...e });
  const resolve = (e) => ({ ...e, file: path.resolve(dir, e.file) });
  return {
    ...raw,
    file: abs,
    design: (raw.design || []).map(entry).map(resolve),
    status: (raw.status || []).map(entry).map(resolve),
    parcels: (raw.parcels || []).map(entry).map(resolve),
    drawings: Object.fromEntries(Object.entries(raw.drawings || {}).map(([k, f]) => [k, path.resolve(dir, f)])),
    landmaps: Object.fromEntries(Object.entries(raw.landmaps || {}).map(([k, f]) => [k, path.resolve(dir, f)])),
    designs: Object.fromEntries(Object.entries(raw.designs || {}).map(([k, f]) => [k, path.resolve(dir, f)])),
    logo: raw.logo ? path.resolve(dir, raw.logo) : null,
  };
}

const docIdOf = (file) => path.basename(file, path.extname(file));

/** 파일을 읽어 개요까지 만든다. 같은 파일·수정시각이면 cache 를 쓴다 */
async function readDoc(file, cache) {
  const stat = fs.statSync(file);
  const k = `${file}|${stat.mtimeMs}`;
  if (cache && cache.has(k)) return cache.get(k);
  const parsed = await parseFile(file);
  const doc = { parsed, outline: buildOutline(parsed) };
  if (cache) cache.set(k, doc);
  return doc;
}

/**
 * @param {object} project  loadProject() 결과
 * @param {{cache?:Map, onProgress?:(msg:string)=>void}} [opts]
 * @returns {Promise<object>} ctx
 */
async function prepare(project, opts = {}) {
  const { cache, onProgress = () => {} } = opts;
  const warnings = [];
  const docs = [];
  const load = async (e, role) => {
    if (!fs.existsSync(e.file)) { warnings.push(`파일이 없습니다: ${e.file}`); return null; }
    onProgress(`읽는 중: ${path.basename(e.file)}`);
    try {
      const d = await readDoc(e.file, cache);
      const doc = { docId: docIdOf(e.file), role, file: e.file, facilityId: e.facility, note: e.note, useForFacts: e.useForFacts !== false, ...d };
      docs.push(doc);
      return doc;
    } catch (err) {
      warnings.push(`${path.basename(e.file)} 읽기 실패: ${err.message}`);
      return null;
    }
  };
  for (const e of project.design) await load(e, 'design');
  for (const e of project.status) await load(e, 'status');

  // 사업 사실은 필지를 읽기 전에 뽑는다(필지 자료를 시설별로 지정할 때 시설의 읍·면이 필요)
  onProgress('사업 사실 뽑는 중');
  const facts = extractFacts(docs.filter((d) => d.useForFacts).map((d) => ({ role: d.role, parsed: d.parsed })), project.facts || {});

  // 필지: {"file": …, "facility": "교동배수지"} 이면 그 파일에서 그 시설 읍·면의 필지만 그 시설 것으로 쓴다.
  // 시설을 지정한 자료가 있으면, 지정하지 않은 자료에서는 그 시설 필지를 빼서 겹치지 않게 한다.
  const parcels = [];
  const parcelDocs = [];
  const eupOf = (fid) => {
    const f = (facts.facilities || []).find((x) => x.id === fid);
    return f && f.위치 && f.위치.주소 ? f.위치.주소.eupmyeon : null;
  };
  const claimed = project.parcels.filter((e) => e.facility).map((e) => e.facility);
  for (const e of project.parcels) {
    if (!fs.existsSync(e.file)) { warnings.push(`파일이 없습니다: ${e.file}`); continue; }
    onProgress(`읽는 중: ${path.basename(e.file)}`);
    const d = await readDoc(e.file, cache);
    const r = readParcels(d.parsed);
    let list = r.parcels;
    if (e.facility) {
      const eup = eupOf(e.facility);
      if (!eup) warnings.push(`필지 자료 ${path.basename(e.file)}: 시설 '${e.facility}' 의 위치(읍·면)를 몰라 모든 필지를 그 시설 것으로 봅니다.`);
      list = (eup ? list.filter((p) => String(p.소재지 || '').includes(eup)) : list).map((p) => ({ ...p, 시설: e.facility }));
      if (eup && list.length < r.parcels.length) warnings.push(`필지 자료 ${path.basename(e.file)}: ${e.facility}(${eup}) 밖의 필지 ${r.parcels.length - list.length}개는 뺐습니다.`);
    } else if (claimed.length) {
      const eups = claimed.map(eupOf).filter(Boolean);
      list = list.filter((p) => !eups.some((u) => String(p.소재지 || '').includes(u)));
    }
    parcels.push(...list);
    parcelDocs.push({ docId: docIdOf(e.file), file: e.file, count: list.length, facility: e.facility || null, note: e.note });
    warnings.push(...r.warnings);
  }

  // 첨부 그림: project.drawings(결정(안)도)·landmaps(용지도)·designs(배수지 설계도) = {시설id: 그림 파일}.
  // 미리보기에서는 /img/첨부/<종류>_<시설id><확장자> 로 보인다
  const attachments = { docId: '첨부', parsed: { images: new Map() }, drawings: {}, landmaps: {}, designs: {}, logo: null };
  if (project.logo) {
    if (!fs.existsSync(project.logo)) warnings.push(`표지 로고 파일이 없습니다: ${project.logo}`);
    else {
      const name = `logo${path.extname(project.logo).toLowerCase()}`;
      attachments.parsed.images.set(name, fs.readFileSync(project.logo));
      attachments.logo = `첨부/${name}`;
    }
  }
  for (const [kind, label] of [['drawings', '결정(안)도'], ['landmaps', '용지도'], ['designs', '배수지 설계도']]) {
    for (const [fid, file] of Object.entries(project[kind] || {})) {
      if (!fs.existsSync(file)) { warnings.push(`${label} 파일이 없습니다: ${file}`); continue; }
      const name = `${kind === 'drawings' ? '' : `${kind}_`}${fid}${path.extname(file).toLowerCase()}`;
      attachments.parsed.images.set(name, fs.readFileSync(file));
      attachments[kind][fid] = `첨부/${name}`;
    }
  }

  onProgress('결정조서·절 매핑·문안 만드는 중');
  const decision = buildDecision(facts, parcels, project.decision || {});
  const template = loadTemplate(project.template || 'water-supply');
  const outlines = docs.map((d) => ({ docId: d.docId, role: d.role, outline: d.outline, facilityId: d.facilityId }));
  const mapping = mapSections(outlines, template, project.mapping || {}, { facilities: facts.facilities });
  // 용도지역 판정(개발행위규모·토지적성평가 제외·소규모환경영향평가) → 문안 변수. 사용자가 vars 에 직접 넣은 값이 우선
  const zoning = zoningFor({ facts, docs, mapping, project });
  const vars = { ...zoningVars(zoning), ...(project.vars || {}) };
  const narrative = buildNarrative(facts, { outlines: outlines.filter((o) => o.role === 'design'), decision, vars, prefer: project.prefer || {} });

  return { project, docs, attachments, parcels, parcelDocs, facts, decision, template, outlines, mapping, zoning, narrative, warnings };
}

module.exports = { loadProject, prepare, readDoc, docIdOf };
