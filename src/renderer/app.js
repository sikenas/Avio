/* ============================================================
 * AVClient 渲染层逻辑
 * - Electron 下使用 window.av（preload 暴露的真实后端）
 * - 纯浏览器预览时使用内置 MockAV，保证界面可演示
 * ============================================================ */

const RealAV = window.av || null;
let eventSink = null;            // mock 模式下的事件出口
let activeAnswerEl = null;       // 当前正在流式写入的问答气泡

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------------- 后端抽象 ---------------- */
const AV = RealAV || {
  _emit(obj) { if (eventSink) eventSink(obj); },
  deps() {
    return new Promise((res) => {
      setTimeout(() => {
        this._emit({ type: "result", stage: "deps",
          deps: { ffmpeg: true, whisper: false, openai: false, ffmpeg_path: "（模拟）" } });
        res({ ok: true });
      }, 300);
    });
  },
  install(p) {
    return new Promise((res) => {
      const lines = ["[info] 模拟安装 " + p.package, "[ok] 完成（演示）"];
      let i = 0;
      const t = setInterval(() => {
        if (i < lines.length) { this._emit({ type: "progress", stage: "install", msg: lines[i++] }); }
        else { clearInterval(t); this._emit({ type: "result", stage: "install", package: p.package, ok: true }); res({ ok: true }); }
      }, 500);
    });
  },
  pipeline(p) {
    return new Promise((res) => {
      const stages = ["download", "extract"];
      let s = 0;
      const t = setInterval(() => {
        if (s < stages.length) {
          const st = stages[s++];
          this._emit({ type: "progress", stage: st, pct: Math.round((s / 2) * 100),
            msg: st === "download" ? "下载中…" : "分离中…" });
          this._emit({ type: "result", stage: st,
            video_path: st === "download" ? "video.mp4" : undefined,
            audio_path: st === "extract" ? "audio.m4a" : undefined });
        } else {
          clearInterval(t);
          this._emit({ type: "progress", stage: "context", pct: 100, msg: "上下文已构建" });
          res({ ok: true });
        }
      }, 900);
    });
  },
  ask(p) {
    return new Promise((res) => {
      const ans = "（模拟回答）基于上下文：「" + p.question.slice(0, 24) + "」的要点是……";
      let i = 0;
      const t = setInterval(() => {
        if (i < ans.length) { this._emit({ type: "progress", stage: "ask", msg: ans[i++] }); }
        else { clearInterval(t); this._emit({ type: "result", stage: "ask", answer: ans }); res({ ok: true }); }
      }, 35);
    });
  },
};

/* ---------------- 状态 ---------------- */
let tasks = [
  { id: "ep01", title: "清华大模型公开课 EP01·大模型绪论", sub: "123 分钟 · 1080P · 516MB",
    status: "done", badge: "已完成", state: "b-done",
    context: "（示例上下文）本讲围绕大模型基础范式展开，讨论规模定律、注意力机制与预训练对齐路线。" },
  { id: "mtg", title: "会议录音_2026Q3.mp4", sub: "本地文件 · 待处理",
    status: "wait", badge: "待处理", state: "b-wait", context: "" },
];
let qaTab = "chat";
let currentTaskId = null;

/* ---------------- 事件路由 ---------------- */
function handleEvent(obj) {
  if (!obj) return;
  if (obj.type === "result" && obj.stage === "deps") { applyDeps(obj.deps); return; }
  if (obj.type === "error") {
    appendLog("[错误] " + (obj.msg || ""), "err");
    if (activeAnswerEl) { activeAnswerEl.innerHTML = '<span class="err">调用失败：' + escapeHtml(obj.msg || "") + "</span>"; activeAnswerEl = null; }
    return;
  }
  if (obj.type === "progress") {
    if (obj.stage === "ask") {
      if (activeAnswerEl) { activeAnswerEl.textContent += (obj.msg || ""); const c = document.getElementById("chatBody"); if (c) c.scrollTop = c.scrollHeight; }
      return;
    }
    const pct = obj.pct != null ? " [" + obj.pct + "%]" : "";
    appendLog("[" + obj.stage + "]" + pct + " " + (obj.msg || ""),
      (obj.stage === "extract" || obj.stage === "download") ? "ok" : "info");
    if (obj.stage === "download" && obj.pct != null) {
      const b = document.getElementById("liveBar"); if (b) b.style.width = obj.pct + "%";
      const p = document.getElementById("livePct"); if (p) p.textContent = obj.pct + "%";
    }
    return;
  }
  if (obj.type === "result") {
    if (obj.stage === "ask") { activeAnswerEl = null; return; }
    if (obj.stage === "download") appendLog("[download] 视频已保存: " + escapeHtml(obj.video_path || obj.title || ""), "ok");
    if (obj.stage === "extract") appendLog("[extract] 音轨已保存: " + escapeHtml(obj.audio_path || ""), "ok");
    if (obj.stage === "install") appendLog("[install] " + escapeHtml(obj.package || "") + " 安装完成", "ok");
  }
  if (obj.type === "log") appendLog(obj.msg || "", "info");
}

function applyDeps(d) {
  setDep("ff", !!d.ffmpeg);
  setDep("wh", !!d.whisper);
  setDep("md", !!d.openai);
}
function refreshDeps() { AV.deps(); }

/* ---------------- 通用 UI ---------------- */
function syncNav(s) { document.querySelectorAll("#protoNav button").forEach(b => b.classList.toggle("active", b.dataset.screen === s)); }
function showScreen(s) {
  syncNav(s);
  if (s === "wizard") renderWizard();
  else if (s === "processing") { const t = tasks.find(x => x.status === "run") || tasks[0]; selectTask(t.id); }
  else if (s === "qa") { const t = tasks.find(x => x.status === "done") || tasks[0]; selectTask(t.id); }
  else if (s === "settings") renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll("#protoNav button").forEach(b => b.onclick = () => showScreen(b.dataset.screen));

function setDeps(ff, wh, md) {
  const cls = (ok) => ok ? "" : "warn";
  document.getElementById("pillFF").className = "pill " + cls(ff);
  document.getElementById("pillWH").className = "pill " + cls(wh);
  document.getElementById("pillMD").className = "pill " + cls(md);
}
function setDep(k, ok) {
  const map = { ff: "pillFF", wh: "pillWH", md: "pillMD" };
  document.getElementById(map[k]).className = "pill " + (ok ? "" : "warn");
}

function renderTasks(activeId) {
  const el = document.getElementById("taskList");
  el.innerHTML = tasks.map(t => `
    <div class="task ${t.id === activeId ? "active" : ""}" onclick="selectTask('${t.id}')">
      <div class="t1"><span class="badge ${t.state}">${t.badge}</span></div>
      <div class="t1" style="margin-top:6px">${escapeHtml(t.title)}</div>
      <div class="t2">${escapeHtml(t.sub)}</div>
    </div>`).join("");
  document.getElementById("taskCount").textContent = "共 " + tasks.length + " 个任务";
}

/* ---------------- ① 安装向导 ---------------- */
function renderWizard() {
  setDeps(false, false, false);
  document.getElementById("bcStage").textContent = "安装引导";
  document.getElementById("bcSub").textContent = "依赖安装（FFmpeg→Whisper→模型接入）";
  document.getElementById("chTitle").textContent = "欢迎使用 · 依赖安装向导";
  document.getElementById("chMeta").textContent = "首次启动需按顺序安装运行依赖";
  const deps = [
    { n: 1, k: "ff", t: "FFmpeg", d: "视频下载与音视频分离（抽取音轨）的基础组件。", st: "none", stxt: "待校验" },
    { n: 2, k: "wh", t: "Whisper 语音模型", d: "基于 Faster-Whisper 的语音转写引擎，音轨→文本。", st: "none", stxt: "待安装", locked: true },
    { n: 3, k: "md", t: "模型接入配置", d: "云端大模型 API 凭证或本地推理引擎，用于后续问答。", st: "none", stxt: "待安装", locked: true },
  ];
  let html = `<div class="wizard"><div class="card"><h3>🧰 依赖安装向导</h3>
    <p class="muted">严格按工作流顺序安装：<b>① FFmpeg</b> → <b>② Whisper</b> → <b>③ 模型接入</b>。前一步未完成，后一步不可开始。</p>
    <div style="margin-top:14px">${deps.map(d => `
      <div class="w-step ${d.st === "ok" ? "done" : (d.st === "run" ? "active" : "locked")}" id="wstep-${d.k}">
        <div class="w-num">${d.n}</div>
        <div class="w-main">
          <div class="t">${d.t} <span class="state-tag ${d.st === "ok" ? "st-ok" : (d.st === "run" ? "st-run" : "st-none")}" id="wst-${d.k}">${d.stxt}</span></div>
          <div class="d">${d.d}</div>
          <div class="log" id="wlog-${d.k}"></div>
        </div>
        <div class="w-action">
          ${d.st === "ok" ? `<span class="state-tag st-ok">✓ 完成</span>`
            : `<button class="btn primary" id="wbtn-${d.k}" ${d.locked ? "disabled" : ""} onclick="installDep('${d.k}',${d.n})">安装</button>
               <div class="progress"><i id="wpr-${d.k}"></i></div>`}
        </div>
      </div>`).join("")}</div>
    <div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="showScreen('processing')">稍后安装</button>
      <button class="btn primary" onclick="showScreen('processing')">进入主界面 →</button>
    </div></div></div>`;
  document.getElementById("centerBody").innerHTML = html;
  document.getElementById("rightBody").innerHTML = rightContext("ep01");
  refreshDeps();
}

function installDep(k, n) {
  const step = document.getElementById("wstep-" + k);
  const btn = document.getElementById("wbtn-" + k);
  const st = document.getElementById("wst-" + k);
  const logEl = document.getElementById("wlog-" + k);
  step.classList.remove("locked"); step.classList.add("active");
  if (btn) { btn.disabled = true; btn.textContent = "安装中…"; }
  st.className = "state-tag st-run"; st.textContent = "安装中…";
  logEl.classList.add("show"); logEl.innerHTML = "";
  const pkgMap = { ff: null, wh: "faster-whisper", md: "openai" };
  const finish = () => {
    step.classList.remove("active"); step.classList.add("done");
    st.className = "state-tag st-ok"; st.textContent = (k === "ff" ? "已安装 v7.x" : "已就绪");
    if (btn) btn.outerHTML = '<span class="state-tag st-ok">✓ 完成</span>';
    setDep(k, true);
    const next = { ff: "wh", wh: "md" }[k];
    if (next) { const ns = document.getElementById("wstep-" + next); if (ns) ns.classList.remove("locked");
      const nb = document.getElementById("wbtn-" + next); if (nb) nb.disabled = false; }
  };
  if (k === "ff") {
    setTimeout(() => { logEl.innerHTML += '<div class="info">[info] ffmpeg 已在系统中可用，无需安装</div>'; finish(); }, 600);
    return;
  }
  AV.install({ package: pkgMap[k] }).then(finish)
    .catch(e => { st.className = "state-tag st-err"; st.textContent = "失败";
      logEl.innerHTML += '<div class="err">' + escapeHtml(e.message || e) + "</div>"; });
}

/* ---------------- ② 工作区 ---------------- */
function selectTask(id) {
  currentTaskId = id;
  const t = tasks.find(x => x.id === id);
  renderTasks(id);
  if (t.status === "done") { syncNav("qa"); return renderQA(id); }
  if (t.status === "wait") { syncNav("processing"); return renderWait(id); }
  syncNav("processing"); return renderProcessing(id);
}

function pstepClass(s) {
  if (s.done) return "done";
  if (s.active) return "active";
  if (s.pending) return "pending";
  return "";
}
function pnodeMark(s) {
  if (s.done) return "\u2713";
  if (s.active) return "\u25cf";
  if (s.pending) return "\u25cb";
  return "";
}
function ptagHtml(s) {
  if (s.done) return '<span class="ptag b-done">\u5df2\u5b8c\u6210</span>';
  if (s.active) return '<span class="ptag b-run">\u9032\u884c\u4e2d</span>';
  if (s.pending) return '<span class="ptag b-wait">\u7b49\u5f85\u4e2d</span>';
  return "";
}
function renderProcessing(id) {
  const t = tasks.find(x => x.id === id);
  document.getElementById("bcStage").textContent = "\u5185\u5bb9\u5904\u7406";
  document.getElementById("bcSub").textContent = "\u81ea\u52a8\u6d41\u6c34\u7ebf";
  setDeps(true, true, true);
  document.getElementById("chTitle").textContent = t.title;
  document.getElementById("chMeta").textContent = t.sub;
  const steps = [
    { k: "dl", t: "\u4e0b\u8f7d\u89c6\u9891", d: "FFmpeg / yt-dlp \u62c9\u53d6\u89c6\u9891\u6d41\u4e0e\u97f3\u8f68", done: t.status !== "wait" },
    { k: "sep", t: "\u97f3\u9891\u5206\u79bb", d: "FFmpeg \u62bd\u53d6\u72ec\u7acb\u97f3\u8f68\uff08\u65e0\u635f\u62f7\u8d1d\uff09", done: t.status === "done" },
    { k: "tr", t: "\u8bed\u97f3\u8f6c\u5199", d: "Faster-Whisper \u97f3\u8f68\u2192\u5e26\u65f6\u95f4\u6233\u6587\u672c\uff08\u9700\u5b89\u88c5\uff09", done: false, active: t.status === "run" },
    { k: "tx", t: "\u7ffb\u8bd1\u4e0e\u4e0a\u4e0b\u6587\u6784\u5efa", d: "\u8bd1\u6587\u5bf9\u9f50 + \u7ae0\u8282\u7ed3\u6784\u6574\u7406\uff0c\u6ce8\u5165\u6a21\u578b", pending: true },
  ];
  const stepHtml = steps.map(s => `
        <div class="pstep ${pstepClass(s)}">
          <div class="pnode">${pnodeMark(s)}</div>
          <div class="pbody">
            <div class="pt">${s.t} ${ptagHtml(s)}</div>
            <div class="pd">${s.d}</div>
            ${s.active ? `<div class="pbar"><i id="liveBar" style="width:10%"></i></div><div class="muted" style="margin-top:5px" id="livePct">10% \u00b7 \u5904\u7406\u4e2d</div>` : ""}
          </div></div>`).join("");
  document.getElementById("centerBody").innerHTML = `
    <div class="card"><h3>\u2699 \u81ea\u52a8\u5904\u7406\u6d41\u6c34\u7ebf</h3>
      <p class="muted">\u4e0b\u8f7d \u2192 \u5206\u79bb \u2192 \u8f6c\u5199 \u2192 \u7ffb\u8bd1\u6784\u5efa\u4e0a\u4e0b\u6587\uff0c\u5168\u7a0b\u540e\u53f0\u8fd0\u884c\uff08PRD 6.2\u20136.5\uff09\u3002</p>
      <div class="pipe" style="margin-top:14px">${stepHtml}</div></div>
    <div class="card"><h3>\ud83d\udcc3 \u5b9e\u65f6\u65e5\u5fd7</h3>
      <div class="terminal" id="term"><div class="info">[00:00] \u4efb\u52a1\u542f\u52a8\uff1a${escapeHtml(t.title)}</div></div></div>`;
  document.getElementById("rightBody").innerHTML = rightContext(id);
}


function renderWait(id) {
  const t = tasks.find(x => x.id === id);
  document.getElementById("bcStage").textContent = "内容处理";
  document.getElementById("bcSub").textContent = "待开始";
  setDeps(true, true, true);
  document.getElementById("chTitle").textContent = t.title;
  document.getElementById("chMeta").textContent = t.sub;
  document.getElementById("centerBody").innerHTML = `
    <div class="card"><h3>📥 新建任务</h3>
      <p class="muted">粘贴视频链接，点击「开始处理」即触发完整流水线（PRD 6.2 / 14.2）。</p>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <input class="inp" id="urlIn" style="width:440px" placeholder="https://www.bilibili.com/video/BV1..." />
        <button class="btn primary" onclick="startPipeline(document.getElementById('urlIn').value)">开始处理 →</button>
      </div>
      <div class="muted" style="margin-top:12px">或 <a style="color:var(--accent);cursor:pointer" onclick="alert('选择本地文件')">选择本地视频文件</a> · 支持合集（播放列表）</div>
    </div>
    <div class="card"><h3>⚙ 处理选项</h3>
      <div class="set-row"><div><div class="l">清晰度</div><div class="s">受平台与登录态限制，未登录取公开最高档</div></div>
        <div class="seg"><button class="on">1080P 标准</button><button>1080P 高码率(会员)</button><button>720P</button></div></div>
      <div class="set-row"><div><div class="l">音频分离模式</div><div class="s">无损拷贝更快；转码 MP3 便于后续处理</div></div>
        <div class="seg"><button class="on">无损拷贝</button><button>转码 MP3</button></div></div>
      <div class="set-row"><div><div class="l">目标语言（翻译）</div><div class="s">转写后可译为指定语言再注入上下文</div></div>
        <div class="seg"><button class="on">保持原文</button><button>译中文</button><button>译英文</button></div></div>
    </div>`;
  document.getElementById("rightBody").innerHTML = rightContext(id);
}

function startPipeline(url) {
  if (!url || !url.trim()) { alert("请先粘贴视频链接"); return; }
  const id = "t" + Date.now();
  const t = { id, title: url.trim().slice(0, 46), sub: "处理中…", status: "run", badge: "处理中", state: "b-run", context: "" };
  tasks.unshift(t); renderTasks(id); selectTask(id);
  AV.pipeline({ url: url.trim(), task_id: id, transcribe: false, make_mp3: false })
    .then(() => {
      t.status = "done"; t.badge = "已完成"; t.state = "b-done";
      t.sub = "已处理 · 可问答"; t.context = "（流水线已完成下载与音轨分离；转写/问答需在设置中启用）";
      renderTasks(id); appendLog("[pipeline] 处理完成", "ok");
    })
    .catch(e => appendLog("[错误] " + (e.message || e), "err"));
}

function addTaskPrompt() { showScreen("processing"); const t = tasks.find(x => x.status === "wait") || tasks[0]; selectTask(t.id); }

/* ---------------- ③ 问答 ---------------- */
function renderQA(id) {
  const t = tasks.find(x => x.id === id) || tasks[0];
  document.getElementById("bcStage").textContent = "内容处理";
  document.getElementById("bcSub").textContent = "问答与任务";
  setDeps(true, true, true);
  document.getElementById("chTitle").textContent = t.title;
  document.getElementById("chMeta").textContent = t.context ? "上下文已构建 · 可开始提问" : "暂无上下文，请先完成处理";
  document.getElementById("centerBody").innerHTML = `
    <div class="qa-tabs">
      <button class="${qaTab === "chat" ? "active" : ""}" onclick="switchQATab('chat')">💬 对话问答</button>
      <button class="${qaTab === "text" ? "active" : ""}" onclick="switchQATab('text')">📝 转写文本</button>
    </div>
    <div id="qaView"></div>`;
  document.getElementById("rightBody").innerHTML = rightContext(id);
  renderQAView();
}
function switchQATab(tab) {
  qaTab = tab; renderQAView();
  document.querySelectorAll(".qa-tabs button").forEach(b =>
    b.classList.toggle("active", (b.textContent.includes("对话") && tab === "chat") || (b.textContent.includes("转写") && tab === "text")));
}
function renderQAView() {
  if (qaTab === "chat") {
    document.getElementById("qaView").innerHTML = `
      <div class="task-chips">
        <span class="chip" onclick="quickQA(this)">这一讲的核心观点？</span>
        <span class="chip" onclick="quickQA(this)">提炼 5 个待办</span>
        <span class="chip" onclick="quickQA(this)">生成段落摘要</span>
        <span class="chip" onclick="quickQA(this)">译全文为英文</span>
      </div>
      <div class="chat"><div class="chat-body" id="chatBody">
        <div class="msg bot"><div class="av">AI</div><div class="bubble">已基于本任务上下文构建。你可以提问，或下发结构化任务（摘要 / 待办 / 翻译）。<br><span class="muted" style="font-size:11.5px">真实模式下，回答来自已接入的大模型并关联时间戳。</span></div></div>
      </div>
      <div class="chat-input">
        <input id="qaInp" placeholder="基于本任务内容提问，或下发任务（摘要/待办/翻译）…" onkeydown="if(event.key==='Enter')sendQA()" />
        <button class="btn primary" onclick="sendQA()">发送</button>
      </div></div>`;
  } else {
    document.getElementById("qaView").innerHTML = `
      <div class="card" style="margin:0"><h3>📝 转写文本（带时间戳 · 可复制/导出）</h3>
        <div class="txt-snip"><p class="muted">转写需要在「设置」中安装 Whisper 运行时后运行流水线生成。当前为示例片段。</p>
          <p><b>[00:12:34]</b> 规模定律被认为是能力提升最稳定的主线……</p>
          <p><b>[00:31:08]</b> 注意力机制使模型动态聚焦关键输入，是后续架构演化的基础。</p></div>
        <div style="margin-top:10px;display:flex;gap:8px"><button class="btn">复制全文</button><button class="btn">导出 SRT 字幕</button><button class="btn">导出纯文本</button></div>
      </div>`;
  }
}
function quickQA(el) { const inp = document.getElementById("qaInp"); if (inp) { inp.value = el.textContent; sendQA(); } }
function sendQA() {
  const inp = document.getElementById("qaInp"); const v = inp.value.trim(); if (!v) return;
  const body = document.getElementById("chatBody");
  body.innerHTML += `<div class="msg user"><div class="av">我</div><div class="bubble">${escapeHtml(v)}</div></div>`;
  body.innerHTML += `<div class="msg bot" id="bot${Date.now()}"><div class="av">AI</div><div class="bubble"></div></div>`;
  // 取得刚插入的 bot 气泡
  activeAnswerEl = body.lastElementChild.querySelector(".bubble");
  const t = tasks.find(x => x.id === currentTaskId) || tasks[0];
  AV.ask({ context: t.context || "（暂无上下文）", question: v })
    .then(() => {})
    .catch(e => { if (activeAnswerEl) activeAnswerEl.innerHTML = '<span class="err">调用失败：' + escapeHtml(e.message || e) + "</span>"; activeAnswerEl = null; });
  inp.value = ""; body.scrollTop = body.scrollHeight;
}

/* ---------------- ④ 设置 ---------------- */
function renderSettings() {
  document.getElementById("bcStage").textContent = "设置";
  document.getElementById("bcSub").textContent = "依赖 / 模型 / 隐私";
  setDeps(true, true, true);
  document.getElementById("chTitle").textContent = "设置";
  document.getElementById("chMeta").textContent = "集中管理依赖、模型与隐私偏好（PRD 6.7）";
  document.getElementById("centerBody").innerHTML = `
    <div class="card"><h3>🧰 依赖与目录</h3>
      <div class="set-row"><div><div class="l">依赖安装目录</div><div class="s">私有沙箱目录，卸载时整体清理，不污染系统</div></div><input class="inp" value="C:\\Users\\Me\\AppData\\Local\\AVClient\\deps" readonly></div>
      <div class="set-row"><div><div class="l">FFmpeg</div><div class="s">视频下载 + 音视频分离</div></div><span class="badge b-done">已安装</span></div>
      <div class="set-row"><div><div class="l">Whisper 引擎</div><div class="s">默认 Faster-Whisper，低配回退 Whisper.cpp</div></div><span class="badge b-done">可安装</span></div>
      <div class="set-row"><div><div class="l">Whisper 模型尺寸</div><div class="s">精度与速度权衡，默认中档</div></div>
        <div class="seg" id="segWhisper"><button>tiny</button><button>base</button><button class="on">small</button><button>medium</button><button>large</button></div></div>
    </div>
    <div class="card"><h3>🤖 模型接入</h3>
      <div class="set-row"><div><div class="l">接入方式</div><div class="s">云端 API 开箱即用；本地模型保隐私</div></div>
        <div class="seg"><button class="on" onclick="toggleMode(this,'cloud')">云端 API</button><button onclick="toggleMode(this,'local')">本地模型</button></div></div>
      <div class="set-row"><div><div class="l">API 凭证</div><div class="s">本地加密存储，不上传第三方</div></div><input class="inp" type="password" id="apiKey" placeholder="sk-... 或本地引擎地址"></div>
      <div class="set-row"><div><div class="l">模型</div><div class="s">可保存多组配置按任务切换</div></div><input class="inp" value="gpt-4o / 通义千问 / 文心一言"></div>
    </div>
    <div class="card"><h3>🔒 隐私与个性化</h3>
      <div class="set-row"><div><div class="l">默认本地优先</div><div class="s">敏感内容默认走本地模型，数据不出本机</div></div><div class="switch on" onclick="this.classList.toggle('on')"><i></i></div></div>
      <div class="set-row"><div><div class="l">默认清晰度</div><div class="s">新建任务时的默认档位</div></div><div class="seg"><button class="on">1080P 标准</button><button>720P</button></div></div>
      <div class="set-row"><div><div class="l">界面语言</div><div class="s">中文 / English</div></div><div class="seg"><button class="on">简体中文</button><button>English</button></div></div>
    </div>`;
  document.getElementById("rightBody").innerHTML = rightContext("ep01");
}
function toggleMode(btn) { const seg = btn.closest(".seg"); seg.querySelectorAll("button").forEach(b => b.classList.remove("on")); btn.classList.add("on"); }

/* ---------------- 右侧上下文 ---------------- */
function rightContext(id) {
  const t = tasks.find(x => x.id === id);
  if (!t || !t.context) return `<div class="ctx-card"><h4><span class="dot"></span>暂无上下文</h4><div class="muted">任务处理完成后，此处展示翻译文本与章节结构。</div></div>`;
  return `
    <div class="ctx-card"><h4><span class="dot"></span>章节结构（自动）</h4><ul class="toc">
      <li><span class="ts">00:00</span> 课程引言与大纲</li>
      <li><span class="ts">00:12:34</span> 规模定律与能力增长</li>
      <li><span class="ts">00:31:08</span> 注意力机制三要素</li>
      <li><span class="ts">01:02:50</span> 预训练与对齐路线</li></ul></div>
    <div class="ctx-card"><h4><span class="dot"></span>翻译/整理文本（片段）</h4><div class="txt-snip">
      <p><span class="hl">[00:12:34]</span> 规模定律仍是能力提升最稳定的主线，参数、数据、算力的协同扩展带来涌现能力。</p>
      <p><span class="hl">[00:31:08]</span> 注意力机制使模型动态聚焦关键输入，是后续架构演化的基础。</p></div></div>
    <div class="ctx-card"><h4><span class="dot"></span>上下文状态</h4><div class="kv">
      注入模型：<b>已注入</b><br>来源：<b>转写 + 翻译</b><br>模式：<b>云端 API（可切本地）</b></div></div>`;
}

/* ---------------- 日志工具 ---------------- */
function appendLog(text, cls) {
  const term = document.getElementById("term");
  if (term && term.offsetParent !== null) {
    term.innerHTML += `<div class="${cls || "info"}">${escapeHtml(text)}</div>`;
    term.scrollTop = term.scrollHeight; return;
  }
  ["ff", "wh", "md"].forEach(k => {
    const el = document.getElementById("wlog-" + k);
    if (el && el.classList.contains("show")) {
      el.innerHTML += `<div class="${cls || "info"}">${escapeHtml(text)}</div>`;
      el.scrollTop = el.scrollHeight;
    }
  });
}

/* ---------------- 初始化 ---------------- */
function init() {
  if (RealAV) { RealAV.onEvent(handleEvent); }
  else { eventSink = handleEvent; }
  renderWizard();
  refreshDeps();
}
init();
