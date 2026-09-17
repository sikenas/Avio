// AVClient 主进程：窗口管理 + 派发 Python 后端 + IPC 转发进度
const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const isDev = !app.isPackaged;
const isWin = process.platform === "win32";

// 资源根目录：开发态用项目目录；打包态用 Electron 的 resources 目录
function resourceDir(sub) {
  if (isDev) return path.join(__dirname, "..", sub);
  return path.join(process.resourcesPath, sub);
}

// 解析 Python 解释器路径
// - 开发态：优先环境变量 AV_PYTHON，否则 python3
// - Windows 打包态：使用打包内嵌的 resources/python/python.exe（自包含，无需用户装 Python）
function resolvePython() {
  if (isDev) return process.env.AV_PYTHON || "python3";
  if (isWin) {
    const p = path.join(process.resourcesPath, "python", "python.exe");
    return fs.existsSync(p) ? p : "python";
  }
  return process.env.AV_PYTHON || "python3";
}

// 解析 ffmpeg 路径
// - 优先环境变量 AV_FFMPEG_PATH
// - Windows 打包态：使用 resources/bin/ffmpeg.exe
function resolveFfmpeg() {
  const fromEnv = process.env.AV_FFMPEG_PATH;
  if (fromEnv) return fromEnv;
  if (!isDev && isWin) {
    const p = path.join(process.resourcesPath, "bin", "ffmpeg.exe");
    if (fs.existsSync(p)) return p;
  }
  return "";
}

const PY_DIR = resourceDir("python");
const PYTHON = resolvePython();
const FFMPEG = resolveFfmpeg();
const WORKSPACE =
  process.env.AV_WORKSPACE || path.join(app.getPath("userData"), "workspace");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#F3F4F6",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

// 统一派发 Python 子进程
function runPython(sub, params, sender) {
  return new Promise((resolve, reject) => {
    const script = path.join(PY_DIR, "run_task.py");
    const args = [script, sub, "--json", JSON.stringify(params)];
    const env = {
      ...process.env,
      AV_FFMPEG_PATH: FFMPEG,
      AV_WORKSPACE: WORKSPACE,
      AV_PYTHON_BUNDLED: isDev ? "0" : isWin ? "1" : "0",
    };
    const p = spawn(PYTHON, args, { env });

    let buf = "";
    const flush = () => {
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.startsWith("AVJSON:")) {
          try {
            const obj = JSON.parse(line.slice(7));
            if (sender) sender.send("av:event", obj);
          } catch (_) { /* ignore malformed */ }
        }
      }
    };

    p.stdout.on("data", (d) => { buf += d.toString(); flush(); });
    p.stderr.on("data", (d) => {
      if (sender) sender.send("av:event", { type: "log", msg: d.toString() });
    });
    p.on("close", (code) => {
      flush();
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`后端进程退出码 ${code}`));
    });
    p.on("error", (err) => reject(err));
  });
}

// IPC 通道
function registerIpc() {
  const handlers = {
    "av:deps": (e, p) => runPython("deps", p || {}, e.sender),
    "av:download": (e, p) => runPython("download", p || {}, e.sender),
    "av:extract": (e, p) => runPython("extract", p || {}, e.sender),
    "av:transcribe": (e, p) => runPython("transcribe", p || {}, e.sender),
    "av:ask": (e, p) => runPython("ask", p || {}, e.sender),
    "av:pipeline": (e, p) => runPython("pipeline", p || {}, e.sender),
    "av:install": (e, p) => runPython("install", p || {}, e.sender),
  };
  for (const [ch, fn] of Object.entries(handlers)) {
    ipcMain.handle(ch, fn);
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
