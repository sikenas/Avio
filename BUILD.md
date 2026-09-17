# 构建说明（Windows 安装包）

本工程使用 **Electron（前端 GUI）+ 内嵌 Python（后端：下载/分离/转写/问答）** 架构。
目标：产出可在 Windows 上安装运行的 `.exe` 安装包（NSIS），且**自包含 Python 与 ffmpeg**，用户无需单独安装环境。

---

## ⚠️ 关键约束（务必先读）

| 事项 | 说明 |
|---|---|
| **NSIS 安装包必须在 Windows 上构建** | NSIS 编译工具链为 Windows 原生；在非 Windows 上 electron-builder 无法可靠产出 NSIS 安装包。 |
| **Python 后端必须在 Windows 上打包** | 内嵌 Python（embed-amd64）与 ffmpeg 的 Windows 二进制，以及 `pip install` 下载 Windows 专用 wheel，都只能在 Windows 上完成（PyInstaller / 内嵌 Python 均不能跨平台）。 |
| **macOS 只能做"交叉验证"** | 在本仓库可在 macOS 上 `electron-builder --win portable` 验证 Electron 外壳能打包为 Windows 可执行文件，但其内不含可用的 Windows Python/ffmpeg，因此**不能**作为最终交付安装包。 |

> 结论：最终可安装的 `.exe` 安装包请按下方「在 Windows 上构建」步骤执行（约 3–8 分钟）。

---

## 一、在 Windows 上构建安装包（推荐路径，产出真正可安装的 .exe）

前提：已安装 **Node.js ≥ 18** 并加入 PATH（https://nodejs.org 下载 LTS，安装时勾选 Add to PATH）。

1. 把整个 `avclient/` 文件夹拷贝到 Windows 机器。
2. 在 `avclient/` 目录打开 PowerShell。
3. 执行：
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\build-win.ps1
   ```
   或直接双击 `build-win.bat`。
4. 脚本自动完成：npm 依赖 → 内嵌 Python → pip 安装后端依赖 → 内嵌 ffmpeg → 打包 NSIS。
5. 产物：`avclient/dist/AVClient-Setup-0.1.0.exe`（拷贝到任意 Windows 机器双击安装即可）。

安装后首次启动，向导会进行依赖自检；若离线或需转写/问答能力，可在向导内点击「安装」按钮联网补齐 `faster-whisper` / `openai` 等依赖。

---

## 二、在 macOS / Linux 上交叉编译验证（仅验证 Electron 外壳，非最终安装包）

```bash
npm install
npm run dist:portable     # 产出 dist/AVClient-portable-0.1.0.exe（Win 可执行，但缺内嵌 Python/ffmpeg）
# 或
npm run dist:win-all      # 尝试 portable + zip + nsis（nsis 在非 Windows 会失败，属预期）
```

该产物用于验证前端打包链路，不可作为交付安装包。

---

## 三、目录与产物对照

```
avclient/
├── build-win.ps1 / .bat   # Windows 一键构建脚本（产出 NSIS 安装包）
├── resources/
│   ├── python/            # 构建时由脚本填充：内嵌 python.exe + run_task.py + avcore + 已装依赖
│   └── bin/              # 构建时由脚本填充：ffmpeg.exe
├── src/                  # Electron 主进程 / preload / 渲染层
├── python/               # 后端源码（run_task.py + avcore）
├── dist/                 # 构建产物输出目录
└── package.json          # electron-builder 配置（win.nsis）
```

构建时 `resources/python` 与 `resources/bin` 通过 `extraResources` 被打进安装包，
`main.js` 在 Windows 打包态会自动定位 `resources/python/python.exe` 与 `resources/bin/ffmpeg.exe`，
实现**自包含、免环境配置**的安装体验。
