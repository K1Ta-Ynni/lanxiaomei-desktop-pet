import { cp, readFile, writeFile, mkdir, mkdtemp, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rcedit } from 'rcedit';

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
await rcedit(join(output, 'LanXiaomei.exe'), {
  icon: join(root, 'assets', 'icon.ico'),
  'version-string': { ProductName: pkg.productName, FileDescription: pkg.description,
    CompanyName: 'K1Ta-Ynni', OriginalFilename: 'LanXiaomei.exe', InternalName: pkg.name },
  'file-version': pkg.version,
  'product-version': pkg.version,
});
const app = join(output, 'resources', 'app');
await mkdir(app, { recursive: true });
for (const entry of ['src', 'assets', 'character', 'package.json', 'README.md', 'ASSETS.md', 'LICENSE', 'INTERACTIONS.md', 'UPDATING.md', 'CHANGELOG.md']) {
  await cp(join(root, entry), join(app, entry), { recursive: true });
}
await cp(join(root, 'ASSETS.md'), join(output, 'ASSETS.md'));
await cp(join(root, 'LICENSE'), join(output, 'LICENSE-APP.txt'));
await writeFile(join(output, 'START.cmd'), '@echo off\r\nstart "" "%~dp0LanXiaomei.exe"\r\n', 'utf8');
  await writeFile(join(output, '使用说明.txt'), '\uFEFF蓝小妹桌宠 v' + pkg.version + '\r\n\r\n完整解压压缩包后双击 LanXiaomei.exe 或 START.cmd。不要在压缩包内直接运行。\r\n无需安装 Node.js，无需 API Key。Windows x64。\r\n点击角色打招呼；按住仅在当前显示器内拖动；右键或齿轮打开互动面板。\r\n可做动作、休息/唤醒、调大小与音量、导入表情包及播放本地录音。\r\n桌宠、设置与聊天面板不在任务栏显示。关闭桌宠窗口时收进托盘；点击托盘可恢复，退出请使用托盘菜单。\r\n附带 31 段分组录音，歌曲只手动点播。模型与聊天入口暂未开放。\r\nCtrl+Alt+G 切换游戏模式：保留立绘、鼠标穿透，暂停互动。\r\nCtrl+Alt+H 独立隐藏/显示，也可通过托盘或互动面板切换。\r\n两个开关均在重启后恢复普通显示。\r\n立绘原型来源：B站 UP 蓝世_1967。素材许可见 ASSETS.md。\r\n项目地址：' + pkg.homepage + '\r\n设置保存在 %APPDATA%/lanxiaomei-desktop-pet。\r\n语音与表情包保存在 %APPDATA%/lanxiaomei-desktop-pet/media，更新时保留。\r\n', 'utf8');
const zip = join(dist, `${name}.zip`);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const command = `Compress-Archive -LiteralPath ${quote(output)} -DestinationPath ${quote(zip)} -CompressionLevel Optimal -Force`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'inherit', windowsHide: true });
if (result.status !== 0) throw new Error('Windows ZIP packaging failed.');
const sha256 = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(join(dist, 'SHA256SUMS.txt'), `${sha256}  ${name}.zip\n`, 'utf8');
await writeFile(join(dist, 'latest-build.json'), JSON.stringify({ output, zip, size: (await stat(zip)).size, sha256 }, null, 2));
console.log(JSON.stringify({ output, zip, sha256 }, null, 2));
