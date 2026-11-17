const messages = document.querySelector('#messages');
const status = document.querySelector('#status');
const input = document.querySelector('#input');
const send = document.querySelector('#send');
let currentMode = 'basic';
let busy = false;
let languages = [];

function bubble(role, content) {
  const row = document.createElement('article');
  row.className = 'message ' + (role === 'user' ? 'user' : 'assistant');
  row.textContent = content;
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
}
function showError(message) {
  status.textContent = message;
  status.classList.add('error');
}
async function renderMemories() {
  const rows = await window.petApp.memories();
  document.querySelector('#memory-count').textContent = rows.length;
  const list = document.querySelector('#memory-list');
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'memory-empty';
    empty.textContent = '还没有保存长期记忆。';
    list.append(empty);
  }
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'memory-row';
    const text = document.createElement('span');
    text.textContent = row.text;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label', '删除记忆');
    remove.addEventListener('click', async () => { try { await window.petApp.forget(row.id); await renderMemories(); } catch (error) { showError(error.message); } });
    item.append(text, remove); list.append(item);
  }
}
async function load() {
  const [info, config, history] = await Promise.all([window.petApp.info(), window.petApp.readSettings(), window.petApp.history()]);
  document.querySelector('#name').textContent = info.name;
  document.querySelector('.identity img').src = '../' + info.avatar;
  document.title = info.name + ' | 文字聊天';
  document.querySelector('#chat-mode').textContent = config.mode === 'companion' ? 'AI 文字聊天' : 'AI 已关闭';
  setMode(config.mode);
  for (const row of history) bubble(row.role, row.content);
  if (!history.length) {
    const welcome = document.createElement('p');
    welcome.className = 'chat-welcome';
    welcome.textContent = config.mode === 'companion' ? '今天想聊点什么？' : '在“AI 与模型”中开启 AI 后，就可以在这里聊天。';
    messages.append(welcome);
  }
  await renderMemories();
  void loadSpeech();
  const state = await window.petApp.speechStatus();
  busy = state.chatBusy;
  setMode(currentMode);
}
function setMode(mode) {
  currentMode = mode;
  const active = mode === 'companion';
  document.querySelector('#chat-mode').textContent = active ? 'AI 文字聊天' : 'AI 已关闭';
  input.disabled = !active;
  send.disabled = !active || busy;
  document.querySelector('#speech-once').disabled = !active || !languages.length;
  document.querySelector('#speech-wake').disabled = !active || !languages.length;
  document.querySelector('#speech-continuous').disabled = !active || !languages.length;
  if (!active && !status.classList.contains('error')) status.textContent = 'AI 尚未开启。到“AI 与模型”中开启后即可聊天。';
  else if (active && !status.classList.contains('error')) status.textContent = '';
}

document.querySelector('#composer').addEventListener('submit', async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || send.disabled) return;
  input.value = '';
  messages.querySelector('.chat-welcome')?.remove();
  bubble('user', text);
  busy = true;
  status.classList.remove('error'); status.textContent = '正在回复…'; send.disabled = true;
  document.querySelector('#cancel-message').hidden = false;
  try {
    const result = await window.petApp.sendMessage(text);
    bubble('assistant', result.reply);
    status.textContent = '';
    await renderMemories();
  } catch (error) { showError(error.message); if (!input.value) input.value = text; }
  finally {
    busy = (await window.petApp.speechStatus()).chatBusy;
    send.disabled = busy || currentMode !== 'companion';
    document.querySelector('#cancel-message').hidden = !busy;
    await renderMemories(); input.focus();
  }
});
document.querySelector('#settings').addEventListener('click', () => window.petApp.openSettings());
document.querySelector('#clear-chat').addEventListener('click', async () => {
  try {
    await window.petApp.clearHistory();
    messages.replaceChildren();
    const welcome = document.createElement('p'); welcome.className = 'chat-welcome'; welcome.textContent = '聊天记录已清空。'; messages.append(welcome);
    status.textContent = '';
  } catch (error) { showError(error.message); }
});
document.querySelector('#memory-form').addEventListener('submit', async event => {
  event.preventDefault();
  const field = document.querySelector('#memory-input');
  try { await window.petApp.remember(field.value); field.value = ''; await renderMemories(); }
  catch (error) { showError(error.message); }
});
window.petApp.onChatMode(setMode);
window.petApp.onChatActivity(state => {
  busy = state.busy;
  send.disabled = busy || currentMode !== 'companion';
  document.querySelector('#cancel-message').hidden = !busy;
  if (state.error) showError(state.error);
  else { status.classList.remove('error'); status.textContent = busy ? '正在回复…' : ''; }
});
window.petApp.onSpeechTurn(async () => {
  const rows = await window.petApp.history();
  messages.replaceChildren();
  for (const row of rows) bubble(row.role, row.content);
  await renderMemories();
});
document.querySelector('#cancel-message').addEventListener('click', () => window.petApp.cancelMessage());
async function loadSpeech() {
  languages = await window.petApp.speechLanguages();
  const select = document.querySelector('#speech-language');
  select.replaceChildren();
  if (!languages.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = '没有可用的系统识别组件'; select.append(option);
    document.querySelector('#speech-status').textContent = '本机没有可用组件；可继续文字聊天。可在 Windows 语言与语音设置中检查组件。';
  }
  for (const row of languages) {
    const option = document.createElement('option'); option.value = row.culture; option.textContent = row.name + ' (' + row.culture + ')'; select.append(option);
  }
  setMode(currentMode);
  await receiveSpeech();
}
async function receiveSpeech() {
  const pending = await window.petApp.pendingSpeech();
  const event = pending.state;
  const listening = pending.running;
  document.querySelector('#speech-wake').checked = listening && pending.options?.mode === 'wake';
  document.querySelector('#speech-continuous').checked = listening && pending.options?.mode === 'continuous';
  if (pending.options) {
    document.querySelector('#speech-send').checked = pending.options.autoSend !== false;
    if (languages.some(row => row.culture === pending.options.culture)) document.querySelector('#speech-language').value = pending.options.culture;
    document.querySelector('#wake-phrase').value = pending.options.wakePhrase;
  }
  document.querySelector('#speech-stop').hidden = !listening;
  if (listening) document.querySelector('#speech-status').textContent = pending.options?.mode === 'continuous' ? '持续监听中 · 不需要唤醒词 · 关闭聊天窗口仍继续' : pending.options?.mode === 'wake' ? '持续等待唤醒词 · 关闭聊天窗口仍继续' : '正在听，请说一句话…';
  if (event.type === 'wake') document.querySelector('#speech-status').textContent = '听到唤醒词了，请说一句话（15 秒内）。';
  if (event.type === 'stopped' || event.type === 'error') {
    document.querySelector('#speech-wake').checked = false;
    document.querySelector('#speech-continuous').checked = false;
    if (languages.length) document.querySelector('#speech-status').textContent = event.type === 'error' ? '识别未启动：' + event.message : '监听已停止 · 仅文字回答';
  }
  if (pending.text) {
    if (input.value.trim()) {
      document.querySelector('#speech-status').textContent = '识别到：“' + pending.text + '”。输入框有草稿，已保留草稿。';
      return;
    }
    input.value = pending.text;
    input.focus();
    document.querySelector('#speech-status').textContent = '已识别，确认输入内容后发送。';
  }
}
async function startSpeech(mode) {
  try {
    document.querySelector('#speech-status').textContent = '正在启动识别…';
    await window.petApp.startSpeech({ mode, culture: document.querySelector('#speech-language').value, wakePhrase: document.querySelector('#wake-phrase').value.trim(), autoSend: document.querySelector('#speech-send').checked });
    document.querySelector('#speech-wake').checked = mode === 'wake';
    document.querySelector('#speech-continuous').checked = mode === 'continuous';
    document.querySelector('#speech-stop').hidden = false;
  } catch (error) {
    document.querySelector('#speech-status').textContent = error.message;
    document.querySelector('#speech-wake').checked = false;
    document.querySelector('#speech-continuous').checked = false;
  }
}
document.querySelector('#speech-once').addEventListener('click', () => { void startSpeech('once'); });
document.querySelector('#speech-wake').addEventListener('change', event => { if (event.target.checked) void startSpeech('wake'); else void window.petApp.stopSpeech(); });
document.querySelector('#speech-continuous').addEventListener('change', event => { if (event.target.checked) void startSpeech('continuous'); else void window.petApp.stopSpeech(); });
document.querySelector('#speech-send').addEventListener('change', event => { void window.petApp.configureSpeech(event.target.checked); });
document.querySelector('#speech-stop').addEventListener('click', () => { void window.petApp.stopSpeech(); });
for (const id of ['speech-language', 'wake-phrase']) document.getElementById(id).addEventListener('change', () => { void window.petApp.stopSpeech(); });
window.petApp.onSpeech(() => { void receiveSpeech().catch(error => showError(error.message)); });
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.querySelector('#composer').requestSubmit(); }
});
void load().catch(error => showError(error.message));
