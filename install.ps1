# RetainPDF Translate (Zotero 插件) 一键下载安装脚本
# 用法（PowerShell）:
#   irm https://raw.githubusercontent.com/linxbxxh/retainpdf-zotero-plugin/main/install.ps1 | iex
# 脚本只做三件事：定位 Zotero -> 下载最新版 xpi -> 打开资源管理器并选中它。
# 最后一步安装需要你在 Zotero 里点几下（无法用脚本安全完成），脚本会给出精确指引。

$ErrorActionPreference = "Stop"
$repo = "linxbxxh/retainpdf-zotero-plugin"

Write-Host "== RetainPDF Translate 安装助手 ==" -ForegroundColor Cyan

# 1. 定位 Zotero
$zotero = $null
$uninstPaths = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($p in $uninstPaths) {
  $key = Get-ItemProperty $p -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "Zotero*" } |
    Sort-Object DisplayVersion -Descending | Select-Object -First 1
  if ($key) {
    $dir = $key.InstallLocation
    if ($dir -and (Test-Path (Join-Path $dir "zotero.exe"))) { $zotero = Join-Path $dir "zotero.exe"; break }
  }
}
if (-not $zotero) {
  foreach ($c in @("$env:ProgramFiles\Zotero\zotero.exe", "${env:ProgramFiles(x86)}\Zotero\zotero.exe", "$env:LOCALAPPDATA\Programs\Zotero\zotero.exe")) {
    if (Test-Path $c) { $zotero = $c; break }
  }
}
if ($zotero) {
  Write-Host "[OK] 找到 Zotero: $zotero" -ForegroundColor Green
} else {
  Write-Host "[!!] 未找到 Zotero，请先安装: https://www.zotero.org/download/" -ForegroundColor Yellow
}

# 2. 下载最新版 xpi（固定链接，不走 GitHub API，避免限流）
$dest = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
$url = "https://github.com/$repo/releases/latest/download/RetainPDF-Translate-latest.xpi"
$out = Join-Path $dest "RetainPDF-Translate-latest.xpi"
try {
  Write-Host "下载最新版 xpi ..."
  Invoke-WebRequest $url -OutFile $out -UseBasicParsing
  Write-Host "[OK] 已下载: $out" -ForegroundColor Green
} catch {
  Write-Host "[!!] 下载失败: $_" -ForegroundColor Red
  Write-Host "请手动从 https://github.com/$repo/releases 下载 xpi"
  exit 1
}

# 3. 打开资源管理器并选中 xpi
Start-Process explorer.exe "/select,`"$out`""
Write-Host ""
Write-Host "== 最后三步（在 Zotero 里完成） ==" -ForegroundColor Cyan
Write-Host " 1. Zotero -> 工具 -> 插件"
Write-Host " 2. 右上角齿轮 -> Install Plugin From File..."
Write-Host " 3. 选择刚下载的 $out"
Write-Host ""
Write-Host "提示：还需要本机安装 RetainPDF 桌面版并完成其接口设置（OCR Token / 模型 API Key），"
Write-Host "插件会自动读取它的配置。详见仓库 README。"
