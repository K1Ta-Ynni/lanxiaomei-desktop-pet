# 更新方式

## 使用者

蓝神のLivehouse →「版本与更新」→「检查更新」。v2.1 起统一为主体版，AI 聊天在“AI 与模型”中按需开启，不再按发行类别切换。默认包含预览版本；取消勾选后只看正式版本。下载 Windows x64 ZIP 并校验 SHA-256 后，点「更新并重启」原位升级。检查与下载仅在点击时联网。

原位更新通过独立 PowerShell 进程完成：先校验 ZIP 并检查内部应用版本，再把旧文件移入本次更新的备份目录，放入新文件并重启。失败时会尝试移走本次放入的文件、恢复旧文件，再重新打开旧版。日志与备份位于 `%APPDATA%/lanxiaomei-desktop-pet/updates/`。

从源码启动时只支持检查和下载；程序替换应通过 Git 更新。使用者导入的语音和表情包统一存于 `%APPDATA%/lanxiaomei-desktop-pet/media/voices/` 与 `media/stickers/`。首次原位更新会从旧 `resources/app/assets/` 补齐缺失文件；用户目录中已有的同名文件不会被覆盖。偏好设置也保留在同一用户数据目录。

## 发布者

用户在界面中编辑的语音/表情名称与分类保存在用户目录的 `media-library.json`，不写回随包素材清单；源码运行与发行包使用同一规则。更新不会覆盖这些记录，素材按稳定 ID 关联，改名不影响互动播放列表。

新版附带的语音清单会按 ID 补齐缺失条目，保留用户已存在的条目、标签和同名录音；首次合并前会把用户清单备份为 `media/voices/manifest.before-bundled-import.json`。已存在的子目录也会补齐其中缺失的文件，不覆盖用户文件。

### v2 → v2.1 过渡兼容

v2 基础版和陪伴版均可保持原来的更新类别，直接检查并升级至 v2.1。新安装默认关闭 AI；已有用户保留 `settings.json` 中的 AI 开关和模型配置。分类、播放列表、聊天、记忆、密钥和媒体均保留。升级后两个入口统一使用主体版的更新通道。

旧更新器不仅匹配 ZIP 文件名，也严格核对内部 `edition.json`，因此 v2.1 发布两个附件：

```text
lanxiaomei-desktop-pet-v2.1.0-win32-x64.zip            # 主体版，新用户下载这个
lanxiaomei-desktop-pet-v2.1.0-companion-win32-x64.zip  # 仅供旧陪伴版更新器过渡
```

两包的代码、素材、功能和默认设置相同，只有兼容标记不同。应用运行时忽略兼容标记并使用统一更新通道。不能仅把同一个 ZIP 改名上传，否则旧安装器会因标记不符而拒绝安装。未来版本仅需主体版包；尚未升级的旧陪伴版仍可先升到 v2.1 再继续升级。

运行 `npm.cmd run package:windows` 自动生成两个过渡 ZIP、各自 `.sha256` 和 `SHA256SUMS.txt`。运行 `npm.cmd run test:package`、`npm.cmd run test:package -- --edition=companion` 验证两个 ZIP 启动，再运行 `npm.cmd run test:upgrade-v2` 使用 Git 标签 v2.0.0 的原始更新器与安装脚本验证两条升级路径。把两个 ZIP 和校验文件上传到同一个 GitHub Release；仅当附件上传完成，旧客户端才能检测到更新。

DSH 计划以后作为独立插件提供，目前不随主体版打包。源码运行仍通过 Git 更新，不自动替换源码。

新版本不能只改 Release 文字，必须同时更新 `package.json` 版本、`CHANGELOG.md`，并重新打包。`npm.cmd test` 覆盖版本选择、下载、校验失败和媒体迁移；GitHub Actions 与本机 `npm.cmd run test:desktop` 覆盖 Electron UI。
