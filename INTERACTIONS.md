# 本地互动接口

当前界面和未来 AI 适配器使用同一个主进程分发器。入口已经实现，AI 模型仍未启用。没有启动 HTTP 服务，也没有连接 QQ。

页面通过 `window.petApp.interactions()` 读取命令列表、当前互动设置、可选语音和表情包。调用 `window.petApp.executeInteraction(command)` 执行命令。不要把模型生成的自由文本作为代码执行，只将工具参数交给此入口。

| type | 参数 | 行为 |
| --- | --- | --- |
| greet | 无 | 问候，按互动设置从语音或表情播放列表选择一项 |
| jump / sway | 无 | 蹦一下 / 摇一摇 |
| sleep / wake | 无 | 休息 / 唤醒 |
| playVoice | id：语音目录中的 ID | 播放录音，替换上一条 |
| stopVoice | 无 | 停止录音 |
| nextVoice / nextSticker | 无 | 按对应列表的随机、顺序或单项模式播放下一项；列表为空返回 `{ performed: false, empty: true }` |
| setPlaylist | kind：`voice`、`sticker`、`music` 或 `expression`；playlist：`{ mode, ids }` | 保存列表；mode 为 `random`、`sequence` 或 `repeat`；ids 为所选 ID 数组，空数组表示清空，null 使用默认选择；expression 为常驻立绘表情列表，默认使用 idleExpressions，清空显示原始表情，repeat 常驻列表第一张 |
| music | action：`play`、`pause`、`resume`、`seek`、`previous`、`next`、`stop`；play 可选 id，seek 必须带 position（秒） | 歌曲播放器共用入口；播放后自动接续；单曲循环只作用于自然播完，手动切歌仍换曲。仅选择本地歌曲清单中的音频 |
| showSticker | id：表情包目录中的文件名，含后缀 | 桌面气泡显示图片 6.5 秒 |
| randomSticker | 无 | 从已选表情列表随机显示一张，多个图片时避免连续重复；兼容旧调用 |
| showExpression | id：角色已配置的表情 ID，例如 happy、shy、blink | 显示表情约 2 秒后恢复，暂停当前眨眼计时 |
| hideSticker | 无 | 收起表情包 |
| setPreferences | preferences：需修改的设置字段 | 保存并应用大小、音量、静音等，未提供字段保留原值 |
| resetPosition | 无 | 回到主屏幕 |
| moveTo | x、y：屏幕坐标 | 移动到目标显示器工作区内 |

```js
const catalog = await window.petApp.interactions();
await window.petApp.executeInteraction({ type: 'jump' });
if (catalog.stickers.length) {
  await window.petApp.executeInteraction({ type: 'showSticker', id: catalog.stickers[0].id });
}
await window.petApp.executeInteraction({
  type: 'setPreferences',
  preferences: { ...catalog.preferences, volume: 0.5 }
});
```

休息时一般动作、语音和表情包会拒绝，先调用 wake。音频和图片 ID 必须出现在本地目录中，不接受任意路径。未知命令与无效设置会抛出错误，调用者需要处理。动作类调用表示指令已投递，不等同于动画或媒体已播放完成；语音有独立播放状态通知，图片解码失败会在桌面提示。

这些是应用内接口。以后如果 AI 运行在外部进程，需要增加受控的本地适配层；无需改动现有动作、语音或表情包执行逻辑。

`petApp.musicStatus()` 返回当前歌曲的 `state`、`id`、`label`、`position`、`duration`（秒）和 `mode`，`onMusicState(callback)` 订阅状态。播放器由桌宠窗口持有，关闭设置面板不停止音频。语音、歌曲共用音频通道及音量；手动点播语音、游戏模式、隐藏或休息会停止歌曲。歌姬模式期间点按角色不发语音，按表情互动开关最多显示一张表情包，并保持歌曲播放。重新打开面板不会自动播放。歌曲由 `music: true` 或唱歌/歌曲/音乐/song/songs/music 分组识别，大小上限 500 MiB；普通语音上限 30 MiB。

`interactions().expressions` 返回已配置的角色表情 ID。它们属于角色立绘帧，区别于独立展示的表情包；只能调用角色配置中的 ID。游戏、隐藏或休息状态不接受表情调用。表情 ID 包括 blink、happy、shy、smile、sleepy、pout、talk、laugh、teary、surprised、annoyed。

互动设置还包括 `clickSticker`（点按角色是否随机冒表情包）与 `expressionPlaylist`（常驻表情列表）。通过 `setPlaylist` 的 `expression` 类型保存列表，约每 30～60 秒轮换；省资源模式暂停轮换。旧 `portraitMode` 调用继续兼容：auto 恢复默认随机列表，normal 或表情 ID 转为单张常驻。`showExpression`（含 normal）展示约 2 秒后恢复常驻表情，语音播放有简单张嘴动画。所有表情包均通过同一入口显示，GIF 直接使用原文件，不转成静态图。

版本更新属于应用管理功能，使用独立接口 `petApp.checkUpdates(includePrereleases)`、`petApp.downloadUpdate()`、`petApp.installUpdate()`，由用户在互动面板主动操作，未纳入角色互动命令列表。

游戏模式和隐藏也是应用管理开关：`desktopState()` 读取状态，`setGameMode(boolean)` 和 `setPetHidden(boolean)` 切换，`onDesktopState(callback)` 订阅变化。两者独立，重启清零，不列入未来 AI 的互动命令。游戏模式或隐藏期间，动作、语音、表情展示和移动指令在主进程拒绝；保存设置、停止语音和收起表情仍可调用。游戏模式保持立绘可见并穿透鼠标，隐藏则隐藏桌宠窗口。

支持跨显示器拖动：主进程读取原生光标的逻辑坐标，以拖动起点计算绝对位移，移动时始终使用设定的逻辑宽高，不累积系统 DPI 舍入后的实际尺寸。松手时将窗口收进光标所在屏幕的工作区。`moveTo` 使用 Electron DIP 逻辑坐标，并将窗口收进目标坐标所在屏幕；`resetPosition` 返回主屏幕右下角。显示器分辨率或缩放改变时会重新校正窗口；系统在不同缩放比例下正常改变物理像素大小，应用内大小设置不变。
