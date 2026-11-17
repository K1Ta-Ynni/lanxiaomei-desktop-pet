import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measureLoudness, PEAK_CEILING_DB } from '../src/audio-loudness.js';
import { AudioNormalizer, audioDigest } from '../src/audio-normalizer.js';
import { loadVoices } from '../src/companion.js';

function sine(amplitude, seconds = 2) {
  return Float32Array.from({ length: 48000 * seconds }, (_, index) => amplitude * Math.sin(2 * Math.PI * 1000 * index / 48000));
}
test('K-weighted loudness compensates level changes and retains peak headroom', () => {
  const quiet = measureLoudness([sine(0.1)]), loud = measureLoudness([sine(0.4)]);
  assert.ok(Math.abs(quiet.integratedLufs + 23) < 0.2, '1 kHz mono reference tone is approximately -23 LUFS');
  assert.ok(Math.abs((loud.integratedLufs - quiet.integratedLufs) - 12.0412) < 0.05);
  assert.ok(Math.abs(quiet.integratedLufs + quiet.gainDb + 18) < 0.02);
  assert.ok(Math.abs(loud.integratedLufs + loud.gainDb + 18) < 0.02);
  const impulse = new Float32Array(48000); impulse[24000] = 0.999;
  const result = measureLoudness([impulse]);
  assert.ok(result.samplePeakDb + result.gainDb <= PEAK_CEILING_DB + 0.01);
});
test('silence and short clips do not receive runaway gain; silence is gated', () => {
  assert.equal(measureLoudness([new Float32Array(48000)]).gainDb, 0);
  assert.equal(measureLoudness([new Float32Array(48000)]).integratedLufs, null);
  assert.ok(Number.isFinite(measureLoudness([sine(0.1, 0.1)]).gainDb));
  const padded = new Float32Array(48000 * 10); padded.set(sine(0.1), 48000 * 4);
  assert.ok(Math.abs(measureLoudness([padded]).integratedLufs - measureLoudness([sine(0.1)]).integratedLufs) < 1);
});
test('analysis cache preserves files, reuses valid results and rejects changed recordings', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pet-audio-levels-'));
  try {
    const original = join(temp, 'original.wav'), cache = join(temp, 'profile/levels.json');
    await writeFile(original, 'fixture bytes');
    let calls = 0, closed = 0;
    const normalizer = new AudioNormalizer(cache, async () => ({
      measure: async () => { calls++; return { gainDb: 5, duration: 2 }; }, close: () => { closed++; },
    }));
    const clips = [{ id: 'voice', label: 'voice', src: pathToFileURL(original).href }];
    assert.equal((await normalizer.normalize(clips)).analyzed, 1);
    assert.equal((await normalizer.normalize(clips)).reused, 1);
    assert.equal(calls, 1); assert.equal(closed, 1);
    assert.equal(await readFile(original, 'utf8'), 'fixture bytes');
    await writeFile(original, 'replacement');
    assert.equal((await normalizer.normalize(clips)).analyzed, 1);
    assert.equal(calls, 2);
    const rows = JSON.parse(await readFile(cache, 'utf8')).clips;
    assert.equal(rows[0].sha256, await audioDigest(original));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('personal measurements override bundled levels only when the audio hash matches', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pet-audio-personal-'));
  try {
    const voice = join(temp, 'v.wav'), personal = join(temp, 'personal.json'), bundled = join(temp, 'bundled');
    await mkdir(bundled); await writeFile(voice, 'valid bytes');
    const sha256 = await audioDigest(voice);
    await writeFile(join(temp, 'manifest.json'), JSON.stringify({ clips: [{ id: 'v', file: 'v.wav' }] }));
    await writeFile(join(bundled, 'loudness.json'), JSON.stringify({ clips: [{ id: 'v', sha256, gainDb: 2 }] }));
    await writeFile(personal, JSON.stringify({ clips: [{ id: 'v', sha256, gainDb: 4, duration: 2 }] }));
    assert.equal((await loadVoices(temp, { loudnessDirectory: bundled, loudnessPath: personal })).clips[0].gainDb, 4);
    await writeFile(personal, JSON.stringify({ clips: [{ id: 'v', sha256: 'stale', gainDb: 9 }] }));
    assert.equal((await loadVoices(temp, { loudnessDirectory: bundled, loudnessPath: personal })).clips[0].gainDb, 2);
    await writeFile(voice, 'replaced');
    assert.equal((await loadVoices(temp, { loudnessDirectory: bundled, loudnessPath: personal })).clips[0].gainDb, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
