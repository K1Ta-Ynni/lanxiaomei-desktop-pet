const widget = document.querySelector('#music-widget');
const title = document.querySelector('#music-widget-title');
const toggle = document.querySelector('#music-widget-toggle');
const progress = document.querySelector('#music-widget-progress');
const modeButton = document.querySelector('#music-widget-mode');
const volume = document.querySelector('#music-widget-volume');
const volumeValue = document.querySelector('#music-widget-volume-value');
let state = { state: 'idle', mode: 'sequence' };
let hideTimer, pointer, changingMode = false, seeking = false, savingVolume = false;
export function singerMode() { return ['loading', 'playing', 'paused'].includes(state.state); }

function hover(event) {
  if (event) pointer = { x: event.clientX, y: event.clientY };
  const target = pointer && document.elementFromPoint(pointer.x, pointer.y);
  const active = singerMode() && !document.body.classList.contains('game-mode');
  const over = active && target?.closest('#pet, .music-widget') && document.querySelector('#sticker-picker').hidden;
  if (over) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    document.body.classList.add('music-hover');
  } else if (!hideTimer) hideTimer = setTimeout(() => {
    hideTimer = undefined;
    document.body.classList.remove('music-hover');
  }, 550);
}
function render(value) {
  state = value;
  const active = singerMode();
  widget.hidden = !active;
  widget.dataset.state = value.state;
  document.body.classList.toggle('singer-mode', active);
  title.textContent = '♫ ' + (value.label || '正在打开歌曲…');
  title.title = value.label || '';
  progress.max = value.duration || 1;
  if (!seeking) progress.value = Math.min(value.position || 0, value.duration || 1);
  const paused = value.state === 'paused';
  toggle.textContent = paused ? '▶' : 'Ⅱ';
  toggle.title = paused ? '播放' : '暂停';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.disabled = value.state === 'loading';
  const names = { sequence: '顺序', random: '随机', repeat: '单曲' };
  modeButton.textContent = names[value.mode] || names.sequence;
  modeButton.title = '当前：' + modeButton.textContent + '播放；点击切换模式';
  if (!active) document.body.classList.remove('music-hover');
  else hover();
}
async function control(action, extra = {}) {
  try { await window.petApp.executeInteraction({ type: 'music', action, ...extra }); }
  catch (error) { title.textContent = error.message; title.title = error.message; }
}
toggle.addEventListener('click', () => { void control(state.state === 'paused' ? 'resume' : 'pause'); });
for (const action of ['previous', 'next']) document.querySelector('#music-widget-' + action).addEventListener('click', () => { void control(action); });
document.querySelector('#music-widget-stop').addEventListener('click', () => { void control('stop'); });
progress.addEventListener('input', () => { seeking = true; });
progress.addEventListener('change', () => {
  seeking = false;
  void control('seek', { position: Number(progress.value) });
});
progress.addEventListener('pointercancel', () => { seeking = false; render(state); });
function renderVolume(preferences) {
  volume.value = preferences.volume;
  volumeValue.value = Math.round(preferences.volume * 100) + '%';
  volumeValue.textContent = volumeValue.value;
  volume.setAttribute('aria-valuetext', volumeValue.value);
}
volume.addEventListener('input', () => {
  const value = Number(volume.value);
  volumeValue.value = Math.round(value * 100) + '%';
  volumeValue.textContent = volumeValue.value;
  volume.setAttribute('aria-valuetext', volumeValue.value);
  window.petApp.previewVolume(value);
});
volume.addEventListener('change', async () => {
  if (savingVolume) return;
  savingVolume = true;
  try { renderVolume(await window.petApp.savePreferences({ volume: Number(volume.value) })); }
  catch (error) { title.textContent = error.message; }
  finally { savingVolume = false; }
});
modeButton.addEventListener('click', async () => {
  if (changingMode) return;
  changingMode = true;
  modeButton.disabled = true;
  try {
    const prefs = await window.petApp.preferences();
    const mode = { sequence: 'random', random: 'repeat', repeat: 'sequence' }[prefs.musicPlaylist.mode];
    await window.petApp.executeInteraction({ type: 'setPlaylist', kind: 'music', playlist: { ...prefs.musicPlaylist, mode } });
  } catch (error) { title.title = error.message; }
  finally { changingMode = false; modeButton.disabled = false; }
});
window.addEventListener('mousemove', hover, { passive: true });
window.addEventListener('mouseout', event => {
  if (!event.relatedTarget) { pointer = undefined; hover(); }
});
window.addEventListener('blur', () => { pointer = undefined; hover(); });
window.petApp.onMusicState(render);
window.petApp.onPreferences(({ preferences }) => renderVolume(preferences));
window.petApp.onVolume(value => renderVolume({ volume: value }));
void window.petApp.musicStatus().then(render).catch(() => {});
void window.petApp.preferences().then(renderVolume).catch(() => {});
