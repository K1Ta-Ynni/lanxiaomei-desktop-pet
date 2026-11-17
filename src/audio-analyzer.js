import { measureLoudness, MAX_ANALYSIS_BYTES } from './audio-loudness.js';

window.measureAudio = async src => {
  if (new URL(src).protocol !== 'file:') throw new Error('只分析本地音频。');
  const response = await fetch(src);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_ANALYSIS_BYTES) throw new Error('超过 64 MiB 的文件保留原音量，避免离线解码占用过多内存。');
  // OfflineAudioContext never connects to the speakers or requests a microphone.
  const context = new OfflineAudioContext(2, 1, 48000);
  const audio = await context.decodeAudioData(bytes);
  return measureLoudness(Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)), audio.sampleRate);
};
