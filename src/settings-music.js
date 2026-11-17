let state = { state: 'idle', position: 0, duration: 0 };
let seeking = false;
const seek = document.querySelector('#music-seek');
const result = document.querySelector('#music-result');
function time(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}
function failed(error) { result.textContent = error.message; result.className = 'result error'; }
async function control(action, extra = {}) {
  result.textContent = '';
  try {
    const value = await window.petApp.executeInteraction({ type: 'music', action, ...extra });
    if (value.empty) result.textContent = '歌单为空，先挑选或添加几首歌吧。';
  } catch (error) { failed(error); }
}
export function renderMusic(value) {
  state = value;
  document.querySelector('#music-title').textContent = value.label || '选一首喜欢的歌';
  const names = { idle: '歌曲会连续播放，关闭面板也能继续听。', loading: '正在打开歌曲…', playing: '正在播放', paused: '已暂停，点击继续播放', stopped: '已停止', ended: '播放完成', error: value.error || '播放失败，请检查音频文件。' };
  document.querySelector('#music-status').textContent = names[value.state] || '';
  document.querySelector('#music-toggle').textContent = value.state === 'playing' || value.state === 'loading' ? '暂停' : value.state === 'paused' ? '继续播放' : '播放';
  document.querySelector('#music-toggle').disabled = value.state === 'loading';
  document.querySelector('#record-disc').classList.toggle('playing', value.state === 'playing');
  seek.disabled = !['playing', 'paused'].includes(value.state) || !value.duration;
  seek.max = value.duration || 0;
  if (!seeking) seek.value = value.position || 0;
  document.querySelector('#music-position').textContent = time(seeking ? seek.value : value.position);
  document.querySelector('#music-duration').textContent = time(value.duration);
  for (const row of document.querySelectorAll('[data-music-selected]')) {
    row.classList.toggle('current-track', row.dataset.musicSelected === value.id);
    row.setAttribute('aria-pressed', String(row.dataset.musicSelected === value.id));
  }
}
window.petApp.onMusicState(renderMusic);
document.querySelector('#music-toggle').addEventListener('click', () => {
  void control(['playing', 'loading'].includes(state.state) ? 'pause' : state.state === 'paused' ? 'resume' : 'play');
});
for (const action of ['previous', 'next', 'stop']) document.querySelector('#music-' + action).addEventListener('click', () => { void control(action); });
seek.addEventListener('input', () => { seeking = true; document.querySelector('#music-position').textContent = time(seek.value); });
seek.addEventListener('change', () => { seeking = false; void control('seek', { position: Number(seek.value) }); });
seek.addEventListener('pointercancel', () => { seeking = false; renderMusic(state); });
let volumeSaving = Promise.resolve();
const volume = document.querySelector('#music-volume');
const mute = document.querySelector('#music-mute');
function renderVolumeValue(value) {
  volume.value = value;
  document.querySelector('#music-volume-value').textContent = Math.round(value * 100) + '%';
  document.querySelector('#volume').value = value;
  document.querySelector('#volume-value').textContent = Math.round(value * 100) + '%';
}
export function renderMusicVolume(preferences) {
  renderVolumeValue(preferences.volume);
  mute.setAttribute('aria-pressed', String(preferences.muted));
  mute.textContent = preferences.muted ? '取消静音' : '静音';
  document.querySelector('#volume').value = preferences.volume;
  document.querySelector('#volume-value').textContent = Math.round(preferences.volume * 100) + '%';
  document.querySelector('#muted').checked = preferences.muted;
}
volume.addEventListener('input', () => {
  const value = Number(volume.value);
  renderVolumeValue(value);
  window.petApp.previewVolume(value);
});
volume.addEventListener('change', () => {
  const value = Number(volume.value);
  volumeSaving = volumeSaving.catch(() => {}).then(() => window.petApp.savePreferences({ volume: value })).then(renderMusicVolume).catch(failed);
});
mute.addEventListener('click', () => {
  volumeSaving = volumeSaving.catch(() => {}).then(async () => {
    const preferences = await window.petApp.preferences();
    renderMusicVolume(await window.petApp.savePreferences({ muted: !preferences.muted }));
  }).catch(failed);
});
window.petApp.onVolume(renderVolumeValue);
