# 素材来源与许可

## 蓝小妹立绘

立绘原型来源于 **B站 UP 蓝世_1967**。原图由项目维护者提供，维护者确认可以用于本粉丝桌宠并公开使用。该说明不代表素材自动改为 MIT，也不授予与本项目无关的使用权；复用素材请遵守原作者及授权方的要求。

`assets/portraits/` 是从提供的 JPG 经本地去背景、裁切和缩放得到的透明 PNG：

- `portrait-full.png`：1596 × 2609，透明全身图。
- `portrait-desktop.png`：626 × 1024，当前桌面展示图。
- `avatar.png`：256 × 256，头像与托盘图标。
- `portrait-blink.png`：626 × 1024，闭眼帧。由维护者提供的豆包生成图 `artifacts/原图/blink.png` 提取眼部，经尺寸对齐和局部羽化合成到原立绘；保留原图透明轮廓与画布，其余部位使用原图。用于随机眨眼和休息闭眼。
- `portrait-happy.png`：626 × 1024，闭眼笑表情；点击“蹦一下”时短暂显示。
- `portrait-shy.png`：626 × 1024，害羞表情；点击角色问候时短暂显示。

处理移除了外部白色背景和光环内部的背景，并清理边缘，没有重新绘制人物。

上述去背景说明适用于原始立绘；眨眼与表情帧包含 AI 生成的局部修改。源图放在 `artifacts/原图/`，保留原始文件。另有微笑、困倦、嘟嘴、说话、大笑、委屈、惊讶、疑惑和无语透明表情帧；除疑惑使用完整生成立绘外，其余主要提取脸部，惊讶与疑惑额外保留对应的头顶感叹号/问号。运行 `python scripts/prepare-expressions.py` 可重新合成，需要 Pillow；运行桌宠不需要 Python。对比图输出到被 Git 忽略的 `artifacts/表情对比.png`。

## 音乐状态帧

`assets/portraits/music-1.png`、`music-2.png`、`music-3.png` 为 626 × 1024 的透明音乐表情，来源于维护者提供的 `artifacts/原图/音乐1.png` 至 `音乐3.png`。以第一张统一身体、轮廓和音符，另外两张合入面部表情；两侧音符沿用同一形状与大小，逐帧轻微调整位置。原始素材不变，处理脚本为 `python scripts/prepare-music-frames.py`（需要 Pillow），会额外输出静态对比与 GIF 预览到 `artifacts/`。循环顺序与时长记录在 `character/character.json` 的 `musicAnimation`，不加入普通待机表情列表。

## 辅助图标

`assets/icon.ico` 从蓝小妹头像生成多尺寸 Windows 程序图标，用于打包 EXE；窗口与托盘也使用头像。运行 `python scripts/prepare-app-icon.py` 可重新生成图标，需要 Pillow。`assets/mascot.svg` 与 `assets/icon.png` 是本项目原创备用示例资源，适用代码的 MIT 许可证。

## 语音

`assets/voices/manifest.json` 索引项目维护者提供的蓝姐录音，按“常用语音、入场语音、唐哭、唐笑、唱歌”分组，其中歌曲 10 首。来源为维护者整理的本地语音包，后续清唱与歌曲由项目维护者补充；录音许可独立于代码许可，公开分发范围以维护者取得的授权为准。原文件保存在 `artifacts/蓝姐语音包/`，导入脚本不改写源录音。

`assets/voices/loudness.json` 记录 FFmpeg 测得的响度、真峰值、文件哈希及播放增益。目标为 -18 LUFS，真峰值余量为 -1.5 dBTP。为避免削波，尖峰较大的录音会限制增益，最终响度可能略低于目标；这是自动增益补偿，不等同于动态压缩。重跑 `python scripts/measure-voice-loudness.py` 可重新测量，不修改音频字节。

## 表情包

`assets/stickers/lanjie-001.*` 至 `lanjie-055.*` 为维护者提供的蓝姐表情包，含 4 张 GIF。采用编号显示，不改写原图片或 GIF 动画数据。原文件保存在 `artifacts/蓝姐表情包/`，编号对应表在忽略目录的 `artifacts/sticker-import.json`；`python scripts/import-stickers.py` 可重新导入并保留已有编号。表情包及使用者导入的图片保留各自许可，代码的 MIT 许可不替代图片授权。

## 代码与运行时

本项目原创应用代码使用根目录 `LICENSE` 中的 MIT 许可证。依赖保留各自许可证。代码许可不替代角色立绘或后续录音的素材许可。

Windows 压缩包包含 Electron 运行时。压缩包根目录的 `LICENSE` 与 `LICENSES.chromium.html` 保留运行时及 Chromium 的许可，`LICENSE-APP.txt` 是本应用的 MIT 许可。
