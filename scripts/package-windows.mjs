import { cp, readFile, writeFile, mkdir, mkdtemp, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rcedit } from 'rcedit';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This packaging script requires Windows x64.');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (process.argv.some(arg => arg.startsWith('--edition='))) throw new Error('Use package:windows: v2.1 is one product with optional AI.');
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice('--label='.length) || '';
if (label && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/u.test(label)) throw new Error('Build label must contain only letters, digits and hyphens.');
const name = `lanxiaomei-desktop-pet-v${pkg.version}${label ? '-' + label : ''}-win32-x64`;
const legacyName = `lanxiaomei-desktop-pet-v${pkg.version}-companion${label ? '-' + label : ''}-win32-x64`;
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
const zip = join(dist, `${name}.zip`);
for (const filename of [zip, join(dist, `${legacyName}.zip`)]) {
  try { await stat(filename); throw new Error(`Refusing to overwrite existing build: ${filename}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// Use a fresh build folder every time; never delete or reuse a user's existing folder.
const build = await mkdtemp(join(dist, 'build-'));
const output = join(build, name);
await cp(join(root, 'node_modules/electron/dist'), output, { recursive: true,
  filter: path => !path.endsWith('default_app.asar') });
await rename(join(output, 'electron.exe'), join(output, 'LanXiaomei.exe'));
await rcedit(join(output, 'LanXiaomei.exe'), {
  icon: join(root, 'assets', 'icon.ico'),
  'version-string': { ProductName: pkg.productName, FileDescription: pkg.description,
    CompanyName: 'K1Ta-Ynni', OriginalFilename: 'LanXiaomei.exe', InternalName: pkg.name },
  'file-version': pkg.version,
  'product-version': pkg.version,
});
const app = join(output, 'resources', 'app');
await mkdir(app, { recursive: true });
for (const entry of ['src', 'assets', 'character', 'package.json', 'README.md', 'PLAY_GUIDE.md', 'ASSETS.md', 'LICENSE', 'INTERACTIONS.md', 'UPDATING.md', 'CHANGELOG.md']) {
  await cp(join(root, entry), join(app, entry), { recursive: true });
}
await cp(join(root, 'ASSETS.md'), join(output, 'ASSETS.md'));
await cp(join(root, 'PLAY_GUIDE.md'), join(output, 'PLAY_GUIDE.md'));
await cp(join(root, 'LICENSE'), join(output, 'LICENSE-APP.txt'));
await writeFile(join(output, 'START.cmd'), '@echo off\r\nstart "" "%~dp0LanXiaomei.exe"\r\n', 'utf8');
const instructions = [
  `蓝小妹桌宠 v${pkg.version} · 主体版`, '',
  '完整解压后双击 LanXiaomei.exe 或 START.cmd。不要在压缩包内直接运行。',
  'Windows x64；无需安装 Node.js。默认仅本地运行，AI 聊天可按需开启。',
  '第一次使用请阅读同目录 PLAY_GUIDE.md（游玩指南）。',
  '点击角色互动；按住可跨显示器拖动；齿轮或右键打开“蓝神のLivehouse”。',
  '侧栏提供互动小屋、语音、表情包、音乐、偏好、AI 与模型及版本更新。',
  '常驻表情、语音、表情包和歌曲可管理列表；素材支持本地改名、分类与批量编辑。',
  '音乐支持播放/暂停、停止、进度、切歌、播放模式与实时音量，播放时有专用音乐动画。',
  '启动会随机播放入场语音；静音仍保留字幕和动作。',
  'Ctrl+Alt+G 切换游戏模式（仅鼠标穿透，其他功能保留）。',
  'Ctrl+Alt+H 独立隐藏/显示。重启恢复普通显示。',
  '窗口关闭后收进托盘；退出请使用托盘菜单。',
  'AI 与模型：填入标准 API Key、模型 ID 和 API 地址后，可选开启文字聊天与记忆。',
  'AI 不合成语音回复；仅根据明确指令调用本地录音、歌曲或表情包。DSH 插件尚未提供。',
  'v2 的两种包均可通过原位更新升级，保留设置、密钥、聊天、记忆、分类、列表和媒体。',
  '带 -companion 文件名的附件仅用于旧更新器过渡，安装后同为主体版。',
  '用户数据：%APPDATA%/lanxiaomei-desktop-pet；自定义媒体位于其中的 media 目录。',
  '立绘原型：B站 UP 蓝世_1967。素材许可见 ASSETS.md。',
  `项目地址：${pkg.homepage}`, '',
];
await writeFile(join(output, '使用说明.txt'), '\uFEFF' + instructions.join('\r\n'), 'utf8');

const quote = value => "'" + value.replaceAll("'", "''") + "'";
const checksums = [];
try {
  for (const [edition, filename] of [['basic', name], ['companion', legacyName]]) {
    // v2 verifies this field strictly. The app ignores it and always uses the unified update channel.
    await writeFile(join(app, 'edition.json'), JSON.stringify({ edition, unified: true }, null, 2) + '\n', 'utf8');
    const archive = join(dist, `${filename}.zip`);
    const command = `Compress-Archive -LiteralPath ${quote(output)} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error('Windows ZIP packaging failed.');
    const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
    const checksum = `${sha256}  ${filename}.zip\n`;
    checksums.push(checksum);
    await writeFile(`${archive}.sha256`, checksum, 'utf8');
    const metadata = { output, zip: archive, size: (await stat(archive)).size, sha256, edition, unified: true, version: pkg.version };
    await writeFile(join(dist, `latest-build-${edition}.json`), JSON.stringify(metadata, null, 2) + '\n');
    if (edition === 'basic') await writeFile(join(dist, 'latest-build.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify(metadata, null, 2));
  }
  await writeFile(join(dist, 'SHA256SUMS.txt'), checksums.join(''), 'utf8');
} finally {
  await writeFile(join(app, 'edition.json'), JSON.stringify({ edition: 'basic', unified: true }, null, 2) + '\n', 'utf8');
}
