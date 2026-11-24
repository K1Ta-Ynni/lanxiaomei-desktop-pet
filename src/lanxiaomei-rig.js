(() => {
const durations = { idle: 6000, tilt: 1400, jump: 1120, music: 2400, gaze: 3000, drag: 1120, voice: 2400 };
const jumpHeight = 62;
const voiceJumpCooldown = 1440;
const names = [
  "reference", "torso", "head-base", "head-underlap", "motion-fill", "krita-repair",
  "forelock", "forelock-blink", "cheek-left", "cheek-right", "bow-tail-left", "bow-tail-right",
  "iris-left", "iris-right", "ear-left", "ear-right", "lock-left", "lock-right",
  "curl-left", "curl-right", "ear-seams", "halo", "blink", "mouth",
];
const revisedNames = [
  "arm-left", "arm-right", "bow-tail-left", "bow-tail-right", "bunny", "cheek-right",
  "chest-ribbon-left", "chest-ribbon-right", "curl-right", "ear-left", "ear-right",
  "ear-upper-left", "ear-upper-right", "forelock", "head-base", "iris-left",
  "iris-right", "leg-left", "leg-right", "lock-left", "lock-right", "torso",
  "accessory-backing", "face-backing", "forelock-backing", "join-backing",
  "iris-right-completed", "upper-lash-right",
  "ear-motion-backing", "limb-motion-backing", "round-mouth",
];
class VoiceMotion {
  #closed = 0;
  #started = -Infinity;
  #lastSample = null;
  level = 0;
  talking = false;

  reset() {
    this.level = 0;
    this.talking = false;
    this.#closed = 0;
    this.#started = -Infinity;
    this.#lastSample = null;
  }

  sample(raw, now, allowJump = true) {
    const elapsed = this.#lastSample === null ? 16 : Math.max(0, now - this.#lastSample);
    this.#lastSample = now;
    const rate = 1 - Math.exp(-elapsed / (raw > this.level ? 28 : 100));
    this.level += (raw - this.level) * rate;
    const speaking = this.level > (this.talking ? 0.012 : 0.021);
    if (speaking) {
      if (allowJump && now - this.#started >= voiceJumpCooldown) this.#started = now;
      this.#closed = now + 90;
      this.talking = true;
    } else if (now >= this.#closed) {
      this.talking = false;
    }
  }

  pose(now) {
    return jumpPose(now - this.#started);
  }
}

function pulse(phase) {
  return Math.sin(Math.PI * Math.max(0, Math.min(1, phase))) ** 2;
}

function jumpPose(time) {
  const flight = Math.max(0, Math.min(1, time / 780));
  const eyes = Math.max(0, Math.min(1, time / durations.jump));
  const swing = Math.sin(2 * Math.PI * flight) * Math.sin(Math.PI * flight);
  return { jumpTime: time, lift: jumpHeight * pulse(flight), lean: 0.022 * swing, swing,
    gaze: Math.sin(Math.PI * eyes) * Math.cos(2 * Math.PI * eyes), lookUp: pulse(eyes) };
}

function haloJump(time) {
  const phase = Math.max(0, Math.min(1, time / 740));
  const lag = 65 * (pulse((time - 70) / 740) - pulse(phase))
    * Math.max(0, Math.min(1, (740 - time) / 95));
  const angle = 0.055 * Math.sin(2 * Math.PI * phase) * Math.sin(Math.PI * phase);
  return { lag, angle };
}

function idleHalo(time) {
  // Snowman's halo uses separate X/Y frequencies at 60 fps and drag of 3.
  const elapsed = Math.max(0, time - 1000 / 30) * 0.06;
  const ease = pulse(Math.min(time, durations.idle - time, 400) / 800);
  return {
    x: 3 * Math.sin(elapsed * 0.029) * ease,
    lag: -6 * Math.sin(elapsed * 0.041) * ease,
    angle: 0.033 * Math.cos(elapsed * 0.041) * ease,
  };
}

function pose(mode, time) {
  const phase = time / durations[mode];
  const wave = Math.sin(phase * Math.PI * 2);
  if (mode === "jump") return jumpPose(time);
  if (mode === "tilt") return { lift: 0, lean: 0.043 * pulse(phase), swing: 0.48 * pulse(phase), gaze: 0.45 * pulse(phase) };
  if (mode === "idle") return { lift: 4.5 * pulse(phase * 2 % 1), lean: 0.018 * pulse(phase),
    swing: 0.42 * wave * pulse(phase) ** 0.5, gaze: wave };
  if (mode === "music") return { lift: 3 * pulse(phase * 2 % 1), lean: 0.018 * wave, swing: 0.55 * wave, gaze: 0 };
  if (mode === "drag") return { lift: 0, lean: 0.026 * pulse(phase), swing: 0.72 * pulse(phase), gaze: 0 };
  if (mode === "voice") return jumpPose(time - 160);
  return { lift: 0, lean: 0, swing: 0, gaze: wave };
}

function drawFaceEffect(context, effect) {
  if (!effect) return;
  context.save();
  if (effect === "shade") {
    const shade = context.createLinearGradient(280, 226, 280, 333);
    shade.addColorStop(0, "rgba(74,50,99,.56)");
    shade.addColorStop(.54, "rgba(83,60,112,.47)");
    shade.addColorStop(1, "rgba(108,80,125,0)");
    context.fillStyle = shade;
    context.beginPath();
    context.moveTo(197, 275);
    context.bezierCurveTo(219, 259, 240, 234, 245, 220);
    context.bezierCurveTo(293, 210, 330, 218, 354, 228);
    context.bezierCurveTo(366, 250, 386, 267, 402, 285);
    context.bezierCurveTo(392, 316, 369, 334, 345, 344);
    context.quadraticCurveTo(260, 359, 223, 331);
    context.quadraticCurveTo(203, 312, 197, 275);
    context.fill();
    context.strokeStyle = "rgba(104,72,127,.55)";
    context.lineWidth = 1.7;
    for (const [x, y, length] of [[272, 308, 13], [278, 309, 17], [284, 309, 15]]) {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 1, y + length);
      context.stroke();
    }
  } else if (effect === "blush") {
    context.save();
    context.translate(297, 319);
    context.rotate(.045);
    context.scale(2.55, 1);
    const blush = context.createRadialGradient(0, 0, 1, 0, 0, 24);
    blush.addColorStop(0, "rgba(237,117,151,.61)");
    blush.addColorStop(.48, "rgba(240,133,163,.40)");
    blush.addColorStop(1, "rgba(248,164,185,0)");
    context.fillStyle = blush;
    context.fillRect(-24, -24, 48, 48);
    context.restore();
    context.strokeStyle = "rgba(205,104,136,.61)";
    context.lineWidth = 1.5;
    context.lineCap = "round";
    for (const [x, y, length] of [[284, 317, 6], [293, 315, 9], [302, 317, 7]]) {
      context.beginPath();
      context.moveTo(x + 2, y);
      context.quadraticCurveTo(x + 1, y + length * .45, x - 2, y + length);
      context.stroke();
    }
  } else if (effect === "blush-original") {
    drawOriginalBlush(context);
  }
  context.restore();
}

function drawOriginalBlush(context) {
  for (const [x, y] of [[240, 331], [358, 338]]) {
    context.save();
    context.translate(x, y);
    context.scale(1.65, 1);
    const blush = context.createRadialGradient(0, 0, 1, 0, 0, 15);
    blush.addColorStop(0, "rgba(235,93,137,.60)");
    blush.addColorStop(1, "rgba(244,120,156,0)");
    context.fillStyle = blush;
    context.fillRect(-15, -15, 30, 30);
    context.restore();
    context.strokeStyle = "rgba(195,94,133,.74)";
    context.lineWidth = 1.7;
    context.lineCap = "round";
    for (const offset of [-7, 0, 7]) {
      context.beginPath();
      context.moveTo(x + offset + 2, y - 3);
      context.lineTo(x + offset - 2, y + 3);
      context.stroke();
    }
  }
}

function displayLift(mode, lift, boost) {
  return lift * (1 + boost * (mode === "idle" || mode === "music" ? 1.7 : .7));
}

function drawSweat(context, time, boost = 0) {
  context.save();
  context.translate(429 + 14 * boost, 285 - 13 * boost + 3 * Math.sin(time / 270));
  context.rotate(0.19);
  const scale = 1.55 * (1 + .55 * boost);
  context.scale(scale, scale);
  const fill = context.createLinearGradient(0, -11, 0, 16);
  fill.addColorStop(0, "#effaff");
  fill.addColorStop(1, "#a4bbed");
  context.fillStyle = fill;
  context.strokeStyle = "#716494";
  context.lineWidth = 2.3 + .3 * boost;
  context.beginPath();
  context.moveTo(0, -13);
  context.bezierCurveTo(-3, -7, -12, 3, -10, 9);
  context.bezierCurveTo(-7, 18, 7, 18, 10, 9);
  context.bezierCurveTo(12, 3, 3, -7, 0, -13);
  context.fill();
  context.stroke();
  context.fillStyle = "#fbfdff";
  context.beginPath();
  context.ellipse(4, 7, 2.6, 3.5, 0.36, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

const frustrationScribbles = [
  new Path2D("M-9 8 C-22 0 -10 -16 2 -13 C16 -10 11 9 -3 11 C-15 12 -13 -9 -3 -7 C0 -6 4 -2 3 3 C1 9 -9 3 -5 -2 C1 -10 15 -4 11 6 Q7 12 -3 13"),
  new Path2D("M-13 1 C-14 -11 5 -15 10 -7 C16 4 2 14 -6 8 C-15 2 -10 -7 0 -6 C10 -4 8 5 2 5 C-5 5 -4 -2 2 -2 C12 -4 16 6 9 12 Q4 16 -3 12"),
  new Path2D("M-15 6 C-19 -5 -7 -14 2 -12 C16 -9 14 5 5 9 C-4 14 -15 8 -12 -1 C-10 -9 3 -9 7 -2 C11 6 -1 10 -5 4 C-10 -3 3 -5 12 0 Q18 4 11 10"),
  new Path2D("M-12 -5 C-5 -15 11 -13 13 -3 C16 7 5 15 -5 11 C-16 7 -16 -4 -6 -7 C3 -11 10 -3 5 4 C1 10 -10 5 -7 -2 C-3 -8 8 -5 11 2 Q16 8 1 13"),
];

function drawFrustrationBubble(context, time, boost = 0) {
  context.save();
  context.translate(135 - 16 * boost, 215 - 17 * boost + 2.5 * Math.sin(time / 240));
  context.rotate(-0.12);
  const scale = 1 + .5 * boost;
  context.scale(scale, scale);
  context.fillStyle = "#fff9fd";
  context.strokeStyle = "#8b7799";
  context.lineWidth = 3.4;
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(23, 13);
  context.bezierCurveTo(32, 3, 29, -13, 19, -20);
  context.bezierCurveTo(8, -31, -16, -29, -26, -17);
  context.bezierCurveTo(-37, -5, -29, 13, -16, 19);
  context.bezierCurveTo(-5, 24, 6, 24, 12, 21);
  context.quadraticCurveTo(15, 28, 24, 30);
  context.quadraticCurveTo(20, 22, 23, 13);
  context.closePath();
  context.fill();
  context.stroke();
  context.lineWidth = 2.8 + .4 * boost;
  context.lineCap = "round";
  context.stroke(frustrationScribbles[Math.floor(time / 180) % frustrationScribbles.length]);
  context.restore();
}

function drawMusicNotes(context, phase) {
  for (const [symbol, x, y, offset, size, color] of [
    ["♪", 554, 120, 0, 41, "#9b6aac"],
    ["♫", 604, 141, .46, 32, "#578da2"],
  ]) {
    const progress = (phase + offset) % 1;
    const drift = (1 - Math.cos(Math.PI * progress)) / 2;
    context.save();
    context.translate(x + 10 * drift, y + 10 - 41 * drift);
    context.rotate((drift - .5) * .32);
    context.globalAlpha = Math.sin(Math.PI * progress) ** .7;
    context.font = `600 ${size}px "Segoe UI Symbol", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = 2;
    context.strokeStyle = "#fff3ff";
    context.shadowColor = "#fff6ff";
    context.shadowBlur = 4;
    context.fillStyle = color;
    context.strokeText(symbol, 0, 0);
    context.fillText(symbol, 0, 0);
    context.restore();
  }
}

function drawWaveMouth(context) {
  context.save();
  context.lineJoin = "round";
  context.lineWidth = 1.65;
  context.strokeStyle = "#c57c9f";
  context.fillStyle = "#f3a6b6";
  context.beginPath();
  context.moveTo(287, 341);
  context.bezierCurveTo(289, 336, 293, 337, 296, 339);
  context.bezierCurveTo(299, 339, 301, 336, 304, 340);
  context.bezierCurveTo(306, 343, 303, 348, 300, 347);
  context.quadraticCurveTo(296, 345, 293, 347);
  context.bezierCurveTo(289, 348, 286, 344, 287, 341);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = "#ffe2e9";
  context.beginPath();
  context.ellipse(300, 341, 2.5, 1, .15, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
async function loadImages(root, names) {
  const entries = await Promise.all(names.map(async name => {
    const image = new Image();
    image.src = new URL(name + ".png", root).href;
    await image.decode();
    return [name, image];
  }));
  return Object.fromEntries(entries);
}

async function load(root, comparisonRoot) {
  const revised = new Set(revisedNames);
  const editedImages = await loadImages(root, [...revised, ...names.filter(name =>
    !["reference", "forelock-blink", "mouth"].includes(name) && !revised.has(name))]);
  const images = comparisonRoot ? await loadImages(comparisonRoot, names) : {};
  return { editedImages, images };
}

function createPainter(rig, { images, editedImages }) {
  const headCanvas = document.createElement("canvas");
  headCanvas.width = 780;
  headCanvas.height = 600;
  const head = headCanvas.getContext("2d");

  return function paint(mode, time, {
    moving = true, edited = true, accessories = true, mouth = 0, blink = false,
    effect = "", bubble = false, effectTime = time, voicePose, trailingVoice, accessoryVoice,
    liftLimit = Infinity, displayBoost = 0, recordPart,
  } = {}) {
    const { lift: requestedLift, lean, swing, gaze, jumpTime, lookUp = 0 } = voicePose ?? pose(mode, time);
    const lift = Math.min(displayLift(mode, requestedLift, displayBoost), liftLimit);
    const headMotion = recordPart && new DOMMatrix().translate(298, 372)
      .rotate(moving ? lean * (1 + .8 * displayBoost) * 180 / Math.PI : 0).translate(-298, -372);
    if (recordPart) {
      recordPart("body", new DOMMatrix(), lift);
      recordPart("head", headMotion, lift);
    }
    rig.save();
    rig.translate(77, 85 - lift);

    function part(context, name, x = 0, y = 0, angle = 0, dx = 0, dy = 0) {
      context.save();
      context.translate(x + dx, y + dy);
      context.rotate(angle);
      if (recordPart) {
        const local = new DOMMatrix().translate(x + dx, y + dy).rotate(angle * 180 / Math.PI).translate(-x, -y);
        recordPart(name, context === head ? headMotion.multiply(local) : local);
      }
      context.drawImage((edited && editedImages[name]) || images[name], -x, -y);
      context.restore();
    }

    function drawMouth(context, mouth) {
      if (mouth === 1) context.drawImage(editedImages["round-mouth"], 0, 0);
      if (mouth === 2) drawWaveMouth(context);
    }
    const motionGain = 1 + 1.35 * displayBoost;
    const follow = edited && moving && accessories && ["jump", "drag", "music", "voice"].includes(mode);
    const delayed = follow ? (accessoryVoice ?? pose(mode, Math.max(0, time - 45)).swing
      * Math.min(1, (durations[mode] - time) / 110)) * motionGain : 0;
    const idleMotionScale = mode === "idle" ? 1.5 : 1;
    const limbSwing = edited && moving ? swing * idleMotionScale * motionGain : 0;
    const legShift = edited && moving && (mode === "jump" || mode === "voice") ? lift / 56 : 0;
    if (Math.abs(limbSwing) > .001 || legShift > .001) part(rig, "limb-motion-backing");
    if (Math.abs(delayed) > 0.001) part(rig, "accessory-backing");
    if (edited) {
      part(rig, "leg-right", 374, 686, -0.014 * legShift * motionGain, 0, -1.4 * legShift * motionGain);
      part(rig, "leg-left", 251, 686, 0.015 * legShift * motionGain, 0, -1.7 * legShift * motionGain);
    }
    part(rig, "torso");
    if (edited) {
      part(rig, "chest-ribbon-right", 312, 453, 0.028 * delayed);
      part(rig, "chest-ribbon-left", 290, 453, 0.025 * delayed);
      part(rig, "arm-right", 394, 445, -0.059 * limbSwing);
      part(rig, "arm-left", 207, 446, -0.052 * limbSwing);
      part(rig, "bunny", 404, 547, 0.022 * delayed);
    }
    head.clearRect(0, 0, headCanvas.width, headCanvas.height);
    head.save();
    head.translate(77, 20);
    part(head, "ear-seams");
    const baseTrailing = moving ? (trailingVoice !== undefined ? trailingVoice
      : pose(mode, Math.max(0, time - 32)).swing * Math.min(1, (durations[mode] - time) / 65)) : 0;
    const hairSwing = 1 + .85 * displayBoost;
    const trailing = baseTrailing * hairSwing;
    const sway = moving ? swing * hairSwing : 0;
    part(head, "curl-left", 117, 294, 0.034 * sway);
    part(head, "curl-right", 508, 313, 0.013 * trailing);
    part(head, "lock-right", 386, 381, -0.042 * trailing);
    part(head, "lock-left", 213, 379, -0.038 * sway);
    const showBacking = moving && (Math.abs(swing) + Math.abs(trailing) + Math.abs(gaze) > 0.001);
    if (showBacking && !edited) {
      part(head, "motion-fill");
      part(head, "krita-repair");
    }
    part(head, "head-base");
    if (blink) {
      part(head, "blink");
    } else {
      const glance = moving ? (2.5 + .5 * displayBoost) * gaze : 0;
      const vertical = moving ? -(1.6 + .3 * displayBoost) * lookUp : 0;
      part(head, "iris-left", 0, 0, 0, glance, vertical);
      part(head, edited ? "iris-right-completed" : "iris-right", 0, 0, 0, glance, vertical);
      if (edited) part(head, "upper-lash-right");
    }
    drawFaceEffect(head, effect);
    drawMouth(head, mouth);
    part(head, "cheek-left", 170, 258, -0.036 * sway);
    part(head, "cheek-right", 434, 242, -0.017 * trailing);
    part(head, blink && !edited ? "forelock-blink" : "forelock", 296, 150, 0.043 * sway);
    part(head, "bow-tail-left", 452, 174, -0.068 * trailing);
    part(head, "bow-tail-right", 461, 170, -0.074 * sway);
    part(head, "head-underlap");
    part(head, "ear-left", 136, 215, edited ? -0.048 * sway : 0);
    part(head, "ear-right", 490, 224, edited ? 0.049 * trailing : 0);
    if (edited) {
      part(head, "ear-upper-left", 373, 68, -0.12 * sway);
      part(head, "ear-upper-right", 483, 87, 0.11 * trailing);
      head.globalCompositeOperation = "destination-over";
      part(head, "forelock-backing");
      if (showBacking || blink) {
        part(head, "face-backing");
        part(head, "krita-repair");
        part(head, "motion-fill");
      }
      if (Math.abs(sway) + Math.abs(trailing) > .001) part(head, "ear-motion-backing");
      part(head, "join-backing");
      head.globalCompositeOperation = "source-over";
    }
    if (effect === "sweat") drawSweat(head, effectTime, displayBoost);
    if (mode === "music") drawMusicNotes(head, time / durations.music);
    if (bubble) {
      drawFrustrationBubble(head, effectTime, displayBoost);
    }
    let halo = { angle: moving ? -0.045 * swing : 0, lag: 3 * baseTrailing };
    if (moving) {
      if (mode === "idle") halo = idleHalo(time);
      if (mode === "jump") halo = haloJump(time);
      if (mode === "voice") halo = haloJump(jumpTime);
    }
    part(head, "halo", 206, 45, halo.angle, halo.x ?? 0, -halo.lag);
    head.restore();
    rig.translate(298, 372);
    rig.rotate(moving ? lean * (1 + .8 * displayBoost) : 0);
    rig.translate(-298, -372);
    rig.drawImage(headCanvas, -77, -20);
    rig.restore();
  };
}

globalThis.LanxiaomeiRig = {
  createPainter, load, durations, pose, VoiceMotion, voiceJumpCooldown, displayLift, drawFaceEffect,
  drawFrustrationBubble, drawSweat, drawWaveMouth,
};
})();
