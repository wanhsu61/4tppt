# PPT 模板生成器

基于 [open-kimi-ppt-skill](https://github.com/binaryify/open-kimi-ppt-skill) 的 PPTD 格式与本地 WASM 导出器做的网页工具：

1. **模板库**：浏览所有模板，网页内实时渲染封面和每一页预览；
2. **填写内容**：选中模板后，逐页修改文字（保留原有字号、颜色、加粗等样式）、替换图片、编辑表格、调整主题配色；页面可以复制 / 删除 / 调整顺序；
3. **一键生成**：点击「生成 PPTX」，服务端写出新的 PPTD 项目并调用官方 WASM 导出 `.pptx`（带淡入淡出切换），浏览器自动下载。

## 运行

需要 Node.js 18+。

- Windows：双击 `start.bat`（首次会自动 `npm install`，然后打开浏览器）
- 命令行：

```bash
npm install
npm start          # 打开 http://127.0.0.1:5180/
```

可选环境变量：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 端口 | `5180` |
| `HOST` | 监听地址（局域网共享可设为 `0.0.0.0`） | `127.0.0.1` |
| `TEMPLATE_DIRS` | 额外的模板目录，多个用 `;`（Windows）或 `:` 分隔 | 无 |
| `OUTPUT_DIR` | 生成结果目录 | `./output` |

## 目录结构

```text
kimippt/
  server.js            # Node 服务：模板扫描、媒体文件、生成与导出 API
  public/              # 前端（原生 JS，无需构建）
    index.html
    app.js             # 模板库 / 编辑器 / 生成记录
    render.js          # PPTD → HTML 预览渲染器
    style.css
  templates/           # 模板（每个子目录是一个 PPTD 项目）
  vendor/              # open-kimi-ppt-skill 的导出脚本与 WASM（MIT）
  output/              # 每次生成：<时间>-<标题>/deck.pptd + pages/ + media/ + <标题>.pptx
```

## 添加新模板

把任意完整的 PPTD 项目文件夹（含 `.pptd`、`pages/`、`media/`）复制到 `templates/` 下，刷新页面即可出现在模板库。可选地在文件夹里放一个 `template.json` 设置展示信息：

```json
{
  "name": "模板显示名",
  "category": "分类（用于筛选）",
  "description": "一句话介绍",
  "tags": ["深色", "图片"],
  "order": 10
}
```

用 open-kimi-ppt skill 让 AI 生成的 PPTD 项目、或者 `example/` 里的项目，都可以直接作为模板。

可选字段 `decorations`：装饰性图片（渐变色块、动效背景等）的路径列表，这些图片不会出现在网页的「本页内容」表单里，避免干扰。

### 从现成的 PPTX 制作模板

`tools/pptx2pptd.py` 可以把 PPTX（PowerPoint / Canva / WPS 导出的都可以）转换成 PPTD 项目：

```bash
pip install pyyaml pillow          # 首次使用
python tools/pptx2pptd.py 输入.pptx templates/新模板id --slides 1-16 --title 模板标题
```

- 默认缩放到 960×540，统一字体为 MiSans（`--font` 可改），图片最长边压到 1920px（`--max-image`）
- 支持组合、文本框（富文本 / 项目符号）、预设与自由形状、图片裁剪与透明度、Canva 式图片填充、直线、表格、页面背景
- 出现最多的颜色会提取为主题色（`$c1`…），网页「整体设置」里可以一键换色
- 原生图表、SmartArt、音视频不支持，会给出警告（可以在转换后手动换成 PPTD 的 `chart` 元素）
- 转换后在目录里生成 `outline.json`，列出每页文字，便于改写成中文；`tools/examples/localize_corporate_roadmap.py` 是一个完整的改写示例

推荐流程：转换 → 改写文字（保持原文的行数和长度）→ 写 `template.json` → 刷新网页检查预览 → 生成一次 PPTX 打开检查。


## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/templates` | 模板列表（含封面页数据） |
| GET | `/api/templates/:id` | 模板完整数据（manifest + 所有页面） |
| GET | `/tpl/:id/<path>` | 模板中的媒体文件 |
| POST | `/api/generate` | `{templateId, title, theme, transition, pages:[页面对象], uploads:{"media/upload_x.png": dataURL}}` → 生成 PPTX |
| GET | `/api/history` | 生成记录 |
| GET | `/output/<dir>/<file>` | 下载生成结果 |

## 说明

- 网页预览是近似渲染，最终效果以导出的 PPTX 为准（饼图 / 柱状图 / 折线图 / 面积图可预览，其他图表显示为占位框）。
- 生成前会做兼容性修正：富文本里 `color:$主题色` 引用会替换为实际色值、表格单元格的 `content` 写法会展开为标准字段，避免导出后颜色变黑或表格文字丢失。
- 每次生成的目录里同时保留可编辑的 PPTD 项目，可用 `npx open-kimi-ppt-skill serve` 打开继续精修。
- 编辑内容会自动保存为浏览器草稿；点「重置」恢复模板原样。
