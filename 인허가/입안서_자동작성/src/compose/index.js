'use strict';
// 문서 조립: chapters.json 의 장 순서대로 파트를 만든다.
// 조립기가 등록된 장(chapters/index.js)은 그 결과를, 아직 없는 장은 골격·매핑·문안에서 '들어갈 재료' 초안을 보여 준다.

const fs = require('fs');
const path = require('path');
const { BUILDERS } = require('./chapters');
const { buildToc, titleOf } = require('./toc');
const { loadPack } = require('../plan/narrative');

const CHAPTERS_FILE = path.join(__dirname, '..', '..', 'chapters.json');
const SOURCE_LABEL = { design: '설계보고서', status: '현황분석 보고서', generated: '자동 생성', library: '문안 라이브러리', external: '외부 자료', container: '' };

function loadChapters(file = CHAPTERS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).chapters;
}

/** 대상 절 id → 이 장에 속하는가 */
const inChapter = (chapterId, t) => t.id === chapterId || t.id.startsWith(`${chapterId}.`) || t.id.startsWith(`${chapterId}:`)
  || (!chapterId.startsWith('pkg') && t.docId === chapterId);

/** 템플릿 절 id → 그 절을 채우는 문안 항목들 */
function libraryTargets(ctx) {
  const out = new Map();
  const pack = loadPack(ctx.narrative.pack.id);
  for (const e of pack.entries) for (const tid of e.targets || []) {
    if (!out.has(tid)) out.set(tid, []);
    out.get(tid).push(e.id);
  }
  return out;
}

/** 아직 조립기가 없는 장: 절마다 어디서 내용을 가져올지 보여 준다 */
function draftMarkdown(ctx, chapter) {
  const vars = ctx.narrative.vars;
  const targets = ctx.mapping.targets.filter((t) => inChapter(chapter.id, t));
  const lib = libraryTargets(ctx);
  const byTarget = new Map();
  for (const a of ctx.mapping.assignments) {
    if (!byTarget.has(a.targetId)) byTarget.set(a.targetId, []);
    byTarget.get(a.targetId).push(a);
  }
  const unmatched = new Map(ctx.mapping.unmatched.map((u) => [u.targetId, u]));

  const L = [];
  const head = targets.find((t) => t.id === chapter.id);
  L.push(`# ${head && head.number ? `${head.number}. ` : ''}${head ? titleOf(head, vars) : chapter.title}`);
  L.push(`> 아직 조립하지 않은 장입니다(${chapter.status}). 아래는 이 장에 들어갈 재료입니다. 할 일: ${chapter.todo || ''}`);
  for (const t of targets) {
    if (t.id === chapter.id && t.source === 'container') continue;
    const depth = Math.max(2, Math.min(6, t.trail.length - 1)); // trail = [문서, 장, 절, …]
    if (t.id !== chapter.id) L.push(`${'#'.repeat(depth)} ${t.number ? `${t.number}. ` : ''}${titleOf(t, vars)}`);
    const lines = [];
    if (t.source === 'design' || t.source === 'status') {
      for (const a of byTarget.get(t.id) || []) lines.push(`- ${SOURCE_LABEL[t.source]} 「${a.docId}」 › ${a.nodeNumber ? `${a.nodeNumber} ` : ''}${a.nodeTitle} (${a.via === 'override' ? '사용자 지정' : `자동, 점수 ${a.score}`})`);
      const u = unmatched.get(t.id);
      if (u) lines.push(`- [작성 필요: ${titleOf(t, vars)} — ${u.reason}]`);
    }
    for (const id of lib.get(t.id) || []) {
      const sec = ctx.narrative.sections[id];
      if (!sec) continue;
      const src = sec.source.kind === 'design' ? `설계보고서 「${sec.source.docId}」 › ${sec.source.section}` : `문안 라이브러리 ${sec.source.pack}/${sec.source.entry}`;
      lines.push(`- 문안 '${sec.title}': ${src}${sec.missing.length ? ` — 채울 값 없음: ${sec.missing.map((m) => `[작성 필요: ${m}]`).join(' ')}` : ''}${sec.needsReview ? ' (검토 필요)' : ''}`);
    }
    if (t.source === 'generated') lines.push('- 자동 생성 (추출한 사실·결정조서·편입토지 집계)');
    if (t.source === 'library' && !(lib.get(t.id) || []).length) lines.push('- 문안 라이브러리 [작성 필요: 문안 없음]');
    if (t.source === 'external') lines.push(`- [외부 자료 필요: ${titleOf(t, vars)}]`);
    if (t.needsFacility) lines.push('- [작성 필요: 시설 목록을 알 수 없어 시설별 절을 펼치지 못함]');
    if (lines.length) L.push(lines.join('\n'));
  }
  return L.join('\n\n');
}

const count = (md, re) => (md.match(re) || []).length;

/**
 * @param {object} ctx  prepare() 결과
 * @param {object[]} [chapters]  loadChapters() 결과
 * @returns {{toc:object, parts:object[], warnings:string[]}}
 */
function composePackage(ctx, chapters = loadChapters()) {
  const warnings = [];
  const parts = chapters.map((ch) => {
    const builder = BUILDERS[ch.id];
    let markdown;
    let notes = [];
    let error = null;
    try {
      const out = builder ? builder(ctx, ch) : draftMarkdown(ctx, ch);
      if (typeof out === 'string') markdown = out;
      else ({ markdown, notes = [] } = out);
    } catch (err) {
      error = err.stack || String(err);
      markdown = `# ${ch.title}\n\n[작성 필요: 조립 중 오류 — ${err.message}]`;
      warnings.push(`${ch.title} 조립 오류: ${err.message}`);
    }
    return {
      id: ch.id, title: ch.title, status: ch.status, todo: ch.todo, note: ch.note,
      built: !!builder, markdown, notes, error,
      flags: { 작성필요: count(markdown, /\[작성 필요[^\]]*\]/g), 외부자료: count(markdown, /\[외부 자료 필요[^\]]*\]/g) },
    };
  });
  return { toc: buildToc(ctx.template, ctx.narrative.vars, 'pkg'), parts, warnings };
}

module.exports = { composePackage, loadChapters, draftMarkdown, CHAPTERS_FILE };
