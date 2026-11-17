// Launch a real portable runtime with the current updater, then exercise its
// renderer IPC → helper → application exit → file replacement → automatic restart.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { cp, mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-update-lifecycle-'));
const data = join(temp, '用户 data'), extracted = join(temp, 'portable app');
const sourceZip = resolve(process.argv[2] || join(root, 'dist/lanxiaomei-desktop-pet-v2.0.0-companion-win32-x64.zip'));
const target = JSON.parse(await readFile(join(root, 'dist/latest-build-basic.json'), 'utf8'));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
let desktop, install;
function ps(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8' });
}
async function waitFor(check, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out: ' + label);
}
try {
  await mkdir(data);
  await writeFile(join(data, 'preferences.json'), JSON.stringify({ muted: true, idleActions: false }));
  ps(`Expand-Archive -LiteralPath ${quote(sourceZip)} -DestinationPath ${quote(extracted)}`);
  const [folder] = await readdir(extracted);
  install = join(extracted, folder);
  const appRoot = join(install, 'resources/app');
  // Keep the old package version/runtime so a newer target is offered. All
  // update code and the launcher come from the current working tree.
  await cp(join(root, 'src'), join(appRoot, 'src'), { recursive: true });
  const release = {
    tag_name: `v${target.version}`, html_url: `https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/tag/v${target.version}`,
    assets: [{ name: target.zip.split(/[\\/]/u).at(-1), state: 'uploaded', size: target.size, digest: `sha256:${target.sha256}`,
      browser_download_url: `https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/download/v${target.version}/${target.zip.split(/[\\/]/u).at(-1)}` }],
  };
  const env = { ...process.env, PET_STARTER_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  desktop = await electron.launch({ executablePath: join(install, 'LanXiaomei.exe'), args: [], env, timeout: 40000 });
  const pet = await desktop.firstWindow();
  await pet.locator('#pet').waitFor();
  const oldPid = await desktop.evaluate(() => process.pid);
  // No real network access: transport uses the locally built, previously
  // verified ZIP. The application update handler and installer stay intact.
  await desktop.evaluate(({ net }, { release, fileUrl }) => {
    const fetch = net.fetch.bind(net);
    net.fetch = async url => {
      if (url.includes('/releases?')) return Response.json([release]);
      if (url === release.assets[0].browser_download_url) return fetch(fileUrl);
      throw new Error('Unexpected update URL');
    };
  }, { release, fileUrl: pathToFileURL(target.zip).href });
  assert.equal((await pet.evaluate(() => window.petApp.checkUpdates())).phase, 'available');
  assert.equal((await pet.evaluate(() => window.petApp.downloadUpdate())).phase, 'downloaded');
  const closed = desktop.waitForEvent('close', { timeout: 90000 });
  assert.equal((await pet.evaluate(() => window.petApp.installUpdate())).restarting, true);
  await closed;
  desktop = undefined;
  const updates = join(data, 'updates');
  const job = join(updates, (await readdir(updates)).find(name => name.startsWith('install-')));
  await waitFor(async () => {
    const result = JSON.parse(await readFile(join(job, 'result.json'), 'utf8'));
    if (['error', 'restore-required'].includes(result.state)) throw new Error(result.message);
    return result.state === 'installed';
  }, 'helper survives old Electron exit and replaces the application');
  assert.equal(JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')).version, target.version);
  await waitFor(() => {
    const ids = ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${quote(join(install, 'LanXiaomei.exe'))} -and $_.CommandLine -notlike '*--type=*' -and $_.ProcessId -ne ${oldPid} } | Select-Object -ExpandProperty ProcessId`).trim();
    return Boolean(ids);
  }, 'replacement automatically restarts a new Electron main process');
  assert.ok(JSON.parse(await readFile(join(job, 'helper-launch.json'), 'utf8')).pid > 0);
  assert.equal((await readFile(join(job, 'helper-error.log'), 'utf8')).trim(), '');
  console.log(`PASS: real update lifecycle to v${target.version}: download + IPC + hidden helper + old app exit + replacement + automatic restart (Chinese/spaced paths).`);
} finally {
  await desktop?.close().catch(() => {});
  if (install && resolve(install).startsWith(resolve(temp) + '\\')) {
    ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${quote(join(install, 'LanXiaomei.exe'))} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
