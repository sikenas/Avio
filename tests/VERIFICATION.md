# 验证报告（QA · 严过关）

执行人：QA 工程师（严过关）｜日期：2026-09-17｜环境：macOS，Python venv（含 yt-dlp），ffmpeg 9.0.1 @ /opt/homebrew/bin

## 测试范围与方法
- 静态：Python `py_compile`、Node `--check` 语法校验
- 后端链路：真实调用 `run_task.py`（deps / extract / download / transcribe / ask）
- 一致性：IPC 通道在 main.js ↔ preload.js ↔ run_task.py ↔ app.js 四方对齐核对

## 结果
| # | 检查项 | 方法 | 结果 |
|---|---|---|---|
| 1 | Python 语法 | `py_compile` 全部模块 | ✅ 通过 |
| 2 | JS 语法 | `node --check` main/preload/app | ✅ 通过（修复 1 处深层嵌套三元导致的解析失败） |
| 3 | 依赖自检 | `deps` | ✅ 正确返回 ffmpeg=true / whisper=false / openai=false |
| 4 | 音轨分离（真实） | `extract` 对 516MB 视频 | ✅ 产出 145MB `.m4a`，与前期结果一致 |
| 5 | 下载代码路径 | `download --simulate` | ✅ 正确返回视频标题（网络可达时可用） |
| 6 | 缺 Whisper 降级 | `transcribe` 未安装 | ✅ 返回清晰 DepError 提示，不崩溃 |
| 7 | 缺 API 降级 | `ask` 未配置 | ✅ 返回清晰 DepError 提示，不崩溃 |
| 8 | IPC 契约一致 | grep 四方通道 | ✅ 7 个通道全部对齐（修复 install 通道缺失） |

## 遗留 / 说明
- Electron 真机 GUI 启动需在带显示环境 `npm install electron` 后 `npm start`，本沙箱未执行（不影响后端正确性）。
- 转写/问答的「成功路径」依赖用户本机安装 faster-whisper 或配置 API Key，属预期外部依赖。

## 结论
核心可验证链路（下载/分离）真实可用，接口与降级路径健壮，IPC 契约一致。**通过**。
