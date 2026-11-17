import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { _electron as electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-settings-test-'));
let desktop, helper, lines, originalCursor;
async function cursor(point, flag = 0) {
  const ack = once(lines, 'line');
  helper.stdin.write(JSON.stringify({ ...point, flag }) + '\n');
  assert.equal((await ack)[0], 'ok');
}
try {
  const fixture = join(temp, 'app'), data = join(temp, 'data');
  await mkdir(fixture); await mkdir(data);
  for (const path of ['src', 'assets', 'character', 'package.json']) await cp(join(root, path), join(fixture, path), { recursive: true });
  await writeFile(join(fixture, 'assets/voices/manifest.json'), '{"clips":[]}');
  await writeFile(join(data, 'preferences.json'), JSON.stringify({ scale: 1, muted: true, idleActions: false }));
  const script = join(temp, 'mouse.ps1');
  await writeFile(script, `Add-Type @'
using System;
using System.Runtime.InteropServices;
public class PetMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
[void][PetMouse]::SetThreadDpiAwarenessContext([IntPtr](-4))
while ($null -ne ($line = [Console]::ReadLine())) {
  $point = $line | ConvertFrom-Json
  [void][PetMouse]::SetCursorPos($point.x, $point.y)
  if ($point.flag) { [PetMouse]::mouse_event($point.flag, 0, 0, 0, [UIntPtr]::Zero) }
  [Console]::WriteLine('ok')
}
`, 'utf8');
  helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  lines = createInterface({ input: helper.stdout });
  const env = { ...process.env, PET_STARTER_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40000 });
  const pet = await desktop.firstWindow();
  await pet.locator('#pet').waitFor();
  originalCursor = await desktop.evaluate(({ screen }) => screen.dipToScreenPoint(screen.getCursorScreenPoint()));
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'moveTo', x: 100, y: 100 }));
  async function point(selector) {
    const rect = await pet.locator(selector).boundingBox();
    return desktop.evaluate(({ BrowserWindow, screen }, rect) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/pet.html'));
      const [x, y] = win.getPosition();
      return screen.dipToScreenPoint({ x: Math.round(x + rect.x + rect.width / 2), y: Math.round(y + rect.y + rect.height / 2) });
    }, rect);
  }
  async function clickSettings() {
    await cursor(await point('#pet'));
    await pet.waitForTimeout(220);
    await cursor(await point('#open-settings'));
    await pet.waitForTimeout(120);
    const button = await point('#open-settings');
    await cursor(button, 2); await cursor(button, 4);
    await pet.waitForTimeout(300);
  }
  await cursor(await point('#pet'));
  await pet.waitForTimeout(250);
  await cursor(await point('#open-settings'));
  await pet.waitForTimeout(3000);
  assert.equal(await pet.locator('.pet-tools').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'a stationary pointer over toolbar must not disable its buttons');
  await clickSettings();
  const getSettings = () => desktop.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('/settings.html'));
    return windows.map(w => ({ visible: w.isVisible(), minimized: w.isMinimized(), focused: w.isFocused() }));
  });
  assert.equal((await getSettings()).length, 1, 'native gear click opens one panel');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html')).minimize());
  await desktop.evaluate(({ BrowserWindow }) => {
    globalThis.settingsWindowTrace = [];
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html'));
    for (const method of ['restore', 'show', 'moveTop', 'focus']) {
      const original = win[method].bind(win);
      win[method] = (...args) => { globalThis.settingsWindowTrace.push(method); return original(...args); };
    }
  });
  await pet.waitForTimeout(200);
  await clickSettings();
  const minimizedState = await getSettings();
  if (minimizedState[0].minimized) console.log('Settings restore diagnostic: ' + JSON.stringify(await desktop.evaluate(() => globalThis.settingsWindowTrace)));
  assert.equal(minimizedState[0].minimized, false, 'reopening must restore a minimized panel');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/settings.html')).hide());
  await clickSettings();
  assert.equal((await getSettings())[0].visible, true, 'reopening must show an existing hidden panel');
  for (let n = 0; n < 4; n++) await clickSettings();
  assert.equal((await getSettings()).length, 1, 'repeated gear clicks reuse one panel');
  await cursor(await point('#pet'));
  await pet.waitForTimeout(100);
  const corner = await desktop.evaluate(({ screen }) => screen.dipToScreenPoint({ x: 1, y: 1 }));
  await cursor(corner);
  await pet.waitForTimeout(3000);
  assert.equal(await pet.locator('.pet-tools').evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'controls still hide after leaving');
  console.log('Settings native-input smoke passed: stationary toolbar hover, gear click, minimized/hidden restore, repeated opens, leaving toolbar.');
} finally {
  if (originalCursor) await cursor(originalCursor, 4).catch(() => {});
  helper?.stdin.end();
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
