# 本地互动接口

当前界面和未来 AI 适配器使用同一个主进程分发器。入口已经实现，AI 模型仍未启用。没有启动 HTTP 服务，也没有连接 QQ。

页面通过 `window.petApp.interactions()` 读取命令列表、当前互动设置、可选语音和表情包。调用 `window.petApp.executeInteraction(command)` 执行命令。不要把模型生成的自由文本作为代码执行，只将工具参数交给此入口。

| type | 参数 | 行为 |
| --- | --- | --- |
| greet | 无 | 随机问候，可按互动设置播放随机录音 |
| jump / sway | 无 | 蹦一下 / 摇一摇 |
| sleep / wake | 无 | 休息 / 唤醒 |
| playVoice | id：语音目录中的 ID | 播放录音，替换上一条 |
| stopVoice | 无 | 停止录音 |
| showSticker | id：表情包目录中的文件名，含后缀 | 桌面气泡显示图片 6.5 秒 |
| randomSticker | 无 | 随机显示一个本地表情包，多个图片时避免连续重复 |
| showExpression | id：角色已配置的表情 ID，例如 happy、shy、blink | 显示表情约 2 秒后恢复，暂停当前眨眼计时 |
| hideSticker | 无 | 收起表情包 |
| setPreferences | preferences：完整设置对象 | 保存并应用大小、音量、静音等 |
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

`interactions().expressions` 返回已配置的角色表情 ID。它们属于角色立绘帧，区别于独立展示的表情包；只能调用角色配置中的 ID。游戏、隐藏或休息状态不接受表情调用。表情 ID 包括 blink、happy、shy、smile、sleepy、pout、talk、laugh、teary、surprised、annoyed。

互动设置还包括 `clickSticker`（点按角色是否随机冒表情包）与 `portraitMode`（`auto` 待机随机、`normal` 原表情或已配置的任意表情 ID）。通过现有 `setPreferences` 可设置常驻表情。`showExpression` 展示约 2 秒后恢复常驻表情，语音播放有简单张嘴动画。所有表情包均通过同一入口显示，GIF 直接使用原文件，不转成静态图。

版本更新属于应用管理功能，使用独立接口 `petApp.checkUpdates(includePrereleases)`、`petApp.downloadUpdate()`、`petApp.installUpdate()`，由用户在互动面板主动操作，未纳入角色互动命令列表。

游戏模式和隐藏也是应用管理开关：`desktopState()` 读取状态，`setGameMode(boolean)` 和 `setPetHidden(boolean)` 切换，`onDesktopState(callback)` 订阅变化。两者独立，重启清零，不列入未来 AI 的互动命令。游戏模式或隐藏期间，动作、语音、表情展示和移动指令在主进程拒绝；保存设置、停止语音和收起表情仍可调用。游戏模式保持立绘可见并穿透鼠标，隐藏则隐藏桌宠窗口。

跨显示器拖动暂时关闭：拖动位移会固定在开始拖动的显示器工作区内，避免不同 DPI 缩放造成窗口和按钮偏移。桌宠可通过 `Ctrl+Alt+M` 或 `petApp.switchDisplay()` 切换到下一块显示器；只有检测到至少两块显示器时才会移动。
