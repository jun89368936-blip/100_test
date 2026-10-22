'use strict';
// 문안 라이브러리(library/*.json)의 {{변수}} 를 facts 로 채워 입안사유·기대효과·계획의 목적·범위·수립절차·관련법규·상위계획 문안을 만든다.
// 설계보고서에 '과업의 목적'·'사업의 효과' 절이 있으면 그 문장을 먼저 쓰고, 어느 쪽을 썼는지 log 에 남긴다.

const fs = require('fs');
const path = require('path');
const { findSections } = require('../ingest/outline');
const { norm, stripBullet } = require('../extract/text');
const { termsFor, joinKo } = require('./decision');

const LIB_DIR = path.join(__dirname, '..', '..', 'library');
const PACK_OF_GROUP = { 수도공급설비: 'water-supply', 하수도: 'sewer' };
// 시설군 팩에 없을 때 수도 팩 문안으로 대신해도 되는 항목(시설 종류와 무관한 절차·범위). 나머지는 [작성 필요].
const SHARED = ['scope', 'procedure'];

const num = (n) => Math.round(n).toLocaleString('en-US');
const need = (name) => `[작성 필요: ${name}]`;

const packCache = new Map();
function loadPack(name) {
  if (!packCache.has(name)) {
    packCache.set(name, JSON.parse(fs.readFileSync(path.join(LIB_DIR, `${name}.json`), 'utf8')));
  }
  return packCache.get(name);
}

/** 시설군 → 문안 팩. 모르는 시설군은 수도 팩을 쓰되 검토 필요로 표시한다 */
function packFor(group) {
  const name = PACK_OF_GROUP[group];
  return { pack: loadPack(name || 'water-supply'), known: !!name };
}

/** '{{변수}}' 를 채운다. 값이 없으면 [작성 필요: 변수] 를 남기고 missing 에 모은다 */
function fillTemplate(text, vars, missing = new Set()) {
  const out = String(text).replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, name) => {
    const v = vars[name];
    if (v == null || v === '') { missing.add(name); return need(name); }
    return String(v);
  });
  return { text: out, missing };
}

/** ['교동배수지','삼산배수지'] → '교동 및 삼산배수지' (끝말이 같으면 마지막에만 붙인다) */
function facilityList(names, kinds) {
  const list = [...new Set(names.filter(Boolean))];
  if (list.length <= 1) return list.join('');
  const kind = kinds && kinds.length && new Set(kinds).size === 1 ? kinds[0] : null;
  if (kind && list.every((n) => n.endsWith(kind) && n.length > kind.length)) {
    return `${joinKo(list.map((n) => n.slice(0, -kind.length)))}${kind}`;
  }
  return joinKo(list);
}

/** 계획명 목록 → '「A」 및 「B」' */
function planList(plans) {
  const list = (Array.isArray(plans) ? plans : [plans]).map((p) => String(p).replace(/^[「『]|[」』]$/g, '').trim()).filter(Boolean);
  return list.length ? joinKo(list.map((p) => `「${p}」`)) : null;
}

// --- 설계보고서 절 ------------------------------------------------------------

const PAGE_NO = /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\dIVX]+\s*-\s*\d+$/;

/** 설계보고서(role:'design') 개요에서 제목이 맞는 첫 절 */
function findDesignSection(outlines, re) {
  for (const o of outlines || []) {
    if (o.role && o.role !== 'design') continue;
    const hit = findSections(o.outline, re)[0];
    if (hit) return { docId: o.docId, node: hit };
  }
  return null;
}

/** 절(하위 포함)의 본문 문단. 쪽번호·빈 줄·그림은 뺀다 */
function sectionParagraphs(node) {
  const out = [];
  const visit = (n) => {
    for (const b of n.blocks || []) {
      if (b.type !== 'paragraph') continue;
      for (const raw of String(b.text || '').split('\n')) {
        const t = norm(raw.replace(/!\[[^\]]*\]\([^)]*\)/g, ''));
        if (t && !PAGE_NO.test(t)) out.push(t);
      }
    }
    (n.children || []).forEach(visit);
  };
  visit(node);
  return out;
}

/** 설계보고서 '과업의 목적' 등에서 문안 변수 후보를 찾는다 */
function varsFromDesign(outlines) {
  const found = {};
  const purpose = findDesignSection(outlines, /과업의\s*목적|사업의\s*목적|계획의\s*목적/);
  const text = purpose ? sectionParagraphs(purpose.node).join('\n') : '';
  if (!text) return { found, purpose };

  const plans = [];
  for (const m of text.matchAll(/[『「]\s*([^』」]+?)\s*[』」]/g)) {
    const name = m[1].replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, '').trim();
    if (/계획/.test(name) && !plans.includes(name)) plans.push(name);
  }
  if (plans.length) found.상위계획목록 = { value: planList(plans), plans, docId: purpose.docId, section: purpose.node.title };

  const olds = [...new Set([...text.matchAll(/([가-힣]{1,6})\s*배수지\s*(?:로부터|에서)/g)].map((m) => m[1]))];
  if (olds.length) found.기존배수권역 = { value: joinKo(olds.map((o) => `${o}배수권역`)), docId: purpose.docId, section: purpose.node.title };
  return { found, purpose };
}

// --- 변수 ----------------------------------------------------------------------

const val = (f) => (f && !f.missing && f.value != null ? f.value : null);

/** 면적 판정 문구(재해영향평가: 부지 5천㎡ 이상이면 협의 대상) */
function disasterJudgement(rows) {
  const known = (rows || []).filter((r) => r.면적 && r.면적.변경후 != null);
  if (!known.length) return null;
  const list = known.map((r) => `${r.이름} ${num(r.면적.변경후)}㎡`).join(', ');
  const over = known.filter((r) => r.면적.변경후 >= 5000);
  if (over.length === known.length) return `시설면적 ${list}로 부지면적 5천㎡ 이상이므로 재해영향평가 협의 대상`;
  if (!over.length) return `시설면적 ${list}로 부지면적 5천㎡ 미만이므로 협의 대상 아님`;
  return `시설면적 ${list} — ${over.map((r) => r.이름).join(', ')}은(는) 5천㎡ 이상으로 협의 대상`;
}

/**
 * 문안 변수 표를 만든다. 우선순위: 사용자 입력(options.vars) > facts·결정조서 > 설계보고서 문장.
 * @returns {{vars:Object<string,string|null>, sources:Object<string,string>}}
 */
function buildVars(facts, options = {}) {
  const fields = (facts && facts.fields) || {};
  const region = (facts && facts.region) || {};
  const facilities = (facts && facts.facilities) || [];
  const decision = options.decision || null;
  const authority = options.결정권자 || val(fields.결정권자);
  const terms = decision ? decision.terms : termsFor(authority);
  const names = facilities.map((f) => val(f.명칭) || f.id);
  const kinds = facilities.map((f) => val(f.종류)).filter(Boolean);
  const eups = (region.읍면 && region.읍면.length ? region.읍면 : facilities.map((f) => f.위치 && f.위치.주소 && f.위치.주소.eupmyeon));

  const vars = {};
  const sources = {};
  const set = (k, v, src) => { if (v != null && v !== '') { vars[k] = String(v); sources[k] = src; } };

  set('시도', val(region.시도), 'facts');
  set('시군구', val(region.시군구), 'facts');
  set('읍면목록', joinKo(eups.filter(Boolean)) || null, 'facts');
  set('시설목록', facilityList(names, kinds) || null, 'facts');
  set('시설종류', [...new Set(kinds)].join('·') || null, 'facts');
  set('결정구분', decision ? decision.mode : (facilities.length ? '신설' : null), decision ? 'decision' : 'default');
  set('계획', terms.계획, 'decision');
  set('시설용어', terms.시설, 'decision');
  set('시설군', val(fields.시설군) || (facilities[0] && val(facilities[0].시설군)), 'facts');
  set('목표연도', val(fields.목표연도), 'facts');
  set('사업목표연도', val(fields.사업목표연도), 'facts');
  set('결정권자', authority, 'facts');
  set('사업명', val(fields.사업명), 'facts');
  set('시행자', val(fields.시행자), 'facts');
  if (decision) set('재해판정', disasterJudgement(decision.rows), 'decision');

  const { found } = varsFromDesign(options.outlines);
  for (const [k, f] of Object.entries(found)) {
    if (vars[k] == null) set(k, f.value, `design:${f.docId || ''}:${f.section}`);
  }

  for (const [k, v] of Object.entries(options.vars || {})) {
    if (v == null || v === '') continue;
    set(k, k === '상위계획목록' && (Array.isArray(v) || !/[「『]/.test(v)) ? planList(v) : v, 'user');
  }
  return { vars, sources };
}

// --- 문안 ----------------------------------------------------------------------

function entryOf(pack, id) {
  const e = pack.entries.find((x) => x.id === id);
  if (e) return { entry: e, pack: pack.pack, fallback: false };
  if (SHARED.includes(id) && pack.pack !== 'water-supply') {
    const base = loadPack('water-supply').entries.find((x) => x.id === id);
    if (base) return { entry: base, pack: 'water-supply', fallback: true };
  }
  return null;
}

const fillAll = (list, vars, missing) => list.map((t) => fillTemplate(t, vars, missing).text);

/**
 * @param {object} facts  extractFacts() 결과
 * @param {object} [options]
 * @param {{docId:string, role:string, outline:object}[]} [options.outlines]  보고서 개요(buildOutline) — 설계보고서 문장 우선 사용
 * @param {object} [options.decision]  buildDecision() 결과(결정구분·면적)
 * @param {Object<string,string|string[]>} [options.vars]  사용자가 직접 넣은 변수(급수지역·입안기관 등)
 * @param {{effect?:'design'|'library', purpose?:'design'|'library'}} [options.prefer]  설계보고서 대신 라이브러리 문안을 쓰게 할 때
 */
function buildNarrative(facts, options = {}) {
  const group = val(facts && facts.fields && facts.fields.시설군)
    || ((facts && facts.facilities && facts.facilities[0] && val(facts.facilities[0].시설군)) || null);
  const { pack, known } = packFor(group);
  const { vars, sources } = buildVars(facts, options);
  const prefer = options.prefer || {};
  const warnings = [];
  const log = [];
  const sections = {};
  const allMissing = new Set();

  if (!pack.verified) warnings.push(`'${group}' 문안은 샘플 미검증입니다. ${pack.verifiedNote}`);
  if (!known) warnings.push(`시설군(${group || '미상'})에 맞는 문안 팩이 없어 수도 문안을 썼습니다. 모두 검토하세요.`);

  const libSection = (id, build) => {
    const hit = entryOf(pack, id);
    if (!hit) {
      sections[id] = { title: id, missing: [], needsReview: true, source: { kind: 'none' }, paragraphs: [need(`${id} 문안`)] };
      log.push({ section: id, used: 'none', detail: `${pack.pack} 팩에 문안이 없음` });
      return;
    }
    const missing = new Set();
    const body = build(hit.entry, missing);
    const needsReview = !!(hit.entry.needsReview || hit.fallback || !pack.verified || !known);
    sections[id] = {
      title: hit.entry.title, ...body, missing: [...missing], needsReview,
      reviewNote: hit.entry.reviewNote || (hit.fallback ? '수도 문안을 대신 썼습니다.' : undefined),
      source: { kind: 'library', pack: hit.pack, entry: hit.entry.id, fallback: hit.fallback },
    };
    missing.forEach((m) => allMissing.add(m));
    log.push({ section: id, used: 'library', detail: `${hit.pack}/${hit.entry.id}${hit.fallback ? ' (대체)' : ''}` });
  };

  // 입안사유: 라이브러리 문안을 facts 로 채운다
  libSection('reason', (e, miss) => ({ paragraphs: fillAll(e.paragraphs, vars, miss) }));

  // 기대효과: 설계보고서 '사업의 효과' 우선
  const effectSec = prefer.effect === 'library' ? null : findDesignSection(options.outlines, /사업의\s*효과|기대\s*효과/);
  const effectParas = effectSec ? sectionParagraphs(effectSec.node) : [];
  if (effectParas.length) {
    const introIdx = effectParas.findIndex((p) => /다음과\s*같다/.test(p));
    const intro = introIdx >= 0 ? effectParas[introIdx] : null;
    const items = effectParas.filter((_p, i) => i !== introIdx).map(stripBullet).filter(Boolean);
    sections.effect = {
      title: '사업의 기대효과', intro, items, missing: [], needsReview: false,
      source: { kind: 'design', docId: effectSec.docId, section: effectSec.node.title, page: effectSec.node.pageStart },
    };
    log.push({ section: 'effect', used: 'design', detail: `${effectSec.docId || ''} '${effectSec.node.title}'` });
  } else {
    libSection('effect', (e, miss) => ({ intro: fillTemplate(e.intro, vars, miss).text, items: fillAll(e.items, vars, miss) }));
  }

  // 계획의 목적: 설계보고서 '과업의 목적' 우선
  const purposeSec = prefer.purpose === 'library' ? null : findDesignSection(options.outlines, /과업의\s*목적|사업의\s*목적|계획의\s*목적/);
  const purposeParas = purposeSec ? sectionParagraphs(purposeSec.node) : [];
  if (purposeParas.length) {
    sections.purpose = {
      title: '계획의 목적', paragraphs: purposeParas, missing: [], needsReview: false,
      source: { kind: 'design', docId: purposeSec.docId, section: purposeSec.node.title, page: purposeSec.node.pageStart },
    };
    log.push({ section: 'purpose', used: 'design', detail: `${purposeSec.docId || ''} '${purposeSec.node.title}'` });
  } else {
    libSection('purpose', (e, miss) => ({ paragraphs: fillAll(e.paragraphs, vars, miss) }));
  }

  // 계획의 범위: 공간적 범위는 결정조서(없으면 facts), 시간적·내용적 범위는 문안
  libSection('scope', (e, miss) => {
    const rows = options.decision
      ? options.decision.rows.map((r) => ({ 구분: r.이름, 위치: r.위치, 면적: r.면적.변경후 == null ? need('면적') : `${num(r.면적.변경후)}㎡` }))
      : ((facts && facts.facilities) || []).map((f) => ({ 구분: val(f.명칭) || f.id, 위치: val(f.위치) || need('위치'), 면적: need('면적') }));
    if (rows.some((r) => /작성 필요/.test(r.위치 + r.면적))) miss.add('공간적 범위');
    return {
      space: rows,
      time: fillAll(e.time, vars, miss),
      content: e.content.map((c) => ({ 구분: c.구분, 항목: fillAll(c.항목, vars, miss) })),
    };
  });

  libSection('procedure', (e, miss) => ({
    steps: e.steps.map((s) => ({
      단계: fillTemplate(s.단계, vars, miss).text,
      주체: s.주체 ? fillTemplate(s.주체, vars, miss).text : '',
      내용: fillAll(s.내용, vars, miss),
    })),
  }));

  libSection('laws', (e, miss) => ({
    laws: e.laws.map((l) => ({ 법령: l.법령, rows: l.rows.map((r) => ({ 항목: r.항목, 요지: r.요지, 결과: fillTemplate(r.결과, vars, miss).text })) })),
  }));

  libSection('upper', (e, miss) => ({
    plans: e.plans.map((p) => ({ 계획: fillTemplate(p.계획, vars, miss).text, 문단: fillTemplate(p.문단, vars, miss).text })),
  }));

  for (const m of allMissing) warnings.push(`문안 변수 '${m}' 을(를) 채우지 못했습니다([작성 필요: ${m}]).`);
  return { pack: { id: pack.pack, verified: !!pack.verified && known, note: pack.verifiedNote }, vars, varSources: sources, sections, log, missing: [...allMissing], warnings };
}

// --- 마크다운 ------------------------------------------------------------------

const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');

/** 문안 절 하나를 마크다운으로 (입안서·Ⅱ·Ⅲ 장 조립용) */
function sectionToMd(sec, id) {
  if (!sec) return '';
  const out = [];
  if (sec.paragraphs) sec.paragraphs.forEach((p) => out.push(`○ ${p}`));
  if (sec.intro) out.push(`○ ${sec.intro}`);
  if (sec.items) sec.items.forEach((t) => out.push(`∙ ${t}`));
  // 표는 줄 사이에 빈 줄이 들어가면 깨지므로 한 덩어리로 넣는다
  const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)].join('\n');
  if (id === 'scope' || sec.space) {
    out.push('∙ 공간적 범위', table(['구 분', '위 치', '면적(㎡)', '비고'], sec.space.map((r) => [r.구분, r.위치, r.면적, ''])));
    out.push('∙ 시간적 범위', sec.time.map((t) => `- ${t}`).join('\n'));
    out.push('∙ 내용적 범위', table(['항 목', '내용적 범위'], sec.content.map((c) => [c.구분, c.항목.map((h) => `⦁ ${h}`).join('\n')])));
  }
  if (sec.steps) {
    out.push(table(['단 계', '주 체', '내 용'], sec.steps.map((s) => [s.단계, s.주체, s.내용.map((l) => (l.startsWith('-') ? l : `∙ ${l}`)).join('\n')])));
  }
  if (sec.laws) {
    sec.laws.forEach((l, i) => {
      out.push(`### ${'가나다라마바사아자차'[i] || i + 1}. ${l.법령}`, table(['검토항목', '내 용', '검토 결과'], l.rows.map((r) => [r.항목, r.요지, r.결과])));
    });
  }
  if (sec.plans) {
    sec.plans.forEach((p, i) => out.push(`### ${'가나다라마바사아자차'[i] || i + 1}. ${p.계획}`, p.문단));
  }
  if (sec.needsReview) out.push(`※ 검토 필요: ${sec.reviewNote || '라이브러리 문안입니다. 사업에 맞게 고치세요.'}`);
  return out.join('\n\n').trim();
}

module.exports = {
  buildNarrative, buildVars, fillTemplate, facilityList, planList, loadPack, packFor,
  varsFromDesign, sectionParagraphs, findDesignSection, disasterJudgement, sectionToMd,
};
