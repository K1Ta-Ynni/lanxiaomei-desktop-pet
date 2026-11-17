const pet = document.querySelector('#pet');
import { playlistItems, defaultVoiceSelection, PlaylistPlayer } from './playlist.js';
import { isSong } from './music.js';
import { singerMode } from './pet-music.js';

const bubble = document.querySelector('#bubble');
const greeting = document.querySelector('#greeting');
const stickerDisplay = document.querySelector('#sticker');
const stickerPicker = document.querySelector('#sticker-picker');
const pickerButton = document.querySelector('#open-stickers');
const musicPicker = document.querySelector('#music-picker');
const musicPickerButton = document.querySelector('#open-music');
let info, preferences, audio, activeClip;
let dragging = false, sleeping = false;
let pointerId, downAt, greetingTimer, actionTimer;
let helloSequence = 0;
let audioContext, audioSource, voiceGain;
let suspended = false;
let clickThrough = false;
const portrait = pet.querySelector('img');
let blinkSource, normalSource, blinkTimer, blinkEndTimer, expressionTimer, blinking = false;
const decodedExpressions = new Map();
const expressionPaths = new Map();
const expressionLoads = new Map();
let normalDimensions, expressionSequence = 0, expressionCacheEpoch = 0;
function resourceOption(key) { return !preferences?.lowResourceMode && preferences?.[key]; }
let controlsTimer;
let restingExpression = 'normal', restingTimer, speakingTimer, mouthOpen = false;
let restingPlaylistKey;
const restingPlayer = new PlaylistPlayer();
let musicFrameSource, musicFrameTimer, musicFrameLoad, musicAnimationSequence = 0;
let clicks = 0, lastClickAt = 0;

function closePicker() {
  stickerPicker.hidden = true;
  pickerButton.setAttribute('aria-expanded', 'false');
  revealControls();
}
function closeMusicPicker() {
  musicPicker.hidden = true;
  musicPickerButton.setAttribute('aria-expanded', 'false');
  revealControls();
}
async function playSelectedSong(id) {
  try {
    await window.petApp.executeInteraction({ type: 'music', action: 'play', id });
    closeMusicPicker();
  } catch (error) { notice(error.message); }
}
async function openMusicPicker() {
  if (suspended) return;
  if (!musicPicker.hidden) { closeMusicPicker(); return; }
  closePicker();
  musicPicker.hidden = false;
  musicPickerButton.setAttribute('aria-expanded', 'true');
  const list = document.querySelector('#quick-music');
  list.replaceChildren();
  const status = document.querySelector('#music-picker-status');
  status.textContent = '正在读取…';
  try {
    const [catalog, prefs, current] = await Promise.all([window.petApp.voices(), window.petApp.preferences(), window.petApp.musicStatus()]);
    if (musicPicker.hidden || suspended) return;
    const songs = playlistItems(catalog.clips.filter(isSong), prefs.musicPlaylist);
    status.textContent = songs.length ? '点选歌曲即可开始播放' : '歌曲列表为空，请先在互动设置中添加歌曲。';
    for (const song of songs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.song = song.id;
      button.setAttribute('aria-current', String(song.id === current.id));
      const icon = document.createElement('span');
      icon.textContent = song.id === current.id && ['playing', 'paused'].includes(current.state) ? '♫' : '▶';
      const label = document.createElement('span');
      label.textContent = song.label;
      button.title = song.label;
      button.append(icon, label);
      button.addEventListener('click', () => { void playSelectedSong(song.id); });
      list.append(button);
    }
  } catch (error) { status.textContent = error.message; }
}
async function sendSticker(command) {
  try {
    const result = await window.petApp.executeInteraction(command);
    if (result.empty) { document.querySelector('#picker-status').textContent = '互动列表为空，请在设置面板勾选表情包。'; return; }
    closePicker();
  }
  catch (error) { notice(error.message); }
}
async function openPicker() {
  if (suspended) return;
  if (!stickerPicker.hidden) { closePicker(); return; }
  closeMusicPicker();
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
  const catalog = ['normal', ...Object.keys(info?.expressions || {})].map(id => ({ id }));
  const playlist = preferences?.expressionPlaylist || { mode: 'random', ids: null };
  const defaultSelected = item => (info?.idleExpressions || ['normal']).includes(item.id);
  const choices = playlistItems(catalog, playlist, defaultSelected);
  const key = JSON.stringify([playlist.mode, choices.map(item => item.id)]);
  if (key !== restingPlaylistKey) {
    restingPlaylistKey = key;
    restingExpression = restingPlayer.next(catalog, playlist, defaultSelected)?.id || 'normal';
  }
  if (!choices.length) restingExpression = 'normal';
  renderExpression();
  if (suspended || preferences?.lowResourceMode || choices.length <= 1 || playlist.mode === 'repeat') return;
  restingTimer = setTimeout(() => {
    if (!sleeping && !audio && !downAt && !portrait.dataset.expression) {
      restingExpression = restingPlayer.next(catalog, playlist, defaultSelected)?.id || 'normal';
    }
    scheduleRestingExpression();
  }, 30000 + Math.random() * 30000);
}

function speakingTick() {
  clearTimeout(speakingTimer);
  if (!resourceOption('talkAnimation') || !audio || activeClip?.kind === 'music' || audio.paused || suspended || sleeping) { mouthOpen = false; renderExpression(); return; }
  mouthOpen = !mouthOpen;
  renderExpression();
  speakingTimer = setTimeout(speakingTick, mouthOpen ? 170 + Math.random() * 150 : 110 + Math.random() * 130);
}

function musicPlaying() {
  return activeClip?.kind === 'music' && audio && !audio.paused && !audio.ended && !sleeping && !suspended;
}
async function syncMusicAnimation() {
  const sequence = ++musicAnimationSequence;
  clearTimeout(musicFrameTimer);
  if (!musicPlaying()) {
    musicFrameSource = undefined;
    musicFrameLoad = undefined;
    renderExpression();
    return;
  }
  if (!normalDimensions) return;
  const still = preferences.lowResourceMode || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!musicFrameLoad || musicFrameLoad.still !== still) {
    const configured = (info?.musicAnimation || []).filter(frame => frame.file && Number.isFinite(frame.duration) && frame.duration >= 80);
    const frames = still ? configured.slice(0, 1) : configured;
    // Keep these decoded images only during playback, separate from idle expressions.
    const images = new Map();
    musicFrameLoad = { still, promise: Promise.all(frames.map(async frame => {
      if (!images.has(frame.file)) images.set(frame.file, (async () => {
        const image = new Image();
        image.src = '../' + frame.file;
        await image.decode();
        if (image.naturalWidth !== normalDimensions?.width || image.naturalHeight !== normalDimensions?.height) throw new Error('Music frame dimensions differ');
        return image;
      })());
      return { image: await images.get(frame.file), duration: frame.duration };
    })).catch(() => []) };
  }
  const frames = await musicFrameLoad.promise;
  if (sequence !== musicAnimationSequence || !musicPlaying()) return;
  if (!frames.length) { musicFrameSource = undefined; renderExpression(); return; }
  const cycle = frames.reduce((total, frame) => total + frame.duration, 0);
  function tick() {
    if (sequence !== musicAnimationSequence || !musicPlaying()) return;
    // Follow playback time so seeks and pauses cannot accumulate timing drift.
    let position = still ? 0 : (audio.currentTime * 1000) % cycle;
    const frame = frames.find(frame => {
      if (position < frame.duration) return true;
      position -= frame.duration;
      return false;
    }) || frames[0];
    musicFrameSource = frame.image.getAttribute('src');
    renderExpression();
    if (!still) musicFrameTimer = setTimeout(tick, Math.max(16, frame.duration - position));
  }
  tick();
}

function renderExpression() {
  if (!normalSource) return;
  if (!sleeping && !suspended && !portrait.dataset.expression && musicFrameSource) {
    if (portrait.getAttribute('src') !== musicFrameSource) portrait.src = musicFrameSource;
    return;
  }
  const name = sleeping ? 'blink' : suspended ? 'normal' : portrait.dataset.expression || (blinking ? 'blink' : mouthOpen ? 'talk' : restingExpression);
  const source = decodedExpressions.get(name)?.getAttribute('src') || normalSource;
  if (portrait.getAttribute('src') !== source) portrait.src = source;
  if (source === normalSource && expressionPaths.has(name)) void decodeExpression(name).then(image => { if (image && !portrait.dataset.expression && !blinking) renderExpression(); });
}
async function decodeExpression(name) {
  if (decodedExpressions.has(name)) return decodedExpressions.get(name);
  if (expressionLoads.has(name)) return expressionLoads.get(name);
  const path = expressionPaths.get(name);
  if (!path) return null;
  const cacheEpoch = expressionCacheEpoch;
  const promise = (async () => {
    const image = new Image(); image.src = '../' + path;
    try {
      await image.decode();
      if (image.naturalWidth !== normalDimensions?.width || image.naturalHeight !== normalDimensions?.height) return null;
      if (cacheEpoch !== expressionCacheEpoch) return null;
      decodedExpressions.set(name, image);
      if (!resourceOption('preloadExpressions')) while (decodedExpressions.size > 2) decodedExpressions.delete(decodedExpressions.keys().next().value);
      if (name === 'blink') blinkSource = image.getAttribute('src');
      return image;
    } catch { return null; }
    finally { expressionLoads.delete(name); }
  })();
  expressionLoads.set(name, promise);
  return promise;
}
async function preloadExpressionImages() {
  await Promise.all([...expressionPaths.keys()].map(name => decodeExpression(name)));
}
function showExpression(name, duration = 1100) {
  if (suspended || sleeping) return;
  const sequence = ++expressionSequence;
  if (name !== 'normal' && !decodedExpressions.has(name)) {
    void decodeExpression(name).then(image => { if (image && sequence === expressionSequence) showExpression(name, duration); });
    return;
  }
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
  if (!resourceOption('autoBlink') || sleeping || suspended || musicPlaying() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  blinkTimer = setTimeout(() => {
    void decodeExpression('blink').then(image => {
      if (!image || !resourceOption('autoBlink') || sleeping || suspended || musicPlaying()) return;
      blinking = true;
      renderExpression();
      blinkEndTimer = setTimeout(scheduleBlink, 150);
    });
  }, 3000 + Math.random() * 4000);
}
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { scheduleBlink(); void syncMusicAnimation(); });

function revealControls() {
  if (suspended) return;
  document.body.classList.add('controls-visible');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    if (document.querySelector('.pet-tools:hover, .pet-tools :focus-visible, .pet-tools :active')) {
      revealControls();
      return;
    }
    if (stickerPicker.hidden && musicPicker.hidden) document.body.classList.remove('controls-visible');
  }, 2600);
}
window.addEventListener('mousemove', revealControls, { passive: true });
window.addEventListener('pointerdown', revealControls, { passive: true });
window.addEventListener('keydown', revealControls);
document.querySelector('.pet-tools').addEventListener('focusin', revealControls);
document.querySelector('.pet-tools').addEventListener('focusout', revealControls);

function applyDesktopState(state) {
  suspended = state.petHidden;
  clickThrough = state.gameMode || state.petHidden;
  document.body.classList.toggle('game-mode', state.gameMode);
  if (suspended) {
    ++helloSequence;
    document.body.classList.remove('controls-visible');
    closePicker();
    closeMusicPicker();
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
  if (clickThrough && downAt) {
    if (pointerId !== undefined && pet.hasPointerCapture(pointerId)) pet.releasePointerCapture(pointerId);
    pointerId = undefined;
    downAt = undefined;
    dragging = false;
    window.petApp.dragEnd();
  }
  if (!suspended) revealControls();
  ignoring = clickThrough;
  window.petApp.ignoreMouse(clickThrough);
  scheduleBlink();
  scheduleRestingExpression();
  void syncMusicAnimation();
}

function notice(text, duration = 5000) {
  if (suspended) return;
  bubble.classList.remove('chat-reply');
  greeting.title = '';
  stickerDisplay.hidden = true;
  greeting.textContent = text;
  bubble.hidden = false;
  clearTimeout(greetingTimer);
  greetingTimer = setTimeout(() => { bubble.hidden = true; }, duration);
}
function applyPreferences(value) {
  const wasPreloading = preferences ? resourceOption('preloadExpressions') : undefined;
  const wasBlinking = resourceOption('autoBlink');
  const wasTalking = resourceOption('talkAnimation');
  preferences = value.preferences;
  document.body.classList.toggle('low-resource', !resourceOption('animateIdle'));
  document.documentElement.style.setProperty('--pet-width', value.displaySize.width + 'px');
  document.documentElement.style.setProperty('--pet-height', value.displaySize.height + 'px');
  document.querySelector('#music-widget').dataset.density = preferences.scale < 0.85 ? 'compact' : preferences.scale < 1.2 ? 'standard' : 'full';
  if (audio) { audio.volume = preferences.volume; audio.muted = preferences.muted; }
  if (wasPreloading !== undefined && wasPreloading !== resourceOption('preloadExpressions')) {
    if (resourceOption('preloadExpressions')) void preloadExpressionImages().then(() => { scheduleBlink(); scheduleRestingExpression(); });
    else {
      expressionCacheEpoch++;
      expressionSequence++;
      expressionLoads.clear();
      decodedExpressions.clear(); blinkSource = undefined; portrait.dataset.expression = '';
      renderExpression(); scheduleBlink(); scheduleRestingExpression();
    }
  }
  if (wasBlinking !== resourceOption('autoBlink')) scheduleBlink();
  if (wasTalking !== resourceOption('talkAnimation')) speakingTick();
  scheduleRestingExpression();
  void syncMusicAnimation();
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
  if (!audio) { void syncMusicAnimation(); return; }
  audioSource?.disconnect();
  voiceGain?.disconnect();
  audioSource = voiceGain = null;
  audio.onended = null;
  audio.onerror = null;
  audio.ontimeupdate = audio.onloadedmetadata = audio.onpause = audio.onplay = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio = null;
  if (report) window.petApp.voiceStatus({ state: 'stopped', label: activeClip?.label, kind: activeClip?.kind, token: activeClip?.token });
  activeClip = null;
  void syncMusicAnimation();
  scheduleBlink();
}
async function playVoice(clip) {
  if (suspended) return;
  stopVoice();
  activeClip = clip;
  const current = new Audio(clip.src);
  audio = current;
  current.volume = preferences.volume;
  current.muted = preferences.muted;
  function report(state) {
    if (audio !== current) return;
    window.petApp.voiceStatus({ state, label: clip.label, kind: clip.kind, token: clip.token,
      position: current.currentTime, duration: Number.isFinite(current.duration) ? current.duration : clip.duration || 0 });
  }
  if (clip.kind === 'music') {
    current.ontimeupdate = () => report(current.paused ? 'paused' : 'playing');
    current.onloadedmetadata = () => report(current.paused ? 'loading' : 'playing');
    current.onpause = () => { report('paused'); speakingTick(); void syncMusicAnimation(); scheduleBlink(); };
    current.onplay = () => { report('playing'); speakingTick(); void syncMusicAnimation(); scheduleBlink(); };
  }
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
    report('ended');
    stopVoice(false);
  };
  function failed() {
    if (audio !== current) return;
    notice('这条语音没有播放成功，检查一下音频文件吧。');
    report('error');
    stopVoice(false);
  }
  current.onerror = failed;
  try {
    await current.play();
    if (audio !== current) return;
    if (clip.kind !== 'music' && clip.group === '唐笑') showExpression('laugh', 2000);
    if (clip.kind !== 'music' && clip.group === '唐哭') showExpression('teary', 2000);
    speakingTick();
    report('playing');
    if (clip.kind !== 'music') notice(clip.text || '♪ ' + clip.label, Math.max(1400, (clip.duration || 3) * 1000 + 500));
    if (clip.kind !== 'music') animate('greet');
  } catch { failed(); }
}
async function sayHello() {
  if (!info || suspended) return;
  if (sleeping) { notice('休息中，右键可以叫醒我。'); return; }
  if (activeClip?.kind === 'music' || singerMode()) {
    if (preferences.clickSticker) {
      try { await window.petApp.executeInteraction({ type: 'nextSticker' }); }
      catch { /* Singer mode never falls back to voice. */ }
    }
    return;
  }
  const sequence = ++helloSequence;
  stopVoice();
  bubble.hidden = true;
  stickerDisplay.hidden = true;
  animate('greet');
  clicks = Date.now() - lastClickAt < 4000 ? clicks + 1 : 1;
  lastClickAt = Date.now();
  const expression = clicks >= 5 ? 'annoyed' : clicks >= 3 ? 'pout' : 'shy';
  showExpression(expression, 1500);
  // Muting silences the audio element but keeps the voice interaction, subtitle, and mouth animation.
  let wantVoice = preferences.clickVoice;
  if (wantVoice) {
    try {
      const { clips } = await window.petApp.voices();
      if (sequence !== helloSequence || suspended || sleeping) return;
      wantVoice = playlistItems(clips, preferences.voicePlaylist, defaultVoiceSelection).length > 0;
    } catch { wantVoice = false; }
  }
  if (sequence !== helloSequence || suspended || sleeping) return;
  const wantSticker = preferences.clickSticker && (!wantVoice || Math.random() < 0.25);
  if (wantSticker) {
    try {
      const result = await window.petApp.executeInteraction({ type: 'nextSticker' });
      if (!result.empty) return;
    }
    catch { /* If there are no images, try the voice pack instead. */ }
  }
  if (wantVoice && sequence === helloSequence && !suspended && !sleeping) {
    try {
      await window.petApp.executeInteraction({ type: 'nextVoice' });
    } catch (error) { notice(error.message); }
  }
}
pet.addEventListener('pointerdown', event => {
  if (clickThrough || event.button !== 0) return;
  pointerId = event.pointerId;
  downAt = { x: event.screenX, y: event.screenY };
  dragging = false;
  pet.setPointerCapture(pointerId);
  window.petApp.dragStart();
});
pet.addEventListener('pointermove', event => {
  if (event.pointerId !== pointerId || !downAt) return;
  if (Math.abs(event.screenX - downAt.x) + Math.abs(event.screenY - downAt.y) > 5) dragging = true;
  if (dragging) window.petApp.dragMove();
});
pet.addEventListener('pointerup', event => {
  if (event.pointerId !== pointerId) return;
  window.petApp.dragEnd();
  if (!dragging) void window.petApp.executeInteraction({ type: 'greet' }).catch(error => notice(error.message));
  else showExpression(Math.random() < 0.5 ? 'surprised' : 'confused', 1300);
  downAt = undefined;
  pointerId = undefined;
});
pet.addEventListener('pointercancel', () => {
  window.petApp.dragEnd();
  downAt = undefined;
  pointerId = undefined;
});
pet.addEventListener('lostpointercapture', () => {
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
let ignoring = false, ignoreTimer;
window.addEventListener('mousemove', event => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const next = clickThrough || (!downAt && !target?.closest('button, .pet-tools, .bubble, .sticker-picker, .music-widget'));
  clearTimeout(ignoreTimer);
  if (next === ignoring) return;
  if (!next) {
    ignoring = false;
    window.petApp.ignoreMouse(false);
  } else {
    // Keep the gaps between controls interactive and avoid toggling the native
    // window to click-through during their tiny hover/appearance transitions.
    ignoreTimer = setTimeout(() => { ignoring = true; window.petApp.ignoreMouse(true); }, 40);
  }
});
pet.addEventListener('contextmenu', event => { event.preventDefault(); window.petApp.contextMenu(); });
document.querySelector('#open-chat').addEventListener('click', () => window.petApp.openChat());
document.querySelector('#open-settings').addEventListener('click', () => window.petApp.openSettings());
document.querySelector('#quit').addEventListener('click', () => window.petApp.quit());
pickerButton.addEventListener('click', () => { void openPicker(); });
musicPickerButton.addEventListener('click', () => { void openMusicPicker(); });
document.querySelector('#close-picker').addEventListener('click', closePicker);
document.querySelector('#close-music-picker').addEventListener('click', closeMusicPicker);
document.querySelector('#quick-random').addEventListener('click', () => { void sendSticker({ type: 'nextSticker' }); });
document.querySelector('#bubble-dismiss').addEventListener('click', () => {
  ++helloSequence;
  const keepMusic = activeClip?.kind === 'music' || singerMode();
  if (!keepMusic) stopVoice();
  clearTimeout(greetingTimer);
  bubble.hidden = true;
  stickerDisplay.hidden = true;
  if (!keepMusic) void window.petApp.stopVoice().catch(() => {});
  void window.petApp.hideSticker().catch(() => {});
});
window.addEventListener('keydown', event => { if (event.key === 'Escape') { closePicker(); closeMusicPicker(); } });
window.addEventListener('pointerdown', event => {
  if (!event.target.closest('#sticker-picker, #open-stickers')) closePicker();
  if (!event.target.closest('#music-picker, #open-music')) closeMusicPicker();
});
window.petApp.onRename(name => { document.title = name; });
window.petApp.onExpression(id => showExpression(id, 2000));
window.petApp.onDesktopState(applyDesktopState);
window.petApp.onPreferences(applyPreferences);
window.petApp.onVolume(value => { preferences.volume = value; if (audio) audio.volume = value; });
window.petApp.onNotice(notice);
window.petApp.onChatReply(reply => {
  notice(reply.text + (reply.truncated ? '…' : ''), 10000);
  bubble.classList.add('chat-reply');
  greeting.title = '双击查看完整聊天';
});
function applySpeechState(state) {
  const indicator = document.querySelector('#speech-indicator');
  indicator.hidden = !state.running;
  indicator.textContent = state.options?.mode === 'continuous' ? '● 连续听写 · 停止' : '● 等待唤醒 · 停止';
}
window.petApp.onSpeech(applySpeechState);
document.querySelector('#speech-indicator').addEventListener('click', () => { void window.petApp.stopSpeech(); });
greeting.addEventListener('dblclick', () => { if (bubble.classList.contains('chat-reply')) window.petApp.openChat(); });
window.petApp.onSticker(sticker => {
  if (suspended) return;
  bubble.classList.remove('chat-reply');
  ++helloSequence;
  if (activeClip?.kind !== 'music') stopVoice();
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
window.petApp.onMusicControl(command => {
  if (!audio || activeClip?.kind !== 'music' || activeClip.token !== command.token) return;
  if (command.action === 'stop') { stopVoice(); if (stickerDisplay.hidden) bubble.hidden = true; }
  else if (command.action === 'pause') audio.pause();
  else if (command.action === 'resume') {
    const current = audio;
    void current.play().catch(() => {
      if (audio !== current) return;
      window.petApp.voiceStatus({ state: 'error', kind: 'music', token: command.token });
      stopVoice(false);
    });
  } else if (command.action === 'seek' && Number.isFinite(audio.duration)) {
    audio.currentTime = Math.max(0, Math.min(command.position, audio.duration));
    void syncMusicAnimation();
  }
});
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
  const startupSequence = helloSequence;
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
  applySpeechState(await window.petApp.speechStatus());
  revealControls();
  if (info.expressions) {
    const normal = new Image();
    normal.src = normalSource;
    try { await normal.decode(); } catch { /* Original image load reports through the element. */ }
    normalDimensions = { width: normal.naturalWidth, height: normal.naturalHeight };
    for (const [name, path] of Object.entries(info.expressions)) expressionPaths.set(name, path);
    if (resourceOption('preloadExpressions')) await preloadExpressionImages();
    scheduleBlink();
    void syncMusicAnimation();
  }
  if (startupSequence === helloSequence && !suspended && !sleeping && !audio) {
    notice(info.greetings[0]);
    try {
      const { clips } = await window.petApp.voices();
      const entrances = clips.filter(clip => clip.group === '入场语音' && !isSong(clip));
      if (entrances.length && startupSequence === helloSequence && !suspended && !sleeping && !audio) {
        const clip = entrances[Math.floor(Math.random() * entrances.length)];
        await window.petApp.playVoice(clip.id);
      }
    } catch { /* Missing entrance recordings retain the text greeting. */ }
  }
  // After the entrance, idle motions stay silent and make no model requests.
  setInterval(() => {
    if (!suspended && !preferences.lowResourceMode && preferences.idleActions && !sleeping && !downAt && !audio && Math.random() < 0.5) {
      const action = Math.random() < 0.35 ? 'jump' : 'sway';
      if (action === 'jump') showExpression('happy', 950);
      animate(action);
    }
  }, 45000);
}
void load().catch(error => notice(error.message));
