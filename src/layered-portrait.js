import './lanxiaomei-rig.js';
import { layeredExpressions, layeredOpenMouth } from './appearance.js';

const { createPainter, load, durations, pose, VoiceMotion, displayLift } = globalThis.LanxiaomeiRig;
const width = 780, height = 1160, artworkTop = 85, artworkBottom = 1109;
function expressionPose(id, speaking, blinking) {
  const expression = layeredExpressions[id] ?? {};
  return { effect: expression.effect, bubble: expression.bubble, blink: blinking || expression.blink,
    mouth: speaking || expression.talking ? layeredOpenMouth(id) : 0 };
}

export class LayeredPortrait {
  static #loading;
  #frame = 0;
  #last = -Infinity;
  #action;
  #startedAt = performance.now();
  #voice = new VoiceMotion();

  static load() {
    this.#loading ??= load(new URL('../assets/layered-portrait/', import.meta.url)).finally(() => {
      this.#loading = undefined;
    });
    return this.#loading;
  }

  static drawPreview(canvas, images, expression) {
    canvas.width = 156;
    canvas.height = 232;
    const context = canvas.getContext('2d');
    context.scale(canvas.width / width, canvas.height / height);
    createPainter(context, images)('idle', 0, { moving: false, ...expressionPose(expression) });
  }

  constructor(canvas, images, sample) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.paint = createPainter(this.context, images);
    this.sample = sample;
    const silhouette = document.createElement('canvas');
    silhouette.width = width;
    silhouette.height = height;
    const context = silhouette.getContext('2d');
    createPainter(context, images)('idle', 0, { moving: false });
    this.mask = context.getImageData(0, 0, width, height).data;
    this.refresh();
  }

  #placement(w, h) {
    const scale = Math.min(w / width, (h - 8) / height);
    return { scale, x: (w - width * scale) / 2, y: h - 8 - artworkBottom * scale };
  }

  get restingTop() {
    const { y, scale } = this.#placement(this.canvas.clientWidth, this.canvas.clientHeight);
    return y + artworkTop * scale;
  }

  get restingBottom() { return this.canvas.clientHeight - 8; }

  hitsArtwork(clientX, clientY) {
    if (!this.placement) return false;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const { x, y, scale } = this.placement;
    const column = Math.floor(((clientX - rect.left) * this.canvas.width / rect.width - x) / scale);
    const row = Math.floor(((clientY - rect.top) * this.canvas.height / rect.height - y) / scale + this.lift);
    return column >= 0 && column < width && row >= 0 && row < height && this.mask[(row * width + column) * 4 + 3] >= 32;
  }

  refresh() {
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#draw);
  }

  move(mode) {
    if (this.#action?.mode === 'jump' && performance.now() - this.#action.start < durations.jump) return;
    this.#action = { mode, start: performance.now() };
    this.refresh();
  }

  jump() { this.move('jump'); }

  stop() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#last = -Infinity;
    this.#action = this.placement = undefined;
    this.#voice.reset();
  }

  #draw = now => {
    this.#frame = 0;
    const state = this.sample();
    if (state.hidden || !this.canvas.clientWidth || !this.canvas.clientHeight) { this.stop(); return; }
    if (now - this.#last < 1000 / 60 - 2) { this.refresh(); return; }
    this.#last = now;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * ratio);
    const h = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const placement = this.placement = this.#placement(this.canvas.clientWidth, this.canvas.clientHeight);
    placement.x *= ratio;
    placement.y *= ratio;
    placement.scale *= ratio;
    const { scale, x, y } = placement;
    if (state.cancelJump || !state.playingMotion || (this.#action && now - this.#action.start >= durations[this.#action.mode])) {
      this.#action = undefined;
    }
    const canReact = state.playingMotion && !state.cancelJump && !state.music;
    if (state.measuring) this.#voice.sample(state.voiceLevel, now, canReact && !this.#action);
    else if (!canReact) this.#voice.reset();
    else this.#voice.sample(0, now);
    const { jumpTime } = this.#voice.pose(now);
    const voiceJump = canReact && jumpTime < durations.jump;
    const expression = state.expression;
    const mode = this.#action?.mode ?? (voiceJump ? 'jump' : state.music ? 'music' : 'idle');
    const moving = mode === 'idle' ? state.motion : state.playingMotion;
    const time = this.#action ? now - this.#action.start
      : voiceJump ? jumpTime : moving ? (now - this.#startedAt) % durations[mode] : 0;
    const face = expressionPose(expression, state.measuring && this.#voice.talking, state.blinking);
    // Use CSS pixels so display scaling does not change the motion at a given pet size.
    const artworkHeight = (artworkBottom - artworkTop) * scale / ratio;
    const displayBoost = Math.max(0, Math.min(1, (440 - artworkHeight) / 200));
    const liftLimit = (state.headRoom ?? Infinity) * ratio / scale;
    const requestedLift = pose(mode, time).lift;
    this.lift = Math.min(displayLift(mode, requestedLift, displayBoost), liftLimit);
    const context = this.context;
    context.resetTransform();
    context.clearRect(0, 0, w, h);
    context.setTransform(scale, 0, 0, scale, x, y);
    this.paint(mode, time, {
      moving, liftLimit, displayBoost, ...face, effectTime: state.playingMotion ? now : 0,
    });
    if (this.#action || voiceJump || moving || state.measuring || (face.bubble && state.playingMotion)) this.refresh();
  };
}
