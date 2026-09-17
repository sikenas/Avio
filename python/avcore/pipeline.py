"""任务编排：把下载 → 分离 → 转写 → 构建上下文串成一条流水线。

每个阶段通过 emit 回报进度；任一阶段失败会抛出，由 run_task 统一捕获。
"""
from . import downloader, extractor, transcriber


def run_pipeline(url: str, task_id: str, emit,
                 no_playlist: bool = True,
                 make_mp3: bool = False,
                 transcribe: bool = False,
                 whisper_model: str = "base",
                 language: str = None) -> dict:
    """执行完整流水线，返回各阶段产物。"""
    result = {}

    # 1) 下载
    d = downloader.download(url, task_id, emit, no_playlist=no_playlist)
    result["download"] = d
    video_path = d.get("video_path")
    if not video_path:
        return result  # simulate 或无产物时提前结束

    # 2) 分离
    e = extractor.extract(video_path, emit, make_mp3=make_mp3)
    result["extract"] = e
    audio_path = e.get("audio_path")

    # 3) 转写（可选，需要 faster-whisper）
    if transcribe and audio_path:
        t = transcriber.transcribe(audio_path, emit, model_size=whisper_model, language=language)
        result["transcribe"] = t

    # 4) 上下文构建（此处仅标记成功；结构化整理在更上层完成）
    emit("progress", stage="context", pct=100, msg="上下文已构建，可开始问答")
    result["context_ready"] = True
    return result
