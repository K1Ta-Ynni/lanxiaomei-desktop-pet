// Exercise the released v2 updater (not the current implementation) against real v2.1 ZIPs.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'lanxiaomei-v2-upgrade-'));
let desktop;
try {
  for (const [source, destination] of [['src/updates.js', 'v2-updates.mjs'], ['src/install-update.ps1', 'v2-install.ps1']]) {
    await writeFile(join(temp, destination), execFileSync('git', ['show', `v2.0.0:${source}`], { cwd: root }));
  }
  const { UpdateManager, prepareInstallJob } = await import(pathToFileURL(join(temp, 'v2-updates.mjs')).href);
  const builds = await Promise.all(['basic', 'companion'].map(async edition =>
    JSON.parse(await readFile(join(root, 'dist', `latest-build-${edition}.json`), 'utf8'))));
  const release = {
    tag_name: `v${builds[0].version}`, html_url: `https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/tag/v${builds[0].version}`,
    assets: builds.map(build => ({ name: basename(build.zip), state: 'uploaded', size: build.size, digest: `sha256:${build.sha256}`,
      browser_download_url: `https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/download/v${build.version}/${basename(build.zip)}` })),
  };
  for (const build of builds) {
    const data = join(temp, build.edition, 'profile'), install = join(temp, build.edition, 'installed');
    const updates = join(data, 'updates');
    await mkdir(join(install, 'resources/app/assets/voices'), { recursive: true });
    await mkdir(join(data, 'media/stickers'), { recursive: true });
    await writeFile(join(install, 'LanXiaomei.exe'), 'v2 application placeholder');
    await writeFile(join(install, 'resources/app/package.json'), JSON.stringify({ name: 'lanxiaomei-desktop-pet', version: '2.0.0' }));
    await writeFile(join(install, 'resources/app/edition.json'), JSON.stringify({ edition: build.edition }));
    await writeFile(join(install, 'resources/app/assets/voices/keep.txt'), 'custom v2 recording');
    await writeFile(join(data, 'media/stickers/keep.txt'), 'custom user sticker');
    const preserved = {
      'settings.json': { mode: build.edition, baseUrl: 'https://example.com/v1', model: 'my-existing-model', encryptedApiKey: '', displayName: '升级测试' },
      'preferences.json': { muted: true, idleActions: false, scale: 0.8, voicePlaylist: { mode: 'sequence', ids: [] },
        stickerPlaylist: { mode: 'repeat', ids: [] }, musicPlaylist: { mode: 'random', ids: [] }, portraitMode: 'laugh' },
      'conversation.json': [{ role: 'user', content: '保留旧聊天' }, { role: 'assistant', content: '好的' }],
      'assistant-memory.json': [{ id: 'old-memory', text: '保留旧记忆', createdAt: '2026-11-17' }],
      'media-library.json': { version: 2, voice: { groups: ['我的分类'], items: {} }, music: { groups: [], items: {} }, sticker: { groups: [], items: {} } },
    };
    for (const [name, value] of Object.entries(preserved)) await writeFile(join(data, name), JSON.stringify(value));
    const manager = new UpdateManager({ version: '2.0.0', edition: build.edition, directory: updates, platform: 'win32', arch: 'x64', fetcher: async url => {
      if (url.endsWith('/releases?per_page=100')) return Response.json([release]);
      const index = release.assets.findIndex(asset => asset.browser_download_url === url);
      assert.ok(index >= 0, 'download must match an offered archive');
      return new Response(Readable.toWeb(createReadStream(builds[index].zip)));
    } });
    assert.equal((await manager.check()).phase, 'available');
    assert.equal(manager.state.release.asset.name, basename(build.zip));
    assert.equal((await manager.download()).phase, 'downloaded');
    const job = await prepareInstallJob({ downloaded: manager.downloaded, installDirectory: install, executable: 'LanXiaomei.exe',
      pid: 0, processStarted: '', directory: updates, script: join(temp, 'v2-install.ps1') });
    const jobFile = join(job, 'job.json');
    const payload = JSON.parse((await readFile(jobFile, 'utf8')).replace(/^\uFEFF/u, ''));
    payload.restart = false;
    await writeFile(jobFile, '\uFEFF' + JSON.stringify(payload));
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(job, 'install.ps1'), '-JobFile', jobFile], { windowsHide: true, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`v2 installer exited ${code}`)));
    });
    assert.equal(JSON.parse(await readFile(join(job, 'result.json'), 'utf8')).state, 'installed');
    for (const [name, value] of Object.entries(preserved)) assert.deepEqual(JSON.parse(await readFile(join(data, name), 'utf8')), value, `${name} survives replacement`);
    assert.equal(await readFile(join(data, 'media/voices/keep.txt'), 'utf8'), 'custom v2 recording');
    assert.equal(await readFile(join(data, 'media/stickers/keep.txt'), 'utf8'), 'custom user sticker');
    const env = { ...process.env, PET_STARTER_DATA_DIR: data };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    desktop = await electron.launch({ executablePath: join(install, 'LanXiaomei.exe'), args: [], env, timeout: 40000 });
    const pet = await desktop.firstWindow();
    await pet.locator('#pet').waitFor();
    assert.equal((await pet.evaluate(() => window.petApp.info())).features.ai, build.edition === 'companion', 'previous AI selection survives');
    const settings = await pet.evaluate(() => window.petApp.readSettings());
    assert.equal(settings.model, preserved['settings.json'].model);
    assert.equal((await pet.evaluate(() => window.petApp.preferences())).expressionPlaylist.ids[0], 'laugh', 'legacy fixed expression migrates');
    const state = await pet.evaluate(() => window.petApp.updateStatus());
    assert.equal(state.currentVersion, build.version);
    assert.equal(state.currentEdition, 'basic', 'both upgrade paths converge on the unified update channel');
    assert.equal((await pet.evaluate(() => window.petApp.history()))[0].content, '保留旧聊天');
    await desktop.close(); desktop = undefined;
    console.log(`PASS: v2 ${build.edition} updater → v${build.version}, original installer + real ZIP + launched app; data and AI choice preserved.`);
  }
} finally {
  await desktop?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
