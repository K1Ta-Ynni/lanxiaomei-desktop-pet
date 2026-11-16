# 蓝小妹桌宠

给蓝世_1967粉丝玩的桌面小伙伴，使用 Electron 和 JavaScript 从零实现。当前专注本地脚本互动，AI 聊天和模型设置入口保留并标注「功能暂未开放」，不需要 API Key，不发起模型请求。

立绘原型来源于 **B站 UP 蓝世_1967**，由项目维护者提供并确认可使用。本项目为粉丝作品。代码使用 MIT 许可证；立绘与录音的许可单独说明，见 [素材来源](ASSETS.md)。

## 启动

普通使用者：前往 [Releases](https://github.com/K1Ta-Ynni/lanxiaomei-desktop-pet/releases) 下载 Windows x64 ZIP，完整解压后双击 `LanXiaomei.exe` 或 `START.cmd`，不需要安装 Node.js。当前为 v1.0.0，尚未签名。

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

- 启动时显示一次问候；点击蓝小妹时随机播放录音，并立即中断上一条语音。语音字幕跟随录音时长，气泡叉号可立即停播并收起。
- 右键或点击齿轮：打开「互动与语音」面板。
- 打招呼、蹦一下、摇一摇、休息/唤醒。
- 随机眨眼（间隔约 3～7 秒），休息时保持闭眼；游戏模式、隐藏和系统减少动态效果设置会暂停自动眨眼。
- 点击问候时短暂显示害羞表情，蹦跳时短暂显示闭眼笑表情；底部快捷按钮活动后出现，闲置约 2.6 秒自动收起。
- 大小、音量、静音、点按语音和偶尔待机小动作开关；待机时随机摇摆或蹦跳，不自动发声。点击「保存互动设置」立即生效。

随附 31 段语音通过响度测量计算播放增益，尽量统一听感音量，原音频保持不变。

点按语音和表情包同时开启时，点击会在两者间二选一（约 1/4 概率发图）；表情包不会叠加播放语音。图只显示在头顶的小气泡里，不显示编号；编号仍保留在选图预览，鼠标移入气泡可见关闭叉号。
- 手动点播本地语音、停止播放；新语音会替换正在播放的语音，不叠加。
- 导入本地表情包，点击缩略图让蓝小妹在桌面展示；GIF 保持动画。
- 托盘点击恢复桌宠，双击打开互动面板；桌宠窗口关闭时收进托盘。桌宠、设置与聊天窗口均不占任务栏，退出请使用托盘的“退出桌宠”。
- 游戏模式：`Ctrl+Alt+G` 切换。立绘继续显示，鼠标穿透，暂停点按、拖动、动作、语音和表情互动。
- 隐藏/显示：`Ctrl+Alt+H` 独立切换，不改变游戏模式；隐藏时停止当前语音并暂停互动。也可从托盘或互动面板操作。
- AI 聊天与模型入口作为占位保留，输入和保存均禁用。
- 在互动面板手动检查 GitHub 更新；Windows x64 免安装版下载并校验后可原位替换、重启。

当前使用对齐的睁眼、闭眼透明 PNG 切换表情，小动作由 CSS 对整张图实现，不是 Live2D、骨骼动画或独立肢体动作。休息时暂停点按语音与小动作，唤醒后恢复。待机动作不会自动播放录音。

游戏模式与隐藏均为临时状态，重启后恢复普通显示。游戏模式会暂停立绘动画，退出后恢复原先的休息和互动设置。快捷键注册冲突时会在面板提示，仍可通过托盘切换；管理员权限运行的游戏可能拦截快捷键。

## 添加本地语音

当前附带维护者提供的 31 段分组录音，包括常用语音、唐哭、唐笑和唱歌。歌曲默认只手动点播，避免随机播放长音频。打开互动面板的「语音目录」，可继续添加 MP3、WAV、OGG，并按 [语音包说明](assets/voices/README.md) 编辑 `manifest.json`，然后点击「刷新语音包」。

语音仅在本机播放，不使用 TTS、不上传文件。清单每条需要唯一 ID 和目录内的音频路径，单条最大 30 MiB，最多 200 条。缺失或无效文件会跳过并提示。

## 角色与运行数据

附带 55 张编号表情包（含 4 张 GIF）。点桌宠底部笑脸按钮，先看小图预览再选图，或随机发一个；点击角色也会随机冒出小气泡，可在互动设置关闭。气泡中图片最长边约 106 像素，6.5 秒收起，GIF 保留动画。也可从互动面板添加 PNG、JPG、GIF、WebP，单张最大 10 MiB，最多载入 200 张。文件名作为 ID，不需要另写清单。图片只在桌面展示。

角色表情可在互动面板手动展示，也可设为常驻。默认每隔约 30～60 秒在原始、脸红微笑、害羞和困倦之间随机轮换。点按问候会害羞，短时间连续点按会嘟嘴或无语，蹦跳时闭眼笑；其他表情可从面板点选。语音播放时有简单的张嘴动画。临时互动结束后恢复常驻表情；休息时闭眼，游戏模式和隐藏时暂停互动。

`character/character.json` 保存名字、简介、图片路径、展示尺寸和点按问候，不需要配置人设或提示词。当前立绘展示框为 244 × 360 像素，可使用面板缩放。

互动设置保存在：

```text
%APPDATA%/lanxiaomei-desktop-pet/preferences.json
```

Windows 免安装版的用户语音包和表情包保存在 `%APPDATA%/lanxiaomei-desktop-pet/media/`。首次升级会从旧版应用目录复制已有媒体；已有同名用户文件优先保留。下载的更新包和旧程序备份暂存在同一用户数据目录下的 `updates/`。

新增的随附语音会补齐缺失录音并合并新 ID 到用户清单，保留原有自定义条目和标签。首次合并前备份清单为 `manifest.before-bundled-import.json`。

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

桌面测试启动真实 Electron，检查动作、睡眠、设置持久化、语音播放和 AI 禁用状态。Windows 打包冒烟测试解压 ZIP 再启动，更新助手演练检查原位替换与媒体迁移。测试使用临时生成的素材和数据，不需要角色录音或模型密钥；截图放在被 Git 忽略的 `artifacts/`。

更新器仅在点击「检查更新」后请求 GitHub Releases。下载前核对来源和平台、下载后核对附件 SHA-256；Windows 打包版可自动替换程序，源码运行不支持自替换。发布流程和媒体保留行为见 [更新说明](UPDATING.md)。

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
