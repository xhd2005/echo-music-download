// 歌曲下载插件（echo-music-download）
// 复用宿主登录态调用酷狗官方接口获取播放 URL（ctx.kugou.music.getSongUrl），
// 用插件目录内捆绑的 aria2c.exe 下载到用户选定的本地文件夹。
//
// 合规边界：仅请求官方接口经典 /song/url（v5）接口，音质双档 128/320（均为明文 MP3），
// 不涉及 /song/url/new（v6）的加密 DRM 接口，不提供需 VIP 的无损档位。
//
// 入口：
// - 侧边栏页面 /main/plugin/echo-music-download/downloads：当前播放一键下载 + 歌单批量下载 + 任务列表
// - 歌曲右键菜单「下载到本地」
// - 插件设置项（设置 → 插件管理 → 本插件）：保存目录 / 音质 / 并发数 / 文件名格式
//
// 下载流程：
//   track → ctx.kugou.music.getSongUrl(hash, quality)（320 无权限自动回退 128）
//   → extractSongUrl / extractExt → ctx.process.launch({ executable: 'bin/aria2c.exe', args })
//   → 每任务独立轮询 aria2c 日志（进度 / 完成 / 失败）→ 任务状态持久化到 ctx.storage
//   → 并发：最多 maxConcurrent 个 aria2c 进程同时下载

// ---- 常量 ----

const POLL_INTERVAL_MS = 700;
const LOG_MAX_BYTES = 512 * 1024;
const STALL_TIMEOUT_MS = 30 * 1000;
const STORAGE_SAVE_DIR = 'emd.saveDir';
const STORAGE_SAVE_DIR_REF = 'emd.saveDirRef';
const STORAGE_TASKS = 'emd.tasks';
const STORAGE_QUALITY = 'emd.quality';
const STORAGE_NAME_FORMAT = 'emd.nameFormat';
const STORAGE_MAX_CONCURRENT = 'emd.maxConcurrent';
const MAX_BATCH_RENDER = 100;
const MAX_CONCURRENT_MIN = 1;
const MAX_CONCURRENT_MAX = 4;

const QUALITY_OPTIONS = [
  { value: '128', label: '标准 128kbps' },
  { value: '320', label: '高品质 320kbps' },
];

const NAME_FORMAT_OPTIONS = [
  { value: 'artist-title', label: '艺术家 - 歌名' },
  { value: 'title-artist', label: '歌名 - 艺术家' },
  { value: 'title', label: '仅歌名' },
];

const TASK_STATE_LABEL = {
  queued: '排队中',
  launching: '准备中',
  downloading: '下载中',
  done: '已完成',
  failed: '失败',
};

// ---- 通用辅助 ----

// iconify 数据对象 → 内联 SVG（自建组件树内宿主全局 Icon 不可解析，统一走此路径）

const ICONS = {
  download: {
    width: 24, height: 24,
    body: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12\"/>",
  },
  pause: {
    width: 24, height: 24,
    body: "<path fill=\"currentColor\" d=\"M6 5h4v14H6zm8 0h4v14h-4z\"/>",
  },
  play: {
    width: 24, height: 24,
    body: "<path fill=\"currentColor\" d=\"M6 4l14 8-14 8z\"/>",
  },
  rotate: {
    width: 24, height: 24,
    body: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M20 11a8.1 8.1 0 0 0-15.5-2m-.5-5v5h5M4 13a8.1 8.1 0 0 0 15.5 2m.5 5v-5h-5\"/>",
  },
  folder: {
    width: 24, height: 24,
    body: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z\"/>",
  },
  trash: {
    width: 24, height: 24,
    body: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3\"/>",
  },
  check: {
    width: 24, height: 24,
    body: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M5 12l5 5L20 7\"/>",
  },
  alert: {
    width: 24, height: 24,
    body: "<circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M12 8v4m0 4h.01\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  },
  clock: {
    width: 24, height: 24,
    body: "<circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M12 7v5l3 3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  },
  settings: {
    width: 24, height: 24,
    body: "<circle cx=\"12\" cy=\"12\" r=\"3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/>",
  },
  loader: {
    width: 24, height: 24,
    body: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83\"/>",
  },
};

const iconSvg = (h, iconData, { size = 18, className = '' } = {}) =>
  h('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: `0 0 ${iconData?.width || 24} ${iconData?.height || 24}`,
    class: className,
    'aria-hidden': 'true',
    innerHTML: iconData?.body ?? '',
  });

// 从酷狗 API 错误中提取可读消息
const getApiErrorMessage = (error, fallback) => {
  const body = error?.response?.body;
  const msg = body?.error_msg ?? body?.msg;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  const code = body?.error_code;
  if (code != null && Number(code) !== 0) {
    if (Number(code) === 20018) return '登录已过期，请重新登录';
    return `酷狗接口错误（${code}）`;
  }
  return `${fallback}，请稍后重试`;
};

// 歌曲元数据（与宿主 Song 模型对齐）
const buildSongName = (song) => {
  const title = String(song?.title ?? song?.name ?? '').trim();
  const artist = String(
    song?.artist || song?.artists?.[0]?.name || song?.singers?.[0]?.name || '',
  ).trim();
  return { artist, title };
};

// Windows 非法字符清理 + 按文件名格式组装「艺术家 - 歌名.ext」
const sanitizeFilename = (artist, title, ext, format = 'artist-title') => {
  let base;
  if (format === 'title-artist') base = artist ? `${title} - ${artist}` : title;
  else if (format === 'title') base = title;
  else base = artist ? `${artist} - ${title}` : title;
  base = String(base || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  if (!base) base = '未知歌曲';
  if (base.length > 120) base = base.slice(0, 120);
  return `${base}.${ext}`;
};

// 字节速率与剩余时间格式化（供原生流式下载进度脉冲使用）
const formatBytes = (bytes) => {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = num;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val >= 100 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
};

const formatEta = (seconds) => {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  if (!sec) return '';
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins < 60) return rem > 0 ? `${mins}m${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h${mins % 60}m`;
};

// 兼容 EchoMusic v2.3.2+ 直接挂载在 ctx.fs 上的目录授权 API 以及旧版 ctx.fs.files
const getFsGrantApi = (ctx) => {
  if (ctx?.fs && typeof ctx.fs.requestDirectory === 'function') return ctx.fs;
  if (ctx?.fs?.files && typeof ctx.fs.files.requestDirectory === 'function') return ctx.fs.files;
  return null;
};

// 从 getSongUrl 响应中提取可播放 URL（移植宿主 resolveUrlsFromResponse）
const appendUrlCandidate = (urls, value) => {
  if (typeof value === 'string') {
    const url = value.trim();
    if (url && !urls.includes(url)) urls.push(url);
    return;
  }
  if (Array.isArray(value)) value.forEach((item) => appendUrlCandidate(urls, item));
};

const extractSongUrl = (payload) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (Array.isArray(payload)) {
    const urls = [];
    appendUrlCandidate(urls, payload);
    return urls[0] || '';
  }
  if (typeof payload === 'object') {
    const record = payload;
    const urls = [];
    appendUrlCandidate(urls, record.url);
    appendUrlCandidate(urls, record.play_url);
    appendUrlCandidate(urls, record.playUrl);
    appendUrlCandidate(urls, record.backupUrl);
    appendUrlCandidate(urls, record.backup_url);
    appendUrlCandidate(urls, record.backupUrls);
    if (urls.length > 0) return urls[0];
    if ('data' in record) return extractSongUrl(record.data);
    if ('info' in record) return extractSongUrl(record.info);
  }
  return '';
};

// 提取文件扩展名：优先响应的 ext_name/extName 字段（/v5/url 为下划线命名），
// 回退 URL 路径扩展名，最后默认 mp3
const extractExt = (payload, url) => {
  const candidates = [];
  const collect = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item));
      return;
    }
    if (typeof value !== 'object') return;
    const pick = (v) => {
      if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
    };
    pick(value.ext_name);
    pick(value.extName);
    pick(value.ext);
    pick(value.format);
    pick(value.fileExt);
    if (value.data) collect(value.data);
    if (value.info) collect(value.info);
  };
  collect(payload);
  for (const c of candidates) {
    const first = c.split(';')[0].replace(/^\./, '').toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(first)) return first;
  }
  if (typeof url === 'string') {
    const m = url.split('?')[0].split('#')[0].match(/\.([a-zA-Z0-9]{1,5})$/);
    if (m) return m[1].toLowerCase();
  }
  return 'mp3';
};

// ---- 下载状态与引擎 ----

const createDownloadStore = (ctx) => {
  const { reactive } = ctx.vue;

  const state = reactive({
    saveDir: '',
    saveDirRef: null,
    quality: '128',
    nameFormat: 'artist-title',
    maxConcurrent: 2,
    tasks: [],
    runningCount: 0,
    nextSeq: 0,
  });

  const persist = () => {
    void ctx.storage
      .set(
        STORAGE_TASKS,
        state.tasks.map((t) => ({
          id: t.id,
          hash: t.hash,
          name: t.name,
          artist: t.artist,
          title: t.title,
          fileName: t.fileName,
          saveDir: t.saveDir,
          state: t.state,
          percent: t.percent,
          speed: t.speed,
          eta: t.eta,
          quality: t.quality,
          format: t.format,
          note: t.note,
          error: t.error,
          finalPath: t.finalPath,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      )
      .catch(() => {});
  };

  const stopPolling = (task) => {
    if (task._timer) {
      clearTimeout(task._timer);
      task._timer = null;
    }
  };

  const cleanupLog = (task) => {
    if (!task.logRel) return;
    try {
      const r = ctx.fs.deleteFile(task.logRel);
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) {
      /* ignore */
    }
  };

  const failTask = (task, error) => {
    task.state = 'failed';
    task.error = error || '下载失败';
    task.percent = null;
    task.speed = '';
    task.eta = '';
    task.updatedAt = Date.now();
    stopPolling(task);
    cleanupLog(task);
    state.runningCount = Math.max(0, state.runningCount - 1);
    persist();
    ctx.toast.danger(`${task.name}：${task.error}`);
    pump();
  };

  const completeTask = (task, finalPath) => {
    task.state = 'done';
    task.percent = 100;
    task.finalPath = finalPath || '';
    task.updatedAt = Date.now();
    stopPolling(task);
    cleanupLog(task);
    state.runningCount = Math.max(0, state.runningCount - 1);
    persist();
    ctx.toast.success(`${task.name} 下载完成`);
    pump();
  };

  const parseLog = (text) => {
    const result = {
      percent: null,
      speed: '',
      eta: '',
      done: false,
      finalPath: '',
      failed: false,
      error: '',
    };
    if (!text) return result;

    const completeMatch = text.match(/Download complete:\s*(.+)$/m);
    if (completeMatch) {
      result.done = true;
      result.finalPath = completeMatch[1].trim();
      return result;
    }

    const errMatch = text.match(/\[ERROR\]\s*(.*)$/m);
    const notComplete = /not complete\b/.test(text);
    if (errMatch || notComplete) {
      result.failed = true;
      result.error = errMatch ? errMatch[1].trim().slice(0, 200) : '下载失败';
      return result;
    }

    if (/Download Results:/.test(text)) {
      result.failed = true;
      result.error = '下载失败（详见 aria2c 结果）';
      return result;
    }

    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const m = lines[i].match(/\((\d+(?:\.\d+)?)%\)/);
      if (m) {
        result.percent = Number(m[1]);
        const dl = lines[i].match(/DL:([0-9.]+[KMG]?i?B)/);
        if (dl) result.speed = dl[1];
        const eta = lines[i].match(/ETA:(\S+)/);
        if (eta) result.eta = eta[1];
        break;
      }
    }
    return result;
  };

  // 每任务独立轮询（支持并发），停滞检测按任务计数
  const startPolling = (task) => {
    stopPolling(task);
    const poll = async () => {
      try {
        const res = await ctx.fs.readTextFile(task.logAbs, { maxBytes: LOG_MAX_BYTES });
        if (res && res.ok && typeof res.content === 'string') {
          const size = res.size ?? 0;
          const parsed = parseLog(res.content);

          if (parsed.done) {
            completeTask(task, parsed.finalPath || `${task.saveDir}/${task.fileName}`);
            return;
          }
          if (parsed.failed) {
            failTask(task, parsed.error);
            return;
          }
          if (parsed.percent != null || size !== task._lastSize) {
            task._lastSize = size;
            task._lastActivity = Date.now();
          }
          if (parsed.percent != null) {
            task.percent = parsed.percent;
            task.speed = parsed.speed || '';
            task.eta = parsed.eta || '';
          }
        }
        if (Date.now() - task._lastActivity > STALL_TIMEOUT_MS) {
          if (task.pid) {
            try {
              await ctx.process.terminate(task.pid);
            } catch (e) {
              /* ignore */
            }
          }
          failTask(task, '下载长时间无进度，已停止（请检查网络或重试）');
          return;
        }
      } catch (error) {
        // 日志尚不存在或读取失败 → 继续轮询，交由停滞检测兜底
      }
      task._timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    task._timer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  const launchAria2 = async (task, url) => {
    const pluginDir = String(ctx.descriptor?.directory ?? '').replace(/[\\/]+$/, '');
    const logRel = `logs/task-${task.id}.log`;
    const logAbs = `${pluginDir}/${logRel}`;
    task.logRel = logRel;
    task.logAbs = logAbs;

    // 确保日志目录存在（写入插件目录，写 API 自动创建父目录）
    try {
      await ctx.fs.writeFile('logs/.keep', '', { createDirectories: true });
    } catch (e) {
      console.warn('[echo-music-download] 创建日志目录失败:', e);
    }
    // 清理重试残留的旧日志
    try {
      await ctx.fs.deleteFile(logRel);
    } catch (e) {
      /* ignore */
    }

    const args = [
      `--dir=${task.saveDir}`,
      `--out=${task.fileName}`,
      `--log=${logAbs}`,
      '--log-level=info',
      '--console-log-level=error',
      '--summary-interval=1',
      '--continue=true',
      '--split=4',
      '--max-connection-per-server=4',
      '--min-split-size=1M',
      '--file-allocation=none',
      '--auto-file-renaming=true',
      '--allow-overwrite=false',
      '--enable-color=false',
      '--check-certificate=true',
      '--max-tries=3',
      '--retry-wait=2',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      url,
    ];

    const res = await ctx.process.launch({ executable: 'bin/aria2c.exe', args });
    if (res && res.ok) return { ok: true, pid: res.pid };
    return { ok: false, error: res?.error, canceled: res?.canceled };
  };

  const startTask = async (task) => {
    task.state = 'launching';
    task.updatedAt = Date.now();
    persist();

    let body;
    try {
      body = await ctx.kugou.music.getSongUrl(task.hash, task.quality);
    } catch (error) {
      console.warn('[echo-music-download] 获取播放地址失败:', error);
      failTask(task, getApiErrorMessage(error, '获取播放地址失败'));
      return;
    }

    let url = extractSongUrl(body);

    // 320 无权限/不可用时回退标准音质（免费账号常见）
    if (!url && task.quality === '320') {
      try {
        body = await ctx.kugou.music.getSongUrl(task.hash, '128');
        url = extractSongUrl(body);
        if (url) {
          task.quality = '128';
          task.note = '320 不可用，已回退标准音质';
        }
      } catch (error) {
        console.warn('[echo-music-download] 回退标准音质失败:', error);
      }
    }

    if (!url) {
      failTask(task, '未获取到可下载的播放地址（可能为 VIP 或版权受限歌曲）');
      return;
    }

    const ext = extractExt(body, url);
    task.fileName = sanitizeFilename(task.artist, task.title, ext, task.format);

    // 优先使用 EchoMusic v2.3.2+ 原生流式下载引擎 (ctx.net.download + ctx.fs 目录授权)
    const fsGrants = getFsGrantApi(ctx);
    const useNative = Boolean(ctx.net?.download && fsGrants && state.saveDirRef?.id);
    if (useNative) {
      task.engine = "native";
      task.state = "downloading";
      task.updatedAt = Date.now();
      persist();
      try {
        if (state.saveDirRef.available === false && typeof fsGrants.reauthorizeDirectoryGrant === "function") {
          const reauth = await fsGrants.reauthorizeDirectoryGrant(state.saveDirRef.id, {
            access: "read-write",
            purpose: "选择歌曲下载保存目录",
            persist: true,
          });
          if (reauth && reauth.ok !== false && !reauth.canceled && reauth.directory) {
            state.saveDirRef = reauth.directory;
            state.saveDir = reauth.directory.displayPath || reauth.directory.name || state.saveDir;
            await ctx.storage.set(STORAGE_SAVE_DIR_REF, reauth.directory);
            await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
          }
        }
        let handle;
        try {
          handle = await ctx.net.download({
            url,
            name: task.name,
            target: { directoryId: state.saveDirRef.id, relativePath: task.fileName },
            conflict: "rename",
            resume: true,
          });
        } catch (dlErr) {
          if (
            typeof fsGrants.reauthorizeDirectoryGrant === "function" &&
            /GRANT|DIRECTORY|ACCESS|UNAVAILABLE/i.test(String(dlErr?.code || dlErr?.message || ""))
          ) {
            const reauth = await fsGrants.reauthorizeDirectoryGrant(state.saveDirRef.id, {
              access: "read-write",
              purpose: "恢复歌曲下载保存目录访问权限",
              persist: true,
            });
            if (reauth && reauth.ok !== false && !reauth.canceled && reauth.directory) {
              state.saveDirRef = reauth.directory;
              state.saveDir = reauth.directory.displayPath || reauth.directory.name || state.saveDir;
              await ctx.storage.set(STORAGE_SAVE_DIR_REF, reauth.directory);
              await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
              handle = await ctx.net.download({
                url,
                name: task.name,
                target: { directoryId: state.saveDirRef.id, relativePath: task.fileName },
                conflict: "rename",
                resume: true,
              });
            } else {
              throw dlErr;
            }
          } else {
            throw dlErr;
          }
        }
        task._handle = handle;
        task._unsub = handle.subscribe((s) => {
          if (s.totalBytes && s.totalBytes > 0) {
            task.percent = Math.min(100, Math.round((s.receivedBytes / s.totalBytes) * 100));
          }
          task.speed = s.bytesPerSecond ? formatBytes(s.bytesPerSecond) + "/s" : "";
          task.eta = s.remainingSeconds ? formatEta(s.remainingSeconds) : "";
          if (s.state === "completed") {
            const actualName =
              s.result?.file?.kind === "directory-file" && s.result.file.relativePath
                ? s.result.file.relativePath
                : task.fileName;
            task.fileName = actualName;
            const finalPath = `${state.saveDir}/${actualName}`;
            if (typeof task._unsub === "function") {
              try {
                task._unsub();
              } catch {}
              task._unsub = null;
            }
            completeTask(task, finalPath);
          } else if (["failed", "canceled", "interrupted"].includes(s.state)) {
            if (typeof task._unsub === "function") {
              try {
                task._unsub();
              } catch {}
              task._unsub = null;
            }
            failTask(task, s.error?.message || "原生下载中断");
          } else if (s.state === "paused") {
            task.state = "paused";
            persist();
          } else if (s.state === "downloading") {
            task.state = "downloading";
          }
        });
      } catch (err) {
        console.warn("[echo-music-download] 原生下载异常，回退 aria2c:", err);
        // 回退 aria2c
        task.engine = "aria2c";
        const launch = await launchAria2(task, url);
        if (!launch.ok) {
          failTask(task, launch.error || "启动下载失败");
          return;
        }
        task.pid = launch.pid;
        task.state = "downloading";
        task.updatedAt = Date.now();
        task._lastSize = 0;
        task._lastActivity = Date.now();
        persist();
        startPolling(task);
      }
      return;
    }

    // 备选降级：启动 aria2c 进程下载
    task.engine = "aria2c";
    const launch = await launchAria2(task, url);
    if (!launch.ok) {
      if (launch.canceled) {
        failTask(task, "已取消启动 aria2c；请在弹窗中允许插件运行本地程序");
      } else {
        failTask(task, launch.error || "启动 aria2c 失败");
      }
      return;
    }

    task.pid = launch.pid;
    task.state = "downloading";
    task.updatedAt = Date.now();
    task._lastSize = 0;
    task._lastActivity = Date.now();
    persist();
    startPolling(task);
  };

  // 并发泵：runningCount < maxConcurrent 时持续启动队首任务
  const pump = () => {
    while (state.runningCount < state.maxConcurrent) {
      const next = state.tasks.find((t) => t.state === 'queued');
      if (!next) break;
      state.runningCount += 1;
      void startTask(next);
    }
  };

  const enqueueSongs = (songs) => {
    if (!state.saveDir) {
      ctx.toast.info('请先选择歌曲保存目录');
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const song of songs) {
      if (!song || !song.hash) continue;
      const { artist, title } = buildSongName(song);
      if (!title) continue;
      const dup = state.tasks.find(
        (t) => t.hash === song.hash && ['queued', 'launching', 'downloading'].includes(t.state),
      );
      if (dup) {
        skipped += 1;
        continue;
      }
      state.nextSeq += 1;
      state.tasks.push({
        id: `t${Date.now()}-${state.nextSeq}`,
        hash: song.hash,
        name: artist ? `${artist} - ${title}` : title,
        artist,
        title,
        fileName: '',
        saveDir: state.saveDir,
        state: 'queued',
        percent: null,
        speed: '',
        eta: '',
        quality: state.quality,
        format: state.nameFormat,
        note: '',
        error: '',
        finalPath: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      added += 1;
    }
    if (added > 0) {
      persist();
      ctx.toast.success(`已加入 ${added} 首下载队列`);
      pump();
    }
    if (skipped > 0) {
      ctx.toast.info(`${skipped} 首已在队列中，已跳过`);
    }
  };

  const retryTask = async (task) => {
    if (task._handle && typeof task._handle.retry === "function") {
      task.state = "downloading";
      task.error = "";
      persist();
      try {
        await task._handle.retry();
        return;
      } catch {}
    }
    if (["queued", "launching", "downloading"].includes(task.state)) return;
    task.state = "queued";
    task.percent = null;
    task.speed = "";
    task.eta = "";
    task.note = "";
    task.error = "";
    task.finalPath = "";
    task.updatedAt = Date.now();
    persist();
    pump();
  };

  const cancelTask = async (task) => {
    if (typeof task._unsub === "function") {
      try { task._unsub(); } catch {}
      task._unsub = null;
    }
    if (task._handle && typeof task._handle.cancel === "function") {
      try { await task._handle.cancel(); } catch {}
    }
    if (task.state === "downloading" || task.state === "launching") {
      if (task.pid) {
        try {
          await ctx.process.terminate(task.pid);
        } catch (e) {
          /* ignore */
        }
      }
      failTask(task, "已取消");
    } else if (task.state === "queued") {
      task.state = "failed";
      task.error = "已取消";
      task.updatedAt = Date.now();
      persist();
    }
  };

  const removeTask = (task) => {
    if (task.state === 'downloading' || task.state === 'launching') {
      void cancelTask(task);
    }
    const idx = state.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) state.tasks.splice(idx, 1);
    persist();
  };

  const clearFinished = () => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => t.state !== 'done' && t.state !== 'failed');
    if (state.tasks.length !== before) persist();
  };

  const chooseSaveDir = async () => {
    // 优先调用 EchoMusic v2.3.2+ 原生文件授权 API (获得持久化目录沙箱引用)
    const fsGrants = getFsGrantApi(ctx);
    if (fsGrants && typeof fsGrants.requestDirectory === "function") {
      try {
        const res = await fsGrants.requestDirectory({
          access: "read-write",
          purpose: "选择歌曲下载保存目录",
          persist: true,
        });
        if (res && res.canceled) {
          return;
        }
        if (res && res.ok !== false && !res.canceled && res.directory) {
          state.saveDirRef = res.directory;
          state.saveDir = res.directory.displayPath || res.directory.name || "已授权目录";
          await ctx.storage.set(STORAGE_SAVE_DIR_REF, res.directory);
          await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
          ctx.toast.success(`保存目录已授权：${state.saveDir}`);
          return;
        }
      } catch (e) {
        console.warn("[echo-music-download] 原生目录授权异常，回退对话框:", e);
      }
    }
    if (ctx.dialog?.selectDirectory) {
      const res = await ctx.dialog.selectDirectory({ title: "选择歌曲保存目录" });
      if (res && !res.canceled && res.paths && res.paths[0]) {
        state.saveDirRef = null;
        state.saveDir = res.paths[0];
        await ctx.storage.set(STORAGE_SAVE_DIR_REF, null);
        await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
        ctx.toast.success("保存目录已更新");
      }
    }
  };

  const setQuality = async (quality) => {
    state.quality = quality;
    try {
      await ctx.storage.set(STORAGE_QUALITY, quality);
    } catch (e) {
      /* ignore */
    }
  };

  const setNameFormat = async (format) => {
    state.nameFormat = format;
    try {
      await ctx.storage.set(STORAGE_NAME_FORMAT, format);
    } catch (e) {
      /* ignore */
    }
  };

  const setMaxConcurrent = async (value) => {
    const v = Math.min(MAX_CONCURRENT_MAX, Math.max(MAX_CONCURRENT_MIN, Math.trunc(Number(value)) || 2));
    state.maxConcurrent = v;
    try {
      await ctx.storage.set(STORAGE_MAX_CONCURRENT, v);
    } catch (e) {
      /* ignore */
    }
    pump();
  };

  const restore = async () => {
    try {
      const savedRef = await ctx.storage.get(STORAGE_SAVE_DIR_REF);
      if (savedRef && savedRef.id) {
        state.saveDirRef = savedRef;
        const fsGrants = getFsGrantApi(ctx);
        if (fsGrants && typeof fsGrants.listDirectoryGrants === 'function') {
          try {
            const grants = await fsGrants.listDirectoryGrants();
            if (Array.isArray(grants)) {
              const matched = grants.find((g) => g && g.id === savedRef.id);
              if (matched) {
                state.saveDirRef = matched;
                if (matched.displayPath || matched.name) {
                  state.saveDir = matched.displayPath || matched.name;
                }
              }
            }
          } catch {}
        }
      }
      const dir = await ctx.storage.get(STORAGE_SAVE_DIR);
      if (!state.saveDir && typeof dir === 'string' && dir.trim()) state.saveDir = dir.trim();
    } catch (e) {
      /* ignore */
    }
    try {
      const q = await ctx.storage.get(STORAGE_QUALITY);
      if (q === '128' || q === '320') state.quality = q;
    } catch (e) {
      /* ignore */
    }
    try {
      const f = await ctx.storage.get(STORAGE_NAME_FORMAT);
      if (NAME_FORMAT_OPTIONS.some((o) => o.value === f)) state.nameFormat = f;
    } catch (e) {
      /* ignore */
    }
    try {
      const c = Number(await ctx.storage.get(STORAGE_MAX_CONCURRENT));
      if (Number.isFinite(c)) {
        state.maxConcurrent = Math.min(
          MAX_CONCURRENT_MAX,
          Math.max(MAX_CONCURRENT_MIN, Math.trunc(c)),
        );
      }
    } catch (e) {
      /* ignore */
    }
    try {
      const saved = await ctx.storage.get(STORAGE_TASKS);
      if (Array.isArray(saved)) {
        state.tasks = saved
          .filter((t) => t && t.id)
          .map((t) => ({
            ...t,
            fileName: t.fileName || '',
            speed: '',
            eta: '',
            quality: t.quality === '320' ? '320' : '128',
            format: NAME_FORMAT_OPTIONS.some((o) => o.value === t.format)
              ? t.format
              : 'artist-title',
            note: t.note || '',
            ...(t.state === 'downloading' || t.state === 'launching'
              ? { state: 'failed', error: '应用已退出，下载中断，请重试', percent: null }
              : {}),
          }));
        for (const t of state.tasks) {
          const m = /t\d+-(\d+)$/.exec(t.id);
          if (m) state.nextSeq = Math.max(state.nextSeq, Number(m[1]));
        }
      }
    } catch (e) {
      console.warn('[echo-music-download] 恢复任务失败:', e);
    }
  };

  const dispose = () => {
    for (const t of state.tasks) {
      stopPolling(t);
      if (typeof t._unsub === 'function') {
        try {
          t._unsub();
        } catch {}
        t._unsub = null;
      }
      if ((t.state === 'downloading' || t.state === 'launching') && t.pid) {
        try {
          void ctx.process.terminate(t.pid);
        } catch (e) {
          /* ignore */
        }
      }
    }
  };

  return {
    state,
    restore,
    enqueueSongs,
    retryTask,
    cancelTask,
    removeTask,
    clearFinished,
    chooseSaveDir,
    setQuality,
    setNameFormat,
    setMaxConcurrent,
    dispose,
  };
};

// ---- 样式 ----

const CSS = `
.emd-root { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.emd-page { display: flex; flex-direction: column; gap: 16px; padding: 20px 32px 36px; max-width: 1200px; margin: 0 auto; width: 100%; box-sizing: border-box; }
.emd-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.emd-header-left { display: flex; align-items: center; gap: 12px; }
.emd-header-icon-box { width: 36px; height: 36px; border-radius: 10px; background: color-mix(in srgb, var(--color-primary, #00cc65) 14%, transparent); border: 1px solid color-mix(in srgb, var(--color-primary, #00cc65) 24%, transparent); display: flex; align-items: center; justify-content: center; color: var(--color-primary, #00cc65); }
.emd-title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.01em; color: var(--text-main, #ffffff); }
.emd-subtitle { margin: 2px 0 0; font-size: 11.5px; font-weight: 500; color: var(--text-secondary, #bcbcbc); }

/* 控制与设置区域 */
.emd-section { border: 1px solid var(--border-light, #444446); border-radius: 14px; background: var(--surface-card-base, #343436); padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
.emd-section-title { display: flex; align-items: center; justify-content: space-between; margin: 0; font-size: 13px; font-weight: 750; color: var(--text-main, #ffffff); }
.emd-section-title-left { display: flex; align-items: center; gap: 8px; }
.emd-current { display: flex; align-items: center; gap: 14px; }
.emd-cover { width: 50px; height: 50px; border-radius: 10px; object-fit: cover; flex-shrink: 0; background: var(--bg-elevated, #29292b); border: 1px solid var(--border-light, #444446); }
.emd-current-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.emd-current-title { margin: 0; font-size: 14px; font-weight: 750; color: var(--text-main, #ffffff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.emd-current-artist { margin: 0; font-size: 11.5px; font-weight: 500; color: var(--text-secondary, #bcbcbc); }
.emd-savedir { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-radius: 10px; background: var(--bg-elevated, #29292b); border: 1px solid var(--border-light, #444446); }
.emd-savedir-path { flex: 1; min-width: 0; font-size: 11.5px; font-weight: 600; color: var(--text-secondary, #bcbcbc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.emd-quality-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.emd-quality-label { font-size: 12px; font-weight: 700; color: var(--text-main, #ffffff); }

/* 筛选芯片与搜索 */
.emd-chip-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.emd-chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border-light, #444446); background: var(--surface-card-base, #343436); color: var(--text-secondary, #bcbcbc); border-radius: 8px; padding: 4px 12px; font-size: 11.5px; font-weight: 650; cursor: pointer; transition: all 0.15s ease; }
.emd-chip:hover { color: var(--text-main, #ffffff); background: var(--bg-elevated, #29292b); }
.emd-chip-active { background: color-mix(in srgb, var(--color-primary, #00cc65) 14%, transparent); border-color: var(--color-primary, #00cc65); color: var(--color-primary, #00cc65); }
.emd-search { width: 100%; box-sizing: border-box; border: 1px solid var(--border-light, #444446); background: var(--bg-elevated, #29292b); color: var(--text-main, #ffffff); border-radius: 10px; padding: 7px 14px; font-size: 12px; font-weight: 500; outline: none; margin-bottom: 10px; transition: border-color 0.15s ease; }
.emd-search:focus { border-color: var(--color-primary, #00cc65); }
.emd-search::placeholder { color: var(--text-secondary, #bcbcbc); opacity: 0.6; }

/* 歌曲批量下载列表 */
.emd-song-list { display: flex; flex-direction: column; max-height: 280px; overflow-y: auto; border: 1px solid var(--border-light, #444446); border-radius: 10px; background: var(--bg-elevated, #29292b); }
.emd-song-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border-light, #444446); transition: background 0.12s ease; }
.emd-song-row:last-child { border-bottom: none; }
.emd-song-row:hover { background: var(--surface-card-base, #343436); }
.emd-song-row input { accent-color: var(--color-primary, #00cc65); }
.emd-song-name { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 650; color: var(--text-main, #ffffff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.emd-batch-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }

/* 任务列表与流式监控项 */
.emd-task-list { display: flex; flex-direction: column; gap: 6px; }
.emd-task { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border-light, #444446); border-radius: 10px; background: var(--surface-card-base, #343436); padding: 10px 14px; position: relative; overflow: hidden; transition: all 0.18s ease; }
.emd-task:hover { border-color: color-mix(in srgb, var(--color-primary, #00cc65) 30%, var(--border-light, #444446)); }
.emd-task-head { display: flex; align-items: center; gap: 10px; }
.emd-task-status-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.emd-task-name { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 700; color: var(--text-main, #ffffff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 速率脉冲与标签 */
.emd-speed-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: var(--color-primary, #00cc65); font-variant-numeric: tabular-nums; }
.emd-pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary, #00cc65); animation: emd-pulse 1.6s infinite; }
@keyframes emd-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.85); }
}

.emd-tag { display: inline-flex; align-items: center; border-radius: 6px; padding: 2px 7px; font-size: 10px; font-weight: 750; flex-shrink: 0; border: 1px solid transparent; }
.emd-tag-quality { background: var(--bg-elevated, #29292b); color: var(--text-secondary, #bcbcbc); border-color: var(--border-light, #444446); font-variant-numeric: tabular-nums; }
.emd-tag-queued { background: var(--bg-elevated, #29292b); color: var(--text-secondary, #bcbcbc); border-color: var(--border-light, #444446); }
.emd-tag-launching { background: color-mix(in srgb, #f59e0b 14%, transparent); color: #f59e0b; border-color: color-mix(in srgb, #f59e0b 25%, transparent); }
.emd-tag-downloading { background: color-mix(in srgb, var(--color-primary, #00cc65) 14%, transparent); color: var(--color-primary, #00cc65); border-color: color-mix(in srgb, var(--color-primary, #00cc65) 25%, transparent); }
.emd-tag-done { background: color-mix(in srgb, #10b981 14%, transparent); color: #10b981; border-color: color-mix(in srgb, #10b981 25%, transparent); }
.emd-tag-failed { background: color-mix(in srgb, #ef4444 14%, transparent); color: #ef4444; border-color: color-mix(in srgb, #ef4444 25%, transparent); }

/* 细长微进度槽 */
.emd-progress { height: 3px; border-radius: 999px; background: var(--bg-elevated, #29292b); overflow: hidden; margin-top: 2px; }
.emd-progress-fill { height: 100%; border-radius: 999px; background: var(--color-primary, #00cc65); transition: width 0.3s ease; }
.emd-task-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; font-weight: 500; color: var(--text-secondary, #bcbcbc); }
.emd-task-meta-left { display: flex; align-items: center; gap: 8px; }
.emd-task-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; flex-shrink: 0; }
.emd-icon-btn { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-light, #444446); background: var(--bg-elevated, #29292b); width: 26px; height: 26px; border-radius: 6px; color: var(--text-secondary, #bcbcbc); cursor: pointer; transition: all 0.15s ease; }
.emd-icon-btn:hover { background: var(--surface-card-base, #343436); color: var(--text-main, #ffffff); border-color: var(--color-primary, #00cc65); }
.emd-icon-btn:disabled { opacity: 0.35; cursor: default; }

.emd-empty { padding: 48px 16px; text-align: center; font-size: 12px; font-weight: 600; color: var(--text-secondary, #bcbcbc); }
.emd-settings { display: flex; flex-direction: column; gap: 14px; }
.emd-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border-radius: 12px; background: var(--surface-card-base, #343436); border: 1px solid var(--border-light, #444446); }
.emd-setting-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.emd-setting-label { font-size: 13px; font-weight: 750; color: var(--text-main, #ffffff); }
.emd-setting-hint { font-size: 11.5px; font-weight: 500; color: var(--text-secondary, #bcbcbc); line-height: 1.4; }
.emd-spin { animation: emd-spin 0.9s linear infinite; }
@keyframes emd-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

// ---- 激活 ----

let store = null;

export function activate(ctx) {
  const { h, defineComponent, defineAsyncComponent, computed, ref, onMounted, resolveComponent } =
    ctx.vue;

  ctx.css.inject(CSS, { id: 'page' });

  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const PageScrollContainer = defineAsyncComponent(ctx.ui.components.PageScrollContainer);

  store = createDownloadStore(ctx);
  void store.restore();

  // ---- 任务行渲染 ----
  const renderTask = (task) => {
    const label = TASK_STATE_LABEL[task.state] || task.state;
    const isActive = task.state === 'downloading' || task.state === 'launching';
    const isFinished = task.state === 'done' || task.state === 'failed';
    const pct =
      task.percent != null && !Number.isNaN(Number(task.percent))
        ? Number(task.percent)
        : isActive
          ? 0
          : task.state === 'done'
            ? 100
            : 0;

    const metaParts = [];
    if (isActive) {
      metaParts.push(
        h('span', null, task.percent != null ? `${Number(task.percent).toFixed(1)}%` : '下载中…'),
      );
      if (task.speed) metaParts.push(h('span', null, task.speed));
      if (task.eta) metaParts.push(h('span', null, `剩余 ${task.eta}`));
    }
    if (task.note) metaParts.push(h('span', { class: 'emd-note' }, task.note));
    if (task.state === 'failed' && task.error) {
      metaParts.push(h('span', { style: { color: '#f87171' } }, task.error));
    }
    if (task.state === 'done' && task.finalPath) {
      metaParts.push(h('span', null, task.finalPath));
    }

    return h('div', { class: 'emd-task', key: task.id }, [
      h('div', { class: 'emd-task-head' }, [
        h('span', { class: 'emd-task-name' }, task.name),
        h('span', { class: 'emd-tag emd-tag-quality' }, task.quality === '320' ? '高品质' : '标准'),
        h('span', { class: `emd-tag emd-tag-${task.state}` }, label),
        h('div', { class: 'emd-task-actions' }, [
          isActive
            ? h(
                'button',
                { class: 'emd-icon-btn', title: '取消', onClick: () => store.cancelTask(task) },
                [iconSvg(h, ctx.icons.iconX, { size: 15 })],
              )
            : null,
          isFinished
            ? h(
                'button',
                { class: 'emd-icon-btn', title: '重试', onClick: () => store.retryTask(task) },
                [iconSvg(h, ctx.icons.iconRefreshCw, { size: 15 })],
              )
            : null,
          isFinished
            ? h(
                'button',
                { class: 'emd-icon-btn', title: '删除', onClick: () => store.removeTask(task) },
                [iconSvg(h, ctx.icons.iconTrash, { size: 15 })],
              )
            : null,
        ]),
      ]),
      isActive || task.state === 'done'
        ? h('div', { class: 'emd-progress' }, [
            h('div', { class: 'emd-progress-fill', style: { width: `${pct}%` } }),
          ])
        : null,
      metaParts.length > 0 ? h('div', { class: 'emd-task-meta' }, metaParts) : null,
    ]);
  };

  // ---- 下载页 ----
  const DownloadPage = defineComponent({
    name: 'echo-music-download-page',
    setup() {
      const Icon = resolveComponent('Icon');

      const currentTrack = computed(() => ctx.player?.currentTrack?.value ?? null);
      const queues = computed(() => ctx.playlist?.queues?.value ?? []);
      // 隐藏临时队列：搜索结果等（每次搜索都会生成标题重复的队列，不适合批量下载）
      const batchQueues = computed(() =>
        queues.value.filter((q) => q && q.type !== 'search'),
      );
      const selectedQueueId = ref('');
      const selectedHashes = ref(new Set());
      const batchSongs = ref([]);
      const rawCount = ref(0);
      const searchText = ref('');
      const loadingQueue = ref(false);

      const filteredSongs = computed(() => {
        const q = searchText.value.trim().toLowerCase();
        if (!q) return batchSongs.value;
        return batchSongs.value.filter((s) => {
          const m = buildSongName(s);
          return `${m.artist} ${m.title}`.toLowerCase().includes(q);
        });
      });

      let loadSeq = 0;
      const loadQueueSongs = async () => {
        const seq = ++loadSeq;
        loadingQueue.value = true;
        let songs = [];
        try {
          const id = selectedQueueId.value || undefined;
          songs = ctx.playlist?.getQueueSongs(id) ?? [];
          // 宿主对队列歌曲懒加载：重启后队列元数据已恢复但 songs 可能为空（songCount > 0），
          // 需经 store.ensurePlaybackQueueSongsLoaded 从磁盘补齐后再读
          if (
            songs.length === 0 &&
            id &&
            typeof ctx.playlist?.store?.ensurePlaybackQueueSongsLoaded === 'function'
          ) {
            const queue = await ctx.playlist.store.ensurePlaybackQueueSongsLoaded(id);
            if (queue) songs = ctx.playlist?.getQueueSongs(id) ?? queue.songs ?? [];
          }
        } catch (e) {
          songs = [];
        }
        if (seq !== loadSeq) return;
        loadingQueue.value = false;
        rawCount.value = Array.isArray(songs) ? songs.length : 0;
        batchSongs.value = (Array.isArray(songs) ? songs : []).slice(0, MAX_BATCH_RENDER);
        selectedHashes.value = new Set();
      };

      onMounted(() => {
        try {
          const active = ctx.playlist?.activeQueue?.value ?? null;
          if (active && active.id && active.type !== 'search') {
            selectedQueueId.value = active.id;
          }
        } catch (e) {
          /* ignore */
        }
        if (selectedQueueId.value) {
          void loadQueueSongs();
        } else {
          batchSongs.value = [];
          rawCount.value = 0;
        }
      });

      const selectQueue = (id) => {
        selectedQueueId.value = id;
        void loadQueueSongs();
      };

      const toggleSelect = (hash) => {
        const set = new Set(selectedHashes.value);
        if (set.has(hash)) set.delete(hash);
        else set.add(hash);
        selectedHashes.value = set;
      };
      const selectAll = () => {
        selectedHashes.value = new Set(
          filteredSongs.value.filter((s) => s && s.hash).map((s) => s.hash),
        );
      };
      const clearSelect = () => {
        selectedHashes.value = new Set();
      };

      const downloadCurrent = () => {
        const track = currentTrack.value;
        if (!track || !track.hash) {
          ctx.toast.info('当前没有可下载的歌曲');
          return;
        }
        store.enqueueSongs([track]);
      };
      const downloadSelected = () => {
        const picked = batchSongs.value.filter((s) => s && selectedHashes.value.has(s.hash));
        if (picked.length === 0) {
          ctx.toast.info('请先勾选要下载的歌曲');
          return;
        }
        store.enqueueSongs(picked);
      };

      return () => {
        const track = currentTrack.value;
        const meta = track ? buildSongName(track) : null;
        const hasSaveDir = Boolean(store.state.saveDir);
        const truncated = rawCount.value > MAX_BATCH_RENDER;

        return h('div', { class: 'emd-root' }, [
          h(PageScrollContainer, null, {
            default: () =>
              h('div', { class: 'emd-page' }, [
                h('div', { class: 'emd-header' }, [
                  h(Icon, {
                    icon: ctx.icons.iconArrowBarToDown,
                    width: 26,
                    height: 26,
                    class: 'emd-header-icon',
                  }),
                  h('h1', { class: 'emd-title' }, '歌曲下载'),
                ]),

                // 下载设置：保存目录 + 音质
                h('section', { class: 'emd-section' }, [
                  h('h2', { class: 'emd-section-title' }, [
                    iconSvg(h, ctx.icons.iconFolderOpen, { size: 16 }),
                    '下载设置',
                  ]),
                  h('div', { class: 'emd-savedir' }, [
                    h(
                      'span',
                      { class: 'emd-savedir-path' },
                      hasSaveDir ? store.state.saveDir : '未选择目录',
                    ),
                    h(
                      Button,
                      { variant: 'outline', size: 'xs', onClick: store.chooseSaveDir },
                      { default: () => '更改目录' },
                    ),
                  ]),
                  h('div', { class: 'emd-quality-row' }, [
                    h('span', { class: 'emd-quality-label' }, '音质'),
                    ...QUALITY_OPTIONS.map((o) =>
                      h(
                        'button',
                        {
                          class: [
                            'emd-chip',
                            store.state.quality === o.value ? 'emd-chip-active' : '',
                          ],
                          onClick: () => store.setQuality(o.value),
                        },
                        o.label,
                      ),
                    ),
                  ]),
                ]),

                // 当前播放
                h('section', { class: 'emd-section' }, [
                  h('h2', { class: 'emd-section-title' }, [
                    iconSvg(h, ctx.icons.iconMusic, { size: 16 }),
                    '当前播放',
                  ]),
                  track && track.hash
                    ? h('div', { class: 'emd-current' }, [
                        track.coverUrl
                          ? h('img', { class: 'emd-cover', src: track.coverUrl, alt: '' })
                          : h('div', { class: 'emd-cover' }),
                        h('div', { class: 'emd-current-info' }, [
                          h('p', { class: 'emd-current-title' }, meta?.title || '未知歌曲'),
                          h('p', { class: 'emd-current-artist' }, meta?.artist || '未知歌手'),
                        ]),
                        h(
                          Button,
                          { variant: 'primary', size: 'sm', disabled: !hasSaveDir, onClick: downloadCurrent },
                          { default: () => '下载' },
                        ),
                      ])
                    : h('p', { class: 'emd-empty' }, '当前没有播放歌曲'),
                ]),

                // 歌单批量
                h('section', { class: 'emd-section' }, [
                  h('h2', { class: 'emd-section-title' }, [
                    iconSvg(h, ctx.icons.iconList, { size: 16 }),
                    '歌单批量下载',
                  ]),
                  h(
                    'div',
                    { class: 'emd-chip-row' },
                    batchQueues.value.map((q) =>
                      h(
                        'button',
                        {
                          class: ['emd-chip', selectedQueueId.value === q.id ? 'emd-chip-active' : ''],
                          key: q.id,
                          onClick: () => selectQueue(q.id),
                        },
                        q.title || q.id || '未命名列表',
                      ),
                    ),
                  ),
                  batchSongs.value.length === 0
                    ? h('p', { class: 'emd-empty' }, loadingQueue.value ? '加载中…' : '该列表暂无歌曲')
                    : [
                        h('input', {
                          class: 'emd-search',
                          type: 'text',
                          placeholder: '搜索歌单内歌曲',
                          value: searchText.value,
                          onInput: (e) => {
                            searchText.value = e.target?.value ?? '';
                          },
                        }),
                        filteredSongs.value.length === 0
                          ? h('p', { class: 'emd-empty' }, '没有匹配的歌曲')
                          : h(
                              'div',
                              { class: 'emd-song-list' },
                              filteredSongs.value.map((s) => {
                                const m = buildSongName(s);
                                const checked = selectedHashes.value.has(s.hash);
                                return h('div', { class: 'emd-song-row', key: s.hash }, [
                                  h('input', {
                                    type: 'checkbox',
                                    checked,
                                    onChange: () => toggleSelect(s.hash),
                                  }),
                                  h(
                                    'span',
                                    {
                                      class: 'emd-song-name',
                                      onClick: () => toggleSelect(s.hash),
                                    },
                                    m.artist ? `${m.artist} - ${m.title}` : m.title,
                                  ),
                                  h(
                                    'button',
                                    {
                                      class: 'emd-icon-btn',
                                      title: '下载',
                                      disabled: !hasSaveDir,
                                      onClick: () => store.enqueueSongs([s]),
                                    },
                                    [iconSvg(h, ctx.icons.iconArrowBarToDown, { size: 15 })],
                                  ),
                                ]);
                              }),
                            ),
                        truncated
                          ? h(
                              'p',
                              { class: 'emd-hint' },
                              `列表较长，仅显示前 ${MAX_BATCH_RENDER} 首，可用搜索定位`,
                            )
                          : null,
                        h('div', { class: 'emd-batch-actions' }, [
                          h('button', { class: 'emd-chip', onClick: selectAll }, '全选'),
                          h('button', { class: 'emd-chip', onClick: clearSelect }, '清除'),
                          h(
                            'span',
                            { class: 'emd-hint', style: { margin: '0' } },
                            `已选 ${selectedHashes.value.size} 首`,
                          ),
                          h(
                            Button,
                            {
                              variant: 'primary',
                              size: 'sm',
                              disabled: !hasSaveDir || selectedHashes.value.size === 0,
                              onClick: downloadSelected,
                              style: { marginLeft: 'auto' },
                            },
                            { default: () => '批量下载' },
                          ),
                        ]),
                      ],
                ]),

                // 任务列表
                h('section', { class: 'emd-section' }, [
                  h('div', { class: 'emd-batch-actions', style: { marginTop: '0' } }, [
                    h('h2', { class: 'emd-section-title', style: { margin: '0' } }, [
                      iconSvg(h, ctx.icons.iconArrowBarToDown, { size: 16 }),
                      '下载任务',
                    ]),
                    h(
                      'button',
                      { class: 'emd-chip', style: { marginLeft: 'auto' }, onClick: store.clearFinished },
                      '清空已完成',
                    ),
                  ]),
                  store.state.tasks.length === 0
                    ? h('p', { class: 'emd-empty' }, '暂无下载任务')
                    : h(
                        'div',
                        { class: 'emd-task-list', style: { marginTop: '12px' } },
                        store.state.tasks.map((task) => renderTask(task)),
                      ),
                ]),
              ]),
          }),
        ]);
      };
    },
  });

  // ---- 设置面板 ----
  const SettingsPanel = defineComponent({
    name: 'echo-music-download-settings',
    setup() {
      const hasSaveDir = computed(() => Boolean(store.state.saveDir));
      return () =>
        h('div', { class: 'emd-settings' }, [
          h('div', { class: 'emd-setting-row' }, [
            h('div', { class: 'emd-setting-copy' }, [
              h('div', { class: 'emd-setting-label' }, '歌曲保存目录'),
              h(
                'div',
                { class: 'emd-setting-hint' },
                hasSaveDir.value ? store.state.saveDir : '尚未选择，请先选择保存目录',
              ),
            ]),
            h(
              Button,
              { variant: 'outline', size: 'xs', onClick: store.chooseSaveDir },
              { default: () => '选择目录' },
            ),
          ]),
          h('div', { class: 'emd-setting-copy' }, [
            h('div', { class: 'emd-setting-label' }, '下载音质'),
            h(
              'div',
              { class: 'emd-setting-hint' },
              '320 为高品质 MP3；免费账号拿不到 320 时自动回退标准音质',
            ),
            h(
              'div',
              { class: 'emd-chip-row', style: { margin: '6px 0 0' } },
              QUALITY_OPTIONS.map((o) =>
                h(
                  'button',
                  {
                    class: ['emd-chip', store.state.quality === o.value ? 'emd-chip-active' : ''],
                    onClick: () => store.setQuality(o.value),
                  },
                  o.label,
                ),
              ),
            ),
          ]),
          h('div', { class: 'emd-setting-copy' }, [
            h('div', { class: 'emd-setting-label' }, '同时下载数'),
            h('div', { class: 'emd-setting-hint' }, '每首一个 aria2c 进程，建议 2-3'),
            h(
              'div',
              { class: 'emd-chip-row', style: { margin: '6px 0 0' } },
              [1, 2, 3, 4].map((n) =>
                h(
                  'button',
                  {
                    class: ['emd-chip', store.state.maxConcurrent === n ? 'emd-chip-active' : ''],
                    onClick: () => store.setMaxConcurrent(n),
                  },
                  String(n),
                ),
              ),
            ),
          ]),
          h('div', { class: 'emd-setting-copy' }, [
            h('div', { class: 'emd-setting-label' }, '文件名格式'),
            h('div', { class: 'emd-setting-hint' }, '对之后加入队列的歌曲生效'),
            h(
              'div',
              { class: 'emd-chip-row', style: { margin: '6px 0 0' } },
              NAME_FORMAT_OPTIONS.map((o) =>
                h(
                  'button',
                  {
                    class: ['emd-chip', store.state.nameFormat === o.value ? 'emd-chip-active' : ''],
                    onClick: () => store.setNameFormat(o.value),
                  },
                  o.label,
                ),
              ),
            ),
          ]),
          h('div', { class: 'emd-setting-copy' }, [
            h('div', { class: 'emd-setting-label' }, '使用说明'),
            h(
              'div',
              { class: 'emd-setting-hint' },
              '下载走酷狗官方接口（经典 /song/url），仅 128/320 两档明文 MP3，不涉及加密 DRM。首次下载会弹出「允许插件运行本地程序（aria2c）」确认框，允许一次后不再重复。',
            ),
          ]),
        ]);
    },
  });

  // ---- 注册 ----
  ctx.ui.addPage({
    id: 'downloads',
    title: '歌曲下载',
    icon: 'tabler:download',
    component: DownloadPage,
    order: 30,
    sidebar: true,
  });

  ctx.commands.register(
    'echo-music-download:open',
    () => ctx.router.push('/main/plugin/echo-music-download/downloads'),
    { title: '歌曲下载' },
  );

  // 歌曲右键菜单「下载到本地」（plugin-owned 贡献，宿主在插件停用时自动清理）
  ctx.ui.addSongContextMenuItem({
    id: 'download',
    label: '下载到本地',
    visible: (song) => Boolean(song?.hash),
    onSelect: (song) => store.enqueueSongs([song]),
  });

  ctx.ui.settings.define({
    id: 'echo-music-download',
    title: '歌曲下载',
    description: '保存目录、音质、并发数与文件名格式',
    component: SettingsPanel,
  });
}

export function deactivate() {
  try {
    store?.dispose();
  } catch (e) {
    /* ignore */
  }
  store = null;
}
