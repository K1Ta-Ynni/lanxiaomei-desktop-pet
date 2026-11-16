# 参与开发

使用 Node.js 22 或更新版本。运行 `npm ci`、`npm start`；提交前执行 `npm test` 和 `npm run test:desktop`。桌面测试使用临时目录，不需要模型密钥；截图写入被 Git 忽略的 `artifacts/`。

当前优先完善蓝小妹的本地脚本互动、动作和语音包体验。AI 聊天与模型入口保留为「功能暂未开放」，不要在未经规划时启用调用。

页面不使用 Node.js。系统能力在主进程实现，再通过 preload 暴露具体操作；避免暴露任意命令、文件访问或 IPC。

角色基本信息在 `character/character.json`，本地录音在 `assets/voices/`。新增外部素材请在 `ASSETS.md` 写明作者、来源和许可。不要提交个人运行数据、API 密钥或无授权的素材。
