# 部署指南（Windows）

把插件装到另一台 Windows 电脑的最快路径。全程约 5 分钟，前提是新电脑上已经装好
**Zotero** 和 **RetainPDF 桌面版**（见下方「第 0 步」）。

---

## 第 0 步：前提（新电脑只装一次）

| 软件 | 作用 | 获取 |
| --- | --- | --- |
| Zotero 7/8/9 | 文献管理 | https://www.zotero.org/download/ |
| RetainPDF 桌面版 v4.1+ | 翻译引擎（内置本地 API） | https://github.com/wxyhgk/retain-pdf |

装完 RetainPDF 后**务必打开它一次**，完成首次「接口设置」：

- **OCR Token**：默认 PaddleOCR（免费接口）
- **模型 API Key**：DeepSeek 等，走你自己的账号按用量计费

> ⚠️ **这两份凭证存在 RetainPDF 自己的配置目录里，不会随插件文件一起复制。**
> 换电脑时必须在新机器上重新登录/配置一次。插件本身不含任何硬编码密钥，它运行时
> 自动读取 RetainPDF 桌面配置。

---

## 第 1 步：一键部署脚本

在 **PowerShell** 里执行（会自动：定位 Zotero、检测 RetainPDF、下载最新 xpi、
打开所在文件夹并选中）：

```powershell
irm https://raw.githubusercontent.com/linxbxxh/retainpdf-zotero-plugin/main/install.ps1 | iex
```

> 如果 `irm | iex` 被策略拦截，先运行 `Set-ExecutionPolicy -Scope Process Bypass`，
> 或手动走第 2 步。

---

## 第 2 步：安装 xpi（推荐方式，最稳）

1. Zotero → **工具** → **插件**
2. 右上角 **齿轮** → **Install Plugin From File…**
3. 选中下载好的 `RetainPDF-Translate-latest.xpi` → 打开
4. 即装即生效，无需重启；插件列表里应显示 **RetainPDF Translate** 且 Active

### 备选：一键拷贝（Zotero 必须完全退出）

也可以直接把 xpi 拷到 Zotero 安装目录下的 `extensions/` 文件夹。但**必须先完全退出
Zotero**，否则 Zotero 退出时会用它内存里的扩展注册表覆盖磁盘，导致拷贝无效。
日常升级推荐上面的「Install Plugin From File」，更省心。

---

## 第 3 步：30 秒验证

1. 用浏览器上的 Zotero Connector 抓一篇英文文献（或在 Zotero 里给任意条目添加英文 PDF）
2. Zotero 右下角出现「RetainPDF 翻译」进度条
3. 完成后条目下多出三个附件：

   - `Full Text PDF`（原文）
   - `中文翻译 (RetainPDF)`（A4 中文覆盖层）
   - `中英对照 (RetainPDF)`（A3 横版，左原文右译文）

三个附件齐了，部署即成功。

---

## 第 4 步：新电脑必须单独确认的事

| 事项 | 说明 |
| --- | --- |
| **RetainPDF 登录 / 接口设置** | 凭证不随插件复制，换机要重新配（OCR Token + 模型 API Key） |
| **插件设置里的「RetainPDF.exe 路径」** | 留空会自动查找（注册表 + 各盘符 `X:\RetainPDF\`）；装在不常见路径就手动填 |
| **「模型名称」覆盖** | 默认留空 = 跟随 RetainPDF 桌面配置；若翻译一直失败，先检查模型名是否本机可用 |

这三项都在 Zotero → 工具 → 插件 → RetainPDF 翻译 → 首选项 里。

---

## 常见问题（部署场景）

- **翻译一直失败 / 没反应**：先确认 RetainPDF 桌面版已登录且「接口设置」填好了，
  再看插件首选项里的「模型名称」是否可用。这两条是换机后最常见的原因。
- **弹「Another instance of the application is already running」**：RetainPDF 是
  单实例应用。1.1.1 已修复插件侧重复拉起的问题；若仍出现，说明有别的程序在重复启动
  它，任务管理器结束多余的 `RetainPDF.exe` 即可。
- **脚本找不到 Zotero / RetainPDF**：脚本会给出检测结果和官网链接；装到非标准路径时
  手动下载 xpi（第 2 步）即可，不影响使用。

---

## 完整自动更新（可选）

`update.json` 已指向 GitHub Release，插件装了之后 Zotero 会走 `update_url` 自动检查
更新。手动装 xpi 即可用；自动更新只是省掉后续手动升级。
