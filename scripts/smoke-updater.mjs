import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('The updater integration test requires Windows.');
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-updater-test-'));
const install = join(temp, 'installed');
const update = join(temp, 'user-data', 'updates', 'install-smoke');
const media = join(temp, 'user-data', 'media');
const newer = join(temp, 'package', 'lanxiaomei-desktop-pet-v0.2.0-win32-x64');
const zip = join(update, 'update.zip');
try {
  for (const path of [join(install, 'resources', 'app', 'assets', 'voices'), join(install, 'resources', 'app', 'assets', 'stickers'),
    join(newer, 'resources', 'app', 'assets', 'voices'), join(newer, 'resources', 'app', 'assets', 'stickers'), update, join(media, 'stickers')]) {
    await mkdir(path, { recursive: true });
  }
  await writeFile(join(install, 'LanXiaomei.exe'), 'old application');
  await writeFile(join(install, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'lanxiaomei-desktop-pet', version: '0.1.0' }));
  await writeFile(join(install, 'resources', 'app', 'assets', 'voices', 'manifest.json'), JSON.stringify({ clips: [{ id: 'old', file: 'old.wav' }] }));
  await writeFile(join(install, 'resources', 'app', 'assets', 'voices', 'old.wav'), 'old voice');
  await writeFile(join(install, 'resources', 'app', 'assets', 'stickers', '笑.png'), 'old sticker');
  await writeFile(join(media, 'stickers', '笑.png'), 'user-edited sticker');
  await writeFile(join(newer, 'LanXiaomei.exe'), 'new application');
  await writeFile(join(newer, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'lanxiaomei-desktop-pet', version: '0.2.0' }));
  await writeFile(join(newer, 'resources', 'app', 'assets', 'voices', 'manifest.json'), JSON.stringify({ clips: [] }));
  await writeFile(join(newer, 'resources', 'app', 'assets', 'stickers', 'README.md'), 'new instructions');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const compressed = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Compress-Archive -LiteralPath ${quote(newer)} -DestinationPath ${quote(zip)} -CompressionLevel NoCompression`], { windowsHide: true });
  if (compressed.status !== 0) throw new Error('Could not make updater test ZIP.');
  const sha256 = createHash('sha256').update(await readFile(zip)).digest('hex');
  await writeFile(join(update, 'job.json'), '\uFEFF' + JSON.stringify({ zip, sha256, version: '0.2.0', installDirectory: install,
    executable: 'LanXiaomei.exe', mediaDirectory: media, pid: 0, processStarted: '', restart: false }), 'utf8');
  const applied = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'src', 'install-update.ps1'), '-JobFile', join(update, 'job.json')],
    { windowsHide: true, encoding: 'utf8', timeout: 60000 });
  if (applied.status !== 0) throw new Error(`Update install helper failed: ${applied.stderr || applied.stdout}`);
  const result = JSON.parse(await readFile(join(update, 'result.json'), 'utf8'));
  assert.equal(result.state, 'installed');
  assert.equal(await readFile(join(install, 'resources', 'app', 'package.json'), 'utf8').then(value => JSON.parse(value).version), '0.2.0');
  assert.equal(await readFile(join(media, 'voices', 'old.wav'), 'utf8'), 'old voice');
  assert.equal(await readFile(join(media, 'voices', 'manifest.json'), 'utf8'), JSON.stringify({ clips: [{ id: 'old', file: 'old.wav' }] }));
  assert.equal(await readFile(join(media, 'stickers', '笑.png'), 'utf8'), 'user-edited sticker');
  assert.equal(await readFile(join(install, 'resources', 'app', 'assets', 'stickers', 'README.md'), 'utf8'), 'new instructions');
  assert.equal(await readFile(join(update, 'backup', 'LanXiaomei.exe'), 'utf8'), 'old application');
  console.log('Updater smoke passed: in-place app replacement, rollback backup, legacy voice/sticker migration and preservation of user edits.');
} finally { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
