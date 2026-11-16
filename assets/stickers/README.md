# 本地表情包

互动面板点击「添加表情包」选择图片，或把图片放到此目录后刷新。

支持 PNG、JPG、GIF、WebP，单张不超过 10 MiB，最多显示 200 张。文件名作为 ID，去掉后缀后作为名称；随附 `lanjie-001.*` 等使用「表情 001」编号。导入重名文件会加后缀，不覆盖原图。点击缩略图后在桌宠小气泡显示 6.5 秒，图片最长边约 106 像素，GIF 保持动画，可点气泡 × 或「收起桌面表情」提前关闭。

当前附带维护者整理的 55 张表情包（含 4 张 GIF）。桌宠底部笑脸按钮打开小图选择器，预览后点击发出；也可随机发一个。点按角色默认随机冒一个表情包，至少间隔 3 秒，可在互动设置关闭。图片只在本机展示，不会发送到 QQ 或上传网络。素材来源和许可见 ASSETS.md。

未来的 AI 可通过统一入口传 ID 调用，不需要任意文件读取能力：

```js
const catalog = await window.petApp.interactions();
await window.petApp.executeInteraction({ type: 'showSticker', id: catalog.stickers[0].id });
await window.petApp.executeInteraction({ type: 'randomSticker' });
```
