"""把转换后的 Corporate Roadmap 模板改成中文内容"""
import re, sys, yaml, os, json
from html.parser import HTMLParser

D = sys.argv[1]


class Dumper(yaml.SafeDumper):
    pass


def _str(d, s):
    return d.represent_scalar('tag:yaml.org,2002:str', s, style='|' if '\n' in s else None)


Dumper.add_representer(str, _str)


def load(n):
    return yaml.safe_load(open(f'{D}/pages/{n:02d}.page', encoding='utf-8'))


def save(n, p):
    open(f'{D}/pages/{n:02d}.page', 'w', encoding='utf-8').write(
        yaml.dump(p, Dumper=Dumper, allow_unicode=True, sort_keys=False, width=100000))


def el(p, eid):
    for e in p['elements']:
        if e['elementId'] == eid:
            return e
    raise KeyError(eid)


def plain(text):
    return text + '\n' if '\n' in text else text


def replace_nodes(html, values):
    """按顺序替换 HTML 中的非空文本节点"""
    it = iter(values)
    out = []
    for part in re.split(r'(<[^>]+>)', html):
        if part.startswith('<') or not part.strip():
            out.append(part)
        else:
            out.append(next(it))
    rest = list(it)
    assert not rest, rest
    return ''.join(out)


def T(p, eid, value, **extra):
    c = el(p, eid)['content']
    if isinstance(value, list):
        c['text'] = replace_nodes(c['text'], value)
    else:
        c['text'] = plain(value)
    c.update(extra)


# ---------------------------------------------------------------- 01 封面
p = load(1)
p['pageType'] = 'cover'
T(p, 'text-11', '企业战略\n路线图')
T(p, 'text-12', '年度规划')
save(1, p)

# ---------------------------------------------------------------- 02 议程
p = load(2)
p['pageType'] = 'table_of_contents'
T(p, 'text-16', '会议议程')
T(p, 'text-6', '年度目标回顾')
T(p, 'text-8', '核心战略方向')
T(p, 'text-10', '季度执行计划')
T(p, 'text-12', '资源与预算安排')
save(2, p)

# ---------------------------------------------------------------- 03 菱形路线图（按 x 从左到右）
p = load(3)
T(p, 'text-23', '三年发展路线图')
T(p, 'text-24', '从夯实基础到规模增长，分五个阶段推进战略落地。')
steps = [
    ('text-25', 'text-26', '夯实基础', '梳理组织架构，\n完成核心系统上线'),
    ('text-27', 'text-28', '能力建设', '搭建数据中台，\n统一经营指标口径'),
    ('text-31', 'text-32', '市场拓展', '进入三大重点区域，\n扩充渠道网络'),
    ('text-29', 'text-30', '产品升级', '推出新一代产品线，\n提升客单价'),
    ('text-33', 'text-34', '规模增长', '营收突破十亿，\n形成稳定盈利模式'),
]
for a, b, t1, t2 in steps:
    T(p, a, t1)
    T(p, b, t2)
save(3, p)

# ---------------------------------------------------------------- 04 年度甘特表
p = load(4)
T(p, 'text-7', '年度重点项目排期')
T(p, 'text-8', '按月份追踪四项重点工作的推进节奏。')
tb = el(p, 'table-1')
head = ['2026', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
for c, v in zip(tb['rows'][0], head):
    c['text'] = v
for row, v in zip(tb['rows'][1:], ['系统\n升级', '渠道\n拓展', '产品\n研发', '品牌\n推广']):
    row[0]['text'] = v + '\n'
save(4, p)

# ---------------------------------------------------------------- 05 半年计划表
p = load(5)
T(p, 'text-5', '上半年行动计划')
T(p, 'text-6', '六个月内各项行动的时间安排一览。')
tb = el(p, 'table-1')
for c, v in zip(tb['rows'][0], ['项目', '1 月', '2 月', '3 月', '4 月', '5 月', '6 月']):
    c['text'] = v
for row, v in zip(tb['rows'][1:], ['组织调整', '系统上线', '渠道签约', '品牌发布']):
    row[0]['text'] = v
save(5, p)

# ---------------------------------------------------------------- 06 图文要点（按 y 从上到下）
p = load(6)
T(p, 'text-17', '数字化转型三大抓手')
for a, b, t1, t2 in [
    ('text-11', 'text-12', '流程在线化', '核心业务流程全部线上运行，审批效率提升一倍。'),
    ('text-15', 'text-16', '数据驱动决策', '建立统一数据平台，关键经营指标按日更新。'),
    ('text-13', 'text-14', '智能化应用', '在客服与供应链场景落地 AI 助手，降低人工成本。'),
]:
    T(p, a, t1)
    T(p, b, t2)
save(6, p)

# ---------------------------------------------------------------- 07 自我介绍
p = load(7)
T(p, 'text-8', '大家好！')
T(p, 'text-9', '我是战略规划部的李然，接下来由我介绍公司未来三年的发展规划，欢迎随时交流。')
save(7, p)

# ---------------------------------------------------------------- 08 观点页
p = load(8)
T(p, 'text-1', '以客户为中心\n重塑协作方式')
T(p, 'text-2', '打通部门壁垒，\n快速响应客户需求。')
save(8, p)

# ---------------------------------------------------------------- 09 六宫格
p = load(9)
T(p, 'text-3', '2026 年六大重点任务')
tb = el(p, 'table-1')
cells = [
    ('降本增效', '运营成本同比下降 10%'),
    ('客户增长', '新增企业客户 500 家'),
    ('产品创新', '全年发布 3 款新产品'),
    ('人才发展', '核心骨干留任率达到 95%'),
    ('全面数字化', '核心业务流程 100% 在线'),
    ('品牌建设', '行业影响力进入前三'),
]
flat = [c for r in tb['rows'] for c in r]
for c, (a, b) in zip(flat, cells):
    c['text'] = replace_nodes(c['text'], [a, b])
save(9, p)

# ---------------------------------------------------------------- 10 引言
p = load(10)
p['pageType'] = 'chapter'
T(p, 'text-3', '方向比速度更重要，\n坚持比努力更可贵。')
T(p, 'text-4', '—— 2026 年度战略会寄语')
save(10, p)

# ---------------------------------------------------------------- 11 团队
p = load(11)
T(p, 'text-3', '核心\n项目团队')
T(p, 'text-4', '由四位负责人\n分别牵头各条线')
for a, b, n, t in [
    ('text-12', 'text-13', '王静', '战略负责人'),
    ('text-23', 'text-24', '陈浩', '产品负责人'),
    ('text-9', 'text-10', '林雪', '市场负责人'),
    ('text-20', 'text-21', '赵磊', '运营负责人'),
]:
    T(p, a, n)
    T(p, b, t)
save(11, p)

# ---------------------------------------------------------------- 12 数据
p = load(12)
T(p, 'text-4', '40%')
T(p, 'text-5', '95%')
T(p, 'text-6', '1.2 亿')
T(p, 'text-3', '新业务收入占比\n同比提升 12 点')
T(p, 'text-9', '客户满意度\n连续三年领先')
T(p, 'text-10', '年度营业收入\n同比增长 35%')
save(12, p)

# ---------------------------------------------------------------- 13 时间线（图标从左到右：下、上、下、上）
p = load(13)
T(p, 'text-16', '项目推进时间线')
for a, b, t1, t2 in [
    ('text-17', 'text-18', 'Q1 立项启动', '完成方案评审，\n组建项目团队'),
    ('text-19', 'text-20', 'Q2 试点运行', '在两个区域开展试点，\n验证业务模式'),
    ('text-21', 'text-22', 'Q3 全面推广', '覆盖全部业务线，\n同步培训一线员工'),
    ('text-23', 'text-24', 'Q4 复盘优化', '总结经验教训，\n制定下一年度计划'),
]:
    T(p, a, t1)
    T(p, b, t2)
save(13, p)

# ---------------------------------------------------------------- 14 SWOT
p = load(14)
tb = el(p, 'table-1')
rows = tb['rows']
for c, v in zip(rows[1], ['优势', '劣势', '机会', '威胁']):
    c['text'] = v
bul = [
    ['品牌认知度高，客户基础稳定', '供应链成熟，交付周期短于同行'],
    ['数字化人才储备不足', '部分区域渠道覆盖薄弱，费用偏高'],
    ['行业数字化需求快速增长', '政策鼓励企业服务创新，新市场持续打开'],
    ['头部竞争对手加大价格投入', '原材料成本波动，宏观环境不确定性增加'],
]
for c, v in zip(rows[2], bul):
    c['text'] = replace_nodes(c['text'], v)
save(14, p)

# ---------------------------------------------------------------- 15 图表页：饼图图片 → 原生饼图
p = load(15)
T(p, 'text-2', '2026 年\n营收结构')
T(p, 'text-4', '五大业务板块均衡发展，\n研发服务贡献最高。')
for i, e in enumerate(p['elements']):
    if e['elementType'] == 'image' and e['src'].endswith('image29.png'):
        x, y, w, h = e['bounds']
        p['elements'][i] = {
            'elementId': 'revenue-pie',
            'elementType': 'chart',
            'bounds': [x, y, w, h],
            'data': {
                'cols': ['业务', '占比'],
                'rows': [['研发服务', 30], ['解决方案', 25], ['硬件销售', 20], ['运维服务', 15], ['培训咨询', 10]],
            },
            'series': [{
                'type': 'pie',
                'encode': {'category': '业务', 'value': '占比'},
                'fill': ['#00C2CB', '#0096BB', '#006AA2', '#004080', '#0F1755'],
                'dataLabels': {'show': True, 'content': 'percentage', 'color': '#FFFFFF', 'fontSize': 13},
            }],
            'legend': {'position': 'right', 'fontSize': 13, 'color': '#333333'},
            'fontFamily': 'MiSans',
        }
        os.remove(f'{D}/media/image29.png')
save(15, p)

# ---------------------------------------------------------------- 16 组织架构
p = load(16)
p['pageType'] = 'final'
T(p, 'text-2', '组织架构')
org = {
    'text-10': ('张伟', '总经理'),
    'text-12': ('王静', '战略副总裁'),
    'text-14': ('陈浩', '产品副总裁'),
    'text-16': ('林雪', '市场总监'),
    'text-37': ('赵磊', '运营总监'),
    'text-18': ('周敏', '研发总监'),
    'text-34': ('孙杰', '技术总监'),
}
for eid, (n, t) in org.items():
    c = el(p, eid)['content']
    if '<' in c['text']:
        c['text'] = replace_nodes(c['text'], [n, t])
    else:
        c['text'] = f'{n}\n{t}\n'
save(16, p)

# ---------------------------------------------------------------- manifest
m = yaml.safe_load(open(f'{D}/deck.pptd', encoding='utf-8'))
m['title'] = '企业战略路线图'
m['theme']['colors'] = {'primary': '#00C2CB', 'accent': '#8C52FF', 'light': '#F4F4F4'}
open(f'{D}/deck.pptd', 'w', encoding='utf-8').write(yaml.dump(m, Dumper=Dumper, allow_unicode=True, sort_keys=False))
# 页面中的 $c1/$c2/$c3 → 语义化名称
ren = {'$c1': '$primary', '$c3': '$accent', '$c2': '$light'}
for n in range(1, 17):
    f = f'{D}/pages/{n:02d}.page'
    s = open(f, encoding='utf-8').read()
    for a, b in ren.items():
        s = re.sub(re.escape(a) + r'(?![\w-])', b, s)
    open(f, 'w', encoding='utf-8').write(s)
os.remove(f'{D}/outline.json')
print('ok')
