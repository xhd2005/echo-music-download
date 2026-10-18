<div align="center">

<img src="logo.png" alt="歌曲下载" width="100" height="100" />

# 🎵 echo-music-download · 歌曲下载

**把酷狗歌曲下载到本地 —— 官方接口 + 内置 aria2c，支持批量队列、并发与断点续传**

[![release](https://img.shields.io/github/v/release/xhd2005/echo-music-download?style=flat-square&color=31cfa1&label=release)](https://github.com/xhd2005/echo-music-download/releases)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](https://github.com/xhd2005/echo-music-download/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/xhd2005/echo-music-download?style=flat-square&color=31cfa1)](https://github.com/xhd2005/echo-music-download/stargazers)
[![EchoMusic](https://img.shields.io/badge/EchoMusic-%E2%89%A52.2.7--beta.9-31cfa1?style=flat-square&logo=electron&logoColor=fff)](https://github.com/hoowhoami/EchoMusic)

</div>

> 💿 [EchoMusic](https://github.com/hoowhoami/EchoMusic) 插件：把酷狗歌曲下载到本地文件夹。官方登录态接口取地址，内置 aria2c 多线程下载引擎，支持进度、断点续传与批量队列。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 🎯 当前播放一键下载 | 下载页点「下载」，正在播放的歌曲直接入队 |
| 📋 歌单批量下载 | 勾选 / 搜索 / 全选，队列化下载，失败可重试、可取消 |
| 🖱️ 右键下载 | 任意歌曲右键 →「下载到本地」，列表行内也有下载按钮 |
| 🔍 歌单内搜索 | 按歌名 + 歌手名过滤长列表，全选作用于过滤结果 |
| ⚡ 多线程 + 并发 | aria2c 每首 4 线程，最多 4 首同时下载（可配 1–4），断点续传 |
| 🏷️ 音质双档 | 标准 128kbps / 高品质 320kbps；320 不可用时自动回退标准音质 |
| 📝 文件名格式 | 艺术家 - 歌名 / 歌名 - 艺术家 / 仅歌名，任选 |
| 📁 自选保存目录 | 保存位置任意选，自动记忆 |

## 📦 安装

需要 EchoMusic **>= 2.2.7-beta.9**。

| 方式 | 步骤 |
| --- | --- |
| 🛍️ 插件市场（推荐） | 添加源 `https://github.com/xhd2005/echo-music-plugins` → 搜索「歌曲下载」安装 |
| 📥 本地安装 | 在 [Releases](https://github.com/xhd2005/echo-music-download/releases) 下载 `echo-music-download-v1.1.0.zip` → 插件管理 → 从本地安装 |
| 📂 手动复制 | 解压 zip 到 `%APPDATA%\echo-music\plugins\echo-music-download\` |
| 🛠️ 开发者 | `git clone` 本仓库后用「从目录安装」 |

## 🚀 快速上手

1. 🧭 打开侧边栏「歌曲下载」页
2. 🗂️ 点「更改目录」选择保存文件夹
3. 💾 播歌后点「下载」，或任意歌曲右键 →「下载到本地」
4. 🔐 首次下载会弹出「允许插件运行本地程序（aria2c）」确认框 → 点允许（只需一次）

## ⚙️ 设置项

入口：设置 → 插件管理 → 歌曲下载

| 设置 | 可选值 | 默认 |
| --- | --- | --- |
| 📁 歌曲保存目录 | 任意本地文件夹 | — |
| 🎚️ 下载音质 | 标准 128kbps / 高品质 320kbps | 128 |
| ⚡ 同时下载数 | 1 – 4 | 2 |
| 📝 文件名格式 | 艺术家 - 歌名 / 歌名 - 艺术家 / 仅歌名 | 艺术家 - 歌名 |

## ❓ 常见问题

**🔐 Q：弹出「允许插件运行本地程序（aria2c）」是什么？**
A：下载引擎是插件目录内捆绑的 aria2c.exe，宿主需要你授权一次。点「允许」即可，之后不再提示。

**🎚️ Q：选了 320 高品质，任务却显示「已回退标准音质」？**
A：部分歌曲 / 免费账号在官方接口拿不到 320 地址，插件自动回退 128 保证能下，任务行会注明。

**🚫 Q：提示「未获取到可下载的播放地址」？**
A：VIP / 版权受限歌曲官方不提供明文地址。本插件不绕过限制、不碰加密接口，这类歌无法下载。

**🔄 Q：下载到一半失败或中断了？**
A：aria2c 自带 3 次重试；彻底失败后点任务行的「重试」，支持断点续传。应用重启后中断的任务也会标为失败，可一键重试。

**🔍 Q：歌单批量页里为什么没有搜索结果？**
A：搜索结果是临时队列，批量页不显示。搜到的歌直接用右键菜单或行内按钮下载即可。

## 🛠 技术说明

- 🔗 **下载地址**：`ctx.kugou.music.getSongUrl`（宿主登录态官方接口），走酷狗经典 `/song/url`（v5）接口，不涉及 `/song/url/new` 的加密 DRM 接口
- 🎼 **音质**：128 / 320 两档 MP3；无损档（flac / high / super）需 VIP 权限，插件不提供
- ⚙️ **下载引擎**：aria2 1.37.0 win-64 官方构建，SHA-256 `be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2`
- 📊 **进度解析**：每任务独立 aria2c 进程 + 独立日志，轮询解析日志获得进度 / 速度 / 剩余时间，天然支持并发

## ⚠️ 免责声明

本插件仅通过酷狗**官方登录态接口**获取普通音质（128 / 320kbps MP3）的播放地址，不涉及 VIP 音质、付费内容或 DRM 破解。下载内容请仅用于个人学习与收藏，并遵守酷狗音乐服务条款及当地法律法规。

## 📄 许可证

[MIT](LICENSE) © 2026 xhd2005


## 🔧 更新日志

- **v2.0.0**（2026-10-18）：重构为 EchoMusic beta.17 原生流式下载引擎（`ctx.net.download` + `ctx.fs.files` 沙箱目录持久授权），保留 aria2c 引擎降级备选；UI 视觉全面采用黑曜石紧凑列表，新增实时速率脉冲监视器与悬停微动作组。