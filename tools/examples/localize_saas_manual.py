"""
将 saas-onboarding-manual 模板完整转换为专业中文企业级 SaaS 交付与三步上手手册
"""
import os
import yaml

D = r'D:\kimippt\templates\saas-onboarding-manual'

class Dumper(yaml.SafeDumper):
    pass

def _str(d, s):
    return d.represent_scalar('tag:yaml.org,2002:str', s, style='|' if '\n' in s else None)

Dumper.add_representer(str, _str)

def load(n):
    return yaml.safe_load(open(f'{D}/pages/{n:02d}.page', encoding='utf-8'))

def save(n, p):
    open(f'{D}/pages/{n:02d}.page', 'w', encoding='utf-8').write(
        yaml.dump(p, Dumper=Dumper, allow_unicode=True, sort_keys=False, width=100000)
    )

def el(p, eid):
    for e in p['elements']:
        if e['elementId'] == eid:
            return e
    raise KeyError(f'{eid} not found')

def T(p, eid, text, **extra):
    c = el(p, eid)['content']
    c['text'] = text + '\n' if '\n' in text and not text.endswith('\n') else text
    c.update(extra)

# ---------------------------------------------------------------- 01 封面
p = load(1)
p['pageType'] = 'cover'
T(p, 'text-1', '数智商机云\n三步快速上手使用手册\n')
T(p, 'text-2', '未来科技有限公司 专享版')
T(p, 'text-4', 'LOGO')
T(p, 'text-6', '<p style="text-align:center">10分钟</p>\n<p style="text-align:center; margin-top:2.67px">上手</p>\n')
save(1, p)

# ---------------------------------------------------------------- 02 什么是该服务
p = load(2)
p['pageType'] = 'content'
T(p, 'text-2', '1')
T(p, 'text-3', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-5', '关于数智商机云')
T(p, 'text-4', '专为企业销售与解决方案团队打造的智能客户调研平台。\n零门槛快速上手，深度融合业务痛点，大幅降低前期调研与提案制作成本。\n')
T(p, 'text-11', '从全网线索到方案输出的一体化闭环')
T(p, 'text-13', '<p style="text-align:center">SaaS 协同型</p>\n<p style="text-align:center; margin-top:5.33px">智能工具</p>\n')
T(p, 'text-15', '01')
T(p, 'text-17', '多源商业数据整合与情报自动更新')
T(p, 'text-19', '02')
T(p, 'text-21', '客户画像在线编辑、共享与团队协同')
T(p, 'text-23', '03')
T(p, 'text-25', '方案初稿智能生成与多格式一键导出')
save(2, p)

# ---------------------------------------------------------------- 03 平台能力
p = load(3)
p['pageType'] = 'content'
T(p, 'text-2', '2')
T(p, 'text-3', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-5', '平台能为您带来什么')
T(p, 'text-4', '全面赋能市场洞察、售前咨询与大客户销售团队，实现全流程效能跃升。')
T(p, 'text-7', '<p style="text-align:center">客户前期背景调研</p>\n<p style="text-align:center; margin-top:5.33px">效率提升 70%</p>\n')
T(p, 'text-10', '<p style="text-align:center">结合企业产品与客户痛点</p>\n<p style="text-align:center; margin-top:5.33px">智能生成提案初稿</p>\n')
T(p, 'text-12', '<p style="text-align:center">全天候追踪目标行业</p>\n<p style="text-align:center; margin-top:5.33px">与重点竞对商业动态</p>\n')
T(p, 'text-14', '<p style="text-align:center">快速掌握目标企业现状</p>\n<p style="text-align:center; margin-top:5.33px">加速建立关键客户信任</p>\n')
T(p, 'text-16', '<p style="text-align:center">专家级提案故事线</p>\n<p style="text-align:center; margin-top:5.33px">与论证逻辑框架支撑</p>\n')
T(p, 'text-19', '<p style="text-align:center">海量分散商业资讯中</p>\n<p style="text-align:center; margin-top:5.33px">精准提炼核心决策依据</p>\n')
save(3, p)

# ---------------------------------------------------------------- 04 目录
p = load(4)
p['pageType'] = 'table_of_contents'
T(p, 'text-1', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-2', '3')
T(p, 'text-5', '※ 建议根据实际业务推进节奏分配各步骤的团队责任人')
tb = el(p, 'table-3')
# 表格标题
tb['rows'][0][0]['text'] = '数智商机云 · 3步快速上手指引'
# STEP 1
tb['rows'][1][0]['text'] = '<p style="text-align:center">STEP</p>\n<p style="text-align:center"><span style="font-size:26.67px">1</span></p>'
tb['rows'][1][1]['text'] = '初始设置与账号激活'
tb['rows'][1][2]['text'] = '<p style="text-align:right">p.05</p>'
# STEP 2
tb['rows'][2][0]['text'] = '<p style="text-align:center">STEP</p>\n<p style="text-align:center"><span style="font-size:26.67px">2</span></p>'
tb['rows'][2][1]['text'] = '发起智能调研与方案生成'
tb['rows'][2][2]['text'] = '<p style="text-align:right">p.09</p>'
# STEP 3
tb['rows'][3][0]['text'] = '<p style="text-align:center">STEP</p>\n<p style="text-align:center"><span style="font-size:26.67px">3</span></p>'
tb['rows'][3][1]['text'] = '成果查阅、协作与业务落地'
tb['rows'][3][2]['text'] = '<p style="text-align:right">p.11</p>'
save(4, p)

# ---------------------------------------------------------------- 05 过渡页 STEP 1
p = load(5)
p['pageType'] = 'chapter'
T(p, 'text-1', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-2', '4')
T(p, 'text-3', '初始设置')
T(p, 'text-5', 'STEP 1')
save(5, p)

# ---------------------------------------------------------------- 06 账号激活
p = load(6)
p['pageType'] = 'content'
T(p, 'text-1', '5')
T(p, 'text-2', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-3', '账号激活与注册')
T(p, 'text-4', '① 请查收来自管理员的邀请邮件，点击专属链接开启激活流程。\n(邮件主题：【待激活】数智商机云企业成员服务开通指引)\n')
T(p, 'text-6', '邀请邮件示意图\n(含专属激活链接)\n')
T(p, 'text-7', '② 若已有统一平台账号可直接登录；首次使用请点击「激活账号并设置密码」。\n')
T(p, 'text-9', '系统登录/激活入口\n(支持邮箱与手机号)\n')
T(p, 'text-10', '<p>※ 如需更换企业绑定邮箱，请联系本部门系统管理员重新分配</p>\n<p style="margin-top:5.33px">※ 统一认证登录门户：<u>https://login.shuzhicloud.com</u></p>\n')
save(6, p)

# ---------------------------------------------------------------- 07 新成员注册指引
p = load(7)
p['pageType'] = 'content'
T(p, 'text-1', '6')
T(p, 'text-2', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-3', '新成员首次注册流程（点击邮件链接后的 3 步操作）')
T(p, 'text-18', '1')
T(p, 'text-4', '① 验证企业手机号与身份信息')
T(p, 'text-6', '短信安全验证\n(输入 6 位验证码)\n')
T(p, 'text-14', '输入激活邮件所绑定的企业手机号码，获取并填写动态安全验证码以完成身份鉴权。')

T(p, 'text-21', '2')
T(p, 'text-7', '② 设置企业级高强度登录密码')
T(p, 'text-9', '密码设置界面\n(含大小写字母与数字)\n')
T(p, 'text-15', '设定符合企业安全等级规范的专属密码，保障商机情报与核心方案数据资产安全。')

T(p, 'text-24', '3')
T(p, 'text-10', '③ 确认所属团队与业务权限')
T(p, 'text-12', '资料与权限确认\n(开启协同工作台)\n')
T(p, 'text-16', '核对系统预分配的业务线与项目组权限，确认无误后点击「进入工作台」即完成配置。')
save(7, p)

# ---------------------------------------------------------------- 08 日常登录
p = load(8)
p['pageType'] = 'content'
T(p, 'text-1', '7')
T(p, 'text-2', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-3', '日常登录与访问建议')
T(p, 'text-4', '<p>① 访问统一登录门户或点击企业内部工作台快捷入口。</p>\n<p><span style="font-size:12px"> (首次注册完成后将自动收到欢迎通知与常用访问书签)</span></p>\n<p>&nbsp;</p>\n<p>② 使用已激活的企业邮箱/手机号及密码登录系统。</p>\n')
T(p, 'text-5', '<p>※ 如遇密码遗忘，可在登录界面点击「忘记密码」通过企业安全邮箱自主重置。</p>\n<p><u><span style="color:$c2">https://login.shuzhicloud.com</span></u></p>\n')
T(p, 'text-6', '※ 强烈建议将系统控制台首页加入浏览器书签收藏夹，便于日常快速访问。')
T(p, 'text-9', '注册成功欢迎通知\n与控制台快捷入口\n')
save(8, p)

# ---------------------------------------------------------------- 09 过渡页 STEP 2
p = load(9)
p['pageType'] = 'chapter'
T(p, 'text-1', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-2', '8')
T(p, 'text-3', '发起调研')
T(p, 'text-5', 'STEP 2')
save(9, p)

# ---------------------------------------------------------------- 10 核心功能与操作
p = load(10)
p['pageType'] = 'content'
T(p, 'text-1', '9')
T(p, 'text-2', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-3', '智能客户调研与方案生成')
T(p, 'text-5', '智能调研控制台界面')
T(p, 'text-6', '入口导航：控制台 > 商业智能 > 新建调研分析任务 (shuzhicloud.com/app/research)')
T(p, 'text-7', '※ 支持按客户名单批量创建任务，系统将在后台全自动并发分析并推送完成通知')

T(p, 'text-10', '输入目标企业信息')
T(p, 'text-8', '填写目标客户全称、统一社会信用代码或官网域名，系统自动穿透工商、财报及公开招投标信息。')

T(p, 'text-13', '选择研判分析维度')
T(p, 'text-11', '勾选关键人画像、业务痛点识别、现有供应商格局以及商机采购周期等大模型深度分析模块。')

T(p, 'text-16', '一键生成定制方案')
T(p, 'text-14', '匹配本企业产品矩阵与成功案例库，点击「开始生成」，约 3 分钟即可获得高匹配度方案。')
save(10, p)

# ---------------------------------------------------------------- 11 过渡页 STEP 3
p = load(11)
p['pageType'] = 'chapter'
T(p, 'text-1', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-2', '10')
T(p, 'text-3', '成果应用')
T(p, 'text-5', 'STEP 3')
save(11, p)

# ---------------------------------------------------------------- 12 成果报告与赋能
p = load(12)
p['pageType'] = 'content'
T(p, 'text-1', '11')
T(p, 'text-2', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-4', '将深度调研成果无缝融入销售打法与商务提案')
T(p, 'text-3', '支持 Word、PPT 及可视化大屏多格式导出，全面赋能商务拜访与提案演示。')
T(p, 'text-6', '客户全景画像分析报告\n(涵盖企业架构、业务痛点与决策链)\n')
T(p, 'text-8', '定制化商务解决方案初稿\n(精准切入客群需求与投入产出测算)\n')
T(p, 'text-9', '※ 导出的 PPTX 与 Docx 文件保持全原生元素排版，可按需任意编辑、修改与追加内部数据')
save(12, p)

# ---------------------------------------------------------------- 13 过渡页 常见问题
p = load(13)
p['pageType'] = 'chapter'
T(p, 'text-1', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-2', '12')
T(p, 'text-3', '服务保障与支持')
save(13, p)

# ---------------------------------------------------------------- 14 结尾联系方式
p = load(14)
p['pageType'] = 'final'
T(p, 'text-1', '13')
T(p, 'text-2', 'https://www.shuzhicloud.com/portal/')
T(p, 'text-3', '在使用数智商机云过程中如有任何疑问，请随时联系您的专属服务团队。')
T(p, 'text-4', '联系方式与专属支持通道')
T(p, 'text-6', '业务落地辅导 · 账号权限扩容 · 专属需求定制')
T(p, 'text-7', '专属客户成功顾问：王经理（资深解决方案专家）')
T(p, 'text-8', '<p style="text-align:center; margin-top:4px">欢迎来信或来电咨询，我们将在 2 个工作小时内快速响应并提供专业指导。</p>\n')
T(p, 'text-10', '<p style="text-align:center"><u>E-mail: support@shuzhicloud.com</u>&nbsp;&nbsp;|&nbsp;&nbsp;<u>Tel: 400-820-9888</u></p>\n')
save(14, p)

# ---------------------------------------------------------------- template.json
template_json = {
    "name": "深蓝商务 · SaaS 产品三步上手手册",
    "category": "产品手册",
    "description": "专为企业数字化平台与 SaaS 软件定制的客户培训与上手指南，涵盖系统概览、双端界面展示、六大核心应用场景、三步实操流程与专属支持保障，共 14 页。",
    "tags": [
        "浅色",
        "软件手册",
        "14 页",
        "产品指引"
    ],
    "order": 6,
    "decorations": [
        "media/image2.png",
        "media/image4.png",
        "media/image6.png",
        "media/image7.png",
        "media/image8.png",
        "media/image9.png",
        "media/image10.png",
        "media/image11.png",
        "media/image12.png"
    ]
}

import json
with open(f'{D}/template.json', 'w', encoding='utf-8') as f:
    json.dump(template_json, f, ensure_ascii=False, indent=2)

# 移除 outline.json
if os.path.exists(f'{D}/outline.json'):
    os.remove(f'{D}/outline.json')

print("All 14 pages and template.json created and localized successfully!")
