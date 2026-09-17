"""语音转写模块（基于 faster-whisper）。

采用懒加载：仅在实际转写时才 import faster_whisper，因此未安装该依赖时
不影响下载/分离等核心功能（符合 MVP“真实接口预留”的设计）。
"""
import os

from .config import DepError


def transcribe(audio_path: str, emit, model_size: str = "base", language: str = None) -> dict:
    """将音轨转写为带时间戳的文本。返回 {text, segments}。"""
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError(f"音频文件不存在: {audio_path}")

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # noqa: F841
        raise DepError(
            "faster-whisper 未安装。请运行：pip install faster-whisper "
            "（或在本客户端“设置”中一键安装 Whisper 运行时）。"
        )

    emit("progress", stage="transcribe", pct=2, msg=f"加载模型 {model_size} …")
    model = WhisperModel(model_size, device="auto", compute_type="auto")

    segments, info = model.transcribe(
        audio_path, language=language, beam_size=5, vad_filter=True
    )

    collected = []
    for seg in segments:
        collected.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        # 流式回传，便于界面实时滚动
        emit("progress", stage="transcribe", pct=None, msg=seg.text.strip()[:60])

    full_text = " ".join(s["text"] for s in collected)
    emit("result", stage="transcribe", text=full_text, segments=collected,
         language=getattr(info, "language", None))
    return {"text": full_text, "segments": collected}
