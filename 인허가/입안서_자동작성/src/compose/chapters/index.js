'use strict';
// 장별 조립기 목록. 장을 하나 완성할 때마다 여기에 등록한다.
// 조립기: (ctx, chapter) => 마크다운 문자열 또는 {markdown, notes}. notes 는 미리보기에 '확인할 것'으로 보인다.
// 등록되지 않은 장은 '들어갈 재료' 초안으로 보인다.

const { buildToc, tocToMarkdown } = require('../toc');
const { buildApplication } = require('./application');
const { buildDecisionChapter } = require('./decision');
const { buildPlanChapter } = require('./plan');
const { buildPlansChapter } = require('./plans');
const { buildStatusChapter } = require('./status');
const { buildWorksChapter } = require('./works');
const { buildLandChapter } = require('./land');
const { buildCover } = require('./cover');

const BUILDERS = {
  'pkg.toc': (ctx) => tocToMarkdown(buildToc(ctx.template, ctx.narrative.vars, 'pkg')),
  'pkg.cover': buildCover,
  'pkg.app': buildApplication,
  'pkg.1': buildDecisionChapter,
  'pkg.2': buildPlanChapter,
  'pkg.3': buildPlansChapter,
  'pkg.4': buildStatusChapter,
  'pkg.5': buildWorksChapter,
  'pkg.7': buildLandChapter,
};

module.exports = { BUILDERS };
