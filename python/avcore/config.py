"""运行时配置：路径解析与依赖定位。

设计目标：
- ffmpeg 优先用环境变量 AV_FFMPEG_PATH，其次 PATH 查找，最后回退常见路径
- 工作区默认落在用户目录下，便于 Electron 主进程传入覆盖
"""
import os
import shutil

# 工作区：存放下载/分离/转写产物。可由主进程通过 AV_WORKSPACE 覆盖。
WORKSPACE = os.environ.get(
    "AV_WORKSPACE",
    os.path.join(os.path.expanduser("~"), "AVClientWorkspace"),
)


def workspace() -> str:
    os.makedirs(WORKSPACE, exist_ok=True)
    return WORKSPACE


def ffmpeg_path() -> str:
    """返回可用的 ffmpeg 可执行文件路径。"""
    env = os.environ.get("AV_FFMPEG_PATH")
    if env:
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    # 常见回退路径
    for cand in (
        "/opt/homebrew/bin/ffmpeg",          # Apple 芯片 macOS
        "/usr/local/bin/ffmpeg",             # Intel macOS / 常见 Linux
        r"C:\Users\AppData\Local\AVClient\deps\ffmpeg\bin\ffmpeg.exe",  # Windows 安装目录
    ):
        if os.path.exists(cand):
            return cand
    return "ffmpeg"  # 最终交给系统报错，由上层捕获


class DepError(Exception):
    """依赖未满足（如未安装 faster-whisper / openai）。"""
