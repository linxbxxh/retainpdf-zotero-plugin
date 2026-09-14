# RetainPDF Translate (Zotero 插件) 一键部署脚本（Windows）
# 用法（PowerShell）:
#   irm https://raw.githubusercontent.com/linxbxxh/retainpdf-zotero-plugin/main/install.ps1 | iex
#
# 脚本做的事：定位 Zotero -> 检测 RetainPDF -> 下载最新版 xpi -> 打开所在文件夹并选中。
# 最后一步「在 Zotero 里点 Install Plugin From File」无法用脚本安全代做，脚本给出精确指引。
# 若用「一键安装（拷贝 xpi 到 extensions 目录）」方式，脚本会额外提醒：Zotero 必须完全退出。

$ErrorActionPreference = "Stop"
$repo = "linxbxxh/retainpdf-zotero-plugin"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  RetainPDF Translate 插件部署助手 (Windows)" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------
# 1. 定位 Zotero
# ---------------------------------------------------------------
$zotero = $null
$zoteroDir = $null
$uninstPaths = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($p in $uninstPaths) {
  $key = Get-ItemProperty $p -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "Zotero*" } |
    Sort-Object DisplayVersion -Descending | Select-Object -First 1
  if ($key) {
    $dir = $key.InstallLocation
    if ($dir -and (Test-Path (Join-Path $dir "zotero.exe"))) {
      $zotero = Join-Path $dir "zotero.exe"
      $zoteroDir = $dir
      break
    }
  }
}
if (-not $zotero) {
  foreach ($c in @(
    "$env:ProgramFiles\Zotero\zotero.exe",
    "${env:ProgramFiles(x86)}\Zotero\zotero.exe",
    "$env:LOCALAPPDATA\Programs\Zotero\zotero.exe"
  )) {
    if (Test-Path $c) { $zotero = $c; $zoteroDir = Split-Path $c; break }
  }
}

if ($zotero) {
  Write-Host "[OK] 找到 Zotero: $zotero" -ForegroundColor Green
  $zoteroRunning = $false
  Get-Process zotero -ErrorAction SilentlyContinue | ForEach-Object { $zoteroRunning = $true }
  if ($zoteroRunning) { Write-Host "     （检测到 Zotero 正在运行）" -ForegroundColor Yellow }
} else {
  Write-Host "[!!] 未找到 Zotero，请先安装: https://www.zotero.org/download/" -ForegroundColor Yellow
}

# ---------------------------------------------------------------
# 2. 检测 RetainPDF 桌面版
# ---------------------------------------------------------------
Write-Host ""
$rpExe = $null
# 插件内置的查找逻辑：注册表 + 常见盘符的绿色安装路径
$rpUninst = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($p in $rpUninst) {
  $key = Get-ItemProperty $p -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "*RetainPDF*" -or $_.DisplayName -like "*retain-pdf*" } |
    Select-Object -First 1
  if ($key) {
    $d = $key.InstallLocation
    if ($d) {
      $candidate = Join-Path $d "RetainPDF.exe"
      if (Test-Path $candidate) { $rpExe = $candidate; break }
    }
  }
}
if (-not $rpExe) {
  $known = @(
    "D:\retainPDF\RetainPDF.exe",
    "$env:LOCALAPPDATA\Programs\RetainPDF\RetainPDF.exe",
    "$env:ProgramFiles\RetainPDF\RetainPDF.exe"
  )
  foreach ($c in $known) { if (Test-Path $c) { $rpExe = $c; break } }
  if (-not $rpExe) {
    # 扫各盘符 X:\RetainPDF\RetainPDF.exe（对应插件 README 里的绿色安装路径）
    foreach ($d in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
      $c = Join-Path $d.Root "RetainPDF\RetainPDF.exe"
      if (Test-Path $c) { $rpExe = $c; break }
    }
  }
}
if ($rpExe) {
  Write-Host "[OK] 找到 RetainPDF: $rpExe" -ForegroundColor Green
  $rpRunning = $false
  Get-Process RetainPDF -ErrorAction SilentlyContinue | ForEach-Object { $rpRunning = $true }
  if ($rpRunning) {
    Write-Host "     （RetainPDF 正在运行，本地 API 应可用）" -ForegroundColor Green
  } else {
    Write-Host "     （RetainPDF 未运行；首次翻译时插件会自动拉起它）" -ForegroundColor Yellow
  }
} else {
  Write-Host "[!!] 未找到 RetainPDF 桌面版。" -ForegroundColor Yellow
  Write-Host "     请先安装 RetainPDF v4.1+ 并完成其「接口设置」:" -ForegroundColor Yellow
  Write-Host "     https://github.com/wxyhgk/retain-pdf" -ForegroundColor Yellow
  Write-Host "     （OCR Token 默认 PaddleOCR，模型 API Key 用 DeepSeek 等；" -ForegroundColor Yellow
  Write-Host "       插件会自动读取这份配置，无需重复填写。）" -ForegroundColor Yellow
}

# ---------------------------------------------------------------
# 3. 下载最新版 xpi
# ---------------------------------------------------------------
Write-Host ""
$dest = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
$url = "https://github.com/$repo/releases/latest/download/RetainPDF-Translate-latest.xpi"
$out = Join-Path $dest "RetainPDF-Translate-latest.xpi"
try {
  Write-Host "下载最新版 xpi ..."
  Invoke-WebRequest $url -OutFile $out -UseBasicParsing
  Write-Host "[OK] 已下载: $out" -ForegroundColor Green
} catch {
  Write-Host "[!!] 下载失败: $_" -ForegroundColor Red
  Write-Host "请手动从 https://github.com/$repo/releases 下载 xpi" -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------
# 4. 打开资源管理器并选中 xpi
# ---------------------------------------------------------------
Start-Process explorer.exe "/select,`"$out`""
Write-Host ""
Write-Host "== 安装（推荐：在 Zotero 里点几下，最稳） ==" -ForegroundColor Cyan
Write-Host " 1. Zotero -> 工具 -> 插件"
Write-Host " 2. 右上角齿轮 -> Install Plugin From File..."
Write-Host " 3. 选中刚下载的 $out -> 打开（即装即生效，无需重启）"
Write-Host ""
if ($zoteroDir) {
  Write-Host "== 或：一键安装（拷贝 xpi 到插件目录） ==" -ForegroundColor Cyan
  $extDir = Join-Path $zoteroDir "extensions"
  Write-Host " 把 $out 拷到:"
  Write-Host "   $extDir" -ForegroundColor DarkGray
  Write-Host " 注意：此方式 Zotero 必须完全退出后再做，否则扩展注册会被覆盖。" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "== 装完后 30 秒验证 ==" -ForegroundColor Cyan
Write-Host " 用 Zotero Connector 抓一篇英文文献，翻译完成后条目下应出现:"
Write-Host "   - Full Text PDF（原文）"
Write-Host "   - 中文翻译 (RetainPDF)"
Write-Host "   - 中英对照 (RetainPDF)"
Write-Host ""
Write-Host "== 新电脑上必须单独确认的两件事 ==" -ForegroundColor Cyan
Write-Host " 1. RetainPDF 是否已在本机登录并完成接口设置（OCR Token / 模型 API Key）"
Write-Host "    ——凭证存在 RetainPDF 自己的配置里，不会随插件复制过来。"
Write-Host " 2. 插件设置里的「RetainPDF.exe 路径」是否正确（留空会自动查找，一般无需改）"
Write-Host "    若翻译一直失败，优先检查「模型名称」是否本机可用（默认留空=跟随桌面配置）。"
Write-Host ""
