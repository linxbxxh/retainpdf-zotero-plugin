# RetainPDF Translate（Zotero 插件）

把本机安装的 **RetainPDF 桌面版** 和 **Zotero** 打通：Zotero 里新抓取的文献 PDF 会自动送进
RetainPDF 的本地翻译服务（OCR → 全文翻译 → Typst 排版渲染），生成的**中文译文 PDF（覆盖层，
保留原图/公式/排版）**自动挂到对应条目下面。

> 已在 Zotero 9.0.6 + RetainPDF 4.1.7 实测：抓取一篇文献 → 约 20~90 秒后译文 PDF
> 出现在同一条目下。

## ⚡ 快速部署（约 5 分钟）

### 前提（只装一次）

| 软件 | 作用 | 获取 |
| --- | --- | --- |
| Zotero 7/8/9 | 文献管理 | [zotero.org/download](https://www.zotero.org/download/) |
| RetainPDF 桌面版 v4.1+ | 翻译引擎（含本地 API） | [github.com/wxyhgk/retain-pdf](https://github.com/wxyhgk/retain-pdf) |

**关键一步**：安装 RetainPDF 后打开它，完成首次「接口设置」——填好 OCR Token
（默认 PaddleOCR）和翻译模型的 API Key（DeepSeek 等）。插件会自动读取这份配置，
之后不用再填任何密钥。

### 第 1 步：下载插件

PowerShell 一键下载（自动找最新版并打开所在文件夹）：

```powershell
irm https://raw.githubusercontent.com/linxbxxh/retainpdf-zotero-plugin/main/install.ps1 | iex
```

或者手动下载：到 [Releases](https://github.com/linxbxxh/retainpdf-zotero-plugin/releases)
下载 `RetainPDF-Translate-<版本>.xpi`。

### 第 2 步：安装到 Zotero（4 次点击）

1. Zotero → **工具** → **插件**
2. 右上角 **齿轮** → **Install Plugin From File…**
3. 选中刚下载的 `.xpi` → 打开
4. 完成即生效，无需重启

### 第 3 步：30 秒验证

1. 用浏览器上的 Zotero Connector 随便抓一篇英文文献（或在 Zotero 里给任意条目
   添加一个英文 PDF 附件）
2. Zotero 右下角出现「RetainPDF 翻译」进度条（OCR 识别中 → 全文翻译中 → 渲染排版中）
3. 完成后条目下多出一个**「中文翻译 (RetainPDF)」**附件，双击即可阅读译文

> 注意：翻译期间 RetainPDF 需在运行（最小化到托盘即可）。没在运行时插件会尝试自动启动它。
>
> 译文质量/费用走你自己在 RetainPDF 里配置的模型 API，按用量计费；OCR 用 PaddleOCR 免费接口。

## 功能

- **自动翻译**：条目新增 PDF 附件时自动触发（可在设置里关闭）
- **右键手动翻译**：选中一个或多个条目 → 右键 →「RetainPDF 翻译全文并挂到条目」
- **去重**：条目下已有译文附件（标题匹配「中文翻译 (RetainPDF)」）时自动跳过
- **零配置凭证**：OCR Token、模型 API Key 自动读取 RetainPDF 桌面配置，可覆盖
- **自动拉起服务**：本地 API（127.0.0.1:41000）没启动时自动启动 RetainPDF.exe
- 翻译进度实时显示在 Zotero 右下角

## 设置（Zotero → 工具 → 插件 → RetainPDF 翻译 → 首选项）

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 新抓取 PDF 自动翻译 | 开 | 关闭后只能右键手动翻译 |
| 已有译文时跳过 | 开 | 按附件标题判断 |
| 译文附件标题 | 中文翻译 (RetainPDF) | 同时用于去重判断 |
| 翻译页码范围 | 空（全部） | 例如 `1-5` 或 `1,3,7` |
| 服务地址 | http://127.0.0.1:41000 | RetainPDF 本地 API |
| API Key | retain-pdf-desktop | RetainPDF 桌面版内置 key |
| RetainPDF.exe 路径 | 空 | 留空自动查找；服务未启动时用于拉起 |
| 模型名称 / 接口地址 / API Key | 空 | **留空 = 跟随 RetainPDF 桌面版配置**；填写则覆盖 |
| OCR Provider | 空 | paddle / mineru / vision，留空跟随桌面配置 |
| 轮询间隔 / 任务超时 | 3 秒 / 1800 秒 | 长文献可调大超时 |

## 常见问题

- **译文里中文只有一部分 / 全是英文原文**：翻译任务成功但模型侧没有返回译文
  （RetainPDF 的处理是"保留原文"）。多半是模型中转站上游临时不可用。
  可在插件设置的「模型名称」里覆盖为当前可用的模型；清空则重新跟随
  RetainPDF 桌面版配置。
- **提示无法连接本地服务**：打开 RetainPDF 桌面版（可最小化到托盘，本地 API 仍在），
  或在插件设置里指定 RetainPDF.exe 路径让插件自动拉起。
- **翻译失败**：看弹窗里的诊断信息；RetainPDF 主界面里也能看到对应任务日志。
- **每篇文献要花多少钱**：走你自己在 RetainPDF 里配置的模型 API（DeepSeek 等），
  费用由该 API 按用量计费。

## 从源码构建

```
python build.py        # 输出 dist/RetainPDF-Translate-<version>.xpi
```

版本号在 `manifest.json` 里维护；发新版时记得同步更新 `update.json` 的
`version` 与 `update_link`（Zotero 通过它做自动更新检查）。

## 技术说明

插件通过 RetainPDF 桌面版内置的本地 HTTP API 工作（协议经逆向确认并实测）：

```
POST /api/v1/uploads                     上传 PDF（multipart）
POST /api/v1/jobs                        提交 workflow=book（OCR+翻译+渲染）
GET  /api/v1/jobs/{id}                   轮询状态（queued/running/succeeded/failed）
GET  /api/v1/jobs/{id}/artifacts-manifest
GET  /api/v1/jobs/{id}/pdf               下载译文 PDF
```

所有请求带 `X-API-Key: retain-pdf-desktop`。兼容 Zotero 7/8/9（manifest 版本声明 6.999–10.9.9）。

### Zotero 9 兼容性备忘（踩坑记录）

- `applications.zotero.update_url` 是**必填**字段，缺失时插件会被静默判定无效、永不加载。
- 插件 bootstrap.js 运行在受限沙箱里：没有 `Components`/`nsIProcess` 等 chrome 全局，
  只能用 scope 注入的 `Zotero` / `Services` / `IOUtils` / `PathUtils`
  与白名单全局（`XMLHttpRequest`、`fetch`、`TextEncoder` 等）。
- 外部进程用 `Zotero.Utilities.Internal.exec(path, args)` 启动；二进制读写用 `IOUtils`。
