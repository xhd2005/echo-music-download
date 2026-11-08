<div align="center">

<img src="logo.png" alt="歌曲下载" width="100" height="100" />

# 🎵 echo-music-download · 歌曲下载

**把酷狗歌曲下载到本地 —— 原生流式下载引擎 + aria2c 兜底兼容，支持批量队列、并发与断点续传**

[![release](https://img.shields.io/github/v/release/xhd2005/echo-music-download?style=flat-square&color=31cfa1&label=release)](https://github.com/xhd2005/echo-music-download/releases)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](https://github.com/xhd2005/echo-music-download/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/xhd2005/echo-music-download?style=flat-square&color=31cfa1)](https://github.com/xhd2005/echo-music-download/stargazers)
[![EchoMusic](https://img.shields.io/badge/EchoMusic-%E2%89%A52.2.7--beta.9%20%7C%20v2.3.3-31cfa1?style=flat-square&logo=electron&logoColor=fff)](https://github.com/hoowhoami/EchoMusic)

</div>

> 💿 [EchoMusic](https://github.com/hoowhoami/EchoMusic) 插件：把酷狗歌曲下载到本地文件夹。优先使用 EchoMusic 原生流式下载引擎（`ctx.net.download` + `ctx.fs.requestDirectory` 持久化目录沙箱授权），并保留内置 `aria2c` 多线程下载引擎作为兜底回退。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 🎯 当前播放一键下载 | 下载页点「下载」，正在播放的歌曲直接入队 |
| 📋 歌单批量下载 | 勾选 / 搜索 / 全选，队列化下载，失败可重试、可取消 |
| 🖱️ 右键下载 | 任意歌曲右键 →「下载到本地」，列表行内也有下载按钮 |
| 🔍 歌单内搜索 | 按歌名 + 歌手名过滤长列表，全选作用于过滤结果 |
| ⚡ 双引擎 + 并发 | 优先走宿主原生 `ctx.net.download` 流式下载，异常或旧版自动回退 `aria2c`，支持 1–4 并发与断点续传 |
| 🏷️ 音质双档 | 标准 128kbps / 高品质 320kbps；320 不可用时自动回退标准音质 |
| 📝 文件名格式 | 艺术家 - 歌名 / 歌名 - 艺术家 / 仅歌名，任选，同名文件自动安全重命名 |
| 📁 持久化目录授权 | 支持 `ctx.fs.requestDirectory` 持久化目录授权，自动校验与恢复授权 |

## 📦 安装

需要 EchoMusic **>= 2.2.7-beta.9**（推荐 **>= 2.3.2 / 2.3.3-beta.1** 以获得完整原生流式下载体验）。

| 方式 | 步骤 |
| --- | --- |
| 🛍️ 插件市场（推荐） | 添加源 `https://github.com/xhd2005/echo-music-plugins` → 搜索「歌曲下载」安装 |
| 📥 本地安装 | 在 [Releases](https://github.com/xhd2005/echo-music-download/releases) 下载 `echo-music-download-v2.1.0.zip` → 插件管理 → 从本地安装 |
| 📂 手动复制 | 解压 zip 到 `%APPDATA%\echo-music\plugins\echo-music-download\` |
| 🛠️ 开发者 | `git clone` 本仓库后用「从目录安装」 |

## 🚀 快速上手

1. 🧭 打开侧边栏「歌曲下载」页
2. 🗂️ 点「更改目录」选择并授权保存文件夹
3. 💾 播歌后点「下载」，或任意歌曲右键 →「下载到本地」
4. 🔐 若回退到 `aria2c` 引擎，首次下载会弹出「允许插件运行本地程序（aria2c）」确认框 → 点允许（只需一次）

## ⚙️ 设置项

入口：设置 → 插件管理 → 歌曲下载

| 设置 | 可选值 | 默认 |
| --- | --- | --- |
| 📁 歌曲保存目录 | 任意本地文件夹（持久化沙箱授权） | — |
| 🎚️ 下载音质 | 标准 128kbps / 高品质 320kbps | 128 |
| ⚡ 同时下载数 | 1 – 4 | 2 |
| 📝 文件名格式 | 艺术家 - 歌名 / 歌名 - 艺术家 / 仅歌名 | 艺术家 - 歌名 |

## 🛠 技术说明

- 🔗 **下载地址**：`ctx.kugou.music.getSongUrl`（宿主登录态官方接口），走酷狗经典 `/song/url`（v5）接口，不涉及 `/song/url/new` 的加密 DRM 接口
- 🎼 **音质**：128 / 320 两档 MP3；无损档（flac / high / super）需 VIP 权限，插件不提供
- ⚙️ **下载引擎**：优先使用宿主 `ctx.net.download` + `ctx.fs` 持久化目录授权；兜底采用 aria2 1.37.0 win-64 官方构建（SHA-256 `be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2`）

## ⚠️ 免责声明

本插件仅通过酷狗**官方登录态接口**获取普通音质（128 / 320kbps MP3）的播放地址，不涉及 VIP 音质、付费内容或 DRM 破解。下载内容请仅用于个人学习与收藏，并遵守酷狗音乐服务条款及当地法律法规。

## 📄 许可证

[MIT](LICENSE) © 2026 xhd2005

## 🔧 更新日志

- **v2.1.0**（2026-11-08）：全面适配 EchoMusic `v2.3.2` / `v2.3.3-beta.1` 插件运行时；修正 `manifest.json` 的 `downloads` 与 `localFiles` 权限声明；修复 `ctx.fs.requestDirectory` / `listDirectoryGrants` / `reauthorizeDirectoryGrant` 挂载路径，真正激活原生流式下载引擎；补全 `formatBytes` / `formatEta` 速率与剩余时间计算，同步冲突自动重命名后的真实文件名，并保持 `>=2.2.7-beta.9` 向下兼容。
- **v2.0.0**（2026-10-18）：接入原生流式下载引擎与 `aria2c` 降级备选；UI 视觉采用黑曜石紧凑列表。
