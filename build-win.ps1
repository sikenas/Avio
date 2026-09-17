<#
  build-win.ps1 — 在 Windows 上构建「音视频智能处理客户端」安装包
  ----------------------------------------------------------------------------
  用法（需管理员或普通用户均可，联网环境）：
    1) 安装 Node.js (>=18) 并加入 PATH
    2) 在本文件所在目录打开 PowerShell，执行：
         Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
         .\build-win.ps1
    3) 等待完成后，安装包位于 dist\AVClient-Setup-0.1.0.exe

  脚本会自动：
    - npm install 电子端依赖
    - 下载并内嵌 Windows 版 Python（无需用户单独安装 Python）
    - pip 安装后端依赖（yt-dlp 等）
    - 下载并内嵌 ffmpeg.exe
    - 调用 electron-builder 产出 NSIS 安装包

  全程约 3–8 分钟（取决于网速）。
#>

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Push-Location $root

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---------- 0. 校验 Node ----------
Step "0) 校验 Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "未检测到 Node.js，请先安装 https://nodejs.org (LTS) 并加入 PATH"
    exit 1
}
node -v

# ---------- 1. npm install ----------
Step "1) 安装 Electron / electron-builder"
npm install

# ---------- 2. 内嵌 Python (Windows amd64) ----------
Step "2) 下载并内嵌 Python 3.11 (embed-amd64)"
$pyVer = "3.11.9"
$pyUrl = "https://www.python.org/ftp/python/$pyVer/python-$pyVer-embed-amd64.zip"
$pyDest = Join-Path $root "resources/python"
New-Item -ItemType Directory -Force -Path $pyDest | Out-Null
$tmpPy = Join-Path $env:TEMP "avclient_py.zip"
Write-Host "  下载 $pyUrl"
Invoke-WebRequest -Uri $pyUrl -OutFile $tmpPy
Expand-Archive -Force -Path $tmpPy -DestinationPath $pyDest

# 启用 site-packages（embed 版默认关闭）
$pth = Get-ChildItem $pyDest -Filter "python3*._pth" | Select-Object -First 1
if ($pth) {
    (Get-Content $pth.FullName) -replace '#import site', 'import site' | Set-Content $pth.FullName
    Write-Host "  已启用 import site: $($pth.Name)"
}

# pip bootstrap
Step "3) 引导 pip 并安装后端依赖"
$getpip = Join-Path $pyDest "get-pip.py"
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getpip
& "$pyDest\python.exe" $getpip --no-warn-script-location
if ($LASTEXITCODE -ne 0) { Write-Error "get-pip 失败"; exit 1 }

# 安装 requirements.txt（含 yt-dlp；转写/问答依赖可后续在向导内安装）
$req = Join-Path $root "python/requirements.txt"
& "$pyDest\python.exe" -m pip install -r $req --no-warn-script-location
if ($LASTEXITCODE -ne 0) { Write-Error "pip install 失败"; exit 1 }

# 将后端脚本一并放入内嵌 Python 目录，便于 python.exe run_task.py 直接调用
Copy-Item (Join-Path $root "python/run_task.py") $pyDest -Force
Copy-Item (Join-Path $root "python/avcore") (Join-Path $pyDest "avcore") -Recurse -Force

# ---------- 4. 内嵌 ffmpeg (Windows) ----------
Step "4) 下载并内嵌 ffmpeg.exe"
$ffUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$tmpFf = Join-Path $env:TEMP "avclient_ff.zip"
Write-Host "  下载 $ffUrl"
Invoke-WebRequest -Uri $ffUrl -OutFile $tmpFf
$tmpFfDir = Join-Path $env:TEMP "avclient_ff"
Expand-Archive -Force -Path $tmpFf -DestinationPath $tmpFfDir
$ffExe = Get-ChildItem $tmpFfDir -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
if (-not $ffExe) { Write-Error "未找到 ffmpeg.exe"; exit 1 }
$binDest = Join-Path $root "resources/bin"
New-Item -ItemType Directory -Force -Path $binDest | Out-Null
Copy-Item $ffExe.FullName (Join-Path $binDest "ffmpeg.exe") -Force
Write-Host "  ffmpeg.exe -> $binDest"

# ---------- 5. 打包 NSIS 安装包 ----------
Step "5) 构建 Windows 安装包 (NSIS)"
npm run dist

Step "完成"
$out = Join-Path $root "dist"
Write-Host "安装包已生成于：$out" -ForegroundColor Green
Get-ChildItem $out -Filter "*.exe" | ForEach-Object { Write-Host "  - $($_.Name)  ($([math]::Round($_.Length/1MB,1)) MB)" }

Pop-Location
