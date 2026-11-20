# 歌曲下载 (`echo-music-download` v2.3.0)

为 **EchoMusic (`>= 2.3.2`)** 打造的**全功能歌曲与歌单下载、单曲/批量/全局暂停取消任务引擎、纯 JS 标签与封面内嵌（ID3v2.3 / FLAC）、同名双语 `.lrc` 导出及灰歌解灰联动插件**。

---

## ✨ v2.3.0 核心升级

1. **全新防误操作 UI 架构与清晰视觉语义**
   - 保持 EchoMusic v2.3.x 原生 `PageScrollContainer` + `DetailPageSliverHeader` + `PageStickyHeader` + `CustomTabBar` 滚动吸顶架构，全面使用宿主主题 CSS 变量，完美适配浅色与深色模式。
   - 彻底去除重复触发器与高危「一键同步整张歌单」按钮，清晰区分**分段过滤页签**、**原生 Switch 开关**、**主/次操作按钮**与**危险操作样式**。
   - **安全选歌与确认弹窗**：在「选歌与歌单下载」页点击歌曲行仅勾选/取消勾选，底部常驻选歌操作栏实时汇总「已勾选 / 已在本地自动跳过 / 实际将下载」数量；批量下载 `>= 3` 首或整张歌单时强制弹出确认弹窗，支持「取消」「加入队列但先暂停」「确认开始下载」。
2. **完整的暂停 / 恢复 / 取消引擎（单曲 + 批量 + 全局）**
   - 完整支持 `queued / launching / downloading / tagging / paused / done / canceled / failed` 8 种任务状态，严格 FIFO 排队调度并按「进行中 → 已暂停 → 排队中 → 已结束」直观展示。
   - 原生流式下载引擎（`ctx.net.download`）直接调用 `handle.pause()` / `handle.resume()` / `handle.cancel()`，`aria2c` 降级通道支持 `--continue=true` 断点续传与安全进程终止。
   - **队列总控与批量管理**：支持「全部暂停」「全部继续」「全部取消（带确认弹窗）」，以及开启「批量管理」或勾选任务后吸底展示的「全选当前视图 / 反选 / 批量暂停 / 批量继续 / 批量取消 / 批量重试 / 批量删除」操作栏。
   - 手动取消的任务干净进入 `已取消` 状态（不再弹出误导性失败红框），应用重启后自动保留 `已暂停` 状态便于一键恢复。
3. **纯 JS 音频元数据与高清封面内嵌（ID3v2.3 & FLAC）**
   - **MP3 (`ID3v2.3`)**：自动将标题（`TIT2`）、歌手（`TPE1`）、专辑（`TALB`）、非同步歌词（`USLT`）及 480px 封面图（`APIC`）以标准 UTF-16LE / 二进制帧直接内嵌至 `.mp3` 头部。
   - **FLAC (`Vorbis Comment` + `Picture`)**：自动构建 Type 4 `VORBIS_COMMENT` 与 Type 6 `METADATA_BLOCK_PICTURE` 写入 `.flac` 文件头，100% 兼容桌面播放器与 EchoMusic 官方 `local-music` 插件。
4. **同名双语 `.lrc` 歌词导出与歌单增量归档**
   - 下载完成后自动在同级目录生成同名 `.lrc` 歌词文件，支持原文与中文翻译双语时间轴合并。
   - 支持读取登录账号的全量酷狗歌单（我喜欢 / 自建 / 收藏）及当前播放队列，支持按歌单名建子目录（`{playlist}/{filename}`）与自动跳过本地已下载歌曲。
5. **灰歌解灰联动与宿主任务面板同步**
   - 当酷狗官方接口因无版权或 VIP 限制无法返回下载地址时，自动联动 `echo-music-unblock`（或内置同曲异版/外部聚合兜底）完成下载。
   - 接入 EchoMusic 宿主全局任务面板（`ctx.tasks.register`），实时同步下载进度并提供快捷暂停、继续与取消操作。

---

## 📦 安装方式

在 EchoMusic **设置 ➔ 插件管理 ➔ 插件市场 ➔ 添加源** 中填入：

```text
https://github.com/xhd2005/echo-music-plugins
```

---

## 📄 许可证

GPL-3.0 License
