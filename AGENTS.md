# 项目接续说明（AGENTS.md）

> 本文件供后续开发会话快速了解项目。更新于 2026-11-26。当前权威进度在「当前状态」；`HANDOFF.md` 保留完整历史决策和排障记录，若与本文件中的现状描述不一致，以当前状态和实际仓库/运行环境为准。

## 项目目标

Windows 资源管理器右键菜单插件 **「通过 dsh 打开」**：在文件夹空白处、文件夹图标、任意文件上打开该目录对应的 dsh 工作区（不存在则创建），每次都新开会话；文件在该工作区内时，新会话草稿带该文件的 `@引用`。支持 Windows 11 原生简洁菜单和经典菜单、Windows 10 经典菜单。

## 当前状态（2026-11-26）

- 当前仓库版本：`@reed-io/dsh-explorer-open@0.1.7`。
- 0.1.7 包含两个修复：
  1. 经典菜单使用 `native/dsh-launch.exe` GUI 启动器，通过 `CREATE_NO_WINDOW` 执行 PowerShell，避免右键时命令行窗口闪现。
  2. MSIX 原生菜单安装成功/current 后，移除经典注册表回退项，避免 Win11「显示更多选项」里出现两个同名项；原生菜单不可用时保留经典入口作为回退。
- 提交 `7387c04`（静默启动器）、`894196c`（去重）已推送到 GitHub `main`。
- 用户已在本机确认 0.1.7 菜单去重及点击后新会话测试成功。当前运行 profile 曾通过插件管理器从本地目录 `E:\work\tools\dsh-explorer-open` 安装 0.1.7（从 0.1.6 移除后安装，`application: applied`）；经典注册表三键不存在，MSIX `DshOpenWith.Local 1.0.0.8` 正常。
- **npm 0.1.7 尚未发布**；仅 GitHub 代码已推送。发布需用户在其账号下完成 npm 发布/OTP，不能声称已上线。
- 最近任务已完成：本机直接本地安装、测试，再推送 GitHub。用户不需要等 npm 才能在本机测试。

## 架构速览

1. **宿主插件**：`index.js` 导出 `apply`，主逻辑在 `lib/index.js`。启用时复制运行文件到 `%USERPROFILE%\.dsh\dsh-explorer-open\`、维护菜单和待处理请求队列，并注册 `/api/plugins/dsh-explorer-open/request`、`/ack` HTTP 路由。
2. **经典菜单**：`lib/registry.js` 在 HKCU 下维护 `Directory\Background`、`Directory`、`*` 三个 `OpenWithDsh` 键；命令调用固定运行目录里的 `dsh-launch.exe`，不直接运行控制台 PowerShell。
3. **菜单协调**：`lib/menus.js` 的 coordinator 协调经典回退与 MSIX 原生菜单；原生就绪时经典入口移除，MSIX 不可用时经典入口保留。异步安装和插件停用竞态有专门测试。
4. **启动交接**：`native/dsh-launch.exe` 启动 `lib/launch.ps1`。脚本把目标路径拆为 `folder` 和可选 `file`，写入 `%USERPROFILE%\.dsh\dsh-explorer-open\pending.json`（先临时文件再改名、无 BOM UTF-8），并启动/唤醒 dsh。
5. **页面插件**：`client.js` 每秒轮询宿主接口，调用 `workspaces.create({ path })`、`sessions.create(...)`、`uiWorkspace.openSession(...)`；必要时回退打开工作区。文件位于当前工作区内时，通过 `conversation.input.requestDraftInitialization` 写入 `@path` 或 `@"path with spaces"`。
6. **Win11 原生菜单**：`win11/` 是 `IExplorerCommand` + 稀疏 MSIX。签名包在 `native/`；包身份 `DshOpenWith.Local`，自签名证书 `CN=DshOpenWith`。构建脚本 `win11/build.sh`。
7. **诊断**：`scripts/diagnose-windows.ps1` 是只读诊断脚本；运行日志通常在 `%USERPROFILE%\.dsh\dsh-explorer-open\trace.log`，提权日志 `%LOCALAPPDATA%\dsh-explorer-open-trust.log`。

## 重要实现约束

- 包名为 `@reed-io/dsh-explorer-open`，实例 ID 仍为 `dsh-explorer-open`。`client.js` 里的 `window.__ModuleLoader__.load({ id })` 必须与**包名完全一致**，否则 web 启动会失败。改包名时同步检查 `package.json`、`cordis.patch.yml`、`client.js`、测试和 README。
- 不要误删两处不同概念：运行时目录、路由路径、请求头、环境变量仍用未 scope 的 `dsh-explorer-open` / `DSH_EXPLORER_OPEN_*`。
- 安装/切换插件要用 DSH 插件管理器/市场或受支持的 bundle 流程；不要把 `plugin_manager` 当 CLI 命令。`dsh plugin add` 仅写 profile dependencies，不保证把插件加入 `dsh.profile.bundles`。
- **本机测试优先本地安装，不必先发布 npm。** 对当前运行 profile，插件管理器可能报告需要重启；按工具返回的 `application` / `nextStep` 办理，并在真实点击右键后确认链路。不能只看注册表或包版本就宣称端到端验证通过。
- 避免手工反复清菜单键作为最终修复：旧插件重启会重新写回。应验证 0.1.7 coordinator 根据 MSIX 状态持久维护正确菜单。
- 不要杀掉 `explorer.exe`。刷新用插件的 `refreshExplorer()`/安全 shell 刷新机制；重启 Explorer 需先征得用户同意。
- PowerShell 默认用 `pwsh.exe`。只有 Windows Appx 模块等明确需要兼容时，才用 Windows PowerShell 5.1 并说明原因。PowerShell 5.1 会把无 BOM `.ps1` 按系统 ANSI 解码，因此 `lib/launch.ps1` 保持 ASCII；JSON 用显式 UTF-8 无 BOM。
- 新增/修改代码注释统一中文。
- 每次改动先读文件；不要覆盖用户改动。完成后检查 `git diff`、`git diff --check` 和相关测试。

## 开发与测试

项目根目录即插件包：`E:\work\tools\dsh-explorer-open`。Node 要求 `>=20`。

完整测试由 `npm test` 依次运行 coordinator、原生 GUI 启动器、客户端、宿主测试。0.1.7 开发时已在隔离环境完整通过，`git diff --check` 和 npm pack dry-run 也已通过；客户端故障回退用例会打印预期错误堆栈，应结合最终断言和退出码判断结果。

**先设置以下隔离变量，再执行完整测试**。宿主测试会改文件和注册表模拟菜单，不能触碰真实 HKCU 菜单。在一次性 `pwsh.exe` 进程中运行以下命令，避免把测试用 USERPROFILE 留给后续安装/发布操作：

```powershell
$env:USERPROFILE = 'E:\tmp\dsh-explorer-open-test-home'
$env:DSH_EXPLORER_OPEN_TEST_HOME = '1'
$env:DSH_EXPLORER_OPEN_REG_BASE = 'HKCU\Software\Classes\__dsh_explorer_open_test'
$env:DSH_EXPLORER_OPEN_NO_MSIX = '1'
npm test
```

若只跑客户端测试：`node test/client-test.mjs`；菜单生命周期：`node test/menu-coordinator-test.mjs`；GUI 启动器：`node test/launcher-test.mjs`。`npm run build:launcher` 需要 MinGW-w64；一般无需重新构建，包内已有预编译 `native/dsh-launch.exe`。

宿主测试隔离变量设置后，确认测试不会使用实际用户目录；完成后清理测试目录/模拟注册表键。不要在未隔离的宿主测试中运行 `test/host-test.mjs`。

## 菜单、MSIX 与版本发布

- 改 C++ 原生菜单后：更新 `win11/package/AppxManifest.xml` 的 MSIX 版本，运行 `bash win11/build.sh`，确认 `native/` 产物被同步，检查签名/安装结果。
- MSIX 安装依赖 `CN=DshOpenWith` 证书在 `LocalMachine\TrustedPeople`。首次信任由 `native/trust-cert.ps1` 处理；部分设备策略可能静默阻止提权，检查 `NEED-TRUST.txt` 和 `%LOCALAPPDATA%\dsh-explorer-open-trust.log`。
- 更新 JS 插件版本需要改 `package.json` 版本；npm scoped 包应有 `publishConfig.access=public`。发布 npm 需用户授权并在 npm 交互步骤完成 OTP；确认 registry 的版本号和 dist-tag 后才能称已发布。
- 本机验证的推荐顺序：本地目录安装 → 如需则完全退出并重启 dsh → 验证版本/菜单三种右键/菜单去重/新会话/文件引用 → 再推送 GitHub、发布 npm。
- GitHub：`https://github.com/ame-code/dsh-explorer-open`，分支 `main`。当前 `main` 已有 0.1.7 的两个提交。

## 本机环境与排障经验

- 最近安装状态：Windows 11 Pro build 26300，dsh `desktop` profile 位于 `C:\Users\14578\.dsh\profiles\desktop`；可执行文件 `D:\DeepSeek Harness\DeepSeek Harness.exe`。dsh 的实时版本、GUI 端口和当前目录应以新会话运行时上下文/实际查询为准，不使用历史固定端口。
- 插件目录由 Node `homedir()` 决定，目前是 `C:\Users\14578\.dsh\dsh-explorer-open`；**不要误以为当前代码按 DSH_HOME 重定向该目录**。
- 请求接口必须携带 `x-dsh-explorer-open: 1`，否则返回 403。宿主每 300ms 扫描，页面每 1s 轮询，请求有效期 120 秒，重复窗口 1.5 秒。
- 点击后先看 `trace.log`：正常应有本次时间的 `poll served` → `ack stage=start` → `ack stage=ok`。只有唤醒窗口或 pending 被消费，并不能证明新会话成功；只有旧日志也不能当本次证据。
- 过去一次热切换返回 `bundle-in-use` / `package-moved`，导致包文件与已运行代码不一致；完整退出并重启 dsh 才恢复。`changed: true` 不代表生效，必须看 `application`。曾发生移除失败却先从 bundles 清单删除条目，应检查实际 profile 状态，不能盲目重复安装。
- 查询包含 `*` 的注册表路径时，用 `reg.exe query` 或 `-LiteralPath`；`Test-Path 'HKCU:\Software\Classes\*\...'` 会按通配符扫描，曾导致查询长时间卡住。
- 在本机 `Get-AppxPackage` 经 PowerShell 7 曾卡住，Windows PowerShell 5.1 查询正常；可为此单项使用系统 5.1，不必更换所有开发命令。
- GitHub 直连曾报 `Recv failure: Connection was reset`，本机代理 `http://127.0.0.1:7897` 有时可用；代理也曾失效。遇到网络问题按实际诊断选择，不将某一代理地址视为跨设备配置。

## 近期仍可继续的事项

1. 如准备向 npm 分发，先确认 npm 上 `@reed-io/dsh-explorer-open` 当前 dist-tag 和版本；0.1.7 尚未发布。发布前复核 pack 内容含 `lib/menus.js`、`native/dsh-launch.exe`，并让用户处理 OTP。
2. 可核对 GitHub issue #2（命令行窗口闪现）是否要回复/关闭；此前没有评论或关闭，且用户报告者尚未做视觉复测。
3. rc.2/rc.3 曾做过接口源码核对；rc.3 时本机已实测插件唤醒链路正常。若 dsh 升级，按当前目标做针对性兼容回归，不把历史源码对照当作新版本真机验证。
4. 市场 PR `awesome-dsh-plugin/awesome-dsh-plugin#13095` 之前 CI 通过、等待维护者合并；继续处理前先查当前状态。

## 历史资料

- `HANDOFF.md` 记录需求决策、API 契约、MSIX 实现、排障和旧版本事故；其中部分早期「尚未真实验证」「待发布」状态已经过时，阅读时结合本文件的当前状态。
- `README.md` 面向用户，包含功能、安装、兼容性、排查说明。
- 用户希望少堆术语；有歧义的产品行为先讨论，已确认的行为不要反复要求确认。
