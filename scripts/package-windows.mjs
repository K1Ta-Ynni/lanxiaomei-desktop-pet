import { cp, readFile, writeFile, mkdir, mkdtemp, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This packaging script requires Windows x64.');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const name = `lanxiaomei-desktop-pet-v${pkg.version}-win32-x64`;
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
// Use a fresh build folder every time; never delete or reuse a user's existing folder.
const build = await mkdtemp(join(dist, 'build-'));
const output = join(build, name);
await cp(join(root, 'node_modules/electron/dist'), output, { recursive: true,
  filter: path => !path.endsWith('default_app.asar') });
await rename(join(output, 'electron.exe'), join(output, 'LanXiaomei.exe'));
const app = join(output, 'resources', 'app');
await mkdir(app, { recursive: true });
for (const entry of ['src', 'assets', 'character', 'package.json', 'README.md', 'ASSETS.md', 'LICENSE', 'INTERACTIONS.md']) {
  await cp(join(root, entry), join(app, entry), { recursive: true });
}
await cp(join(root, 'ASSETS.md'), join(output, 'ASSETS.md'));
await cp(join(root, 'LICENSE'), join(output, 'LICENSE-APP.txt'));
await writeFile(join(output, 'START.cmd'), '@echo off\r\nstart "" "%~dp0LanXiaomei.exe"\r\n', 'utf8');
await writeFile(join(output, '使用说明.txt'), '\uFEFF蓝小妹桌宠 v' + pkg.version + '\r\n\r\n完整解压压缩包后双击 LanXiaomei.exe 或 START.cmd。不要在压缩包内直接运行。\r\n无需安装 Node.js，无需 API Key。Windows x64。\r\n点击角色打招呼；按住拖动；右键或齿轮打开互动面板。\r\n可做动作、休息/唤醒、调大小与音量、导入表情包及播放本地录音。\r\n模型与聊天入口暂未开放。默认不附带录音和表情包。\r\n立绘原型来源：B站 UP 蓝世_1967。素材许可见 ASSETS.md。\r\n项目地址：' + pkg.homepage + '\r\n设置保存在 %APPDATA%/lanxiaomei-desktop-pet。\r\n语音与表情包目录位于 resources/app/assets 下。\r\n', 'utf8');
const zip = join(dist, `${name}.zip`);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const command = `Compress-Archive -LiteralPath ${quote(output)} -DestinationPath ${quote(zip)} -CompressionLevel Optimal -Force`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'inherit', windowsHide: true });
if (result.status !== 0) throw new Error('Windows ZIP packaging failed.');
const sha256 = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(join(dist, 'SHA256SUMS.txt'), `${sha256}  ${name}.zip\n`, 'utf8');
await writeFile(join(dist, 'latest-build.json'), JSON.stringify({ output, zip, size: (await stat(zip)).size, sha256 }, null, 2));
console.log(JSON.stringify({ output, zip, sha256 }, null, 2));
