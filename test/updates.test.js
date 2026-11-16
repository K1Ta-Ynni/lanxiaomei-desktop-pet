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
