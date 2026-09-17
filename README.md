# 音视频智能处理客户端（AVClient）

一款面向**非技术用户**的桌面客户端：把视频/音频一键完成 **下载 → 音轨分离 → Whisper 转写 → 大模型问答**。

> 当前一期：**Windows 安装包**。下载与音轨分离为真实可用链路；语音转写（Faster-Whisper）与问答（本地/云端大模型）为真实接口预留，安装后可在应用内按需启用。

## 技术架构
- **Electron**（渲染层 + 主进程）— 复用高保真原型 UI
- **Python 后端**（内嵌打包，免用户安装）— `yt-dlp` 下载、`ffmpeg` 音轨分离、`faster-whisper` 转写、大模型问答
- 安装包自包含：内嵌 Windows 版 Python 与 ffmpeg，安装后**无需用户单独配置环境**

## 云端构建（推荐）
本仓库已配置 GitHub Actions：推送到 `main` 或手动 `workflow_dispatch` 即会在 Windows runner 上自动产出安装包，并作为 **Artifact** 提供下载。

产物：`AVClient-Setup-0.1.0.exe`（在 Actions 页面对应任务的 Artifacts 中下载）。

## 本地构建（Windows）
见 [BUILD.md](./BUILD.md) — 本质上是运行 `build-win.ps1` 一键完成。

## 目录结构
```
src/            Electron 主进程 / 预加载 / 渲染层
python/         Python 后端（avcore 模块 + run_task.py 入口）
resources/      构建时填充的内嵌 Python / ffmpeg（.gitignore 排除）
build-win.ps1    Windows 一键构建脚本（CI 与本地共用）
```
