# 歌曲下载 (`echo-music-download` v2.2.0)

为 **EchoMusic (`>= 2.3.2`)** 打造的**全功能歌曲与歌单下载、纯 JS 标签与封面内嵌（ID3v2.3 / FLAC）、同名双语 `.lrc` 导出及灰歌解灰联动插件**。

---

## ✨ v2.2.0 核心特性

1. **EchoMusic v2.3.x 原生视觉重构**
   - 采用宿主原生 `DetailPageSliverHeader` + `PageStickyHeader` + `CustomTabBar` + `Badge` + `SongSearchInput` 架构。
   - 全面使用宿主主题 CSS 变量（`var(--bg-info-card)`、`var(--border-subtle)`、`var(--color-text-main)`、`var(--color-primary)`），完美适配浅色与深色模式。
   - 接入宿主全局任务面板（`ctx.tasks.register`），批量下载时可在宿主任务中心实时查看整体进度或一键取消。
2. **纯 JS 音频元数据与高清封面内嵌（ID3v2.3 & FLAC）**
   - **MP3 (`ID3v2.3`)**：自动将标题（`TIT2`）、歌手（`TPE1`）、专辑（`TALB`）、非同步歌词（`USLT`）及 480px 封面图（`APIC`）以标准 UTF-16LE / 二进制帧直接内嵌至 `.mp3` 头部。
   - **FLAC (`Vorbis Comment` + `Picture`)**：自动构建 Type 4 `VORBIS_COMMENT` 与 Type 6 `METADATA_BLOCK_PICTURE` 写入 `.flac` 文件头，100% 兼容桌面播放器与 EchoMusic 官方 `local-music` 插件。
3. **同名双语 `.lrc` 歌词导出**
   - 下载完成后自动在同级目录生成同名 `.lrc` 歌词文件，支持将原文与中文翻译合并为双语 LRC。
4. **用户全量歌单（「我喜欢」/ 自建 / 收藏）批量与增量同步**
   - 支持直接读取登录账号的酷狗歌单（分页拉取全量曲目，突破旧版 100 首限制）或当前播放队列。
   - 支持 **「按歌单名创建子文件夹 (`{playlist}/{filename}`)」** 与 **「增量同步（自动跳过本地已下载歌曲）」**。
5. **灰歌解灰联动下载**
   - 当酷狗官方接口因无版权或 VIP 限制无法返回下载地址时，自动联动 `echo-music-unblock`（或内置同曲异版/外部聚合兜底）完成下载。

---

## 📦 安装方式

在 EchoMusic **设置 ➔ 插件管理 ➔ 插件市场 ➔ 添加源** 中填入：

```text
https://github.com/xhd2005/echo-music-plugins
```

---

## 📄 许可证

GPL-3.0 License
