// 歌曲下载插件（echo-music-download v2.3.0）
// 特性：
// 1. 全新防误操作任务管理架构：单曲 / 批量 / 全局暂停、恢复与取消，FIFO 队列调度，下载确认与取消确认弹窗
// 2. EchoMusic v2.3.x 原生视觉重构：PageScrollContainer + DetailPageSliverHeader + PageStickyHeader + CustomTabBar + Switch + Button + Badge + SongSearchInput + 主题自适应 CSS 变量
// 3. 纯 JS 音频标签与封面内嵌：支持 MP3 (ID3v2.3: TIT2/TPE1/TALB/USLT/APIC) 与 FLAC (Vorbis Comment Block 4 + Picture Block 6)
// 4. 同名双语 .lrc 歌词文件自动生成（酷狗原词 + 联动 echo-music-unblock / 网易云双语中译合并）
// 5. 用户全量歌单（我喜欢 / 自建 / 收藏）与播放队列安全选歌批量下载、按歌单子目录归档（{playlist}/{filename}）及增量跳过已下载歌曲
// 6. 灰歌 / VIP 受限歌曲联动 echo-music-unblock 多源解灰下载 + 宿主全局任务面板（ctx.tasks.register）进度同步

// ---- 常量定义 ----

const POLL_INTERVAL_MS = 700;
const LOG_MAX_BYTES = 512 * 1024;
const STALL_TIMEOUT_MS = 30 * 1000;
const MAX_READ_CHUNK_BYTES = 4 * 1024 * 1024; // 宿主 ctx.fs.readFileBytes 单次上限 4 MiB
const MAX_WRITE_FILE_BYTES = 8 * 1024 * 1024; // 宿主 ctx.fs.writeFile 单次上限 8 MiB

const STORAGE_SAVE_DIR = 'emd.saveDir';
const STORAGE_SAVE_DIR_REF = 'emd.saveDirRef';
const STORAGE_TASKS = 'emd.tasks';
const STORAGE_QUALITY = 'emd.quality';
const STORAGE_NAME_FORMAT = 'emd.nameFormat';
const STORAGE_MAX_CONCURRENT = 'emd.maxConcurrent';
const STORAGE_OPTIONS = 'emd.options.v22';

const MAX_CONCURRENT_MIN = 1;
const MAX_CONCURRENT_MAX = 4;
const PAGE_RENDER_STEP = 150;

const QUALITY_OPTIONS = [
  { value: '128', label: '标准 128k' },
  { value: '320', label: '高品 320k' },
  { value: 'flac', label: '无损 FLAC 优先' },
];

const NAME_FORMAT_OPTIONS = [
  { value: 'artist-title', label: '歌手 - 歌名' },
  { value: 'title-artist', label: '歌名 - 歌手' },
  { value: 'title', label: '仅歌名' },
];

const TASK_STATE_LABEL = {
  queued: '排队中',
  launching: '解析中',
  downloading: '下载中',
  tagging: '写标签中',
  paused: '已暂停',
  done: '已完成',
  canceled: '已取消',
  failed: '失败',
};

const DEFAULT_OPTIONS = {
  embedTags: true,
  embedCover: true,
  embedLyrics: true,
  writeLrc: true,
  preferBilingualLrc: true,
  useUnblockFallback: true,
  playlistSubfolder: false,
  skipExisting: true,
};

// ---- 内联图标与渲染辅助 ----

const ICONS = {
  download: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12"/>',
  },
  folder: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>',
  },
  music: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
  },
  check: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5L20 7"/>',
  },
  refresh: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-5v5h5M4 13a8.1 8.1 0 0 0 15.5 2m.5 5v-5h-5"/>',
  },
  trash: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
  },
  close: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18 6L6 18M6 6l12 12"/>',
  },
  tag: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7.5 7.5h.01M3 6a3 3 0 0 1 3-3h5.586a1 1 0 0 1 .707.293l7.414 7.414a2 2 0 0 1 0 2.828l-5.586 5.586a2 2 0 0 1-2.828 0L3.879 11.707A1 1 0 0 1 3.586 11V6z"/>',
  },
  sparkles: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/>',
  },
  list: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01"/>',
  },
  pause: {
    width: 24,
    height: 24,
    body: '<rect x="6" y="5" width="4" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="5" width="4" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>',
  },
  play: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5v14l12-7z"/>',
  },
  alert: {
    width: 24,
    height: 24,
    body: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
  },
  checkSquare: {
    width: 24,
    height: 24,
    body: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/>',
  },
  stop: {
    width: 24,
    height: 24,
    body: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>',
  },
};

const iconSvg = (h, iconData, { size = 16, className = '' } = {}) =>
  h('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: `0 0 ${iconData?.width || 24} ${iconData?.height || 24}`,
    class: className,
    'aria-hidden': 'true',
    innerHTML: iconData?.body ?? '',
  });

const HEADER_COVER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
    <defs>
      <linearGradient id="emdGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#059669"/>
        <stop offset="50%" stop-color="#0d9488"/>
        <stop offset="100%" stop-color="#2563eb"/>
      </linearGradient>
    </defs>
    <rect width="240" height="240" rx="36" fill="url(#emdGrad)"/>
    <circle cx="120" cy="116" r="64" fill="rgba(255,255,255,0.12)"/>
    <path d="M84 148v10a10 10 0 0 0 10 10h52a10 10 0 0 0 10-10v-10M98 114l22 22 22-22M120 74v60" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
)}`;

// ---- 通用工具函数 ----

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

const buildSongMeta = (song) => {
  if (!song || typeof song !== 'object') {
    return { hash: '', title: '', artist: '', album: '', coverUrl: '', duration: 0 };
  }
  const hash = String(song.hash || song.FileHash || song.audio_info?.hash || '').trim();
  let title = String(song.title ?? song.songname ?? song.name ?? song.filename ?? '').trim();
  let artist = String(
    song.artist ||
      song.singername ||
      (Array.isArray(song.artists)
        ? song.artists.map((a) => a?.name || a).filter(Boolean).join('、')
        : '') ||
      (Array.isArray(song.singers)
        ? song.singers.map((a) => a?.name || a).filter(Boolean).join('、')
        : '') ||
      '',
  ).trim();
  if (title.includes(' - ') && (!artist || title.startsWith(`${artist} - `))) {
    const parts = title.split(' - ');
    if (!artist) artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  }
  const album = String(song.album || song.album_name || song.remark || '').trim();
  const rawCover = String(
    song.coverUrl || song.cover || song.img || song.album_img || song.trans_param?.union_cover || '',
  ).trim();
  const coverUrl = rawCover ? rawCover.replace(/\{size\}/g, '480') : '';
  const duration = Number(song.duration || song.timelength || 0);
  return { hash, title, artist, album, coverUrl, duration };
};

const sanitizePathSegment = (segment, fallback = '未命名') => {
  let clean = String(segment || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  if (!clean) clean = fallback;
  if (clean.length > 80) clean = clean.slice(0, 80).trim();
  return clean;
};

const buildBaseFilename = (artist, title, format = 'artist-title') => {
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
  if (base.length > 120) base = base.slice(0, 120).trim();
  return base;
};

const sanitizeFilename = (artist, title, ext, format = 'artist-title', subfolder = '') => {
  const base = buildBaseFilename(artist, title, format);
  const file = `${base}.${ext || 'mp3'}`;
  if (subfolder && String(subfolder).trim()) {
    const folder = sanitizePathSegment(subfolder, '歌单');
    return `${folder}/${file}`;
  }
  return file;
};

const replaceFileExt = (relativePath, newExt) => {
  const cleanExt = String(newExt || '').replace(/^\./, '');
  const idx = relativePath.lastIndexOf('.');
  const slashIdx = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));
  if (idx > slashIdx) {
    return `${relativePath.slice(0, idx)}.${cleanExt}`;
  }
  return `${relativePath}.${cleanExt}`;
};

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

const parseSpeedToBytes = (speedStr) => {
  if (!speedStr) return 0;
  const m = String(speedStr).match(/([0-9.]+)\s*([KMG]?i?B)/i);
  if (!m) return 0;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) return 0;
  const unit = m[2].toUpperCase();
  if (unit.startsWith('G')) return val * 1024 * 1024 * 1024;
  if (unit.startsWith('M')) return val * 1024 * 1024;
  if (unit.startsWith('K')) return val * 1024;
  return val;
};

const getFsGrantApi = (ctx) => {
  if (ctx?.fs && typeof ctx.fs.requestDirectory === 'function') return ctx.fs;
  if (ctx?.fs?.files && typeof ctx.fs.files.requestDirectory === 'function') return ctx.fs.files;
  return null;
};

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
    const m = url
      .split('?')[0]
      .split('#')[0]
      .match(/\.([a-zA-Z0-9]{1,5})$/);
    if (m) return m[1].toLowerCase();
  }
  return 'mp3';
};

// ============================================================================
// 纯 JS 二进制音频标签内嵌引擎（ID3v2.3 for MP3 & Vorbis/Picture for FLAC）
// 100% 兼容桌面播放器与 EchoMusic 官方 local-music 插件的解析器
// ============================================================================

const encodeUtf8 = (str) => new TextEncoder().encode(String(str ?? ''));

const encodeAscii = (str) => {
  const s = String(str ?? '');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) {
    out[i] = s.charCodeAt(i) & 0x7f;
  }
  return out;
};

// UTF-16LE with BOM (0xFF 0xFE)
const encodeUtf16LeWithBom = (str) => {
  const s = String(str ?? '');
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[2 + i * 2 + 1] = (code >> 8) & 0xff;
  }
  return out;
};

const writeUInt32BE = (buf, offset, val) => {
  const v = val >>> 0;
  buf[offset] = (v >>> 24) & 0xff;
  buf[offset + 1] = (v >>> 16) & 0xff;
  buf[offset + 2] = (v >>> 8) & 0xff;
  buf[offset + 3] = v & 0xff;
};

const writeUInt32LE = (buf, offset, val) => {
  const v = val >>> 0;
  buf[offset] = v & 0xff;
  buf[offset + 1] = (v >>> 8) & 0xff;
  buf[offset + 2] = (v >>> 16) & 0xff;
  buf[offset + 3] = (v >>> 24) & 0xff;
};

const writeSynchsafe32 = (buf, offset, val) => {
  const v = val >>> 0;
  buf[offset] = (v >>> 21) & 0x7f;
  buf[offset + 1] = (v >>> 14) & 0x7f;
  buf[offset + 2] = (v >>> 7) & 0x7f;
  buf[offset + 3] = v & 0x7f;
};

const readSynchsafe32 = (buf, offset) =>
  ((buf[offset] & 0x7f) << 21) |
  ((buf[offset + 1] & 0x7f) << 14) |
  ((buf[offset + 2] & 0x7f) << 7) |
  (buf[offset + 3] & 0x7f);

const concatUint8Arrays = (arrays) => {
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
};

const detectImageMime = (bytes) => {
  if (!bytes || bytes.byteLength < 4) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'image/webp';
  }
  return 'image/jpeg';
};

const buildId3v23Frame = (frameId, payloadBytes) => {
  const idBytes = encodeAscii(frameId.slice(0, 4).padEnd(4, ' '));
  const header = new Uint8Array(10);
  header.set(idBytes, 0);
  writeUInt32BE(header, 4, payloadBytes.byteLength);
  header[8] = 0x00;
  header[9] = 0x00;
  return concatUint8Arrays([header, payloadBytes]);
};

const buildId3v23TextFrame = (frameId, text) => {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  const textBytes = encodeUtf16LeWithBom(clean);
  const payload = new Uint8Array(1 + textBytes.byteLength);
  payload[0] = 0x01; // UTF-16 with BOM
  payload.set(textBytes, 1);
  return buildId3v23Frame(frameId, payload);
};

const buildId3v23UsltFrame = (lyricsText) => {
  const clean = String(lyricsText ?? '').trim();
  if (!clean) return null;
  // encoding(1: 0x01 UTF-16) + lang(3: 'zho') + descriptor(4: 0xFF 0xFE 0x00 0x00) + lyrics(UTF-16LE with BOM)
  const lyricBytes = encodeUtf16LeWithBom(clean);
  const prefix = new Uint8Array([0x01, 0x7a, 0x68, 0x6f, 0xff, 0xfe, 0x00, 0x00]);
  return buildId3v23Frame('USLT', concatUint8Arrays([prefix, lyricBytes]));
};

const buildId3v23ApicFrame = (coverBytes, mimeType = '') => {
  if (!coverBytes || coverBytes.byteLength === 0) return null;
  const mime = mimeType || detectImageMime(coverBytes);
  const mimeBytes = encodeAscii(mime);
  // encoding(1: 0x00 ISO-8859-1) + mime + 0x00 + picType(1: 0x03 Cover front) + desc(1: 0x00) + coverBytes
  const prefix = new Uint8Array(1 + mimeBytes.byteLength + 1 + 1 + 1);
  prefix[0] = 0x00;
  prefix.set(mimeBytes, 1);
  prefix[1 + mimeBytes.byteLength] = 0x00;
  prefix[2 + mimeBytes.byteLength] = 0x03;
  prefix[3 + mimeBytes.byteLength] = 0x00;
  return buildId3v23Frame('APIC', concatUint8Arrays([prefix, coverBytes]));
};

export const embedMp3Tags = (audioBytes, meta = {}) => {
  if (!(audioBytes instanceof Uint8Array)) return audioBytes;
  const frames = [];
  const tit2 = buildId3v23TextFrame('TIT2', meta.title);
  if (tit2) frames.push(tit2);
  const tpe1 = buildId3v23TextFrame('TPE1', meta.artist);
  if (tpe1) frames.push(tpe1);
  const talb = buildId3v23TextFrame('TALB', meta.album);
  if (talb) frames.push(talb);
  if (meta.lyrics) {
    const uslt = buildId3v23UsltFrame(meta.lyrics);
    if (uslt) frames.push(uslt);
  }
  if (meta.coverBytes && meta.coverBytes.byteLength > 0) {
    const apic = buildId3v23ApicFrame(meta.coverBytes, meta.coverMime);
    if (apic) frames.push(apic);
  }
  if (frames.length === 0) return audioBytes;

  const framesBlob = concatUint8Arrays(frames);
  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = 0x03; // v2.3
  header[4] = 0x00;
  header[5] = 0x00;
  writeSynchsafe32(header, 6, framesBlob.byteLength);

  // 若原 MP3 已有 ID3v2 头部，先剥离旧头部再写入新头部，避免重复嵌套
  let audioStartOffset = 0;
  if (
    audioBytes.byteLength >= 10 &&
    audioBytes[0] === 0x49 &&
    audioBytes[1] === 0x44 &&
    audioBytes[2] === 0x33
  ) {
    const oldFlags = audioBytes[5];
    const oldSize = readSynchsafe32(audioBytes, 6);
    const footerSize = oldFlags & 0x10 ? 10 : 0;
    const candidateOffset = 10 + oldSize + footerSize;
    if (candidateOffset <= audioBytes.byteLength) {
      audioStartOffset = candidateOffset;
    }
  }

  return concatUint8Arrays([header, framesBlob, audioBytes.subarray(audioStartOffset)]);
};

const buildFlacVorbisCommentBlockBody = (meta = {}) => {
  const vendorBytes = encodeUtf8('EchoMusic Download v2.3');
  const comments = [];
  const pushComment = (key, value) => {
    const clean = String(value ?? '').trim();
    if (!clean) return;
    comments.push(encodeUtf8(`${key}=${clean}`));
  };
  pushComment('TITLE', meta.title);
  pushComment('ARTIST', meta.artist);
  pushComment('ALBUM', meta.album);
  if (meta.lyrics) {
    pushComment('LYRICS', meta.lyrics);
  }

  let totalLen = 4 + vendorBytes.byteLength + 4;
  for (const c of comments) totalLen += 4 + c.byteLength;

  const body = new Uint8Array(totalLen);
  let offset = 0;
  writeUInt32LE(body, offset, vendorBytes.byteLength);
  offset += 4;
  body.set(vendorBytes, offset);
  offset += vendorBytes.byteLength;

  writeUInt32LE(body, offset, comments.length);
  offset += 4;
  for (const c of comments) {
    writeUInt32LE(body, offset, c.byteLength);
    offset += 4;
    body.set(c, offset);
    offset += c.byteLength;
  }
  return body;
};

const buildFlacPictureBlockBody = (coverBytes, mimeType = '') => {
  const mime = mimeType || detectImageMime(coverBytes);
  const mimeBytes = encodeAscii(mime);
  // type(4) + mimeLen(4) + mime + descLen(4:0) + width(4:0) + height(4:0) + depth(4:0) + colors(4:0) + dataLen(4) + data
  const totalLen = 4 + 4 + mimeBytes.byteLength + 4 + 16 + 4 + coverBytes.byteLength;
  const body = new Uint8Array(totalLen);
  let offset = 0;
  writeUInt32BE(body, offset, 3); // 3 = Cover (front)
  offset += 4;
  writeUInt32BE(body, offset, mimeBytes.byteLength);
  offset += 4;
  body.set(mimeBytes, offset);
  offset += mimeBytes.byteLength;
  // descLen(0) + width(0) + height(0) + depth(0) + colors(0) = 20 zero bytes
  offset += 20;
  writeUInt32BE(body, offset, coverBytes.byteLength);
  offset += 4;
  body.set(coverBytes, offset);
  return body;
};

const buildFlacMetadataBlock = (type, isLast, bodyBytes) => {
  const len = bodyBytes.byteLength;
  const header = new Uint8Array(4);
  header[0] = (isLast ? 0x80 : 0x00) | (type & 0x7f);
  header[1] = (len >>> 16) & 0xff;
  header[2] = (len >>> 8) & 0xff;
  header[3] = len & 0xff;
  return concatUint8Arrays([header, bodyBytes]);
};

export const embedFlacTags = (audioBytes, meta = {}) => {
  if (
    !(audioBytes instanceof Uint8Array) ||
    audioBytes.byteLength < 8 ||
    audioBytes[0] !== 0x66 || // 'f'
    audioBytes[1] !== 0x4c || // 'L'
    audioBytes[2] !== 0x61 || // 'a'
    audioBytes[3] !== 0x43 // 'C'
  ) {
    return audioBytes;
  }

  // 解析现有 FLAC 元数据块，保留非 4(VORBIS_COMMENT) / 6(PICTURE) / 1(PADDING) 的块
  const keptBlocks = [];
  let offset = 4;
  let foundLast = false;
  while (offset + 4 <= audioBytes.byteLength) {
    const headerByte = audioBytes[offset];
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const blockLen =
      (audioBytes[offset + 1] << 16) | (audioBytes[offset + 2] << 8) | audioBytes[offset + 3];
    const bodyStart = offset + 4;
    const bodyEnd = bodyStart + blockLen;
    if (bodyEnd > audioBytes.byteLength) {
      // 文件元数据块不完整，直接原样返回安全兜底
      return audioBytes;
    }
    if (blockType !== 4 && blockType !== 6 && blockType !== 1) {
      keptBlocks.push({ type: blockType, body: audioBytes.subarray(bodyStart, bodyEnd) });
    }
    offset = bodyEnd;
    if (isLast) {
      foundLast = true;
      break;
    }
  }
  if (!foundLast || keptBlocks.length === 0) return audioBytes;

  const vorbisBody = buildFlacVorbisCommentBlockBody(meta);
  keptBlocks.push({ type: 4, body: vorbisBody });

  if (meta.coverBytes && meta.coverBytes.byteLength > 0 && meta.coverBytes.byteLength < 0xffffff) {
    const picBody = buildFlacPictureBlockBody(meta.coverBytes, meta.coverMime);
    if (picBody.byteLength < 0xffffff) {
      keptBlocks.push({ type: 6, body: picBody });
    }
  }

  const encodedBlocks = [audioBytes.subarray(0, 4)];
  for (let i = 0; i < keptBlocks.length; i += 1) {
    const isLast = i === keptBlocks.length - 1;
    encodedBlocks.push(buildFlacMetadataBlock(keptBlocks[i].type, isLast, keptBlocks[i].body));
  }
  encodedBlocks.push(audioBytes.subarray(offset));
  return concatUint8Arrays(encodedBlocks);
};

// ---- 双语歌词与封面抓取辅助 ----

const parseLrcTimeLine = (line) => {
  const tags = [];
  const regex = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  let match;
  let lastIdx = 0;
  while ((match = regex.exec(line)) !== null) {
    const min = Number(match[1]);
    const sec = Number(match[2]);
    const frac = match[3] ? match[3].padEnd(3, '0').slice(0, 3) : '000';
    const ms = min * 60000 + sec * 1000 + Number(frac);
    tags.push({ raw: match[0], ms });
    lastIdx = regex.lastIndex;
  }
  if (tags.length === 0) return null;
  const text = line.slice(lastIdx).trim();
  return { tags, text };
};

const mergeBilingualLrc = (origLrc, transLrc) => {
  if (!origLrc) return '';
  if (!transLrc || !String(transLrc).trim()) return origLrc;
  const transMap = new Map();
  for (const line of String(transLrc).split(/\r?\n/)) {
    const parsed = parseLrcTimeLine(line);
    if (parsed && parsed.text && parsed.text !== '//') {
      for (const tag of parsed.tags) {
        transMap.set(Math.round(tag.ms / 100), parsed.text);
      }
    }
  }
  if (transMap.size === 0) return origLrc;
  const out = [];
  for (const line of String(origLrc).split(/\r?\n/)) {
    out.push(line);
    const parsed = parseLrcTimeLine(line);
    if (parsed && parsed.text) {
      for (const tag of parsed.tags) {
        const key = Math.round(tag.ms / 100);
        const trans =
          transMap.get(key) || transMap.get(key - 1) || transMap.get(key + 1) || '';
        if (trans && trans !== parsed.text) {
          out.push(`${tag.raw}${trans}`);
          break;
        }
      }
    }
  }
  return out.join('\n');
};

const fetchLyricsForTask = async (ctx, task, preferBilingual = true) => {
  // 1. 若用户启用双语优先且已激活 echo-music-unblock，优先尝试双语歌词兜底桥
  const unblockBridge = globalThis.__echoMusicUnblock;
  let kugouLyric = '';

  // 先尝试酷狗官方歌词
  if (task.hash && ctx?.kugou?.music?.searchLyric && ctx?.kugou?.music?.getLyric) {
    try {
      const searchRes = await ctx.kugou.music.searchLyric({
        hash: task.hash,
        keyword: `${task.artist} ${task.title}`.trim(),
      });
      const candidates =
        searchRes?.candidates || searchRes?.data?.candidates || searchRes?.info || [];
      if (Array.isArray(candidates) && candidates.length > 0 && candidates[0]?.id) {
        const lyricRes = await ctx.kugou.music.getLyric({
          id: candidates[0].id,
          accesskey: candidates[0].accesskey,
          fmt: 'lrc',
          decode: true,
        });
        const decoded =
          lyricRes?.decodeContent || lyricRes?.data?.decodeContent || lyricRes?.content || '';
        if (typeof decoded === 'string' && decoded.trim()) {
          kugouLyric = decoded.trim();
        }
      }
    } catch {}
  }

  // 2. 若酷狗无歌词，或者启用了双语歌词合并，尝试通过 echo-music-unblock 或网易云接口补齐翻译
  if (!kugouLyric && unblockBridge && typeof unblockBridge.resolveLyricForDownload === 'function') {
    try {
      const res = await unblockBridge.resolveLyricForDownload({
        hash: task.hash,
        title: task.title,
        artist: task.artist,
        duration: task.duration,
      });
      if (res?.lyric && String(res.lyric).trim()) {
        return { lyric: String(res.lyric).trim(), source: res.source || 'unblock' };
      }
    } catch {}
  }

  if (preferBilingual && ctx?.net?.fetch && task.title) {
    try {
      const keyword = `${task.title} ${task.artist}`.trim();
      const searchRes = await ctx.net.fetch(
        `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=5`,
        {
          method: 'GET',
          headers: { Referer: 'https://music.163.com/' },
          responseType: 'json',
          timeoutMs: 6500,
        },
      );
      const songs = searchRes?.body?.result?.songs || [];
      if (Array.isArray(songs) && songs.length > 0 && songs[0]?.id) {
        const lrcRes = await ctx.net.fetch(
          `https://music.163.com/api/song/lyric?id=${songs[0].id}&lv=1&kv=1&tv=-1`,
          {
            method: 'GET',
            headers: { Referer: 'https://music.163.com/' },
            responseType: 'json',
            timeoutMs: 6500,
          },
        );
        const orig = lrcRes?.body?.lrc?.lyric || '';
        const trans = lrcRes?.body?.tlyric?.lyric || '';
        if (orig && trans) {
          return { lyric: mergeBilingualLrc(orig, trans), source: 'netease-bilingual' };
        }
        if (!kugouLyric && orig) {
          return { lyric: String(orig).trim(), source: 'netease' };
        }
      }
    } catch {}
  }

  return { lyric: kugouLyric, source: kugouLyric ? 'kugou' : '' };
};

const fetchCoverBytesForTask = async (ctx, coverUrl) => {
  if (!coverUrl || !ctx?.net?.fetch) return null;
  try {
    const normalized = String(coverUrl).replace(/\{size\}/g, '480');
    const res = await ctx.net.fetch(normalized, {
      method: 'GET',
      responseType: 'arrayBuffer',
      timeoutMs: 9000,
    });
    if (!res || !res.ok || !res.body) return null;
    const bytes =
      res.body instanceof Uint8Array
        ? res.body
        : res.body instanceof ArrayBuffer
          ? new Uint8Array(res.body)
          : ArrayBuffer.isView(res.body)
            ? new Uint8Array(res.body.buffer, res.body.byteOffset, res.body.byteLength)
            : null;
    if (!bytes || bytes.byteLength < 64 || bytes.byteLength > 2.5 * 1024 * 1024) return null;
    const mime = detectImageMime(bytes);
    return { bytes, mime };
  } catch {
    return null;
  }
};

// 分块读取已下载音频文件（每次最多 4 MiB，最多读 2 次共 8 MiB，适配宿主 ctx.fs.writeFile 8 MiB 限制）
const toUint8ArrayFromFsRead = (res) => {
  if (!res) return null;
  if (res.bytes instanceof Uint8Array) return res.bytes;
  if (res.data instanceof ArrayBuffer) return new Uint8Array(res.data);
  if (ArrayBuffer.isView(res.data)) {
    return new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
  }
  return null;
};

const readDownloadedAudioBytes = async (ctx, fileRef) => {
  if (!ctx?.fs?.readFileBytes) return { ok: false, reason: 'no-api' };
  const first = await ctx.fs.readFileBytes(fileRef, {
    offset: 0,
    length: MAX_READ_CHUNK_BYTES,
    maxBytes: MAX_READ_CHUNK_BYTES,
  });
  const firstBytes = toUint8ArrayFromFsRead(first);
  if (!first || first.ok === false || !firstBytes) {
    return { ok: false, reason: 'read-failed' };
  }
  const totalSize = Number(first.size ?? first.totalSize ?? firstBytes.byteLength);
  if (totalSize > 7.6 * 1024 * 1024) {
    return { ok: false, reason: 'too-large', totalSize };
  }
  const isTruncated = Boolean(
    first.truncated || (first.eof === false && totalSize > firstBytes.byteLength),
  );
  if (isTruncated && totalSize > firstBytes.byteLength) {
    const remain = totalSize - firstBytes.byteLength;
    const second = await ctx.fs.readFileBytes(fileRef, {
      offset: firstBytes.byteLength,
      length: Math.min(MAX_READ_CHUNK_BYTES, remain),
      maxBytes: MAX_READ_CHUNK_BYTES,
    });
    const secondBytes = toUint8ArrayFromFsRead(second);
    if (!second || second.ok === false || !secondBytes) {
      return { ok: false, reason: 'read-chunk2-failed' };
    }
    return {
      ok: true,
      totalSize,
      bytes: concatUint8Arrays([firstBytes, secondBytes]),
    };
  }
  return { ok: true, totalSize, bytes: firstBytes };
};

// ---- 灰歌解灰下载兜底 ----

const resolveUnblockUrlForDownload = async (ctx, task, requestedQuality) => {
  // 1. 优先调用 echo-music-unblock 暴露的跨插件桥
  const unblockBridge = globalThis.__echoMusicUnblock;
  if (unblockBridge && typeof unblockBridge.resolveSongForDownload === 'function') {
    try {
      const res = await unblockBridge.resolveSongForDownload(
        {
          hash: task.hash,
          title: task.title,
          artist: task.artist,
          album: task.album,
          duration: task.duration,
          coverUrl: task.coverUrl,
        },
        requestedQuality,
      );
      if (res && res.url) {
        return {
          url: res.url,
          ext: extractExt(res, res.url),
          quality: res.quality || requestedQuality,
          sourceLabel: res.sourceLabel || res.sourceId || '解灰音源',
          headers: res.headers,
        };
      }
    } catch (e) {
      console.warn('[echo-music-download] 调用 echo-music-unblock 桥接失败:', e);
    }
  }

  // 2. 内置轻量级同曲异版 + Meting 聚合兜底（即使未安装 echo-music-unblock 也能救急）
  const keyword = `${task.title} ${task.artist}`.trim();
  if (!keyword) return null;

  if (ctx?.kugou?.search?.search && ctx?.kugou?.music?.getSongUrl) {
    try {
      const searchRes = await ctx.kugou.search.search({ keyword, page: 1, pagesize: 12 });
      const list =
        searchRes?.data?.lists || searchRes?.data?.info || searchRes?.lists || searchRes?.info || [];
      if (Array.isArray(list)) {
        for (const item of list.slice(0, 6)) {
          const candHash = String(item?.FileHash || item?.hash || '').trim();
          if (!candHash || candHash.toLowerCase() === String(task.hash || '').toLowerCase()) continue;
          const body = await ctx.kugou.music.getSongUrl(
            candHash,
            requestedQuality === 'flac' ? 'flac' : '320',
          );
          const url = extractSongUrl(body);
          if (url) {
            return {
              url,
              ext: extractExt(body, url),
              quality: requestedQuality === 'flac' ? 'flac' : '320',
              sourceLabel: '酷狗异版解灰',
            };
          }
        }
      }
    } catch {}
  }

  if (ctx?.net?.fetch) {
    try {
      const br = requestedQuality === 'flac' ? '999' : '320';
      const sRes = await ctx.net.fetch(
        `https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${encodeURIComponent(keyword)}&count=5&pages=1`,
        { method: 'GET', responseType: 'json', timeoutMs: 7000 },
      );
      const list = Array.isArray(sRes?.body) ? sRes.body : [];
      if (list.length > 0 && list[0]?.id) {
        const uRes = await ctx.net.fetch(
          `https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${encodeURIComponent(list[0].id)}&br=${br}`,
          { method: 'GET', responseType: 'json', timeoutMs: 7000 },
        );
        const url = String(uRes?.body?.url || '').trim();
        if (url && /^https?:\/\//i.test(url)) {
          return {
            url,
            ext: extractExt(uRes?.body, url),
            quality: Number(uRes?.body?.br) >= 700 ? 'flac' : '320',
            sourceLabel: '外部聚合解灰',
          };
        }
      }
    } catch {}
  }

  return null;
};

// ============================================================================
// 下载状态中心与任务引擎
// ============================================================================

export const createDownloadStore = (ctx) => {
  const { reactive } = ctx.vue;

  const state = reactive({
    saveDir: '',
    saveDirRef: null,
    quality: '320',
    nameFormat: 'artist-title',
    maxConcurrent: 2,
    options: { ...DEFAULT_OPTIONS },
    tasks: [],
    runningCount: 0,
    nextSeq: 0,
    existingFilesSet: new Set(),
  });

  // 严格通过 _countedRunning 布尔标记维护并发槽位，确保 runningCount 绝不漂移或泄漏
  const acquireRunningSlot = (task) => {
    if (!task || task._countedRunning) return;
    task._countedRunning = true;
    state.runningCount += 1;
  };

  const releaseRunningSlot = (task) => {
    if (!task || !task._countedRunning) return;
    task._countedRunning = false;
    state.runningCount = Math.max(0, state.runningCount - 1);
  };

  const detachNativeHandle = (task, { clearHandle = true } = {}) => {
    if (!task) return null;
    if (typeof task._unsub === 'function') {
      try {
        task._unsub();
      } catch {}
      task._unsub = null;
    }
    const handle = task._handle || null;
    if (clearHandle) {
      task._handle = null;
      task._resumeHandle = false;
    }
    return handle;
  };

  const normalizeTaskIdSet = (taskIds) => {
    if (taskIds instanceof Set) return taskIds;
    if (Array.isArray(taskIds)) return new Set(taskIds);
    return new Set();
  };

  // 同步宿主全局任务中心（兼容 EchoMusic v2.3.x PluginTaskRegistration API）
  let hostTaskController = null;
  let hostTaskStatus = null;
  let hostTaskTotal = 0;
  let hostTaskCompletedInBatch = 0;

  const syncHostTaskPanel = () => {
    if (!ctx?.tasks?.register) return;
    const activeTasks = state.tasks.filter((t) =>
      ['queued', 'launching', 'downloading', 'tagging'].includes(t.state),
    );
    const pausedTasks = state.tasks.filter((t) => t.state === 'paused');
    const remainingCount = activeTasks.length + pausedTasks.length;

    if (remainingCount === 0) {
      if (hostTaskController) {
        try {
          if (hostTaskCompletedInBatch > 0) {
            if (typeof hostTaskController.finish === 'function') {
              hostTaskController.finish('completed', {
                name: '歌曲下载已完成',
                progress: {
                  done: hostTaskTotal,
                  total: hostTaskTotal,
                  percent: 100,
                  label: '全部完成',
                },
                actions: [],
              });
            } else if (typeof hostTaskController.complete === 'function') {
              hostTaskController.complete({ description: '所有歌曲下载任务已完成' });
            }
          } else if (typeof hostTaskController.finish === 'function') {
            hostTaskController.finish('aborted', {
              name: '下载任务已取消',
              progress: {
                done: 0,
                total: hostTaskTotal,
                percent: 0,
                label: '已取消',
              },
              actions: [],
            });
          } else if (typeof hostTaskController.dismiss === 'function') {
            hostTaskController.dismiss();
          }
        } catch {}
        hostTaskController = null;
        hostTaskStatus = null;
        hostTaskTotal = 0;
        hostTaskCompletedInBatch = 0;
      }
      return;
    }

    hostTaskTotal = Math.max(hostTaskTotal, remainingCount + hostTaskCompletedInBatch);
    const doneInBatch = Math.max(hostTaskCompletedInBatch, hostTaskTotal - remainingCount);
    const currentDl =
      activeTasks.find((t) => t.state === 'downloading' || t.state === 'tagging') ||
      activeTasks[0] ||
      pausedTasks[0];
    const currentPct = Number(currentDl?.percent || 0) / 100;
    const overallProgress = Math.min(
      0.99,
      Math.max(0.02, (doneInBatch + currentPct) / Math.max(1, hostTaskTotal)),
    );
    const overallPercent = Math.round(overallProgress * 100);
    const label =
      activeTasks.length > 0
        ? currentDl
          ? `正在处理：${currentDl.name}（剩余 ${activeTasks.length} 首${pausedTasks.length > 0 ? `，已暂停 ${pausedTasks.length} 首` : ''}）`
          : `排队中 ${activeTasks.length} 首`
        : `已暂停 ${pausedTasks.length} 首，点击可继续下载`;

    const actions = [
      {
        id: 'open-downloads',
        label: '查看队列',
        variant: 'ghost',
        closePanel: true,
        onClick: () => {
          try {
            ctx.router?.push?.('/main/plugin/echo-music-download/downloads');
          } catch {}
        },
      },
    ];
    if (activeTasks.some((t) => ['queued', 'launching', 'downloading'].includes(t.state))) {
      actions.push({
        id: 'pause-all',
        label: '全部暂停',
        variant: 'ghost',
        onClick: () => {
          void pauseAll();
        },
      });
    }
    if (pausedTasks.length > 0) {
      actions.push({
        id: 'resume-all',
        label: '全部继续',
        variant: 'primary',
        onClick: () => {
          void resumeAll();
        },
      });
    }
    actions.push({
      id: 'cancel-all',
      label: '全部取消',
      variant: 'danger',
      onClick: () => {
        void cancelAllActive();
      },
    });

    const titleText =
      activeTasks.length > 0
        ? `歌曲下载（进行中 ${activeTasks.length} 首${pausedTasks.length > 0 ? ` · 暂停 ${pausedTasks.length}` : ''}）`
        : `歌曲下载（已暂停 ${pausedTasks.length} 首）`;
    const desiredStatus = activeTasks.length > 0 ? 'running' : 'pending';
    const patchPayload = {
      name: titleText,
      progress: {
        done: doneInBatch,
        total: hostTaskTotal,
        percent: overallPercent,
        label,
      },
      actions,
    };

    const registerHostTask = () => {
      try {
        hostTaskController = ctx.tasks.register({
          id: 'echo-music-download:queue',
          icon: ICONS.download,
          status: desiredStatus,
          retention: 'transient',
          ...patchPayload,
        });
        hostTaskStatus = desiredStatus;
      } catch {}
    };

    if (
      !hostTaskController ||
      hostTaskController.active === false ||
      (hostTaskStatus === 'running' && desiredStatus === 'pending')
    ) {
      registerHostTask();
    } else if (hostTaskStatus === 'pending' && desiredStatus === 'running') {
      try {
        if (typeof hostTaskController.start === 'function') {
          const started = hostTaskController.start(patchPayload);
          if (started !== false) {
            hostTaskStatus = 'running';
          } else {
            registerHostTask();
          }
        } else {
          registerHostTask();
        }
      } catch {
        registerHostTask();
      }
    } else {
      try {
        hostTaskController.update(patchPayload);
      } catch {}
    }
  };

  const persist = () => {
    void ctx.storage
      .set(
        STORAGE_TASKS,
        state.tasks.map((t) => ({
          id: t.id,
          order: t.order ?? 0,
          hash: t.hash,
          name: t.name,
          artist: t.artist,
          title: t.title,
          album: t.album || '',
          coverUrl: t.coverUrl || '',
          duration: t.duration || 0,
          subfolder: t.subfolder || '',
          fileName: t.fileName,
          saveDir: t.saveDir,
          state: t.state,
          percent: t.percent,
          speed: '',
          eta: '',
          quality: t.quality,
          format: t.format,
          sourceLabel: t.sourceLabel || '酷狗官方',
          tagStatus: t.tagStatus || '',
          lrcStatus: t.lrcStatus || '',
          note: t.note,
          error: t.error,
          finalPath: t.finalPath,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      )
      .catch(() => {});
    syncHostTaskPanel();
  };

  const saveOptions = async (patch = {}) => {
    Object.assign(state.options, patch);
    try {
      await ctx.storage.set(STORAGE_OPTIONS, { ...state.options });
    } catch {}
  };

  // 扫描保存目录中已存在的音频文件名（用于增量去重）
  const refreshExistingFiles = async () => {
    const set = new Set();
    for (const t of state.tasks) {
      if (t.state === 'done') {
        if (t.hash) set.add(`hash:${String(t.hash).toLowerCase()}`);
        if (t.fileName) {
          const base = t.fileName.replace(/\.[^.]+$/, '').toLowerCase();
          set.add(`file:${base}`);
        }
      }
    }
    if (state.saveDirRef?.id) {
      try {
        let entries = [];
        if (typeof ctx?.fs?.listFiles === 'function') {
          const res = await ctx.fs.listFiles(state.saveDirRef, {
            recursive: true,
            kinds: ['audio'],
            limit: 5000,
          });
          entries = res?.files || [];
        } else if (typeof ctx?.fs?.readDir === 'function') {
          const res = await ctx.fs.readDir(
            { directoryId: state.saveDirRef.id },
            { recursive: true },
          );
          entries = res?.entries || res || [];
        }
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (!entry || entry.isDirectory) continue;
            const rel = String(entry.relativePath || entry.name || '').replace(/\\/g, '/');
            if (!/\.(mp3|flac|m4a|wav|ogg|aac|opus)$/i.test(rel)) continue;
            const noExt = rel.replace(/\.[^.]+$/, '').toLowerCase();
            const justName = noExt.split('/').pop() || noExt;
            set.add(`file:${noExt}`);
            set.add(`file:${justName}`);
          }
        }
      } catch {}
    }
    state.existingFilesSet = set;
    return set;
  };

  const isSongAlreadyDownloaded = (song, subfolder = '') => {
    const meta = buildSongMeta(song);
    if (meta.hash && state.existingFilesSet.has(`hash:${meta.hash.toLowerCase()}`)) {
      return true;
    }
    const base = buildBaseFilename(meta.artist, meta.title, state.nameFormat).toLowerCase();
    if (subfolder) {
      const cleanFolder = sanitizePathSegment(subfolder, '歌单').toLowerCase();
      if (state.existingFilesSet.has(`file:${cleanFolder}/${base}`)) return true;
    }
    return state.existingFilesSet.has(`file:${base}`);
  };

  const isSongInActiveQueue = (song) => {
    const meta = buildSongMeta(song);
    if (!meta.hash) return false;
    const lowerHash = meta.hash.toLowerCase();
    return state.tasks.some(
      (t) =>
        String(t.hash || '').toLowerCase() === lowerHash &&
        ['queued', 'launching', 'downloading', 'tagging', 'paused'].includes(t.state),
    );
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
    } catch {}
  };

  // 下载完成后执行后处理：歌词下载 (.lrc) + 封面抓取 + ID3v2.3 / FLAC 标签内嵌
  const postProcessTaskFile = async (task, relativePath) => {
    const wantLrc = Boolean(state.options.writeLrc || state.options.embedLyrics);
    const wantTags = Boolean(state.options.embedTags);
    const wantCover = Boolean(state.options.embedTags && state.options.embedCover);

    if (!wantLrc && !wantTags) return;

    task.state = 'tagging';
    task.updatedAt = Date.now();
    persist();

    const makeFileRef = (relPath) =>
      state.saveDirRef?.id
        ? {
            kind: 'directory-file',
            directoryId: state.saveDirRef.id,
            relativePath: relPath,
          }
        : `${task.saveDir}/${relPath}`;

    const ensureParentSubdir = async (relPath) => {
      if (!state.saveDirRef?.id || typeof ctx?.fs?.mkdir !== 'function') return;
      const normalized = String(relPath || '').replace(/\\/g, '/');
      const lastSlash = normalized.lastIndexOf('/');
      if (lastSlash > 0) {
        const dirRel = normalized.slice(0, lastSlash);
        try {
          await ctx.fs.mkdir({
            kind: 'directory-file',
            directoryId: state.saveDirRef.id,
            relativePath: dirRel,
          });
        } catch {}
      }
    };

    let lyricText = '';
    if (wantLrc) {
      try {
        const lrcRes = await fetchLyricsForTask(ctx, task, state.options.preferBilingualLrc);
        lyricText = lrcRes?.lyric || '';
      } catch {}
    }

    // 1. 导出同名 .lrc 文件
    if (state.options.writeLrc && lyricText && ctx?.fs?.writeFile) {
      try {
        const lrcRel = replaceFileExt(relativePath, 'lrc');
        await ensureParentSubdir(lrcRel);
        await ctx.fs.writeFile(makeFileRef(lrcRel), lyricText, {
          overwrite: true,
          createDirectories: true,
        });
        task.lrcStatus = 'LRC 已导出';
      } catch (e) {
        console.warn('[echo-music-download] 写入 .lrc 失败:', e);
      }
    }

    // 2. 内嵌音频标签与封面（MP3 ID3v2.3 / FLAC Vorbis + Picture）
    const ext = String(relativePath.split('.').pop() || '').toLowerCase();
    if (wantTags && (ext === 'mp3' || ext === 'flac') && ctx?.fs?.writeFile) {
      let coverData = null;
      if (wantCover && task.coverUrl) {
        coverData = await fetchCoverBytesForTask(ctx, task.coverUrl);
      }

      const audioRead = await readDownloadedAudioBytes(ctx, makeFileRef(relativePath));
      if (audioRead.ok && audioRead.bytes) {
        try {
          const tagPayload = {
            title: task.title,
            artist: task.artist,
            album: task.album,
            lyrics: state.options.embedLyrics ? lyricText : '',
            coverBytes: coverData?.bytes || null,
            coverMime: coverData?.mime || 'image/jpeg',
          };
          const taggedBytes =
            ext === 'flac'
              ? embedFlacTags(audioRead.bytes, tagPayload)
              : embedMp3Tags(audioRead.bytes, tagPayload);

          if (taggedBytes.byteLength <= MAX_WRITE_FILE_BYTES) {
            await ctx.fs.writeFile(makeFileRef(relativePath), taggedBytes, {
              overwrite: true,
              createDirectories: true,
            });
            task.tagStatus = ext === 'flac' ? 'FLAC 标签已内嵌' : 'ID3v2 标签已内嵌';
          } else {
            // 超过 8 MiB 沙箱单文件写入上限时自动降级导出同名封面
            if (coverData?.bytes) {
              const coverExt = coverData.mime === 'image/png' ? 'png' : 'jpg';
              await ctx.fs.writeFile(
                makeFileRef(replaceFileExt(relativePath, coverExt)),
                coverData.bytes,
                { overwrite: true, createDirectories: true },
              );
            }
            task.tagStatus = '大文件已导出独立封面/歌词';
          }
        } catch (e) {
          console.warn('[echo-music-download] 内嵌音频标签失败:', e);
        }
      } else if (audioRead.reason === 'too-large') {
        // 超 8 MiB 无损大文件：自动保存同名封面图，不触发 SIZE_LIMIT 报错
        if (coverData?.bytes) {
          try {
            const coverExt = coverData.mime === 'image/png' ? 'png' : 'jpg';
            await ctx.fs.writeFile(
              makeFileRef(replaceFileExt(relativePath, coverExt)),
              coverData.bytes,
              { overwrite: true, createDirectories: true },
            );
          } catch {}
        }
        task.tagStatus = '无损大文件已导出同名封面/LRC';
      }
    }
  };

  const failTask = (task, error, expectedToken = null) => {
    if (!task) return;
    if (expectedToken != null && task._runToken !== expectedToken) return;
    if (task.state === 'canceled' || task.state === 'done') return;
    task.state = 'failed';
    task.error = error || '下载失败';
    task.percent = null;
    task.speed = '';
    task.eta = '';
    task.bytesPerSecond = 0;
    task.updatedAt = Date.now();
    stopPolling(task);
    cleanupLog(task);
    detachNativeHandle(task, { clearHandle: true });
    releaseRunningSlot(task);
    persist();
    ctx.toast.danger(`${task.name}：${task.error}`);
    pump();
  };

  const finalizeTaskSuccess = async (task, relativePath, finalPath, expectedToken = null) => {
    if (!task) return;
    if (expectedToken != null && task._runToken !== expectedToken) return;
    if (task.state === 'canceled' || task.state === 'done') {
      releaseRunningSlot(task);
      pump();
      return;
    }
    stopPolling(task);
    cleanupLog(task);
    task.speed = '';
    task.eta = '';
    task.bytesPerSecond = 0;
    try {
      await postProcessTaskFile(task, relativePath);
    } catch (e) {
      console.warn('[echo-music-download] 后处理异常:', e);
    }
    if (expectedToken != null && task._runToken !== expectedToken) return;
    if (task.state === 'canceled') {
      releaseRunningSlot(task);
      pump();
      return;
    }
    task.state = 'done';
    task.percent = 100;
    task.speed = '';
    task.eta = '';
    task.bytesPerSecond = 0;
    task.error = '';
    task.finalPath = finalPath || `${task.saveDir}/${relativePath}`;
    task.updatedAt = Date.now();
    if (task.hash) state.existingFilesSet.add(`hash:${String(task.hash).toLowerCase()}`);
    if (relativePath) {
      const noExt = relativePath.replace(/\.[^.]+$/, '').toLowerCase();
      state.existingFilesSet.add(`file:${noExt}`);
    }
    hostTaskCompletedInBatch += 1;
    releaseRunningSlot(task);
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

  const startPolling = (task, myToken) => {
    stopPolling(task);
    const poll = async () => {
      if (task._runToken !== myToken || task.state !== 'downloading') return;
      try {
        const res = await ctx.fs.readTextFile(task.logAbs, { maxBytes: LOG_MAX_BYTES });
        if (task._runToken !== myToken || task.state !== 'downloading') return;
        if (res && res.ok && typeof res.content === 'string') {
          const size = res.size ?? 0;
          const parsed = parseLog(res.content);

          if (parsed.done) {
            await finalizeTaskSuccess(
              task,
              task.fileName,
              parsed.finalPath || `${task.saveDir}/${task.fileName}`,
              myToken,
            );
            return;
          }
          if (parsed.failed) {
            failTask(task, parsed.error, myToken);
            return;
          }
          if (parsed.percent != null || size !== task._lastSize) {
            task._lastSize = size;
            task._lastActivity = Date.now();
          }
          if (parsed.percent != null) {
            task.percent = parsed.percent;
            task.speed = parsed.speed ? `${parsed.speed}/s` : '';
            task.bytesPerSecond = parseSpeedToBytes(parsed.speed);
            task.eta = parsed.eta || '';
            syncHostTaskPanel();
          }
        }
        if (Date.now() - task._lastActivity > STALL_TIMEOUT_MS) {
          if (task.pid) {
            const pid = task.pid;
            task.pid = null;
            try {
              await ctx.process?.terminate?.(pid);
            } catch {}
          }
          failTask(task, '下载长时间无进度，已停止（请检查网络或重试）', myToken);
          return;
        }
      } catch {}
      if (task._runToken === myToken && task.state === 'downloading') {
        task._timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    task._timer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  const launchAria2 = async (task, url) => {
    if (typeof ctx?.process?.launch !== 'function') {
      return { ok: false, error: '当前宿主环境不支持启动 aria2c 进程' };
    }
    const pluginDir = String(ctx.descriptor?.directory ?? '').replace(/[\\/]+$/, '');
    const logRel = `logs/task-${task.id}.log`;
    const logAbs = `${pluginDir}/${logRel}`;
    task.logRel = logRel;
    task.logAbs = logAbs;

    try {
      await ctx.fs.writeFile('logs/.keep', '', { createDirectories: true });
    } catch {}
    try {
      await ctx.fs.deleteFile(logRel);
    } catch {}

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

    let res;
    try {
      res = await ctx.process.launch({ executable: 'bin/aria2c.exe', args });
    } catch (err) {
      return { ok: false, error: err?.message || '启动 aria2c 失败' };
    }
    if (res && res.ok) return { ok: true, pid: res.pid };
    return { ok: false, error: res?.error, canceled: res?.canceled };
  };

  // 解析歌曲下载 URL（含多档音质回退 + 灰歌解灰联动）
  const resolveDownloadUrl = async (task) => {
    let body = null;
    let url = '';
    let ext = 'mp3';
    const qualityChain =
      task.quality === 'flac'
        ? ['flac', '320', '128']
        : task.quality === '320'
          ? ['320', '128']
          : ['128'];

    for (let i = 0; i < qualityChain.length; i += 1) {
      const q = qualityChain[i];
      try {
        body = await ctx.kugou.music.getSongUrl(task.hash, q);
        url = extractSongUrl(body);
        if (url) {
          ext = extractExt(body, url);
          if (i > 0) {
            task.note = `${task.quality.toUpperCase()} 不可用，已回退 ${q.toUpperCase()}`;
            task.quality = q;
          }
          task.sourceLabel = '酷狗官方';
          return { url, ext, headers: undefined };
        }
      } catch (e) {
        if (i === qualityChain.length - 1 && !state.options.useUnblockFallback) {
          throw e;
        }
      }
    }

    // 官方接口未拿到有效地址（灰歌 / VIP 限制）→ 联动解灰音源
    if (state.options.useUnblockFallback) {
      const unblocked = await resolveUnblockUrlForDownload(ctx, task, task.quality);
      if (unblocked && unblocked.url) {
        task.quality = unblocked.quality || task.quality;
        task.sourceLabel = unblocked.sourceLabel || '解灰音源';
        task.note = `已通过「${task.sourceLabel}」解灰下载`;
        return {
          url: unblocked.url,
          ext: unblocked.ext || 'mp3',
          headers: unblocked.headers,
        };
      }
    }

    return null;
  };

  const attachNativeSubscriber = (task, handle, myToken, { ignoreInitialPaused = false } = {}) => {
    detachNativeHandle(task, { clearHandle: false });
    task._handle = handle;
    let inSyncSubscribe = true;
    let terminatedSynchronously = false;

    const unsub = handle.subscribe((s) => {
      if (!s || task._handle !== handle || task._runToken !== myToken) return;
      if (task.state === 'canceled' || task.state === 'done') return;

      if (s.totalBytes && s.totalBytes > 0) {
        task.percent = Math.min(100, Math.round((s.receivedBytes / s.totalBytes) * 100));
      }
      const isTransferring = ['downloading', 'connecting', 'verifying', 'committing'].includes(
        s.state,
      );
      task.bytesPerSecond = isTransferring ? Number(s.bytesPerSecond || 0) : 0;
      task.speed = task.bytesPerSecond > 0 ? `${formatBytes(task.bytesPerSecond)}/s` : '';
      task.eta = isTransferring && s.remainingSeconds ? formatEta(s.remainingSeconds) : '';
      syncHostTaskPanel();

      if (s.state === 'completed') {
        terminatedSynchronously = inSyncSubscribe;
        const actualName =
          s.result?.file?.kind === 'directory-file' && s.result.file.relativePath
            ? s.result.file.relativePath
            : task.fileName;
        task.fileName = actualName;
        const finalPath = `${state.saveDir}/${actualName}`;
        const completedId = handle.id;
        detachNativeHandle(task, { clearHandle: true });
        if (completedId && typeof ctx.net?.downloads?.remove === 'function') {
          try {
            const rm = ctx.net.downloads.remove(completedId);
            if (rm && typeof rm.catch === 'function') rm.catch(() => {});
          } catch {}
        }
        void finalizeTaskSuccess(task, actualName, finalPath, myToken);
      } else if (s.state === 'canceled') {
        terminatedSynchronously = inSyncSubscribe;
        detachNativeHandle(task, { clearHandle: true });
        task.state = 'canceled';
        task.error = '';
        task.note = '已取消';
        task.speed = '';
        task.eta = '';
        task.bytesPerSecond = 0;
        task.updatedAt = Date.now();
        releaseRunningSlot(task);
        persist();
        pump();
      } else if (s.state === 'failed' || s.state === 'interrupted') {
        if (task.state === 'paused' || task.state === 'canceled') return;
        terminatedSynchronously = inSyncSubscribe;
        detachNativeHandle(task, { clearHandle: true });
        failTask(task, s.error?.message || '原生下载中断', myToken);
      } else if (s.state === 'paused') {
        if (inSyncSubscribe && ignoreInitialPaused) return;
        task.state = 'paused';
        task.speed = '';
        task.eta = '';
        task.bytesPerSecond = 0;
        task.updatedAt = Date.now();
        releaseRunningSlot(task);
        persist();
        pump();
      } else if (isTransferring) {
        if (task.state !== 'paused' && task.state !== 'tagging') {
          task.state = 'downloading';
        }
      }
    });

    inSyncSubscribe = false;
    if (terminatedSynchronously) {
      try {
        unsub();
      } catch {}
      task._unsub = null;
    } else {
      task._unsub = unsub;
    }
  };

  const resumeNativeHandle = async (task) => {
    const myToken = (task._runToken || 0) + 1;
    task._runToken = myToken;
    task._resumeHandle = false;

    const handle = task._handle;
    if (!handle || typeof handle.resume !== 'function') {
      await startTask(task);
      return;
    }

    task.state = 'downloading';
    task.error = '';
    if (task.note === '已暂停' || task.note === '已加入队列（暂未开始）') task.note = '';
    task.updatedAt = Date.now();
    persist();

    try {
      await handle.resume();
      if (task._runToken !== myToken) {
        if (task.state === 'paused' && typeof handle.pause === 'function') {
          try {
            await handle.pause();
          } catch {}
        } else if (task.state === 'canceled' && typeof handle.cancel === 'function') {
          try {
            await handle.cancel();
          } catch {}
        }
        return;
      }
      attachNativeSubscriber(task, handle, myToken, { ignoreInitialPaused: true });
    } catch (err) {
      if (task._runToken !== myToken) return;
      console.warn('[echo-music-download] 原生断点恢复失败，重新解析下载地址:', err);
      detachNativeHandle(task, { clearHandle: true });
      await startTask(task);
    }
  };

  const startTask = async (task) => {
    const myToken = (task._runToken || 0) + 1;
    task._runToken = myToken;
    task._resumeHandle = false;
    task.state = 'launching';
    task.error = '';
    if (
      task.note === '已暂停' ||
      task.note === '已加入队列（暂未开始）' ||
      task.note === '已取消' ||
      task.note === '应用重启后已自动暂停，点击继续可恢复'
    ) {
      task.note = '';
    }
    task.updatedAt = Date.now();
    persist();

    let resolved;
    try {
      resolved = await resolveDownloadUrl(task);
    } catch (error) {
      if (task._runToken !== myToken) return;
      failTask(task, getApiErrorMessage(error, '获取播放地址失败'), myToken);
      return;
    }

    if (task._runToken !== myToken) return;

    if (!resolved || !resolved.url) {
      failTask(task, '未获取到可下载音源（版权受限且解灰通道未命中）', myToken);
      return;
    }

    const { url, ext, headers } = resolved;
    task.fileName = sanitizeFilename(task.artist, task.title, ext, task.format, task.subfolder);

    // 优先使用 EchoMusic v2.3.2+ 原生流式下载引擎 (ctx.net.download + ctx.fs 目录授权)
    const fsGrants = getFsGrantApi(ctx);
    const useNative = Boolean(ctx.net?.download && fsGrants && state.saveDirRef?.id);
    if (useNative) {
      task.engine = 'native';
      task.state = 'downloading';
      task.updatedAt = Date.now();
      persist();
      try {
        if (
          state.saveDirRef.available === false &&
          typeof fsGrants.reauthorizeDirectoryGrant === 'function'
        ) {
          const reauth = await fsGrants.reauthorizeDirectoryGrant(state.saveDirRef.id, {
            access: 'read-write',
            purpose: '选择歌曲下载保存目录',
            persist: true,
          });
          if (task._runToken !== myToken) return;
          if (reauth && reauth.ok !== false && !reauth.canceled && reauth.directory) {
            state.saveDirRef = reauth.directory;
            state.saveDir =
              reauth.directory.displayPath || reauth.directory.name || state.saveDir;
            await ctx.storage.set(STORAGE_SAVE_DIR_REF, reauth.directory);
            await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
          }
        }
        if (task._runToken !== myToken) return;

        let handle;
        const dlRequest = {
          url,
          name: task.name,
          headers,
          target: { directoryId: state.saveDirRef.id, relativePath: task.fileName },
          conflict: 'replace',
          resume: true,
        };
        try {
          handle = await ctx.net.download(dlRequest);
        } catch (dlErr) {
          if (task._runToken !== myToken) return;
          if (
            typeof fsGrants.reauthorizeDirectoryGrant === 'function' &&
            /GRANT|DIRECTORY|ACCESS|UNAVAILABLE/i.test(
              String(dlErr?.code || dlErr?.message || ''),
            )
          ) {
            const reauth = await fsGrants.reauthorizeDirectoryGrant(state.saveDirRef.id, {
              access: 'read-write',
              purpose: '恢复歌曲下载保存目录访问权限',
              persist: true,
            });
            if (task._runToken !== myToken) return;
            if (reauth && reauth.ok !== false && !reauth.canceled && reauth.directory) {
              state.saveDirRef = reauth.directory;
              state.saveDir =
                reauth.directory.displayPath || reauth.directory.name || state.saveDir;
              await ctx.storage.set(STORAGE_SAVE_DIR_REF, reauth.directory);
              await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
              handle = await ctx.net.download(dlRequest);
            } else {
              throw dlErr;
            }
          } else {
            throw dlErr;
          }
        }

        if (task._runToken !== myToken) {
          if (task.state === 'paused' && typeof handle?.pause === 'function') {
            task._handle = handle;
            try {
              await handle.pause();
            } catch {}
          } else if (typeof handle?.cancel === 'function') {
            try {
              await handle.cancel();
            } catch {}
          }
          return;
        }

        attachNativeSubscriber(task, handle, myToken);
      } catch (err) {
        if (task._runToken !== myToken) return;
        console.warn('[echo-music-download] 原生下载异常，回退 aria2c:', err);
        task.engine = 'aria2c';
        const launch = await launchAria2(task, url);
        if (task._runToken !== myToken) {
          if (launch.ok && launch.pid) {
            try {
              await ctx.process?.terminate?.(launch.pid);
            } catch {}
          }
          return;
        }
        if (!launch.ok) {
          failTask(task, launch.error || '启动下载失败', myToken);
          return;
        }
        task.pid = launch.pid;
        task.state = 'downloading';
        task.updatedAt = Date.now();
        task._lastSize = 0;
        task._lastActivity = Date.now();
        persist();
        startPolling(task, myToken);
      }
      return;
    }

    // 备选降级：aria2c
    task.engine = 'aria2c';
    const launch = await launchAria2(task, url);
    if (task._runToken !== myToken) {
      if (launch.ok && launch.pid) {
        try {
          await ctx.process?.terminate?.(launch.pid);
        } catch {}
      }
      return;
    }
    if (!launch.ok) {
      if (launch.canceled) {
        failTask(task, '已取消启动 aria2c；请在弹窗中允许插件运行本地程序', myToken);
      } else {
        failTask(task, launch.error || '启动 aria2c 失败', myToken);
      }
      return;
    }

    task.pid = launch.pid;
    task.state = 'downloading';
    task.updatedAt = Date.now();
    task._lastSize = 0;
    task._lastActivity = Date.now();
    persist();
    startPolling(task, myToken);
  };

  const pump = () => {
    while (state.runningCount < state.maxConcurrent) {
      const next = state.tasks.find((t) => t.state === 'queued');
      if (!next) break;
      acquireRunningSlot(next);
      if (next._resumeHandle && next._handle && typeof next._handle.resume === 'function') {
        void resumeNativeHandle(next);
      } else {
        void startTask(next);
      }
    }
    syncHostTaskPanel();
  };

  const enqueueSongs = async (songs, { playlistName = '', startPaused = false } = {}) => {
    if (!state.saveDir) {
      ctx.toast.info('请先选择歌曲保存目录');
      return { added: 0, skippedActive: 0, skippedExisting: 0, startPaused };
    }
    if (state.options.skipExisting) {
      await refreshExistingFiles();
    }
    const subfolder =
      state.options.playlistSubfolder && playlistName ? sanitizePathSegment(playlistName, '歌单') : '';

    let added = 0;
    let skippedActive = 0;
    let skippedExisting = 0;
    const seenHashes = new Set();

    for (const song of Array.isArray(songs) ? songs : []) {
      const meta = buildSongMeta(song);
      if (!meta.hash || !meta.title) continue;
      const hashKey = meta.hash.toLowerCase();
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      const dupActive = state.tasks.find(
        (t) =>
          String(t.hash || '').toLowerCase() === hashKey &&
          ['queued', 'launching', 'downloading', 'tagging', 'paused'].includes(t.state),
      );
      if (dupActive) {
        skippedActive += 1;
        continue;
      }

      if (state.options.skipExisting && isSongAlreadyDownloaded(song, subfolder)) {
        skippedExisting += 1;
        continue;
      }

      state.nextSeq += 1;
      const now = Date.now();
      state.tasks.push({
        id: `t${now}-${state.nextSeq}`,
        order: state.nextSeq,
        hash: meta.hash,
        name: meta.artist ? `${meta.artist} - ${meta.title}` : meta.title,
        artist: meta.artist,
        title: meta.title,
        album: meta.album,
        coverUrl: meta.coverUrl,
        duration: meta.duration,
        subfolder,
        fileName: '',
        saveDir: state.saveDir,
        state: startPaused ? 'paused' : 'queued',
        percent: null,
        speed: '',
        eta: '',
        bytesPerSecond: 0,
        quality: state.quality,
        format: state.nameFormat,
        sourceLabel: '酷狗官方',
        tagStatus: '',
        lrcStatus: '',
        note: startPaused ? '已加入队列（暂未开始）' : '',
        error: '',
        finalPath: '',
        createdAt: now,
        updatedAt: now,
        _countedRunning: false,
        _runToken: 0,
        _resumeHandle: false,
      });
      added += 1;
    }

    if (added > 0) {
      persist();
      const extraMsg =
        skippedExisting > 0 ? `（已自动跳过 ${skippedExisting} 首已存在歌曲）` : '';
      if (startPaused) {
        ctx.toast.success(`已加入 ${added} 首到队列并暂停${extraMsg}`);
      } else {
        ctx.toast.success(`已加入 ${added} 首下载任务${extraMsg}`);
        pump();
      }
    } else if (skippedExisting > 0) {
      ctx.toast.info(`所选 ${skippedExisting} 首歌曲均已存在于本地目录，无需重复下载`);
    } else if (skippedActive > 0) {
      ctx.toast.info(`${skippedActive} 首歌曲已在下载队列中`);
    }

    return { added, skippedActive, skippedExisting, startPaused };
  };

  // 两阶段原子暂停（先同步变更所有目标状态并释放槽位，再异步停止句柄/进程，避免 pump 误拉起被暂停的排队任务）
  const pauseTasksInternal = async (targets, { silent = false, summaryLabel = '' } = {}) => {
    const valid = targets.filter((t) =>
      t && ['queued', 'launching', 'downloading'].includes(t.state),
    );
    if (valid.length === 0) return 0;

    const ops = [];
    const now = Date.now();
    for (const task of valid) {
      const prevState = task.state;
      task._runToken = (task._runToken || 0) + 1;
      task._resumeHandle = false;
      stopPolling(task);

      let handleToPause = null;
      let pidToKill = null;
      if (prevState === 'downloading') {
        handleToPause = detachNativeHandle(task, { clearHandle: false });
        if (task.pid) {
          pidToKill = task.pid;
          task.pid = null;
        }
      }

      task.state = 'paused';
      task.speed = '';
      task.eta = '';
      task.bytesPerSecond = 0;
      task.updatedAt = now;
      releaseRunningSlot(task);

      if (handleToPause && typeof handleToPause.pause === 'function') {
        ops.push(handleToPause.pause().catch(() => {}));
      } else if (pidToKill) {
        ops.push(Promise.resolve(ctx.process?.terminate?.(pidToKill)).catch(() => {}));
      }
    }

    persist();
    if (ops.length > 0) {
      await Promise.allSettled(ops);
    }
    pump();

    if (!silent) {
      if (summaryLabel) {
        ctx.toast.info(summaryLabel.replace('{n}', String(valid.length)));
      } else if (valid.length === 1) {
        ctx.toast.info(`已暂停：${valid[0].name}`);
      } else {
        ctx.toast.info(`已暂停 ${valid.length} 个下载任务`);
      }
    }
    return valid.length;
  };

  const pauseTask = async (task, { silent = false } = {}) => {
    if (!task) return false;
    if (task.state === 'tagging') {
      if (!silent) ctx.toast.info('正在写入音频标签，即将完成');
      return false;
    }
    const count = await pauseTasksInternal([task], { silent });
    return count > 0;
  };

  const resumeTask = async (task, { silent = false } = {}) => {
    if (!task || task.state !== 'paused') return false;
    task.error = '';
    if (
      task.note === '已暂停' ||
      task.note === '已加入队列（暂未开始）' ||
      task.note === '应用重启后已自动暂停，点击继续可恢复'
    ) {
      task.note = '';
    }
    task.updatedAt = Date.now();

    if (task._handle && typeof task._handle.resume === 'function') {
      if (state.runningCount < state.maxConcurrent) {
        acquireRunningSlot(task);
        void resumeNativeHandle(task);
      } else {
        task._resumeHandle = true;
        task.state = 'queued';
        persist();
        pump();
      }
    } else {
      task._resumeHandle = false;
      task.state = 'queued';
      persist();
      pump();
    }

    if (!silent) {
      ctx.toast.info(`已恢复：${task.name}`);
    }
    return true;
  };

  const resumeTasksInternal = async (targets, { silent = false, summaryLabel = '' } = {}) => {
    const valid = targets.filter((t) => t && t.state === 'paused');
    if (valid.length === 0) return 0;

    const now = Date.now();
    for (const task of valid) {
      task.error = '';
      if (
        task.note === '已暂停' ||
        task.note === '已加入队列（暂未开始）' ||
        task.note === '应用重启后已自动暂停，点击继续可恢复'
      ) {
        task.note = '';
      }
      task._resumeHandle = Boolean(task._handle && typeof task._handle.resume === 'function');
      task.state = 'queued';
      task.updatedAt = now;
    }

    persist();
    pump();

    if (!silent) {
      if (summaryLabel) {
        ctx.toast.info(summaryLabel.replace('{n}', String(valid.length)));
      } else {
        ctx.toast.success(`已恢复 ${valid.length} 个下载任务`);
      }
    }
    return valid.length;
  };

  // 两阶段原子取消（绝不触发 toast.danger，干净设为 canceled 状态）
  const cancelTasksInternal = async (targets, { silent = false, summaryLabel = '' } = {}) => {
    const valid = targets.filter(
      (t) => t && ['queued', 'launching', 'downloading', 'tagging', 'paused'].includes(t.state),
    );
    if (valid.length === 0) return 0;

    const ops = [];
    const now = Date.now();
    for (const task of valid) {
      task._runToken = (task._runToken || 0) + 1;
      stopPolling(task);
      cleanupLog(task);
      const handle = detachNativeHandle(task, { clearHandle: true });
      const pid = task.pid;
      task.pid = null;

      task.state = 'canceled';
      task.error = '';
      task.note = '已取消';
      task.speed = '';
      task.eta = '';
      task.bytesPerSecond = 0;
      task.updatedAt = now;
      releaseRunningSlot(task);

      if (handle && typeof handle.cancel === 'function') {
        const handleId = handle.id;
        ops.push(
          handle
            .cancel()
            .catch(() => {})
            .finally(() => {
              if (handleId && typeof ctx.net?.downloads?.remove === 'function') {
                return Promise.resolve(ctx.net.downloads.remove(handleId)).catch(() => {});
              }
              return undefined;
            }),
        );
      }
      if (pid) {
        ops.push(Promise.resolve(ctx.process?.terminate?.(pid)).catch(() => {}));
      }
    }

    persist();
    if (ops.length > 0) {
      await Promise.allSettled(ops);
    }
    pump();

    if (!silent) {
      if (summaryLabel) {
        ctx.toast.info(summaryLabel.replace('{n}', String(valid.length)));
      } else if (valid.length === 1) {
        ctx.toast.info(`已取消：${valid[0].name}`);
      } else {
        ctx.toast.info(`已取消 ${valid.length} 个任务`);
      }
    }
    return valid.length;
  };

  const cancelTask = async (task, { silent = false } = {}) => {
    if (!task) return false;
    const count = await cancelTasksInternal([task], { silent });
    return count > 0;
  };

  // 全局快捷控制
  const pauseAll = async () => {
    const targets = state.tasks.filter((t) =>
      ['queued', 'launching', 'downloading'].includes(t.state),
    );
    if (targets.length === 0) {
      ctx.toast.info('当前没有可暂停的下载任务');
      return 0;
    }
    return pauseTasksInternal(targets, { summaryLabel: '已全部暂停（共 {n} 个任务）' });
  };

  const resumeAll = async () => {
    const targets = state.tasks.filter((t) => t.state === 'paused');
    if (targets.length === 0) {
      ctx.toast.info('当前没有已暂停的任务');
      return 0;
    }
    return resumeTasksInternal(targets, { summaryLabel: '已恢复 {n} 个暂停任务' });
  };

  const cancelAllActive = async () => {
    const targets = state.tasks.filter((t) =>
      ['queued', 'launching', 'downloading', 'paused'].includes(t.state),
    );
    if (targets.length === 0) {
      ctx.toast.info('当前没有进行中或已暂停的任务');
      return 0;
    }
    return cancelTasksInternal(targets, { summaryLabel: '已取消全部 {n} 个任务' });
  };

  // 批量选中任务控制
  const batchPause = async (taskIds) => {
    const idSet = normalizeTaskIdSet(taskIds);
    const targets = state.tasks.filter(
      (t) => idSet.has(t.id) && ['queued', 'launching', 'downloading'].includes(t.state),
    );
    if (targets.length === 0) {
      ctx.toast.info('所选任务中没有可暂停的项目');
      return 0;
    }
    return pauseTasksInternal(targets, { summaryLabel: '已批量暂停 {n} 个任务' });
  };

  const batchResume = async (taskIds) => {
    const idSet = normalizeTaskIdSet(taskIds);
    const targets = state.tasks.filter((t) => idSet.has(t.id) && t.state === 'paused');
    if (targets.length === 0) {
      ctx.toast.info('所选任务中没有已暂停的项目');
      return 0;
    }
    return resumeTasksInternal(targets, { summaryLabel: '已批量恢复 {n} 个任务' });
  };

  const batchCancel = async (taskIds) => {
    const idSet = normalizeTaskIdSet(taskIds);
    const targets = state.tasks.filter(
      (t) => idSet.has(t.id) && ['queued', 'launching', 'downloading', 'paused'].includes(t.state),
    );
    if (targets.length === 0) {
      ctx.toast.info('所选任务中没有可取消的项目');
      return 0;
    }
    return cancelTasksInternal(targets, { summaryLabel: '已批量取消 {n} 个任务' });
  };

  const batchRetry = (taskIds) => {
    const idSet = normalizeTaskIdSet(taskIds);
    const targets = state.tasks.filter(
      (t) => idSet.has(t.id) && ['failed', 'canceled', 'done'].includes(t.state),
    );
    if (targets.length === 0) {
      ctx.toast.info('所选任务中没有可重新下载的项目');
      return 0;
    }
    const now = Date.now();
    for (const task of targets) {
      detachNativeHandle(task, { clearHandle: true });
      stopPolling(task);
      task.state = 'queued';
      task.percent = null;
      task.speed = '';
      task.eta = '';
      task.bytesPerSecond = 0;
      task.tagStatus = '';
      task.lrcStatus = '';
      task.note = '';
      task.error = '';
      task.finalPath = '';
      task.updatedAt = now;
    }
    persist();
    pump();
    ctx.toast.success(`已重新加入队列 ${targets.length} 个任务`);
    return targets.length;
  };

  const batchRemove = async (taskIds) => {
    const idSet = normalizeTaskIdSet(taskIds);
    const matched = state.tasks.filter((t) => idSet.has(t.id));
    if (matched.length === 0) return 0;

    const activeToCancel = matched.filter((t) =>
      ['queued', 'launching', 'downloading', 'tagging', 'paused'].includes(t.state),
    );
    if (activeToCancel.length > 0) {
      await cancelTasksInternal(activeToCancel, { silent: true });
    }

    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => !idSet.has(t.id));
    const removed = before - state.tasks.length;
    if (removed > 0) {
      persist();
      ctx.toast.info(`已移除 ${removed} 条任务记录`);
    }
    return removed;
  };

  const retryTask = async (task) => {
    if (!task) return false;
    if (['queued', 'launching', 'downloading', 'tagging'].includes(task.state)) return false;
    if (task.state === 'paused') {
      return resumeTask(task);
    }
    detachNativeHandle(task, { clearHandle: true });
    stopPolling(task);
    task.state = 'queued';
    task.percent = null;
    task.speed = '';
    task.eta = '';
    task.bytesPerSecond = 0;
    task.tagStatus = '';
    task.lrcStatus = '';
    task.note = '';
    task.error = '';
    task.finalPath = '';
    task.updatedAt = Date.now();
    persist();
    pump();
    return true;
  };

  const retryAllFailed = () => {
    const failed = state.tasks.filter((t) => t.state === 'failed');
    if (failed.length === 0) {
      ctx.toast.info('当前没有失败的任务');
      return 0;
    }
    const now = Date.now();
    for (const t of failed) {
      detachNativeHandle(t, { clearHandle: true });
      stopPolling(t);
      t.state = 'queued';
      t.percent = null;
      t.speed = '';
      t.eta = '';
      t.bytesPerSecond = 0;
      t.tagStatus = '';
      t.lrcStatus = '';
      t.note = '';
      t.error = '';
      t.updatedAt = now;
    }
    persist();
    pump();
    ctx.toast.success(`已重新开始 ${failed.length} 个失败任务`);
    return failed.length;
  };

  const removeTask = async (task) => {
    if (!task) return false;
    if (['queued', 'launching', 'downloading', 'tagging', 'paused'].includes(task.state)) {
      await cancelTask(task, { silent: true });
    }
    const idx = state.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      state.tasks.splice(idx, 1);
      persist();
      return true;
    }
    return false;
  };

  const clearFinished = () => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter(
      (t) => !['done', 'failed', 'canceled'].includes(t.state),
    );
    const removed = before - state.tasks.length;
    if (removed > 0) {
      persist();
      ctx.toast.success(`已清理 ${removed} 条已完成/已取消/失败记录`);
    }
    return removed;
  };

  const chooseSaveDir = async () => {
    const fsGrants = getFsGrantApi(ctx);
    if (fsGrants && typeof fsGrants.requestDirectory === 'function') {
      try {
        const res = await fsGrants.requestDirectory({
          access: 'read-write',
          purpose: '选择歌曲与歌词下载保存目录',
          persist: true,
        });
        if (res && res.canceled) return;
        if (res && res.ok !== false && !res.canceled && res.directory) {
          state.saveDirRef = res.directory;
          state.saveDir = res.directory.displayPath || res.directory.name || '已授权目录';
          await ctx.storage.set(STORAGE_SAVE_DIR_REF, res.directory);
          await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
          await refreshExistingFiles();
          ctx.toast.success(`保存目录已授权：${state.saveDir}`);
          return;
        }
      } catch (e) {
        console.warn('[echo-music-download] 原生目录授权异常，回退对话框:', e);
      }
    }
    if (ctx.dialog?.selectDirectory) {
      const res = await ctx.dialog.selectDirectory({ title: '选择歌曲保存目录' });
      if (res && !res.canceled && res.paths && res.paths[0]) {
        state.saveDirRef = null;
        state.saveDir = res.paths[0];
        await ctx.storage.set(STORAGE_SAVE_DIR_REF, null);
        await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
        ctx.toast.success('保存目录已更新');
      }
    }
  };

  const setQuality = async (quality) => {
    state.quality = quality;
    try {
      await ctx.storage.set(STORAGE_QUALITY, quality);
    } catch {}
  };

  const setNameFormat = async (format) => {
    state.nameFormat = format;
    try {
      await ctx.storage.set(STORAGE_NAME_FORMAT, format);
    } catch {}
  };

  const setMaxConcurrent = async (value) => {
    const v = Math.min(
      MAX_CONCURRENT_MAX,
      Math.max(MAX_CONCURRENT_MIN, Math.trunc(Number(value)) || 2),
    );
    state.maxConcurrent = v;
    try {
      await ctx.storage.set(STORAGE_MAX_CONCURRENT, v);
    } catch {}
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
    } catch {}

    try {
      const q = await ctx.storage.get(STORAGE_QUALITY);
      if (QUALITY_OPTIONS.some((o) => o.value === q)) state.quality = q;
    } catch {}

    try {
      const f = await ctx.storage.get(STORAGE_NAME_FORMAT);
      if (NAME_FORMAT_OPTIONS.some((o) => o.value === f)) state.nameFormat = f;
    } catch {}

    try {
      const c = Number(await ctx.storage.get(STORAGE_MAX_CONCURRENT));
      if (Number.isFinite(c)) {
        state.maxConcurrent = Math.min(
          MAX_CONCURRENT_MAX,
          Math.max(MAX_CONCURRENT_MIN, Math.trunc(c)),
        );
      }
    } catch {}

    try {
      const opts = await ctx.storage.get(STORAGE_OPTIONS);
      if (opts && typeof opts === 'object') {
        Object.assign(state.options, DEFAULT_OPTIONS, opts);
      }
    } catch {}

    try {
      const saved = await ctx.storage.get(STORAGE_TASKS);
      if (Array.isArray(saved)) {
        state.tasks = saved
          .filter((t) => t && t.id)
          .map((t, idx) => {
            const wasInterrupted = ['downloading', 'launching', 'tagging', 'queued'].includes(
              t.state,
            );
            const restoredState =
              t.state === 'paused'
                ? 'paused'
                : t.state === 'canceled'
                  ? 'canceled'
                  : wasInterrupted
                    ? 'paused'
                    : t.state;
            return {
              ...t,
              order: Number.isFinite(Number(t.order)) ? Number(t.order) : idx + 1,
              album: t.album || '',
              coverUrl: t.coverUrl || '',
              subfolder: t.subfolder || '',
              fileName: t.fileName || '',
              speed: '',
              eta: '',
              bytesPerSecond: 0,
              quality: QUALITY_OPTIONS.some((o) => o.value === t.quality) ? t.quality : '320',
              format: NAME_FORMAT_OPTIONS.some((o) => o.value === t.format)
                ? t.format
                : 'artist-title',
              sourceLabel: t.sourceLabel || '酷狗官方',
              tagStatus: t.tagStatus || '',
              lrcStatus: t.lrcStatus || '',
              note: wasInterrupted
                ? '应用重启后已自动暂停，点击继续可恢复'
                : t.note || (t.state === 'canceled' ? '已取消' : ''),
              error: wasInterrupted || t.state === 'paused' || t.state === 'canceled' ? '' : t.error || '',
              state: restoredState,
              _countedRunning: false,
              _runToken: 0,
              _resumeHandle: false,
              _handle: null,
              _unsub: null,
            };
          });
        for (const t of state.tasks) {
          const m = /t\d+-(\d+)$/.exec(t.id);
          if (m) state.nextSeq = Math.max(state.nextSeq, Number(m[1]));
          if (Number.isFinite(Number(t.order))) {
            state.nextSeq = Math.max(state.nextSeq, Number(t.order));
          }
        }
      }
    } catch (e) {
      console.warn('[echo-music-download] 恢复任务失败:', e);
    }

    state.runningCount = 0;
    await refreshExistingFiles();
    syncHostTaskPanel();
  };

  const dispose = () => {
    if (hostTaskController) {
      try {
        if (typeof hostTaskController.dismiss === 'function') {
          hostTaskController.dismiss();
        } else if (typeof hostTaskController.complete === 'function') {
          hostTaskController.complete({ description: '插件已卸载' });
        }
      } catch {}
      hostTaskController = null;
      hostTaskStatus = null;
      hostTaskTotal = 0;
      hostTaskCompletedInBatch = 0;
    }
    for (const t of state.tasks) {
      stopPolling(t);
      detachNativeHandle(t, { clearHandle: true });
      if (['downloading', 'launching', 'tagging'].includes(t.state) && t.pid) {
        try {
          void ctx.process?.terminate?.(t.pid);
        } catch {}
        t.pid = null;
      }
      t._countedRunning = false;
    }
    state.runningCount = 0;
  };

  return {
    state,
    restore,
    saveOptions,
    refreshExistingFiles,
    isSongAlreadyDownloaded,
    isSongInActiveQueue,
    enqueueSongs,
    pauseTask,
    resumeTask,
    cancelTask,
    pauseAll,
    resumeAll,
    cancelAllActive,
    batchPause,
    batchResume,
    batchCancel,
    batchRetry,
    batchRemove,
    retryTask,
    retryAllFailed,
    removeTask,
    clearFinished,
    chooseSaveDir,
    setQuality,
    setNameFormat,
    setMaxConcurrent,
    dispose,
  };
};

// ============================================================================
// EchoMusic v2.3.x 原生主题自适应样式 (无硬编码深色背景，全面适配浅色/深色主题)
// ============================================================================

const CSS = `
.emd-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
.emd-v2-body {
  padding: 16px 32px 36px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 顶部未授权目录提示条（仅在未选择保存目录时出现） */
.emd-dir-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, #f59e0b 10%, var(--bg-info-card, rgba(128, 128, 128, 0.06)));
  border: 1px solid color-mix(in srgb, #f59e0b 32%, var(--border-subtle, rgba(128, 128, 128, 0.16)));
  color: var(--color-text-main, inherit);
  font-size: 12.5px;
  flex-wrap: wrap;
}
.emd-dir-alert-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 队列总控栏：过滤页签 + 实时速度 + 搜索 + 显式全局操作 */
.emd-control-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.05));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
}
.emd-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.emd-control-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.emd-control-divider {
  width: 1px;
  height: 18px;
  background: var(--border-subtle, rgba(128, 128, 128, 0.2));
  margin: 0 2px;
}

/* 语义 1：分段过滤页签 / 单选组（与操作按钮、开关明确区分） */
.emd-seg-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--control-muted-bg, rgba(128, 128, 128, 0.1));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.1));
  flex-wrap: wrap;
}
.emd-seg-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #888);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  white-space: nowrap;
}
.emd-seg-tab:hover {
  color: var(--color-text-main, inherit);
}
.emd-seg-tab-active {
  background: var(--bg-card, var(--bg-main, rgba(255, 255, 255, 0.92)));
  color: var(--color-text-main, inherit);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.emd-seg-count {
  font-size: 11px;
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}

/* 实时聚合速率徽章 */
.emd-speed-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--color-primary, #10b981) 12%, transparent);
  color: var(--color-primary, #10b981);
  border: 1px solid color-mix(in srgb, var(--color-primary, #10b981) 25%, transparent);
}
.emd-speed-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-primary, #10b981);
  animation: emd-pulse 1.5s ease-in-out infinite;
}
@keyframes emd-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.82); }
}

/* 语义 2：内联 Switch 开关行 */
.emd-switch-group {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.emd-switch-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-main, inherit);
  cursor: pointer;
  user-select: none;
}
.emd-switch-item-hint {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--color-text-secondary, #888);
}

/* 工具栏布局 */
.emd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

/* 复选框（当宿主未暴露 Checkbox 组件时的兜底样式） */
.emd-native-checkbox {
  accent-color: var(--color-primary, #10b981);
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
  margin: 0;
}

/* 任务卡片列表 */
.emd-task-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.emd-task-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.emd-task-card:hover {
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 32%, var(--border-subtle, rgba(128, 128, 128, 0.2)));
}
.emd-task-card-selected {
  background: color-mix(in srgb, var(--color-primary, #10b981) 9%, var(--bg-info-card, rgba(128, 128, 128, 0.06)));
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 52%, transparent);
}
.emd-task-card-clickable {
  cursor: pointer;
}
.emd-task-check-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 2px;
}
.emd-task-cover {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-card, rgba(128, 128, 128, 0.1));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary, #888);
}
.emd-task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.emd-task-row1 {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex-wrap: wrap;
}
.emd-task-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-main, inherit);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}
.emd-task-sub {
  font-size: 11.5px;
  color: var(--color-text-secondary, #888);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.emd-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1.5px 7px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 700;
  border: 1px solid transparent;
  flex-shrink: 0;
}
.emd-badge-quality {
  background: color-mix(in srgb, var(--color-primary, #10b981) 12%, transparent);
  color: var(--color-primary, #10b981);
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 24%, transparent);
}
.emd-badge-source {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.24);
}
.emd-badge-tag {
  background: rgba(168, 85, 247, 0.12);
  color: #a855f7;
  border-color: rgba(168, 85, 247, 0.24);
}
.emd-badge-folder {
  background: rgba(128, 128, 128, 0.1);
  color: var(--color-text-secondary, #888);
  border-color: var(--border-subtle, rgba(128, 128, 128, 0.18));
}
.emd-badge-state-done {
  background: rgba(16, 185, 129, 0.14);
  color: #10b981;
}
.emd-badge-state-downloading,
.emd-badge-state-launching,
.emd-badge-state-tagging {
  background: color-mix(in srgb, var(--color-primary, #10b981) 15%, transparent);
  color: var(--color-primary, #10b981);
}
.emd-badge-state-paused {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
.emd-badge-state-queued {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}
.emd-badge-state-canceled {
  background: rgba(128, 128, 128, 0.14);
  color: var(--color-text-secondary, #888);
}
.emd-badge-state-failed {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}

.emd-progress-track {
  height: 4px;
  border-radius: 999px;
  background: var(--border-subtle, rgba(128, 128, 128, 0.16));
  overflow: hidden;
}
.emd-progress-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary, #10b981);
  transition: width 0.22s ease;
}
.emd-progress-bar-paused {
  background: #d97706;
  opacity: 0.72;
}
.emd-progress-bar-done {
  background: #10b981;
}
.emd-task-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.emd-btn-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

/* 歌单横向选择器 */
.emd-playlist-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 6px;
}
.emd-playlist-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  min-width: 185px;
  max-width: 240px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.14));
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  text-align: left;
}
.emd-playlist-card:hover {
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 45%, transparent);
}
.emd-playlist-card-active {
  background: color-mix(in srgb, var(--color-primary, #10b981) 12%, transparent);
  border-color: var(--color-primary, #10b981);
}
.emd-playlist-cover {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-card, rgba(128, 128, 128, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary, #10b981);
}
.emd-playlist-info {
  min-width: 0;
  flex: 1;
}
.emd-playlist-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-text-main, inherit);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.emd-playlist-count {
  font-size: 11px;
  color: var(--color-text-secondary, #888);
  margin-top: 2px;
}

/* 批量选歌表格（防误触设计：主区域仅勾选，右侧单曲图标明确隔离） */
.emd-playlist-meta-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.emd-playlist-meta-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-main, inherit);
}
.emd-playlist-meta-sub {
  font-size: 12px;
  color: var(--color-text-secondary, #888);
  margin-left: 8px;
  font-weight: 500;
}
.emd-song-table {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.14));
  background: var(--bg-info-card, rgba(128, 128, 128, 0.04));
  overflow: hidden;
}
.emd-song-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.08));
  transition: background-color 0.12s ease;
}
.emd-song-item:last-child {
  border-bottom: none;
}
.emd-song-item:hover {
  background: color-mix(in srgb, var(--color-primary, #10b981) 5%, transparent);
}
.emd-song-item-selected {
  background: color-mix(in srgb, var(--color-primary, #10b981) 10%, transparent);
}
.emd-song-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.emd-song-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-main, inherit);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.emd-song-item-sub {
  font-size: 11.5px;
  color: var(--color-text-secondary, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.emd-row-quick-sep {
  width: 1px;
  height: 20px;
  background: var(--border-subtle, rgba(128, 128, 128, 0.14));
  flex-shrink: 0;
  margin-left: 4px;
}
.emd-row-quick-dl {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary, #888);
  opacity: 0.45;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.emd-song-item:hover .emd-row-quick-dl,
.emd-row-quick-dl:focus-visible {
  opacity: 0.9;
}
.emd-row-quick-dl:hover:not(:disabled) {
  opacity: 1;
  color: var(--color-primary, #10b981);
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 45%, transparent);
  background: color-mix(in srgb, var(--color-primary, #10b981) 10%, transparent);
}
.emd-row-quick-dl:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

/* 底部常驻吸底操作栏（Tab 0 批量操作栏 / Tab 1 选歌确认操作栏） */
.emd-bottom-bar {
  flex-shrink: 0;
  z-index: 160;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 28px;
  background: var(--floating-surface-bg, var(--bg-card, var(--bg-main)));
  -webkit-backdrop-filter: var(--floating-surface-filter, blur(14px));
  backdrop-filter: var(--floating-surface-filter, blur(14px));
  border-top: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.18));
  box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.08);
  flex-wrap: wrap;
}
.emd-bottom-bar-info {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--color-text-main, inherit);
  min-width: 0;
  flex-wrap: wrap;
}
.emd-bottom-bar-count {
  font-weight: 700;
  color: var(--color-primary, #10b981);
}
.emd-bottom-bar-sub {
  font-size: 12px;
  color: var(--color-text-secondary, #888);
}
.emd-bottom-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 设置分组与卡片 */
.emd-settings-sections {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.emd-settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.emd-settings-section-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary, #888);
  padding-left: 4px;
}
.emd-setting-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 16px;
  border-radius: 13px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  flex-wrap: wrap;
}
.emd-setting-card-disabled {
  opacity: 0.6;
}
.emd-setting-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 200px;
  flex: 1;
}
.emd-setting-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-main, inherit);
}
.emd-setting-desc {
  font-size: 11.5px;
  color: var(--color-text-secondary, #888);
  line-height: 1.45;
}
.emd-empty-box {
  padding: 44px 20px;
  text-align: center;
  border-radius: 14px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.04));
  border: 1px dashed var(--border-subtle, rgba(128, 128, 128, 0.18));
  color: var(--color-text-secondary, #888);
  font-size: 12.5px;
}

/* 确认弹窗（主题自适应，防误操作核心屏障） */
.emd-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--surface-overlay-bg, rgba(0, 0, 0, 0.52));
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.emd-modal-card {
  width: min(480px, 94vw);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  background: var(--floating-surface-bg, var(--bg-card, var(--bg-main)));
  -webkit-backdrop-filter: var(--floating-surface-filter, blur(18px));
  backdrop-filter: var(--floating-surface-filter, blur(18px));
  border: 1px solid var(--surface-outline, var(--border-subtle, rgba(128, 128, 128, 0.22)));
  box-shadow: var(--shadow-dialog, 0 20px 50px rgba(0, 0, 0, 0.28));
  color: var(--color-text-main, inherit);
  overflow: hidden;
  user-select: none;
}
.emd-modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px 10px;
}
.emd-modal-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.emd-modal-icon-primary {
  background: color-mix(in srgb, var(--color-primary, #10b981) 14%, transparent);
  color: var(--color-primary, #10b981);
}
.emd-modal-icon-danger {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}
.emd-modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-main, inherit);
  margin: 0;
}
.emd-modal-body {
  padding: 6px 22px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-secondary, #888);
}
.emd-modal-summary {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.07));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.14));
}
.emd-modal-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
.emd-modal-row-label {
  color: var(--color-text-secondary, #888);
  flex-shrink: 0;
}
.emd-modal-row-val {
  color: var(--color-text-main, inherit);
  font-weight: 600;
  text-align: right;
  word-break: break-all;
}
.emd-modal-row-val-accent {
  color: var(--color-primary, #10b981);
  font-weight: 700;
}
.emd-modal-preview {
  font-size: 12px;
  color: var(--color-text-secondary, #888);
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--control-muted-bg, rgba(128, 128, 128, 0.06));
}
.emd-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px 18px;
  border-top: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  flex-wrap: wrap;
}
`;

// ============================================================================
// 插件激活入口
// ============================================================================

let store = null;

export function activate(ctx) {
  const {
    h,
    defineComponent,
    defineAsyncComponent,
    computed,
    ref,
    watch,
    onMounted,
    onUnmounted,
    Teleport,
  } = ctx.vue;

  ctx.css.inject(CSS, { id: 'echo-music-download-v23' });

  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Badge = defineAsyncComponent(ctx.ui.components.Badge);
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);
  const CustomTabBar = defineAsyncComponent(ctx.ui.components.CustomTabBar);
  const PageScrollContainer = defineAsyncComponent(ctx.ui.components.PageScrollContainer);
  const DetailPageSliverHeader = defineAsyncComponent(ctx.ui.components.DetailPageSliverHeader);
  const PageStickyHeader = defineAsyncComponent(ctx.ui.components.PageStickyHeader);
  const SongSearchInput = defineAsyncComponent(ctx.ui.components.SongSearchInput);
  const HostCheckbox = ctx.ui.components.Checkbox
    ? defineAsyncComponent(ctx.ui.components.Checkbox)
    : null;

  const renderCheckbox = ({ checked, ariaLabel = '选择', onChange }) => {
    if (HostCheckbox) {
      return h(HostCheckbox, {
        modelValue: Boolean(checked),
        ariaLabel,
        'onUpdate:modelValue': (val) => onChange(Boolean(val)),
        onClick: (e) => e.stopPropagation(),
      });
    }
    return h('input', {
      type: 'checkbox',
      class: 'emd-native-checkbox',
      checked: Boolean(checked),
      'aria-label': ariaLabel,
      onClick: (e) => e.stopPropagation(),
      onChange: (e) => onChange(Boolean(e?.target?.checked)),
    });
  };

  store = createDownloadStore(ctx);
  void store.restore();

  const qualityLabelOf = (q) => {
    if (q === 'flac') return '无损 FLAC 优先';
    if (q === '320') return '高品 320k';
    return '标准 128k';
  };

  // ---- 设置面板组件（同时用于 Tab 2 与宿主插件设置页） ----
  const renderSettingsCards = () => {
    const hasSaveDir = Boolean(store.state.saveDir);
    const opts = store.state.options;

    return h('div', { class: 'emd-settings-sections' }, [
      // 分组 1：保存与命名
      h('div', { class: 'emd-settings-section' }, [
        h('div', { class: 'emd-settings-section-title' }, '保存与命名'),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '本地保存目录（沙箱持久授权）'),
            h(
              'div',
              { class: 'emd-setting-desc' },
              hasSaveDir
                ? `当前目录：${store.state.saveDir}（同时支持被「灰歌解灰」与「本地音乐」插件复用）`
                : '尚未选择保存目录，请先授权一个本地文件夹用于存放下载的音频与 .lrc 歌词',
            ),
          ]),
          h(
            Button,
            { variant: hasSaveDir ? 'outline' : 'solid-primary', size: 'sm', onClick: store.chooseSaveDir },
            { default: () => (hasSaveDir ? '更换目录' : '选择目录') },
          ),
        ]),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '默认下载音质'),
            h(
              'div',
              { class: 'emd-setting-desc' },
              '优先请求所选档位；若无权限则自动向下回退或联动解灰通道获取高品/无损音源',
            ),
          ]),
          h(
            'div',
            { class: 'emd-seg-tabs', role: 'radiogroup', 'aria-label': '默认下载音质' },
            QUALITY_OPTIONS.map((o) =>
              h(
                'button',
                {
                  type: 'button',
                  class: [
                    'emd-seg-tab',
                    store.state.quality === o.value ? 'emd-seg-tab-active' : '',
                  ],
                  onClick: () => store.setQuality(o.value),
                },
                o.label,
              ),
            ),
          ),
        ]),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '文件名命名规则'),
            h('div', { class: 'emd-setting-desc' }, '对新加入下载队列的歌曲生效，同名 .lrc 自动保持一致'),
          ]),
          h(
            'div',
            { class: 'emd-seg-tabs', role: 'radiogroup', 'aria-label': '文件名命名规则' },
            NAME_FORMAT_OPTIONS.map((o) =>
              h(
                'button',
                {
                  type: 'button',
                  class: [
                    'emd-seg-tab',
                    store.state.nameFormat === o.value ? 'emd-seg-tab-active' : '',
                  ],
                  onClick: () => store.setNameFormat(o.value),
                },
                o.label,
              ),
            ),
          ),
        ]),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '按歌单名创建子目录'),
            h(
              'div',
              { class: 'emd-setting-desc' },
              '开启后批量下载歌单时自动归档至「保存目录/歌单名称/文件名」',
            ),
          ]),
          h(Switch, {
            modelValue: opts.playlistSubfolder,
            'onUpdate:modelValue': (v) => store.saveOptions({ playlistSubfolder: Boolean(v) }),
          }),
        ]),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '自动跳过本地已下载歌曲'),
            h(
              'div',
              { class: 'emd-setting-desc' },
              '入队前自动对比已完成记录及保存目录磁盘文件，避免重复下载',
            ),
          ]),
          h(Switch, {
            modelValue: opts.skipExisting,
            'onUpdate:modelValue': (v) => store.saveOptions({ skipExisting: Boolean(v) }),
          }),
        ]),
      ]),

      // 分组 2：元数据与歌词内嵌
      h('div', { class: 'emd-settings-section' }, [
        h('div', { class: 'emd-settings-section-title' }, '元数据与歌词内嵌'),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '自动内嵌歌曲元数据（ID3v2.3 / FLAC）'),
            h(
              'div',
              { class: 'emd-setting-desc' },
              '下载完成后使用纯 JS 引擎将歌名、歌手、专辑写入 MP3 (ID3v2.3) 或 FLAC (Vorbis Comment) 文件头',
            ),
          ]),
          h(Switch, {
            modelValue: opts.embedTags,
            'onUpdate:modelValue': (v) => store.saveOptions({ embedTags: Boolean(v) }),
          }),
        ]),

        h(
          'div',
          { class: ['emd-setting-card', !opts.embedTags ? 'emd-setting-card-disabled' : ''] },
          [
            h('div', { class: 'emd-setting-text' }, [
              h('div', { class: 'emd-setting-title' }, '内嵌 480px 高清专辑封面'),
              h(
                'div',
                { class: 'emd-setting-desc' },
                '随音频标签同步写入 APIC / FLAC Picture 封面块，无缝兼容桌面与本地音乐播放器',
              ),
            ]),
            h(Switch, {
              modelValue: opts.embedCover,
              disabled: !opts.embedTags,
              'onUpdate:modelValue': (v) => store.saveOptions({ embedCover: Boolean(v) }),
            }),
          ],
        ),

        h(
          'div',
          { class: ['emd-setting-card', !opts.embedTags ? 'emd-setting-card-disabled' : ''] },
          [
            h('div', { class: 'emd-setting-text' }, [
              h('div', { class: 'emd-setting-title' }, '内嵌歌词至音频标签'),
              h(
                'div',
                { class: 'emd-setting-desc' },
                '将同步获取的歌词写入 MP3 USLT 或 FLAC LYRICS 标签字段',
              ),
            ]),
            h(Switch, {
              modelValue: opts.embedLyrics,
              disabled: !opts.embedTags,
              'onUpdate:modelValue': (v) => store.saveOptions({ embedLyrics: Boolean(v) }),
            }),
          ],
        ),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '同步导出同名 .lrc 歌词文件'),
            h(
              'div',
              { class: 'emd-setting-desc' },
              '在音频同级目录生成同名 .lrc 歌词文件，便于外置播放器与本地曲库识别',
            ),
          ]),
          h(Switch, {
            modelValue: opts.writeLrc,
            'onUpdate:modelValue': (v) => store.saveOptions({ writeLrc: Boolean(v) }),
          }),
        ]),

        h(
          'div',
          {
            class: [
              'emd-setting-card',
              !opts.writeLrc && !opts.embedLyrics ? 'emd-setting-card-disabled' : '',
            ],
          },
          [
            h('div', { class: 'emd-setting-text' }, [
              h('div', { class: 'emd-setting-title' }, '优先合并双语翻译歌词'),
              h(
                'div',
                { class: 'emd-setting-desc' },
                '外语歌曲优先合并原文与中文翻译时间轴，提升歌词阅读体验',
              ),
            ]),
            h(Switch, {
              modelValue: opts.preferBilingualLrc,
              disabled: !opts.writeLrc && !opts.embedLyrics,
              'onUpdate:modelValue': (v) => store.saveOptions({ preferBilingualLrc: Boolean(v) }),
            }),
          ],
        ),
      ]),

      // 分组 3：灰歌解灰联动
      h('div', { class: 'emd-settings-section' }, [
        h('div', { class: 'emd-settings-section-title' }, '灰歌解灰联动'),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '灰歌 / VIP 受限歌曲自动解灰下载'),
            h(
              'div',
              { class: 'emd-setting-desc' },
              '当酷狗官方接口因无版权或 VIP 限制无法返回下载地址时，自动调用「灰歌解灰 (echo-music-unblock)」或内置聚合通道下载可用音源',
            ),
          ]),
          h(Switch, {
            modelValue: opts.useUnblockFallback,
            'onUpdate:modelValue': (v) => store.saveOptions({ useUnblockFallback: Boolean(v) }),
          }),
        ]),
      ]),

      // 分组 4：并发与队列控制
      h('div', { class: 'emd-settings-section' }, [
        h('div', { class: 'emd-settings-section-title' }, '并发与队列控制'),

        h('div', { class: 'emd-setting-card' }, [
          h('div', { class: 'emd-setting-text' }, [
            h('div', { class: 'emd-setting-title' }, '最大同时下载任务数'),
            h('div', { class: 'emd-setting-desc' }, '建议设置为 2 ~ 3，兼顾下载速率与标签写入稳定性'),
          ]),
          h(
            'div',
            { class: 'emd-seg-tabs', role: 'radiogroup', 'aria-label': '最大同时下载任务数' },
            [1, 2, 3, 4].map((n) =>
              h(
                'button',
                {
                  type: 'button',
                  class: [
                    'emd-seg-tab',
                    store.state.maxConcurrent === n ? 'emd-seg-tab-active' : '',
                  ],
                  onClick: () => store.setMaxConcurrent(n),
                },
                `${n} 线程`,
              ),
            ),
          ),
        ]),
      ]),
    ]);
  };

  // ---- 通用确认弹窗包裹器（支持 Teleport 到 body 与 ESC 关闭） ----
  const renderModalPortal = (modalVNode) => {
    if (!modalVNode) return null;
    if (Teleport && typeof document !== 'undefined' && document.body) {
      return h(Teleport, { to: 'body' }, [modalVNode]);
    }
    return modalVNode;
  };

  // ---- 主页面组件（EchoMusic v2.3.x 原生 PageScrollContainer + SliverHeader + StickyHeader + CustomTabBar 架构） ----
  const DownloadPage = defineComponent({
    name: 'EchoMusicDownloadPageV23',
    setup() {
      const headerRef = ref(null);
      const headerHeight = computed(() => headerRef.value?.currentHeight ?? 168);
      const activeTabIndex = ref(0);

      // Tab 0：任务队列过滤与批量管理状态
      const taskFilter = ref('all'); // 'all' | 'active' | 'paused' | 'done' | 'ended'
      const taskSearch = ref('');
      const batchManageMode = ref(false);
      const selectedTaskIds = ref(new Set());

      // Tab 1：歌单 / 播放队列安全选歌状态
      const batchSourceMode = ref('user-playlists'); // 'user-playlists' | 'playback-queues'
      const userPlaylists = ref([]);
      const loadingPlaylists = ref(false);
      const selectedPlaylistKey = ref('');
      const selectedPlaylistTitle = ref('');
      const batchSongs = ref([]);
      const loadingSongs = ref(false);
      const batchSearch = ref('');
      const renderLimit = ref(PAGE_RENDER_STEP);
      const selectedHashes = ref(new Set());

      // 防误操作确认弹窗状态
      const downloadConfirmState = ref(null);
      const cancelConfirmState = ref(null);

      const currentTrack = computed(() => ctx.player?.currentTrack?.value ?? null);
      const currentTrackMeta = computed(() =>
        currentTrack.value ? buildSongMeta(currentTrack.value) : null,
      );
      const playbackQueues = computed(() =>
        (ctx.playlist?.queues?.value ?? []).filter((q) => q && q.type !== 'search'),
      );

      // ESC 快捷键关闭弹窗
      const handleGlobalKeydown = (e) => {
        if (e.key !== 'Escape') return;
        if (downloadConfirmState.value) {
          downloadConfirmState.value = null;
        } else if (cancelConfirmState.value) {
          cancelConfirmState.value = null;
        }
      };

      onMounted(() => {
        if (typeof window !== 'undefined') {
          window.addEventListener('keydown', handleGlobalKeydown);
        }
        void store.refreshExistingFiles();
        void loadUserPlaylists();
      });

      onUnmounted(() => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('keydown', handleGlobalKeydown);
        }
      });

      // 自动清理已移除任务的勾选残留
      watch(
        () => store.state.tasks.map((t) => t.id).join(','),
        () => {
          if (selectedTaskIds.value.size === 0) return;
          const existingIds = new Set(store.state.tasks.map((t) => t.id));
          let changed = false;
          const next = new Set();
          for (const id of selectedTaskIds.value) {
            if (existingIds.has(id)) next.add(id);
            else changed = true;
          }
          if (changed) selectedTaskIds.value = next;
        },
      );

      // 任务统计与实时聚合速度
      const taskCounts = computed(() => {
        const all = store.state.tasks.length;
        let inProgress = 0; // queued + launching + downloading + tagging
        let downloading = 0; // launching + downloading + tagging
        let queued = 0;
        let pausable = 0; // queued + launching + downloading
        let paused = 0;
        let done = 0;
        let canceled = 0;
        let failed = 0;
        let totalSpeedBytes = 0;

        for (const t of store.state.tasks) {
          if (t.state === 'downloading' || t.state === 'launching' || t.state === 'tagging') {
            inProgress += 1;
            downloading += 1;
            if (t.state !== 'tagging') pausable += 1;
            if (t.state === 'downloading' && t.bytesPerSecond > 0) {
              totalSpeedBytes += Number(t.bytesPerSecond) || 0;
            }
          } else if (t.state === 'queued') {
            inProgress += 1;
            queued += 1;
            pausable += 1;
          } else if (t.state === 'paused') {
            paused += 1;
          } else if (t.state === 'done') {
            done += 1;
          } else if (t.state === 'canceled') {
            canceled += 1;
          } else if (t.state === 'failed') {
            failed += 1;
          }
        }
        return {
          all,
          inProgress,
          downloading,
          queued,
          pausable,
          paused,
          cancellable: pausable + paused,
          done,
          canceled,
          failed,
          ended: canceled + failed,
          totalSpeedBytes,
        };
      });

      const taskSortRank = (state) => {
        if (state === 'downloading' || state === 'tagging' || state === 'launching') return 0;
        if (state === 'paused') return 1;
        if (state === 'queued') return 2;
        if (state === 'failed') return 3;
        if (state === 'canceled') return 4;
        return 5; // done
      };

      const filteredTasks = computed(() => {
        const q = taskSearch.value.trim().toLowerCase();
        const list = store.state.tasks.filter((t) => {
          if (
            taskFilter.value === 'active' &&
            !['queued', 'launching', 'downloading', 'tagging'].includes(t.state)
          ) {
            return false;
          }
          if (taskFilter.value === 'paused' && t.state !== 'paused') return false;
          if (taskFilter.value === 'done' && t.state !== 'done') return false;
          if (taskFilter.value === 'ended' && !['canceled', 'failed'].includes(t.state)) {
            return false;
          }
          if (q && !`${t.name} ${t.album || ''} ${t.subfolder || ''}`.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        });

        // 明确排序：进行中置顶 -> 已暂停紧随其后 -> 排队中按 FIFO 顺序 -> 已结束按最新时间倒序
        return [...list].sort((a, b) => {
          const ra = taskSortRank(a.state);
          const rb = taskSortRank(b.state);
          if (ra !== rb) return ra - rb;
          if (ra <= 2) {
            return (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0);
          }
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
      });

      // Tab 0 批量勾选统计
      const selectedTaskStats = computed(() => {
        const ids = selectedTaskIds.value;
        let total = 0;
        let pausable = 0;
        let paused = 0;
        let cancellable = 0;
        let retryable = 0;
        let running = 0;
        let queued = 0;

        for (const t of store.state.tasks) {
          if (!ids.has(t.id)) continue;
          total += 1;
          if (['queued', 'launching', 'downloading'].includes(t.state)) {
            pausable += 1;
            cancellable += 1;
            if (t.state === 'queued') queued += 1;
            else running += 1;
          } else if (t.state === 'tagging') {
            running += 1;
          } else if (t.state === 'paused') {
            paused += 1;
            cancellable += 1;
          } else if (['done', 'failed', 'canceled'].includes(t.state)) {
            retryable += 1;
          }
        }
        return { total, pausable, paused, cancellable, retryable, running, queued };
      });

      const toggleTaskSelect = (taskId) => {
        const next = new Set(selectedTaskIds.value);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        selectedTaskIds.value = next;
      };

      const selectAllCurrentTasks = () => {
        const next = new Set(selectedTaskIds.value);
        for (const t of filteredTasks.value) next.add(t.id);
        selectedTaskIds.value = next;
      };

      const invertCurrentTasks = () => {
        const next = new Set(selectedTaskIds.value);
        for (const t of filteredTasks.value) {
          if (next.has(t.id)) next.delete(t.id);
          else next.add(t.id);
        }
        selectedTaskIds.value = next;
      };

      const exitBatchManageMode = () => {
        batchManageMode.value = false;
        selectedTaskIds.value = new Set();
      };

      // 安全取消确认弹窗触发器
      const requestCancelAllActive = () => {
        const counts = taskCounts.value;
        if (counts.cancellable === 0) {
          ctx.toast.info('当前没有可取消的任务');
          return;
        }
        cancelConfirmState.value = {
          mode: 'cancel-all',
          title: '确认取消全部活跃任务',
          total: counts.cancellable,
          running: counts.downloading,
          queued: counts.queued,
          paused: counts.paused,
          confirmLabel: `确认全部取消 (${counts.cancellable} 个)`,
          onConfirm: async () => {
            cancelConfirmState.value = null;
            await store.cancelAllActive();
          },
        };
      };

      const requestBatchCancel = () => {
        const stats = selectedTaskStats.value;
        if (stats.cancellable === 0) {
          ctx.toast.info('所选任务中没有进行中或已暂停的项目');
          return;
        }
        const ids = new Set(selectedTaskIds.value);
        if (stats.cancellable >= 2) {
          cancelConfirmState.value = {
            mode: 'batch-cancel',
            title: '确认批量取消选中任务',
            total: stats.cancellable,
            running: stats.running,
            queued: stats.queued,
            paused: stats.paused,
            confirmLabel: `确认批量取消 (${stats.cancellable} 个)`,
            onConfirm: async () => {
              cancelConfirmState.value = null;
              await store.batchCancel(ids);
            },
          };
          return;
        }
        void store.batchCancel(ids);
      };

      const requestBatchRemove = () => {
        const stats = selectedTaskStats.value;
        if (stats.total === 0) return;
        const ids = new Set(selectedTaskIds.value);
        if (stats.cancellable >= 2) {
          cancelConfirmState.value = {
            mode: 'batch-remove',
            title: '确认终止并移除选中任务',
            total: stats.total,
            running: stats.running,
            queued: stats.queued,
            paused: stats.paused,
            extraNote: `其中包含 ${stats.cancellable} 个未完成任务，将先停止下载再从列表移除。`,
            confirmLabel: `确认移除 (${stats.total} 项)`,
            onConfirm: async () => {
              cancelConfirmState.value = null;
              await store.batchRemove(ids);
              selectedTaskIds.value = new Set();
            },
          };
          return;
        }
        void store.batchRemove(ids).then(() => {
          selectedTaskIds.value = new Set();
        });
      };

      // ---- Tab 1：歌单 / 播放队列数据加载 ----
      const loadUserPlaylists = async () => {
        if (!ctx?.kugou?.playlist?.getUserPlaylists) {
          batchSourceMode.value = 'playback-queues';
          return;
        }
        loadingPlaylists.value = true;
        try {
          const res = await ctx.kugou.playlist.getUserPlaylists(1, 100);
          const rawList =
            res?.data?.info || res?.info || res?.data?.lists || res?.lists || [];
          const normalized = [];
          if (Array.isArray(rawList)) {
            for (const item of rawList) {
              if (!item) continue;
              const listid = item.listid ?? item.list_id ?? '';
              const gid =
                item.global_collection_id || item.list_create_gid || item.gid || '';
              const key = String(listid || gid || item.name || '');
              if (!key) continue;
              const rawPic = String(item.pic || item.img || '').trim();
              normalized.push({
                key,
                listid,
                gid,
                title: String(item.name || '未命名歌单').trim(),
                count: Number(item.count || item.song_count || 0),
                coverUrl: rawPic ? rawPic.replace(/\{size\}/g, '240') : '',
              });
            }
          }
          userPlaylists.value = normalized;
          if (normalized.length > 0 && !selectedPlaylistKey.value) {
            await selectUserPlaylist(normalized[0]);
          } else if (normalized.length === 0 && playbackQueues.value.length > 0) {
            batchSourceMode.value = 'playback-queues';
            await selectPlaybackQueue(playbackQueues.value[0]);
          }
        } catch (e) {
          console.warn('[echo-music-download] 获取用户歌单失败:', e);
          if (playbackQueues.value.length > 0) {
            batchSourceMode.value = 'playback-queues';
            await selectPlaybackQueue(playbackQueues.value[0]);
          }
        } finally {
          loadingPlaylists.value = false;
        }
      };

      let loadSongsSeq = 0;
      const selectUserPlaylist = async (pl) => {
        if (!pl) return;
        const seq = ++loadSongsSeq;
        selectedPlaylistKey.value = pl.key;
        selectedPlaylistTitle.value = pl.title;
        loadingSongs.value = true;
        batchSongs.value = [];
        selectedHashes.value = new Set();
        renderLimit.value = PAGE_RENDER_STEP;

        const allSongs = [];
        try {
          const isShortNumeric =
            pl.listid !== '' &&
            /^\d+$/.test(String(pl.listid)) &&
            String(pl.listid).length <= 12;

          if (isShortNumeric && ctx?.kugou?.playlist?.getPlaylistTracksNew) {
            const pageSize = 300;
            for (let page = 1; page <= 15; page += 1) {
              const res = await ctx.kugou.playlist.getPlaylistTracksNew(
                pl.listid,
                page,
                pageSize,
              );
              const list =
                res?.data?.info || res?.data?.songs || res?.info || res?.songs || [];
              if (!Array.isArray(list) || list.length === 0) break;
              allSongs.push(...list);
              if (list.length < pageSize || (pl.count > 0 && allSongs.length >= pl.count)) {
                break;
              }
            }
          }

          if (allSongs.length === 0 && pl.gid && ctx?.kugou?.playlist?.getPlaylistTracks) {
            const pageSize = 200;
            for (let page = 1; page <= 15; page += 1) {
              const res = await ctx.kugou.playlist.getPlaylistTracks(
                pl.gid,
                page,
                pageSize,
              );
              const list =
                res?.data?.info || res?.data?.songs || res?.info || res?.songs || [];
              if (!Array.isArray(list) || list.length === 0) break;
              allSongs.push(...list);
              if (list.length < pageSize) break;
            }
          }
        } catch (e) {
          console.warn('[echo-music-download] 加载歌单曲目失败:', e);
        }

        if (seq !== loadSongsSeq) return;
        loadingSongs.value = false;
        batchSongs.value = allSongs.filter((s) => buildSongMeta(s).hash);
      };

      const selectPlaybackQueue = async (queue) => {
        if (!queue) return;
        const seq = ++loadSongsSeq;
        selectedPlaylistKey.value = queue.id;
        selectedPlaylistTitle.value = queue.title || '播放队列';
        loadingSongs.value = true;
        batchSongs.value = [];
        selectedHashes.value = new Set();
        renderLimit.value = PAGE_RENDER_STEP;

        let songs = [];
        try {
          songs = ctx.playlist?.getQueueSongs(queue.id) ?? [];
          if (
            songs.length === 0 &&
            queue.id &&
            typeof ctx.playlist?.store?.ensurePlaybackQueueSongsLoaded === 'function'
          ) {
            const loaded = await ctx.playlist.store.ensurePlaybackQueueSongsLoaded(queue.id);
            if (loaded) songs = ctx.playlist?.getQueueSongs(queue.id) ?? loaded.songs ?? [];
          }
        } catch {}

        if (seq !== loadSongsSeq) return;
        loadingSongs.value = false;
        batchSongs.value = (Array.isArray(songs) ? songs : []).filter(
          (s) => buildSongMeta(s).hash,
        );
      };

      watch(batchSourceMode, (mode) => {
        if (mode === 'user-playlists') {
          if (userPlaylists.value.length > 0) {
            void selectUserPlaylist(userPlaylists.value[0]);
          } else {
            void loadUserPlaylists();
          }
        } else if (playbackQueues.value.length > 0) {
          void selectPlaybackQueue(playbackQueues.value[0]);
        } else {
          batchSongs.value = [];
          selectedHashes.value = new Set();
        }
      });

      const currentSubfolder = computed(() =>
        store.state.options.playlistSubfolder && selectedPlaylistTitle.value
          ? sanitizePathSegment(selectedPlaylistTitle.value, '歌单')
          : '',
      );

      const filteredBatchSongs = computed(() => {
        const q = batchSearch.value.trim().toLowerCase();
        if (!q) return batchSongs.value;
        return batchSongs.value.filter((s) => {
          const m = buildSongMeta(s);
          return `${m.artist} ${m.title} ${m.album}`.toLowerCase().includes(q);
        });
      });

      const visibleBatchSongs = computed(() =>
        filteredBatchSongs.value.slice(0, renderLimit.value),
      );

      const localCountInFiltered = computed(() => {
        const sub = currentSubfolder.value;
        let count = 0;
        for (const s of filteredBatchSongs.value) {
          if (store.isSongAlreadyDownloaded(s, sub)) count += 1;
        }
        return count;
      });

      // Tab 1 精确勾选统计（与 enqueueSongs 逻辑 100% 一致）
      const selectionSummary = computed(() => {
        const sub = currentSubfolder.value;
        const skipExisting = Boolean(store.state.options.skipExisting);
        const picked = [];
        const toDownload = [];
        const seen = new Set();
        let existingCount = 0;
        let inQueueCount = 0;

        for (const song of batchSongs.value) {
          const meta = buildSongMeta(song);
          if (!meta.hash) continue;
          const hashKey = meta.hash.toLowerCase();
          if (!selectedHashes.value.has(meta.hash) || seen.has(hashKey)) continue;
          seen.add(hashKey);
          picked.push(song);

          if (store.isSongInActiveQueue(song)) {
            inQueueCount += 1;
            continue;
          }
          if (store.isSongAlreadyDownloaded(song, sub)) {
            existingCount += 1;
            if (skipExisting) continue;
          }
          toDownload.push(song);
        }

        return {
          picked,
          toDownload,
          selectedCount: picked.length,
          existingCount,
          skippedExistingCount: skipExisting ? existingCount : 0,
          inQueueCount,
          actualCount: toDownload.length,
        };
      });

      const toggleSongCheck = (hash) => {
        if (!hash) return;
        const next = new Set(selectedHashes.value);
        if (next.has(hash)) next.delete(hash);
        else next.add(hash);
        selectedHashes.value = next;
      };

      const selectVisibleBatchSongs = () => {
        const next = new Set(selectedHashes.value);
        for (const s of visibleBatchSongs.value) {
          const hVal = buildSongMeta(s).hash;
          if (hVal) next.add(hVal);
        }
        selectedHashes.value = next;
      };

      const selectAllPlaylistSongs = () => {
        selectedHashes.value = new Set(
          filteredBatchSongs.value.map((s) => buildSongMeta(s).hash).filter(Boolean),
        );
      };

      const clearSongSelection = () => {
        selectedHashes.value = new Set();
      };

      const downloadCurrentTrack = () => {
        const track = currentTrack.value;
        if (!track || !buildSongMeta(track).hash) {
          ctx.toast.info('当前没有正在播放的可下载歌曲');
          return;
        }
        void store.enqueueSongs([track]);
      };

      // 防误操作批量下载入口：>= 3 首或选中整张歌单时强制弹出确认弹窗
      const prepareBatchDownload = () => {
        if (!store.state.saveDir) {
          ctx.toast.info('请先选择歌曲保存目录');
          return;
        }
        const summary = selectionSummary.value;
        if (summary.selectedCount === 0) {
          ctx.toast.info('请先勾选要下载的歌曲');
          return;
        }
        if (summary.actualCount === 0) {
          if (summary.skippedExistingCount > 0) {
            ctx.toast.info(`已勾选的 ${summary.skippedExistingCount} 首歌曲均已存在于本地`);
          } else if (summary.inQueueCount > 0) {
            ctx.toast.info(`已勾选的 ${summary.inQueueCount} 首歌曲均已在下载队列中`);
          }
          return;
        }

        const isFullPlaylist =
          filteredBatchSongs.value.length >= 2 &&
          summary.selectedCount >= filteredBatchSongs.value.length;
        const needConfirm =
          summary.actualCount >= 3 || summary.selectedCount >= 3 || isFullPlaylist;

        if (!needConfirm) {
          void store
            .enqueueSongs(summary.picked, {
              playlistName: selectedPlaylistTitle.value,
              startPaused: false,
            })
            .then((res) => {
              if (res?.added > 0) {
                selectedHashes.value = new Set();
              }
            });
          return;
        }

        const opts = store.state.options;
        const tagParts = [];
        if (opts.embedTags) {
          tagParts.push(
            opts.embedCover
              ? '内嵌 ID3v2/FLAC 标签与封面'
              : '内嵌 ID3v2/FLAC 文字标签',
          );
        } else {
          tagParts.push('仅下载音频文件');
        }
        if (opts.writeLrc) {
          tagParts.push(opts.preferBilingualLrc ? '导出双语 .lrc' : '导出 .lrc');
        }

        const previewNames = summary.toDownload
          .slice(0, 4)
          .map((s) => {
            const m = buildSongMeta(s);
            return m.artist ? `${m.artist} - ${m.title}` : m.title;
          })
          .filter(Boolean);

        downloadConfirmState.value = {
          picked: summary.picked,
          playlistName: selectedPlaylistTitle.value,
          subfolder: currentSubfolder.value,
          actualCount: summary.actualCount,
          skippedExistingCount: summary.skippedExistingCount,
          inQueueCount: summary.inQueueCount,
          qualityLabel: qualityLabelOf(store.state.quality),
          tagSummary: tagParts.join(' · '),
          previewNames,
        };
      };

      const executeConfirmedDownload = async (startPaused) => {
        const payload = downloadConfirmState.value;
        downloadConfirmState.value = null;
        if (!payload) return;
        const res = await store.enqueueSongs(payload.picked, {
          playlistName: payload.playlistName,
          startPaused,
        });
        if (res?.added > 0) {
          selectedHashes.value = new Set();
          activeTabIndex.value = 0;
        }
      };

      // ---- 渲染单个任务卡片（清晰的单任务暂停/继续/取消/重试/移除 + 复选框） ----
      const renderTaskCard = (task) => {
        const label = TASK_STATE_LABEL[task.state] || task.state;
        const isRunning = ['downloading', 'launching', 'tagging'].includes(task.state);
        const isQueued = task.state === 'queued';
        const isPaused = task.state === 'paused';
        const isEnded = ['done', 'failed', 'canceled'].includes(task.state);
        const isChecked = selectedTaskIds.value.has(task.id);
        const pct =
          task.percent != null && !Number.isNaN(Number(task.percent))
            ? Number(task.percent)
            : task.state === 'done'
              ? 100
              : 0;
        const showProgress = isRunning || (isPaused && pct > 0) || task.state === 'done';

        return h(
          'div',
          {
            class: [
              'emd-task-card',
              isChecked ? 'emd-task-card-selected' : '',
              batchManageMode.value ? 'emd-task-card-clickable' : '',
            ],
            key: task.id,
            onClick: () => {
              if (batchManageMode.value) toggleTaskSelect(task.id);
            },
          },
          [
            h('div', { class: 'emd-task-check-wrap' }, [
              renderCheckbox({
                checked: isChecked,
                ariaLabel: `选择任务 ${task.name}`,
                onChange: () => toggleTaskSelect(task.id),
              }),
            ]),

            task.coverUrl
              ? h('img', { class: 'emd-task-cover', src: task.coverUrl, alt: '' })
              : h('div', { class: 'emd-task-cover' }, [iconSvg(h, ICONS.music, { size: 20 })]),

            h('div', { class: 'emd-task-main' }, [
              h('div', { class: 'emd-task-row1' }, [
                h('span', { class: 'emd-task-title', title: task.name }, task.name),
                h(
                  'span',
                  { class: 'emd-badge emd-badge-quality' },
                  task.quality === 'flac'
                    ? 'FLAC 无损'
                    : task.quality === '320'
                      ? '320k 高品'
                      : '128k 标准',
                ),
                task.sourceLabel && task.sourceLabel !== '酷狗官方'
                  ? h('span', { class: 'emd-badge emd-badge-source' }, task.sourceLabel)
                  : null,
                task.subfolder
                  ? h('span', { class: 'emd-badge emd-badge-folder' }, `📁 ${task.subfolder}`)
                  : null,
                task.tagStatus
                  ? h('span', { class: 'emd-badge emd-badge-tag' }, task.tagStatus)
                  : null,
                task.lrcStatus
                  ? h('span', { class: 'emd-badge emd-badge-tag' }, task.lrcStatus)
                  : null,
                h('span', { class: `emd-badge emd-badge-state-${task.state}` }, label),
              ]),

              showProgress
                ? h('div', { class: 'emd-progress-track' }, [
                    h('div', {
                      class: [
                        'emd-progress-bar',
                        isPaused ? 'emd-progress-bar-paused' : '',
                        task.state === 'done' ? 'emd-progress-bar-done' : '',
                      ],
                      style: { width: `${pct}%` },
                    }),
                  ])
                : null,

              h('div', { class: 'emd-task-sub' }, [
                isRunning
                  ? h(
                      'span',
                      { style: { color: 'var(--color-primary, #10b981)', fontWeight: 700 } },
                      task.state === 'tagging'
                        ? '正在写入 ID3v2/FLAC 元数据与歌词…'
                        : task.state === 'launching'
                          ? '正在解析可用音源…'
                          : `${pct.toFixed(0)}%${task.speed ? ` · ${task.speed}` : ''}${task.eta ? ` · 剩余 ${task.eta}` : ''}`,
                    )
                  : null,
                isPaused && pct > 0
                  ? h('span', { style: { color: '#d97706', fontWeight: 600 } }, `已暂停于 ${pct.toFixed(0)}%`)
                  : null,
                task.album ? h('span', null, `专辑：${task.album}`) : null,
                task.note ? h('span', null, task.note) : null,
                task.state === 'done' && task.finalPath
                  ? h('span', { title: task.finalPath }, `保存至：${task.fileName || task.finalPath}`)
                  : null,
                task.state === 'failed' && task.error
                  ? h('span', { style: { color: '#ef4444', fontWeight: 600 } }, task.error)
                  : null,
              ]),
            ]),

            h(
              'div',
              {
                class: 'emd-task-actions',
                onClick: (e) => e.stopPropagation(),
              },
              [
                // 进行中 / 排队中 -> 暂停 + 取消
                task.state === 'downloading' || task.state === 'launching' || isQueued
                  ? h(
                      Button,
                      {
                        variant: 'outline',
                        size: 'xs',
                        onClick: () => void store.pauseTask(task),
                      },
                      {
                        default: () =>
                          h('span', { class: 'emd-btn-inner' }, [
                            iconSvg(h, ICONS.pause, { size: 13 }),
                            h('span', null, '暂停'),
                          ]),
                      },
                    )
                  : null,

                // 已暂停 -> 继续 + 取消
                isPaused
                  ? h(
                      Button,
                      {
                        variant: 'primary',
                        size: 'xs',
                        onClick: () => void store.resumeTask(task),
                      },
                      {
                        default: () =>
                          h('span', { class: 'emd-btn-inner' }, [
                            iconSvg(h, ICONS.play, { size: 13 }),
                            h('span', null, '继续'),
                          ]),
                      },
                    )
                  : null,

                // 取消按钮（排队中 / 解析中 / 下载中 / 已暂停）
                task.state === 'downloading' ||
                task.state === 'launching' ||
                isQueued ||
                isPaused
                  ? h(
                      Button,
                      {
                        variant: 'danger',
                        size: 'xs',
                        onClick: () => void store.cancelTask(task),
                      },
                      {
                        default: () =>
                          h('span', { class: 'emd-btn-inner' }, [
                            iconSvg(h, ICONS.close, { size: 13 }),
                            h('span', null, '取消'),
                          ]),
                      },
                    )
                  : null,

                // 写标签中提示
                task.state === 'tagging'
                  ? h(
                      'span',
                      { style: { fontSize: '11.5px', color: 'var(--color-text-secondary, #888)' } },
                      '写入中…',
                    )
                  : null,

                // 已完成 / 失败 / 已取消 -> 重新下载 + 移除
                isEnded
                  ? h(
                      Button,
                      {
                        variant: 'outline',
                        size: 'xs',
                        onClick: () => void store.retryTask(task),
                      },
                      {
                        default: () =>
                          h('span', { class: 'emd-btn-inner' }, [
                            iconSvg(h, ICONS.refresh, { size: 13 }),
                            h('span', null, '重新下载'),
                          ]),
                      },
                    )
                  : null,

                isEnded
                  ? h(
                      Button,
                      {
                        variant: 'ghost',
                        size: 'xs',
                        onClick: () => void store.removeTask(task),
                      },
                      {
                        default: () =>
                          h('span', { class: 'emd-btn-inner' }, [
                            iconSvg(h, ICONS.trash, { size: 13 }),
                            h('span', null, '移除'),
                          ]),
                      },
                    )
                  : null,
              ],
            ),
          ],
        );
      };

      // ---- Tab 0：下载队列（Task Manager） ----
      const renderTasksTab = () => {
        const hasSaveDir = Boolean(store.state.saveDir);
        const counts = taskCounts.value;

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
          // 未选择目录时的精简引导提示（无重复下载按钮/音质选择）
          !hasSaveDir
            ? h('div', { class: 'emd-dir-alert' }, [
                h('div', { class: 'emd-dir-alert-left' }, [
                  iconSvg(h, ICONS.alert, { size: 16 }),
                  h('span', null, '尚未设置本地保存目录，请先授权保存文件夹以开始下载歌曲。'),
                ]),
                h(
                  Button,
                  { variant: 'solid-primary', size: 'xs', onClick: store.chooseSaveDir },
                  { default: () => '立即选择目录' },
                ),
              ])
            : null,

          // 队列总控栏
          h('div', { class: 'emd-control-bar' }, [
            // Row 1：过滤页签 + 实时聚合速度 + 搜索框
            h('div', { class: 'emd-control-row' }, [
              h('div', { class: 'emd-control-group' }, [
                h(
                  'div',
                  { class: 'emd-seg-tabs', role: 'tablist', 'aria-label': '任务状态筛选' },
                  [
                    { id: 'all', label: '全部', count: counts.all },
                    { id: 'active', label: '进行中', count: counts.inProgress },
                    { id: 'paused', label: '已暂停', count: counts.paused },
                    { id: 'done', label: '已完成', count: counts.done },
                    { id: 'ended', label: '已取消/失败', count: counts.ended },
                  ].map((f) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'tab',
                        'aria-selected': taskFilter.value === f.id ? 'true' : 'false',
                        class: [
                          'emd-seg-tab',
                          taskFilter.value === f.id ? 'emd-seg-tab-active' : '',
                        ],
                        key: f.id,
                        onClick: () => {
                          taskFilter.value = f.id;
                        },
                      },
                      [
                        h('span', null, f.label),
                        h('span', { class: 'emd-seg-count' }, String(f.count)),
                      ],
                    ),
                  ),
                ),

                counts.downloading > 0
                  ? h('span', { class: 'emd-speed-chip' }, [
                      h('span', { class: 'emd-speed-dot' }),
                      h(
                        'span',
                        null,
                        counts.totalSpeedBytes > 0
                          ? `↓ ${formatBytes(counts.totalSpeedBytes)}/s · ${counts.downloading} 个进行中`
                          : `${counts.downloading} 个处理中`,
                      ),
                    ])
                  : null,
              ]),

              h(SongSearchInput, {
                modelValue: taskSearch.value,
                placeholder: '搜索下载任务…',
                'onUpdate:modelValue': (v) => {
                  taskSearch.value = String(v ?? '');
                },
              }),
            ]),

            // Row 2：显式全局队列操作（全部暂停 / 全部继续 / 全部取消）+ 批量管理 + 清理
            h('div', { class: 'emd-control-row' }, [
              h('div', { class: 'emd-control-group' }, [
                h(
                  Button,
                  {
                    variant: 'outline',
                    size: 'xs',
                    disabled: counts.pausable === 0,
                    onClick: () => void store.pauseAll(),
                  },
                  {
                    default: () =>
                      h('span', { class: 'emd-btn-inner' }, [
                        iconSvg(h, ICONS.pause, { size: 13 }),
                        h('span', null, counts.pausable > 0 ? `全部暂停 (${counts.pausable})` : '全部暂停'),
                      ]),
                  },
                ),
                h(
                  Button,
                  {
                    variant: counts.paused > 0 ? 'primary' : 'outline',
                    size: 'xs',
                    disabled: counts.paused === 0,
                    onClick: () => void store.resumeAll(),
                  },
                  {
                    default: () =>
                      h('span', { class: 'emd-btn-inner' }, [
                        iconSvg(h, ICONS.play, { size: 13 }),
                        h('span', null, counts.paused > 0 ? `全部继续 (${counts.paused})` : '全部继续'),
                      ]),
                  },
                ),
                h(
                  Button,
                  {
                    variant: 'danger',
                    size: 'xs',
                    disabled: counts.cancellable === 0,
                    onClick: requestCancelAllActive,
                  },
                  {
                    default: () =>
                      h('span', { class: 'emd-btn-inner' }, [
                        iconSvg(h, ICONS.stop, { size: 13 }),
                        h('span', null, counts.cancellable > 0 ? `全部取消 (${counts.cancellable})` : '全部取消'),
                      ]),
                  },
                ),
              ]),

              h('div', { class: 'emd-control-group' }, [
                h(
                  Button,
                  {
                    variant: batchManageMode.value ? 'primary' : 'outline',
                    size: 'xs',
                    disabled: counts.all === 0,
                    onClick: () => {
                      if (batchManageMode.value) {
                        exitBatchManageMode();
                      } else {
                        batchManageMode.value = true;
                      }
                    },
                  },
                  {
                    default: () =>
                      h('span', { class: 'emd-btn-inner' }, [
                        iconSvg(h, ICONS.checkSquare, { size: 13 }),
                        h('span', null, batchManageMode.value ? '退出批量管理' : '批量管理'),
                      ]),
                  },
                ),
                counts.failed > 0
                  ? h(
                      Button,
                      { variant: 'outline', size: 'xs', onClick: store.retryAllFailed },
                      { default: () => `重试失败 (${counts.failed})` },
                    )
                  : null,
                counts.done + counts.ended > 0
                  ? h(
                      Button,
                      { variant: 'ghost', size: 'xs', onClick: store.clearFinished },
                      { default: () => '清理已完成' },
                    )
                  : null,
              ]),
            ]),
          ]),

          // 任务卡片列表
          filteredTasks.value.length === 0
            ? h(
                'div',
                { class: 'emd-empty-box' },
                store.state.tasks.length === 0
                  ? '暂无下载任务。可切换到「选歌与歌单下载」勾选需要的歌曲，或在播放歌曲时点击页头「下载当前播放」。'
                  : '当前筛选条件下暂无匹配任务',
              )
            : h(
                'div',
                { class: 'emd-task-grid' },
                filteredTasks.value.map((t) => renderTaskCard(t)),
              ),
        ]);
      };

      // ---- Tab 1：选歌与歌单下载（零误触安全选歌体验） ----
      const renderBatchTab = () => {
        const hasSaveDir = Boolean(store.state.saveDir);
        const sub = currentSubfolder.value;

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
          !hasSaveDir
            ? h('div', { class: 'emd-dir-alert' }, [
                h('div', { class: 'emd-dir-alert-left' }, [
                  iconSvg(h, ICONS.alert, { size: 16 }),
                  h('span', null, '请先选择保存目录，然后再勾选歌曲加入下载队列。'),
                ]),
                h(
                  Button,
                  { variant: 'solid-primary', size: 'xs', onClick: store.chooseSaveDir },
                  { default: () => '立即选择目录' },
                ),
              ])
            : null,

          // 来源切换（分段标签） + 清晰标注的 Switch 开关（非按钮胶囊！）
          h('div', { class: 'emd-toolbar' }, [
            h('div', { class: 'emd-control-group' }, [
              h('div', { class: 'emd-seg-tabs', role: 'tablist', 'aria-label': '选歌来源' }, [
                h(
                  'button',
                  {
                    type: 'button',
                    class: [
                      'emd-seg-tab',
                      batchSourceMode.value === 'user-playlists' ? 'emd-seg-tab-active' : '',
                    ],
                    onClick: () => {
                      batchSourceMode.value = 'user-playlists';
                    },
                  },
                  [
                    h('span', null, '我的酷狗歌单'),
                    h('span', { class: 'emd-seg-count' }, String(userPlaylists.value.length)),
                  ],
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: [
                      'emd-seg-tab',
                      batchSourceMode.value === 'playback-queues' ? 'emd-seg-tab-active' : '',
                    ],
                    onClick: () => {
                      batchSourceMode.value = 'playback-queues';
                    },
                  },
                  [
                    h('span', null, '播放队列'),
                    h('span', { class: 'emd-seg-count' }, String(playbackQueues.value.length)),
                  ],
                ),
              ]),

              batchSourceMode.value === 'user-playlists'
                ? h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'xs',
                      disabled: loadingPlaylists.value,
                      onClick: loadUserPlaylists,
                    },
                    {
                      default: () =>
                        h('span', { class: 'emd-btn-inner' }, [
                          iconSvg(h, ICONS.refresh, { size: 13 }),
                          h('span', null, loadingPlaylists.value ? '刷新中…' : '刷新歌单'),
                        ]),
                    },
                  )
                : null,
            ]),

            h('div', { class: 'emd-switch-group' }, [
              h('label', { class: 'emd-switch-item' }, [
                h(Switch, {
                  size: 'sm',
                  modelValue: store.state.options.playlistSubfolder,
                  'onUpdate:modelValue': (v) =>
                    store.saveOptions({ playlistSubfolder: Boolean(v) }),
                }),
                h('span', null, '按歌单建子目录'),
              ]),
              h('label', { class: 'emd-switch-item' }, [
                h(Switch, {
                  size: 'sm',
                  modelValue: store.state.options.skipExisting,
                  'onUpdate:modelValue': (v) => store.saveOptions({ skipExisting: Boolean(v) }),
                }),
                h('span', null, '自动跳过已下载'),
              ]),
            ]),
          ]),

          // 歌单 / 队列横向选择条
          batchSourceMode.value === 'user-playlists'
            ? userPlaylists.value.length === 0
              ? h(
                  'div',
                  { class: 'emd-empty-box' },
                  loadingPlaylists.value
                    ? '正在获取您的酷狗歌单（我喜欢 / 自建 / 收藏）…'
                    : '未获取到用户歌单，请确认已登录酷狗账号或切换到「播放队列」',
                )
              : h(
                  'div',
                  { class: 'emd-playlist-strip' },
                  userPlaylists.value.map((pl) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        class: [
                          'emd-playlist-card',
                          selectedPlaylistKey.value === pl.key ? 'emd-playlist-card-active' : '',
                        ],
                        key: pl.key,
                        onClick: () => selectUserPlaylist(pl),
                      },
                      [
                        pl.coverUrl
                          ? h('img', { class: 'emd-playlist-cover', src: pl.coverUrl, alt: '' })
                          : h('div', { class: 'emd-playlist-cover' }, [
                              iconSvg(h, ICONS.list, { size: 18 }),
                            ]),
                        h('div', { class: 'emd-playlist-info' }, [
                          h('div', { class: 'emd-playlist-name' }, pl.title),
                          h('div', { class: 'emd-playlist-count' }, `${pl.count || 0} 首`),
                        ]),
                      ],
                    ),
                  ),
                )
            : playbackQueues.value.length === 0
              ? h('div', { class: 'emd-empty-box' }, '当前暂无播放队列')
              : h(
                  'div',
                  { class: 'emd-playlist-strip' },
                  playbackQueues.value.map((q) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        class: [
                          'emd-playlist-card',
                          selectedPlaylistKey.value === q.id ? 'emd-playlist-card-active' : '',
                        ],
                        key: q.id,
                        onClick: () => selectPlaybackQueue(q),
                      },
                      [
                        h('div', { class: 'emd-playlist-cover' }, [
                          iconSvg(h, ICONS.music, { size: 18 }),
                        ]),
                        h('div', { class: 'emd-playlist-info' }, [
                          h('div', { class: 'emd-playlist-name' }, q.title || '播放队列'),
                          h(
                            'div',
                            { class: 'emd-playlist-count' },
                            `${q.songCount ?? q.songs?.length ?? 0} 首`,
                          ),
                        ]),
                      ],
                    ),
                  ),
                ),

          // 当前歌单信息 + 搜索框（顶部不再放置高危“一键下载整张歌单”按钮）
          h('div', { class: 'emd-playlist-meta-bar' }, [
            h('div', null, [
              h(
                'span',
                { class: 'emd-playlist-meta-title' },
                selectedPlaylistTitle.value || '歌曲列表',
              ),
              h(
                'span',
                { class: 'emd-playlist-meta-sub' },
                `共 ${filteredBatchSongs.value.length} 首${localCountInFiltered.value > 0 ? ` · 本地已有 ${localCountInFiltered.value} 首` : ''} · 点击行仅勾选，底部操作栏确认后才开始下载`,
              ),
            ]),
            h(SongSearchInput, {
              modelValue: batchSearch.value,
              placeholder: '在当前歌单中搜索歌名/歌手…',
              'onUpdate:modelValue': (v) => {
                batchSearch.value = String(v ?? '');
              },
            }),
          ]),

          // 歌曲勾选列表
          loadingSongs.value
            ? h('div', { class: 'emd-empty-box' }, '正在加载歌单全量曲目，请稍候…')
            : filteredBatchSongs.value.length === 0
              ? h('div', { class: 'emd-empty-box' }, '该歌单暂无匹配曲目')
              : h('div', { class: 'emd-song-table' }, [
                  ...visibleBatchSongs.value.map((song, idx) => {
                    const meta = buildSongMeta(song);
                    const checked = selectedHashes.value.has(meta.hash);
                    const alreadyDone = store.isSongAlreadyDownloaded(song, sub);
                    const inQueue = store.isSongInActiveQueue(song);

                    return h(
                      'div',
                      {
                        class: ['emd-song-item', checked ? 'emd-song-item-selected' : ''],
                        key: `${meta.hash}-${idx}`,
                      },
                      [
                        renderCheckbox({
                          checked,
                          ariaLabel: `勾选歌曲 ${meta.title}`,
                          onChange: () => toggleSongCheck(meta.hash),
                        }),
                        h(
                          'div',
                          {
                            class: 'emd-song-item-main',
                            onClick: () => toggleSongCheck(meta.hash),
                          },
                          [
                            h('div', { style: { minWidth: 0, flex: 1 } }, [
                              h('div', { class: 'emd-song-item-title' }, meta.title || '未知歌曲'),
                              h(
                                'div',
                                { class: 'emd-song-item-sub' },
                                `${meta.artist || '未知歌手'}${meta.album ? ` · 《${meta.album}》` : ''}`,
                              ),
                            ]),
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                              inQueue
                                ? h('span', { class: 'emd-badge emd-badge-state-queued' }, '队列中')
                                : null,
                              alreadyDone
                                ? h('span', { class: 'emd-badge emd-badge-state-done' }, '✓ 已在本地')
                                : null,
                            ]),
                          ],
                        ),
                        // 视觉隔离的最右侧单曲快捷下载图标（带 tooltip 且不与行勾选冲突）
                        h('span', { class: 'emd-row-quick-sep', 'aria-hidden': 'true' }),
                        h(
                          'button',
                          {
                            type: 'button',
                            class: 'emd-row-quick-dl',
                            title: `仅下载此单曲：${meta.title || '未知歌曲'}`,
                            'aria-label': `仅下载此单曲 ${meta.title || ''}`,
                            disabled: !hasSaveDir || inQueue,
                            onClick: (e) => {
                              e.stopPropagation();
                              void store.enqueueSongs([song], {
                                playlistName: selectedPlaylistTitle.value,
                              });
                            },
                          },
                          [iconSvg(h, ICONS.download, { size: 14 })],
                        ),
                      ],
                    );
                  }),
                  filteredBatchSongs.value.length > visibleBatchSongs.value.length
                    ? h(
                        'div',
                        {
                          style: {
                            padding: '10px',
                            textAlign: 'center',
                            borderTop: '1px solid var(--border-subtle, rgba(128,128,128,0.1))',
                          },
                        },
                        [
                          h(
                            Button,
                            {
                              variant: 'ghost',
                              size: 'xs',
                              onClick: () => {
                                renderLimit.value += PAGE_RENDER_STEP;
                              },
                            },
                            {
                              default: () =>
                                `展开更多曲目（已显示 ${visibleBatchSongs.value.length} / 共 ${filteredBatchSongs.value.length} 首）`,
                            },
                          ),
                        ],
                      )
                    : null,
                ]),
        ]);
      };

      // ---- 底部常驻吸底操作栏（Tab 0 批量管理栏 / Tab 1 安全选歌操作栏） ----
      const renderStickyBottomBar = () => {
        // Tab 0 批量操作栏
        if (
          activeTabIndex.value === 0 &&
          (batchManageMode.value || selectedTaskIds.value.size > 0)
        ) {
          const stats = selectedTaskStats.value;
          const ids = new Set(selectedTaskIds.value);

          return h('div', { class: 'emd-bottom-bar', role: 'region', 'aria-label': '任务批量操作栏' }, [
            h('div', { class: 'emd-bottom-bar-info' }, [
              h('span', { class: 'emd-bottom-bar-count' }, `已选 ${stats.total} 项`),
              h(
                Button,
                {
                  variant: 'ghost',
                  size: 'xs',
                  disabled: filteredTasks.value.length === 0,
                  onClick: selectAllCurrentTasks,
                },
                { default: () => '全选当前视图' },
              ),
              h(
                Button,
                {
                  variant: 'ghost',
                  size: 'xs',
                  disabled: filteredTasks.value.length === 0,
                  onClick: invertCurrentTasks,
                },
                { default: () => '反选' },
              ),
            ]),

            h('div', { class: 'emd-bottom-bar-actions' }, [
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'xs',
                  disabled: stats.pausable === 0,
                  onClick: () => void store.batchPause(ids),
                },
                { default: () => `批量暂停${stats.pausable > 0 ? ` (${stats.pausable})` : ''}` },
              ),
              h(
                Button,
                {
                  variant: stats.paused > 0 ? 'primary' : 'outline',
                  size: 'xs',
                  disabled: stats.paused === 0,
                  onClick: () => void store.batchResume(ids),
                },
                { default: () => `批量继续${stats.paused > 0 ? ` (${stats.paused})` : ''}` },
              ),
              h(
                Button,
                {
                  variant: 'danger',
                  size: 'xs',
                  disabled: stats.cancellable === 0,
                  onClick: requestBatchCancel,
                },
                { default: () => `批量取消${stats.cancellable > 0 ? ` (${stats.cancellable})` : ''}` },
              ),
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'xs',
                  disabled: stats.retryable === 0,
                  onClick: () => store.batchRetry(ids),
                },
                { default: () => `批量重试${stats.retryable > 0 ? ` (${stats.retryable})` : ''}` },
              ),
              h(
                Button,
                {
                  variant: 'danger',
                  size: 'xs',
                  disabled: stats.total === 0,
                  onClick: requestBatchRemove,
                },
                { default: () => '批量删除' },
              ),
              h(
                Button,
                {
                  variant: 'ghost',
                  size: 'xs',
                  onClick: exitBatchManageMode,
                },
                { default: () => '退出批量' },
              ),
            ]),
          ]);
        }

        // Tab 1 选歌确认吸底栏
        if (activeTabIndex.value === 1 && batchSongs.value.length > 0) {
          const hasSaveDir = Boolean(store.state.saveDir);
          const summary = selectionSummary.value;
          const skipExisting = Boolean(store.state.options.skipExisting);

          const summaryText =
            summary.selectedCount === 0
              ? `尚未勾选歌曲（当前歌单 ${filteredBatchSongs.value.length} 首，${localCountInFiltered.value} 首已在本地）`
              : skipExisting
                ? `已勾选 ${summary.selectedCount} 首（其中 ${summary.skippedExistingCount} 首已在本地，将自动跳过${summary.inQueueCount > 0 ? `，${summary.inQueueCount} 首已在队列` : ''}，实际将下载 ${summary.actualCount} 首）`
                : `已勾选 ${summary.selectedCount} 首（已关闭跳过重复${summary.inQueueCount > 0 ? `，${summary.inQueueCount} 首已在队列` : ''}，实际将下载 ${summary.actualCount} 首）`;

          return h('div', { class: 'emd-bottom-bar', role: 'region', 'aria-label': '选歌批量操作栏' }, [
            h('div', { class: 'emd-bottom-bar-info' }, [
              h(
                'span',
                {
                  class:
                    summary.selectedCount > 0 ? 'emd-bottom-bar-count' : 'emd-bottom-bar-sub',
                },
                summaryText,
              ),
            ]),

            h('div', { class: 'emd-bottom-bar-actions' }, [
              h(
                Button,
                {
                  variant: 'ghost',
                  size: 'xs',
                  disabled: summary.selectedCount === 0,
                  onClick: clearSongSelection,
                },
                { default: () => '清空选择' },
              ),
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'xs',
                  disabled: visibleBatchSongs.value.length === 0,
                  onClick: selectVisibleBatchSongs,
                },
                { default: () => `勾选当前已显示 (${visibleBatchSongs.value.length})` },
              ),
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'xs',
                  disabled: filteredBatchSongs.value.length === 0,
                  onClick: selectAllPlaylistSongs,
                },
                { default: () => `全选本歌单 (${filteredBatchSongs.value.length} 首)` },
              ),
              h(
                Button,
                {
                  variant: 'solid-primary',
                  size: 'sm',
                  disabled: !hasSaveDir || summary.actualCount === 0,
                  onClick: prepareBatchDownload,
                },
                {
                  default: () =>
                    h('span', { class: 'emd-btn-inner' }, [
                      iconSvg(h, ICONS.download, { size: 15 }),
                      h('span', null, `准备下载 (${summary.actualCount} 首)`),
                    ]),
                },
              ),
            ]),
          ]);
        }

        return null;
      };

      // ---- 防误操作：批量下载确认弹窗（ConfirmDownloadModal） ----
      const renderDownloadConfirmModal = () => {
        const data = downloadConfirmState.value;
        if (!data) return null;
        const targetPath = data.subfolder
          ? `${store.state.saveDir}/${data.subfolder}`
          : store.state.saveDir;

        return renderModalPortal(
          h(
            'div',
            {
              class: 'emd-modal-backdrop',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': '确认批量下载',
              onClick: (e) => {
                if (e.target === e.currentTarget) downloadConfirmState.value = null;
              },
            },
            [
              h('div', { class: 'emd-modal-card' }, [
                h('div', { class: 'emd-modal-header' }, [
                  h('div', { class: 'emd-modal-icon emd-modal-icon-primary' }, [
                    iconSvg(h, ICONS.download, { size: 18 }),
                  ]),
                  h('h3', { class: 'emd-modal-title' }, `确认批量下载（${data.actualCount} 首）`),
                ]),

                h('div', { class: 'emd-modal-body' }, [
                  h(
                    'div',
                    null,
                    '请确认以下下载信息，防止误点导致一次性下载大量歌曲：',
                  ),

                  h('div', { class: 'emd-modal-summary' }, [
                    h('div', { class: 'emd-modal-row' }, [
                      h('span', { class: 'emd-modal-row-label' }, '实际将加入队列'),
                      h(
                        'span',
                        { class: 'emd-modal-row-val emd-modal-row-val-accent' },
                        `${data.actualCount} 首歌曲`,
                      ),
                    ]),
                    h('div', { class: 'emd-modal-row' }, [
                      h('span', { class: 'emd-modal-row-label' }, '自动跳过已存在'),
                      h(
                        'span',
                        { class: 'emd-modal-row-val' },
                        data.skippedExistingCount > 0
                          ? `${data.skippedExistingCount} 首（本地已有）`
                          : store.state.options.skipExisting
                            ? '0 首'
                            : '未开启自动跳过',
                      ),
                    ]),
                    data.inQueueCount > 0
                      ? h('div', { class: 'emd-modal-row' }, [
                          h('span', { class: 'emd-modal-row-label' }, '已在队列中跳过'),
                          h('span', { class: 'emd-modal-row-val' }, `${data.inQueueCount} 首`),
                        ])
                      : null,
                    h('div', { class: 'emd-modal-row' }, [
                      h('span', { class: 'emd-modal-row-label' }, '目标保存位置'),
                      h('span', { class: 'emd-modal-row-val' }, targetPath || '未设置'),
                    ]),
                    h('div', { class: 'emd-modal-row' }, [
                      h('span', { class: 'emd-modal-row-label' }, '下载音质'),
                      h('span', { class: 'emd-modal-row-val' }, data.qualityLabel),
                    ]),
                    h('div', { class: 'emd-modal-row' }, [
                      h('span', { class: 'emd-modal-row-label' }, '标签与歌词'),
                      h('span', { class: 'emd-modal-row-val' }, data.tagSummary),
                    ]),
                  ]),

                  data.previewNames.length > 0
                    ? h(
                        'div',
                        { class: 'emd-modal-preview' },
                        `包含曲目：${data.previewNames.join('、')}${data.actualCount > data.previewNames.length ? ` 等共 ${data.actualCount} 首` : ''}`,
                      )
                    : null,
                ]),

                h('div', { class: 'emd-modal-footer' }, [
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      onClick: () => {
                        downloadConfirmState.value = null;
                      },
                    },
                    { default: () => '取消' },
                  ),
                  h(
                    Button,
                    {
                      variant: 'outline',
                      size: 'sm',
                      onClick: () => void executeConfirmedDownload(true),
                    },
                    { default: () => '加入队列但先暂停（稍后手动开始）' },
                  ),
                  h(
                    Button,
                    {
                      variant: 'solid-primary',
                      size: 'sm',
                      onClick: () => void executeConfirmedDownload(false),
                    },
                    { default: () => `确认开始下载 (${data.actualCount} 首)` },
                  ),
                ]),
              ]),
            ],
          ),
        );
      };

      // ---- 安全取消确认弹窗（ConfirmCancelModal） ----
      const renderCancelConfirmModal = () => {
        const data = cancelConfirmState.value;
        if (!data) return null;

        const breakdownParts = [];
        if (data.running > 0) breakdownParts.push(`下载/处理中 ${data.running} 个`);
        if (data.queued > 0) breakdownParts.push(`排队中 ${data.queued} 个`);
        if (data.paused > 0) breakdownParts.push(`已暂停 ${data.paused} 个`);

        return renderModalPortal(
          h(
            'div',
            {
              class: 'emd-modal-backdrop',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': data.title,
              onClick: (e) => {
                if (e.target === e.currentTarget) cancelConfirmState.value = null;
              },
            },
            [
              h('div', { class: 'emd-modal-card' }, [
                h('div', { class: 'emd-modal-header' }, [
                  h('div', { class: 'emd-modal-icon emd-modal-icon-danger' }, [
                    iconSvg(h, ICONS.alert, { size: 18 }),
                  ]),
                  h('h3', { class: 'emd-modal-title' }, data.title),
                ]),

                h('div', { class: 'emd-modal-body' }, [
                  h(
                    'div',
                    null,
                    `此操作将立即终止 ${data.total} 个任务（${breakdownParts.join('，') || `${data.total} 个`}）。`,
                  ),
                  data.extraNote ? h('div', null, data.extraNote) : null,
                  h(
                    'div',
                    { class: 'emd-modal-preview' },
                    '提示：已经下载完成的音频文件不会被删除；取消后的记录仍可在队列中随时点击「重新下载」。',
                  ),
                ]),

                h('div', { class: 'emd-modal-footer' }, [
                  h(
                    Button,
                    {
                      variant: 'outline',
                      size: 'sm',
                      onClick: () => {
                        cancelConfirmState.value = null;
                      },
                    },
                    { default: () => '取消' },
                  ),
                  h(
                    Button,
                    {
                      variant: 'danger',
                      size: 'sm',
                      onClick: () => void data.onConfirm(),
                    },
                    { default: () => data.confirmLabel },
                  ),
                ]),
              ]),
            ],
          ),
        );
      };

      return () => {
        const counts = taskCounts.value;
        const hasSaveDir = Boolean(store.state.saveDir);
        const playingMeta = currentTrackMeta.value;
        const hasPlayingSong = Boolean(playingMeta?.hash);

        return h('div', { class: 'emd-root h-full flex flex-col min-h-0' }, [
          h(
            PageScrollContainer,
            { class: 'h-full flex-1 min-h-0' },
            {
              default: () =>
                h('div', { class: 'select-none min-h-full flex flex-col' }, [
                  // 1. EchoMusic v2.3.x 原生 SliverHeader（仅汇总状态 + 最多两个清晰按钮）
                  h(
                    DetailPageSliverHeader,
                    {
                      ref: headerRef,
                      typeLabel: '音乐下载与任务管理中心',
                      title: '歌曲下载',
                      coverUrl: HEADER_COVER_SVG,
                      hasDetails: true,
                      distributeDetails: true,
                      expandedHeight: 168,
                      collapsedHeight: 56,
                    },
                    {
                      details: () =>
                        h(
                          'div',
                          {
                            class: 'flex flex-col justify-between text-[12px] text-text-secondary',
                            style: { minHeight: '48px' },
                          },
                          [
                            h(
                              'div',
                              { class: 'flex flex-wrap items-center gap-x-4 gap-y-1 font-medium' },
                              [
                                h(
                                  'span',
                                  null,
                                  hasSaveDir
                                    ? `目录：${store.state.saveDir}`
                                    : '目录：尚未授权保存目录',
                                ),
                                h('span', null, `进行中 ${counts.inProgress}`),
                                h('span', null, `已暂停 ${counts.paused}`),
                                h('span', null, `已完成 ${counts.done}`),
                                h('span', null, `音质：${qualityLabelOf(store.state.quality)}`),
                              ],
                            ),
                            h(
                              'div',
                              { class: 'line-clamp-1 text-[11.5px] opacity-80' },
                              '支持单曲/批量/全局暂停与取消、防误触选歌确认、ID3v2.3/FLAC 标签与封面内嵌及双语 .lrc 导出',
                            ),
                          ],
                        ),
                      actions: () =>
                        h('div', { class: 'flex items-center gap-2.5 flex-wrap' }, [
                          h(
                            Button,
                            {
                              variant: hasSaveDir ? 'outline' : 'solid-primary',
                              size: 'sm',
                              onClick: store.chooseSaveDir,
                            },
                            {
                              default: () =>
                                h('span', { class: 'emd-btn-inner' }, [
                                  iconSvg(h, ICONS.folder, { size: 15 }),
                                  h('span', null, hasSaveDir ? '更换保存目录' : '选择保存目录'),
                                ]),
                            },
                          ),
                          hasPlayingSong
                            ? h(
                                Button,
                                {
                                  variant: 'primary',
                                  size: 'sm',
                                  disabled: !hasSaveDir,
                                  tooltip: `下载当前播放：${playingMeta.artist ? `${playingMeta.artist} - ` : ''}${playingMeta.title}`,
                                  onClick: downloadCurrentTrack,
                                },
                                {
                                  default: () =>
                                    h('span', { class: 'emd-btn-inner' }, [
                                      iconSvg(h, ICONS.download, { size: 15 }),
                                      h('span', null, '下载当前播放'),
                                    ]),
                                },
                              )
                            : null,
                        ]),
                      'collapsed-actions': () =>
                        h('div', { class: 'flex items-center gap-1.5' }, [
                          h(
                            Button,
                            { variant: 'ghost', size: 'xs', onClick: store.chooseSaveDir },
                            { default: () => '目录' },
                          ),
                          hasPlayingSong
                            ? h(
                                Button,
                                {
                                  variant: 'primary',
                                  size: 'xs',
                                  disabled: !hasSaveDir,
                                  onClick: downloadCurrentTrack,
                                },
                                { default: () => '下载当前' },
                              )
                            : null,
                        ]),
                    },
                  ),

                  // 2. EchoMusic v2.3.x 原生 PageStickyHeader + CustomTabBar
                  h(
                    PageStickyHeader,
                    {
                      class: 'song-list-sticky sticky z-110 bg-bg-main',
                      stickyTop: headerHeight.value,
                    },
                    {
                      default: () =>
                        h(
                          'div',
                          {
                            class:
                              'w-full px-8 h-[50px] flex items-center justify-between gap-4 border-b border-border-light/10',
                          },
                          [
                            h(
                              CustomTabBar,
                              {
                                class:
                                  'w-auto! justify-start! bg-transparent! p-0! h-auto! gap-6! border-none!',
                                modelValue: activeTabIndex.value,
                                tabs: ['下载队列', '选歌与歌单下载', '下载与标签设置'],
                                'onUpdate:modelValue': (idx) => {
                                  activeTabIndex.value = Number(idx) || 0;
                                },
                              },
                              {
                                tab: ({ label, index, selected }) =>
                                  h('span', { class: 'inline-flex items-center gap-1.5' }, [
                                    h('span', null, label),
                                    index === 0 && counts.all > 0
                                      ? h(Badge, {
                                          count: counts.all,
                                          tone: selected ? 'accent' : 'muted',
                                        })
                                      : null,
                                    index === 1 && selectedHashes.value.size > 0
                                      ? h(Badge, {
                                          count: selectedHashes.value.size,
                                          tone: 'accent',
                                        })
                                      : index === 1 && batchSongs.value.length > 0
                                        ? h(Badge, {
                                            count: batchSongs.value.length,
                                            tone: selected ? 'accent' : 'muted',
                                          })
                                        : null,
                                  ]),
                              },
                            ),
                          ],
                        ),
                    },
                  ),

                  // 3. 页面主体内容
                  h('div', { class: 'emd-v2-body' }, [
                    activeTabIndex.value === 0
                      ? renderTasksTab()
                      : activeTabIndex.value === 1
                        ? renderBatchTab()
                        : renderSettingsCards(),
                  ]),
                ]),
            },
          ),

          // 4. 吸底操作栏（与 PageScrollContainer 垂直并列，绝不被裁切或遮挡）
          renderStickyBottomBar(),

          // 5. 防误操作确认弹窗
          renderDownloadConfirmModal(),
          renderCancelConfirmModal(),
        ]);
      };
    },
  });

  // 宿主插件设置面板
  const SettingsPanel = defineComponent({
    name: 'EchoMusicDownloadSettingsV23',
    setup() {
      return () => renderSettingsCards();
    },
  });

  // ---- 注册页面、命令、右键菜单与设置 ----
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

  ctx.ui.addSongContextMenuItem({
    id: 'download',
    label: '下载到本地（含封面与歌词标签）',
    visible: (song) => Boolean(buildSongMeta(song).hash),
    onSelect: (song) => {
      void store.enqueueSongs([song]);
    },
  });

  ctx.ui.settings.define({
    id: 'echo-music-download',
    title: '歌曲下载',
    description: '保存目录、音质、ID3v2.3/FLAC 标签与封面内嵌、双语 .lrc 导出及防误触歌单下载',
    component: SettingsPanel,
  });

  // 暴露跨插件协作桥，供 echo-music-unblock 零配置读取已下载本地曲库与 .lrc 歌词
  globalThis.__echoMusicDownload = {
    getSaveDirInfo: () => ({
      saveDir: store?.state?.saveDir || '',
      hasGrant: Boolean(store?.state?.saveDirRef?.id),
    }),
    listLocalFiles: async () => {
      if (!store?.state?.saveDirRef?.id || typeof ctx?.fs?.listFiles !== 'function') {
        return { ok: false, files: [] };
      }
      try {
        return await ctx.fs.listFiles(store.state.saveDirRef, {
          recursive: true,
          extensions: ['mp3', 'flac', 'm4a', 'wav', 'ogg', 'aac', 'opus', 'lrc'],
          limit: 5000,
        });
      } catch {
        return { ok: false, files: [] };
      }
    },
    openLocalMedia: async (fileRef) => {
      if (!ctx?.fs?.openMedia) return null;
      return ctx.fs.openMedia(fileRef);
    },
    readLocalText: async (fileRef, options) => {
      if (!ctx?.fs?.readTextFile) return null;
      return ctx.fs.readTextFile(fileRef, options);
    },
  };
}

export function deactivate() {
  if (globalThis.__echoMusicDownload) {
    delete globalThis.__echoMusicDownload;
  }
  try {
    store?.dispose();
  } catch {}
  store = null;
}
