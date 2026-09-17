# AVClient 架构设计文档（开发版）

> 本文件对应「软件开发团队」主理人（齐活林）流程中的 **架构师产出**，承接 PRD（`output/prd-avclient-20260917/stage3/...PRD.docx`）与高保真原型（`output/prd-avclient-20260917/prototype/index.html`）。

## 1. 技术栈决策
| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | **Electron**（一期先用） | 跨平台、可在本机（macOS）直接运行验证；最终通过 electron-builder 打包 Windows NSIS 安装包，满足一期「Windows 安装包」要求 |
| 渲染层 | 原生 HTML/CSS/JS + 复用高保真原型 UI | 保证与已确认设计 100% 一致，避免重画 |
| 后端能力 | **Python**（yt-dlp / ffmpeg / faster-whisper / OpenAI 兼容 SDK） | 复用你已验证的 `yt-dlp + ffmpeg` 真实管线 |
| 进程模型 | 主进程 spawn Python 子进程 + stdio JSON 事件流 | 解耦前端与重型依赖，便于按需安装 |

## 2. 数据流（核心）
```
渲染层 window.av.*  ──ipc──▶  主进程 ipcMain.handle
                               │ spawn
                               ▼
                     python run_task.py <cmd> --json '{...}'
                               │ stdout: "AVJSON:{json}\n"
                               ▼
                    主进程逐行解析 ──'av:event'──▶ 渲染层 onEvent
                                                       │
                                           进度条 / 实时日志 / 流式问答
```
结构化消息：`{"type":"progress"|"result"|"error"|"log", "stage":..., ...}`，主进程仅转发 `AVJSON:` 前缀行，普通日志走 stderr。

## 3. 模块与文件清单
```
avclient/
├── package.json            # Electron + electron-builder 配置（win.nsis 目标）
├── src/
│   ├── main.js             # 窗口、IPC 路由、派发 Python、事件转发
│   ├── preload.js          # contextBridge 安全暴露 window.av
│   └── renderer/
│       ├── index.html      # 四屏外壳（复用原型）
│       ├── styles.css      # 原型配色与三栏布局
│       └── app.js          # 界面逻辑 + 事件路由 + MockAV 回退
└── python/
    ├── run_task.py         # CLI 入口：子命令派发 + AVJSON 事件流
    ├── requirements.txt
    └── avcore/
        ├── config.py       # 路径解析、ffmpeg 定位（env→PATH→回退）
        ├── downloader.py   # yt-dlp 下载（含 simulate 自检）
        ├── extractor.py    # ffmpeg 音轨分离（copy / mp3）
        ├── transcriber.py  # faster-whisper 转写（懒加载）
        ├── qa.py           # OpenAI 兼容问答（流式）
        └── pipeline.py     # 下载→分离→转写→上下文 编排
```

## 4. IPC 契约（已对齐，通过一致性校验）
| 渲染层调用 | 主进程通道 | Python 子命令 |
|---|---|---|
| `av.deps()` | `av:deps` | `deps` |
| `av.download()` | `av:download` | `download` |
| `av.extract()` | `av:extract` | `extract` |
| `av.transcribe()` | `av:transcribe` | `transcribe` |
| `av.ask()` | `av:ask` | `ask` |
| `av.pipeline()` | `av:pipeline` | `pipeline` |
| `av.install()` | `av:install` | `install` |
| `av.onEvent(cb)` | `av:event`(→) | — |

## 5. 依赖安装策略（顺序门禁，对应 PRD 6.1 / 第 5 章）
① FFmpeg（系统级，PATH 或私有目录）→ ② Whisper 运行时（`pip install faster-whisper`）→ ③ 模型接入（云端 API Key 或本地引擎）。
前端向导严格按序解锁，前一步未完成则后一步按钮禁用。

## 6. 打包与发布
- 开发：`npm install` + Python venv + `npm start`
- 打包 Windows：`npm run dist` → `dist/AVClient-Setup-x.y.z.exe`（NSIS）
- 安装目录私有沙箱（`%LOCALAPPDATA%/AVClient`），卸载不污染系统

## 7. 一期已知边界（非阻塞）
- 转写/问答为真实接口，需用户本机安装 faster-whisper / 配置 API Key 后启用（沙箱内已验证「缺依赖时优雅报错」）。
- 错误态以日志红字 + 详情呈现，未单独建模错误弹窗。
- Electron 真机启动需在带显示环境 `npm install` 后执行，本沙箱仅完成后端链路与语法/契约验证。
