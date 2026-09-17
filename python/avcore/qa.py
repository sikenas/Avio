"""大模型问答模块（OpenAI 兼容 API）。

支持任意 OpenAI 兼容端点（OpenAI / 通义千问 / 文心 / 本地 Ollama 等）。
采用流式输出，逐字回传，便于界面边生成边渲染。
"""
import os

from .config import DepError


def ask(context: str, question: str, emit, history=None,
        api_key: str = None, base_url: str = None, model: str = "gpt-4o-mini") -> dict:
    """基于已构建的上下文（转写/翻译文本）回答用户问题。"""
    try:
        from openai import OpenAI
    except ImportError as e:  # noqa: F841
        raise DepError(
            "openai 未安装。请运行：pip install openai "
            "（或在本客户端“设置”中一键安装模型接入依赖）。"
        )

    key = api_key or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise DepError("未配置 API 凭证。请在“设置 → 模型接入”中填写 API Key。")

    client = OpenAI(api_key=key, base_url=base_url)

    system_prompt = (
        "你是一个严谨的助手，仅基于用户提供的【转录/翻译文本】回答，"
        "不要编造文本之外的内容。回答请尽量引用原文时间戳以便回溯。"
    )
    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history)
    messages.append({
        "role": "user",
        "content": f"【上下文内容】\n{context}\n\n【问题】{question}",
    })

    emit("progress", stage="ask", pct=5, msg="模型思考中…")
    stream = client.chat.completions.create(
        model=model, messages=messages, stream=True, temperature=0.3
    )

    answer = ""
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            answer += delta
            emit("progress", stage="ask", pct=None, msg=delta)

    emit("result", stage="ask", answer=answer)
    return {"answer": answer}
