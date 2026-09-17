"""视频下载模块（基于 yt-dlp）。

对外暴露 download()，通过 emit 回调上报进度与结果，便于 Electron 主进程流式转发到渲染层。
"""
import os
import yt_dlp

from .config import ffmpeg_path, workspace


def _progress_hook_factory(emit):
    def hook(d: dict):
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            pct = round(downloaded / total * 100) if total else 0
            fname = d.get("info_dict", {}).get("_filename", "")
            emit("progress", stage="download", pct=pct, msg=os.path.basename(fname))
        elif status == "finished":
            emit("progress", stage="download", pct=100, msg="下载完成，开始合并音视频")
    return hook


def download(url: str, task_id: str, emit, no_playlist: bool = True, simulate: bool = False) -> dict:
    """下载视频（默认仅第 1 集），返回产物信息。

    simulate=True 时不真正下载，仅校验链接可访问（用于自检测试）。
    """
    out_dir = os.path.join(workspace(), task_id)
    os.makedirs(out_dir, exist_ok=True)
    outtmpl = os.path.join(out_dir, "%(playlist_index)s_%(title)s.%(ext)s")

    ffmpeg_dir = os.path.dirname(ffmpeg_path()) or None

    ydl_opts = {
        "outtmpl": outtmpl,
        "noplaylist": no_playlist,
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "ffmpeg_location": ffmpeg_dir,
        "progress_hooks": [_progress_hook_factory(emit)],
        "quiet": True,
        "noprogress": True,
        "simulate": simulate,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=not simulate)

    if simulate:
        title = info.get("title", "simulated")
        emit("result", stage="download", simulated=True, title=title)
        return {"simulated": True, "title": title}

    # 合并后通常产生 .mp4；兜底查找目录内最新视频文件
    candidates = []
    for f in os.listdir(out_dir):
        if f.lower().endswith((".mp4", ".mkv", ".mov", ".webm")):
            candidates.append(os.path.join(out_dir, f))
    video_path = sorted(candidates, key=os.path.getmtime)[-1] if candidates else None

    emit("result", stage="download", video_path=video_path, title=info.get("title", ""))
    return {"video_path": video_path, "title": info.get("title", "")}
