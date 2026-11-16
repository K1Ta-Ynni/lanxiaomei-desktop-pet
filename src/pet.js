const pet = document.querySelector('#pet');
const bubble = document.querySelector('#bubble');
const greeting = document.querySelector('#greeting');
const stickerDisplay = document.querySelector('#sticker');
let info, preferences, audio, activeClip;
let dragging = false, sleeping = false;
let pointerId, downAt, greetingTimer, actionTimer;
let lastVoiceAt = 0;

function notice(text) {
  stickerDisplay.hidden = true;
  greeting.textContent = text;
  bubble.hidden = false;
  clearTimeout(greetingTimer);
  greetingTimer = setTimeout(() => { bubble.hidden = true; }, 5000);
}
function applyPreferences(value) {
  preferences = value.preferences;
  document.documentElement.style.setProperty('--pet-width', value.displaySize.width + 'px');
  document.documentElement.style.setProperty('--pet-height', value.displaySize.height + 'px');
  if (audio) { audio.volume = preferences.volume; audio.muted = preferences.muted; }
}
function animate(id) {
  if (sleeping) return;
  clearTimeout(actionTimer);
  pet.classList.remove('action-greet', 'action-jump', 'action-sway');
  void pet.offsetWidth;
  pet.classList.add('action-' + id);
  actionTimer = setTimeout(() => pet.classList.remove('action-' + id), 1100);
}
function stopVoice(report = true) {
  if (!audio) return;
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
  stopVoice();
  activeClip = clip;
  const current = new Audio(clip.src);
  audio = current;
  current.volume = preferences.volume;
  current.muted = preferences.muted;
  current.onended = () => {
    if (audio !== current) return;
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
    lastVoiceAt = Date.now();
    window.petApp.voiceStatus({ state: 'playing', label: clip.label });
    notice(clip.text || '♪ ' + clip.label);
    animate('greet');
  } catch { failed(); }
}
async function sayHello() {
  if (!info) return;
  notice(sleeping ? '休息中，右键可以叫醒我。' : info.greetings[Math.floor(Math.random() * info.greetings.length)]);
  if (sleeping) return;
  animate('greet');
  if (preferences.clickVoice && !preferences.muted && preferences.volume > 0 && Date.now() - lastVoiceAt > 3000 && !audio) {
    try {
      const voices = (await window.petApp.voices()).clips;
      const clip = voices[Math.floor(Math.random() * voices.length)];
      if (clip) await window.petApp.executeInteraction({ type: 'playVoice', id: clip.id });
    } catch (error) { notice(error.message); }
  }
}
pet.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
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
  const next = !downAt && !target?.closest('button, .bubble');
  if (next !== ignoring) {
    ignoring = next;
    window.petApp.ignoreMouse(next);
  }
});
pet.addEventListener('contextmenu', event => { event.preventDefault(); window.petApp.contextMenu(); });
document.querySelector('#open-chat').addEventListener('click', () => window.petApp.openChat());
document.querySelector('#bubble-chat').addEventListener('click', () => window.petApp.openSettings());
document.querySelector('#open-settings').addEventListener('click', () => window.petApp.openSettings());
document.querySelector('#quit').addEventListener('click', () => window.petApp.quit());
window.petApp.onRename(name => { document.title = name; });
window.petApp.onPreferences(applyPreferences);
window.petApp.onNotice(notice);
window.petApp.onSticker(sticker => {
  greeting.textContent = sticker.label;
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
  animate(id);
  notice({ greet: '蓝小妹在这里～', jump: '嘿！', sway: '晃一晃，放松一下。' }[id] || '');
});
window.petApp.onVoice(clip => { void playVoice(clip); });
window.petApp.onVoiceStop(() => stopVoice());
window.petApp.onState(state => {
  sleeping = state.sleeping;
  pet.classList.toggle('sleeping', sleeping);
  document.querySelector('#sleep').hidden = !sleeping;
  if (sleeping) stopVoice();
  notice(sleeping ? '先休息一会儿……' : '醒啦！');
});
async function load() {
  info = await window.petApp.info();
  document.title = info.name;
  pet.querySelector('img').src = '../' + info.image;
  pet.querySelector('img').alt = info.name;
  pet.setAttribute('aria-label', '拖动' + info.name + '，点击和她打招呼');
  applyPreferences(info);
  sleeping = info.sleeping;
  pet.classList.toggle('sleeping', sleeping);
  document.querySelector('#sleep').hidden = !sleeping;
  notice(info.greetings[0]);
  // Occasional silent motion; no automatic audio or model requests.
  setInterval(() => {
    if (preferences.idleActions && !sleeping && !downAt && !audio && Math.random() < 0.5) animate('sway');
  }, 45000);
}
void load().catch(error => notice(error.message));
