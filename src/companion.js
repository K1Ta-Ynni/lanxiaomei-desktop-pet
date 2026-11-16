import { readFile, realpath, stat, mkdir, readdir } from 'node:fs/promises';
import { join, relative, isAbsolute, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FEATURES = Object.freeze({ ai: false });
export const ACTIONS = Object.freeze([
  { id: 'greet', label: '打个招呼' },
  { id: 'jump', label: '蹦一下' },
  { id: 'sway', label: '摇一摇' },
  { id: 'sleep', label: '休息一下' },
  { id: 'wake', label: '叫醒她' },
]);
export const INTERACTIONS = Object.freeze([
  { id: 'greet', label: '显示问候' },
  { id: 'jump', label: '蹦一下' },
  { id: 'sway', label: '摇一摇' },
  { id: 'sleep', label: '休息一下' },
  { id: 'wake', label: '叫醒她' },
  { id: 'playVoice', label: '播放本地语音', requiresId: true },
  { id: 'showSticker', label: '显示表情包', requiresId: true },
  { id: 'stopVoice', label: '停止语音' },
  { id: 'hideSticker', label: '收起表情包' },
  { id: 'setPreferences', label: '调整大小、音量和互动开关', requiresPreferences: true },
  { id: 'resetPosition', label: '回到主屏幕' },
  { id: 'moveTo', label: '移动桌宠到屏幕位置', requiresPosition: true },
]);
export const DEFAULT_PREFERENCES = Object.freeze({ scale: 1, volume: 0.65, muted: false, clickVoice: true, idleActions: true });

export function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('互动设置格式不正确。');
  if (!Number.isFinite(value.scale) || value.scale < 0.6 || value.scale > 1.6) throw new Error('大小需要在 60% 到 160% 之间。');
  if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) throw new Error('音量需要在 0 到 100% 之间。');
  for (const key of ['muted', 'clickVoice', 'idleActions']) {
    if (typeof value[key] !== 'boolean') throw new Error('互动开关格式不正确。');
  }
  return { scale: value.scale, volume: value.volume, muted: value.muted, clickVoice: value.clickVoice, idleActions: value.idleActions };
}

// A manifest ID selects a known local clip; pages cannot supply arbitrary paths.
export async function loadVoices(directory) {
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
        typeof row.file !== 'string' || !['.mp3', '.wav', '.ogg'].includes(extname(row.file).toLowerCase())) {
      warnings.push('有一条语音的 ID、文件格式或重复项不正确，已跳过。');
      continue;
    }
    try {
      const file = await realpath(join(base, row.file));
      const rel = relative(base, file);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('path');
      const info = await stat(file);
      if (!info.isFile() || info.size > 30 * 1024 * 1024) throw new Error('file');
      ids.add(row.id);
      clips.push({ id: row.id, label: String(row.label || row.id).slice(0, 60), text: String(row.text || '').slice(0, 160), src: pathToFileURL(file).href });
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
      stickers.push({ id, label: id.replace(/\.[^.]+$/u, '').slice(0, 60), src: pathToFileURL(file).href });
    } catch { warnings.push(`表情包 ${entry.name.slice(0, 80)} 超出大小限制或无法读取，已跳过。`); }
  }
  stickers.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return { stickers: stickers.slice(0, 200), warnings };
}
