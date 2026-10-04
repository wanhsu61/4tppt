#!/usr/bin/env python3
"""
PPTX → PPTD 转换器（用于把现成的 PPT 变成本项目的模板）

用法:
    python tools/pptx2pptd.py input.pptx templates/<模板id> [--width 960] [--font MiSans]
                               [--slides 1-16] [--max-image 1920]

支持: 组合(含子坐标系)、文本框(富文本/段落/项目符号)、预设形状、自由曲线、
      图片(裁剪/透明度/形状裁剪)、Canva 式"图片填充矩形"、直线/连接线、表格、页面纯色/图片背景。
不支持(会跳过并给出警告): 原生图表、SmartArt、视频/音频、组合旋转。

依赖: Python 3.8+，Pillow(可选，用于压缩图片/转换格式)，PyYAML(可选，没有则输出 JSON 风格 YAML)。
"""
import argparse
import io
import json
import math
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from html import escape

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}
R_EMBED = '{%s}embed' % NS['r']
R_ID = '{%s}id' % NS['r']
EMU_PT = 12700.0

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None
try:
    import yaml
except Exception:  # pragma: no cover
    yaml = None


def q(tag):
    p, t = tag.split(':')
    return '{%s}%s' % (NS[p], t)


def r2(v):
    v = round(float(v), 2)
    return int(v) if v == int(v) else v


def warn(msg):
    print('  [warn]', msg, file=sys.stderr)


# --------------------------------------------------------------------- 包读取
class Package:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.names = set(self.z.namelist())

    def xml(self, name):
        return ET.fromstring(self.z.read(name))

    def rels(self, part):
        d, b = posixpath.split(part)
        rp = posixpath.join(d, '_rels', b + '.rels')
        out = {}
        if rp not in self.names:
            return out
        for r in self.xml(rp).findall('rel:Relationship', NS):
            tgt = r.get('Target')
            if r.get('TargetMode') == 'External':
                out[r.get('Id')] = ('ext', tgt)
            else:
                out[r.get('Id')] = ('int', posixpath.normpath(posixpath.join(d, tgt)))
        return out


# --------------------------------------------------------------------- 颜色
class ColorCtx:
    def __init__(self, theme_colors):
        self.theme = theme_colors  # name -> RRGGBB

    def parse(self, el):
        """el: 含 srgbClr/schemeClr 子节点的填充节点 → '#RRGGBB' 或 '#RRGGBBAA'"""
        if el is None:
            return None
        c = None
        node = None
        for tag in ('a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr'):
            node = el.find(tag, NS)
            if node is not None:
                break
        if node is None:
            return None
        t = node.tag.split('}')[1]
        if t == 'srgbClr':
            c = node.get('val')
        elif t == 'sysClr':
            c = node.get('lastClr') or '000000'
        elif t == 'schemeClr':
            name = node.get('val')
            alias = {'tx1': 'dk1', 'tx2': 'dk2', 'bg1': 'lt1', 'bg2': 'lt2'}
            c = self.theme.get(alias.get(name, name), '000000')
        elif t == 'prstClr':
            c = {'black': '000000', 'white': 'FFFFFF', 'red': 'FF0000'}.get(node.get('val'), '000000')
        rgb = [int(c[i:i + 2], 16) for i in (0, 2, 4)]
        alpha = 1.0
        for mod in node:
            mt = mod.tag.split('}')[1]
            v = int(mod.get('val', '100000')) / 100000.0
            if mt == 'alpha':
                alpha = v
            elif mt == 'lumMod':
                rgb = [x * v for x in rgb]
            elif mt == 'lumOff':
                rgb = [x + 255 * v for x in rgb]
            elif mt == 'tint':
                rgb = [255 - (255 - x) * v for x in rgb]
            elif mt == 'shade':
                rgb = [x * v for x in rgb]
        rgb = [max(0, min(255, int(round(x)))) for x in rgb]
        h = '#%02X%02X%02X' % tuple(rgb)
        if alpha < 0.999:
            h += '%02X' % int(round(alpha * 255))
        return h


# --------------------------------------------------------------------- 坐标变换
class Xf:
    """把子坐标(EMU)映射到页面坐标(px)"""

    def __init__(self, sx=1.0, sy=1.0, tx=0.0, ty=0.0):
        self.sx, self.sy, self.tx, self.ty = sx, sy, tx, ty

    def rect(self, x, y, w, h):
        return (self.tx + x * self.sx, self.ty + y * self.sy, w * self.sx, h * self.sy)

    def child(self, grp_xfrm):
        off = grp_xfrm.find('a:off', NS)
        ext = grp_xfrm.find('a:ext', NS)
        choff = grp_xfrm.find('a:chOff', NS)
        chext = grp_xfrm.find('a:chExt', NS)
        ox, oy = float(off.get('x', 0)), float(off.get('y', 0))
        ex, ey = float(ext.get('cx', 0)), float(ext.get('cy', 0))
        cx = float(choff.get('x', 0)) if choff is not None else 0
        cy = float(choff.get('y', 0)) if choff is not None else 0
        cex = float(chext.get('cx', 0)) if chext is not None else 0
        cey = float(chext.get('cy', 0)) if chext is not None else 0
        ksx = ex / cex if cex else 1.0
        ksy = ey / cey if cey else 1.0
        # child (x) → group space: ox + (x-cx)*ksx → page: tx + that*sx
        return Xf(self.sx * ksx, self.sy * ksy, self.tx + (ox - cx * ksx) * self.sx, self.ty + (oy - cy * ksy) * self.sy)


def read_xfrm(xfrm):
    off = xfrm.find('a:off', NS)
    ext = xfrm.find('a:ext', NS)
    x = float(off.get('x', 0)) if off is not None else 0
    y = float(off.get('y', 0)) if off is not None else 0
    w = float(ext.get('cx', 0)) if ext is not None else 0
    h = float(ext.get('cy', 0)) if ext is not None else 0
    rot = int(xfrm.get('rot', '0') or 0) / 60000.0
    fh = xfrm.get('flipH') in ('1', 'true')
    fv = xfrm.get('flipV') in ('1', 'true')
    return x, y, w, h, rot, fh, fv


# --------------------------------------------------------------------- 转换器
class Converter:
    def __init__(self, pkg, out_dir, width, font, max_image):
        self.pkg = pkg
        self.out = out_dir
        self.font = font
        self.max_image = max_image
        pres = pkg.xml('ppt/presentation.xml')
        sz = pres.find('p:sldSz', NS)
        self.sw, self.sh = int(sz.get('cx')), int(sz.get('cy'))
        self.width = width or round(self.sw / EMU_PT)
        self.k = self.width / (self.sw / EMU_PT)  # pt → px 缩放
        self.height = round(self.sh / EMU_PT * self.k)
        self.root_xf = Xf(self.k / EMU_PT, self.k / EMU_PT, 0, 0)
        # 主题色
        theme = {}
        prels = pkg.rels('ppt/presentation.xml')
        master_rid = pres.find('p:sldMasterIdLst/p:sldMasterId', NS)
        if master_rid is not None:
            mpart = prels[master_rid.get(R_ID)][1]
            for rid, (_, tgt) in pkg.rels(mpart).items():
                if tgt.endswith('.xml') and '/theme/' in tgt:
                    th = pkg.xml(tgt)
                    cs = th.find('.//a:clrScheme', NS)
                    if cs is not None:
                        for c in cs:
                            name = c.tag.split('}')[1]
                            s = c.find('a:srgbClr', NS)
                            if s is not None:
                                theme[name] = s.get('val')
                            else:
                                s = c.find('a:sysClr', NS)
                                if s is not None:
                                    theme[name] = s.get('lastClr', '000000')
        self.colors = ColorCtx(theme)
        self.slides = []
        for sid in pres.findall('p:sldIdLst/p:sldId', NS):
            self.slides.append(prels[sid.get(R_ID)][1])
        self.media_map = {}  # part path → media/xxx
        self.palette = {}
        os.makedirs(os.path.join(out_dir, 'pages'), exist_ok=True)
        os.makedirs(os.path.join(out_dir, 'media'), exist_ok=True)

    def px(self, emu):
        return emu / EMU_PT * self.k

    def track(self, color):
        if color:
            key = color[:7].upper()
            self.palette[key] = self.palette.get(key, 0) + 1
        return color

    # ---------------- 媒体
    def media(self, part):
        if part in self.media_map:
            return self.media_map[part]
        data = self.pkg.z.read(part)
        base, ext = posixpath.splitext(posixpath.basename(part))
        ext = ext.lower()
        out_ext = ext if ext in ('.png', '.jpg', '.jpeg', '.gif') else '.png'
        if Image is not None and (out_ext != ext or ext in ('.png', '.jpg', '.jpeg')):
            try:
                im = Image.open(io.BytesIO(data))
                im.load()
                if max(im.size) > self.max_image:
                    r = self.max_image / max(im.size)
                    im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
                buf = io.BytesIO()
                if out_ext in ('.jpg', '.jpeg'):
                    im.convert('RGB').save(buf, 'JPEG', quality=86, optimize=True)
                else:
                    im.save(buf, 'PNG', optimize=True)
                if out_ext != ext or len(buf.getvalue()) < len(data):
                    data = buf.getvalue()
            except Exception as e:
                if out_ext != ext:
                    warn(f'无法转换图片 {part}: {e}')
                    return None
        name = f'media/{base}{".jpg" if out_ext == ".jpeg" else out_ext}'
        with open(os.path.join(self.out, name), 'wb') as f:
            f.write(data)
        self.media_map[part] = name
        return name

    def blip_src(self, blip, rels):
        if blip is None:
            return None
        rid = blip.get(R_EMBED)
        if not rid or rid not in rels:
            return None
        kind, tgt = rels[rid]
        if kind == 'ext':
            return tgt if re.match(r'https?://', tgt) else None
        return self.media(tgt)

    # ---------------- 填充 / 线条
    def fill_of(self, sppr, rels):
        if sppr is None:
            return None
        for ch in sppr:
            t = ch.tag.split('}')[1]
            if t == 'noFill':
                return None
            if t == 'solidFill':
                return {'type': 'solid', 'color': self.track(self.colors.parse(ch))}
            if t == 'gradFill':
                stops = []
                for gs in ch.findall('a:gsLst/a:gs', NS):
                    stops.append({'position': r2(int(gs.get('pos', 0)) / 100000.0), 'color': self.colors.parse(gs)})
                lin = ch.find('a:lin', NS)
                g = {'type': 'gradient', 'gradientType': 'linear' if ch.find('a:path', NS) is None else 'radial', 'stops': stops}
                if lin is not None:
                    g['angle'] = r2(int(lin.get('ang', 0)) / 60000.0)
                return g if len(stops) >= 2 else None
            if t == 'blipFill':
                src = self.blip_src(ch.find('a:blip', NS), rels)
                if not src:
                    return None
                f = {'type': 'image', 'src': src, 'fit': {'mode': 'fill'}}
                crop = self.fillrect_crop(ch)
                if crop:
                    f['crop'] = crop
                a = ch.find('a:blip/a:alphaModFix', NS)
                if a is not None:
                    f['opacity'] = r2(int(a.get('amt', 100000)) / 100000.0)
                return f
        return None

    @staticmethod
    def fillrect_crop(blipfill):
        """把 stretch/fillRect（图片相对形状的位置）和 srcRect（源裁剪）合成为 PPTD crop"""
        crop = {'left': 0.0, 'top': 0.0, 'right': 0.0, 'bottom': 0.0}
        src = blipfill.find('a:srcRect', NS)
        if src is not None:
            for k, a in (('left', 'l'), ('top', 't'), ('right', 'r'), ('bottom', 'b')):
                crop[k] = int(src.get(a, 0) or 0) / 100000.0
        fr = blipfill.find('a:stretch/a:fillRect', NS)
        if fr is not None:
            l, t, r, b = (int(fr.get(a, 0) or 0) / 100000.0 for a in ('l', 't', 'r', 'b'))
            if l or t or r or b:
                # 图片被放在形状内 [l, 1-r] 区域；换算成源图片里的可见区域
                sw, sh = 1 - l - r, 1 - t - b
                if sw > 0 and sh > 0:
                    vis_l, vis_r = -l / sw, -r / sw
                    vis_t, vis_b = -t / sh, -b / sh
                    # 与 srcRect 组合
                    cw, chh = 1 - crop['left'] - crop['right'], 1 - crop['top'] - crop['bottom']
                    crop = {
                        'left': crop['left'] + vis_l * cw,
                        'right': crop['right'] + vis_r * cw,
                        'top': crop['top'] + vis_t * chh,
                        'bottom': crop['bottom'] + vis_b * chh,
                    }
        crop = {k: r2(round(v, 4)) for k, v in crop.items() if abs(v) > 0.0005}
        return crop or None

    def line_of(self, sppr):
        ln = sppr.find('a:ln', NS) if sppr is not None else None
        if ln is None:
            return None
        if ln.find('a:noFill', NS) is not None:
            return None
        sf = ln.find('a:solidFill', NS)
        if sf is None:
            return None
        w = int(ln.get('w', 12700) or 12700)
        dash = ln.find('a:prstDash', NS)
        style = 'solid'
        if dash is not None and dash.get('val') not in (None, 'solid'):
            style = 'dot' if 'Dot' in dash.get('val') and 'Dash' not in dash.get('val') else 'dash'
        return {'style': style, 'width': r2(max(0.5, self.px(w))), 'color': self.track(self.colors.parse(sf))}

    # ---------------- 几何
    @staticmethod
    def adjustments(geom):
        av = geom.find('a:avLst', NS)
        out = []
        if av is not None:
            for gd in av.findall('a:gd', NS):
                m = re.match(r'val\s+(-?\d+)', gd.get('fmla', ''))
                if m:
                    out.append(int(m.group(1)))
        return out

    @staticmethod
    def custom_path(cust):
        """custGeom → (viewBox, svg path, 是否为简单矩形)"""
        paths = cust.findall('a:pathLst/a:path', NS)
        if not paths:
            return None, None, False
        vw = max(float(p.get('w', 0) or 0) for p in paths) or 1
        vh = max(float(p.get('h', 0) or 0) for p in paths) or 1
        d = []
        pts_all = []
        for p in paths:
            pw = float(p.get('w', 0) or 0) or vw
            ph = float(p.get('h', 0) or 0) or vh
            sx, sy = vw / pw, vh / ph
            cur = (0, 0)
            for cmd in p:
                t = cmd.tag.split('}')[1]
                pts = [(float(pt.get('x')) * sx, float(pt.get('y')) * sy) for pt in cmd.findall('a:pt', NS)]
                pts_all += pts
                fmt = lambda pt: f'{r2(pt[0])},{r2(pt[1])}'
                if t == 'moveTo':
                    d.append('M' + fmt(pts[0]))
                    cur = pts[0]
                elif t == 'lnTo':
                    d.append('L' + fmt(pts[0]))
                    cur = pts[0]
                elif t == 'cubicBezTo':
                    d.append('C' + ' '.join(fmt(x) for x in pts))
                    cur = pts[-1]
                elif t == 'quadBezTo':
                    d.append('Q' + ' '.join(fmt(x) for x in pts))
                    cur = pts[-1]
                elif t == 'arcTo':
                    wr = float(cmd.get('wR')) * sx
                    hr = float(cmd.get('hR')) * sy
                    st = int(cmd.get('stAng')) / 60000.0
                    sw = int(cmd.get('swAng')) / 60000.0
                    cx = cur[0] - wr * math.cos(math.radians(st))
                    cy = cur[1] - hr * math.sin(math.radians(st))
                    ea = math.radians(st + sw)
                    end = (cx + wr * math.cos(ea), cy + hr * math.sin(ea))
                    large = 1 if abs(sw) > 180 else 0
                    sweep = 1 if sw > 0 else 0
                    d.append(f'A{r2(wr)},{r2(hr)} 0 {large} {sweep} {fmt(end)}')
                    cur = end
                elif t == 'close':
                    d.append('Z')
        is_rect = len(paths) == 1 and len(pts_all) <= 6 and all(
            (abs(x) < vw * 0.002 or abs(x - vw) < vw * 0.002) and (abs(y) < vh * 0.002 or abs(y - vh) < vh * 0.002)
            for x, y in pts_all
        ) and all(c.tag.split('}')[1] in ('moveTo', 'lnTo', 'close') for c in paths[0])
        return [r2(vw), r2(vh)], ' '.join(d), is_rect

    # ---------------- 文本
    def run_style(self, rpr, defaults):
        s = dict(defaults)
        if rpr is None:
            return s
        if rpr.get('sz'):
            s['size'] = int(rpr.get('sz')) / 100.0 * self.k
        if rpr.get('b') is not None:
            s['bold'] = rpr.get('b') in ('1', 'true')
        if rpr.get('i') is not None:
            s['italic'] = rpr.get('i') in ('1', 'true')
        if rpr.get('u') not in (None, 'none'):
            s['underline'] = True
        if rpr.get('spc'):
            s['spacing'] = int(rpr.get('spc')) / 100.0 * self.k
        sf = rpr.find('a:solidFill', NS)
        if sf is not None:
            s['color'] = self.track(self.colors.parse(sf))
        latin = rpr.find('a:latin', NS)
        if latin is not None:
            face = latin.get('typeface', '')
            s['face'] = face
            if re.search(r'bold|black|heavy|semibold|extrabold', face, re.I):
                s['bold'] = True
            if re.search(r'italic', face, re.I):
                s['italic'] = True
        return s

    def text_of(self, txbody, list_style_defaults=None):
        """txBody → (content dict, plain text)；空文本返回 (None, '')"""
        paras = []
        for p in txbody.findall('a:p', NS):
            ppr = p.find('a:pPr', NS)
            pdef = {'size': 18 * self.k, 'bold': False, 'italic': False, 'color': '#000000'}
            if ppr is not None and ppr.find('a:defRPr', NS) is not None:
                pdef = self.run_style(ppr.find('a:defRPr', NS), pdef)
            end = p.find('a:endParaRPr', NS)
            runs = []
            for r in p:
                t = r.tag.split('}')[1]
                if t == 'r':
                    runs.append((r.findtext('a:t', '', NS), self.run_style(r.find('a:rPr', NS), pdef)))
                elif t == 'br':
                    runs.append(('\n', self.run_style(r.find('a:rPr', NS), pdef)))
                elif t == 'fld':
                    runs.append((r.findtext('a:t', '', NS), self.run_style(r.find('a:rPr', NS), pdef)))
            para = {
                'align': 'left', 'runs': runs, 'lh': None, 'lhpx': None, 'before': 0, 'bullet': None,
                'endsize': self.run_style(end, pdef)['size'] if end is not None else pdef['size'],
            }
            if ppr is not None:
                para['align'] = {'l': 'left', 'ctr': 'center', 'r': 'right', 'just': 'justify', 'dist': 'distributed'}.get(ppr.get('algn', 'l'), 'left')
                ls = ppr.find('a:lnSpc', NS)
                if ls is not None:
                    if ls.find('a:spcPct', NS) is not None:
                        para['lh'] = int(ls.find('a:spcPct', NS).get('val')) / 100000.0
                    elif ls.find('a:spcPts', NS) is not None:
                        para['lhpx'] = int(ls.find('a:spcPts', NS).get('val')) / 100.0 * self.k
                sb = ppr.find('a:spcBef/a:spcPts', NS)
                if sb is not None:
                    para['before'] = int(sb.get('val')) / 100.0 * self.k
                if ppr.find('a:buChar', NS) is not None:
                    para['bullet'] = 'ul'
                elif ppr.find('a:buAutoNum', NS) is not None:
                    para['bullet'] = 'ol'
            paras.append(para)

        full = '\n'.join(''.join(t for t, _ in p['runs']) for p in paras)
        if not full.strip():
            return None, ''

        # 去掉首尾空段落
        while paras and not ''.join(t for t, _ in paras[-1]['runs']).strip():
            paras.pop()
        while paras and not ''.join(t for t, _ in paras[0]['runs']).strip():
            paras.pop(0)

        all_runs = [s for p in paras for t, s in p['runs'] if t.strip()]
        base = all_runs[0] if all_runs else {'size': 18, 'color': '#000000', 'bold': False}
        content = {
            'fontFamily': self.font,
            'fontSize': r2(base['size']),
            'color': base.get('color', '#000000'),
        }
        if base.get('bold'):
            content['bold'] = True
        if base.get('italic'):
            content['italic'] = True
        if base.get('spacing'):
            content['letterSpacing'] = r2(base['spacing'])
        p0 = paras[0]
        if p0['lhpx']:
            # 固定行距按首段字号折算为倍数，便于替换文字后自适应
            content['lineHeight'] = r2(round(p0['lhpx'] / max(base['size'], 1), 2))
        elif p0['lh']:
            content['lineHeight'] = r2(round(p0['lh'] * 1.2, 2))
        else:
            content['lineHeight'] = 1.2

        same = lambda s: (abs(s['size'] - base['size']) < 0.3 and s.get('color') == base.get('color')
                          and bool(s.get('bold')) == bool(base.get('bold')) and bool(s.get('italic')) == bool(base.get('italic'))
                          and not s.get('underline'))
        uniform = all(same(s) for s in all_runs) and all(p['align'] == p0['align'] and not p['bullet'] and not p['before']
                                                         and p['lh'] == p0['lh'] and p['lhpx'] == p0['lhpx'] for p in paras)
        align_h = p0['align']
        if uniform:
            lines = []
            for p in paras:
                lines.append(''.join(t for t, _ in p['runs']).rstrip(' '))
            text = '\n'.join(lines)
            content['text'] = text if '\n' not in text else text + '\n'
            return content, text, align_h

        # 富文本
        def span(t, s):
            if t == '\n':
                return '<br/>'
            t = escape(t, quote=False)
            css = []
            if abs(s['size'] - base['size']) >= 0.3:
                css.append(f'font-size:{r2(s["size"])}px')
            if s.get('color') and s.get('color') != base.get('color'):
                css.append(f'color:{s["color"]}')
            if bool(s.get('bold')) != bool(base.get('bold')):
                css.append('font-weight:' + ('700' if s.get('bold') else '400'))
            inner = f'<span style="{"; ".join(css)}">{t}</span>' if css else t
            if s.get('italic') and not base.get('italic'):
                inner = f'<em>{inner}</em>'
            if s.get('underline'):
                inner = f'<u>{inner}</u>'
            return inner

        html = []
        open_list = None
        for p in paras:
            body = ''.join(span(t, s) for t, s in p['runs']) or '&nbsp;'
            pcss = []
            if p['align'] != 'left':
                pcss.append(f'text-align:{p["align"]}')
            if p['before']:
                pcss.append(f'margin-top:{r2(p["before"])}px')
            if p['lhpx'] and p is not p0:
                size = max([s['size'] for t, s in p['runs'] if t.strip()] or [base['size']])
                pcss.append(f'line-height:{r2(round(p["lhpx"] / size, 2))}')
            st = f' style="{"; ".join(pcss)}"' if pcss else ''
            if p['bullet']:
                if open_list != p['bullet']:
                    if open_list:
                        html.append(f'</{open_list}>')
                    html.append(f'<{p["bullet"]}>')
                    open_list = p['bullet']
                html.append(f'<li{st}>{body}</li>')
            else:
                if open_list:
                    html.append(f'</{open_list}>')
                    open_list = None
                html.append(f'<p{st}>{body}</p>')
        if open_list:
            html.append(f'</{open_list}>')
        content['text'] = '\n'.join(html) + '\n'
        return content, full, align_h

    # ---------------- 元素
    def new_id(self, kind):
        self.seq += 1
        return f'{kind}-{self.seq}'

    def emit_text(self, sp, txbody, bounds, rot):
        bodypr = txbody.find('a:bodyPr', NS)
        res = self.text_of(txbody)
        if res[0] is None:
            return
        content, plain, align_h = res
        x, y, w, h = bounds
        ins = {'l': 91440, 'r': 91440, 't': 45720, 'b': 45720}
        anchor = 't'
        wrap = True
        if bodypr is not None:
            for k in ins:
                if bodypr.get(k + 'Ins') is not None:
                    ins[k] = int(bodypr.get(k + 'Ins'))
            anchor = bodypr.get('anchor', 't')
            wrap = bodypr.get('wrap') != 'none'
            if bodypr.get('vert') in ('vert', 'eaVert', 'vert270'):
                content['textDirection'] = 'vertical'
        # 文本内边距不随组合缩放，按页面比例换算
        k = self.k / EMU_PT
        il, ir, it, ib = ins['l'] * k, ins['r'] * k, ins['t'] * k, ins['b'] * k
        if w - il - ir >= content['fontSize']:
            x += il
            w -= il + ir
        if h - it - ib >= content['fontSize'] * 0.8:
            y += it
            h -= it + ib
        content['align'] = [align_h if align_h != 'distributed' else 'justify', {'t': 'top', 'ctr': 'middle', 'b': 'bottom'}.get(anchor, 'top')]
        # 只够放一行的文本框：关闭自动换行，避免换字体后被挤成两行
        one_line_h = content['fontSize'] * content.get('lineHeight', 1.2)
        if '\n' not in plain.strip() and h < one_line_h * 1.7:
            wrap = False
        if not wrap:
            content['wrap'] = False
        el = {'elementId': self.new_id('text'), 'elementType': 'text', 'bounds': [r2(x), r2(y), r2(max(w, 1)), r2(max(h, 1))]}
        if rot:
            el['rotation'] = r2(rot)
        el['content'] = content
        self.els.append(el)
        self.texts.append(plain)

    def do_sp(self, sp, rels, connector=False):
        sppr = sp.find('p:spPr', NS)
        xfrm = sppr.find('a:xfrm', NS) if sppr is not None else None
        if xfrm is None:
            # 占位符等未显式定位的形状
            txb = sp.find('p:txBody', NS)
            if txb is not None and self.text_of(txb)[0] is not None:
                warn('跳过一个没有坐标的占位符文本')
            return
        x, y, w, h, rot, fh, fv = read_xfrm(xfrm)
        bounds = self.cur_xf.rect(x, y, w, h)
        prst = sppr.find('a:prstGeom', NS)
        cust = sppr.find('a:custGeom', NS)
        fill = self.fill_of(sppr, rels)
        line = self.line_of(sppr)
        name = prst.get('prst') if prst is not None else None

        if connector or name in ('line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'curvedConnector3'):
            if line:
                bw, bh = max(bounds[2], 0.01), max(bounds[3], 0.01)
                x0, x1 = (bw, 0) if fh else (0, bw)
                y0, y1 = (bh, 0) if fv else (0, bh)
                el = {
                    'elementId': self.new_id('line'), 'elementType': 'line',
                    'bounds': [r2(bounds[0]), r2(bounds[1]), r2(bw), r2(bh)],
                    'viewBox': [r2(bw), r2(bh)],
                    'points': f'{r2(x0)},{r2(y0)} {r2(x1)},{r2(y1)}',
                    'border': line,
                }
                if rot:
                    el['rotation'] = r2(rot)
                lnel = sppr.find('a:ln', NS)
                arrows = [None, None]
                for i, tag in enumerate(('a:headEnd', 'a:tailEnd')):
                    e = lnel.find(tag, NS) if lnel is not None else None
                    if e is not None and e.get('type') not in (None, 'none'):
                        arrows[i] = {'triangle': 'arrow', 'arrow': 'arrow', 'stealth': 'stealth', 'diamond': 'diamond', 'oval': 'oval'}.get(e.get('type'), 'arrow')
                if any(arrows):
                    el['arrow'] = arrows
                self.els.append(el)
            return

        if fill or line:
            geo = {}
            is_rect = name == 'rect'
            if cust is not None:
                vb, path, is_rect = self.custom_path(cust)
                if not is_rect and path:
                    geo = {'shapeName': 'custom', 'viewBox': vb, 'path': path}
            elif name and name != 'rect':
                geo = {'shapeName': name}
                adj = self.adjustments(prst)
                if adj:
                    geo['adjustments'] = adj
            if not geo:
                geo = {'shapeName': 'rect'}

            if fill and fill['type'] == 'image' and geo['shapeName'] in ('rect', 'ellipse', 'roundRect', 'custom'):
                el = {'elementId': self.new_id('image'), 'elementType': 'image', 'bounds': [r2(v) for v in bounds], 'src': fill['src']}
                if geo['shapeName'] != 'rect':
                    el['cropShape'] = geo
                el['fit'] = {'mode': 'fill'}
                if fill.get('crop'):
                    el['crop'] = fill['crop']
                if fill.get('opacity') is not None and fill['opacity'] < 0.999:
                    el['opacity'] = fill['opacity']
                if line:
                    el['border'] = line
            else:
                el = {'elementId': self.new_id('shape'), 'elementType': 'shape', 'bounds': [r2(v) for v in bounds]}
                el.update(geo)
                if fill:
                    el['fill'] = fill
                if line:
                    el['border'] = line
            if rot:
                el['rotation'] = r2(rot)
            if fh or fv:
                el['flip'] = [fh, fv]
            self.els.append(el)

        txb = sp.find('p:txBody', NS)
        if txb is not None:
            self.emit_text(sp, txb, bounds, rot)

    def do_pic(self, pic, rels):
        bf = pic.find('p:blipFill', NS)
        sppr = pic.find('p:spPr', NS)
        xfrm = sppr.find('a:xfrm', NS)
        if xfrm is None:
            return
        if pic.find('.//p:nvPr/a:videoFile', NS) is not None or pic.find('.//p:nvPr/a:audioFile', NS) is not None:
            warn('跳过视频/音频，保留其封面图')
        x, y, w, h, rot, fh, fv = read_xfrm(xfrm)
        src = self.blip_src(bf.find('a:blip', NS), rels)
        if not src:
            return
        el = {'elementId': self.new_id('image'), 'elementType': 'image', 'bounds': [r2(v) for v in self.cur_xf.rect(x, y, w, h)], 'src': src}
        prst = sppr.find('a:prstGeom', NS)
        cust = sppr.find('a:custGeom', NS)
        if prst is not None and prst.get('prst') not in ('rect', None):
            cs = {'shapeName': prst.get('prst')}
            adj = self.adjustments(prst)
            if adj:
                cs['adjustments'] = adj
            el['cropShape'] = cs
        elif cust is not None:
            vb, path, is_rect = self.custom_path(cust)
            if not is_rect and path:
                el['cropShape'] = {'shapeName': 'custom', 'viewBox': vb, 'path': path}
        el['fit'] = {'mode': 'fill'}
        crop = self.fillrect_crop(bf)
        if crop:
            el['crop'] = crop
        a = bf.find('a:blip/a:alphaModFix', NS)
        if a is not None and int(a.get('amt', 100000)) < 99900:
            el['opacity'] = r2(int(a.get('amt')) / 100000.0)
        line = self.line_of(sppr)
        if line:
            el['border'] = line
        if rot:
            el['rotation'] = r2(rot)
        if fh or fv:
            el['flip'] = [fh, fv]
        self.els.append(el)

    def cell_border(self, tcpr, tag):
        ln = tcpr.find(tag, NS) if tcpr is not None else None
        if ln is None or ln.find('a:noFill', NS) is not None:
            return None
        sf = ln.find('a:solidFill', NS)
        if sf is None:
            return None
        return {'style': 'solid', 'width': r2(max(0.25, self.px(int(ln.get('w', 12700))))), 'color': self.colors.parse(sf)}

    def do_frame(self, gf, rels):
        xfrm = gf.find('p:xfrm', NS)
        x, y, w, h, rot, fh, fv = read_xfrm(xfrm)
        bounds = self.cur_xf.rect(x, y, w, h)
        tbl = gf.find('a:graphic/a:graphicData/a:tbl', NS)
        if tbl is None:
            uri = gf.find('a:graphic/a:graphicData', NS).get('uri', '')
            warn(f'跳过不支持的对象（{uri.rsplit("/", 1)[-1]}）')
            return
        cols = [int(c.get('w')) for c in tbl.findall('a:tblGrid/a:gridCol', NS)]
        trs = tbl.findall('a:tr', NS)
        rows_h = [int(tr.get('h')) for tr in trs]
        tw, th = sum(cols) or 1, sum(rows_h) or 1
        rows = []
        texts = []
        for tr in trs:
            row = []
            for tc in tr.findall('a:tc', NS):
                if tc.get('hMerge') in ('1', 'true') or tc.get('vMerge') in ('1', 'true'):
                    continue
                cell = {}
                txb = tc.find('a:txBody', NS)
                res = self.text_of(txb) if txb is not None else (None, '')
                tcpr = tc.find('a:tcPr', NS)
                if res[0] is not None:
                    c, plain, ah = res
                    cell['text'] = c['text']
                    for k in ('fontSize', 'color', 'bold', 'italic', 'fontFamily', 'lineHeight'):
                        if k in c:
                            cell[k] = c[k]
                    cell['align'] = [ah, {'t': 'top', 'ctr': 'middle', 'b': 'bottom'}.get(tcpr.get('anchor', 't') if tcpr is not None else 't', 'top')]
                    texts.append(plain)
                if tcpr is not None:
                    sf = tcpr.find('a:solidFill', NS)
                    if sf is not None:
                        cell['fill'] = {'type': 'solid', 'color': self.track(self.colors.parse(sf))}
                    border = [self.cell_border(tcpr, t) for t in ('a:lnT', 'a:lnR', 'a:lnB', 'a:lnL')]
                    if any(border):
                        cell['border'] = border
                if tc.get('gridSpan'):
                    cell['colSpan'] = int(tc.get('gridSpan'))
                if tc.get('rowSpan'):
                    cell['rowSpan'] = int(tc.get('rowSpan'))
                row.append(cell)
            rows.append(row)

        def ratios(vals, total):
            rs = [round(v / total, 4) for v in vals]
            rs[-1] = round(1 - sum(rs[:-1]), 4)
            return [r2(v) for v in rs]

        el = {
            'elementId': self.new_id('table'), 'elementType': 'table', 'bounds': [r2(v) for v in bounds],
            'columnWidths': ratios(cols, tw), 'rowHeights': ratios(rows_h, th), 'rows': rows,
        }
        self.els.append(el)
        self.texts.extend(texts)

    def walk(self, tree, rels, xf):
        prev = self.cur_xf
        self.cur_xf = xf
        for ch in tree:
            t = ch.tag.split('}')[1]
            if t == 'sp':
                self.do_sp(ch, rels)
            elif t == 'cxnSp':
                self.do_sp(ch, rels, connector=True)
            elif t == 'pic':
                self.do_pic(ch, rels)
            elif t == 'graphicFrame':
                self.do_frame(ch, rels)
            elif t == 'grpSp':
                gx = ch.find('p:grpSpPr/a:xfrm', NS)
                if gx is not None and int(gx.get('rot', '0') or 0):
                    warn('组合旋转未处理，按未旋转转换')
                self.walk(ch, rels, xf.child(gx) if gx is not None else xf)
            elif t == 'AlternateContent':
                fb = ch.find('{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback')
                if fb is not None:
                    self.walk(fb, rels, xf)
        self.cur_xf = prev

    def background(self, sld, rels):
        bg = sld.find('p:cSld/p:bg/p:bgPr', NS)
        if bg is None:
            return None
        f = self.fill_of(bg, rels)
        if f and f['type'] == 'image':
            f = {'type': 'image', 'src': f['src'], 'fit': {'mode': 'cover'}}
        return f

    def convert_slide(self, idx, part):
        sld = self.pkg.xml(part)
        rels = self.pkg.rels(part)
        self.els, self.texts, self.seq = [], [], 0
        self.cur_xf = self.root_xf
        page = {'pageType': 'content'}
        bg = self.background(sld, rels)
        if bg is None:
            # 版式 / 母版背景
            for rid, (_, tgt) in rels.items():
                if '/slideLayouts/' in tgt:
                    lay = self.pkg.xml(tgt)
                    bg = self.background(lay, self.pkg.rels(tgt))
                    if bg is None:
                        for _, (_, mt) in self.pkg.rels(tgt).items():
                            if '/slideMasters/' in mt:
                                bg = self.background(self.pkg.xml(mt), self.pkg.rels(mt))
        page['background'] = bg or {'type': 'solid', 'color': '#FFFFFF'}
        self.walk(sld.find('p:cSld/p:spTree', NS), rels, self.root_xf)
        page['elements'] = self.els
        return page, self.texts


def dump_yaml(obj):
    if yaml is not None:
        class D(yaml.SafeDumper):
            pass

        def str_rep(dumper, s):
            if '\n' in s:
                return dumper.represent_scalar('tag:yaml.org,2002:str', s, style='|')
            return dumper.represent_scalar('tag:yaml.org,2002:str', s)

        D.add_representer(str, str_rep)
        return yaml.dump(obj, Dumper=D, allow_unicode=True, sort_keys=False, width=100000)
    return json.dumps(obj, ensure_ascii=False, indent=2)


def parse_range(spec, n):
    if not spec:
        return list(range(1, n + 1))
    out = []
    for part in spec.split(','):
        if '-' in part:
            a, b = part.split('-')
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return [i for i in out if 1 <= i <= n]


def main():
    ap = argparse.ArgumentParser(description='PPTX → PPTD 项目')
    ap.add_argument('pptx')
    ap.add_argument('out_dir')
    ap.add_argument('--width', type=int, default=960, help='输出页面宽度(px)，默认 960；0 表示保持原始尺寸')
    ap.add_argument('--font', default='MiSans', help='统一字体，默认 MiSans')
    ap.add_argument('--slides', default='', help='要转换的页码，如 1-16 或 1,3,5')
    ap.add_argument('--max-image', type=int, default=1920, help='图片最长边上限(px)')
    ap.add_argument('--title', default='')
    a = ap.parse_args()

    pkg = Package(a.pptx)
    conv = Converter(pkg, a.out_dir, a.width or None, a.font, a.max_image)
    picks = parse_range(a.slides, len(conv.slides))
    pages = []
    outline = []
    for n, i in enumerate(picks, 1):
        print(f'[slide {i}] →', file=sys.stderr)
        page, texts = conv.convert_slide(i, conv.slides[i - 1])
        pages.append(page)
        outline.append({'page': n, 'source_slide': i, 'texts': texts})

    # 主题色：取出现最多的颜色，并把页面里的这些颜色替换成 $token，方便在网页里统一改色
    pal = sorted(conv.palette.items(), key=lambda kv: -kv[1])
    colors = {}
    for k, _ in pal:
        if k in ('#FFFFFF', '#000000'):
            continue
        colors[f'c{len(colors) + 1}'] = k
        if len(colors) >= 6:
            break
    rev = {v.upper(): k for k, v in colors.items()}

    def tokenize(node):
        if isinstance(node, dict):
            for key, v in list(node.items()):
                if isinstance(v, str) and key == 'color' and v.upper() in rev:
                    node[key] = '$' + rev[v.upper()]
                elif isinstance(v, str) and key == 'text':
                    node[key] = re.sub(r'color:(#[0-9A-Fa-f]{6})(?![0-9A-Fa-f])',
                                       lambda m: 'color:$' + rev[m.group(1).upper()] if m.group(1).upper() in rev else m.group(0), v)
                else:
                    tokenize(v)
        elif isinstance(node, list):
            for v in node:
                tokenize(v)

    page_files = []
    for n, page in enumerate(pages, 1):
        tokenize(page)
        name = f'pages/{n:02d}.page'
        with open(os.path.join(a.out_dir, name), 'w', encoding='utf-8') as f:
            f.write(dump_yaml(page))
        page_files.append(name)

    manifest = {
        'version': 'v2',
        'title': a.title or os.path.splitext(os.path.basename(a.pptx))[0],
        'size': [conv.width, conv.height],
        'theme': {'colors': colors},
        'pages': page_files,
    }
    with open(os.path.join(a.out_dir, 'deck.pptd'), 'w', encoding='utf-8') as f:
        f.write(dump_yaml(manifest))
    with open(os.path.join(a.out_dir, 'outline.json'), 'w', encoding='utf-8') as f:
        json.dump(outline, f, ensure_ascii=False, indent=1)
    print(f'完成：{len(page_files)} 页，{len(conv.media_map)} 个媒体文件 → {a.out_dir}', file=sys.stderr)


if __name__ == '__main__':
    main()
