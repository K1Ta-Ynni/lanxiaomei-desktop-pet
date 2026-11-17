import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { compareVersions, selectRelease, UpdateManager, validateReleaseUrl } from '../src/updates.js';
import { prepareMedia } from '../src/media.js';

const assetName = 'lanxiaomei-desktop-pet-v0.2.0-win32-x64.zip';
const assetBytes = Buffer.from('verified update fixture');
const digest = createHash('sha256').update(assetBytes).digest('hex');
const release = { tag_name: 'v0.2.0', name: 'v0.2.0', body: 'Update notes', html_url: 'https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/tag/v0.2.0',
  assets: [{ name: assetName, state: 'uploaded', size: assetBytes.length, digest: `sha256:${digest}`,
    browser_download_url: `https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/download/v0.2.0/${assetName}` }] };

test('compares stable and prerelease versions in semantic order', () => {
  assert.equal(compareVersions('v0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('0.2.0-rc.10', '0.2.0-rc.2'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0-rc.10'), 1);
  assert.throws(() => compareVersions('latest', '0.2.0'));
});

test('accepts only uploaded update assets for this repository and platform', () => {
  const selected = selectRelease([release], '0.1.0', { platform: 'win32', arch: 'x64' });
  assert.equal(selected.available, true);
  assert.equal(selected.asset.digest, digest);
  assert.equal(selectRelease([release], '0.1.0', { platform: 'linux', arch: 'x64' }).asset, null);
  assert.equal(selectRelease([{ ...release, draft: true }], '0.1.0'), null);
  assert.throws(() => validateReleaseUrl('https://example.com/download.zip', true));
  assert.throws(() => validateReleaseUrl('https://github.com/K1Ta-Ynni/another/releases/tag/v0.2.0'));
});

test('selects the requested edition and treats edition switching as an update even at the same version', () => {
  const companionName = 'lanxiaomei-desktop-pet-v0.2.0-companion-win32-x64.zip';
  const companion = { ...release, assets: [...release.assets, { name: companionName, state: 'uploaded', size: assetBytes.length,
    browser_download_url: `https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases/download/v0.2.0/${companionName}` }] };
  const switchUp = selectRelease([companion], '0.2.0', { platform: 'win32', arch: 'x64', edition: 'companion', currentEdition: 'basic' });
  assert.equal(switchUp.available, true);
  assert.equal(switchUp.asset.name, companionName);
  const stayBasic = selectRelease([companion], '0.2.0', { platform: 'win32', arch: 'x64', edition: 'basic', currentEdition: 'basic' });
  assert.equal(stayBasic.available, false);
  assert.equal(stayBasic.asset.name, assetName, 'legacy basic packages remain eligible for basic installations');
  const downgrade = selectRelease([companion], '0.3.0', { platform: 'win32', arch: 'x64', edition: 'basic', currentEdition: 'companion' });
  assert.equal(downgrade.available, true);
  assert.equal(downgrade.version, '0.2.0');
});

test('downloads update into a separate directory and verifies size and SHA-256', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lanxiaomei-update-'));
  try {
    const manager = new UpdateManager({ version: '0.1.0', directory: join(data, 'updates'), platform: 'win32', arch: 'x64', fetcher: async url => {
      if (url.endsWith('/releases?per_page=100')) return Response.json([release]);
      if (url === release.assets[0].browser_download_url) return new Response(assetBytes);
      throw new Error('Unexpected update URL');
    } });
    assert.equal((await manager.check()).phase, 'available');
    assert.equal((await manager.download()).phase, 'downloaded');
    assert.deepEqual(await readFile(join(data, 'updates', assetName)), assetBytes);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('a bad digest fails closed and leaves no partial file', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lanxiaomei-update-bad-'));
  try {
    const manager = new UpdateManager({ version: '0.1.0', directory: join(data, 'updates'), platform: 'win32', arch: 'x64', fetcher: async url =>
      url.endsWith('/releases?per_page=100') ? Response.json([release]) : new Response(Buffer.from('tampered')) });
    await manager.check();
    const state = await manager.download();
    assert.equal(state.phase, 'error');
    assert.match(state.error, /校验失败/u);
    await mkdir(join(data, 'updates'), { recursive: true });
    assert.deepEqual(await readdir(join(data, 'updates')), []);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('portable media migration fills missing files without replacing user edits', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lanxiaomei-media-'));
  try {
    const root = join(data, 'app'), userData = join(data, 'profile');
    await mkdir(join(root, 'assets', 'stickers'), { recursive: true });
    await mkdir(join(userData, 'media', 'stickers'), { recursive: true });
    await writeFile(join(root, 'assets', 'stickers', 'readme.txt'), 'bundled instructions');
    await writeFile(join(root, 'assets', 'stickers', 'happy.png'), 'old original');
    await writeFile(join(userData, 'media', 'stickers', 'happy.png'), 'user edit');
    const directories = await prepareMedia({ root, userData, packaged: true });
    assert.equal(await readFile(join(directories.stickersDirectory, 'happy.png'), 'utf8'), 'user edit');
    assert.equal(await readFile(join(directories.stickersDirectory, 'readme.txt'), 'utf8'), 'bundled instructions');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('bundled voice pack adds missing clips and nested files while retaining user labels and recordings', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lanxiaomei-voice-merge-'));
  try {
    const root = join(data, 'app'), userData = join(data, 'profile');
    const bundled = join(root, 'assets', 'voices'), personal = join(userData, 'media', 'voices');
    await mkdir(join(bundled, 'pack'), { recursive: true });
    await mkdir(join(personal, 'pack'), { recursive: true });
    await writeFile(join(bundled, 'manifest.json'), JSON.stringify({ clips: [{ id: 'old', file: 'pack/old.wav', label: 'bundled' }, { id: 'new', file: 'pack/new.wav' }] }));
    const original = JSON.stringify({ clips: [{ id: 'old', file: 'pack/old.wav', label: 'user label' }, { id: 'personal', file: 'mine.wav' }] });
    await writeFile(join(personal, 'manifest.json'), original);
    await writeFile(join(bundled, 'pack', 'old.wav'), 'bundled old');
    await writeFile(join(bundled, 'pack', 'new.wav'), 'bundled new');
    await writeFile(join(personal, 'pack', 'old.wav'), 'user edited audio');
    await prepareMedia({ root, userData, packaged: true });
    await prepareMedia({ root, userData, packaged: true });
    const catalog = JSON.parse(await readFile(join(personal, 'manifest.json'), 'utf8'));
    assert.deepEqual(catalog.clips.map(clip => clip.id), ['old', 'personal', 'new']);
    assert.equal(catalog.clips[0].label, 'user label');
    assert.equal(await readFile(join(personal, 'pack', 'old.wav'), 'utf8'), 'user edited audio');
    assert.equal(await readFile(join(personal, 'pack', 'new.wav'), 'utf8'), 'bundled new');
    assert.equal(await readFile(join(personal, 'manifest.before-bundled-import.json'), 'utf8'), original);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('download cancellation removes the partial file and allows retry', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lanxiaomei-update-cancel-'));
  try {
    const manager = new UpdateManager({ version: '0.1.0', directory: join(data, 'updates'), platform: 'win32', arch: 'x64', fetcher: async (url, options) => {
      if (url.endsWith('/releases?per_page=100')) return Response.json([release]);
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(assetBytes.subarray(0, 3));
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
      } }));
    }, onChange: state => { if (state.phase === 'downloading' && state.received > 0) manager.cancel(); } });
    await manager.check();
    assert.equal((await manager.download()).phase, 'cancelled');
    assert.deepEqual(await readdir(join(data, 'updates')), []);
    assert.equal(manager.controller, null);
  } finally { await rm(data, { recursive: true, force: true }); }
});
