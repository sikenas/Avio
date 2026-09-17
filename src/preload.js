// 预加载：以 contextBridge 安全暴露后端能力给渲染层
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("av", {
  // 各能力调用：返回 Promise，进度通过 onEvent 流式回传
  deps: (p) => ipcRenderer.invoke("av:deps", p),
  download: (p) => ipcRenderer.invoke("av:download", p),
  extract: (p) => ipcRenderer.invoke("av:extract", p),
  transcribe: (p) => ipcRenderer.invoke("av:transcribe", p),
  ask: (p) => ipcRenderer.invoke("av:ask", p),
  pipeline: (p) => ipcRenderer.invoke("av:pipeline", p),
  install: (p) => ipcRenderer.invoke("av:install", p),
  // 订阅后端事件流：{type:'progress'|'result'|'error'|'log', ...}
  onEvent: (cb) => {
    const listener = (_e, obj) => cb(obj);
    ipcRenderer.on("av:event", listener);
    return () => ipcRenderer.removeListener("av:event", listener);
  },
});
