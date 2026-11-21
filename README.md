# 歌曲下载 (`echo-music-download` v2.4.0)

为 **EchoMusic (`>= 2.3.2`)** 打造的**第一方原生极简风格歌曲与歌单下载插件**，提供单曲/批量/全局暂停取消任务引擎、纯 JS 标签与封面内嵌（ID3v2.3 / FLAC）、同名双语 `.lrc` 导出及灰歌解灰联动。

---

## ✨ v2.4.0 核心升级

1. **EchoMusic 第一方原生极简视觉重构（像素级对齐内置「音乐云盘 / 最近播放」）**
   - 顶栏采用 `DetailPageSliverHeader`（`expandedHeight: 176`，`collapsedHeight: 56`）搭配 **`ctx.cover.createThemedIconCoverUrl`** 动态主题自适应封面，并配齐 `#collapsed-actions` 折叠快捷操作。
   - 吸顶标签栏全面迁移至宿主原生下划线 **`Tabs` + `TabsList` + `TabsTrigger` + `TabsContent`**（极简双 Tab：**`正在下载`** / **`已下载`**），彻底消除未编译 Tailwind 类导致的白线与割裂胶囊块；右侧同一行直接集成 `SongSearchInput` 与 `批量管理` 按钮。
   - 全面采用 EchoMusic `surfaces.css` / `shapes.css` 原生变量与无边框清爽任务行（`--row-hover-bg` / `--row-selected-bg` / `--content-panel-bg` / `--border-subtle`），彻底去除重边框套娃卡片、冗余彩色徽章与已完成行的多余绿色进度条。
2. **原生侧滑 `Drawer` 选歌与设置 + 原生 `Dialog` / `Popconfirm` 确认**
   - **「从歌单批量添加」侧滑 `Drawer`**（`Drawer` + `DrawerHeader`）：支持切换「我的酷狗歌单」与「播放队列」、搜歌、两个原生 `Switch`（「按歌单建子文件夹」「自动跳过已下载」）；点击歌曲行仅勾选绝不误触下载，底部固定汇总「已选 X 首（跳过 Y 首，实际下载 Z 首）」。
   - **「下载与标签设置」侧滑 `Drawer`**：与插件设置面板（`ctx.ui.settings.define`）复用同一套轻量无框设置分组，不嵌套滚动容器或抽屉。
   - 批量下载 `>= 3` 首或整张歌单时弹出宿主原生 **`Dialog`** 二次确认（支持「取消」「先以暂停状态加入」「确认开始下载」）；批量/全部取消弹出原生 **`Dialog`** 确认；清空记录由宿主 **`Popconfirm`** 保护。
3. **完整的暂停 / 恢复 / 取消任务引擎（单曲 + 批量 + 全局）**
   - 完整支持 `queued / launching / downloading / tagging / paused / done / canceled / failed` 8 种状态，严格 FIFO 排队与并发槽位守恒；原生流式下载（`ctx.net.download`）直接支持断点暂停/恢复/取消，`aria2c` 降级通道支持 `--continue=true` 断点续传。
   - 「正在下载」页签内置极简透明动作条（实时聚合速率脉冲 + 状态快筛 + `全部暂停` / `全部继续` / `全部取消`），开启「批量管理」或勾选任务后吸底显现悬浮批量操作条。
4. **纯 JS 音频元数据、高清封面内嵌与双语 `.lrc` 导出**
   - **MP3 (`ID3v2.3`)**：自动写入标题（`TIT2`）、歌手（`TPE1`）、专辑（`TALB`）、非同步歌词（`USLT`）及 480px 封面（`APIC`）。
   - **FLAC (`Vorbis Comment` + `Picture`)**：自动写入 Type 4 与 Type 6 元数据块，兼容桌面播放器与 EchoMusic 本地音乐插件。
   - 自动在同级目录生成同名双语 `.lrc` 歌词文件，并支持灰歌/VIP 歌曲联动 `echo-music-unblock` 多源解灰下载与宿主全局任务面板同步。

---

## 📦 安装方式

在 EchoMusic **设置 ➔ 插件管理 ➔ 插件市场 ➔ 添加源** 中填入：

```text
https://github.com/xhd2005/echo-music-plugins
```

---

## 📄 许可证

GPL-3.0 License
