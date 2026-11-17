import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ANALYSIS_BYTES, TARGET_LUFS, PEAK_CEILING_DB } from './audio-loudness.js';

export async function audioDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export class AudioNormalizer {
  constructor(path, createAnalyzer) { this.path = path; this.createAnalyzer = createAnalyzer; this.pending = Promise.resolve(); }
  normalize(clips, onProgress = () => {}) {
    const operation = this.pending.catch(() => {}).then(() => this.run(clips, onProgress));
    this.pending = operation;
    return operation;
  }
  async run(clips, onProgress) {
    let saved = { clips: [] }, analyzer;
    try { saved = JSON.parse(await readFile(this.path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('音量分析记录无法读取。'); }
    const records = new Map((Array.isArray(saved.clips) ? saved.clips : []).map(row => [row.id, row]));
    const result = { analyzed: 0, reused: 0, warnings: [] };
    try {
      for (const [index, clip] of clips.entries()) {
        onProgress({ current: index + 1, total: clips.length, label: clip.label });
        try {
          const path = fileURLToPath(clip.src), before = await stat(path);
          if (!before.isFile() || before.size > MAX_ANALYSIS_BYTES) throw new Error('超过 64 MiB，保留原音量');
          const sha256 = await audioDigest(path);
          const old = records.get(clip.id);
          if (old?.sha256 === sha256 && Number.isFinite(old.gainDb)) { result.reused++; continue; }
          analyzer ??= await this.createAnalyzer();
          const levels = await analyzer.measure(clip.src);
          if (!levels || !Number.isFinite(levels.gainDb) || levels.gainDb < -36 || levels.gainDb > 18 ||
              !Number.isFinite(levels.duration) || levels.duration <= 0) throw new Error('无法分析音频');
          const after = await stat(path);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('分析时文件已改变，请重试');
          records.set(clip.id, { id: clip.id, sha256, ...levels, analyzer: 'bs1770-sample-peak-v1' });
          await mkdir(dirname(this.path), { recursive: true });
          const temporary = this.path + '.' + randomUUID() + '.tmp';
          await writeFile(temporary, JSON.stringify({ targetLufs: TARGET_LUFS, peakCeilingDb: PEAK_CEILING_DB, clips: [...records.values()] }, null, 2) + '\n');
          await rename(temporary, this.path);
          result.analyzed++;
        } catch (error) { result.warnings.push(`${clip.label}：${error.message}，未改写原文件。`); }
      }
    } finally { await analyzer?.close(); }
    return result;
  }
}
