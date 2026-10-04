import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const DIST_DIR = path.join(ROOT, 'dist');

const parseYaml = (text) => YAML.parse(text, { maxAliasCount: -1 });

async function scanTemplates() {
  const found = [];
  const entries = await fsp.readdir(TEMPLATES_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const dir = path.join(TEMPLATES_DIR, ent.name);
    const files = await fsp.readdir(dir);
    const pptd = files.filter((f) => f.toLowerCase().endsWith('.pptd')).sort();
    if (!pptd.length) continue;
    let meta = {};
    if (files.includes('template.json')) {
      try {
        meta = JSON.parse(await fsp.readFile(path.join(dir, 'template.json'), 'utf8'));
      } catch (e) {
        console.warn(`[warn] ${dir}/template.json parse error:`, e.message);
      }
    }
    found.push({ id: ent.name, dir, manifest: path.join(dir, pptd[0]), meta });
  }
  found.sort((a, b) => (a.meta.order ?? 999) - (b.meta.order ?? 999) || a.id.localeCompare(b.id));
  return found;
}

async function loadDeck(tpl) {
  const manifest = parseYaml(await fsp.readFile(tpl.manifest, 'utf8')) || {};
  const pages = [];
  for (const rel of manifest.pages || []) {
    const abs = path.resolve(tpl.dir, rel);
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

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fsp.copyFile(s, d);
    }
  }
}

async function build() {
  console.log('Building static demo site into dist/...');
  await fsp.rm(DIST_DIR, { recursive: true, force: true });
  await fsp.mkdir(DIST_DIR, { recursive: true });

  // 1. Copy public static assets
  await copyDir(PUBLIC_DIR, DIST_DIR);

  // 2. Add .nojekyll for GitHub Pages
  await fsp.writeFile(path.join(DIST_DIR, '.nojekyll'), '');

  // 3. Scan templates and create static JSON
  const tpls = await scanTemplates();
  const summaryList = [];
  const dataDir = path.join(DIST_DIR, 'data');
  const tplsDataDir = path.join(dataDir, 'templates');
  await fsp.mkdir(tplsDataDir, { recursive: true });

  for (const t of tpls) {
    const deck = await loadDeck(t);
    summaryList.push({
      id: deck.id,
      name: deck.name,
      category: deck.category,
      description: deck.description,
      tags: deck.tags,
      pageCount: deck.pages.length,
      size: deck.manifest.size,
      theme: deck.manifest.theme,
      cover: deck.pages[0]?.data || null,
    });

    // Write individual deck json
    await fsp.writeFile(
      path.join(tplsDataDir, `${t.id}.json`),
      JSON.stringify({ ok: true, deck }, null, 2),
      'utf8'
    );

    // Copy template media
    const mediaSrc = path.join(t.dir, 'media');
    if (fs.existsSync(mediaSrc)) {
      const mediaDest = path.join(DIST_DIR, 'templates', t.id, 'media');
      await copyDir(mediaSrc, mediaDest);
    }
  }

  // Write summary templates list
  await fsp.writeFile(
    path.join(dataDir, 'templates.json'),
    JSON.stringify({ ok: true, templates: summaryList }, null, 2),
    'utf8'
  );

  console.log(`Successfully built ${tpls.length} templates for static demo!`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
