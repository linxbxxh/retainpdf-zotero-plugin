# RetainPDF Translate（Zotero 插件）

把本机安装的 **RetainPDF 桌面版** 和 **Zotero** 打通：Zotero 里新抓取的文献 PDF 会自动送进
RetainPDF 的本地翻译服务（OCR → 全文翻译 → 排版渲染），生成的**中文译文 PDF（覆盖层，保留原图/公式/排版）**
自动挂到对应条目下面。

已在 Zotero 9.0.6 实测通过：抓取条目 → 约 20~90 秒后译文 PDF 出现在同一条目下。

## 功能

- **自动翻译**：条目新增 PDF 附件时自动触发（可在设置里关闭）。
- **右键手动翻译**：选中一个或多个条目 → 右键 →「RetainPDF 翻译全文并挂到条目」。
- **去重**：条目下已有译文附件（标题匹配「中文翻译 (RetainPDF)」）时自动跳过。
- **零配置凭证**：OCR Token、模型 API Key 自动读取 RetainPDF 桌面版的配置
  （`%APPDATA%\retain-pdf-desktop\desktop-config.json`），也可以在插件设置里覆盖。
- **自动拉起服务**：RetainPDF 本地服务（127.0.0.1:41000）没启动时，会尝试自动启动
  RetainPDF.exe（从常见安装路径查找，也可在设置里手动指定路径）。
- 翻译进行时在 Zotero 右下角显示进度（OCR 识别中 / 全文翻译中 / 渲染排版中）。

## 安装

1. 确认已安装 RetainPDF 桌面版（v4.1+），并且至少完成过一次它的首次配置（接口设置）。
2. 下载最新 [Release](https://github.com/linxbxxh/retainpdf-zotero-plugin/releases) 里的
   `RetainPDF-Translate-<version>.xpi`。
3. Zotero → 工具 → 插件 → 右上角齿轮 → **Install Plugin From File…** → 选择该 `.xpi`。
4. 完成后插件即生效（无需重启）。

## 从源码构建

```
python build.py        # 输出 dist/RetainPDF-Translate-<version>.xpi
```

版本号在 `manifest.json` 里维护；发新版时记得同步更新 `update.json` 的
`version` 与 `update_link`（Zotero 通过它做自动更新检查）。

## 使用

- **自动模式**（默认开启）：用浏览器 Connector / Zotero 抓取文献后，翻译自动开始，
  完成后译文 PDF 出现在条目下，标题为「中文翻译 (RetainPDF)」。
- **手动模式**：关闭自动翻译后，选中条目右键 →「RetainPDF 翻译全文并挂到条目」。
- 翻译完成后双击译文附件即可阅读（中文覆盖在原文之上）。

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
  费用由该 API 按用量计费；OCR 使用 PaddleOCR 免费接口。

## 目录

- 源码仓库：<https://github.com/linxbxxh/retainpdf-zotero-plugin>
- 安装包：GitHub Releases（本机另有一份在 Zotero profile 的
  `extensions\retainpdf-translate@zcode.local.xpi`）

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
