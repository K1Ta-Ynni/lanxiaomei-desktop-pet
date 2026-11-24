import { readFile, realpath, stat, mkdir, readdir } from 'node:fs/promises';
import { join, relative, isAbsolute, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { audioDigest } from './audio-normalizer.js';
import { DEFAULT_PLAYLIST, validatePlaylist } from './playlist.js';
import { isSong, MAX_SONG_BYTES, MAX_VOICE_BYTES } from './music.js';
import { DESKTOP_APPEARANCE_LABELS } from './appearance.js';
const loudnessHashes = new Map();

export const FEATURES = Object.freeze({ ai: true });
export const ACTIONS = Object.freeze([
  { id: 'greet', label: '打个招呼' },
  { id: 'jump', label: '蹦一下' },
  { id: 'sway', label: '摇一摇' },
  { id: 'sleep', label: '休息一下' },
  { id: 'wake', label: '叫醒她' },
]);
export const INTERACTIONS = Object.freeze([
  { id: 'nextVoice', label: '播放语音列表下一条' },
  { id: 'nextSticker', label: '展示表情列表下一张' },
  { id: 'setPlaylist', label: '设置互动播放列表' },
  { id: 'music', label: '歌曲播放器（播放、暂停、继续、切歌、进度）' },
  { id: 'greet', label: '显示问候' },
  { id: 'jump', label: '蹦一下' },
  { id: 'sway', label: '摇一摇' },
  { id: 'sleep', label: '休息一下' },
  { id: 'wake', label: '叫醒她' },
  { id: 'playVoice', label: '播放本地语音', requiresId: true },
  { id: 'showSticker', label: '显示表情包', requiresId: true },
  { id: 'randomSticker', label: '随机发一个表情包' },
  { id: 'showExpression', label: '显示角色表情', requiresId: true },
  { id: 'stopVoice', label: '停止语音' },
  { id: 'hideSticker', label: '收起表情包' },
  { id: 'setPreferences', label: '调整大小、音量和互动开关', requiresPreferences: true },
  { id: 'resetPosition', label: '回到主屏幕' },
  { id: 'moveTo', label: '移动桌宠到屏幕位置', requiresPosition: true },
]);
export const DEFAULT_PREFERENCES = Object.freeze({ scale: 1, volume: 0.65, muted: false, normalizeAudio: true, clickVoice: true, clickSticker: true, idleActions: true, lowResourceMode: false, animateIdle: true, autoBlink: true, talkAnimation: true, preloadExpressions: true, portraitMode: 'auto', expressionPlaylist: DEFAULT_PLAYLIST, voicePlaylist: DEFAULT_PLAYLIST, stickerPlaylist: DEFAULT_PLAYLIST, musicPlaylist: { mode: 'sequence', ids: null }, appearance: 'portrait', mouthMicrophone: false, mouthSensitivity: 50 });

export function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('互动设置格式不正确。');
  if (!Number.isFinite(value.scale) || value.scale < 0.6 || value.scale > 1.6) throw new Error('大小需要在 60% 到 160% 之间。');
  if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) throw new Error('音量需要在 0 到 100% 之间。');
  for (const key of ['muted', 'clickVoice', 'idleActions']) {
    if (typeof value[key] !== 'boolean') throw new Error('互动开关格式不正确。');
  }
  const clickSticker = value.clickSticker ?? DEFAULT_PREFERENCES.clickSticker;
  const normalizeAudio = value.normalizeAudio ?? DEFAULT_PREFERENCES.normalizeAudio;
  if (typeof normalizeAudio !== 'boolean') throw new Error('音量均衡设置不正确。');
  const portraitMode = value.portraitMode ?? DEFAULT_PREFERENCES.portraitMode;
  const appearance = value.appearance ?? DEFAULT_PREFERENCES.appearance;
  const mouthMicrophone = value.mouthMicrophone ?? DEFAULT_PREFERENCES.mouthMicrophone;
  const mouthSensitivity = value.mouthSensitivity ?? DEFAULT_PREFERENCES.mouthSensitivity;
  if (typeof appearance !== 'string' || !Object.hasOwn(DESKTOP_APPEARANCE_LABELS, appearance) ||
      typeof mouthMicrophone !== 'boolean' || !Number.isInteger(mouthSensitivity) ||
      mouthSensitivity < 1 || mouthSensitivity > 100) throw new Error('桌宠外观或麦克风设置不正确。');
  const performance = {};
  for (const key of ['lowResourceMode', 'animateIdle', 'autoBlink', 'talkAnimation', 'preloadExpressions']) {
    performance[key] = value[key] ?? DEFAULT_PREFERENCES[key];
    if (typeof performance[key] !== 'boolean') throw new Error('性能设置格式不正确。');
  }
  if (typeof clickSticker !== 'boolean' || typeof portraitMode !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/u.test(portraitMode)) throw new Error('表情互动设置不正确。');
  return { scale: value.scale, volume: value.volume, muted: value.muted, normalizeAudio, clickVoice: value.clickVoice, clickSticker, idleActions: value.idleActions, ...performance, portraitMode, appearance, mouthMicrophone, mouthSensitivity,
    expressionPlaylist: validatePlaylist(value.expressionPlaylist ?? (portraitMode === 'auto' ? DEFAULT_PLAYLIST : { mode: 'repeat', ids: [portraitMode] })),
    voicePlaylist: validatePlaylist(value.voicePlaylist), stickerPlaylist: validatePlaylist(value.stickerPlaylist),
    musicPlaylist: validatePlaylist(value.musicPlaylist ?? DEFAULT_PREFERENCES.musicPlaylist) };
}

// A manifest ID selects a known local clip; pages cannot supply arbitrary paths.
export async function loadVoices(directory, { loudnessDirectory = directory, loudnessPath } = {}) {
  let loudness = { clips: [] };
  try { loudness = JSON.parse(await readFile(join(loudnessDirectory, 'loudness.json'), 'utf8')); }
  catch { /* Custom packs without measurements retain their original volume. */ }
  let personal = { clips: [] };
  if (loudnessPath) try { personal = JSON.parse(await readFile(loudnessPath, 'utf8')); } catch { /* No local analysis yet. */ }
  let migrated = { clips: [] };
  if (directory !== loudnessDirectory) {
    try { migrated = JSON.parse(await readFile(join(directory, 'loudness.json'), 'utf8')); }
    catch { /* New installs have no legacy measurements. */ }
  }
  const levels = new Map();
  for (const row of [personal.clips, loudness.clips, migrated.clips].flatMap(clips => Array.isArray(clips) ? clips : [])) {
    if (!levels.has(row.id)) levels.set(row.id, []);
    levels.get(row.id).push(row);
  }
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { clips: [], warnings: [] }; throw new Error('语音清单无法读取，请检查 manifest.json。'); }
  if (!Array.isArray(manifest.clips) || manifest.clips.length > 200) throw new Error('语音清单需要包含 clips 数组，最多 200 条。');
  const base = await realpath(directory);
  const clips = [];
  const warnings = [];
  const ids = new Set();
  for (const row of manifest.clips) {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(row.id) || ids.has(row.id) ||
        typeof row.file !== 'string' || !['.mp3', '.wav', '.ogg', '.m4a'].includes(extname(row.file).toLowerCase())) {
      warnings.push('有一条语音的 ID、文件格式或重复项不正确，已跳过。');
      continue;
    }
    try {
      const file = await realpath(join(base, row.file));
      const rel = relative(base, file);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('path');
      const info = await stat(file);
      if (!info.isFile() || info.size > (isSong(row) ? MAX_SONG_BYTES : MAX_VOICE_BYTES)) throw new Error('file');
      let gainDb = 0;
      let matched;
      const candidates = (levels.get(row.id) || []).filter(measured => Number.isFinite(measured.gainDb) && Math.abs(measured.gainDb) <= 36);
      if (candidates.length) {
        const key = `${file}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
        let digest = loudnessHashes.get(key);
        if (!digest) {
          digest = await audioDigest(file);
          if (loudnessHashes.size > 400) loudnessHashes.clear();
          loudnessHashes.set(key, digest);
        }
        matched = candidates.find(measured => digest === measured.sha256);
        if (matched) gainDb = matched.gainDb;
      }
      ids.add(row.id);
      clips.push({ id: row.id, label: String(row.label || row.id).slice(0, 60), text: String(row.text || '').slice(0, 160),
        group: String(row.group || '其他').slice(0, 40), random: row.random !== false, music: row.music === true, gainDb, normalized: Boolean(matched),
        duration: Number.isFinite(row.duration) && row.duration > 0 ? row.duration : Number.isFinite(matched?.duration) ? matched.duration : 0,
        src: pathToFileURL(file).href });
    } catch { warnings.push(`语音 ${row.id} 的文件缺失、超出目录或过大，已跳过。`); }
  }
  return { clips, warnings };
}

export async function loadStickers(directory) {
  await mkdir(directory, { recursive: true });
  const base = await realpath(directory);
  const entries = await readdir(base, { withFileTypes: true });
  const stickers = [];
  const warnings = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:png|jpe?g|gif|webp)$/iu.test(entry.name)) continue;
    try {
      const file = await realpath(join(base, entry.name));
      const rel = relative(base, file);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('path');
      const info = await stat(file);
      if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('size');
      const id = entry.name;
      const number = /^lanjie-(\d+)\./u.exec(id)?.[1];
      stickers.push({ id, label: number ? `表情 ${number}` : id.replace(/\.[^.]+$/u, '').slice(0, 60), animated: extname(id).toLowerCase() === '.gif', src: pathToFileURL(file).href });
    } catch { warnings.push(`表情包 ${entry.name.slice(0, 80)} 超出大小限制或无法读取，已跳过。`); }
  }
  stickers.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return { stickers: stickers.slice(0, 200), warnings };
}
