import { app, BrowserWindow, ipcMain, screen, safeStorage, Menu, Tray, shell, dialog, net, globalShortcut } from 'electron';
import { readFile, writeFile, mkdir, rename, copyFile, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, basename, extname, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chatCompletionsUrl, DEFAULT_SETTINGS, validateSettings } from './shared.js';
import { FEATURES, ACTIONS, INTERACTIONS, DEFAULT_PREFERENCES, validatePreferences, loadVoices, loadStickers } from './companion.js';
import { UpdateManager, RELEASES_URL, prepareInstallJob } from './updates.js';
import { prepareMedia } from './media.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const characterPath = join(root, 'character', 'character.json');
if (process.env.PET_STARTER_DATA_DIR) app.setPath('userData', resolve(process.env.PET_STARTER_DATA_DIR));
else app.setPath('userData', join(app.getPath('appData'), 'lanxiaomei-desktop-pet'));
const userData = app.getPath('userData');
const settingsPath = join(userData, 'settings.json');
const memoryPath = join(userData, 'conversation.json');
const preferencesPath = join(userData, 'preferences.json');
let voicesDirectory = join(root, 'assets', 'voices');
let stickersDirectory = join(root, 'assets', 'stickers');
const updatesDirectory = join(userData, 'updates');
const updates = new UpdateManager({ version: app.getVersion(), directory: updatesDirectory,
  fetcher: (url, options) => net.fetch(url, options),
  onChange: state => settingsWindow?.webContents.send('updates:state', { ...state, canInstall: app.isPackaged && process.platform === 'win32' && process.arch === 'x64' }),
});
let preferences = { ...DEFAULT_PREFERENCES };
let voiceCatalog = { clips: [], warnings: [] };
let preferencesSaving = Promise.resolve();
let character;
let settings = { ...DEFAULT_SETTINGS };
let history = [];
let petWindow;
let chatWindow;
let settingsWindow;
let dragOrigin;
let chatBusy = false;
let chatController;
let saving = Promise.resolve();
let sleeping = false;
let tray;
let gameMode = false;
let petHidden = false;
const shortcuts = { game: 'Ctrl+Alt+G', hide: 'Ctrl+Alt+H' };
const shortcutErrors = [];

function desktopState() { return { gameMode, petHidden, shortcuts, shortcutErrors }; }
function assertInteractive() {
  if (gameMode) throw new Error('游戏模式已开启，请先按 Ctrl+Alt+G 或在面板中关闭。');
  if (petHidden) throw new Error('桌宠已隐藏，请先按 Ctrl+Alt+H 或在面板中显示。');
}
function syncDesktopState() {
  dragOrigin = null;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setIgnoreMouseEvents(gameMode || petHidden, { forward: true });
    petWindow.setFocusable(!gameMode && !petHidden);
    if (petHidden) petWindow.hide();
    else petWindow.showInactive();
  }
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('desktop:state', desktopState());
  }
  tray?.setContextMenu(makeMenu());
  tray?.setToolTip(`${currentName()}${gameMode ? ' · 游戏模式' : ''}${petHidden ? ' · 已隐藏' : ''}`);
  return desktopState();
}
function setGameMode(value) { gameMode = Boolean(value); return syncDesktopState(); }
function setPetHidden(value) { petHidden = Boolean(value); return syncDesktopState(); }

// Keep the prototype separate from other Electron apps and focus the existing instance.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if (character) openSettings(); });

async function readJson(path, fallback) {
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJson(path, value) {
  await mkdir(userData, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

function currentName() { return character.name; }

function displaySize() {
  return {
    width: Math.round(Math.max(160, Math.min(375, Number(character.displaySize?.width) || 244)) * preferences.scale),
    height: Math.round(Math.max(200, Math.min(437, Number(character.displaySize?.height) || 360)) * preferences.scale),
  };
}

function resetPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  if (!petWindow || petWindow.isDestroyed()) return;
  const [width, height] = petWindow.getSize();
  petWindow.setPosition(Math.max(area.x, area.x + area.width - width - 30), Math.max(area.y, area.y + area.height - height - 20));
}

function toggleSleep() {
  sleeping = !sleeping;
  petWindow?.webContents.send('pet:state', { sleeping });
  tray?.setContextMenu(makeMenu());
}

function performAction(id) {
  assertInteractive();
  if (!ACTIONS.some(action => action.id === id)) throw new Error('没有这个动作。');
  if (id === 'sleep' || id === 'wake') {
    const shouldSleep = id === 'sleep';
    if (sleeping !== shouldSleep) toggleSleep();
  } else {
    if (sleeping) throw new Error('蓝小妹在休息，先叫醒她吧。');
    petWindow?.webContents.send('pet:action', id);
  }
  return { performed: true };
}

function playVoice(id) {
  assertInteractive();
  const clip = voiceCatalog.clips.find(row => row.id === id);
  if (!clip) throw new Error('这条语音暂不可用，请刷新语音包。');
  if (sleeping) throw new Error('蓝小妹在休息，先叫醒她吧。');
  petWindow?.webContents.send('pet:voice', clip);
  return { queued: true, label: clip.label };
}

function makeMenu() {
  return Menu.buildFromTemplate([
    { label: currentName(), enabled: false },
    { type: 'separator' },
    { label: '互动与语音', click: openSettings },
    { label: '动作', enabled: !gameMode && !petHidden, submenu: ACTIONS.map(action => ({ label: action.label, click: () => {
      try { performAction(action.id); } catch { petWindow?.webContents.send('pet:notice', '蓝小妹在休息，先叫醒她吧。'); }
    } })) },
    { label: '播放一条语音', enabled: voiceCatalog.clips.length > 0 && !sleeping && !gameMode && !petHidden, click: () => {
      const clip = voiceCatalog.clips[Math.floor(Math.random() * voiceCatalog.clips.length)];
      if (clip) playVoice(clip.id);
    } },
    { label: FEATURES.ai ? 'AI 聊天' : 'AI 聊天（功能暂未开放）', click: openChat },
    { label: sleeping ? '叫醒她' : '休息一下', enabled: !gameMode && !petHidden, click: toggleSleep },
    { label: '游戏模式（Ctrl+Alt+G）', type: 'checkbox', checked: gameMode, click: () => setGameMode(!gameMode) },
    { label: '隐藏桌宠（Ctrl+Alt+H）', type: 'checkbox', checked: petHidden, click: () => setPetHidden(!petHidden) },
    { label: '回到主屏幕', click: resetPosition },
    { label: '检查更新…', click: () => { openSettings(); settingsWindow?.webContents.once('did-finish-load', () => settingsWindow?.webContents.send('updates:focus')); settingsWindow?.webContents.send('updates:focus'); } },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ]);
}

function guardWindow(window) {
  // Every window loads local files only; model output is always rendered as plain text.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function secureWindowOptions(width, height, extra = {}) {
  return {
    width,
    height,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(root, 'src', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...extra,
  };
}

function createPetWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const size = displaySize();
  const width = size.width + 26;
  const height = size.height + 56;
  petWindow = new BrowserWindow(secureWindowOptions(width, height, {
    x: Math.max(area.x, area.x + area.width - width - 30),
    y: Math.max(area.y, area.y + area.height - height - 20),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
  }));
  petWindow.setAlwaysOnTop(true, 'floating');
  guardWindow(petWindow);
  petWindow.loadFile(join(root, 'src', 'pet.html'));
  petWindow.once('ready-to-show', syncDesktopState);
  petWindow.on('closed', () => { petWindow = null; });
}

function openChat() {
  if (chatWindow && !chatWindow.isDestroyed()) { chatWindow.focus(); return; }
  chatWindow = new BrowserWindow(secureWindowOptions(760, 640, {
    minWidth: 560,
    minHeight: 480,
    title: `${currentName()} | 聊天`,
    backgroundColor: '#f4f7f5',
  }));
  chatWindow.loadFile(join(root, 'src', 'chat.html'));
  guardWindow(chatWindow);
  chatWindow.once('ready-to-show', () => chatWindow?.show());
  chatWindow.on('closed', () => { chatController?.abort(); chatWindow = null; });
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow(secureWindowOptions(520, 700, {
    minWidth: 440,
    minHeight: 600,
    title: '蓝小妹 · 互动与语音',
    backgroundColor: '#f4f7f5',
  }));
  settingsWindow.loadFile(join(root, 'src', 'settings.html'));
  guardWindow(settingsWindow);
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

ipcMain.handle('pet:info', () => ({
  name: currentName(), description: character.description || '',
  image: character.image || 'assets/mascot.svg', greetings: character.greetings,
  avatar: character.avatar || character.image || 'assets/mascot.svg',
  displaySize: displaySize(),
  features: FEATURES,
  artCredit: character.artCredit,
  preferences,
  sleeping,
  actions: ACTIONS,
}));
ipcMain.handle('companion:preferences', () => preferences);
ipcMain.handle('desktop:status', desktopState);
ipcMain.handle('desktop:game-mode', (_event, value) => {
  if (typeof value !== 'boolean') throw new Error('游戏模式需要布尔值。');
  return setGameMode(value);
});
ipcMain.handle('desktop:hidden', (_event, value) => {
  if (typeof value !== 'boolean') throw new Error('隐藏开关需要布尔值。');
  return setPetHidden(value);
});
ipcMain.handle('updates:status', () => ({ ...updates.snapshot(), canInstall: app.isPackaged && process.platform === 'win32' && process.arch === 'x64' }));
ipcMain.handle('updates:check', (_event, includePrereleases) => updates.check(includePrereleases !== false));
ipcMain.handle('updates:download', () => updates.download());
ipcMain.on('updates:cancel', () => updates.cancel());
ipcMain.handle('updates:page', () => shell.openExternal(RELEASES_URL));
ipcMain.handle('updates:show-file', () => {
  if (!updates.downloaded) throw new Error('还没有下载完成的更新包。');
  shell.showItemInFolder(updates.downloaded.path);
});
ipcMain.handle('updates:install', async () => {
  if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64') throw new Error('源码运行时不自动替换文件，请通过 Git 更新；Windows 免安装版支持原位更新。');
  if (['preparing', 'installing'].includes(updates.state.phase)) throw new Error('已在准备更新。');
  const installDirectory = dirname(process.execPath);
  updates.update({ phase: 'preparing', error: '' });
  try {
    const processStarted = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().ToString('o')`], { encoding: 'utf8', windowsHide: true }).trim();
    const job = await prepareInstallJob({ downloaded: updates.downloaded, installDirectory, executable: basename(process.execPath), pid: process.pid, processStarted,
      directory: updatesDirectory, script: join(root, 'src', 'install-update.ps1') });
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', join(job, 'install.ps1'), '-JobFile', join(job, 'job.json')],
      { cwd: job, detached: true, stdio: 'ignore', windowsHide: true });
    let helperError;
    child.on('error', error => { helperError = error; });
    child.unref();
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (helperError) throw helperError;
      const result = await readJson(join(job, 'result.json'), null);
      if (result?.state === 'ready') {
        updates.update({ phase: 'installing' });
        setTimeout(() => app.quit(), 500);
        return { restarting: true };
      }
      if (result && ['error', 'restore-required'].includes(result.state)) throw new Error(`更新准备失败：${result.message}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('更新准备超时，当前桌宠继续运行。可稍后重试。');
  } catch (error) {
    updates.update({ phase: 'error', error: error.message });
    throw error;
  }
});
function savePreferences(input) {
  preferencesSaving = preferencesSaving.catch(() => {}).then(async () => {
    const updated = validatePreferences(input);
    await writeJson(preferencesPath, updated);
    preferences = updated;
    const size = displaySize();
    if (petWindow && !petWindow.isDestroyed()) {
      const bounds = petWindow.getBounds();
      petWindow.setBounds({ x: bounds.x, y: bounds.y + bounds.height - size.height - 56, width: size.width + 26, height: size.height + 56 });
      petWindow.webContents.send('pet:preferences', { preferences, displaySize: size });
    }
    return preferences;
  });
  return preferencesSaving;
}

// All present and future callers share this dispatcher. No arbitrary paths or code.
async function executeInteraction(command) {
  if (!command || typeof command !== 'object' || !INTERACTIONS.some(row => row.id === command.type)) throw new Error('不支持的互动指令。');
  if (!['setPreferences', 'stopVoice', 'hideSticker'].includes(command.type)) assertInteractive();
  if (ACTIONS.some(row => row.id === command.type)) return performAction(command.type);
  switch (command.type) {
    case 'playVoice':
      voiceCatalog = await readVoiceCatalog();
      return playVoice(command.id);
    case 'stopVoice':
      petWindow?.webContents.send('pet:voice-stop');
      return { performed: true };
    case 'showSticker': {
      if (sleeping) throw new Error('蓝小妹在休息，先叫醒她吧。');
      const { stickers } = await loadStickers(stickersDirectory);
      assertInteractive();
      const sticker = stickers.find(row => row.id === command.id);
      if (!sticker) throw new Error('这张表情包不存在，请刷新表情包库。');
      petWindow?.webContents.send('pet:sticker', sticker);
      return { performed: true, label: sticker.label };
    }
    case 'hideSticker':
      petWindow?.webContents.send('pet:sticker-hide');
      return { performed: true };
    case 'setPreferences': return savePreferences(command.preferences);
    case 'resetPosition': resetPosition(); return { performed: true };
    case 'moveTo': {
      if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) throw new Error('桌宠坐标需要是有效数字。');
      const area = screen.getDisplayNearestPoint({ x: Math.round(command.x), y: Math.round(command.y) }).workArea;
      const [width, height] = petWindow.getSize();
      petWindow.setPosition(
        Math.round(Math.max(area.x, Math.min(command.x, area.x + area.width - width))),
        Math.round(Math.max(area.y, Math.min(command.y, area.y + area.height - height))),
      );
      return { performed: true };
    }
  }
}
ipcMain.handle('interaction:execute', (_event, command) => executeInteraction(command));
ipcMain.handle('interaction:catalog', async () => ({
  commands: INTERACTIONS, preferences,
  voices: await readVoiceCatalog(),
  ...await loadStickers(stickersDirectory),
}));
ipcMain.handle('companion:save', (_event, input) => executeInteraction({ type: 'setPreferences', preferences: input }));
ipcMain.handle('companion:action', (_event, id) => executeInteraction({ type: id }));
ipcMain.handle('companion:voices', async () => {
  voiceCatalog = await readVoiceCatalog();
  tray?.setContextMenu(makeMenu());
  return voiceCatalog;
});
ipcMain.handle('companion:voice', (_event, id) => executeInteraction({ type: 'playVoice', id }));
ipcMain.handle('companion:stickers', () => loadStickers(stickersDirectory));
ipcMain.handle('companion:sticker-folder', async () => {
  await mkdir(stickersDirectory, { recursive: true });
  const error = await shell.openPath(stickersDirectory);
  if (error) throw new Error('无法打开表情包目录。');
});
ipcMain.handle('companion:sticker-import', async event => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const selected = await dialog.showOpenDialog(owner, {
    title: '添加表情包', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '表情包图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (selected.canceled) return { imported: 0, warnings: [] };
  await mkdir(stickersDirectory, { recursive: true });
  let imported = 0;
  const warnings = [];
  for (const path of selected.filePaths.slice(0, 200)) {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 10 * 1024 * 1024 || !/\.(?:png|jpe?g|gif|webp)$/iu.test(path)) throw new Error('file');
      let target = join(stickersDirectory, basename(path));
      try { await copyFile(path, target, 1); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        target = join(stickersDirectory, `${basename(path, extname(path))}-${randomUUID().slice(0, 8)}${extname(path)}`);
        await copyFile(path, target, 1);
      }
      imported++;
    } catch { warnings.push(`未添加 ${basename(path)}：文件无效、过大或无法复制。`); }
  }
  return { imported, warnings };
});
ipcMain.handle('companion:voice-folder', async () => {
  const error = await shell.openPath(voicesDirectory);
  if (error) throw new Error('无法打开语音目录。');
});
ipcMain.on('companion:voice-stop', () => petWindow?.webContents.send('pet:voice-stop'));
ipcMain.on('companion:voice-status', (event, value) => {
  if (event.sender !== petWindow?.webContents || !['playing', 'ended', 'stopped', 'error'].includes(value?.state)) return;
  settingsWindow?.webContents.send('pet:voice-status', { state: value.state, label: String(value.label || '').slice(0, 60) });
});
ipcMain.handle('settings:read', () => ({
  displayName: settings.displayName,
  baseUrl: settings.baseUrl,
  model: settings.model,
  apiKeyConfigured: Boolean(settings.encryptedApiKey),
}));
async function saveSettings(input) {
  if (!FEATURES.ai) throw new Error('模型接入功能暂未开放。');
  const next = validateSettings(input);
  const updated = { ...settings, displayName: next.displayName, baseUrl: next.baseUrl || DEFAULT_SETTINGS.baseUrl, model: next.model };
  if (next.apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统没有可用的安全存储，未保存 API 密钥。');
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      throw new Error('当前 Linux 环境未启用系统密钥环，无法安全保存密钥。');
    }
    updated.encryptedApiKey = safeStorage.encryptString(next.apiKey).toString('base64');
  }
  await writeJson(settingsPath, updated);
  settings = updated;
  tray?.setToolTip(currentName());
  tray?.setContextMenu(makeMenu());
  for (const window of [petWindow, chatWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('pet:renamed', currentName());
  }
  return { displayName: currentName(), apiKeyConfigured: Boolean(settings.encryptedApiKey) };
}
ipcMain.handle('settings:save', (_event, input) => {
  saving = saving.catch(() => {}).then(() => saveSettings(input));
  return saving;
});
ipcMain.handle('settings:clear-key', () => {
  saving = saving.catch(() => {}).then(async () => {
    const updated = { ...settings, encryptedApiKey: '' };
    await writeJson(settingsPath, updated);
    settings = updated;
    return { apiKeyConfigured: false };
  });
  return saving;
});
ipcMain.handle('chat:history', () => history.slice(-40));
ipcMain.handle('chat:clear', async () => {
  if (chatBusy) throw new Error('请等待当前回复完成后再清空。');
  await writeJson(memoryPath, []);
  history = [];
});
ipcMain.handle('chat:send', async (_event, rawText) => {
  if (!FEATURES.ai) throw new Error('AI 聊天功能暂未开放。');
  if (chatBusy) throw new Error('上一条消息还在生成，请稍等。');
  const text = String(rawText ?? '').trim();
  if (!text || text.length > 4000) throw new Error('消息需要在 1 到 4000 个字符之间。');
  if (!settings.model || !settings.encryptedApiKey) {
    return { reply: `我还没连上模型呢。先在设置里填写 API 地址、模型和密钥，再回来找我聊天吧。`, preview: true };
  }
  chatBusy = true;
  chatController = new AbortController();
  try {
    let apiKey;
    try { apiKey = safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64')); }
    catch { throw new Error('本机密钥无法解密，请在设置中重新填写。'); }
    const requestHistory = [...history.slice(-24), { role: 'user', content: text }];
    const response = await fetch(chatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'system', content: character.systemPrompt || '请用中文简短回复。' }, ...requestHistory],
        temperature: 0.8,
        max_tokens: 1000,
      }),
      signal: AbortSignal.any([chatController.signal, AbortSignal.timeout(90_000)]),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}。请检查模型设置或服务商状态。`);
    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('模型返回了空回复。');
    const nextHistory = [...history, { role: 'user', content: text }, { role: 'assistant', content: reply.trim() }].slice(-40);
    await writeJson(memoryPath, nextHistory);
    history = nextHistory;
    return { reply: reply.trim(), preview: false };
  } catch (error) {
    if (chatController?.signal.aborted) throw new Error('已停止本次生成。');
    if (error.name === 'TimeoutError') throw new Error('等待模型回复超时，请稍后重试。');
    if (error.message === 'fetch failed') throw new Error('无法连接模型服务，请检查 API 地址和网络。');
    throw error;
  } finally {
    chatBusy = false;
    chatController = null;
  }
});
ipcMain.on('pet:drag-start', () => {
  if (gameMode || petHidden || !petWindow || petWindow.isDestroyed()) return;
  dragOrigin = { ...screen.getCursorScreenPoint(), bounds: petWindow.getBounds() };
});
ipcMain.on('pet:drag-move', () => {
  if (gameMode || petHidden || !dragOrigin || !petWindow || petWindow.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const bounds = petWindow.getBounds();
  petWindow.setPosition(
    Math.round(Math.max(area.x - bounds.width + 90, Math.min(area.x + area.width - 90, dragOrigin.bounds.x + point.x - dragOrigin.x))),
    Math.round(Math.max(area.y - bounds.height + 130, Math.min(area.y + area.height - 110, dragOrigin.bounds.y + point.y - dragOrigin.y))),
  );
});
ipcMain.on('pet:drag-end', () => { dragOrigin = null; });
ipcMain.on('pet:open-chat', event => { if (event.sender !== petWindow?.webContents || (!gameMode && !petHidden)) openChat(); });
ipcMain.on('pet:open-settings', event => { if (event.sender !== petWindow?.webContents || (!gameMode && !petHidden)) openSettings(); });
ipcMain.on('pet:quit', () => app.quit());
ipcMain.on('pet:context-menu', () => { if (!gameMode && !petHidden) makeMenu().popup({ window: petWindow }); });
ipcMain.on('chat:cancel', () => chatController?.abort());
ipcMain.on('pet:mouse-ignore', (_event, ignore) => {
  if (petWindow && !petWindow.isDestroyed()) petWindow.setIgnoreMouseEvents(gameMode || petHidden || Boolean(ignore), { forward: true });
});

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  character = await readJson(characterPath, null);
  if (!character?.id || !character?.name || !Array.isArray(character?.greetings) || !character.greetings.length) {
    throw new Error('character/character.json 缺少必需字段。');
  }
  for (const path of [character.image || 'assets/mascot.svg', character.avatar || 'assets/icon.png']) {
    if (typeof path !== 'string') throw new Error('角色图片路径必须为字符串。');
    const asset = relative(root, resolve(root, path));
    if (isAbsolute(asset) || asset.startsWith('..')) throw new Error('角色图片必须在项目目录内。');
  }
  settings = { ...DEFAULT_SETTINGS, ...await readJson(settingsPath, {}) };
  ({ voicesDirectory, stickersDirectory } = await prepareMedia({ root, userData, packaged: app.isPackaged }));
  try { preferences = validatePreferences({ ...DEFAULT_PREFERENCES, ...await readJson(preferencesPath, {}) }); }
  catch { preferences = { ...DEFAULT_PREFERENCES }; }
  voiceCatalog = await readVoiceCatalog();
  history = await readJson(memoryPath, []);
  if (!Array.isArray(history)) history = [];
  history = history.filter(row => ['user', 'assistant'].includes(row?.role) && typeof row.content === 'string').slice(-40);
  createPetWindow();
  tray = new Tray(join(root, character.avatar || 'assets/icon.png'));
  tray.setToolTip(currentName());
  tray.setContextMenu(makeMenu());
  tray.on('double-click', openSettings);
  for (const [key, callback] of [['game', () => setGameMode(!gameMode)], ['hide', () => setPetHidden(!petHidden)]]) {
    let registered = false;
    try { registered = globalShortcut.register(shortcuts[key], callback); } catch { /* Show conflicts in the panel. */ }
    if (!registered) shortcutErrors.push(`${shortcuts[key]} 注册失败，可能已被其他程序占用；仍可从托盘或面板切换。`);
  }
  screen.on('display-removed', resetPosition);
  app.on('activate', () => { if (!petWindow) createPetWindow(); });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { globalShortcut.unregisterAll(); chatController?.abort(); updates.cancel(); });

async function readVoiceCatalog() {
  try { return await loadVoices(voicesDirectory); }
  catch (error) { return { clips: [], warnings: [error.message] }; }
}
