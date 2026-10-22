'use strict';
// 작업용 미리보기 서버: 프로젝트를 조립해 장별로 보여 주고, 코드·문안·골격·chapters.json·project.json 이 바뀌면
// 다시 조립해 열린 브라우저를 새로 고친다. 사용: npm run preview [-- project.json] [--port 4173]
// 127.0.0.1 에서만 열린다. 읽은 보고서는 메모리에 두고(파일이 바뀔 때만 다시 읽음) 조립 코드만 새로 불러온다.

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const SELF = __filename;

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT || 4173);
const projectArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');
const PROJECT_FILE = path.resolve(projectArg || path.join(ROOT, 'examples', '교동삼산.project.json'));

const docCache = new Map();
const clients = new Set();
const state = { version: 0, status: 'loading', progress: '시작', error: null, ctx: null, composed: null, builtAt: null, ms: null, changed: [] };

// --- 조립 ----------------------------------------------------------------------

/** src 아래 모듈을 새로 불러오게 require 캐시를 비운다(이 파일 제외). ingest 가 바뀌면 읽은 문서도 버린다 */
function purgeModules(changed) {
  if (changed.some((f) => f.startsWith(path.join(SRC, 'ingest')))) docCache.clear();
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(SRC) && k !== SELF) delete require.cache[k];
  }
}

let running = false;
let pending = null; // 조립 중에 또 바뀐 파일들
async function rebuild(changed = []) {
  if (running) { pending = (pending || []).concat(changed); return; }
  running = true;
  const t0 = Date.now();
  state.status = 'loading';
  broadcast();
  try {
    purgeModules(changed);
    const { loadProject, prepare } = require('../compose/context');
    const { composePackage, loadChapters } = require('../compose');
    const project = loadProject(PROJECT_FILE);
    const ctx = await prepare(project, { cache: docCache, onProgress: (m) => { state.progress = m; broadcast(); } });
    state.composed = composePackage(ctx, loadChapters());
    state.ctx = ctx;
    state.error = null;
    state.status = 'ready';
  } catch (err) {
    state.error = err.stack || String(err);
    state.status = 'error';
    console.error(err);
  }
  state.ms = Date.now() - t0;
  state.builtAt = new Date().toISOString();
  state.version++;
  state.changed = changed.map((f) => path.relative(ROOT, f));
  console.log(`[${new Date().toLocaleTimeString()}] 조립 ${state.status} (${state.ms}ms)${changed.length ? ` — 바뀐 파일: ${state.changed.join(', ')}` : ''}`);
  running = false;
  broadcast();
  if (pending) { const again = pending; pending = null; rebuild(again); }
}

// --- 파일 감시 -----------------------------------------------------------------

let timer = null;
const queue = new Set();
function changedFile(file) {
  queue.add(file);
  clearTimeout(timer);
  timer = setTimeout(() => { const list = [...queue]; queue.clear(); rebuild(list); }, 300);
}
function watchDir(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return;
  fs.watch(dir, { recursive: true }, (_ev, name) => {
    if (!name) return;
    const file = path.join(dir, String(name));
    if (file === SELF || !filter(file)) return;
    changedFile(file);
  });
}
watchDir(path.join(ROOT, 'src'), (f) => /\.js$/.test(f));
watchDir(path.join(ROOT, 'library'), (f) => /\.json$/.test(f));
watchDir(path.join(ROOT, 'templates'), (f) => /\.json$/.test(f));
// 화면(web/) 이 바뀌면 조립 없이 브라우저만 새로 고친다
fs.watch(path.join(ROOT, 'web'), () => { for (const res of clients) res.write('data: {"reloadPage":true}\n\n'); });
fs.watch(ROOT, (_ev, name) => { if (name && String(name) === 'chapters.json') changedFile(path.join(ROOT, 'chapters.json')); });
fs.watch(path.dirname(PROJECT_FILE), (_ev, name) => { if (name && String(name) === path.basename(PROJECT_FILE)) changedFile(PROJECT_FILE); });

// --- HTTP ----------------------------------------------------------------------

function broadcast() {
  const data = `data: ${JSON.stringify({ version: state.version, status: state.status, progress: state.progress })}\n\n`;
  for (const res of clients) res.write(data);
}

function summary() {
  const { ctx, composed } = state;
  const warnings = ctx ? [...ctx.warnings, ...ctx.decision.warnings, ...ctx.narrative.warnings, ...ctx.mapping.warnings, ...(composed ? composed.warnings : [])] : [];
  return {
    version: state.version, status: state.status, progress: state.progress, error: state.error,
    builtAt: state.builtAt, ms: state.ms, changed: state.changed,
    project: { name: ctx ? ctx.project.name : null, file: PROJECT_FILE },
    chapters: composed ? composed.parts.map(({ markdown, error, ...p }) => ({ ...p, error: !!error })) : [],
    toc: composed ? composed.toc : null,
    docs: ctx ? ctx.docs.map((d) => ({ docId: d.docId, role: d.role, facilityId: d.facilityId || null, note: d.note || null, pages: d.parsed.pageCount })) : [],
    parcels: ctx ? ctx.parcelDocs : [],
    warnings: [...new Set(warnings)],
  };
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.wmf': 'image/wmf', '.emf': 'image/emf' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const p = decodeURIComponent(url.pathname);
  if (req.method !== 'GET') return send(res, 405, { error: '읽기 전용입니다.' });

  if (p === '/' || p === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(ROOT, 'web', 'preview.html')), 'text/html; charset=utf-8');
  }
  if (p === '/api/state') return send(res, 200, summary());
  if (p === '/api/part') {
    const part = state.composed && state.composed.parts.find((x) => x.id === url.searchParams.get('id'));
    if (!part) return send(res, 404, { error: '그 장이 없습니다.' });
    const { markdownToHtml } = require('./markdown');
    return send(res, 200, { ...part, html: markdownToHtml(part.markdown, { imgBase: '/img/' }) });
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ version: state.version, status: state.status, progress: state.progress })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return undefined;
  }
  if (p.startsWith('/img/')) {
    const [docId, ...rest] = p.slice(5).split('/');
    const doc = state.ctx && [...state.ctx.docs, state.ctx.attachments].find((d) => d && d.docId === docId);
    const buf = doc && doc.parsed.images.get(rest.join('/'));
    if (!buf) return send(res, 404, { error: '그림이 없습니다.' });
    return send(res, 200, buf, MIME[path.extname(p).toLowerCase()] || 'application/octet-stream');
  }
  return send(res, 404, { error: '없는 주소입니다.' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`미리보기: http://127.0.0.1:${PORT}  (프로젝트: ${PROJECT_FILE})`);
  rebuild();
});
