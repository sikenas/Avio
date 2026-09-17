"""avcore: 音视频智能处理客户端后端核心包。

职责：
- downloader   视频下载（yt-dlp）
- extractor    音轨分离（ffmpeg）
- transcriber  语音转写（faster-whisper，按需安装）
- qa           大模型问答（OpenAI 兼容 API，按需配置）
- pipeline     任务编排
- config       路径与运行时配置
"""

__version__ = "0.1.0"
