"""音轨分离模块（基于 ffmpeg）。

支持两种模式：
- copy：无损拷贝原始音轨（快，默认 .m4a）
- mp3 ：转码为 MP3（便于后续处理，默认 192k）
"""
import os
import subprocess

from .config import ffmpeg_path, DepError


def extract(video_path: str, emit, fmt: str = "m4a", make_mp3: bool = False) -> dict:
    """从视频中抽取音轨。返回输出文件路径。"""
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"视频文件不存在: {video_path}")

    base = os.path.splitext(video_path)[0]
    out_m4a = base + "." + fmt

    ff = ffmpeg_path()
    cmd = [ff, "-hide_banner", "-y", "-i", video_path, "-vn", "-acodec", "copy", out_m4a]

    emit("progress", stage="extract", pct=5, msg=f"开始分离音轨 → {os.path.basename(out_m4a)}")
    proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, text=True)
    for line in proc.stderr:
        if "time=" in line:
            emit("progress", stage="extract", pct=None, msg=line.strip()[:90])
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg 分离音轨失败（exit=%d）" % proc.returncode)

    result = {"audio_path": out_m4a}
    emit("progress", stage="extract", pct=100, msg="音轨分离完成")
    emit("result", stage="extract", audio_path=out_m4a)

    if make_mp3:
        out_mp3 = base + ".mp3"
        cmd2 = [ff, "-hide_banner", "-y", "-i", video_path, "-vn",
                "-acodec", "libmp3lame", "-b:a", "192k", out_mp3]
        p2 = subprocess.Popen(cmd2, stderr=subprocess.PIPE, text=True)
        p2.wait()
        if p2.returncode == 0:
            result["mp3_path"] = out_mp3
            emit("result", stage="extract_mp3", mp3_path=out_mp3)

    return result
