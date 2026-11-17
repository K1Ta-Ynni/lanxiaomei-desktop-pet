const result = document.querySelector('#result');
import { DEFAULT_PLAYLIST, playlistItems, defaultVoiceSelection } from './playlist.js';
import { isSong } from './music.js';
import './settings-nav.js';
import { renderMusic, renderMusicVolume } from './settings-music.js';

const voiceResult = document.querySelector('#voice-result');
const actionResult = document.querySelector('#action-result');
const stickerResult = document.querySelector('#sticker-result');
const scale = document.querySelector('#scale');
let scaleEditing = false;
const volume = document.querySelector('#volume');
let clips = [];
let stickers = [];
const playlistState = { voice: DEFAULT_PLAYLIST, sticker: DEFAULT_PLAYLIST, music: { mode: 'sequence', ids: null } };
let playlistSaving = Promise.resolve();
function renderPerformanceControls() {
  const reduced = document.querySelector('#lowResourceMode').checked;
  for (const key of ['animateIdle', 'autoBlink', 'talkAnimation', 'preloadExpressions']) document.getElementById(key).disabled = reduced;
}
document.querySelector('#lowResourceMode').addEventListener('change', renderPerformanceControls);

function playlistCatalog(kind) { return kind === 'sticker' ? stickers : kind === 'music' ? clips.filter(isSong) : clips; }
function playlistDefault(kind) { return kind === 'voice' ? defaultVoiceSelection : () => true; }
function renderPlaylist(kind) {
  const current = playlistState[kind];
  const catalog = playlistCatalog(kind);
  const selected = playlistItems(catalog, current, playlistDefault(kind));
  document.querySelector('#' + kind + '-playlist-mode').value = current.mode;
  for (const checkbox of document.querySelectorAll('[data-' + kind + '-playlist]')) {
    const index = selected.findIndex(item => item.id === checkbox.dataset[kind + 'Playlist']);
    checkbox.checked = index >= 0;
    checkbox.nextSibling.textContent = index < 0 ? '加入互动列表' : '列表第 ' + (index + 1) + ' 项';
  }
  show(document.querySelector('#' + kind + '-playlist-status'), `已选 ${selected.length} / ${catalog.length} 项${selected.length ? '' : '，互动时跳过此列表'}。`);
  const box = document.querySelector('#' + kind + '-selected');
  document.querySelector('#' + kind + '-selected-count').textContent = selected.length;
  box.replaceChildren();
  if (!selected.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '列表还是空的，去左边挑几项吧。';
    box.append(empty);
  }
  for (const [index, item] of selected.entries()) {
    const row = document.createElement('div');
    row.className = 'selected-row';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'selected-play';
    play.dataset[kind + 'Selected'] = item.id;
    if (kind === 'sticker') {
      const image = document.createElement('img');
      image.src = item.src;
      image.alt = item.label;
      image.loading = 'lazy';
      play.append(image);
    }
    const label = document.createElement('span');
    label.textContent = String(index + 1).padStart(2, '0') + ' · ' + item.label;
    play.append(label);
    play.title = '播放 / 展示：' + item.label;
    play.addEventListener('click', async () => {
      try {
        await playlistSaving;
        await window.petApp.executeInteraction(kind === 'music' ? { type: 'music', action: 'play', id: item.id } : { type: kind === 'voice' ? 'playVoice' : 'showSticker', id: item.id });
      } catch (error) { show(document.querySelector('#' + kind + '-playlist-status'), error.message, true); }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-item';
    remove.textContent = '×';
    remove.setAttribute('aria-label', '从列表移除' + item.label);
    remove.dataset[kind + 'Remove'] = item.id;
    remove.addEventListener('click', () => updatePlaylist(kind, current => ({ ...current,
      ids: playlistItems(playlistCatalog(kind), current, playlistDefault(kind)).filter(row => row.id !== item.id).map(row => row.id) })));
    row.append(play, remove);
    box.append(row);
  }
}
function updatePlaylist(kind, change) {
  playlistSaving = playlistSaving.catch(() => {}).then(async () => {
    const preferences = await window.petApp.preferences();
    const next = change(preferences[kind + 'Playlist']);
    const saved = await window.petApp.executeInteraction({ type: 'setPlaylist', kind, playlist: next });
    playlistState[kind] = saved[kind + 'Playlist'];
    renderPlaylist(kind);
  }).catch(error => {
    renderPlaylist(kind);
    show(document.querySelector('#' + kind + '-playlist-status'), error.message, true);
  });
}
function playlistCheckbox(kind, item) {
  const label = document.createElement('label');
  label.className = 'check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset[kind + 'Playlist'] = item.id;
  checkbox.setAttribute('aria-label', '将' + item.label + '加入互动列表');
  const text = document.createElement('span');
  label.append(checkbox, text);
  checkbox.addEventListener('change', () => {
    const checked = checkbox.checked;
    updatePlaylist(kind, current => {
      const ids = new Set(current.ids ?? playlistCatalog(kind).filter(playlistDefault(kind)).map(item => item.id));
      if (checked) ids.add(item.id); else ids.delete(item.id);
      return { ...current, ids: [...ids] };
    });
  });
  return label;
}
for (const kind of ['voice', 'sticker', 'music']) {
  document.querySelector('#' + kind + '-playlist-mode').addEventListener('change', event => {
    const mode = event.target.value;
    updatePlaylist(kind, current => ({ ...current, mode }));
  });
  document.querySelector('#' + kind + '-playlist-default').addEventListener('click', () => updatePlaylist(kind, current => ({ ...current, ids: null })));
  document.querySelector('#' + kind + '-playlist-clear').addEventListener('click', () => updatePlaylist(kind, current => ({ ...current, ids: [] })));
}
document.querySelector('#voice-playlist-all').addEventListener('click', () => updatePlaylist('voice', current => ({ ...current, ids: clips.map(clip => clip.id) })));
document.querySelector('#voice-playlist-next').addEventListener('click', async () => {
  try {
    await playlistSaving;
    const played = await window.petApp.executeInteraction({ type: 'nextVoice' });
    if (played.empty) show(voiceResult, '语音播放列表为空，请先勾选录音。');
  } catch (error) { show(voiceResult, error.message, true); }
});
let loadingVoices = false;
const gameMode = document.querySelector('#game-mode');
const petHidden = document.querySelector('#pet-hidden');
const desktopResult = document.querySelector('#desktop-result');
function applyDesktopState(state) {
  gameMode.checked = state.gameMode;
  petHidden.checked = state.petHidden;
  show(desktopResult, [state.gameMode ? '游戏模式开启' : '游戏模式关闭', state.petHidden ? '桌宠已隐藏' : '桌宠已显示', ...state.shortcutErrors].join('；'), state.shortcutErrors.length > 0);
}
gameMode.addEventListener('change', async () => {
  try { applyDesktopState(await window.petApp.setGameMode(gameMode.checked)); }
  catch (error) { gameMode.checked = !gameMode.checked; show(desktopResult, error.message, true); }
});
petHidden.addEventListener('change', async () => {
  try { applyDesktopState(await window.petApp.setPetHidden(petHidden.checked)); }
  catch (error) { petHidden.checked = !petHidden.checked; show(desktopResult, error.message, true); }
});
window.petApp.onDesktopState(applyDesktopState);
function labels() {
  document.querySelector('#scale-value').textContent = Math.round(Number(scale.value) * 100) + '%';
  document.querySelector('#volume-value').textContent = Math.round(Number(volume.value) * 100) + '%';
}
function show(element, text, error = false) {
  element.className = 'result' + (error ? ' error' : '');
  element.textContent = text;
}
async function refreshVoices() {
  if (loadingVoices) return;
  loadingVoices = true;
  try {
    const catalog = await window.petApp.voices();
    clips = catalog.clips;
    playlistState.voice = (await window.petApp.preferences()).voicePlaylist;
    playlistState.music = (await window.petApp.preferences()).musicPlaylist;
    document.querySelector('#voice-count').textContent = clips.length ? '已载入 ' + clips.length + ' 条录音，点击即可播放。' : '还没有录音。打开语音目录，按 README 添加音频后再刷新。';
    const list = document.querySelector('#voice-list');
    list.replaceChildren();
    const groups = new Map();
    for (const clip of clips) {
      if (!groups.has(clip.group)) groups.set(clip.group, []);
      groups.get(clip.group).push(clip);
    }
    for (const [group, groupClips] of groups) {
      const details = document.createElement('details');
      details.className = 'voice-category';
      details.open = true;
      const heading = document.createElement('summary');
      heading.textContent = group + ' · ' + groupClips.length;
      const groupList = document.createElement('div');
      groupList.className = 'voice-group';
      details.append(heading, groupList);
      list.append(details);
      for (const clip of groupClips) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'voice-button';
        button.textContent = '▷ ' + clip.label;
        button.dataset.voice = clip.id;
        button.title = (clip.text || clip.label) + (clip.duration ? ` · ${Math.round(clip.duration)} 秒` : '') + (!defaultVoiceSelection(clip) ? ' · 默认不加入互动列表，可手动勾选' : '');
        button.addEventListener('click', async () => {
          show(voiceResult, '正在打开录音…');
          try { await window.petApp.playVoice(clip.id); }
          catch (error) { show(voiceResult, error.message, true); }
        });
        const entry = document.createElement('div');
        entry.className = 'playlist-entry';
        entry.append(playlistCheckbox('voice', clip), button);
        groupList.append(entry);
      }
    }
    renderPlaylist('voice');
    renderSongLibrary();
    renderPlaylist('music');
    show(voiceResult, catalog.warnings.join(' '), catalog.warnings.length > 0);
  } catch (error) { show(voiceResult, error.message, true); }
  finally { loadingVoices = false; }
}
function renderSongLibrary() {
  const list = document.querySelector('#music-list');
  list.replaceChildren();
  const songs = clips.filter(isSong);
  if (!songs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '还没有歌曲，点击「添加歌曲」选择本地音频。';
    list.append(empty);
  }
  for (const clip of songs) {
    const row = document.createElement('div');
    row.className = 'song-row';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'voice-button';
    play.textContent = '▷ ' + clip.label;
    play.dataset.song = clip.id;
    play.addEventListener('click', () => {
      updatePlaylist('music', current => {
        const ids = new Set(current.ids ?? clips.filter(isSong).map(row => row.id));
        ids.add(clip.id);
        return { ...current, ids: [...ids] };
      });
      void playlistSaving.then(() => window.petApp.executeInteraction({ type: 'music', action: 'play', id: clip.id }))
        .catch(error => show(document.querySelector('#music-result'), error.message, true));
    });
    row.append(playlistCheckbox('music', clip), play);
    list.append(row);
  }
}
document.querySelector('#music-refresh').addEventListener('click', () => { void refreshVoices(); });
document.querySelector('#import-music').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const imported = await window.petApp.importMusic();
    await refreshVoices();
    show(document.querySelector('#music-result'), `已添加 ${imported.imported} 首歌曲。` + imported.warnings.join(' '), imported.warnings.length > 0);
  } catch (error) { show(document.querySelector('#music-result'), error.message, true); }
  finally { button.disabled = false; }
});
async function refreshStickers() {
  try {
    const catalog = await window.petApp.stickers();
    stickers = catalog.stickers;
    playlistState.sticker = (await window.petApp.preferences()).stickerPlaylist;
    const list = document.querySelector('#sticker-list');
    list.replaceChildren();
    document.querySelector('#sticker-count').textContent = catalog.stickers.length
      ? `已载入 ${catalog.stickers.length} 张。点击缩略图即可在桌面展示。`
      : '还没有表情包。点击“添加表情包”选择本机图片。';
    for (const sticker of catalog.stickers) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sticker-button';
      button.dataset.sticker = sticker.id;
      const image = document.createElement('img');
      image.src = sticker.src;
      image.alt = sticker.label;
      image.draggable = false;
      image.loading = 'lazy';
      button.title = sticker.label + (sticker.animated ? ' · GIF 动图' : '');
      const label = document.createElement('span');
      label.textContent = sticker.label + (sticker.animated ? ' · GIF' : '');
      button.append(image, label);
      button.addEventListener('click', async () => {
        try {
          await window.petApp.executeInteraction({ type: 'showSticker', id: sticker.id });
          show(stickerResult, `已发送「${sticker.label}」到桌面。`);
        } catch (error) { show(stickerResult, error.message, true); }
      });
      const entry = document.createElement('div');
      entry.className = 'playlist-entry';
      entry.append(playlistCheckbox('sticker', sticker), button);
      list.append(entry);
    }
    renderPlaylist('sticker');
    show(stickerResult, catalog.warnings.join(' '), catalog.warnings.length > 0);
  } catch (error) { show(stickerResult, error.message, true); }
}
async function load() {
  applyDesktopState(await window.petApp.desktopState());
  const info = await window.petApp.info();
  document.querySelector('.identity img').src = '../' + info.avatar;
  document.querySelector('#art-credit').textContent = info.artCredit || '';
  const modelSettings = await window.petApp.readSettings();
  document.querySelector('#assistant-mode').value = modelSettings.mode;
  document.querySelector('#baseUrl').value = modelSettings.baseUrl;
  document.querySelector('#model').value = modelSettings.model;
  document.querySelector('#mode-badge').textContent = modelSettings.mode === 'companion' ? '陪伴版' : '基础版';
  show(document.querySelector('#key-status'), modelSettings.apiKeyConfigured ? 'API 密钥已安全保存。留空保存不会更改现有密钥。' : '尚未配置 API 密钥。');
  scale.value = info.preferences.scale;
  volume.value = info.preferences.volume;
  renderMusicVolume(info.preferences);
  renderMusic(await window.petApp.musicStatus());
  for (const key of ['muted', 'clickVoice', 'clickSticker', 'idleActions', 'lowResourceMode', 'animateIdle', 'autoBlink', 'talkAnimation', 'preloadExpressions']) document.getElementById(key).checked = info.preferences[key];
  renderPerformanceControls();
  labels();
  const actions = document.querySelector('#actions');
  for (const action of info.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = action.label;
    button.dataset.action = action.id;
    button.addEventListener('click', async () => {
      try {
        await window.petApp.action(action.id);
        show(actionResult, action.label + ' ✓');
      } catch (error) { show(actionResult, error.message, true); }
    });
    actions.append(button);
  }
  for (const id of Object.keys(info.expressions || {})) {
    const label = info.expressionLabels?.[id] || id;
    if (!info.expressions?.[id]) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.dataset.expression = id;
    button.textContent = label;
    button.addEventListener('click', async () => {
      try { await window.petApp.executeInteraction({ type: 'showExpression', id }); show(actionResult, label + ' ✓'); }
      catch (error) { show(actionResult, error.message, true); }
    });
    document.querySelector('#expressions').append(button);
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    document.querySelector('#portraitMode').append(option);
  }
  document.querySelector('#portraitMode').value = info.preferences.portraitMode;
  await refreshVoices();
  await refreshStickers();
}
scale.addEventListener('input', () => { scaleEditing = true; labels(); });
volume.addEventListener('input', () => { labels(); window.petApp.previewVolume(Number(volume.value)); });
volume.addEventListener('change', () => { void window.petApp.savePreferences({ volume: Number(volume.value) }).catch(error => show(result, error.message, true)); });
document.querySelector('#preferences-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = { scale: Number(scale.value), volume: Number(volume.value) };
  for (const key of ['muted', 'clickVoice', 'clickSticker', 'idleActions', 'lowResourceMode', 'animateIdle', 'autoBlink', 'talkAnimation', 'preloadExpressions']) input[key] = document.getElementById(key).checked;
  input.portraitMode = document.querySelector('#portraitMode').value;
  try { await window.petApp.savePreferences(input); scaleEditing = false; show(result, '已保存并立即生效。'); }
  catch (error) { show(result, error.message, true); }
});
document.querySelector('#refresh-voices').addEventListener('click', () => { void refreshVoices(); });
document.querySelector('#refresh-stickers').addEventListener('click', () => { void refreshStickers(); });
document.querySelector('#random-sticker').addEventListener('click', async () => {
  try {
    await playlistSaving;
    const result = await window.petApp.executeInteraction({ type: 'nextSticker' });
    show(stickerResult, result.empty ? '表情播放列表为空，请先勾选图片。' : `已发送「${result.label}」到桌面。`);
  } catch (error) { show(stickerResult, error.message, true); }
});
document.querySelector('#import-stickers').addEventListener('click', async () => {
  try {
    const result = await window.petApp.importStickers();
    await refreshStickers();
    show(stickerResult, [`已添加 ${result.imported} 张表情包。`, ...result.warnings].filter(Boolean).join(' '), result.warnings.length > 0);
  } catch (error) { show(stickerResult, error.message, true); }
});
document.querySelector('#sticker-folder').addEventListener('click', async () => {
  try { await window.petApp.openStickerFolder(); }
  catch (error) { show(stickerResult, error.message, true); }
});
document.querySelector('#hide-sticker').addEventListener('click', async () => {
  try { await window.petApp.executeInteraction({ type: 'hideSticker' }); show(stickerResult, '桌面表情已收起。'); }
  catch (error) { show(stickerResult, error.message, true); }
});
document.querySelector('#voice-folder').addEventListener('click', async () => {
  try { await window.petApp.openVoiceFolder(); }
  catch (error) { show(voiceResult, error.message, true); }
});
document.querySelector('#stop-voice').addEventListener('click', async () => {
  try { await window.petApp.stopVoice(); show(voiceResult, '已停止播放。'); }
  catch (error) { show(voiceResult, error.message, true); }
});
document.querySelector('#open-chat').addEventListener('click', () => window.petApp.openChat());
document.querySelector('#assistant-mode').addEventListener('change', event => {
  document.querySelector('#mode-badge').textContent = event.target.value === 'companion' ? '陪伴版' : '基础版';
});
document.querySelector('#save-model').addEventListener('click', async () => {
  const button = document.querySelector('#save-model');
  button.disabled = true;
  try {
    const saved = await window.petApp.saveSettings({
      mode: document.querySelector('#assistant-mode').value,
      baseUrl: document.querySelector('#baseUrl').value,
      model: document.querySelector('#model').value,
      apiKey: document.querySelector('#apiKey').value,
    });
    document.querySelector('#apiKey').value = '';
    show(document.querySelector('#key-status'), saved.apiKeyConfigured ? '已保存。密钥由本机系统加密存储。' : '模式与模型设置已保存。');
    document.querySelector('#mode-badge').textContent = saved.mode === 'companion' ? '陪伴版' : '基础版';
  } catch (error) { show(document.querySelector('#key-status'), error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector('#clear-key').addEventListener('click', async () => {
  try {
    await window.petApp.clearKey();
    show(document.querySelector('#key-status'), '已清除本机保存的 API 密钥。');
  } catch (error) { show(document.querySelector('#key-status'), error.message, true); }
});
for (const button of document.querySelectorAll('[data-deepseek-link]')) {
  button.addEventListener('click', async () => {
    try { await window.petApp.openDeepSeekHelp(button.dataset.deepseekLink); }
    catch (error) { show(document.querySelector('#key-status'), error.message, true); }
  });
}
window.petApp.onVoiceStatus(value => {
  const labels = { playing: '正在播放：', ended: '播放完成：', stopped: '已停止：', error: '播放失败：' };
  show(voiceResult, labels[value.state] + value.label, value.state === 'error');
});
window.petApp.onPreferences(({ preferences }) => {
  if (!scaleEditing) scale.value = preferences.scale;
  labels();
  renderMusicVolume(preferences);
  for (const kind of ['voice', 'sticker', 'music']) {
    playlistState[kind] = preferences[kind + 'Playlist'];
    renderPlaylist(kind);
  }
});
void load().catch(error => show(result, error.message, true));
