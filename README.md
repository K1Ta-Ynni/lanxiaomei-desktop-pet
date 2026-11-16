# 蓝小妹桌宠

给蓝世_1967粉丝玩的桌面小伙伴，使用 Electron 和 JavaScript 从零实现。当前专注本地脚本互动，AI 聊天和模型设置入口保留并标注「功能暂未开放」，不需要 API Key，不发起模型请求。

立绘原型来源于 **B站 UP 蓝世_1967**，由项目维护者提供并确认可使用。本项目为粉丝作品。代码使用 MIT 许可证；立绘与录音的许可单独说明，见 [素材来源](ASSETS.md)。

## 启动

普通使用者：前往 [Releases](https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases) 下载 Windows x64 ZIP，完整解压后双击 `LanXiaomei.exe` 或 `START.cmd`，不需要安装 Node.js。当前为 v0.1.0 预览版，尚未签名。

开发者从源码启动：

安装 Node.js 22 或更新版本，Windows 双击 `start.cmd`。首次启动安装开发依赖，完成后显示桌宠。也可以：

```powershell
npm.cmd ci
npm.cmd start
```

Electron 下载超时时可使用镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm.cmd ci
```

已有依赖但 Electron 未下载完成时运行 `npm.cmd rebuild electron --foreground-scripts`。

## 现在可以玩什么

- 点击蓝小妹：随机显示一句问候，有录音时可随机播放一条，间隔至少 3 秒。
- 按住拖动：移动位置，支持跨显示器；空白区域鼠标穿透。
- 右键或点击齿轮：打开「互动与语音」面板。
- 打招呼、蹦一下、摇一摇、休息/唤醒。
- 大小、音量、静音、点按语音和偶尔待机小动作开关；点击「保存互动设置」立即生效。
- 手动点播本地语音、停止播放；新语音会替换正在播放的语音，不叠加。
- 导入本地表情包，点击缩略图让蓝小妹在桌面展示；GIF 保持动画。
- 托盘菜单可恢复到主屏幕，重复启动打开已有桌宠的互动面板。
- AI 聊天与模型入口作为占位保留，输入和保存均禁用。

当前立绘是一张透明 PNG，小动作由 CSS 对整张图实现，不是 Live2D、骨骼动画或独立肢体动作。休息时暂停点按语音与小动作，唤醒后恢复。待机动作不会自动播放录音。

## 添加本地语音

当前不附带蓝小妹录音。打开互动面板的「语音目录」，将可使用的 MP3、WAV、OGG 放进去，按 [语音包说明](assets/voices/README.md) 编辑 `manifest.json`，然后点击「刷新语音包」。

语音仅在本机播放，不使用 TTS、不上传文件。清单每条需要唯一 ID 和目录内的音频路径，单条最大 30 MiB，最多 200 条。缺失或无效文件会跳过并提示。

## 角色与运行数据

表情包可从互动面板点击「添加表情包」选择，也可以放入 `assets/stickers/` 再刷新。支持 PNG、JPG、GIF、WebP，单张最大 10 MiB，最多载入 200 张。文件名作为 ID，不需要另写清单。图片只在桌面气泡展示，不会发送到 QQ 或上传网络。默认不附带表情包。

`character/character.json` 保存名字、简介、图片路径、展示尺寸和点按问候，不需要配置人设或提示词。当前立绘展示框为 244 × 360 像素，可使用面板缩放。

互动设置保存在：

```text
%APPDATA%/lanxiaomei-desktop-pet/preferences.json
```

代码保留了后续模型连接的基础模块，但当前功能开关关闭，不能通过界面配置或调用模型。开发测试使用独立临时目录，不修改日常设置。

## 开发

所有互动均提供统一的本地调用入口，供当前界面和后续 AI 工具使用：

```js
const catalog = await window.petApp.interactions();
await window.petApp.executeInteraction({ type: 'jump' });
await window.petApp.executeInteraction({ type: 'showSticker', id: '开心.gif' });
```

完整接口与参数见 [INTERACTIONS.md](INTERACTIONS.md)。AI 当前未开放，这组入口也没有监听外部网络端口。

```powershell
npm.cmd test
npm.cmd run test:desktop
```

桌面测试启动真实 Electron，检查动作、睡眠、设置持久化、语音播放和 AI 禁用状态。使用临时生成的测试音频，不需要角色录音或模型密钥；截图放在被 Git 忽略的 `artifacts/`。

```text
assets/portraits/        透明立绘与头像
assets/voices/           本地录音与播放清单
assets/stickers/         本地表情包
character/              角色基本配置
src/main.js             窗口、托盘、IPC、本机存储
src/companion.js        动作定义、设置校验、语音清单读取
src/preload.cjs         页面可调用的具体功能
src/pet.*               透明桌宠与音频播放
src/settings.*          互动面板与模型占位入口
src/chat.*              聊天占位窗口
test/                   单元测试
scripts/smoke.mjs       真实桌面功能测试
.github/workflows/      自动检查
```

在 Windows x64 上运行 `npm.cmd run package:windows` 生成免安装 ZIP（位于被 Git 忽略的 `dist/`），然后运行 `npm.cmd run test:package` 检查打包后的程序。打包只复制应用代码、素材、文档和 Electron 运行时，不包含开发依赖、测试缓存或本机设置。

后续可增加动作素材、更多脚本互动，再考虑 AI。开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本记录见 [CHANGELOG.md](CHANGELOG.md)。
