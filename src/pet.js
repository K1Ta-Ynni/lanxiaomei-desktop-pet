const pet = document.querySelector('#pet');
const bubble = document.querySelector('#bubble');
const greeting = document.querySelector('#greeting');
const stickerDisplay = document.querySelector('#sticker');
const stickerPicker = document.querySelector('#sticker-picker');
const pickerButton = document.querySelector('#open-stickers');
let info, preferences, audio, activeClip;
let dragging = false, sleeping = false;
let pointerId, downAt, greetingTimer, actionTimer;
let helloSequence = 0, lastClickVoiceId;
let audioContext, audioSource, voiceGain;
let suspended = false;
const portrait = pet.querySelector('img');
let blinkSource, normalSource, blinkTimer, blinkEndTimer, expressionTimer, blinking = false;
const decodedExpressions = new Map();
let controlsTimer;
let restingExpression = 'normal', restingTimer, speakingTimer, mouthOpen = false;
let clicks = 0, lastClickAt = 0;

function closePicker() {
  stickerPicker.hidden = true;
  pickerButton.setAttribute('aria-expanded', 'false');
  revealControls();
}
async function sendSticker(command) {
  try { await window.petApp.executeInteraction(command); closePicker(); }
  catch (error) { notice(error.message); }
}
async function openPicker() {
  if (suspended) return;
  if (!stickerPicker.hidden) { closePicker(); return; }
  stickerPicker.hidden = false;
  pickerButton.setAttribute('aria-expanded', 'true');
  const list = document.querySelector('#quick-stickers');
  list.replaceChildren();
  document.querySelector('#picker-status').textContent = '正在读取…';
  try {
    const { stickers } = await window.petApp.stickers();
    if (stickerPicker.hidden || suspended) return;
    document.querySelector('#picker-status').textContent = stickers.length ? '先看小图，点一下发出' : '还没有表情包，在互动面板中添加。';
    for (const sticker of stickers) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.sticker = sticker.id;
      button.title = sticker.label + (sticker.animated ? ' · GIF 动图' : '');
      const image = document.createElement('img');
      image.src = sticker.src;
      image.alt = sticker.label;
      image.loading = 'lazy';
      image.draggable = false;
      const label = document.createElement('span');
      label.textContent = sticker.label + (sticker.animated ? ' · GIF' : '');
      button.append(image, label);
      button.addEventListener('click', () => { void sendSticker({ type: 'showSticker', id: sticker.id }); });
      list.append(button);
    }
  } catch (error) { document.querySelector('#picker-status').textContent = error.message; }
}

function scheduleRestingExpression() {
  clearTimeout(restingTimer);
  const mode = preferences?.portraitMode || 'auto';
  if (mode !== 'auto') restingExpression = mode;
  renderExpression();
  if (suspended || mode !== 'auto') return;
  restingTimer = setTimeout(() => {
    if (!sleeping && !audio && !downAt && !portrait.dataset.expression) {
      const choices = (info.idleExpressions || ['normal']).filter(id => id !== restingExpression && (id === 'normal' || decodedExpressions.has(id)));
      if (choices.length) restingExpression = choices[Math.floor(Math.random() * choices.length)];
    }
    scheduleRestingExpression();
  }, 30000 + Math.random() * 30000);
}

function speakingTick() {
  clearTimeout(speakingTimer);
  if (!audio || suspended || sleeping) { mouthOpen = false; renderExpression(); return; }
  mouthOpen = !mouthOpen;
  renderExpression();
  speakingTimer = setTimeout(speakingTick, mouthOpen ? 170 + Math.random() * 150 : 110 + Math.random() * 130);
}

function renderExpression() {
  if (!normalSource) return;
  const name = sleeping ? 'blink' : suspended ? 'normal' : portrait.dataset.expression || (blinking ? 'blink' : mouthOpen ? 'talk' : restingExpression);
  const source = decodedExpressions.get(name)?.getAttribute('src') || normalSource;
  if (portrait.getAttribute('src') !== source) portrait.src = source;
}
function showExpression(name, duration = 1100) {
  if (suspended || sleeping || !decodedExpressions.has(name)) return;
  clearTimeout(blinkTimer);
  clearTimeout(blinkEndTimer);
  blinking = false;
  clearTimeout(expressionTimer);
  portrait.dataset.expression = name;
  renderExpression();
  expressionTimer = setTimeout(() => {
    portrait.dataset.expression = '';
    scheduleBlink();
  }, duration);
}
function scheduleBlink() {
  clearTimeout(blinkTimer);
  clearTimeout(blinkEndTimer);
  blinking = false;
  renderExpression();
  if (!blinkSource || sleeping || suspended || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  blinkTimer = setTimeout(() => {
    blinking = true;
    renderExpression();
    blinkEndTimer = setTimeout(scheduleBlink, 150);
  }, 3000 + Math.random() * 4000);
}
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', scheduleBlink);

function revealControls() {
  if (suspended) return;
  document.body.classList.add('controls-visible');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    if (stickerPicker.hidden && !document.querySelector('.pet-tools :focus-visible')) document.body.classList.remove('controls-visible');
  }, 2600);
}
window.addEventListener('mousemove', revealControls, { passive: true });
window.addEventListener('pointerdown', revealControls, { passive: true });
window.addEventListener('keydown', revealControls);
document.querySelector('.pet-tools').addEventListener('focusin', revealControls);
document.querySelector('.pet-tools').addEventListener('focusout', revealControls);

function applyDesktopState(state) {
  suspended = state.gameMode || state.petHidden;
  document.body.classList.toggle('game-mode', state.gameMode);
  if (suspended) {
    ++helloSequence;
    document.body.classList.remove('controls-visible');
    closePicker();
    clearTimeout(controlsTimer);
    clearTimeout(expressionTimer);
    portrait.dataset.expression = '';
    stopVoice();
    clearTimeout(greetingTimer);
    clearTimeout(actionTimer);
    pet.classList.remove('action-greet', 'action-jump', 'action-sway');
    if (pointerId !== undefined && pet.hasPointerCapture(pointerId)) pet.releasePointerCapture(pointerId);
    pointerId = undefined;
    downAt = undefined;
    dragging = false;
    bubble.hidden = true;
    stickerDisplay.hidden = true;
    window.petApp.dragEnd();
  }
  if (!suspended) revealControls();
  ignoring = suspended;
  window.petApp.ignoreMouse(suspended);
  scheduleBlink();
  scheduleRestingExpression();
}

function notice(text, duration = 5000) {
  if (suspended) return;
  stickerDisplay.hidden = true;
  greeting.textContent = text;
  bubble.hidden = false;
  clearTimeout(greetingTimer);
  greetingTimer = setTimeout(() => { bubble.hidden = true; }, duration);
}
function applyPreferences(value) {
  preferences = value.preferences;
  document.documentElement.style.setProperty('--pet-width', value.displaySize.width + 'px');
  document.documentElement.style.setProperty('--pet-height', value.displaySize.height + 'px');
  if (audio) { audio.volume = preferences.volume; audio.muted = preferences.muted; }
  scheduleRestingExpression();
}
function animate(id) {
  if (sleeping || suspended) return;
  clearTimeout(actionTimer);
  pet.classList.remove('action-greet', 'action-jump', 'action-sway');
  void pet.offsetWidth;
  pet.classList.add('action-' + id);
  actionTimer = setTimeout(() => pet.classList.remove('action-' + id), 1100);
}
function stopVoice(report = true) {
  clearTimeout(speakingTimer);
  mouthOpen = false;
  renderExpression();
  if (!audio) return;
  audioSource?.disconnect();
  voiceGain?.disconnect();
  audioSource = voiceGain = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio = null;
  if (report) window.petApp.voiceStatus({ state: 'stopped', label: activeClip?.label });
  activeClip = null;
}
async function playVoice(clip) {
  if (suspended) return;
  stopVoice();
  activeClip = clip;
  const current = new Audio(clip.src);
  audio = current;
  current.volume = preferences.volume;
  current.muted = preferences.muted;
  try {
    audioContext ??= new AudioContext();
    audioSource = audioContext.createMediaElementSource(current);
    voiceGain = audioContext.createGain();
    voiceGain.gain.value = 10 ** ((clip.gainDb || 0) / 20);
    audioSource.connect(voiceGain).connect(audioContext.destination);
    await audioContext.resume();
    if (audio !== current) return;
  } catch { /* A system without Web Audio can still play the original recording. */ }
  current.onended = () => {
    if (audio !== current) return;
    if (stickerDisplay.hidden) bubble.hidden = true;
    window.petApp.voiceStatus({ state: 'ended', label: clip.label });
    stopVoice(false);
  };
  function failed() {
    if (audio !== current) return;
    notice('这条语音没有播放成功，检查一下音频文件吧。');
    window.petApp.voiceStatus({ state: 'error', label: clip.label });
    stopVoice(false);
  }
  current.onerror = failed;
  try {
    await current.play();
    if (audio !== current) return;
    if (clip.group === '唐笑') showExpression('laugh', 2000);
    if (clip.group === '唐哭') showExpression('teary', 2000);
    speakingTick();
    window.petApp.voiceStatus({ state: 'playing', label: clip.label });
    notice(clip.text || '♪ ' + clip.label, Math.max(1400, (clip.duration || 3) * 1000 + 500));
    animate('greet');
  } catch { failed(); }
}
async function sayHello() {
  if (!info || suspended) return;
  if (sleeping) { notice('休息中，右键可以叫醒我。'); return; }
  const sequence = ++helloSequence;
  stopVoice();
  bubble.hidden = true;
  stickerDisplay.hidden = true;
  animate('greet');
  clicks = Date.now() - lastClickAt < 4000 ? clicks + 1 : 1;
  lastClickAt = Date.now();
  const expression = clicks >= 5 ? 'annoyed' : clicks >= 3 ? 'pout' : 'shy';
  showExpression(expression, 1500);
  const wantVoice = preferences.clickVoice && !preferences.muted && preferences.volume > 0;
  const wantSticker = preferences.clickSticker && (!wantVoice || Math.random() < 0.25);
  if (wantSticker) {
    try { await window.petApp.executeInteraction({ type: 'randomSticker' }); return; }
    catch { /* If there are no images, try the voice pack instead. */ }
  }
  if (wantVoice && sequence === helloSequence && !suspended && !sleeping) {
    try {
      const voices = (await window.petApp.voices()).clips.filter(clip => clip.random !== false);
      if (sequence !== helloSequence || suspended || sleeping) return;
      const choices = voices.length > 1 ? voices.filter(clip => clip.id !== lastClickVoiceId) : voices;
      const clip = choices[Math.floor(Math.random() * choices.length)];
      lastClickVoiceId = clip?.id;
      if (clip) await window.petApp.executeInteraction({ type: 'playVoice', id: clip.id });
    } catch (error) { notice(error.message); }
  }
}
pet.addEventListener('pointerdown', event => {
  if (suspended || event.button !== 0) return;
  pointerId = event.pointerId;
  downAt = { x: event.screenX, y: event.screenY };
  dragging = false;
  pet.setPointerCapture(pointerId);
  window.petApp.dragStart();
});
pet.addEventListener('pointermove', event => {
  if (event.pointerId !== pointerId || !downAt) return;
  if (Math.abs(event.screenX - downAt.x) + Math.abs(event.screenY - downAt.y) > 5) dragging = true;
  if (dragging) window.petApp.dragMove({ x: event.movementX, y: event.movementY });
});
pet.addEventListener('pointerup', event => {
  if (event.pointerId !== pointerId) return;
  window.petApp.dragEnd();
  if (!dragging) void window.petApp.executeInteraction({ type: 'greet' }).catch(error => notice(error.message));
  else showExpression('surprised', 1300);
  downAt = undefined;
  pointerId = undefined;
});
pet.addEventListener('pointercancel', () => {
  window.petApp.dragEnd();
  downAt = undefined;
  pointerId = undefined;
});
pet.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    void window.petApp.executeInteraction({ type: 'greet' }).catch(error => notice(error.message));
  }
});
let ignoring = false;
window.addEventListener('mousemove', event => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const next = suspended || (!downAt && !target?.closest('button, .bubble, .sticker-picker'));
  if (next !== ignoring) {
    ignoring = next;
    window.petApp.ignoreMouse(next);
  }
});
pet.addEventListener('contextmenu', event => { event.preventDefault(); window.petApp.contextMenu(); });
document.querySelector('#open-chat').addEventListener('click', () => window.petApp.openChat());
document.querySelector('#open-settings').addEventListener('click', () => window.petApp.openSettings());
document.querySelector('#quit').addEventListener('click', () => window.petApp.quit());
pickerButton.addEventListener('click', () => { void openPicker(); });
document.querySelector('#close-picker').addEventListener('click', closePicker);
document.querySelector('#quick-random').addEventListener('click', () => { void sendSticker({ type: 'randomSticker' }); });
document.querySelector('#bubble-dismiss').addEventListener('click', () => {
  ++helloSequence;
  stopVoice();
  clearTimeout(greetingTimer);
  bubble.hidden = true;
  stickerDisplay.hidden = true;
  void window.petApp.stopVoice().catch(() => {});
  void window.petApp.hideSticker().catch(() => {});
});
window.addEventListener('keydown', event => { if (event.key === 'Escape') closePicker(); });
window.addEventListener('pointerdown', event => {
  if (!event.target.closest('.sticker-picker, #open-stickers')) closePicker();
});
window.petApp.onRename(name => { document.title = name; });
window.petApp.onExpression(id => showExpression(id, 2000));
window.petApp.onDesktopState(applyDesktopState);
window.petApp.onPreferences(applyPreferences);
window.petApp.onNotice(notice);
window.petApp.onSticker(sticker => {
  if (suspended) return;
  ++helloSequence;
  stopVoice();
  greeting.textContent = '';
  stickerDisplay.src = sticker.src;
  stickerDisplay.alt = sticker.label;
  stickerDisplay.hidden = false;
  bubble.hidden = false;
  clearTimeout(greetingTimer);
  greetingTimer = setTimeout(() => { stickerDisplay.hidden = true; bubble.hidden = true; }, 6500);
  animate('greet');
});
window.petApp.onHideSticker(() => { stickerDisplay.hidden = true; bubble.hidden = true; });
stickerDisplay.addEventListener('error', () => notice('这张表情包无法显示，请检查图片文件。'));
window.petApp.onAction(id => {
  if (id === 'greet') { void sayHello(); return; }
  if (id === 'jump') showExpression('happy', 950);
  if (id === 'sway') showExpression('smile', 1500);
  animate(id);
  notice({ greet: '蓝小妹在这里～', jump: '嘿！', sway: '晃一晃，放松一下。' }[id] || '');
});
window.petApp.onVoice(clip => { ++helloSequence; void playVoice(clip); });
window.petApp.onVoiceStop(() => {
  ++helloSequence;
  stopVoice();
  if (stickerDisplay.hidden) bubble.hidden = true;
});
window.petApp.onState(state => {
  clearTimeout(expressionTimer);
  portrait.dataset.expression = '';
  sleeping = state.sleeping;
  ++helloSequence;
  if (sleeping) closePicker();
  scheduleBlink();
  pet.classList.toggle('sleeping', sleeping);
  document.querySelector('#sleep').hidden = !sleeping;
  if (sleeping) stopVoice();
  notice(sleeping ? '先休息一会儿……' : '醒啦！');
});
async function load() {
  info = await window.petApp.info();
  document.title = info.name;
  pet.querySelector('img').src = '../' + info.image;
  normalSource = '../' + info.image;
  pet.querySelector('img').alt = info.name;
  pet.setAttribute('aria-label', '拖动' + info.name + '，点击和她打招呼');
  applyPreferences(info);
  sleeping = info.sleeping;
  pet.classList.toggle('sleeping', sleeping);
  document.querySelector('#sleep').hidden = !sleeping;
  applyDesktopState(await window.petApp.desktopState());
  revealControls();
  if (info.expressions) {
    const normal = new Image();
    normal.src = normalSource;
    try { await normal.decode(); } catch { /* Original image load reports through the element. */ }
    for (const [name, path] of Object.entries(info.expressions)) {
      const image = new Image();
      image.src = '../' + path;
      try {
        await image.decode();
        if (image.naturalWidth !== normal.naturalWidth || image.naturalHeight !== normal.naturalHeight) continue;
        decodedExpressions.set(name, image);
        if (name === 'blink') blinkSource = image.getAttribute('src');
      } catch { /* Optional expression failure keeps the original portrait usable. */ }
    }
    scheduleBlink();
  }
  notice(info.greetings[0]);
  // Occasional silent motion; no automatic audio or model requests.
  setInterval(() => {
    if (!suspended && preferences.idleActions && !sleeping && !downAt && !audio && Math.random() < 0.5) {
      const action = Math.random() < 0.35 ? 'jump' : 'sway';
      if (action === 'jump') showExpression('happy', 950);
      animate(action);
    }
  }, 45000);
}
void load().catch(error => notice(error.message));
