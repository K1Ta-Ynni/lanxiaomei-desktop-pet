import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const build = JSON.parse(await readFile(join(root, 'dist', 'latest-build.json'), 'utf8'));
const data = await mkdtemp(join(tmpdir(), 'lanxiaomei-package-'));
const env = { ...process.env, PET_STARTER_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
let desktop;
try {
  const extracted = join(data, 'extracted');
  await mkdir(extracted);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath ${quote(build.zip)} -DestinationPath ${quote(extracted)}`], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Release ZIP extraction failed.');
  desktop = await electron.launch({ executablePath: join(extracted, basename(build.output), 'LanXiaomei.exe'), args: [], env, timeout: 40000 });
  const pet = await desktop.firstWindow();
  await pet.locator('#greeting').waitFor({ state: 'visible' });
  assert.equal(await pet.title(), '蓝小妹');
  assert.equal(await pet.evaluate(() => window.petApp.info()).then(info => info.features.ai), false);
  await pet.evaluate(() => window.petApp.executeInteraction({ type: 'jump' }));
  await pet.waitForFunction(() => document.querySelector('#pet').classList.contains('action-jump'));
  const opened = desktop.waitForEvent('window', page => page.waitForURL('**/settings.html').then(() => true));
  await pet.evaluate(() => window.petApp.openSettings());
  const settings = await opened;
  await settings.locator('#import-stickers').waitFor();
  console.log('Packaged Windows app passed: independent executable starts, portrait loads, actions and interaction panel work.');
} finally {
  await desktop?.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
