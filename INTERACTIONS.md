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
