// 歌曲下载插件（echo-music-download v2.2.0）
// 特性：
// 1. EchoMusic v2.3.x 原生视觉重构：DetailPageSliverHeader + PageStickyHeader + CustomTabBar + Badge + SongSearchInput + 主题自适应 CSS 变量
// 2. 纯 JS 音频标签与封面内嵌：支持 MP3 (ID3v2.3: TIT2/TPE1/TALB/USLT/APIC) 与 FLAC (Vorbis Comment Block 4 + Picture Block 6)
// 3. 同名双语 .lrc 歌词文件自动生成（酷狗原词 + 联动 echo-music-unblock / 网易云双语中译合并）
// 4. 用户全量歌单（我喜欢 / 自建 / 收藏）与播放队列批量下载、按歌单子目录归档（{playlist}/{filename}）及增量跳过已下载歌曲
// 5. 灰歌 / VIP 受限歌曲联动 echo-music-unblock 多源解灰下载 + 宿主全局任务面板（ctx.tasks.register）进度同步

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
  const vendorBytes = encodeUtf8('EchoMusic Download v2.2');
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

const createDownloadStore = (ctx) => {
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

  // 同步宿主全局任务中心（ctx.tasks.register）
  let hostTaskController = null;
  let hostTaskTotal = 0;

  const syncHostTaskPanel = () => {
    if (!ctx?.tasks?.register) return;
    const activeTasks = state.tasks.filter((t) =>
      ['queued', 'launching', 'downloading', 'tagging'].includes(t.state),
    );
    if (activeTasks.length === 0) {
      if (hostTaskController) {
        try {
          hostTaskController.complete({ description: '所有歌曲下载任务已完成' });
        } catch {}
        hostTaskController = null;
        hostTaskTotal = 0;
      }
      return;
    }
    hostTaskTotal = Math.max(hostTaskTotal, activeTasks.length);
    const doneInBatch = Math.max(0, hostTaskTotal - activeTasks.length);
    const currentDl = activeTasks.find((t) => t.state === 'downloading' || t.state === 'tagging') || activeTasks[0];
    const currentPct = Number(currentDl?.percent || 0) / 100;
    const overallProgress = Math.min(
      0.99,
      Math.max(0.02, (doneInBatch + currentPct) / Math.max(1, hostTaskTotal)),
    );
    const desc = currentDl
      ? `正在处理：${currentDl.name}（剩余 ${activeTasks.length} 首）`
      : `排队中 ${activeTasks.length} 首`;

    if (!hostTaskController) {
      try {
        hostTaskController = ctx.tasks.register({
          title: '歌曲批量下载',
          description: desc,
          category: 'download',
          progress: overallProgress,
          cancellable: true,
          onCancel: () => {
            for (const t of [...activeTasks]) {
              void cancelTask(t);
            }
          },
        });
      } catch {}
    } else {
      try {
        hostTaskController.update({
          title: `歌曲下载（剩余 ${activeTasks.length} 首）`,
          description: desc,
          progress: overallProgress,
        });
      } catch {}
    }
  };

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
          album: t.album || '',
          coverUrl: t.coverUrl || '',
          duration: t.duration || 0,
          subfolder: t.subfolder || '',
          fileName: t.fileName,
          saveDir: t.saveDir,
          state: t.state,
          percent: t.percent,
          speed: t.speed,
          eta: t.eta,
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

  const finalizeTaskSuccess = async (task, relativePath, finalPath) => {
    stopPolling(task);
    cleanupLog(task);
    try {
      await postProcessTaskFile(task, relativePath);
    } catch (e) {
      console.warn('[echo-music-download] 后处理异常:', e);
    }
    task.state = 'done';
    task.percent = 100;
    task.speed = '';
    task.eta = '';
    task.finalPath = finalPath || `${task.saveDir}/${relativePath}`;
    task.updatedAt = Date.now();
    if (task.hash) state.existingFilesSet.add(`hash:${String(task.hash).toLowerCase()}`);
    if (relativePath) {
      const noExt = relativePath.replace(/\.[^.]+$/, '').toLowerCase();
      state.existingFilesSet.add(`file:${noExt}`);
    }
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

  const startPolling = (task) => {
    stopPolling(task);
    const poll = async () => {
      try {
        const res = await ctx.fs.readTextFile(task.logAbs, { maxBytes: LOG_MAX_BYTES });
        if (res && res.ok && typeof res.content === 'string') {
          const size = res.size ?? 0;
          const parsed = parseLog(res.content);

          if (parsed.done) {
            await finalizeTaskSuccess(
              task,
              task.fileName,
              parsed.finalPath || `${task.saveDir}/${task.fileName}`,
            );
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
            syncHostTaskPanel();
          }
        }
        if (Date.now() - task._lastActivity > STALL_TIMEOUT_MS) {
          if (task.pid) {
            try {
              await ctx.process.terminate(task.pid);
            } catch {}
          }
          failTask(task, '下载长时间无进度，已停止（请检查网络或重试）');
          return;
        }
      } catch {}
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

    const res = await ctx.process.launch({ executable: 'bin/aria2c.exe', args });
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

  const startTask = async (task) => {
    task.state = 'launching';
    task.updatedAt = Date.now();
    persist();

    let resolved;
    try {
      resolved = await resolveDownloadUrl(task);
    } catch (error) {
      failTask(task, getApiErrorMessage(error, '获取播放地址失败'));
      return;
    }

    if (!resolved || !resolved.url) {
      failTask(task, '未获取到可下载音源（版权受限且解灰通道未命中）');
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
          if (reauth && reauth.ok !== false && !reauth.canceled && reauth.directory) {
            state.saveDirRef = reauth.directory;
            state.saveDir =
              reauth.directory.displayPath || reauth.directory.name || state.saveDir;
            await ctx.storage.set(STORAGE_SAVE_DIR_REF, reauth.directory);
            await ctx.storage.set(STORAGE_SAVE_DIR, state.saveDir);
          }
        }
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
        task._handle = handle;
        task._unsub = handle.subscribe((s) => {
          if (s.totalBytes && s.totalBytes > 0) {
            task.percent = Math.min(100, Math.round((s.receivedBytes / s.totalBytes) * 100));
          }
          task.speed = s.bytesPerSecond ? `${formatBytes(s.bytesPerSecond)}/s` : '';
          task.eta = s.remainingSeconds ? formatEta(s.remainingSeconds) : '';
          syncHostTaskPanel();

          if (s.state === 'completed') {
            const actualName =
              s.result?.file?.kind === 'directory-file' && s.result.file.relativePath
                ? s.result.file.relativePath
                : task.fileName;
            task.fileName = actualName;
            const finalPath = `${state.saveDir}/${actualName}`;
            if (typeof task._unsub === 'function') {
              try {
                task._unsub();
              } catch {}
              task._unsub = null;
            }
            void finalizeTaskSuccess(task, actualName, finalPath);
          } else if (['failed', 'canceled', 'interrupted'].includes(s.state)) {
            if (typeof task._unsub === 'function') {
              try {
                task._unsub();
              } catch {}
              task._unsub = null;
            }
            failTask(task, s.error?.message || '原生下载中断');
          } else if (s.state === 'paused') {
            task.state = 'paused';
            persist();
          } else if (s.state === 'downloading') {
            task.state = 'downloading';
          }
        });
      } catch (err) {
        console.warn('[echo-music-download] 原生下载异常，回退 aria2c:', err);
        task.engine = 'aria2c';
        const launch = await launchAria2(task, url);
        if (!launch.ok) {
          failTask(task, launch.error || '启动下载失败');
          return;
        }
        task.pid = launch.pid;
        task.state = 'downloading';
        task.updatedAt = Date.now();
        task._lastSize = 0;
        task._lastActivity = Date.now();
        persist();
        startPolling(task);
      }
      return;
    }

    // 备选降级：aria2c
    task.engine = 'aria2c';
    const launch = await launchAria2(task, url);
    if (!launch.ok) {
      if (launch.canceled) {
        failTask(task, '已取消启动 aria2c；请在弹窗中允许插件运行本地程序');
      } else {
        failTask(task, launch.error || '启动 aria2c 失败');
      }
      return;
    }

    task.pid = launch.pid;
    task.state = 'downloading';
    task.updatedAt = Date.now();
    task._lastSize = 0;
    task._lastActivity = Date.now();
    persist();
    startPolling(task);
  };

  const pump = () => {
    while (state.runningCount < state.maxConcurrent) {
      const next = state.tasks.find((t) => t.state === 'queued');
      if (!next) break;
      state.runningCount += 1;
      void startTask(next);
    }
    syncHostTaskPanel();
  };

  const enqueueSongs = async (songs, { playlistName = '' } = {}) => {
    if (!state.saveDir) {
      ctx.toast.info('请先选择歌曲保存目录');
      return;
    }
    if (state.options.skipExisting) {
      await refreshExistingFiles();
    }
    const subfolder =
      state.options.playlistSubfolder && playlistName ? sanitizePathSegment(playlistName, '歌单') : '';

    let added = 0;
    let skippedActive = 0;
    let skippedExisting = 0;

    for (const song of songs) {
      const meta = buildSongMeta(song);
      if (!meta.hash || !meta.title) continue;

      const dupActive = state.tasks.find(
        (t) =>
          t.hash === meta.hash &&
          ['queued', 'launching', 'downloading', 'tagging'].includes(t.state),
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
      state.tasks.unshift({
        id: `t${Date.now()}-${state.nextSeq}`,
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
        state: 'queued',
        percent: null,
        speed: '',
        eta: '',
        quality: state.quality,
        format: state.nameFormat,
        sourceLabel: '酷狗官方',
        tagStatus: '',
        lrcStatus: '',
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
      const extraMsg =
        skippedExisting > 0 ? `（已智能跳过 ${skippedExisting} 首已下载歌曲）` : '';
      ctx.toast.success(`已加入 ${added} 首下载任务${extraMsg}`);
      pump();
    } else if (skippedExisting > 0) {
      ctx.toast.info(`所选 ${skippedExisting} 首歌曲均已存在于本地目录，无需重复下载`);
    } else if (skippedActive > 0) {
      ctx.toast.info(`${skippedActive} 首歌曲正在下载队列中`);
    }
  };

  const retryTask = async (task) => {
    if (task._handle && typeof task._handle.retry === 'function') {
      task.state = 'downloading';
      task.error = '';
      persist();
      try {
        await task._handle.retry();
        return;
      } catch {}
    }
    if (['queued', 'launching', 'downloading', 'tagging'].includes(task.state)) return;
    task.state = 'queued';
    task.percent = null;
    task.speed = '';
    task.eta = '';
    task.tagStatus = '';
    task.lrcStatus = '';
    task.note = '';
    task.error = '';
    task.finalPath = '';
    task.updatedAt = Date.now();
    persist();
    pump();
  };

  const retryAllFailed = () => {
    const failed = state.tasks.filter((t) => t.state === 'failed');
    if (failed.length === 0) {
      ctx.toast.info('当前没有失败的任务');
      return;
    }
    for (const t of failed) {
      t.state = 'queued';
      t.percent = null;
      t.speed = '';
      t.eta = '';
      t.error = '';
      t.updatedAt = Date.now();
    }
    persist();
    pump();
    ctx.toast.success(`已重新开始 ${failed.length} 个失败任务`);
  };

  const cancelTask = async (task) => {
    if (typeof task._unsub === 'function') {
      try {
        task._unsub();
      } catch {}
      task._unsub = null;
    }
    if (task._handle && typeof task._handle.cancel === 'function') {
      try {
        await task._handle.cancel();
      } catch {}
    }
    if (task.state === 'downloading' || task.state === 'launching' || task.state === 'tagging') {
      if (task.pid) {
        try {
          await ctx.process.terminate(task.pid);
        } catch {}
      }
      failTask(task, '已取消');
    } else if (task.state === 'queued') {
      task.state = 'failed';
      task.error = '已取消';
      task.updatedAt = Date.now();
      persist();
    }
  };

  const removeTask = (task) => {
    if (['downloading', 'launching', 'tagging'].includes(task.state)) {
      void cancelTask(task);
    }
    const idx = state.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) state.tasks.splice(idx, 1);
    persist();
  };

  const clearFinished = () => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => t.state !== 'done' && t.state !== 'failed');
    if (state.tasks.length !== before) {
      persist();
      ctx.toast.success(`已清理 ${before - state.tasks.length} 条已完成/失败记录`);
    }
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
          .map((t) => ({
            ...t,
            album: t.album || '',
            coverUrl: t.coverUrl || '',
            subfolder: t.subfolder || '',
            fileName: t.fileName || '',
            speed: '',
            eta: '',
            quality: QUALITY_OPTIONS.some((o) => o.value === t.quality) ? t.quality : '320',
            format: NAME_FORMAT_OPTIONS.some((o) => o.value === t.format)
              ? t.format
              : 'artist-title',
            sourceLabel: t.sourceLabel || '酷狗官方',
            tagStatus: t.tagStatus || '',
            lrcStatus: t.lrcStatus || '',
            note: t.note || '',
            ...(['downloading', 'launching', 'tagging'].includes(t.state)
              ? { state: 'failed', error: '应用已重启，下载中断，请点击重试', percent: null }
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

    await refreshExistingFiles();
  };

  const dispose = () => {
    if (hostTaskController) {
      try {
        hostTaskController.complete({ description: '插件已卸载' });
      } catch {}
      hostTaskController = null;
    }
    for (const t of state.tasks) {
      stopPolling(t);
      if (typeof t._unsub === 'function') {
        try {
          t._unsub();
        } catch {}
        t._unsub = null;
      }
      if (['downloading', 'launching', 'tagging'].includes(t.state) && t.pid) {
        try {
          void ctx.process.terminate(t.pid);
        } catch {}
      }
    }
  };

  return {
    state,
    restore,
    saveOptions,
    refreshExistingFiles,
    isSongAlreadyDownloaded,
    enqueueSongs,
    retryTask,
    retryAllFailed,
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

// ============================================================================
// EchoMusic v2.3.x 原生主题自适应样式 (无硬编码深色背景，全面适配浅色/深色主题)
// ============================================================================

const CSS = `
.emd-v2-body {
  padding: 16px 32px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 顶部快捷条：当前播放与目录状态 */
.emd-quick-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  flex-wrap: wrap;
}
.emd-quick-track {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.emd-quick-cover {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  object-fit: cover;
  background: var(--bg-card, rgba(128, 128, 128, 0.1));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary, #10b981);
}
.emd-quick-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.emd-quick-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-main, inherit);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.emd-quick-sub {
  font-size: 11.5px;
  color: var(--color-text-secondary, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 过滤胶囊栏 */
.emd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.emd-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.emd-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.15));
  background: var(--bg-info-card, rgba(128, 128, 128, 0.05));
  color: var(--color-text-secondary, #888);
  cursor: pointer;
  transition: all 0.15s ease;
}
.emd-pill:hover {
  color: var(--color-text-main, inherit);
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 40%, transparent);
}
.emd-pill-active {
  background: color-mix(in srgb, var(--color-primary, #10b981) 14%, transparent);
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 45%, transparent);
  color: var(--color-primary, #10b981);
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
  gap: 14px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  transition: border-color 0.16s ease, transform 0.16s ease;
}
.emd-task-card:hover {
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 35%, var(--border-subtle, rgba(128, 128, 128, 0.2)));
}
.emd-task-cover {
  width: 46px;
  height: 46px;
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
  gap: 6px;
}
.emd-task-row1 {
  display: flex;
  align-items: center;
  gap: 8px;
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
  max-width: 420px;
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
  border-color: color-mix(in srgb, var(--color-primary, #10b981) 25%, transparent);
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
.emd-badge-state-downloading, .emd-badge-state-launching, .emd-badge-state-tagging {
  background: rgba(245, 158, 11, 0.14);
  color: #f59e0b;
}
.emd-badge-state-failed {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}
.emd-badge-state-queued, .emd-badge-state-paused {
  background: rgba(128, 128, 128, 0.12);
  color: var(--color-text-secondary, #888);
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
  transition: width 0.25s ease;
}
.emd-task-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.emd-action-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.16));
  background: transparent;
  color: var(--color-text-secondary, #888);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.emd-action-icon:hover {
  color: var(--color-primary, #10b981);
  border-color: var(--color-primary, #10b981);
  background: color-mix(in srgb, var(--color-primary, #10b981) 10%, transparent);
}
.emd-action-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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
  min-width: 190px;
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

/* 批量歌曲表格 */
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
  transition: background 0.12s ease;
}
.emd-song-item:last-child {
  border-bottom: none;
}
.emd-song-item:hover {
  background: color-mix(in srgb, var(--color-primary, #10b981) 6%, transparent);
}
.emd-song-item input[type="checkbox"] {
  accent-color: var(--color-primary, #10b981);
  width: 15px;
  height: 15px;
  cursor: pointer;
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

/* 设置卡片 */
.emd-settings-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.emd-setting-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.12));
  flex-wrap: wrap;
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
  padding: 48px 20px;
  text-align: center;
  border-radius: 14px;
  background: var(--bg-info-card, rgba(128, 128, 128, 0.04));
  border: 1px dashed var(--border-subtle, rgba(128, 128, 128, 0.18));
  color: var(--color-text-secondary, #888);
  font-size: 12.5px;
}
`;

// ============================================================================
// 插件激活入口
// ============================================================================

let store = null;

export function activate(ctx) {
  const { h, defineComponent, defineAsyncComponent, computed, ref, watch, onMounted } = ctx.vue;

  ctx.css.inject(CSS, { id: 'echo-music-download-v22' });

  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Badge = defineAsyncComponent(ctx.ui.components.Badge);
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);
  const Select = defineAsyncComponent(ctx.ui.components.Select);
  const CustomTabBar = defineAsyncComponent(ctx.ui.components.CustomTabBar);
  const DetailPageSliverHeader = defineAsyncComponent(ctx.ui.components.DetailPageSliverHeader);
  const PageStickyHeader = defineAsyncComponent(ctx.ui.components.PageStickyHeader);
  const SongSearchInput = defineAsyncComponent(ctx.ui.components.SongSearchInput);

  store = createDownloadStore(ctx);
  void store.restore();

  // ---- 设置面板组件（同时用于 Tab 2 与宿主插件设置页） ----
  const renderSettingsCards = () => {
    const hasSaveDir = Boolean(store.state.saveDir);
    const opts = store.state.options;

    return h('div', { class: 'emd-settings-grid' }, [
      // 1. 保存目录
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
          { variant: 'outline', size: 'sm', onClick: store.chooseSaveDir },
          { default: () => (hasSaveDir ? '更换目录' : '选择目录') },
        ),
      ]),

      // 2. 默认音质
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
          { class: 'emd-pills' },
          QUALITY_OPTIONS.map((o) =>
            h(
              'button',
              {
                class: ['emd-pill', store.state.quality === o.value ? 'emd-pill-active' : ''],
                onClick: () => store.setQuality(o.value),
              },
              o.label,
            ),
          ),
        ),
      ]),

      // 3. 文件名格式
      h('div', { class: 'emd-setting-card' }, [
        h('div', { class: 'emd-setting-text' }, [
          h('div', { class: 'emd-setting-title' }, '文件名命名规则'),
          h('div', { class: 'emd-setting-desc' }, '对新加入下载队列的歌曲生效，同名 .lrc 自动保持一致'),
        ]),
        h(
          'div',
          { class: 'emd-pills' },
          NAME_FORMAT_OPTIONS.map((o) =>
            h(
              'button',
              {
                class: ['emd-pill', store.state.nameFormat === o.value ? 'emd-pill-active' : ''],
                onClick: () => store.setNameFormat(o.value),
              },
              o.label,
            ),
          ),
        ),
      ]),

      // 4. 内嵌 ID3v2.3 / FLAC 标签与封面
      h('div', { class: 'emd-setting-card' }, [
        h('div', { class: 'emd-setting-text' }, [
          h('div', { class: 'emd-setting-title' }, '自动内嵌歌曲元数据与高清封面（ID3v2.3 / FLAC）'),
          h(
            'div',
            { class: 'emd-setting-desc' },
            '下载完成后使用纯 JS 引擎将歌名、歌手、专辑、歌词与 480px 封面直接写入 MP3 (ID3v2.3) 或 FLAC (Vorbis + Picture) 文件头，无缝兼容本地音乐插件',
          ),
        ]),
        h(Switch, {
          modelValue: opts.embedTags,
          'onUpdate:modelValue': (v) => store.saveOptions({ embedTags: Boolean(v) }),
        }),
      ]),

      // 5. 导出同名 .lrc 歌词文件
      h('div', { class: 'emd-setting-card' }, [
        h('div', { class: 'emd-setting-text' }, [
          h('div', { class: 'emd-setting-title' }, '同步导出同名 .lrc 歌词文件'),
          h(
            'div',
            { class: 'emd-setting-desc' },
            '在音频同级目录生成同名 .lrc 歌词文件，优先合并原文与中文翻译双语时间轴',
          ),
        ]),
        h('div', { class: 'emd-pills' }, [
          h(
            'button',
            {
              class: ['emd-pill', opts.preferBilingualLrc ? 'emd-pill-active' : ''],
              onClick: () =>
                store.saveOptions({ preferBilingualLrc: !opts.preferBilingualLrc }),
            },
            opts.preferBilingualLrc ? '双语翻译合并：已开启' : '仅原词',
          ),
          h(Switch, {
            modelValue: opts.writeLrc,
            'onUpdate:modelValue': (v) => store.saveOptions({ writeLrc: Boolean(v) }),
          }),
        ]),
      ]),

      // 6. 灰歌解灰联动下载
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

      // 7. 歌单子目录与增量同步
      h('div', { class: 'emd-setting-card' }, [
        h('div', { class: 'emd-setting-text' }, [
          h('div', { class: 'emd-setting-title' }, '歌单批量下载：按歌单名创建子目录'),
          h(
            'div',
            { class: 'emd-setting-desc' },
            '开启后批量下载歌单时将自动归档至「保存目录/歌单名称/歌手 - 歌名.mp3」',
          ),
        ]),
        h(Switch, {
          modelValue: opts.playlistSubfolder,
          'onUpdate:modelValue': (v) => store.saveOptions({ playlistSubfolder: Boolean(v) }),
        }),
      ]),

      h('div', { class: 'emd-setting-card' }, [
        h('div', { class: 'emd-setting-text' }, [
          h('div', { class: 'emd-setting-title' }, '增量同步：自动跳过已下载歌曲'),
          h(
            'div',
            { class: 'emd-setting-desc' },
            '入队前自动对比已完成记录及保存目录磁盘文件，避免整张歌单同步时重复下载',
          ),
        ]),
        h(Switch, {
          modelValue: opts.skipExisting,
          'onUpdate:modelValue': (v) => store.saveOptions({ skipExisting: Boolean(v) }),
        }),
      ]),

      // 8. 并发数
      h('div', { class: 'emd-setting-card' }, [
        h('div', { class: 'emd-setting-text' }, [
          h('div', { class: 'emd-setting-title' }, '最大同时下载任务数'),
          h('div', { class: 'emd-setting-desc' }, '建议设置为 2 ~ 3，兼顾下载速率与标签写入稳定性'),
        ]),
        h(
          'div',
          { class: 'emd-pills' },
          [1, 2, 3, 4].map((n) =>
            h(
              'button',
              {
                class: ['emd-pill', store.state.maxConcurrent === n ? 'emd-pill-active' : ''],
                onClick: () => store.setMaxConcurrent(n),
              },
              `${n} 线程`,
            ),
          ),
        ),
      ]),
    ]);
  };

  // ---- 主页面组件（EchoMusic v2.3.x 原生 SliverHeader + StickyHeader + CustomTabBar 架构） ----
  const DownloadPage = defineComponent({
    name: 'EchoMusicDownloadPageV22',
    setup() {
      const headerRef = ref(null);
      const headerHeight = computed(() => headerRef.value?.currentHeight ?? 176);
      const activeTabIndex = ref(0);

      // 任务列表过滤状态
      const taskFilter = ref('all'); // 'all' | 'active' | 'done' | 'failed'
      const taskSearch = ref('');

      // 歌单/队列批量下载状态
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

      const currentTrack = computed(() => ctx.player?.currentTrack?.value ?? null);
      const playbackQueues = computed(() =>
        (ctx.playlist?.queues?.value ?? []).filter((q) => q && q.type !== 'search'),
      );

      // 任务统计
      const taskCounts = computed(() => {
        const all = store.state.tasks.length;
        let active = 0;
        let done = 0;
        let failed = 0;
        for (const t of store.state.tasks) {
          if (['queued', 'launching', 'downloading', 'tagging', 'paused'].includes(t.state)) {
            active += 1;
          } else if (t.state === 'done') {
            done += 1;
          } else if (t.state === 'failed') {
            failed += 1;
          }
        }
        return { all, active, done, failed };
      });

      const filteredTasks = computed(() => {
        const q = taskSearch.value.trim().toLowerCase();
        return store.state.tasks.filter((t) => {
          if (
            taskFilter.value === 'active' &&
            !['queued', 'launching', 'downloading', 'tagging', 'paused'].includes(t.state)
          ) {
            return false;
          }
          if (taskFilter.value === 'done' && t.state !== 'done') return false;
          if (taskFilter.value === 'failed' && t.state !== 'failed') return false;
          if (q && !`${t.name} ${t.album || ''} ${t.subfolder || ''}`.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        });
      });

      // 加载用户酷狗歌单（我喜欢 / 自建 / 收藏）
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

      // 分页拉取歌单全量歌曲（突破旧版 100 首上限）
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
        }
      });

      onMounted(() => {
        void store.refreshExistingFiles();
        void loadUserPlaylists();
      });

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

      const toggleSongCheck = (hash) => {
        const next = new Set(selectedHashes.value);
        if (next.has(hash)) next.delete(hash);
        else next.add(hash);
        selectedHashes.value = next;
      };

      const selectAllFiltered = () => {
        selectedHashes.value = new Set(
          filteredBatchSongs.value.map((s) => buildSongMeta(s).hash).filter(Boolean),
        );
      };

      const clearSelection = () => {
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

      const downloadSelectedBatch = () => {
        const picked = batchSongs.value.filter((s) =>
          selectedHashes.value.has(buildSongMeta(s).hash),
        );
        if (picked.length === 0) {
          ctx.toast.info('请先勾选要下载的歌曲');
          return;
        }
        void store.enqueueSongs(picked, { playlistName: selectedPlaylistTitle.value });
      };

      const downloadAllInPlaylist = () => {
        if (filteredBatchSongs.value.length === 0) {
          ctx.toast.info('当前列表没有可下载的歌曲');
          return;
        }
        void store.enqueueSongs(filteredBatchSongs.value, {
          playlistName: selectedPlaylistTitle.value,
        });
      };

      // 渲染单个任务卡片
      const renderTaskCard = (task) => {
        const label = TASK_STATE_LABEL[task.state] || task.state;
        const isActive = ['downloading', 'launching', 'tagging'].includes(task.state);
        const isFinished = task.state === 'done' || task.state === 'failed';
        const pct =
          task.percent != null && !Number.isNaN(Number(task.percent))
            ? Number(task.percent)
            : task.state === 'done'
              ? 100
              : 0;

        return h('div', { class: 'emd-task-card', key: task.id }, [
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

            isActive || task.state === 'done'
              ? h('div', { class: 'emd-progress-track' }, [
                  h('div', { class: 'emd-progress-bar', style: { width: `${pct}%` } }),
                ])
              : null,

            h('div', { class: 'emd-task-sub' }, [
              isActive
                ? h(
                    'span',
                    { style: { color: 'var(--color-primary, #10b981)', fontWeight: 700 } },
                    task.state === 'tagging'
                      ? '正在写入 ID3v2/FLAC 元数据与歌词…'
                      : `${pct.toFixed(0)}% ${task.speed ? `· ${task.speed}` : ''} ${task.eta ? `· 剩余 ${task.eta}` : ''}`,
                  )
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

          h('div', { class: 'emd-task-actions' }, [
            isActive
              ? h(
                  'button',
                  {
                    class: 'emd-action-icon',
                    title: '取消下载',
                    onClick: () => store.cancelTask(task),
                  },
                  [iconSvg(h, ICONS.close, { size: 15 })],
                )
              : null,
            isFinished
              ? h(
                  'button',
                  {
                    class: 'emd-action-icon',
                    title: '重新下载',
                    onClick: () => store.retryTask(task),
                  },
                  [iconSvg(h, ICONS.refresh, { size: 15 })],
                )
              : null,
            isFinished || task.state === 'queued'
              ? h(
                  'button',
                  {
                    class: 'emd-action-icon',
                    title: '移除记录',
                    onClick: () => store.removeTask(task),
                  },
                  [iconSvg(h, ICONS.trash, { size: 15 })],
                )
              : null,
          ]),
        ]);
      };

      // Tab 0: 下载任务中心
      const renderTasksTab = () => {
        const track = currentTrack.value;
        const trackMeta = track ? buildSongMeta(track) : null;
        const hasSaveDir = Boolean(store.state.saveDir);
        const counts = taskCounts.value;

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
          // 当前播放快捷下载横幅
          h('div', { class: 'emd-quick-banner' }, [
            h('div', { class: 'emd-quick-track' }, [
              trackMeta?.coverUrl
                ? h('img', { class: 'emd-quick-cover', src: trackMeta.coverUrl, alt: '' })
                : h('div', { class: 'emd-quick-cover' }, [iconSvg(h, ICONS.music, { size: 20 })]),
              h('div', { class: 'emd-quick-meta' }, [
                h(
                  'div',
                  { class: 'emd-quick-title' },
                  trackMeta?.title
                    ? `正在播放：${trackMeta.artist ? `${trackMeta.artist} - ` : ''}${trackMeta.title}`
                    : '当前未播放歌曲',
                ),
                h(
                  'div',
                  { class: 'emd-quick-sub' },
                  hasSaveDir
                    ? `保存目录：${store.state.saveDir} · 音质：${store.state.quality.toUpperCase()} · ${store.state.options.embedTags ? '自动内嵌封面与歌词标签' : '仅下载音频'}`
                    : '提示：请先点击右上角「选择保存目录」授权本地文件夹',
                ),
              ]),
            ]),
            h('div', { class: 'emd-pills' }, [
              ...QUALITY_OPTIONS.map((o) =>
                h(
                  'button',
                  {
                    class: ['emd-pill', store.state.quality === o.value ? 'emd-pill-active' : ''],
                    onClick: () => store.setQuality(o.value),
                  },
                  o.label,
                ),
              ),
              h(
                Button,
                {
                  variant: 'primary',
                  size: 'sm',
                  disabled: !hasSaveDir || !trackMeta?.hash,
                  onClick: downloadCurrentTrack,
                },
                { default: () => '下载当前歌曲' },
              ),
            ]),
          ]),

          // 过滤胶囊 + 搜索框
          h('div', { class: 'emd-toolbar' }, [
            h('div', { class: 'emd-pills' }, [
              [
                { id: 'all', label: `全部 (${counts.all})` },
                { id: 'active', label: `进行中 (${counts.active})` },
                { id: 'done', label: `已完成 (${counts.done})` },
                { id: 'failed', label: `失败 (${counts.failed})` },
              ].map((f) =>
                h(
                  'button',
                  {
                    class: ['emd-pill', taskFilter.value === f.id ? 'emd-pill-active' : ''],
                    key: f.id,
                    onClick: () => {
                      taskFilter.value = f.id;
                    },
                  },
                  f.label,
                ),
              ),
            ]),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
              counts.failed > 0
                ? h(
                    Button,
                    { variant: 'outline', size: 'xs', onClick: store.retryAllFailed },
                    { default: () => '重试全部失败' },
                  )
                : null,
              counts.done + counts.failed > 0
                ? h(
                    Button,
                    { variant: 'ghost', size: 'xs', onClick: store.clearFinished },
                    { default: () => '清理已完成/失败' },
                  )
                : null,
              h(SongSearchInput, {
                modelValue: taskSearch.value,
                placeholder: '搜索下载任务…',
                'onUpdate:modelValue': (v) => {
                  taskSearch.value = String(v ?? '');
                },
              }),
            ]),
          ]),

          // 任务卡片列表
          filteredTasks.value.length === 0
            ? h(
                'div',
                { class: 'emd-empty-box' },
                store.state.tasks.length === 0
                  ? '暂无下载任务。可在上方一键下载当前播放歌曲，或切换到「歌单与队列批量下载」同步整张歌单。'
                  : '没有符合筛选条件的下载任务',
              )
            : h(
                'div',
                { class: 'emd-task-grid' },
                filteredTasks.value.map((t) => renderTaskCard(t)),
              ),
        ]);
      };

      // Tab 1: 歌单与队列批量下载
      const renderBatchTab = () => {
        const hasSaveDir = Boolean(store.state.saveDir);
        const subfolder =
          store.state.options.playlistSubfolder && selectedPlaylistTitle.value
            ? selectedPlaylistTitle.value
            : '';

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
          // 来源模式切换 + 增量与子目录快捷开关
          h('div', { class: 'emd-toolbar' }, [
            h('div', { class: 'emd-pills' }, [
              h(
                'button',
                {
                  class: [
                    'emd-pill',
                    batchSourceMode.value === 'user-playlists' ? 'emd-pill-active' : '',
                  ],
                  onClick: () => {
                    batchSourceMode.value = 'user-playlists';
                  },
                },
                `我的酷狗歌单 (${userPlaylists.value.length})`,
              ),
              h(
                'button',
                {
                  class: [
                    'emd-pill',
                    batchSourceMode.value === 'playback-queues' ? 'emd-pill-active' : '',
                  ],
                  onClick: () => {
                    batchSourceMode.value = 'playback-queues';
                  },
                },
                `播放队列 (${playbackQueues.value.length})`,
              ),
              batchSourceMode.value === 'user-playlists'
                ? h(
                    'button',
                    {
                      class: 'emd-pill',
                      onClick: loadUserPlaylists,
                    },
                    loadingPlaylists.value ? '刷新中…' : '↻ 刷新歌单',
                  )
                : null,
            ]),

            h('div', { class: 'emd-pills' }, [
              h(
                'button',
                {
                  class: [
                    'emd-pill',
                    store.state.options.playlistSubfolder ? 'emd-pill-active' : '',
                  ],
                  onClick: () =>
                    store.saveOptions({
                      playlistSubfolder: !store.state.options.playlistSubfolder,
                    }),
                },
                store.state.options.playlistSubfolder
                  ? '📁 按歌单建子文件夹：开启'
                  : '📁 按歌单建子文件夹：关闭',
              ),
              h(
                'button',
                {
                  class: ['emd-pill', store.state.options.skipExisting ? 'emd-pill-active' : ''],
                  onClick: () =>
                    store.saveOptions({ skipExisting: !store.state.options.skipExisting }),
                },
                store.state.options.skipExisting
                  ? '⚡ 增量跳过已下载：开启'
                  : '⚡ 增量跳过已下载：关闭',
              ),
            ]),
          ]),

          // 歌单卡片横向流
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

          // 批量操作栏 + 搜索
          h('div', { class: 'emd-toolbar' }, [
            h('div', { class: 'emd-pills' }, [
              h(
                'button',
                { class: 'emd-pill', onClick: selectAllFiltered },
                `全选全部 (${filteredBatchSongs.value.length})`,
              ),
              selectedHashes.value.size > 0
                ? h(
                    'button',
                    { class: 'emd-pill', onClick: clearSelection },
                    `取消已选 (${selectedHashes.value.size})`,
                  )
                : null,
              h(
                Button,
                {
                  variant: 'primary',
                  size: 'xs',
                  disabled: !hasSaveDir || selectedHashes.value.size === 0,
                  onClick: downloadSelectedBatch,
                },
                { default: () => `下载已选 (${selectedHashes.value.size})` },
              ),
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'xs',
                  disabled: !hasSaveDir || filteredBatchSongs.value.length === 0,
                  onClick: downloadAllInPlaylist,
                },
                { default: () => `一键同步整张歌单 (${filteredBatchSongs.value.length})` },
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

          // 歌曲列表
          loadingSongs.value
            ? h('div', { class: 'emd-empty-box' }, '正在加载歌单全量曲目，请稍候…')
            : filteredBatchSongs.value.length === 0
              ? h('div', { class: 'emd-empty-box' }, '该歌单暂无匹配曲目')
              : h('div', { class: 'emd-song-table' }, [
                  ...visibleBatchSongs.value.map((song, idx) => {
                    const meta = buildSongMeta(song);
                    const checked = selectedHashes.value.has(meta.hash);
                    const alreadyDone = store.isSongAlreadyDownloaded(song, subfolder);
                    return h('div', { class: 'emd-song-item', key: `${meta.hash}-${idx}` }, [
                      h('input', {
                        type: 'checkbox',
                        checked,
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
                          alreadyDone
                            ? h('span', { class: 'emd-badge emd-badge-state-done' }, '✓ 已在本地')
                            : null,
                        ],
                      ),
                      h(
                        'button',
                        {
                          class: 'emd-action-icon',
                          title: '立即下载此歌曲',
                          disabled: !hasSaveDir,
                          onClick: () =>
                            store.enqueueSongs([song], {
                              playlistName: selectedPlaylistTitle.value,
                            }),
                        },
                        [iconSvg(h, ICONS.download, { size: 15 })],
                      ),
                    ]);
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
                                `加载更多（已显示 ${visibleBatchSongs.value.length} / 共 ${filteredBatchSongs.value.length} 首，点击「全选全部」可直接包含未展开歌曲）`,
                            },
                          ),
                        ],
                      )
                    : null,
                ]),
        ]);
      };

      return () => {
        const counts = taskCounts.value;
        const hasSaveDir = Boolean(store.state.saveDir);

        return h('div', { class: 'select-none min-h-full flex flex-col' }, [
          // 1. EchoMusic v2.3.x 原生 SliverHeader
          h(
            DetailPageSliverHeader,
            {
              ref: headerRef,
              typeLabel: '音乐下载与标签内嵌中心',
              title: '歌曲下载',
              coverUrl: HEADER_COVER_SVG,
              hasDetails: true,
              distributeDetails: true,
              expandedHeight: 176,
              collapsedHeight: 56,
            },
            {
              details: () =>
                h(
                  'div',
                  {
                    class: 'flex flex-col justify-between text-[12px] text-text-secondary',
                    style: { minHeight: '52px' },
                  },
                  [
                    h('div', { class: 'flex flex-wrap items-center gap-x-4 gap-y-1 font-medium' }, [
                      h(
                        'span',
                        null,
                        hasSaveDir ? `目录：${store.state.saveDir}` : '尚未授权保存目录',
                      ),
                      h('span', null, `进行中 ${counts.active}`),
                      h('span', null, `已完成 ${counts.done}`),
                      h(
                        'span',
                        null,
                        `音质：${store.state.quality === 'flac' ? '无损 FLAC 优先' : `${store.state.quality}kbps`}`,
                      ),
                    ]),
                    h(
                      'div',
                      { class: 'line-clamp-1 text-[11.5px] opacity-80' },
                      '支持 MP3(ID3v2.3) / FLAC(Vorbis+Picture) 封面与歌词内嵌、双语 .lrc 导出、用户歌单增量同步与灰歌解灰下载',
                    ),
                  ],
                ),
              actions: () =>
                h('div', { class: 'flex items-center gap-2.5 flex-wrap' }, [
                  h(
                    Button,
                    {
                      variant: 'primary',
                      size: 'sm',
                      disabled: !hasSaveDir || !currentTrack.value?.hash,
                      onClick: downloadCurrentTrack,
                    },
                    {
                      default: () => [
                        iconSvg(h, ICONS.download, { size: 15 }),
                        h('span', null, '下载当前播放'),
                      ],
                    },
                  ),
                  h(
                    Button,
                    { variant: 'outline', size: 'sm', onClick: store.chooseSaveDir },
                    {
                      default: () => [
                        iconSvg(h, ICONS.folder, { size: 15 }),
                        h('span', null, hasSaveDir ? '更换保存目录' : '选择保存目录'),
                      ],
                    },
                  ),
                ]),
              'collapsed-actions': () =>
                h('div', { class: 'flex items-center gap-1.5' }, [
                  h(
                    Button,
                    {
                      variant: 'primary',
                      size: 'xs',
                      disabled: !hasSaveDir || !currentTrack.value?.hash,
                      onClick: downloadCurrentTrack,
                    },
                    { default: () => '下载当前' },
                  ),
                  h(
                    Button,
                    { variant: 'ghost', size: 'xs', onClick: store.chooseSaveDir },
                    { default: () => '目录' },
                  ),
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
                        tabs: ['下载任务', '歌单与队列批量下载', '下载与标签内嵌设置'],
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
                                  tone: selected ? 'primary' : 'muted',
                                })
                              : null,
                            index === 1 && batchSongs.value.length > 0
                              ? h(Badge, {
                                  count: batchSongs.value.length,
                                  tone: selected ? 'primary' : 'muted',
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
        ]);
      };
    },
  });

  // 宿主插件设置面板
  const SettingsPanel = defineComponent({
    name: 'EchoMusicDownloadSettingsV22',
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
    description: '保存目录、音质、ID3v2.3/FLAC 标签与封面内嵌、双语 .lrc 导出及歌单增量同步',
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
