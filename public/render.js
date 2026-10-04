/**
 * PPTD 页面 → HTML 渲染器（用于浏览器内预览，不追求像素级一致，最终效果以导出的 PPTX 为准）
 *
 * renderPage(page, ctx) 返回一个 width×height 的绝对定位 DOM 节点。
 * ctx = { size:[w,h], theme:{colors,textStyles,tableStyles}, resolveSrc:(src)=>url, interactive?:bool }
 */

const DEFAULT_FONT =
  '"MiSans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

// ----------------------------------------------------------------- 颜色 / 填充
export function resolveColor(c, theme, fallback = null) {
  if (c == null || c === '') return fallback;
  let v = String(c).trim();
  for (let i = 0; i < 5 && v.startsWith('$'); i++) {
    const key = v.slice(1);
    v = theme?.colors?.[key];
    if (v == null) return fallback;
    v = String(v).trim();
  }
  return hexToCss(v);
}

function hexToCss(v) {
  const m = /^#([0-9a-f]{8})$/i.exec(v);
  if (!m) return v;
  const n = m[1];
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const a = parseInt(n.slice(6, 8), 16) / 255;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** 把富文本 style 字符串里的 $token 替换成真实颜色 */
function resolveStyleTokens(style, theme) {
  return String(style).replace(/\$([A-Za-z0-9_-]+)/g, (all, key) => {
    const v = resolveColor('$' + key, theme);
    return v || all;
  });
}

function gradientCss(fill, theme) {
  const stops = (fill.stops || [])
    .map((s) => `${resolveColor(s.color, theme, '#000')} ${Math.round((s.position ?? 0) * 100)}%`)
    .join(', ');
  if (fill.gradientType === 'radial') return `radial-gradient(circle at center, ${stops})`;
  const angle = ((fill.angle || 0) + 90) % 360; // PPTD 0°=左→右，CSS 90deg=左→右
  return `linear-gradient(${angle}deg, ${stops})`;
}

/** 把 Fill 应用到一个 div 上（背景） */
function applyFill(el, fill, ctx) {
  if (!fill) return;
  const theme = ctx.theme;
  if (fill.type === 'solid') {
    el.style.backgroundColor = resolveColor(fill.color, theme, 'transparent');
  } else if (fill.type === 'gradient') {
    el.style.backgroundImage = gradientCss(fill, theme);
  } else if (fill.type === 'image' && fill.src) {
    const layer = document.createElement('div');
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      backgroundImage: `url("${ctx.resolveSrc(fill.src)}")`,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: fitToBgSize(fill.fit?.mode),
      opacity: fill.opacity ?? 1,
      pointerEvents: 'none',
      borderRadius: 'inherit',
    });
    el.appendChild(layer);
  }
}

function fitToBgSize(mode) {
  if (mode === 'contain') return 'contain';
  if (mode === 'fill') return '100% 100%';
  return 'cover';
}

function borderCss(border, theme) {
  if (!border) return null;
  const w = border.width ?? 1;
  if (w <= 0) return null;
  const style = border.style === 'dash' ? 'dashed' : border.style === 'dot' ? 'dotted' : 'solid';
  return `${w}px ${style} ${resolveColor(border.color, theme, '#000')}`;
}

function shadowCss(shadow, theme) {
  if (!shadow) return null;
  const [x, y] = shadow.offset || [0, 0];
  return `${x}px ${y}px ${shadow.blur ?? 0}px ${resolveColor(shadow.color, theme, 'rgba(0,0,0,.3)')}`;
}

function baseBox(el, ctx) {
  const [x, y, w, h] = el.bounds || [0, 0, 0, 0];
  const div = document.createElement('div');
  div.className = 'pptd-el pptd-' + el.elementType;
  div.dataset.elementId = el.elementId || '';
  Object.assign(div.style, {
    position: 'absolute',
    left: x + 'px',
    top: y + 'px',
    width: Math.max(w, 0) + 'px',
    height: Math.max(h, 0) + 'px',
    boxSizing: 'border-box',
  });
  const t = [];
  if (el.rotation) t.push(`rotate(${el.rotation}deg)`);
  if (el.flip?.[0]) t.push('scaleX(-1)');
  if (el.flip?.[1]) t.push('scaleY(-1)');
  if (t.length) div.style.transform = t.join(' ');
  if (el.opacity != null) div.style.opacity = el.opacity;
  return div;
}

// ----------------------------------------------------------------- 富文本
const ALLOWED_TAGS = new Set([
  'P', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUP', 'SUB', 'A', 'UL', 'OL', 'LI', 'BR', 'DIV',
]);

/** PPTD text → 安全 HTML 片段（DocumentFragment） */
export function richTextToFragment(text, theme) {
  const src = String(text ?? '');
  const tpl = document.createElement('template');
  if (!/<[a-z/][^>]*>/i.test(src)) {
    // 纯文本：每行一个段落
    const lines = src.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || ' ';
      tpl.content.appendChild(p);
    }
    return tpl.content;
  }
  tpl.innerHTML = src;
  sanitize(tpl.content, theme);
  return tpl.content;
}

function sanitize(root, theme) {
  const walker = [...root.querySelectorAll('*')];
  for (const node of walker) {
    if (!ALLOWED_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      continue;
    }
    for (const attr of [...node.attributes]) {
      const n = attr.name.toLowerCase();
      if (n === 'style') node.setAttribute('style', resolveStyleTokens(attr.value, theme));
      else if (n === 'href' && node.tagName === 'A' && /^(https?:|mailto:)/i.test(attr.value)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener');
      } else node.removeAttribute(attr.name);
    }
  }
  // 纯文本节点（换行）在 HTML 模式下忽略
}

function textStyleOf(content, ctx) {
  const theme = ctx.theme || {};
  let base = {};
  if (typeof content.style === 'string' && content.style.startsWith('$')) {
    base = theme.textStyles?.[content.style.slice(1)] || {};
  } else if (content.style && typeof content.style === 'object') {
    base = content.style;
  }
  const keys = [
    'color', 'fontSize', 'fontFamily', 'bold', 'italic', 'backgroundColor',
    'lineHeight', 'lineHeightPx', 'letterSpacing', 'marginTop',
  ];
  const s = {};
  for (const k of keys) {
    if (content[k] !== undefined) s[k] = content[k];
    else if (base[k] !== undefined) s[k] = base[k];
  }
  return s;
}

function fontFamilyCss(ff) {
  if (!ff) return DEFAULT_FONT;
  if (typeof ff === 'object') {
    const parts = [ff.latin, ff.ea].filter(Boolean).map((f) => `"${f}"`);
    return parts.join(', ') + ', ' + DEFAULT_FONT;
  }
  return `"${ff}", ${DEFAULT_FONT}`;
}

function applyTextStyle(target, s, theme) {
  target.style.color = resolveColor(s.color, theme, '#000000');
  target.style.fontSize = (s.fontSize ?? 18) + 'px';
  target.style.fontFamily = fontFamilyCss(s.fontFamily);
  target.style.fontWeight = s.bold ? '700' : '400';
  target.style.fontStyle = s.italic ? 'italic' : 'normal';
  if (s.lineHeightPx) target.style.lineHeight = s.lineHeightPx + 'px';
  else target.style.lineHeight = String(s.lineHeight ?? 1.2);
  target.style.letterSpacing = (s.letterSpacing ?? 0) + 'px';
}

function renderText(el, ctx) {
  const div = baseBox(el, ctx);
  const c = el.content || {};
  const theme = ctx.theme;
  const s = textStyleOf(c, ctx);
  const [h, v] = c.align || ['left', 'top'];
  Object.assign(div.style, {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start',
    overflow: 'visible',
  });
  const inner = document.createElement('div');
  inner.className = 'pptd-text-inner';
  applyTextStyle(inner, s, theme);
  inner.style.textAlign = h === 'distributed' ? 'justify' : h || 'left';
  if (h === 'distributed') inner.style.textAlignLast = 'justify';
  inner.style.whiteSpace = c.wrap === false ? 'pre' : 'pre-wrap';
  inner.style.wordBreak = 'break-word';
  if (c.textDirection === 'vertical') {
    inner.style.writingMode = 'vertical-rl';
    inner.style.height = '100%';
  }
  if (s.backgroundColor) inner.style.setProperty('--pptd-hl', resolveColor(s.backgroundColor, theme));
  if (c.shadow) inner.style.textShadow = shadowCss(c.shadow, theme);
  if (c.gradient) {
    inner.style.backgroundImage = gradientCss(c.gradient, theme);
    inner.style.webkitBackgroundClip = 'text';
    inner.style.backgroundClip = 'text';
    inner.style.color = 'transparent';
  }
  const frag = richTextToFragment(c.text, theme);
  // 段落间距
  inner.appendChild(frag);
  if (s.marginTop) {
    [...inner.querySelectorAll(':scope > p + p, :scope > li + li')].forEach((p) => {
      if (!p.style.marginTop) p.style.marginTop = s.marginTop + 'px';
    });
  }
  // 富文本 HTML 模式下，<p> 之间的换行文本节点要去掉（white-space: pre-wrap 会显示出来）
  for (const n of [...inner.childNodes]) {
    if (n.nodeType === 3 && !n.textContent.trim()) n.remove();
  }
  div.appendChild(inner);
  return div;
}

// ----------------------------------------------------------------- 形状
function polygonFor(name) {
  switch (name) {
    case 'triangle':
      return 'polygon(50% 0, 100% 100%, 0 100%)';
    case 'rtTriangle':
      return 'polygon(0 0, 100% 100%, 0 100%)';
    case 'diamond':
      return 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)';
    case 'parallelogram':
      return 'polygon(25% 0, 100% 0, 75% 100%, 0 100%)';
    case 'trapezoid':
      return 'polygon(25% 0, 75% 0, 100% 100%, 0 100%)';
    case 'hexagon':
      return 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)';
    case 'octagon':
      return 'polygon(29% 0, 71% 0, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0 71%, 0 29%)';
    case 'pentagon':
      return 'polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)';
    case 'homePlate':
      return 'polygon(0 0, 80% 0, 100% 50%, 80% 100%, 0 100%)';
    case 'chevron':
      return 'polygon(0 0, 80% 0, 100% 50%, 80% 100%, 0 100%, 20% 50%)';
    case 'rightArrow':
      return 'polygon(0 25%, 60% 25%, 60% 0, 100% 50%, 60% 100%, 60% 75%, 0 75%)';
    case 'leftArrow':
      return 'polygon(40% 0, 40% 25%, 100% 25%, 100% 75%, 40% 75%, 40% 100%, 0 50%)';
    case 'star5':
      return 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
    default:
      return null;
  }
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
}

let gradSeq = 0;
function svgPaint(fill, defs, theme) {
  if (!fill) return 'none';
  if (fill.type === 'solid') return resolveColor(fill.color, theme, 'none');
  if (fill.type === 'gradient') {
    const id = 'pg' + ++gradSeq;
    let g;
    if (fill.gradientType === 'radial') g = svgEl('radialGradient', { id });
    else {
      const a = ((fill.angle || 0) * Math.PI) / 180;
      const x = Math.cos(a) / 2;
      const y = Math.sin(a) / 2;
      g = svgEl('linearGradient', { id, x1: 0.5 - x, y1: 0.5 - y, x2: 0.5 + x, y2: 0.5 + y });
    }
    for (const s of fill.stops || []) {
      g.appendChild(svgEl('stop', { offset: s.position ?? 0, 'stop-color': resolveColor(s.color, theme, '#000') }));
    }
    defs.appendChild(g);
    return `url(#${id})`;
  }
  return 'none';
}

function renderShape(el, ctx) {
  const div = baseBox(el, ctx);
  const theme = ctx.theme;
  const name = el.shapeName || 'rect';
  const [, , w, h] = el.bounds || [0, 0, 0, 0];

  if (name === 'custom' && el.path) {
    const [vw, vh] = el.viewBox || [w, h];
    const svg = svgEl('svg', { viewBox: `0 0 ${vw} ${vh}`, preserveAspectRatio: 'none', width: '100%', height: '100%' });
    svg.style.overflow = 'visible';
    const defs = svgEl('defs');
    svg.appendChild(defs);
    const p = svgEl('path', {
      d: el.path,
      fill: svgPaint(el.fill, defs, theme),
      'fill-rule': 'evenodd',
      stroke: el.border ? resolveColor(el.border.color, theme, '#000') : 'none',
      'stroke-width': el.border ? el.border.width ?? 1 : 0,
      'vector-effect': 'non-scaling-stroke',
    });
    svg.appendChild(p);
    if (el.shadow) div.style.filter = `drop-shadow(${shadowCss(el.shadow, theme)})`;
    div.appendChild(svg);
    return div;
  }

  applyFill(div, el.fill, ctx);
  const b = borderCss(el.border, theme);
  if (name === 'roundRect') {
    const adj = el.adjustments?.[0] ?? 16667;
    div.style.borderRadius = (Math.min(w, h) * adj) / 100000 + 'px';
  } else if (name === 'ellipse' || name === 'flowChartConnector') {
    div.style.borderRadius = '50%';
  } else if (name === 'line') {
    div.style.background = 'none';
  }
  const poly = polygonFor(name);
  if (poly) {
    div.style.clipPath = poly;
    if (el.shadow) div.style.filter = `drop-shadow(${shadowCss(el.shadow, theme)})`;
  } else {
    if (b) div.style.border = b;
    if (el.shadow) div.style.boxShadow = shadowCss(el.shadow, theme);
  }
  return div;
}

// ----------------------------------------------------------------- 线条
function renderLine(el, ctx) {
  const div = baseBox(el, ctx);
  const theme = ctx.theme;
  const [, , w, h] = el.bounds || [0, 0, 0, 0];
  const [vw, vh] = el.viewBox || [Math.max(w, 1), Math.max(h, 1)];
  const pts = String(el.points || '')
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
  div.style.overflow = 'visible';
  if (pts.length < 2) return div;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  const curve = el.curve || 'round';
  if (curve === 'smooth' && pts.length === 3) d += ` Q${pts[1]} ${pts[2]}`;
  else if (curve === 'smooth' && pts.length >= 4 && (pts.length - 1) % 3 === 0) {
    for (let i = 1; i < pts.length; i += 3) d += ` C${pts[i]} ${pts[i + 1]} ${pts[i + 2]}`;
  } else {
    for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0]},${pts[i][1]}`;
  }
  const svg = svgEl('svg', {
    viewBox: `0 0 ${vw} ${vh}`,
    preserveAspectRatio: 'none',
    width: Math.max(w, 1),
    height: Math.max(h, 1),
  });
  svg.style.overflow = 'visible';
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  const border = el.border || { width: 1, color: '#000' };
  const color = resolveColor(border.color, theme, '#000');
  const sw = border.width ?? 1;
  const path = svgEl('path', {
    d,
    fill: 'none',
    stroke: color,
    'stroke-width': sw,
    'stroke-linejoin': curve === 'sharp' ? 'miter' : 'round',
    'stroke-linecap': 'butt',
    'vector-effect': 'non-scaling-stroke',
    'stroke-dasharray': border.style === 'dash' ? `${sw * 4} ${sw * 3}` : border.style === 'dot' ? `${sw} ${sw * 2}` : null,
  });
  svg.appendChild(path);
  div.appendChild(svg);
  // 箭头：简单地用三角形画在端点（只处理首尾两点方向）
  const arrows = el.arrow || [];
  const sx = w / vw || 1;
  const sy = h / vh || 1;
  const toPx = (p) => [p[0] * sx, p[1] * sy];
  const drawArrow = (tip, from) => {
    const [tx, ty] = toPx(tip);
    const [fx, fy] = toPx(from);
    const ang = Math.atan2(ty - fy, tx - fx);
    const size = Math.max(6, sw * 3.5);
    const a = document.createElement('div');
    Object.assign(a.style, {
      position: 'absolute',
      left: tx - size + 'px',
      top: ty - size / 2 + 'px',
      width: size + 'px',
      height: size + 'px',
      background: color,
      clipPath: 'polygon(0 0, 100% 50%, 0 100%)',
      transformOrigin: '100% 50%',
      transform: `rotate(${ang}rad)`,
    });
    div.appendChild(a);
  };
  if (arrows[0]) drawArrow(pts[0], pts[1]);
  if (arrows[1]) drawArrow(pts[pts.length - 1], pts[pts.length - 2]);
  if (el.shadow) div.style.filter = `drop-shadow(${shadowCss(el.shadow, theme)})`;
  return div;
}

// ----------------------------------------------------------------- 图片
function renderImage(el, ctx) {
  const div = baseBox(el, ctx);
  const theme = ctx.theme;
  div.style.overflow = 'hidden';
  const cs = el.cropShape;
  if (cs?.shapeName === 'ellipse') div.style.borderRadius = '50%';
  else if (cs?.shapeName === 'roundRect') {
    const [, , w, h] = el.bounds;
    div.style.borderRadius = (Math.min(w, h) * (cs.adjustments?.[0] ?? 16667)) / 100000 + 'px';
  } else if (cs && polygonFor(cs.shapeName)) div.style.clipPath = polygonFor(cs.shapeName);
  const img = document.createElement('img');
  img.src = ctx.resolveSrc(el.src);
  img.alt = '';
  img.draggable = false;
  const crop = el.crop || {};
  const l = crop.left || 0, r = crop.right || 0, t = crop.top || 0, bt = crop.bottom || 0;
  if (l || r || t || bt) {
    // 近似：把图片放大后平移，显示裁剪后的区域
    const sw = 1 - l - r, sh = 1 - t - bt;
    Object.assign(img.style, {
      position: 'absolute',
      width: 100 / sw + '%',
      height: 100 / sh + '%',
      left: (-l / sw) * 100 + '%',
      top: (-t / sh) * 100 + '%',
      objectFit: 'fill',
    });
  } else {
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: el.fit?.mode === 'contain' ? 'contain' : el.fit?.mode === 'fill' ? 'fill' : 'cover',
    });
  }
  div.appendChild(img);
  const b = borderCss(el.border, theme);
  if (b) {
    const ov = document.createElement('div');
    Object.assign(ov.style, { position: 'absolute', inset: '0', border: b, borderRadius: 'inherit', pointerEvents: 'none' });
    div.appendChild(ov);
  }
  if (el.shadow) div.style.boxShadow = shadowCss(el.shadow, theme);
  return div;
}

// ----------------------------------------------------------------- 图标
function renderIcon(el, ctx) {
  const div = baseBox(el, ctx);
  const [, , w, h] = el.bounds || [0, 0, 0, 0];
  const [style, name] = String(el.iconName || 'fas:circle').split(':');
  const cls = { fas: 'fa-solid', far: 'fa-regular', fab: 'fa-brands' }[style] || 'fa-solid';
  const i = document.createElement('i');
  i.className = `${cls} fa-${name}`;
  Object.assign(div.style, { display: 'flex', alignItems: 'center', justifyContent: 'center' });
  i.style.fontSize = Math.min(w, h) * 0.9 + 'px';
  i.style.color = el.fill?.type === 'solid' ? resolveColor(el.fill.color, ctx.theme, '#000') : '#000';
  div.appendChild(i);
  return div;
}

// ----------------------------------------------------------------- 表格
function cellText(cell) {
  if (!cell) return '';
  if (cell.text != null) return cell.text;
  if (cell.content?.text != null) return cell.content.text;
  return '';
}

function renderTable(el, ctx) {
  const div = baseBox(el, ctx);
  const theme = ctx.theme;
  let ts = el.style;
  if (typeof ts === 'string' && ts.startsWith('$')) ts = theme?.tableStyles?.[ts.slice(1)] || {};
  ts = ts || {};
  const table = document.createElement('table');
  Object.assign(table.style, { width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' });
  const cg = document.createElement('colgroup');
  for (const cw of el.columnWidths || []) {
    const col = document.createElement('col');
    col.style.width = cw * 100 + '%';
    cg.appendChild(col);
  }
  table.appendChild(cg);
  const rows = el.rows || [];
  const [, , , th] = el.bounds;
  rows.forEach((row, ri) => {
    const tr = document.createElement('tr');
    tr.style.height = (el.rowHeights?.[ri] ?? 1 / rows.length) * th + 'px';
    row.forEach((cell, ci) => {
      const td = document.createElement('td');
      const isFirstRow = ri === 0, isLastRow = ri === rows.length - 1, isFirstCol = ci === 0;
      // 合并样式：cellStyle < bodyStyles < 行列类别 < textStyle < cell
      const layers = [ts.cellStyle];
      if (!isFirstRow && ts.bodyStyles?.length) layers.push(ts.bodyStyles[(ri - 1) % ts.bodyStyles.length]);
      if (isFirstCol) layers.push(ts.firstColumnStyle);
      if (isFirstRow) layers.push(ts.firstRowStyle);
      if (isLastRow) layers.push(ts.lastRowStyle);
      if (typeof cell.textStyle === 'string') layers.push(theme?.textStyles?.[cell.textStyle.slice(1)]);
      layers.push(cell, cell.content);
      const s = Object.assign({}, ...layers.filter(Boolean));
      // 非标准简写（部分模板使用）
      if (ts.fontSize && s.fontSize == null) s.fontSize = ts.fontSize;
      if (!s.color) s.color = isFirstCol && ts.firstColumnColor ? ts.firstColumnColor : ts.bodyColor;
      applyTextStyle(td, { ...s, fontSize: s.fontSize ?? 12 }, theme);
      const [ha, va] = s.align || ['center', 'middle'];
      td.style.textAlign = ha;
      td.style.verticalAlign = va === 'middle' ? 'middle' : va;
      td.style.padding = '2px 6px';
      td.style.overflow = 'hidden';
      if (s.fill) applyFill(td, s.fill, ctx);
      const border = s.border !== undefined ? s.border : ts.border;
      applyCellBorder(td, border, theme);
      if (cell.rowSpan) td.rowSpan = cell.rowSpan;
      if (cell.colSpan) td.colSpan = cell.colSpan;
      td.appendChild(richTextToFragment(cellText(cell), theme));
      td.querySelectorAll('p').forEach((p) => (p.style.margin = '0'));
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  div.appendChild(table);
  return div;
}

function applyCellBorder(td, spec, theme) {
  if (spec === undefined) return;
  if (spec === null) {
    td.style.border = 'none';
    return;
  }
  let sides;
  if (Array.isArray(spec)) {
    if (spec.length === 2) sides = [spec[0], spec[1], spec[0], spec[1]];
    else sides = spec;
  } else sides = [spec, spec, spec, spec];
  const names = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'];
  sides.forEach((b, i) => (td.style[names[i]] = b ? borderCss(b, theme) || 'none' : 'none'));
}

// ----------------------------------------------------------------- 图表（预览用 SVG：饼图 / 柱状图 / 折线图 / 面积图）
const CHART_PALETTE = ['#1783FF', '#00C9C9', '#F0884D', '#D580FF', '#7863FF', '#60C42D', '#BD8F24', '#FF80CA'];

function chartColors(fill, theme, n) {
  const arr = Array.isArray(fill) ? fill : fill ? [fill] : [];
  const pal = Object.values(theme?.colors || {}).length ? Object.values(theme.colors) : CHART_PALETTE;
  return Array.from({ length: n }, (_, i) => {
    const f = arr.length ? arr[i % arr.length] : pal[i % pal.length];
    if (f && typeof f === 'object' && f.stops) return resolveColor(f.stops[0]?.color, theme, '#888');
    return resolveColor(f, theme, CHART_PALETTE[i % CHART_PALETTE.length]);
  });
}

function chartPlaceholder(div, el, msg) {
  Object.assign(div.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px dashed rgba(127,127,127,.6)', color: 'rgba(127,127,127,.9)', fontSize: '14px', fontFamily: DEFAULT_FONT,
  });
  div.textContent = msg;
  return div;
}

function renderChart(el, ctx) {
  const div = baseBox(el, ctx);
  const theme = ctx.theme;
  const [, , W, H] = el.bounds;
  const cols = el.data?.cols || [];
  const rows = el.data?.rows || [];
  const series = el.series || [];
  if (!series.length || !rows.length) return chartPlaceholder(div, el, '📊 图表（无数据）');
  const col = (name) => cols.indexOf(name);
  const font = fontFamilyCss(el.fontFamily);
  const legendCfg = el.legend === false ? { show: false } : typeof el.legend === 'object' ? el.legend : {};
  const legendColor = resolveColor(legendCfg.color, theme, '#555');
  const legendSize = legendCfg.fontSize || 12;
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  svg.style.overflow = 'visible';
  svg.style.fontFamily = font;
  const text = (x, y, t, attrs = {}) => {
    const n = svgEl('text', { x, y, 'font-size': legendSize, fill: legendColor, 'dominant-baseline': 'middle', ...attrs });
    n.textContent = t;
    svg.appendChild(n);
    return n;
  };
  let title = typeof el.title === 'string' ? el.title : el.title?.text;
  let top = 0;
  if (title) {
    text(W / 2, 12, title, { 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700 });
    top = 28;
  }

  const legendItems = [];
  const s0 = series[0];
  if (s0.type === 'pie') {
    const ci = col(s0.encode?.category), vi = col(s0.encode?.value);
    const data = rows.map((r) => ({ name: String(r[ci] ?? ''), value: Math.max(0, Number(r[vi]) || 0) }));
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    const colors = chartColors(s0.fill, theme, data.length);
    const showLegend = legendCfg.show !== false;
    const pos = legendCfg.position || 'bottom';
    const legendW = showLegend && (pos === 'right' || pos === 'left') ? Math.min(W * 0.35, 30 + Math.max(...data.map((d) => d.name.length)) * legendSize) : 0;
    const legendH = showLegend && (pos === 'bottom' || pos === 'top') ? legendSize * 2 : 0;
    const areaW = W - legendW, areaH = H - top - legendH;
    const r = Math.max(4, Math.min(areaW, areaH) / 2 - 6);
    const cx = (pos === 'left' ? legendW : 0) + areaW / 2;
    const cy = top + (pos === 'top' ? legendH : 0) + areaH / 2;
    const inner = (s0.innerRadius || 0) * r;
    let a0 = ((s0.startAngle || 0) * Math.PI) / 180;
    const lbl = s0.dataLabels || el.dataLabels;
    data.forEach((d, i) => {
      const a1 = a0 + (d.value / total) * Math.PI * 2;
      const pt = (ang, rad) => [cx + rad * Math.sin(ang), cy - rad * Math.cos(ang)];
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      let dpath;
      if (d.value / total >= 0.9999) dpath = `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} Z`;
      else if (inner > 0) {
        const [ix0, iy0] = pt(a0, inner), [ix1, iy1] = pt(a1, inner);
        dpath = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${ix1},${iy1} A${inner},${inner} 0 ${large} 0 ${ix0},${iy0} Z`;
      } else dpath = `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
      svg.appendChild(svgEl('path', { d: dpath, fill: colors[i], stroke: s0.border ? resolveColor(s0.border.color, theme, '#fff') : 'none' }));
      if (lbl?.show && d.value > 0) {
        const mid = (a0 + a1) / 2;
        const [lx, ly] = pt(mid, inner ? (inner + r) / 2 : r * 0.62);
        const content = lbl.content || 'value';
        const t = content === 'percentage' ? Math.round((d.value / total) * 100) + '%' : content === 'category' ? d.name : String(d.value);
        text(lx, ly, t, { 'text-anchor': 'middle', fill: resolveColor(lbl.color, theme, '#fff'), 'font-size': lbl.fontSize || 12 });
      }
      legendItems.push([d.name, colors[i]]);
      a0 = a1;
    });
    if (showLegend) drawLegend(legendItems, pos, legendW, legendH);
  } else if (['bar', 'line', 'area'].includes(s0.type)) {
    const xName = s0.encode?.x;
    const horizontal = s0.type === 'bar' && cols.indexOf(s0.encode?.y) >= 0 && typeof rows[0][col(s0.encode.y)] === 'string';
    const catCol = horizontal ? col(s0.encode.y) : col(xName);
    const cats = rows.map((r) => String(r[catCol] ?? ''));
    const sers = series.filter((s) => ['bar', 'line', 'area'].includes(s.type));
    const valCol = (s) => col(horizontal ? s.encode?.x : s.encode?.y);
    const vals = sers.map((s) => rows.map((r) => Number(r[valCol(s)]) || 0));
    const all = vals.flat();
    const vmax = Math.max(0, ...all), vmin = Math.min(0, ...all);
    const span = vmax - vmin || 1;
    const showLegend = legendCfg.show !== false && sers.length > 1;
    const legendH = showLegend ? legendSize * 2 : 0;
    const padL = 36, padB = 22, padT = top + 6, padR = 8;
    const pw = W - padL - padR, ph = H - padT - padB - legendH;
    const axis = '#BBBBBB';
    svg.appendChild(svgEl('line', { x1: padL, y1: padT + ph, x2: padL + pw, y2: padT + ph, stroke: axis }));
    for (let k = 0; k <= 4; k++) {
      const v = vmin + (span * k) / 4;
      const y = padT + ph - (ph * k) / 4;
      if (k) svg.appendChild(svgEl('line', { x1: padL, y1: y, x2: padL + pw, y2: y, stroke: '#EEEEEE' }));
      text(padL - 4, y, Number(v.toFixed(2)).toString(), { 'text-anchor': 'end', 'font-size': 10 });
    }
    const slot = pw / Math.max(cats.length, 1);
    cats.forEach((c, i) => text(padL + slot * (i + 0.5), padT + ph + 12, c, { 'text-anchor': 'middle', 'font-size': 10 }));
    const y = (v) => padT + ph - ((v - vmin) / span) * ph;
    const barSers = sers.map((s, i) => [s, i]).filter(([s]) => s.type === 'bar');
    const bw = (slot * (1 - (el.categoryGap ?? 0.2))) / Math.max(barSers.length, 1);
    sers.forEach((s, si) => {
      const c = Array.isArray(s.fill) || s.fill || s.lineColor ? chartColors(s.fill || s.lineColor, theme, 1)[0] : CHART_PALETTE[si % CHART_PALETTE.length];
      if (s.type === 'bar') {
        const bi = barSers.findIndex(([x]) => x === s);
        vals[si].forEach((v, i) => {
          const x = padL + slot * i + (slot - bw * barSers.length) / 2 + bi * bw;
          svg.appendChild(svgEl('rect', { x, y: Math.min(y(v), y(0)), width: Math.max(bw - 2, 1), height: Math.abs(y(v) - y(0)), fill: c }));
        });
      } else {
        const pts = vals[si].map((v, i) => [padL + slot * (i + 0.5), y(v)]);
        if (s.type === 'area') {
          svg.appendChild(svgEl('path', { d: `M${pts[0][0]},${y(0)} ` + pts.map((p) => `L${p}`).join(' ') + ` L${pts.at(-1)[0]},${y(0)} Z`, fill: c, 'fill-opacity': 0.3 }));
        }
        svg.appendChild(svgEl('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: c, 'stroke-width': 2 }));
      }
      legendItems.push([s.name || cols[valCol(s)] || '系列' + (si + 1), c]);
    });
    if (showLegend) drawLegend(legendItems, 'bottom', 0, legendH);
  } else {
    return chartPlaceholder(div, el, `📊 ${s0.type} 图表（导出后显示）`);
  }

  function drawLegend(items, pos, lw, lh) {
    if (pos === 'right' || pos === 'left') {
      const x = pos === 'right' ? W - lw + 8 : 4;
      const step = legendSize * 1.7;
      const y0 = H / 2 - (items.length * step) / 2 + step / 2;
      items.forEach(([name, c], i) => {
        svg.appendChild(svgEl('rect', { x, y: y0 + i * step - legendSize / 2, width: legendSize * 0.8, height: legendSize * 0.8, fill: c, rx: 2 }));
        text(x + legendSize * 1.2, y0 + i * step - legendSize * 0.1, name);
      });
    } else {
      const widths = items.map(([n]) => legendSize * (1.6 + n.length) + 12);
      let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
      const yy = pos === 'top' ? top + lh / 2 : H - lh / 2;
      items.forEach(([name, c], i) => {
        svg.appendChild(svgEl('rect', { x, y: yy - legendSize * 0.4, width: legendSize * 0.8, height: legendSize * 0.8, fill: c, rx: 2 }));
        text(x + legendSize * 1.2, yy, name);
        x += widths[i];
      });
    }
  }
  div.appendChild(svg);
  if (el.fill) applyFill(div, el.fill, ctx);
  return div;
}

// ----------------------------------------------------------------- 页面
const RENDERERS = {
  text: renderText,
  shape: renderShape,
  line: renderLine,
  image: renderImage,
  icon: renderIcon,
  table: renderTable,
  chart: renderChart,
};

export function renderPage(page, ctx) {
  const [W, H] = ctx.size || [960, 540];
  const root = document.createElement('div');
  root.className = 'pptd-page';
  Object.assign(root.style, {
    position: 'relative',
    width: W + 'px',
    height: H + 'px',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    fontFamily: DEFAULT_FONT,
  });
  if (page?.background) applyFill(root, page.background, ctx);
  for (const el of page?.elements || []) {
    const fn = RENDERERS[el.elementType];
    if (!fn) continue;
    try {
      root.appendChild(fn(el, ctx));
    } catch (e) {
      console.warn('渲染元素失败', el.elementId, e);
    }
  }
  return root;
}

/**
 * 生成按比例缩放的预览：外层 wrapper 尺寸 = 页面尺寸 × scale
 */
export function renderScaled(page, ctx, width) {
  const [W, H] = ctx.size || [960, 540];
  const scale = width / W;
  const wrap = document.createElement('div');
  wrap.className = 'pptd-scaled';
  Object.assign(wrap.style, { width: width + 'px', height: H * scale + 'px', position: 'relative', overflow: 'hidden' });
  const pageEl = renderPage(page, ctx);
  Object.assign(pageEl.style, { transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: '0', top: '0' });
  wrap.appendChild(pageEl);
  return wrap;
}
