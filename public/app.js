import { renderPage, renderScaled, resolveColor } from './render.js';

// =====================================================================
// 工具
// =====================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
};
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fmtTime = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });

function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`服务器返回异常（HTTP ${res.status}）`);
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const storage = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

// =====================================================================
// 路由
// =====================================================================
const views = { gallery: $('#view-gallery'), editor: $('#view-editor'), history: $('#view-history') };

function showView(name) {
  for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

async function route() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const hash = location.hash.replace(/^#/, '') || '/';
  let m;
  if ((m = /^\/edit\/([^/]+)$/.exec(hash))) {
    showView('editor');
    await openEditor(decodeURIComponent(m[1]));
  } else if (hash === '/history') {
    showView('history');
    loadHistory();
  } else {
    showView('gallery');
    if (!galleryLoaded) loadGallery();
  }
}
window.addEventListener('hashchange', route);

// =====================================================================
// 模板库
// =====================================================================
let galleryLoaded = false;
let templates = [];
let activeCategory = '全部';

let isStaticMode = false;

const tplResolver = (id) => (src) => {
  if (!src) return '';
  if (/^(https?:|data:)/i.test(src)) return src;
  const rel = String(src).split('/').map(encodeURIComponent).join('/');
  return isStaticMode
    ? `./templates/${encodeURIComponent(id)}/${rel}`
    : `/tpl/${encodeURIComponent(id)}/${rel}`;
};

async function loadGallery() {
  const grid = $('#template-grid');
  try {
    let data;
    try {
      data = await api('./api/templates');
    } catch {
      data = await api('./data/templates.json');
      isStaticMode = true;
    }
    templates = data.templates;
    galleryLoaded = true;
  } catch (e) {
    grid.innerHTML = '';
    grid.appendChild(h('div', { class: 'empty', text: '加载模板失败：' + e.message }));
    return;
  }
  renderFilters();
  renderGrid();
}

function renderFilters() {
  const cats = ['全部', ...new Set(templates.map((t) => t.category))];
  const box = $('#category-filters');
  box.innerHTML = '';
  for (const c of cats) {
    box.appendChild(
      h('button', {
        class: 'chip' + (c === activeCategory ? ' active' : ''),
        text: c,
        onclick: () => {
          activeCategory = c;
          renderFilters();
          renderGrid();
        },
      }),
    );
  }
}

function renderGrid() {
  const grid = $('#template-grid');
  grid.innerHTML = '';
  const list = templates.filter((t) => activeCategory === '全部' || t.category === activeCategory);
  if (!list.length) {
    grid.appendChild(h('div', { class: 'empty', text: '没有模板。把 PPTD 项目文件夹放进 templates/ 目录即可出现在这里。' }));
    return;
  }
  for (const t of list) {
    const cover = h('div', { class: 'card-cover', title: '预览全部页面', onclick: () => openPreview(t.id) });
    cover.appendChild(h('span', { class: 'card-badge', text: `${t.pageCount} 页` }));
    grid.appendChild(
      h(
        'article',
        { class: 'card' },
        cover,
        h(
          'div',
          { class: 'card-body' },
          h('div', { class: 'card-title' }, h('h3', { text: t.name }), h('span', { class: 'muted small', text: t.category })),
          h('p', { text: t.description || t.title }),
          h('div', { class: 'tags' }, (t.tags || []).map((g) => h('span', { class: 'tag', text: g }))),
          h(
            'div',
            { class: 'card-actions' },
            h('button', { class: 'btn', text: '预览全部', onclick: () => openPreview(t.id) }),
            h('button', { class: 'btn primary', text: '使用此模板', onclick: () => (location.hash = '#/edit/' + encodeURIComponent(t.id)) }),
          ),
        ),
      ),
    );
    // 封面按卡片实际宽度渲染
    requestAnimationFrame(() => {
      const w = cover.clientWidth || 360;
      const ctx = { size: t.size, theme: t.theme, resolveSrc: tplResolver(t.id) };
      cover.prepend(renderScaled(t.cover || { elements: [] }, ctx, w));
    });
  }
}

const deckCache = new Map();
async function fetchDeck(id) {
  if (!deckCache.has(id)) {
    const fetcher = async () => {
      try {
        const d = await api('./api/templates/' + encodeURIComponent(id));
        return d.deck;
      } catch {
        const d = await api('./data/templates/' + encodeURIComponent(id) + '.json');
        isStaticMode = true;
        return d.deck;
      }
    };
    deckCache.set(id, fetcher());
  }
  try {
    return await deckCache.get(id);
  } catch (e) {
    deckCache.delete(id);
    throw e;
  }
}

async function openPreview(id) {
  const dlg = $('#preview-dialog');
  const grid = $('#preview-grid');
  grid.innerHTML = '<div class="empty">加载中…</div>';
  dlg.showModal();
  let deck;
  try {
    deck = await fetchDeck(id);
  } catch (e) {
    grid.innerHTML = '';
    grid.appendChild(h('div', { class: 'empty', text: '加载失败：' + e.message }));
    return;
  }
  $('#preview-title').textContent = `${deck.name} · ${deck.pages.length} 页`;
  $('#preview-desc').textContent = deck.description || deck.manifest.title || '';
  $('#preview-use').onclick = () => {
    dlg.close();
    location.hash = '#/edit/' + encodeURIComponent(id);
  };
  grid.innerHTML = '';
  const ctx = { size: deck.manifest.size, theme: deck.manifest.theme, resolveSrc: tplResolver(id) };
  const figs = deck.pages.map((p, i) => {
    const fig = h('figure', {}, h('figcaption', { text: `${i + 1}. ${p.data.pageType || ''} · ${p.file}` }));
    grid.appendChild(fig);
    return fig;
  });
  // 先排版再按格子实际宽度渲染
  requestAnimationFrame(() => {
    figs.forEach((fig, i) => fig.prepend(renderScaled(deck.pages[i].data, ctx, fig.clientWidth || 360)));
  });
}

document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  }),
);

// =====================================================================
// 编辑器状态
// =====================================================================
/**
 * state = {
 *   templateId, deck(原始), title, theme, transition,
 *   pages: [{ uid, origin:number(模板页序号), copy:bool, data }],
 *   uploads: { 'media/upload_x.png': dataURL },
 *   current: number
 * }
 */
let state = null;
let uidSeq = 1;
const draftKey = (id) => 'pptgen:draft:' + id;

function newState(deck, draft) {
  const s = {
    templateId: deck.id,
    deck,
    title: deck.manifest.title || deck.name,
    theme: clone(deck.manifest.theme || {}),
    transition: 'fade',
    pages: deck.pages.map((p, i) => ({ uid: uidSeq++, origin: i, copy: false, data: clone(p.data) })),
    uploads: {},
    current: 0,
  };
  if (draft && draft.templateId === deck.id && Array.isArray(draft.pages)) {
    Object.assign(s, {
      title: draft.title ?? s.title,
      theme: draft.theme ?? s.theme,
      transition: draft.transition ?? s.transition,
      pages: draft.pages.map((p) => ({ ...p, uid: uidSeq++ })),
      uploads: draft.uploads || {},
      current: 0,
    });
  }
  return s;
}

const saveDraft = debounce(() => {
  if (!state) return;
  const data = {
    templateId: state.templateId,
    title: state.title,
    theme: state.theme,
    transition: state.transition,
    pages: state.pages.map(({ origin, copy, data }) => ({ origin, copy, data })),
    uploads: state.uploads,
    savedAt: Date.now(),
  };
  let ok = storage.set(draftKey(state.templateId), data);
  if (!ok) ok = storage.set(draftKey(state.templateId), { ...data, uploads: {} }); // 图片太大存不下就只存文字
  $('#save-state').textContent = ok ? '草稿已自动保存' : '';
}, 600);

function resolver() {
  const base = tplResolver(state.templateId);
  return (src) => state.uploads[src] || base(src);
}
const ctxOf = () => ({ size: state.deck.manifest.size || [960, 540], theme: state.theme, resolveSrc: resolver() });
const curPage = () => state.pages[state.current];

async function openEditor(id) {
  if (state && state.templateId === id) {
    renderEditor();
    return;
  }
  $('#tab-content').innerHTML = '<div class="empty">加载中…</div>';
  let deck;
  try {
    deck = await fetchDeck(id);
  } catch (e) {
    toast('加载模板失败：' + e.message);
    location.hash = '#/';
    return;
  }
  const draft = storage.get(draftKey(id));
  state = newState(deck, draft);
  if (draft && draft.templateId === id) toast('已恢复上次未生成的草稿（可点“重置”恢复模板原样）', 3600);
  $('#editor-template-name').textContent = '模板：' + deck.name;
  $('#save-state').textContent = '';
  renderEditor();
}

function renderEditor() {
  $('#deck-title').value = state.title;
  renderPageList();
  renderStage();
  renderForm();
  renderSettings();
}

// =====================================================================
// 左侧：页面列表
// =====================================================================
const THUMB_W = 176;

function renderPageList() {
  const list = $('#page-list');
  list.innerHTML = '';
  $('#page-count').textContent = state.pages.length;
  state.pages.forEach((p, i) => {
    const thumb = h('div', { class: 'page-thumb', onclick: () => selectPage(i) });
    thumb.appendChild(renderScaled(p.data, ctxOf(), list.clientWidth > 220 ? THUMB_W : Math.max(120, list.clientWidth - 48)));
    const tools = h(
      'div',
      { class: 'page-tools' },
      h('button', { class: 'btn icon', title: '上移', text: '↑', disabled: i === 0, onclick: (e) => (e.stopPropagation(), movePage(i, -1)) }),
      h('button', { class: 'btn icon', title: '下移', text: '↓', disabled: i === state.pages.length - 1, onclick: (e) => (e.stopPropagation(), movePage(i, 1)) }),
      h('button', { class: 'btn icon', title: '复制此页（用于增加同版式页面）', text: '⧉', onclick: (e) => (e.stopPropagation(), duplicatePage(i)) }),
      h('button', { class: 'btn icon danger', title: '删除此页', text: '✕', onclick: (e) => (e.stopPropagation(), deletePage(i)) }),
    );
    thumb.appendChild(tools);
    const li = h('li', { class: 'page-item' + (i === state.current ? ' active' : ''), 'data-uid': p.uid }, h('span', { class: 'page-num', text: String(i + 1) }), thumb);
    if (p.copy) li.appendChild(h('span', { class: 'page-flag', text: '副本' }));
    list.appendChild(li);
  });
  list.querySelector('.page-item.active')?.scrollIntoView({ block: 'nearest' });
}

function refreshThumb(index = state.current) {
  const p = state.pages[index];
  const li = $(`#page-list .page-item[data-uid="${p.uid}"] .page-thumb`);
  if (!li) return;
  const old = li.querySelector('.pptd-scaled');
  const w = old ? parseFloat(old.style.width) : THUMB_W;
  li.replaceChild(renderScaled(p.data, ctxOf(), w), old);
}
const refreshThumbLater = debounce(() => state && refreshThumb(), 350);

function selectPage(i) {
  state.current = Math.max(0, Math.min(i, state.pages.length - 1));
  document.querySelectorAll('#page-list .page-item').forEach((li, k) => li.classList.toggle('active', k === state.current));
  $('#page-list .page-item.active')?.scrollIntoView({ block: 'nearest' });
  renderStage();
  renderForm();
}

function movePage(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.pages.length) return;
  [state.pages[i], state.pages[j]] = [state.pages[j], state.pages[i]];
  if (state.current === i) state.current = j;
  else if (state.current === j) state.current = i;
  renderPageList();
  renderStage();
  saveDraft();
}

function duplicatePage(i) {
  const src = state.pages[i];
  state.pages.splice(i + 1, 0, { uid: uidSeq++, origin: src.origin, copy: true, data: clone(src.data) });
  state.current = i + 1;
  renderPageList();
  renderStage();
  renderForm();
  saveDraft();
  toast('已复制为第 ' + (i + 2) + ' 页');
}

function deletePage(i) {
  if (state.pages.length <= 1) return toast('至少保留一页');
  if (!confirm(`删除第 ${i + 1} 页？`)) return;
  state.pages.splice(i, 1);
  if (state.current >= state.pages.length) state.current = state.pages.length - 1;
  renderPageList();
  renderStage();
  renderForm();
  saveDraft();
}

// =====================================================================
// 中间：大预览
// =====================================================================
let editableIds = new Set();

function renderStage() {
  const stage = $('#stage');
  const page = curPage();
  const [W, H] = state.deck.manifest.size || [960, 540];
  const width = stage.clientWidth || 900;
  stage.innerHTML = '';
  stage.style.height = (H * width) / W + 'px';
  const scaled = renderScaled(page.data, ctxOf(), width);
  stage.appendChild(scaled);
  editableIds = new Set(editableElements(page.data).map((e) => e.elementId));
  scaled.querySelectorAll('.pptd-el').forEach((el) => {
    if (editableIds.has(el.dataset.elementId)) el.classList.add('editable');
  });
  if (activeElementId) highlight(activeElementId, true);
  $('#stage-info').textContent = `第 ${state.current + 1} / ${state.pages.length} 页`;
  $('#btn-prev').disabled = state.current === 0;
  $('#btn-next').disabled = state.current === state.pages.length - 1;
}
const renderStageLater = debounce(() => state && renderStage(), 90);

$('#stage').addEventListener('click', (e) => {
  const hit = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains('editable'));
  if (!hit) return;
  const id = hit.dataset.elementId;
  const card = $(`#tab-content .field-card[data-element-id="${CSS.escape(id)}"]`);
  switchTab('content');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
    card.querySelector('textarea, input')?.focus({ preventScroll: true });
  }
  setActive(id);
});

let activeElementId = null;
function highlight(id, on) {
  $('#stage')
    .querySelectorAll(`.pptd-el[data-element-id="${CSS.escape(id)}"]`)
    .forEach((n) => n.classList.toggle('is-active', on));
}
function setActive(id) {
  if (activeElementId) {
    highlight(activeElementId, false);
    $(`#tab-content .field-card[data-element-id="${CSS.escape(activeElementId)}"]`)?.classList.remove('is-active');
  }
  activeElementId = id;
  if (id) {
    highlight(id, true);
    $(`#tab-content .field-card[data-element-id="${CSS.escape(id)}"]`)?.classList.add('is-active');
  }
}

$('#btn-prev').addEventListener('click', () => selectPage(state.current - 1));
$('#btn-next').addEventListener('click', () => selectPage(state.current + 1));
window.addEventListener('resize', debounce(() => !views.editor.hidden && state && renderStage(), 150));
document.addEventListener('keydown', (e) => {
  if (views.editor.hidden || !state) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') selectPage(state.current - 1);
  if (e.key === 'ArrowRight' || e.key === 'PageDown') selectPage(state.current + 1);
});

// =====================================================================
// 右侧：本页内容表单
// =====================================================================
function hasText(el) {
  return el.elementType === 'text' && String(el.content?.text ?? '').replace(/<[^>]+>/g, '').trim() !== '';
}
function hasImage(el) {
  return el.elementType === 'image' || (el.elementType === 'shape' && el.fill?.type === 'image');
}
/** 模板在 template.json 里声明的装饰性图片（渐变块、动效背景等）不在表单中列出 */
function isDecoration(el) {
  const list = state?.deck?.decorations || [];
  const src = el.elementType === 'image' ? el.src : el.fill?.src;
  return !!src && list.includes(src);
}
function editableElements(page) {
  return (page.elements || []).filter(
    (el) => hasText(el) || (hasImage(el) && !isDecoration(el)) || el.elementType === 'table' || el.elementType === 'chart',
  );
}

/** 根据字号等猜一个人类可读的标签 */
function labelFor(el, theme) {
  if (el.elementType === 'image' || el.elementType === 'shape') return '图片';
  if (el.elementType === 'table') return '表格';
  if (el.elementType === 'chart') return '图表数据';
  const c = el.content || {};
  let size = c.fontSize;
  if (size == null && typeof c.style === 'string') size = theme?.textStyles?.[c.style.slice(1)]?.fontSize;
  const m = /font-size:\s*([\d.]+)px/.exec(String(c.text || ''));
  if (m) size = Math.max(size || 0, parseFloat(m[1]));
  size = size ?? 18;
  if (size >= 34) return '大标题';
  if (size >= 22) return '标题';
  if (size >= 15) return '正文';
  return '小字';
}

function renderForm() {
  const box = $('#tab-content');
  box.innerHTML = '';
  activeElementId = null;
  const page = curPage();
  const theme = state.theme;
  const origin = state.deck.pages[page.origin];

  box.appendChild(
    h(
      'div',
      { class: 'section-title' },
      `第 ${state.current + 1} 页 · ${page.data.pageType || '页面'}${page.copy ? '（副本）' : ''}`,
    ),
  );

  // 背景图
  if (page.data.background?.type === 'image') {
    box.appendChild(imageCard({
      id: '__background__',
      label: '页面背景图',
      get: () => page.data.background.src,
      set: (src) => (page.data.background.src = src),
      original: origin?.data?.background?.src,
    }));
  }

  // 元素按视觉位置（从上到下、从左到右）排序
  const els = editableElements(page.data)
    .slice()
    .sort((a, b) => (a.bounds?.[1] ?? 0) - (b.bounds?.[1] ?? 0) || (a.bounds?.[0] ?? 0) - (b.bounds?.[0] ?? 0));

  if (!els.length && page.data.background?.type !== 'image') {
    box.appendChild(h('div', { class: 'empty', text: '本页没有可编辑的文字或图片' }));
    return;
  }

  for (const el of els) {
    const originEl = origin?.data?.elements?.find((x) => x.elementId === el.elementId);
    if (el.elementType === 'text') box.appendChild(textCard(el, originEl, theme));
    else if (el.elementType === 'table') box.appendChild(tableCard(el));
    else if (el.elementType === 'chart') box.appendChild(chartCard(el));
    else if (el.elementType === 'image')
      box.appendChild(imageCard({ id: el.elementId, label: '图片', get: () => el.src, set: (s) => (el.src = s), original: originEl?.src, el }));
    else if (el.elementType === 'shape')
      box.appendChild(imageCard({ id: el.elementId, label: '图片填充', get: () => el.fill.src, set: (s) => (el.fill.src = s), original: originEl?.fill?.src, el }));
  }
}

function cardShell(id, label, extra) {
  const card = h(
    'div',
    {
      class: 'field-card',
      'data-element-id': id,
      onmouseenter: () => highlight(id, true),
      onmouseleave: () => id !== activeElementId && highlight(id, false),
      onfocusin: () => setActive(id),
    },
    h('div', { class: 'field-head' }, h('span', { class: 'field-label', text: label }), extra || h('span', { class: 'field-id', text: id })),
  );
  return card;
}

function changed() {
  renderStageLater();
  refreshThumbLater();
  saveDraft();
}

// ---- 文字 --------------------------------------------------------------
const isHtml = (s) => /<[a-z/][^>]*>/i.test(String(s ?? ''));

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px';
}

function textCard(el, originEl, theme) {
  const c = el.content;
  const resetBtn = h('button', { class: 'btn ghost small', text: '还原', title: '恢复模板原文' });
  const card = cardShell(el.elementId, labelFor(el, theme), resetBtn);
  const body = h('div');
  card.appendChild(body);
  resetBtn.hidden = !originEl || originEl.content?.text === c.text;
  resetBtn.addEventListener('click', () => {
    c.text = originEl.content.text;
    build();
    resetBtn.hidden = true;
    changed();
  });

  const commit = (text) => {
    c.text = text;
    resetBtn.hidden = !originEl || originEl.content?.text === c.text;
    changed();
  };

  function build() {
    body.innerHTML = '';
    if (!isHtml(c.text)) {
      // 纯文本：一个多行输入框，每行对应一段
      const raw = String(c.text ?? '').replace(/\n$/, '');
      const ta = h('textarea', { rows: Math.min(8, raw.split('\n').length) });
      ta.value = raw;
      ta.addEventListener('input', () => {
        autoGrow(ta);
        const keepNl = String(originEl?.content?.text ?? '').endsWith('\n') && ta.value.includes('\n');
        commit(ta.value + (keepNl ? '\n' : ''));
      });
      body.appendChild(ta);
      requestAnimationFrame(() => autoGrow(ta));
      return;
    }
    buildHtmlEditor(body, String(c.text), commit, build);
  }
  build();
  return card;
}

/**
 * 富文本：保留原有的 <p>/<span> 样式，只替换文字。
 * 每个段落（<p> 或 <li>）一行，段落里每个独立样式的文字片段一个输入框；
 * 段落可以复制（用于增加列表项）或删除。
 */
function buildHtmlEditor(container, html, commit, rebuild) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  const serialize = () => {
    const div = document.createElement('div');
    div.appendChild(root.cloneNode(true));
    return div.innerHTML;
  };

  // 找出“段落”单位
  let blocks = [];
  const tops = [...root.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
  const allBlocks = tops.every((n) => n.nodeType === 1 && /^(P|UL|OL|DIV)$/.test(n.tagName));
  for (const n of allBlocks ? tops : []) {
    if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) blocks.push(...n.querySelectorAll(':scope > li'));
    else blocks.push(n);
  }
  if (!blocks.length) blocks = [root];

  blocks.forEach((block) => {
    const texts = [];
    if (block.nodeType === 3) texts.push(block);
    else {
      const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) if (n.textContent.trim() || texts.length === 0) texts.push(n);
    }
    const inputs = h('div', { class: 'inputs' });
    texts.forEach((tn) => {
      const val = tn.textContent;
      const long = val.length > 28;
      const inp = long ? h('textarea', { rows: 2 }) : h('input', { type: 'text' });
      inp.value = val;
      inp.addEventListener('input', () => {
        tn.textContent = inp.value;
        if (long) autoGrow(inp);
        commit(serialize());
      });
      inputs.appendChild(inp);
      if (long) requestAnimationFrame(() => autoGrow(inp));
    });
    if (!texts.length) {
      inputs.appendChild(h('span', { class: 'muted small', text: '（空段落）' }));
    }
    const canTool = block !== root && block.nodeType === 1 && block.parentNode;
    const tools = canTool
      ? h(
          'div',
          { class: 'para-tools' },
          h('button', {
            class: 'btn icon ghost',
            title: '在下方复制一段（增加列表项）',
            text: '＋',
            onclick: () => {
              const copy = block.cloneNode(true);
              const sep = block.nextSibling?.nodeType === 3 && !block.nextSibling.textContent.trim() ? block.nextSibling.cloneNode() : null;
              block.after(copy);
              if (sep) block.after(sep);
              commit(serialize());
              rebuild();
            },
          }),
          h('button', {
            class: 'btn icon ghost',
            title: '删除这一段',
            text: '－',
            onclick: () => {
              if (blocks.length <= 1) return toast('至少保留一段');
              const next = block.nextSibling;
              if (next?.nodeType === 3 && !next.textContent.trim()) next.remove();
              block.remove();
              commit(serialize());
              rebuild();
            },
          }),
        )
      : null;
    container.appendChild(h('div', { class: 'field-para' }, inputs, tools));
  });
}

// ---- 图表数据 ------------------------------------------------------------
function chartCard(el) {
  const card = cardShell(el.elementId, '图表数据');
  const data = (el.data = el.data || { cols: [], rows: [] });
  const body = h('div');
  card.appendChild(body);
  const numericCols = new Set();
  data.cols.forEach((c, i) => {
    if (data.rows.some((r) => typeof r[i] === 'number')) numericCols.add(i);
  });
  const build = () => {
    body.innerHTML = '';
    const grid = h('div', { class: 'table-grid', style: { gridTemplateColumns: `repeat(${data.cols.length}, 1fr) 28px` } });
    data.cols.forEach((c) => grid.appendChild(h('div', { class: 'muted small', text: c })));
    grid.appendChild(h('span'));
    data.rows.forEach((row, ri) => {
      row.forEach((v, ci) => {
        const inp = h('input', { type: numericCols.has(ci) ? 'number' : 'text', step: 'any' });
        inp.value = v ?? '';
        inp.addEventListener('input', () => {
          row[ci] = numericCols.has(ci) ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
          changed();
        });
        grid.appendChild(inp);
      });
      grid.appendChild(
        h('button', {
          class: 'btn icon ghost',
          title: '删除这一行',
          text: '－',
          disabled: data.rows.length <= 1,
          onclick: () => {
            data.rows.splice(ri, 1);
            build();
            changed();
          },
        }),
      );
    });
    body.appendChild(grid);
    body.appendChild(
      h('div', { class: 'table-actions' },
        h('button', {
          class: 'btn small',
          text: '＋ 增加一行数据',
          onclick: () => {
            const last = data.rows.at(-1) || [];
            data.rows.push(data.cols.map((_, i) => (numericCols.has(i) ? 0 : '新项目')));
            build();
            changed();
          },
        }),
      ),
    );
  };
  build();
  return card;
}

// ---- 表格 --------------------------------------------------------------
function tableCard(el) {
  const card = cardShell(el.elementId, '表格');
  const cols = Math.max(...(el.rows || []).map((r) => r.reduce((s, c) => s + (c.colSpan || 1), 0)), 1);
  const grid = h('div', { class: 'table-grid', style: { gridTemplateColumns: `repeat(${Math.min(cols, 6)}, 1fr)` } });
  (el.rows || []).forEach((row) =>
    row.forEach((cell) => {
      const holder = cell.text != null ? cell : cell.content && cell.content.text != null ? cell.content : cell;
      const raw = String(holder.text ?? '');
      const box = h('div', { class: 'cell-box' });
      if (cell.colSpan > 1) box.style.gridColumn = `span ${Math.min(cell.colSpan, cols)}`;
      if (isHtml(raw)) {
        // 富文本单元格：每个文字片段一个输入框，保留原有样式
        const tpl = document.createElement('template');
        tpl.innerHTML = raw;
        const nodes = [];
        const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) if (n.textContent.trim()) nodes.push(n);
        nodes.forEach((tn) => {
          const inp = h('input', { type: 'text' });
          inp.value = tn.textContent;
          inp.addEventListener('input', () => {
            tn.textContent = inp.value;
            const div = document.createElement('div');
            div.appendChild(tpl.content.cloneNode(true));
            holder.text = div.innerHTML;
            changed();
          });
          box.appendChild(inp);
        });
      } else {
        const multi = raw.replace(/\n$/, '').includes('\n');
        const inp = multi ? h('textarea', { rows: 2 }) : h('input', { type: 'text' });
        inp.value = raw.replace(/\n$/, '');
        inp.addEventListener('input', () => {
          holder.text = inp.value.includes('\n') ? inp.value + '\n' : inp.value;
          changed();
        });
        box.appendChild(inp);
      }
      grid.appendChild(box);
    }),
  );
  card.appendChild(grid);

  // 行增删（含纵向合并单元格的表格不支持）
  const hasRowSpan = (el.rows || []).some((r) => r.some((c) => (c.rowSpan || 1) > 1));
  if (!hasRowSpan && el.rows?.length) {
    const normalize = () => {
      if (!el.rowHeights?.length) return;
      const hs = el.rowHeights;
      const sum = hs.reduce((a, b) => a + b, 0) || 1;
      el.rowHeights = hs.map((x) => Math.round((x / sum) * 10000) / 10000);
      const diff = 1 - el.rowHeights.reduce((a, b) => a + b, 0);
      el.rowHeights[el.rowHeights.length - 1] = Math.round((el.rowHeights.at(-1) + diff) * 10000) / 10000;
    };
    const after = () => {
      changed();
      renderForm();
      setActive(el.elementId);
      $(`#tab-content .field-card[data-element-id="${CSS.escape(el.elementId)}"]`)?.scrollIntoView({ block: 'center' });
    };
    card.appendChild(
      h(
        'div',
        { class: 'table-actions' },
        h('button', {
          class: 'btn small',
          text: '＋ 增加一行',
          title: '复制最后一行的样式，行高自动均分（表格总高度不变）',
          onclick: () => {
            el.rows.push(clone(el.rows.at(-1)));
            if (Array.isArray(el.rowHeights)) el.rowHeights.push(el.rowHeights.at(-1) ?? 1 / el.rows.length);
            normalize();
            after();
          },
        }),
        h('button', {
          class: 'btn small',
          text: '－ 删除最后一行',
          disabled: el.rows.length <= 1,
          onclick: () => {
            el.rows.pop();
            if (Array.isArray(el.rowHeights)) el.rowHeights.pop();
            normalize();
            after();
          },
        }),
      ),
    );
  }
  return card;
}

// ---- 图片 --------------------------------------------------------------
async function fileToDataUrl(file) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  // 过大的图片按 2560px 长边压缩，避免 PPTX 体积暴涨
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('无法读取图片'));
    i.src = dataUrl;
  });
  const max = 2560;
  if (Math.max(img.width, img.height) <= max && file.size < 4 * 1024 * 1024) return { dataUrl, type: file.type };
  const k = max / Math.max(img.width, img.height, max);
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * Math.min(1, k));
  cv.height = Math.round(img.height * Math.min(1, k));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return { dataUrl: cv.toDataURL(type, 0.9), type };
}

function imageCard({ id, label, get, set, original, el }) {
  const card = cardShell(id, label);
  const thumb = h('img', { alt: '' });
  const name = h('div', { class: 'field-id' });
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif', hidden: true });
  const resetBtn = h('button', { class: 'btn small ghost', text: '还原' });
  const refresh = () => {
    const src = get();
    thumb.src = resolver()(src);
    name.textContent = state.uploads[src] ? '已上传的新图片' : src;
    resetBtn.hidden = !original || src === original;
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    if (!/^image\/(png|jpe?g|gif)$/.test(f.type)) return toast('只支持 PNG / JPG / GIF 图片');
    try {
      const { dataUrl, type } = await fileToDataUrl(f);
      const ext = type === 'image/png' ? 'png' : type === 'image/gif' ? 'gif' : 'jpg';
      const key = `media/upload_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${ext}`;
      state.uploads[key] = dataUrl;
      set(key);
      refresh();
      changed();
    } catch (e) {
      toast('图片读取失败：' + e.message);
    }
  });
  resetBtn.addEventListener('click', () => {
    set(original);
    refresh();
    changed();
  });
  const fitSel = el && el.elementType === 'image'
    ? h(
        'select',
        {
          title: '图片适配方式',
          onchange: (e) => {
            el.fit = { mode: e.target.value };
            changed();
          },
        },
        [['cover', '填满裁剪'], ['contain', '完整显示'], ['fill', '拉伸']].map(([v, t]) =>
          h('option', { value: v, text: t, selected: (el.fit?.mode || 'cover') === v }),
        ),
      )
    : null;
  card.appendChild(
    h(
      'div',
      { class: 'img-field' },
      thumb,
      h(
        'div',
        { class: 'col' },
        name,
        h('div', { class: 'row' }, h('button', { class: 'btn small', text: '替换图片', onclick: () => fileInput.click() }), fitSel, resetBtn),
      ),
      fileInput,
    ),
  );
  refresh();
  return card;
}

// =====================================================================
// 右侧：整体设置
// =====================================================================
function renderSettings() {
  const box = $('#tab-settings');
  box.innerHTML = '';
  box.appendChild(h('div', { class: 'section-title', text: '页面切换' }));
  const sel = h(
    'select',
    { onchange: (e) => ((state.transition = e.target.value), saveDraft()) },
    h('option', { value: 'fade', text: '淡入淡出（推荐）', selected: state.transition === 'fade' }),
    h('option', { value: 'none', text: '无切换效果', selected: state.transition === 'none' }),
  );
  box.appendChild(h('div', { class: 'setting' }, sel));

  const colors = state.theme.colors || {};
  const keys = Object.keys(colors);
  box.appendChild(h('div', { class: 'section-title', text: '主题配色' }));
  if (!keys.length) {
    box.appendChild(h('p', { class: 'muted small', text: '此模板没有定义主题色。' }));
  } else {
    box.appendChild(h('p', { class: 'muted small', text: '修改后所有引用该颜色的元素都会同步变化（页面里直接写死的颜色不受影响）。' }));
    const original = state.deck.manifest.theme?.colors || {};
    for (const k of keys) {
      const raw = String(colors[k]);
      const hex6 = /^#[0-9a-f]{6}/i.test(raw) ? raw.slice(0, 7) : resolveColor(raw, state.theme, '#000000');
      const alpha = /^#[0-9a-f]{8}$/i.test(raw) ? raw.slice(7) : '';
      const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(hex6) ? hex6 : '#000000' });
      const text = h('input', { type: 'text', value: raw, spellcheck: 'false' });
      const apply = (v) => {
        colors[k] = v;
        renderStageLater();
        refreshAllThumbsLater();
        saveDraft();
      };
      picker.addEventListener('input', () => {
        const v = picker.value.toUpperCase() + alpha;
        text.value = v;
        apply(v);
      });
      text.addEventListener('change', () => {
        const v = text.value.trim();
        if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) && !v.startsWith('$')) {
          toast('颜色格式应为 #RRGGBB 或 #RRGGBBAA');
          text.value = colors[k];
          return;
        }
        if (/^#[0-9a-f]{6}/i.test(v)) picker.value = v.slice(0, 7);
        apply(v);
      });
      const row = h('div', { class: 'color-row' }, h('span', { class: 'key', title: original[k] ? '原值 ' + original[k] : '', text: '$' + k }), picker, text);
      box.appendChild(row);
    }
    box.appendChild(
      h('button', {
        class: 'btn small',
        text: '恢复默认配色',
        onclick: () => {
          state.theme.colors = clone(original);
          renderSettings();
          renderStage();
          renderPageList();
          saveDraft();
        },
      }),
    );
  }

  box.appendChild(h('div', { class: 'section-title', text: '说明' }));
  box.appendChild(
    h(
      'ul',
      { class: 'muted small', style: { paddingLeft: '18px', margin: 0 } },
      h('li', { text: '左侧缩略图悬停可上移 / 下移 / 复制 / 删除页面。复制页面可以快速增加同版式的内容页。' }),
      h('li', { text: '富文本段落右侧的 ＋ / － 可以增删列表项，并保留原有样式。' }),
      h('li', { text: '编辑内容会自动保存为草稿，刷新页面不会丢失。' }),
      h('li', { text: '生成后在 output/ 目录得到 PPTX 和可再次编辑的 PPTD 项目。' }),
    ),
  );
}
const refreshAllThumbsLater = debounce(() => state && renderPageList(), 300);

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-content').hidden = name !== 'content';
  $('#tab-settings').hidden = name !== 'settings';
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// =====================================================================
// 顶部操作
// =====================================================================
$('#deck-title').addEventListener('input', (e) => {
  state.title = e.target.value;
  saveDraft();
});
$('#btn-back').addEventListener('click', () => (location.hash = '#/'));
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('放弃所有修改，恢复模板原样？')) return;
  storage.del(draftKey(state.templateId));
  state = newState(state.deck, null);
  renderEditor();
  $('#save-state').textContent = '';
  toast('已恢复模板原样');
});

$('#btn-generate').addEventListener('click', generate);

async function generate() {
  if (!state) return;
  const title = (state.title || '').trim();
  if (!title) {
    $('#deck-title').focus();
    return toast('请先填写 PPT 标题');
  }
  // 只上传当前仍被引用的图片
  const used = new Set(JSON.stringify(state.pages.map((p) => p.data)).match(/media\/upload_[\w-]+\.\w+/g) || []);
  const uploads = Object.fromEntries(Object.entries(state.uploads).filter(([k]) => used.has(k)));
  const payload = {
    templateId: state.templateId,
    title,
    theme: state.theme,
    transition: state.transition,
    pages: state.pages.map((p) => p.data),
    uploads,
  };
  $('#busy').hidden = false;
  $('#btn-generate').disabled = true;
  try {
    let r;
    try {
      r = await api('./api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showResult(r);
      // 自动开始下载
      const a = h('a', { href: r.download, download: r.title + '.pptx' });
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      if (isStaticMode || e.message.includes('404') || e.message.includes('405')) {
        showStaticExportModal(payload);
      } else {
        showError(e.message);
      }
    }
  } finally {
    $('#busy').hidden = true;
    $('#btn-generate').disabled = false;
  }
}

function showStaticExportModal(payload) {
  const body = $('#result-body');
  body.innerHTML = '';
  const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const jsonUrl = URL.createObjectURL(jsonBlob);
  body.appendChild(
    h(
      'div',
      { class: 'result' },
      h('div', { class: 'icon-ok', text: '★' }),
      h('h2', { text: 'GitHub Pages 在线演示模式' }),
      h('p', { class: 'muted', text: `已就绪 · ${payload.title} · 共 ${payload.pages?.length || 0} 页` }),
      h('p', { style: { fontSize: '13px', lineHeight: '1.6', color: '#475569', textAlign: 'left', margin: '16px 0', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px' }, text: '当前部署在 GitHub Pages 纯静态环境。静态环境已完整支持所有模板的实时多设备预览与在线编辑。若需一键编译为离线 PPTX，请克隆仓库并在本地执行 npm start 启动官方 WASM 导出服务。您也可以下载当前编辑好的项目配置 JSON：' }),
      h(
        'div',
        { class: 'actions' },
        h('a', { class: 'btn primary', href: jsonUrl, download: `${payload.title || 'deck'}.pptd.json`, text: '下载 PPTD 数据 JSON' }),
        h('button', { class: 'btn', text: '继续在线编辑', onclick: () => $('#result-dialog').close() }),
      ),
    ),
  );
  $('#result-dialog').showModal();
}

function showResult(r) {
  const body = $('#result-body');
  body.innerHTML = '';
  body.appendChild(
    h(
      'div',
      { class: 'result' },
      h('div', { class: 'icon-ok', text: '✓' }),
      h('h2', { text: '生成成功' }),
      h('p', { class: 'muted', text: `${r.title}.pptx · ${r.pageCount} 页 · ${fmtSize(r.size)}` }),
      h('div', { class: 'path', title: '输出目录（含 PPTX 与可编辑的 PPTD 项目）', text: r.folder }),
      h(
        'div',
        { class: 'actions' },
        h('a', { class: 'btn primary', href: r.download, download: r.title + '.pptx', text: '下载 PPTX' }),
        h('button', { class: 'btn', text: '继续编辑', onclick: () => $('#result-dialog').close() }),
        h('button', {
          class: 'btn ghost',
          text: '查看生成记录',
          onclick: () => {
            $('#result-dialog').close();
            location.hash = '#/history';
          },
        }),
      ),
    ),
  );
  $('#result-dialog').showModal();
}

function showError(msg) {
  const body = $('#result-body');
  body.innerHTML = '';
  body.appendChild(
    h(
      'div',
      { class: 'result' },
      h('div', { class: 'icon-ok icon-err', text: '!' }),
      h('h2', { text: '生成失败' }),
      h('pre', { text: msg }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: '关闭', onclick: () => $('#result-dialog').close() })),
    ),
  );
  $('#result-dialog').showModal();
}

// =====================================================================
// 生成记录
// =====================================================================
async function loadHistory() {
  const box = $('#history-list');
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    let items = [];
    try {
      const res = await api('./api/history');
      items = res.items || [];
    } catch {
      items = [];
    }
    box.innerHTML = '';
    if (!items.length) {
      box.appendChild(
        h('div', {
          class: 'empty',
          text: isStaticMode
            ? '在线演示模式不保留服务器历史记录。在本地执行 npm start 启动服务即可保存与查看全部生成记录。'
            : '还没有生成过 PPT。',
        }),
      );
      return;
    }
    for (const it of items) {
      box.appendChild(
        h(
          'div',
          { class: 'history-row' },
          h('div', { style: { minWidth: 0 } }, h('div', { class: 'name', text: it.name }), h('div', { class: 'folder', text: it.folder, title: it.folder })),
          h('span', { class: 'muted small hide-sm', text: fmtTime(it.time) }),
          h('span', { class: 'muted small hide-sm', text: fmtSize(it.size) }),
          h('a', { class: 'btn small', href: it.download, download: it.name + '.pptx', text: '下载' }),
        ),
      );
    }
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'empty', text: '加载失败：' + e.message }));
  }
}

// =====================================================================
route();
