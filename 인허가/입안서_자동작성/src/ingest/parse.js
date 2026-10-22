'use strict';
// 보고서 파일(HWP/HWPX/PDF/DOCX/XLSX/CSV)을 kordoc 으로 읽어 공통 구조로 돌려준다.

const fs = require('fs');
const path = require('path');
const kordoc = require('kordoc');

const SUPPORTED = new Set(['.hwp', '.hwpx', '.pdf', '.docx', '.xlsx', '.xls', '.csv']);

class IngestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IngestError';
  }
}

/**
 * @param {string} filePath
 * @param {{pages?: string|number[]}} [options]
 * @returns {Promise<{path:string,name:string,format:string,pageCount:number|null,
 *   blocks:object[],images:Map<string,Buffer>,metadata:object,markdown:string,warnings:string[]}>}
 */
async function parseFile(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new IngestError('파일 경로가 없습니다.');
  }
  const abs = path.resolve(filePath);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new IngestError(`파일을 찾을 수 없습니다: ${abs}`);
  }
  if (!stat.isFile()) throw new IngestError(`파일이 아닙니다: ${abs}`);
  if (stat.size === 0) throw new IngestError(`빈 파일입니다: ${path.basename(abs)}`);

  const ext = path.extname(abs).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    throw new IngestError(
      `지원하지 않는 형식입니다(${ext || '확장자 없음'}). .hwp .hwpx .pdf .docx .xlsx .xls .csv 파일만 읽을 수 있습니다: ${path.basename(abs)}`
    );
  }

  const buf = fs.readFileSync(abs);
  if (ext === '.csv') return parseCsvFile(abs, buf);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  let result;
  try {
    result = await kordoc.parse(ab, options.pages ? { pages: options.pages } : undefined);
  } catch (e) {
    throw new IngestError(`파일을 읽는 중 오류가 났습니다(${path.basename(abs)}): ${e.message}`);
  }
  if (!result || result.success === false) {
    const why = result && result.error ? result.error : '알 수 없는 오류';
    throw new IngestError(`파일을 읽지 못했습니다(${path.basename(abs)}): ${why}`);
  }

  const images = new Map();
  for (const im of result.images || []) {
    if (im && im.filename && im.data) {
      images.set(im.filename, Buffer.from(im.data.buffer, im.data.byteOffset, im.data.byteLength));
    }
  }

  const metadata = result.metadata || {};
  return {
    path: abs,
    name: path.basename(abs),
    format: result.fileType || ext.slice(1),
    pageCount: result.pageCount != null ? result.pageCount : metadata.pageCount != null ? metadata.pageCount : null,
    blocks: result.blocks || [],
    images,
    metadata,
    markdown: result.markdown || '',
    warnings: (result.warnings || []).map((w) => (typeof w === 'string' ? w : w.message || JSON.stringify(w))),
  };
}

// --- CSV -----------------------------------------------------------------

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BOM = String.fromCharCode(0xfeff);

/** UTF-8 이 아니면(한국어 엑셀 기본 저장 = CP949) euc-kr 로 읽는다 */
function decodeCsv(buf) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('euc-kr').decode(buf);
  }
  return text.charAt(0) === BOM ? text.slice(1) : text;
}

/** 따옴표·쉼표·줄바꿈을 처리하는 작은 CSV 파서 */
function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === LF) { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== CR) cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseCsvFile(abs, buf) {
  const rows = splitCsv(decodeCsv(buf));
  if (!rows.length) throw new IngestError(`내용이 없는 CSV 입니다: ${path.basename(abs)}`);
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, i) => ({ text: (r[i] || '').trim(), colSpan: 1, rowSpan: 1 })));
  const name = path.basename(abs, path.extname(abs));
  const table = { rows: rows.length, cols, cells, hasHeader: true };
  const blocks = [{ type: 'heading', level: 2, text: name }, { type: 'table', table }];
  return {
    path: abs, name: path.basename(abs), format: 'csv', pageCount: null, blocks,
    images: new Map(), metadata: {}, markdown: '', warnings: [],
  };
}

module.exports = { parseFile, IngestError, SUPPORTED, splitCsv };
