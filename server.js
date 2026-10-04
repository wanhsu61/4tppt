#!/usr/bin/env node
/**
 * Kimi PPT 模板生成器 —— 本地 Node 服务
 *
 * - 扫描 templates/ 目录（以及环境变量 TEMPLATE_DIRS 指定的目录）中的 PPTD 项目作为模板
 * - 提供模板列表 / 详情 / 媒体文件给前端渲染预览
 * - 接收前端填写好的页面内容，写出新的 PPTD 项目，并调用 vendor/export-pptd.mjs（官方 WASM）导出 PPTX
 *
 * 只依赖 Node 18+ 与 npm 包 `yaml`。
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(ROOT, 'output'));
const EXPORTER = path.join(ROOT, 'vendor', 'export-pptd.mjs');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 5180);
const MAX_BODY = 200 * 1024 * 1024; // 200MB，包含上传图片的 base64

const TEMPLATE_DIRS = [
  path.join(ROOT, 'templates'),
  ...String(process.env.TEMPLATE_DIRS || '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s)),
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
const parseYaml = (text) => YAML.parse(text, { maxAliasCount: -1 });
const dumpYaml = (obj) => YAML.stringify(obj, { lineWidth: 0, minContentWidth: 0 });

/** target 是否位于 base 目录内部（防止 ../ 越界） */
function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

async function sendFile(req, res, filePath, extraHeaders = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendError(res, 404, 'Not Found');
  }
  if (!stat.isFile()) return sendError(res, 404, 'Not Found');
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大（上限 200MB）'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function slugify(s, fallback = 'deck') {
  const out = String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return out || fallback;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// 模板扫描与加载
// ---------------------------------------------------------------------------
/** @returns {Promise<Array<{id:string, dir:string, manifest:string, meta:object}>>} */
async function scanTemplates() {
  const found = [];
  const usedIds = new Set();
  for (const base of TEMPLATE_DIRS) {
    let entries = [];
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const dir = path.join(base, ent.name);
      let files = [];
      try {
        files = await fsp.readdir(dir);
      } catch {
        continue;
      }
      const pptd = files.filter((f) => f.toLowerCase().endsWith('.pptd')).sort();
      if (!pptd.length) continue;
      let id = ent.name.replace(/[^\w.-]+/g, '-');
      while (usedIds.has(id)) id += '-2';
      usedIds.add(id);
      let meta = {};
      if (files.includes('template.json')) {
        try {
          meta = JSON.parse(await fsp.readFile(path.join(dir, 'template.json'), 'utf8'));
        } catch (e) {
          console.warn(`[warn] ${dir}/template.json 解析失败: ${e.message}`);
        }
      }
      found.push({ id, dir, manifest: path.join(dir, pptd[0]), meta });
    }
  }
  found.sort((a, b) => (a.meta.order ?? 999) - (b.meta.order ?? 999) || a.id.localeCompare(b.id));
  return found;
}

async function findTemplate(id) {
  const all = await scanTemplates();
  return all.find((t) => t.id === id) || null;
}

/** 读取完整 PPTD 项目：manifest + 每页数据 */
async function loadDeck(tpl) {
  const manifest = parseYaml(await fsp.readFile(tpl.manifest, 'utf8')) || {};
  const pages = [];
  for (const rel of manifest.pages || []) {
    const abs = path.resolve(tpl.dir, rel);
    if (!isInside(tpl.dir, abs)) continue;
    try {
      const data = parseYaml(await fsp.readFile(abs, 'utf8')) || {};
      pages.push({ file: rel, data });
    } catch (e) {
      pages.push({ file: rel, data: { elements: [] }, error: e.message });
    }
  }
  const { pages: _omit, ...rest } = manifest;
  return {
    id: tpl.id,
    name: tpl.meta.name || manifest.title || tpl.id,
    category: tpl.meta.category || '未分类',
    description: tpl.meta.description || '',
    tags: tpl.meta.tags || [],
    decorations: tpl.meta.decorations || [],
    manifest: rest,
    pages,
  };
}

// ---------------------------------------------------------------------------
// 生成 PPTD 项目 + 导出 PPTX
// ---------------------------------------------------------------------------
/** 遍历对象，收集所有 src 字段（图片元素、背景图、图片填充） */
function collectSrcs(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => collectSrcs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'src' && typeof v === 'string') out.add(v);
      else collectSrcs(v, out);
    }
  }
  return out;
}

/**
 * 兼容性修正（导出器对以下写法支持不完整，生成前统一规范化）：
 * 1. 富文本 style="color:$token" 里的主题色引用 → 直接替换成色值（否则导出为黑色）
 * 2. 表格单元格写成 {content: {text, align}} 的形式 → 展开为标准的 {text, align}
 * 3. 表格 style 里的简写字段（fontSize/bodyColor/firstColumnColor/border）→ 标准 TableStyleConfig
 */
function normalizePage(page, theme) {
  const colors = theme?.colors || {};
  const resolve = (v) => {
    let out = v;
    for (let i = 0; i < 5 && typeof out === 'string' && out.startsWith('$'); i++) out = colors[out.slice(1)];
    return typeof out === 'string' ? out : null;
  };
  const fixRich = (text) =>
    typeof text !== 'string'
      ? text
      : text.replace(/style\s*=\s*"([^"]*)"/gi, (all, css) =>
          `style="${css.replace(/\$([A-Za-z0-9_-]+)/g, (t, k) => resolve('$' + k) || t)}"`,
        );

  for (const el of page.elements || []) {
    if (el.elementType === 'text' && el.content) el.content.text = fixRich(el.content.text);
    if (el.elementType !== 'table') continue;
    if (el.style && typeof el.style === 'object') {
      const s = el.style;
      const known = ['cellStyle', 'firstRowStyle', 'lastRowStyle', 'firstColumnStyle', 'lastColumnStyle', 'bodyStyles', 'rowOverColumn'];
      const shorthand = Object.keys(s).filter((k) => !known.includes(k));
      if (shorthand.length) {
        const cellStyle = { ...(s.cellStyle || {}) };
        if (s.fontSize != null) cellStyle.fontSize = s.fontSize;
        if (s.bodyColor) cellStyle.color = s.bodyColor;
        if (s.border !== undefined) cellStyle.border = s.border;
        if (s.headerBold != null && s.firstRowStyle == null) s.firstRowStyle = { bold: !!s.headerBold };
        const out = { cellStyle };
        for (const k of known) if (s[k] !== undefined && k !== 'cellStyle') out[k] = s[k];
        if (s.firstColumnColor) out.firstColumnStyle = { ...(out.firstColumnStyle || {}), color: s.firstColumnColor };
        el.style = out;
      }
    }
    for (const row of el.rows || []) {
      for (const cell of row || []) {
        if (!cell || typeof cell !== 'object') continue;
        if (cell.content && typeof cell.content === 'object') {
          const { content, ...rest } = cell;
          Object.keys(cell).forEach((k) => delete cell[k]);
          Object.assign(cell, content, rest);
        }
        cell.text = fixRich(cell.text);
      }
    }
  }
  return page;
}

const UPLOAD_KEY =/^media\/upload_[A-Za-z0-9_-]{1,64}\.(png|jpe?g|gif)$/i;

function runExporter(projectDir, manifestPath, outputPath, transition) {
  return new Promise((resolve, reject) => {
    const args = [EXPORTER, manifestPath, '-o', outputPath, '--no-sign', '--transition', transition];
    const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('导出超时（120 秒）\n' + log));
    }, 120_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath)) resolve(log);
      else reject(new Error(`导出失败（exit ${code}）\n${log}`));
    });
  });
}

async function generate(body) {
  const { templateId, title, theme, pages, uploads = {}, transition = 'fade' } = body || {};
  const tpl = await findTemplate(String(templateId || ''));
  if (!tpl) throw Object.assign(new Error('模板不存在: ' + templateId), { status: 400 });
  if (!Array.isArray(pages) || !pages.length) {
    throw Object.assign(new Error('至少需要保留一页'), { status: 400 });
  }
  if (pages.length > 300) throw Object.assign(new Error('页数过多'), { status: 400 });

  const baseManifest = parseYaml(await fsp.readFile(tpl.manifest, 'utf8')) || {};
  const finalTheme = theme && typeof theme === 'object' ? theme : baseManifest.theme;
  const deckTitle = slugify(title || baseManifest.title, tpl.id);
  const outDir = path.join(OUTPUT_DIR, `${timestamp()}-${slugify(deckTitle).replace(/\s+/g, '_')}`);
  await fsp.mkdir(path.join(outDir, 'pages'), { recursive: true });

  // 1) 写页面文件
  const pageFiles = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p || typeof p !== 'object' || !Array.isArray(p.elements)) {
      throw Object.assign(new Error(`第 ${i + 1} 页数据无效`), { status: 400 });
    }
    const name = `pages/${String(i + 1).padStart(2, '0')}.page`;
    await fsp.writeFile(path.join(outDir, name), dumpYaml(normalizePage(p, finalTheme)), 'utf8');
    pageFiles.push(name);
  }

  // 2) 处理媒体：上传的写入，模板里的复制，网络地址保持不变
  const srcs = collectSrcs(pages);
  let mediaCount = 0;
  for (const src of srcs) {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) continue;
    const dest = path.resolve(outDir, src);
    if (!isInside(outDir, dest)) throw Object.assign(new Error('非法媒体路径: ' + src), { status: 400 });
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (Object.prototype.hasOwnProperty.call(uploads, src)) {
      if (!UPLOAD_KEY.test(src)) throw Object.assign(new Error('非法上传文件名: ' + src), { status: 400 });
      const m = /^data:image\/[\w+.-]+;base64,(.*)$/s.exec(String(uploads[src]));
      if (!m) throw Object.assign(new Error('上传图片格式错误: ' + src), { status: 400 });
      await fsp.writeFile(dest, Buffer.from(m[1], 'base64'));
      mediaCount++;
    } else {
      const from = path.resolve(tpl.dir, src);
      if (!isInside(tpl.dir, from) || !fs.existsSync(from)) {
        throw Object.assign(new Error('模板中找不到媒体文件: ' + src), { status: 400 });
      }
      await fsp.copyFile(from, dest);
      mediaCount++;
    }
  }

  // 3) 写 manifest
  const manifest = {
    version: baseManifest.version || 'v2',
    title: deckTitle,
    ...(baseManifest.customFonts ? { customFonts: baseManifest.customFonts } : {}),
    size: baseManifest.size || [960, 540],
    theme: finalTheme,
    pages: pageFiles,
  };
  const manifestPath = path.join(outDir, 'deck.pptd');
  await fsp.writeFile(manifestPath, dumpYaml(manifest), 'utf8');

  // 4) 导出 PPTX
  const pptxName = `${deckTitle}.pptx`;
  const pptxPath = path.join(outDir, pptxName);
  const t0 = Date.now();
  await runExporter(outDir, manifestPath, pptxPath, transition === 'none' ? 'none' : 'fade');
  const size = (await fsp.stat(pptxPath)).size;

  const relDir = path.relative(OUTPUT_DIR, outDir).split(path.sep).join('/');
  return {
    ok: true,
    title: deckTitle,
    pageCount: pages.length,
    mediaCount,
    size,
    ms: Date.now() - t0,
    download: `/output/${encodeURIComponent(relDir)}/${encodeURIComponent(pptxName)}`,
    folder: outDir,
  };
}

async function listHistory() {
  let dirs = [];
  try {
    dirs = await fsp.readdir(OUTPUT_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(OUTPUT_DIR, d.name);
    const files = await fsp.readdir(dir).catch(() => []);
    const pptx = files.find((f) => f.toLowerCase().endsWith('.pptx'));
    if (!pptx) continue;
    const st = await fsp.stat(path.join(dir, pptx));
    items.push({
      name: pptx.replace(/\.pptx$/i, ''),
      time: st.mtimeMs,
      size: st.size,
      download: `/output/${encodeURIComponent(d.name)}/${encodeURIComponent(pptx)}`,
      folder: dir,
    });
  }
  return items.sort((a, b) => b.time - a.time).slice(0, 50);
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendError(res, 400, 'Bad Request');
  }

  // --- API ---
  if (pathname === '/api/templates' && req.method === 'GET') {
    const list = [];
    for (const tpl of await scanTemplates()) {
      try {
        const deck = await loadDeck(tpl);
        list.push({
          id: deck.id,
          name: deck.name,
          category: deck.category,
          description: deck.description,
          tags: deck.tags,
          title: deck.manifest.title || '',
          size: deck.manifest.size || [960, 540],
          theme: deck.manifest.theme || {},
          pageCount: deck.pages.length,
          cover: deck.pages[0]?.data || null,
        });
      } catch (e) {
        console.warn(`[warn] 模板 ${tpl.id} 读取失败: ${e.message}`);
      }
    }
    return sendJson(res, 200, { ok: true, templates: list });
  }

  let m;
  if ((m = /^\/api\/templates\/([^/]+)$/.exec(pathname)) && req.method === 'GET') {
    const tpl = await findTemplate(m[1]);
    if (!tpl) return sendError(res, 404, '模板不存在');
    return sendJson(res, 200, { ok: true, deck: await loadDeck(tpl) });
  }

  if (pathname === '/api/generate' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return sendError(res, e.status || 400, e.status ? e.message : '请求不是合法 JSON');
    }
    try {
      const result = await generate(body);
      console.log(`[generate] ${result.title} · ${result.pageCount} 页 → ${result.folder}`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.error('[generate] 失败:', e.message);
      return sendError(res, e.status || 500, e.message);
    }
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, items: await listHistory() });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method Not Allowed');

  // --- 模板媒体：/tpl/<id>/<相对路径> ---
  if ((m = /^\/tpl\/([^/]+)\/(.+)$/.exec(pathname))) {
    const tpl = await findTemplate(m[1]);
    if (!tpl) return sendError(res, 404, '模板不存在');
    const file = path.resolve(tpl.dir, m[2]);
    if (!isInside(tpl.dir, file)) return sendError(res, 403, 'Forbidden');
    return sendFile(req, res, file);
  }

  // --- 生成结果下载：/output/<目录>/<文件> ---
  if ((m = /^\/output\/(.+)$/.exec(pathname))) {
    const file = path.resolve(OUTPUT_DIR, m[1]);
    if (!isInside(OUTPUT_DIR, file)) return sendError(res, 403, 'Forbidden');
    const name = path.basename(file);
    return sendFile(req, res, file, {
      'Content-Disposition': `attachment; filename="download.pptx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  }

  // --- 静态前端 ---
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!isInside(PUBLIC_DIR, file)) return sendError(res, 403, 'Forbidden');
  return sendFile(req, res, file);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendError(res, 500, e.message || 'Internal Error');
    else res.end();
  });
});

server.listen(PORT, HOST, async () => {
  const n = (await scanTemplates()).length;
  console.log('');
  console.log('  Kimi PPT 模板生成器已启动');
  console.log(`  ➜  打开 http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`);
  console.log(`  ➜  模板目录: ${TEMPLATE_DIRS.join(' ; ')}（共 ${n} 个模板）`);
  console.log(`  ➜  输出目录: ${OUTPUT_DIR}`);
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
