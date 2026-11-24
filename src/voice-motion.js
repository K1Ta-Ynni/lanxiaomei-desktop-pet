export function audioLevel(analyser, samples) {
  analyser.getFloatTimeDomainData(samples);
  let power = 0;
  for (const sample of samples) power += sample * sample;
  return Math.sqrt(power / samples.length);
}

export class MouthMicrophone {
  #attempt = 0;
  #stream;
  #context;
  #analyser;
  #samples;
  #stopOnEnded = () => {
    this.stop();
    this.onStatus('error', '麦克风已断开。');
  };
  enabled = false;

  constructor(onStatus) { this.onStatus = onStatus; }

  async start() {
    if (this.enabled) return;
    this.enabled = true;
    const attempt = ++this.#attempt;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      if (attempt !== this.#attempt) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.#stream = stream;
      this.#context = new AudioContext();
      this.#analyser = this.#context.createAnalyser();
      this.#analyser.fftSize = 1024;
      this.#samples = new Float32Array(this.#analyser.fftSize);
      this.#context.createMediaStreamSource(stream).connect(this.#analyser);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', this.#stopOnEnded, { once: true });
      await this.#context.resume();
      if (attempt === this.#attempt) this.onStatus('active');
    } catch (error) {
      if (attempt !== this.#attempt) return;
      this.stop();
      this.onStatus('error', error.name === 'NotFoundError' ? '找不到麦克风。' : '麦克风无法启用，请检查系统麦克风权限。');
    }
  }

  get active() { return this.#context?.state === 'running'; }
  level() { return this.active ? audioLevel(this.#analyser, this.#samples) : 0; }

  stop() {
    ++this.#attempt;
    this.enabled = false;
    for (const track of this.#stream?.getTracks() || []) {
      track.removeEventListener('ended', this.#stopOnEnded);
      track.stop();
    }
    this.#stream = this.#analyser = this.#samples = undefined;
    if (this.#context) void this.#context.close().catch(() => {});
    this.#context = undefined;
    this.onStatus('off');
  }
}
