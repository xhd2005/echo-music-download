# 歌曲下载 (`echo-music-download` v2.4.5)

为 **EchoMusic (`>= 2.3.2`)** 打造的**第一方原生极简风格歌曲与歌单下载插件**，提供单曲/批量/全局暂停取消任务引擎、纯 JS 标签与封面内嵌（ID3v2.3 / FLAC）、同名双语 `.lrc` 导出及灰歌解灰联动。

---

## ✨ v2.4.5 终极根治修复（Vue 3 Reactive Proxy 句柄比较 Bug）

- **彻底根除「本地瞬间已下载完成，但界面进度条永远卡在『连接服务器…』」**：
  - 根因定位：原代码将 `DownloadHandle` 挂载在 Vue 3 `reactive()` 任务对象属性 `task._handle` 上，Vue 3 会将其自动包装为 `Proxy(handle)`，导致回调中 `task._handle !== handle` **恒为 `true`**，所有进度事件（`subscribe`）、`handle.wait()` 及 `getSnapshot()` 轮询全部被静默丢弃！
  - 修复：将 `DownloadHandle` 迁至非响应式外置 `Map`（`nativeHandles`），彻底避免 Vue 3 Proxy 包装干扰；进度百分比、实时下载速率、写标签与「下载完成」弹窗现已 100% 实时准确同步。

---

## ✨ v2.4.4 关键修复

- **彻底修复瞬时落盘后进度条仍显示「连接服务器…」且卡住不动**：
  - `completed` 与 `tagging` 阶段立即更新进度至 `100%` 并切换为「正在匹配歌词… / 正在写入封面与标签…」；同时并行挂载宿主原生 `handle.wait()` 与 `500ms` 快照轮询。
  - 为歌词匹配（5s）、封面抓取（4s）、音频读取（4s）及整体后处理（10s）加装硬超时，后处理卡顿不再阻塞任务完成。
- **修复 `openSaveDir is not defined` 崩溃**与主进程直连 `responseType: 'arrayBuffer'` 大小写规范。

---

## ✨ v2.4.3 状态同步关键修复

- **彻底修复「其实已经下载完成，却误报连接超时 / 卡在 0%」**：
  - 为宿主原生下载句柄新增 **1 秒 `handle.getSnapshot()` 主动轮询**，即使宿主 IPC 进度推送丢失或文件瞬间下完，进度与完成状态也会立即准确同步到界面。
  - 10s 看门狗触发回退前，先主动复核 `handle.getSnapshot()` 与 `ctx.fs.stat()` 目标磁盘文件，确认未落盘才执行回退，彻底杜绝「文件已下载完却误报连接失败」。

---

## ✨ v2.4.2 关键修复与界面升级

1. **三级自动回退下载传输链路（彻底解决「连接下载服务器超时」）**
   - 宿主原生流式通道（`ctx.net.download`）补充标准桌面 `User-Agent` 并缩短连接超时为 8s / 零字节看门狗 10s；一旦原生 Session 出现超时或中断，立即**自动无感切换**至主进程 Node Axios 直连（`ctx.net.request` + `ctx.fs.writeFile`）或内置 `aria2c.exe` 多线程引擎，仍失败时自动触发解灰换源重下。
   - 设置中新增 **「优先下载引擎」**（`自动回退` / `直连优先` / `aria2c`）。
2. **下载主界面充实升级（仪表盘概览 + 快捷导入卡片）**
   - 顶部新增紧凑 **4 格仪表盘概览条**（已下载曲目、进行中队列与实时速率、音质与引擎快捷配置、保存目录直达）。
   - 空列表状态升级为 **3 张原生快捷导入卡片**（从当前播放队列导入、从我的酷狗歌单导入、下载引擎与音质设置），告别界面空旷。

---

## ✨ v2.4.1 关键修复与增强

1. **彻底修复下载长期卡在「解析音源…」或「0%」不动**
   - 将全部外部解灰/歌词/封面网络请求从受浏览器 CORS 限制且忽略超时的 `ctx.net.fetch` 迁移至主进程无限制 HTTP 客户端 **`ctx.net.request`** 并加装硬超时。
   - 对齐 EchoMusic 原生 `resolver.ts` 取链策略：先查询 `getSongPrivilegeLite` 提取 `relate_goods` 对应音质 Hash，再依次尝试 `getSongUrl(qualityHash, quality)` ➔ `getSongUrl(hash, '')` ➔ `getSongUrl(hash, '', 356753938)` ➔ 12s 硬超时解灰兜底。
   - 传透 `connectTimeoutMs: 12000` / `idleTimeoutMs: 20000` 给宿主原生流式下载引擎，并加装 **25s 零字节停滞看门狗**，超时自动报错不再静默挂死。
2. **下载体验增强（想法 A）**
   - **实时阶段诊断文案**：任务行实时显示「查询音质权限…」「请求酷狗 320…」「兼容模式取链…」「正在尝试解灰音源…」「连接下载服务器…」等准确阶段。
   - **一键「换源重下」**：失败或暂停的任务支持直接跳过酷狗官方链接、直走外部解灰音源重下。
   - **已下载双击本地播放**：「已下载」页签支持双击任务行或点击播放按钮直接通过 `ctx.fs.openMedia` + `ctx.player` 离线播放本地文件。

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
