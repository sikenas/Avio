#!/usr/bin/env python3
"""AVClient 后端统一入口。

主进程（Electron main.js）以子进程方式调用本脚本：
    python run_task.py <subcommand> --json '<params-json>'

输出约定：每一行以 "AVJSON:" 开头的是结构化消息（JSON），其余为普通日志。
结构化消息格式： {"type":"progress"|"result"|"error"|"log", ...}
"""
import sys
import json
import traceback

# 确保本文件所在目录（python/）在 sys.path，便于 import avcore
sys.path.insert(0, os_path := __import__("os").path.dirname(__import__("os").path.abspath(__file__)))

from avcore import downloader, extractor, transcriber, qa, pipeline
from avcore.config import ffmpeg_path, DepError


def emit(type_: str, **kw):
    msg = {"type": type_, **kw}
    sys.stdout.write("AVJSON:" + json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(line: str):
    sys.stdout.write("[py] " + line + "\n")
    sys.stdout.flush()


def cmd_deps(params: dict):
    """依赖自检：返回各依赖可用状态。"""
    deps = {"ffmpeg": False, "whisper": False, "openai": False, "ffmpeg_path": ffmpeg_path()}
    # ffmpeg
    try:
        import subprocess
        r = subprocess.run([ffmpeg_path(), "-version"], capture_output=True, text=True, timeout=15)
        deps["ffmpeg"] = r.returncode == 0
    except Exception:
        deps["ffmpeg"] = False
    # faster-whisper
    try:
        __import__("faster_whisper")
        deps["whisper"] = True
    except Exception:
        deps["whisper"] = False
    # openai
    try:
        __import__("openai")
        deps["openai"] = True
    except Exception:
        deps["openai"] = False
    emit("result", stage="deps", deps=deps)
    return deps


def cmd_download(params: dict):
    downloader.download(
        url=params["url"], task_id=params.get("task_id", "task"),
        emit=emit, no_playlist=params.get("no_playlist", True),
        simulate=params.get("simulate", False),
    )


def cmd_extract(params: dict):
    extractor.extract(
        video_path=params["video_path"], emit=emit,
        fmt=params.get("fmt", "m4a"), make_mp3=params.get("make_mp3", False),
    )


def cmd_transcribe(params: dict):
    transcriber.transcribe(
        audio_path=params["audio_path"], emit=emit,
        model_size=params.get("model_size", "base"),
        language=params.get("language"),
    )


def cmd_install(params: dict):
    """安装 Python 依赖：给定 package 则装单个；否则按 requirements.txt 引导安装全部。

    该命令用于：
      1) Windows 安装包首次启动时的依赖自检/引导安装；
      2) 开发态手动补齐依赖（如 faster-whisper / openai）。
    """
    import subprocess
    import sys
    import os

    pkg = params.get("package")
    targets = [pkg] if pkg else []
    if not targets:
        # 未指定则安装 requirements.txt 全部（含 yt-dlp 及可选转写/问答依赖）
        req = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
        if os.path.exists(req):
            targets = ["-r", req]

    if not targets:
        emit("error", stage="install", msg="缺少 package 参数且未找到 requirements.txt")
        sys.exit(2)

    emit("progress", stage="install", pct=2, msg=f"开始安装依赖：{' '.join(targets)}")
    proc = subprocess.Popen(
        [sys.executable, "-m", "pip", "install", *targets],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    for line in proc.stdout:
        emit("progress", stage="install", pct=None, msg=line.strip()[:90])
    proc.wait()
    if proc.returncode == 0:
        emit("result", stage="install", targets=targets, ok=True)
    else:
        emit("error", stage="install", msg=f"安装失败（exit={proc.returncode}），请检查网络或镜像源")
        sys.exit(1)


def cmd_ask(params: dict):
    qa.ask(
        context=params["context"], question=params["question"], emit=emit,
        history=params.get("history"), api_key=params.get("api_key"),
        base_url=params.get("base_url"), model=params.get("model", "gpt-4o-mini"),
    )


def cmd_pipeline(params: dict):
    pipeline.run_pipeline(
        url=params["url"], task_id=params.get("task_id", "task"), emit=emit,
        no_playlist=params.get("no_playlist", True),
        make_mp3=params.get("make_mp3", False),
        transcribe=params.get("transcribe", False),
        whisper_model=params.get("whisper_model", "base"),
        language=params.get("language"),
    )


DISPATCH = {
    "deps": cmd_deps,
    "download": cmd_download,
    "extract": cmd_extract,
    "transcribe": cmd_transcribe,
    "ask": cmd_ask,
    "pipeline": cmd_pipeline,
    "install": cmd_install,
}


def main():
    if len(sys.argv) < 2:
        emit("error", msg="缺少子命令")
        sys.exit(2)
    sub = sys.argv[1]
    if sub not in DISPATCH:
        emit("error", msg=f"未知子命令: {sub}")
        sys.exit(2)

    # 解析 --json 参数
    params = {}
    for i, a in enumerate(sys.argv[2:]):
        if a == "--json" and i + 1 < len(sys.argv[2:]):
            try:
                params = json.loads(sys.argv[2:][i + 1])
            except Exception as e:
                emit("error", msg=f"参数 JSON 解析失败: {e}")
                sys.exit(2)

    try:
        DISPATCH[sub](params)
    except DepError as e:
        emit("error", stage=sub, msg=str(e))
        sys.exit(3)
    except Exception as e:
        emit("error", stage=sub, msg=f"{type(e).__name__}: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
