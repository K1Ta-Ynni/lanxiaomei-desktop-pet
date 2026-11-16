# 更新方式

## 使用者

互动面板 →「版本与更新」→「检查更新」。默认包含预览版本；取消勾选后只看正式版本。发现兼容本机的 Windows x64 ZIP 后，点下载，再点「更新并重启」。更新器从 GitHub Releases API 读取版本与附件，限定本仓库和匹配的 Windows 平台，检查下载大小与 SHA-256 后才启用安装。

原位更新通过独立 PowerShell 进程完成：先校验 ZIP 并检查内部应用版本，再把旧文件移入本次更新的备份目录，放入新文件并重启。失败时会尝试移走本次放入的文件、恢复旧文件，再重新打开旧版。日志与备份位于 `%APPDATA%/lanxiaomei-desktop-pet/updates/`。

从源码启动时只支持检查和下载；程序替换应通过 Git 更新。使用者导入的语音和表情包统一存于 `%APPDATA%/lanxiaomei-desktop-pet/media/voices/` 与 `media/stickers/`。首次原位更新会从旧 `resources/app/assets/` 补齐缺失文件；用户目录中已有的同名文件不会被覆盖。偏好设置也保留在同一用户数据目录。

## 发布者

每个 Release 需要发布与版本号匹配的文件：

```text
lanxiaomei-desktop-pet-v0.2.0-win32-x64.zip
```

用 `npm.cmd run package:windows` 创建 ZIP，之后运行 `npm.cmd run test:package` 从 ZIP 解压并启动验证。上传到该版本的 GitHub Release 后，GitHub 会提供附件 `digest`；更新器只接受 Release API 标记为 `uploaded` 且 SHA-256 可用的 ZIP。更新下载采用手动触发，应用不会后台常驻轮询。

新版本不能只改 Release 文字，必须同时更新 `package.json` 版本、`CHANGELOG.md`，并重新打包。`npm.cmd test` 覆盖版本选择、下载、校验失败和媒体迁移；GitHub Actions 与本机 `npm.cmd run test:desktop` 覆盖 Electron UI。
