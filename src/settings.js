const result = document.querySelector('#result');
const voiceResult = document.querySelector('#voice-result');
const actionResult = document.querySelector('#action-result');
const stickerResult = document.querySelector('#sticker-result');
const scale = document.querySelector('#scale');
const volume = document.querySelector('#volume');
let clips = [];
let loadingVoices = false;

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
    document.querySelector('#voice-count').textContent = clips.length ? '已载入 ' + clips.length + ' 条录音，点击即可播放。' : '还没有录音。打开语音目录，按 README 添加音频后再刷新。';
    const list = document.querySelector('#voice-list');
    list.replaceChildren();
    for (const clip of clips) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice-button';
      button.textContent = '▷ ' + clip.label;
      button.dataset.voice = clip.id;
      button.title = clip.text || clip.label;
      button.addEventListener('click', async () => {
        show(voiceResult, '正在打开录音…');
        try { await window.petApp.playVoice(clip.id); }
        catch (error) { show(voiceResult, error.message, true); }
      });
      list.append(button);
    }
    show(voiceResult, catalog.warnings.join(' '), catalog.warnings.length > 0);
  } catch (error) { show(voiceResult, error.message, true); }
  finally { loadingVoices = false; }
}
async function refreshStickers() {
  try {
    const catalog = await window.petApp.stickers();
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
      const label = document.createElement('span');
      label.textContent = sticker.label;
      button.append(image, label);
      button.addEventListener('click', async () => {
        try {
          await window.petApp.executeInteraction({ type: 'showSticker', id: sticker.id });
          show(stickerResult, `已发送「${sticker.label}」到桌面。`);
        } catch (error) { show(stickerResult, error.message, true); }
      });
      list.append(button);
    }
    show(stickerResult, catalog.warnings.join(' '), catalog.warnings.length > 0);
  } catch (error) { show(stickerResult, error.message, true); }
}
async function load() {
  const info = await window.petApp.info();
  document.querySelector('.identity img').src = '../' + info.avatar;
  document.querySelector('#art-credit').textContent = info.artCredit || '';
  scale.value = info.preferences.scale;
  volume.value = info.preferences.volume;
  for (const key of ['muted', 'clickVoice', 'idleActions']) document.getElementById(key).checked = info.preferences[key];
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
  await refreshVoices();
  await refreshStickers();
}
scale.addEventListener('input', labels);
volume.addEventListener('input', labels);
document.querySelector('#preferences-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = { scale: Number(scale.value), volume: Number(volume.value) };
  for (const key of ['muted', 'clickVoice', 'idleActions']) input[key] = document.getElementById(key).checked;
  try { await window.petApp.savePreferences(input); show(result, '已保存并立即生效。'); }
  catch (error) { show(result, error.message, true); }
});
document.querySelector('#refresh-voices').addEventListener('click', () => { void refreshVoices(); });
document.querySelector('#refresh-stickers').addEventListener('click', () => { void refreshStickers(); });
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
document.querySelector('#stop-voice').addEventListener('click', () => {
  window.petApp.stopVoice();
  show(voiceResult, '已停止播放。');
});
document.querySelector('#open-chat').addEventListener('click', () => window.petApp.openChat());
window.petApp.onVoiceStatus(value => {
  const labels = { playing: '正在播放：', ended: '播放完成：', stopped: '已停止：', error: '播放失败：' };
  show(voiceResult, labels[value.state] + value.label, value.state === 'error');
});
void load().catch(error => show(result, error.message, true));
