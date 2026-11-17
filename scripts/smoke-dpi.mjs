// Real Windows cursor input on the connected monitors. Uses a copied app and
// isolated settings; never changes the owner's scale or display configuration.
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { _electron as electron } from 'playwright';

if (process.platform !== 'win32') throw new Error('This check requires Windows and moves the real cursor.');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-dpi-test-'));
let desktop, helper;
try {
  const fixture = join(temp, 'app');
  await mkdir(fixture);
  for (const path of ['src', 'assets', 'character', 'package.json']) await cp(join(root, path), join(fixture, path), { recursive: true });
  await writeFile(join(fixture, 'assets/voices/manifest.json'), '{"clips":[]}');
  const data = join(temp, 'data');
  await mkdir(data);
  await writeFile(join(data, 'preferences.json'), JSON.stringify({ scale: 1, muted: true, clickVoice: false, clickSticker: false, idleActions: false }));
  const ps = join(temp, 'cursor.ps1');
  await writeFile(ps, `Add-Type @'
using System;
using System.Runtime.InteropServices;
public class PetCursor {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
[void][PetCursor]::SetThreadDpiAwarenessContext([IntPtr](-4))
while ($null -ne ($line = [Console]::ReadLine())) {
  $point = $line | ConvertFrom-Json
  [void][PetCursor]::SetCursorPos($point.x, $point.y)
  if ($point.flag) { [PetCursor]::mouse_event($point.flag, 0, 0, 0, [UIntPtr]::Zero) }
  [Console]::WriteLine('ok')
}
`, 'utf8');
  helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: helper.stdout });
  async function cursor(point, flag = 0) {
    const ack = once(lines, 'line');
    helper.stdin.write(JSON.stringify({ ...point, flag }) + '\n');
    assert.equal((await ack)[0], 'ok');
  }
  const env = { ...process.env, PET_STARTER_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  desktop = await electron.launch({ args: [fixture], cwd: root, env, timeout: 40000 });
  const pet = await desktop.firstWindow();
  await pet.locator('#pet').waitFor();
  const originalCursor = await desktop.evaluate(({ screen }) => screen.dipToScreenPoint(screen.getCursorScreenPoint()));
  const displays = await desktop.evaluate(({ screen }) => screen.getAllDisplays().map(({ id, scaleFactor, bounds, workArea }) => ({ id, scaleFactor, bounds, workArea })));
  console.log('Connected displays: ' + JSON.stringify(displays));
  const bounds = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/pet.html')).getBounds());
  const physical = point => desktop.evaluate(({ screen }, p) => screen.dipToScreenPoint(p), point);
  function checkSize(value) {
    assert.ok(Math.abs(value.width - 270) <= 1, 'width must remain 270 DIP: ' + JSON.stringify(value));
    assert.ok(Math.abs(value.height - 572) <= 1, 'height must remain 572 DIP: ' + JSON.stringify(value));
  }
  try {
    for (const display of displays) {
      const area = display.workArea;
      await pet.evaluate(p => window.petApp.executeInteraction({ type: 'moveTo', ...p }), { x: area.x + 120, y: area.y + 70 });
      await pet.waitForTimeout(250);
      checkSize(await bounds());
      const before = await bounds();
      const start = { x: before.x + 100, y: before.y + 240 };
      await cursor(await physical(start));
      await pet.evaluate(() => window.petApp.ignoreMouse(false));
      await cursor(await physical(start), 2);
      await pet.waitForTimeout(80);
      for (let i = 1; i <= 80; i++) {
        await cursor(await physical({ x: start.x + i * 2, y: start.y + Math.round(i / 4) }));
        await pet.waitForTimeout(8);
        checkSize(await bounds());
      }
      const after = await bounds();
      assert.ok(Math.abs(after.x - before.x - 160) <= 2, 'native cursor drag must move the pet');
      await cursor(await physical({ x: start.x + 160, y: start.y + 20 }), 4);
      await pet.waitForTimeout(100);
      checkSize(await bounds());
      console.log(`Native 80-step drag passed: display ${display.id}, scale ${display.scaleFactor}, bounds ${JSON.stringify(await bounds())}`);
    }
    // A single held drag across every pair of connected monitors, both ways.
    for (let i = 0; i < displays.length; i++) {
      const from = displays[i], to = displays[(i + 1) % displays.length];
      if (from.id === to.id) continue;
      await pet.evaluate(p => window.petApp.executeInteraction({ type: 'moveTo', ...p }), { x: from.workArea.x + 120, y: from.workArea.y + 70 });
      await pet.waitForTimeout(150);
      const before = await bounds();
      const start = { x: before.x + 100, y: before.y + 240 };
      const finish = { x: to.workArea.x + Math.round(to.workArea.width / 2), y: to.workArea.y + Math.round(to.workArea.height / 2) };
      await cursor(await physical(start));
      await pet.evaluate(() => window.petApp.ignoreMouse(false));
      await cursor(await physical(start), 2);
      await pet.waitForTimeout(50);
      for (let n = 1; n <= 100; n++) {
        const p = { x: Math.round(start.x + (finish.x - start.x) * n / 100), y: Math.round(start.y + (finish.y - start.y) * n / 100) };
        await cursor(await physical(p));
        await pet.waitForTimeout(10);
        checkSize(await bounds());
      }
      await cursor(await physical(finish), 4);
      await pet.waitForTimeout(200);
      const final = await bounds();
      checkSize(final);
      assert.equal(await desktop.evaluate(({ screen }, b) => screen.getDisplayMatching(b).id, final), to.id);
      console.log(`Native cross-display drag passed: ${from.id} -> ${to.id}, bounds ${JSON.stringify(final)}`);
    }
  } finally {
    await cursor(originalCursor, 4);
  }
  console.log('DPI smoke passed (real cursor input, current physical monitors).');
} finally {
  helper?.stdin.end();
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
