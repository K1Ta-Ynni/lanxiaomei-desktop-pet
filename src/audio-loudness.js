// BS.1770 K-weighting and EBU-style 400 ms / 100 ms gated blocks for mono/stereo.
// Playback gain is bounded by sample peaks with 2 dB of headroom. This is gain
// matching, not a compressor or a true-peak loudness re-encoder.
export const TARGET_LUFS = -18;
export const PEAK_CEILING_DB = -2;
export const MAX_ANALYSIS_BYTES = 64 * 1024 * 1024;

function filter(input, coefficients) {
  const [b0, b1, b2, a1, a2] = coefficients;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return value => {
    const y = b0 * value + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = value; y2 = y1; y1 = y;
    return y;
  };
}

export function measureLoudness(channels, sampleRate = 48000) {
  if (sampleRate !== 48000 || !Array.isArray(channels) || !channels.length || channels.length > 2 ||
      !channels[0].length || channels.some(channel => channel.length !== channels[0].length)) throw new Error('仅支持 48 kHz 单声道或立体声音频分析。');
  const length = channels[0].length, hop = 4800, blocks = [];
  const energy = new Float64Array(Math.ceil(length / hop));
  let peak = 0;
  for (const channel of channels) {
    const shelf = filter(channel, [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]);
    const highpass = filter(channel, [1, -2, 1, -1.99004745483398, 0.99007225036621]);
    for (let index = 0; index < length; index++) {
      const sample = channel[index];
      if (!Number.isFinite(sample)) throw new Error('音频采样数据无效。');
      peak = Math.max(peak, Math.abs(sample));
      const weighted = highpass(shelf(sample));
      energy[Math.floor(index / hop)] += weighted * weighted;
    }
  }
  if (length < 19200) blocks.push(energy.reduce((a, b) => a + b, 0) / length);
  else for (let start = 0; (start + 4) * hop <= length; start++) blocks.push((energy[start] + energy[start + 1] + energy[start + 2] + energy[start + 3]) / 19200);
  const loudness = value => value > 0 ? -0.691 + 10 * Math.log10(value) : -Infinity;
  const average = values => values.reduce((a, b) => a + b, 0) / values.length;
  const absolute = blocks.filter(value => loudness(value) >= -70);
  const threshold = absolute.length ? loudness(average(absolute)) - 10 : -70;
  const gated = absolute.filter(value => loudness(value) >= threshold);
  const integratedLufs = gated.length ? loudness(average(gated)) : null;
  const samplePeakDb = peak > 0 ? 20 * Math.log10(peak) : null;
  const gainDb = integratedLufs === null || samplePeakDb === null ? 0
    : Math.round(Math.max(-36, Math.min(18, TARGET_LUFS - integratedLufs, PEAK_CEILING_DB - samplePeakDb)) * 100) / 100;
  return { integratedLufs, samplePeakDb, gainDb,
    peakLimited: integratedLufs !== null && PEAK_CEILING_DB - samplePeakDb < TARGET_LUFS - integratedLufs,
    duration: length / sampleRate };
}
