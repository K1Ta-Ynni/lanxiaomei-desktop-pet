import { mkdir, open, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const REPOSITORY = 'K1Ta-Ynni/lanxiaomei-desktop-pet';
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
const LIMIT = 1024 * 1024 * 1024;

function versionParts(input) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(input);
  if (!match) return null;
  return { numbers: match.slice(1, 4).map(Number), pre: match[4]?.split('.') || [] };
}

export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) throw new Error('版本号格式不正确。');
  for (let index = 0; index < 3; index++) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] > right.numbers[index] ? 1 : -1;
  }
  if (!left.pre.length || !right.pre.length) return Number(!left.pre.length) - Number(!right.pre.length);
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const x = left.pre[index], y = right.pre[index];
    if (x === undefined || y === undefined) return Number(x !== undefined) - Number(y !== undefined);
    if (x === y) continue;
    const nx = /^\d+$/u.test(x), ny = /^\d+$/u.test(y);
    if (nx && ny) { if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1; continue; }
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function validateReleaseUrl(value, asset = false) {
  const url = new URL(value);
  const prefix = `/${REPOSITORY}/releases/${asset ? 'download/' : 'tag/'}`;
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(prefix) || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('更新链接不是本项目的 GitHub 发布地址。');
  }
  return url.href;
}

function releaseAsset(release, version, edition, platform, arch) {
  const prefix = `lanxiaomei-desktop-pet-v${version}-`;
  const names = edition === 'basic'
    ? [`${prefix}basic-${platform}-${arch}.zip`, `${prefix}${platform}-${arch}.zip`]
    : [`${prefix}${edition}-${platform}-${arch}.zip`];
  for (const filename of names) {
    const asset = release.assets?.find(row => row.name === filename && row.state === 'uploaded' && Number.isSafeInteger(row.size) && row.size > 0 && row.size <= LIMIT);
    if (asset) return asset;
  }
  return null;
}

export function selectRelease(releases, currentVersion, { includePrereleases = true, platform = process.platform, arch = process.arch,
  edition = 'basic', currentEdition = 'basic' } = {}) {
  if (!Array.isArray(releases)) throw new Error('GitHub 返回的版本列表格式不正确。');
  if (!['basic', 'companion'].includes(edition) || !['basic', 'companion'].includes(currentEdition)) throw new Error('Invalid update edition.');
  const candidates = releases.filter(row => !row.draft && (includePrereleases || !row.prerelease) && versionParts(row.tag_name))
    .map(release => ({ release, version: release.tag_name.replace(/^v/u, '') }))
    .sort((a, b) => compareVersions(b.version, a.version));
  const selected = candidates.find(row => releaseAsset(row.release, row.version, edition, platform, arch)) || candidates[0];
  if (!selected) return null;
  const { release, version } = selected;
  const asset = releaseAsset(release, version, edition, platform, arch);
  const digest = /^sha256:[a-f\d]{64}$/iu.test(asset?.digest || '') ? asset.digest.slice(7).toLowerCase() : null;
  const checksum = asset && release.assets?.find(row => row.name === `${asset.name}.sha256` && row.state === 'uploaded' && row.size > 0 && row.size < 100000)
    || release.assets?.find(row => row.name === 'SHA256SUMS.txt' && row.state === 'uploaded' && row.size > 0 && row.size < 100000);
  return {
    version, edition, available: Boolean(asset) && (compareVersions(version, currentVersion) > 0 || edition !== currentEdition),
    name: String(release.name || release.tag_name).slice(0, 200),
    notes: String(release.body || '').slice(0, 20000), prerelease: Boolean(release.prerelease),
    url: validateReleaseUrl(release.html_url),
    asset: asset ? { name: asset.name, size: asset.size, url: validateReleaseUrl(asset.browser_download_url, true), digest,
      checksumUrl: checksum ? validateReleaseUrl(checksum.browser_download_url, true) : null } : null,
  };
}

export class UpdateManager {
  constructor({ version, edition = 'basic', directory, fetcher, onChange = () => {}, platform, arch }) {
    this.version = version;
    this.edition = ['basic', 'companion'].includes(edition) ? edition : 'basic';
    this.directory = directory;
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.platform = platform;
    this.arch = arch;
    this.state = { phase: 'idle', currentVersion: version, currentEdition: this.edition, targetEdition: this.edition, release: null, received: 0, total: 0, error: '' };
    this.controller = null;
    this.downloaded = null;
  }

  snapshot() { return structuredClone(this.state); }
  update(value) { Object.assign(this.state, value); this.onChange(this.snapshot()); }
  cancel() { this.controller?.abort(); }

  async request(url, signal) {
    const response = await this.fetcher(url, { headers: { Accept: url === API_URL ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'Lanxiaomei-Desktop-Pet' }, signal });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new Error('GitHub 请求过于频繁，请稍后重试。');
      throw new Error(`更新服务器返回 HTTP ${response.status}。`);
    }
    return response;
  }

  async check(includePrereleases = true, targetEdition = this.edition) {
    if (!['basic', 'companion'].includes(targetEdition)) throw new Error('Invalid update edition.');
    if (this.controller || ['preparing', 'installing'].includes(this.state.phase)) throw new Error('更新操作正在进行，请稍等。');
    this.controller = new AbortController();
    this.downloaded = null;
    this.update({ phase: 'checking', error: '', release: null, received: 0, total: 0 });
    try {
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(25000)]);
      const response = await this.request(API_URL, signal);
      const release = selectRelease(await response.json(), this.version, { includePrereleases, platform: this.platform, arch: this.arch,
        edition: targetEdition, currentEdition: this.edition });
      this.update({ phase: release?.available ? 'available' : 'current', release, targetEdition });
    } catch (error) {
      this.update({ phase: 'error', error: error.name === 'TimeoutError' ? '检查更新超时，请检查网络或系统代理后重试。' : error.message });
    } finally { this.controller = null; }
    return this.snapshot();
  }

  async download() {
    if (this.controller || ['preparing', 'installing'].includes(this.state.phase)) throw new Error('更新操作正在进行，请稍等。');
    const release = this.state.release;
    if (!release?.available || !release.asset) throw new Error('请先检查更新，并确认该版本已上传适合本机的压缩包。');
    const asset = release.asset;
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(30 * 60 * 1000)]);
    const partial = join(this.directory, `${asset.name}.${randomUUID()}.part`);
    const target = join(this.directory, asset.name);
    let file;
    this.update({ phase: 'downloading', received: 0, total: asset.size, error: '' });
    try {
      let expected = asset.digest;
      if (!expected && asset.checksumUrl) {
        const checksumResponse = await this.request(asset.checksumUrl, signal);
        const lines = (await checksumResponse.text()).split(/\r?\n/u);
        expected = lines.map(line => /^([a-f\d]{64})\s+\*?(.+)$/iu.exec(line)).find(row => row?.[2] === asset.name)?.[1]?.toLowerCase();
      }
      if (!expected) throw new Error('此版本尚未提供 SHA-256 校验信息，请到发布页下载，或等待作者补全附件。');
      await mkdir(this.directory, { recursive: true });
      const response = await this.request(asset.url, signal);
      if (!response.body) throw new Error('下载没有返回文件内容。');
      file = await open(partial, 'wx');
      const hash = createHash('sha256');
      let received = 0, lastReport = 0;
      for await (const chunk of response.body) {
        if (signal.aborted) throw signal.reason;
        received += chunk.byteLength;
        if (received > asset.size || received > LIMIT) throw new Error('下载大小超过版本记录，已停止。');
        hash.update(chunk);
        await file.writeFile(chunk);
        if (Date.now() - lastReport > 150) { this.update({ received }); lastReport = Date.now(); }
      }
      this.update({ phase: 'verifying', received });
      if (received !== asset.size || hash.digest('hex') !== expected) throw new Error('更新包校验失败，请重新下载。');
      await file.close(); file = null;
      await rename(partial, target);
      this.downloaded = { path: target, sha256: expected, version: release.version, edition: release.edition };
      this.update({ phase: 'downloaded' });
    } catch (error) {
      this.downloaded = null;
      this.update({ phase: this.controller.signal.aborted ? 'cancelled' : 'error', error: this.controller.signal.aborted ? '已取消下载。' : error.message });
    } finally {
      await file?.close().catch(() => {});
      await rm(partial, { force: true }).catch(() => {});
      this.controller = null;
    }
    return this.snapshot();
  }
}

export async function prepareInstallJob({ downloaded, installDirectory, executable, pid, processStarted, directory, script }) {
  if (!downloaded) throw new Error('请先下载并校验新版。');
  const hash = createHash('sha256').update(await readFile(downloaded.path)).digest('hex');
  if (hash !== downloaded.sha256) throw new Error('本地更新包已改变，请重新下载。');
  const job = join(directory, `install-${randomUUID()}`);
  await mkdir(job, { recursive: true });
  await writeFile(join(job, 'install.ps1'), await readFile(script));
  await writeFile(join(job, 'job.json'), '\uFEFF' + JSON.stringify({ zip: downloaded.path, sha256: hash, version: downloaded.version, edition: downloaded.edition || 'basic',
    installDirectory, executable, mediaDirectory: join(dirname(directory), 'media'), pid, processStarted, restart: true }, null, 2), 'utf8');
  return job;
}
