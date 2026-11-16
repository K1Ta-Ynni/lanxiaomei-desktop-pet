# 本地表情包

互动面板点击「添加表情包」选择图片，或把图片放到此目录后刷新。

支持 PNG、JPG、GIF、WebP，单张不超过 10 MiB，最多显示 200 张。文件名作为 ID，去掉后缀后作为名称；导入重名文件会加后缀，不覆盖原图。点击缩略图后在桌宠气泡显示 6.5 秒，GIF 保持动画，可用「收起桌面表情」提前关闭。

图片只在本机展示，不会发送到 QQ 或上传网络。对外分发图片时请在 ASSETS.md 中注明来源和许可。当前项目不附带表情包。

未来的 AI 可通过统一入口传 ID 调用，不需要任意文件读取能力：

```js
const catalog = await window.petApp.interactions();
await window.petApp.executeInteraction({ type: 'showSticker', id: catalog.stickers[0].id });
```
