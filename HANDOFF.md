# 「通过 dsh 打开」插件 · 交接文档

> 用途：新开会话时先读本文件，即可接续开发。日期：2026-11-06。

## 1. 目标

开发一个 dsh 插件。插件**启用时**向 Windows 资源管理器右键菜单注入一项，文本严格为 **「通过 dsh 打开」**；**关闭时**移除该项。

行为要求（用户逐条确认过）：

1. 在文件夹空白处右键（未选中任何文件）→ 打开 dsh 主界面，打开该文件夹对应的工作区；不存在则新建。
2. 右键点中的是文件夹 → 同上，用该文件夹。
3. 右键点中的是普通文件 → 完全同 1，即忽略该文件，用它所在的文件夹。
4. 打开或新建的工作区中，**无论有没有旧会话，都新建一个会话**。
5. 插件关闭 → 移除右键菜单项。
6. Win11 要同时注入**新版简洁菜单**和**旧版扩展菜单**；Win10 只需旧版。

用户额外要求：解释不要堆砌术语；模糊处先讨论敲定。

## 2. 已敲定的决策（不要重新推翻）

- **Q1**：入口就是文件夹空白处右键（`Directory\Background`），同时也在文件夹图标上右键（`Directory`）。
- **Q2**：两种菜单都加。
- **Q3**：菜单文本严格「通过 dsh 打开」；两个菜单都带图标（`tray.ico` 的副本，随 MSIX 包一起分发）。
  - （更新 2026-11-06 22:50）原先判断「新菜单只能显示文字」是错的：新菜单用原生 `IExplorerCommand` 实现后，`GetIcon` 返回包内 `Assets\dsh.ico` 就能显示图标，已实测通过。
- **Q4**：以**完整路径**为准，同名不同路径算两个工作区。
- **Q5**：每次点击都新建会话；dsh 已开着就把窗口切到前面。
- **Q6**：dsh 没开着时先启动再操作。
- **Q7**：菜单指向**独立小程序**，只清理菜单项，小程序不常驻 → 关 dsh 不会让菜单消失。
- **Q8**：每次右键都新建会话。
- **Q9**：注册表写**当前用户**（HKCU），不需要管理员。
- **Q10（甲）**：每次点击都「先唤起、再切换」，不做「先探测是否已运行」。
- **Q11（甲）**：优先做「一步跳转到具体新会话」；实测不行再退回「只定位工作区」。
- **Q12**：启动器用 **PowerShell**（方案 C），不用 node，避免依赖用户机器上的 node 路径。

## 3. 关键技术事实（已查证）

### 3.1 dsh 桌面版行为
- dsh 是**单实例**程序：再次启动会自行退出，并把窗口切到前面（`requestSingleInstanceLock` / `second-instance`）。
- 协议只认 `dsh://open`，作用是切到前面；**没有**「打开指定文件夹」「新建会话」的入口。
- 启动参数里只有 `--updated`，不带路径。
- 因此：**唤起 dsh 由启动器负责；打开工作区+新建会话由插件在 dsh 内部完成。**

### 3.2 环境
- 安装目录：`D:/DeepSeek Harness`（`DeepSeek Harness.exe`）
- DSH_HOME：`C:\Users\14578\.dsh`
- DSH_PROFILE：`desktop`，profile 目录 `C:\Users\14578\.dsh\profiles\desktop`
- Web GUI：`http://127.0.0.1:1958`（每次重启端口可能变，以运行时上下文为准）
- 用户机器 **Win11 新右键菜单处于启用状态**（未关）
- `tray.ico`：15698 字节，7 帧，全部 32bpp BMP，尺寸 16/20/24/32/40/48/64
- 系统有 `D:\nodejs\node.exe`（v24.15.0），但 dsh 自带运行时里**没有** node.exe

### 3.3 可用的 dsh 接口（通过 `cordis_inspect_query` 查得，非逆向）

**宿主侧 Client Service `workspaces`**
- `create(input: { path: string }): Promise<WorkspaceView>`
  → **同一路径已有工作区时直接复用**，不会重复建。`WorkspaceView` 字段为 `workspaceId / path / title / sessionIds / createdAt / updatedAt`（**注意是 `workspaceId` 不是 `id`**）
- `rename / delete / archiveSession / unarchiveSession / insertSessionBefore`

**宿主侧 Client Service `sessions`**
- `create(opts?: { workspaceId?, cwd?, sessionId?, agentPreset? }): Promise<SessionId>`
  → **强制新建**会话，正合第 4 条要求
- `fork / retain / using / search / scope / binding`

**宿主侧 Client Service `uiWorkspace`**
- `openWorkspace(workspaceId, beforeOpen?, options?)`：连接并打开工作区
- `openSession(target: SessionTarget)`：选中并显示某会话
- `startSession(workspaceId?, options?)`、`connectWorkspace`、`pickDirectory`、`listDirectory`、`createDirectory`

**宿主侧 `workspaceRegistry`（Host 侧）**
- `create(path, title?)`：建或复用
- `resolveByPath(path)`：只查不建
- `list() / get(id) / delete(id)`
- 注意：宿主侧 `Workspace` 的字段是 `id`（Client 侧是 `workspaceId`）

**宿主侧 `webServer`**
- `register(route: WebRoute | WebResourceRoute)`：`kind: 'exact' | 'prefix'`
- `WebResourceRoute = { kind, path, resource: (request, peer?) => Promise<Response> }`
- `getOrigin()` 拿本机地址

### 3.4 插件结构（`cordis-plugin-development` skill 的硬性要求）
- 以 **authored bundle** 形式存在，用 `plugin_manager install_bundle`（target=绝对包目录）安装。
- **不得**手写 profile 的 package.json / cordis.patch.yml，**不得**在 profile 目录跑 pnpm。
- Host-only bundle 无需依赖/构建。
- 宿主侧 `export function apply(ctx, config) {}` 或默认导出 Service 类；可选 `export const inject = [...]`、`export const Config`。
- 资源注册用 `ctx.effect(...)` / `ctx.on(...)`，**返回清理函数**。
- 页面侧：`package.json` 加 `dsh.client` 段（`platform: 'web'`、`immediately`、`inject`），并导出 `./client`；`client.js` 用 `window.__ModuleLoader__.load({ id: '<包名>', factory(require){ ... return { inject, apply(ctx) } } })`。
- 显示元数据：`locale/en.json`、`locale/zh.json` 里写 `meta.title` / `meta.description`；导出 `./locale/*.json` 与 `./icon`，并列入 `files`。图标 SVG/PNG/JPEG/WebP，≤256KiB，必须在包内。
- 参考模板：`.probe/asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/`
- **注意**：app.asar 内的路径会被 `PATH_RESTRICTED` 拒绝，只能从 `.probe/asar/` 解压副本读。

## 4. 当前文件状态

目录：`E:\work\tools\dsh-explorer-open\`（**仓库根就是插件包**，原来的 `plugin/` 子目录在开源前已上移）

| 文件 | 作用 | 状态 |
|---|---|---|
| `package.json` | 清单 + `dsh.bundle` + `dsh.client` | 已写，安装时校验通过 |
| `cordis.patch.yml` | `- insert: [{ id: dsh-explorer-open, name: 'dsh-explorer-open', config: {} }]` | 已写 |
| `index.js` | `export { apply } from './lib/index.js'`、`export const inject = []` | 已写 |
| `lib/index.js` | 宿主侧：注入菜单、复制启动器、轮询待办文件、注册 `/api/plugins/dsh-explorer-open/request` | 离线自测全绿，**未在真实进程验证** |
| `lib/registry.js` | 用 `reg.exe` 写/删 `HKCU\Software\Classes\{Directory\Background, Directory, *}\shell\OpenWithDsh` | 实测写入/删除通过 |
| `lib/launch.ps1` | 启动器：文件→父目录、写 `~/.dsh/dsh-explorer-open/pending.json`（无 BOM）、启动 `DeepSeek Harness.exe` | 实测通过（中文路径 + 文件参数） |
| ~~`lib/launch.js`~~ | 旧的 node 版启动器 | **已删除** |
| `client.js` | 页面侧：轮询接口 → `workspaces.create` → `sessions.create` → `openSession`（失败退回 `openWorkspace`）；文件请求再写草稿 `@引用` | 离线自测全绿，**未在真实页面验证** |
| `lib/win11.js` | 新式菜单的 MSIX 包管理：`installPackage()`/`removePackage()`/`installedVersion()`，比对 `native/version.txt` | 实测装/卸通过 |
| `assets/dsh.ico` | 菜单图标（不再借用安装目录里的 tray.ico） | 已就位 |
| `native/` | 发布用产物：`DshOpenWith.msix`、`dsh-open-with.cer`、`trust-cert.ps1/.bat`、`version.txt` | 由 `win11/build.sh` 同步 |
| `test/host-test.mjs`、`test/client-test.mjs` | 两段自测（从 `.probe/` 迁入） | 15 + 14 项 PASS |
| `README.md` / `LICENSE` / `.gitignore` | 开源文档（MIT） | 已写 |
| `locale/zh.json` / `locale/en.json` | 显示名与描述 | 已写 |
| `icon.svg` | 插件图标 | 已写 |

**状态（2026-11-06 22:50）：两条链路都已在真机跑通。**

- 旧式菜单（Win11「显示更多选项」/ Win10）：出现「通过 dsh 打开」+ tray 图标；点击会为对应文件夹新建会话并跳过去。
- 新式精简菜单（Win11 默认菜单）：出现「通过 dsh 打开」+ 图标；点击同样新建会话并跳转。实现方式是稀疏 MSIX 包 + 原生 `IExplorerCommand`（见第 6 节）。
- MSIX 的安装/卸载已经接进插件生命周期（`lib/win11.js`，用 `native/DshOpenWith.msix`）：插件启用时装、关闭时卸。证书受信后 `Add-AppxPackage` **不需要管理员**。
- 仍待做：重启 dsh 让新的宿主代码（第 0 段 effect）真正生效；把 `native/` 里的产物固定下来（目前是手工从 `win11/build/` 拷的，见第 7 节）；清理 `.probe/`、`win11/build/stage.*`。

自测资产（`test/`，随仓库分发）：

- `host-test.mjs` —— 假 ctx 跑宿主 `apply`：启动器/图标复制、`config.json`、路由注册、403/200、待办消费、去重/过期/非目录/缺失文件丢弃、`file` 透传、dispose 清理。**必须隔离**，否则会抢走正在运行的宿主的 `pending.json`、还会把真实右键菜单键删掉（踩过）。内置两道守卫（`DSH_EXPLORER_OPEN_REG_BASE` + `DSH_EXPLORER_OPEN_TEST_HOME=1`），正确跑法：
  ```bash
  USERPROFILE='E:\tmp\dsh-explorer-open-home' DSH_EXPLORER_OPEN_TEST_HOME=1 \
  DSH_EXPLORER_OPEN_REG_BASE='HKCU\Software\Classes\__dsh_explorer_open_test' \
  DSH_EXPLORER_OPEN_NO_MSIX=1 node test/host-test.mjs
  ```
  （`lib/registry.js` 里的 `REG_BASE` 支持用 `DSH_EXPLORER_OPEN_REG_BASE` 覆盖，默认仍是 `HKCU\Software\Classes`；跑完记得 `reg delete "HKCU\Software\Classes\__dsh_explorer_open_test" /f`。）
- `client-test.mjs` —— 假 `__ModuleLoader__` / fetch / 三个服务跑 `client.js`，断言调用序列、兜底路径、`@引用` 拼装与 `clearPreviousDraft`。

## 5. 已解决 / 仍需确认

已解决：

1. `lib/launch.js` 已删除，`package.json` 的 `files` 用 `lib` 整目录，不残留。
2. 启动器改成 PowerShell 5.1 可跑的形式，菜单命令为
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<launch.ps1>" "%V"`；`launch.ps1` 本身在安装时被复制到 `%USERPROFILE%\.dsh\dsh-explorer-open\launch.ps1`，菜单不依赖开发目录。
3. PowerShell 写 UTF-8 坑：用 `[System.IO.File]::WriteAllText($temp, $json, [System.Text.UTF8Encoding]::new($false))`，实测首字节 `0x7b`，中文路径正确。
   反向坑：**无 BOM 的 .ps1 会被 5.1 按 GBK 解码**，所以 `launch.ps1` 源码全 ASCII，绝不要往里加中文。
4. `client.js` 直接 `fetch('/api/plugins/dsh-explorer-open/request')` 可用（与 `dsh-client-auto-continue` 同款做法）。
5. Client 侧只用 `workspaces` / `sessions` / `uiWorkspace`，未用 `workspaceRegistry`。
6. 三个菜单键都写：`Directory\Background`（空白处）、`Directory`（文件夹）、`*`（任意文件，`%V` 是文件路径，启动器取父目录）。目录是 HKCU，Win11 的新式菜单与旧式「显示更多选项」都会读到。
7. 重复触发防护：待办文件带 `token` + 时间戳，读后立即删除，只认 2 分钟内的请求，同文件夹 1.5s 内去重。
8. 关闭插件即移除注册表：`ctx.effect` 清理函数调 `removeLegacy()` + `refreshExplorer()`，自测已验证。
9. 接口加了 `x-dsh-explorer-open: 1` 请求头校验（跨站页面带自定义头会触发预检被拦），非本页面请求返回 403。
10. `workspaces.create({path})` 对同一路径是幂等的（宿主 `dsh-workspace/lib/index.js:408` 注释明确），所以已存在的文件夹不会被重复建工作区。

仍需确认（真机，见第 6 节）：

- Win11 新式菜单里到底出不出「通过 dsh 打开」——理论靠 `shell` 键即可，未实测。
- 点击后是否真的新建会话并切过去。
- 关闭插件 / 卸载后菜单项是否消失。
- 管理员身份运行的资源管理器窗口不显示用户级菜单项（已知限制，交付时说明）。

## 6. 下一步：重启后照着验

1. 完全退出 DeepSeek Harness（托盘退出，确认进程没了），再启动。**不要**只是重开窗口：宿主插件代码和 client bundle 都只在启动/重载时加载。
2. 重载页面（或重启后重新打开 GUI）。
3. 验三处右键：文件夹空白处、文件夹图标上、任意文件上，都应有「通过 dsh 打开」（Win11 需点「显示更多选项」看旧菜单）。
4. 点一下（建议点一个还没在 dsh 里打开过的新文件夹）：应新建工作区 + 新建会话 + 界面跳过去。
5. 再点另一个文件夹，确认每次都是新会话，不是复用旧会话。
6. 关闭插件（`plugin_manager set_plugin` 关闭，或从 profile 移除后重启），确认三个右键菜单项消失；重新启用后恢复。
7. 全程盯日志里的 `右键菜单已写入=...` 与 `launch.ps1` 路径，确认指向 `%USERPROFILE%\.dsh\dsh-explorer-open\launch.ps1` 而不是开发目录。

如果第 3 步不出现菜单：先 `reg query` 三个键在不在（在 → 是菜单缓存/刷新问题，跑 `refreshExplorer`；不在 → 宿主 `apply` 没跑，看是否有加载报错）。
如果第 4 步不跳转：先在浏览器/DevTools 看 `/api/plugins/dsh-explorer-open/request` 有没有被轮询（client bundle 是否注入），再看 `workspaces.create` 抛什么错。

## 7. 工作环境注意事项

- 工作目录：`E:\work\tools\dsh-explorer-open`（Bash 路径 `E:/work/tools/dsh-explorer-open`。2026-11-06 23:40 用户把目录从 `右键文件夹在dsh中打开` 改成了这个名字，profile 里的 link 已用 `remove_bundle` + `install_bundle` 重新指向新路径）
- 文件策略 danger-full-access，但**审批被禁用**，不能申请提权。
- `ops_write_file` / `ops_read_files` 对某些路径会被 `PUBLICATION_DENIED` / `PATH_RESTRICTED` 拒绝，**改用标准 `write` / `read` 工具即可**。
- 上一轮会话多次出现「工具调用块发成空内容」的格式错误，**教训：单次只发一个短调用，避免长串并行调用**。
- `.probe/` 目录存放了 app.asar 的解压副本（`.probe/asar/`）和 `main.js`，是分析用的临时产物，可随时删除。
- 用户曾询问「是否在逆向」：已说明 `.probe/asar` 是 asar 解包（非加密破解），且接口查询走的是 dsh 自带自检接口。用户表示「按自己的节奏继续」。

## 6. Win11 新式精简菜单（原生 COM + 稀疏 MSIX）

Win11 的新菜单**只认带包身份（packaged identity）的扩展**，且包必须被签名、证书必须在受信链上。纯注册表写法进不了新菜单（实测过：`Directory\shell\...` 只出现在「显示更多选项」里）。

### 6.1 目录 `win11/`（原生组件的源码与构建）

| 文件 | 作用 |
|---|---|
| `src/dsh_open_with.cpp` | `IExplorerCommand` 实现 + `DllGetClassObject`；CLSID `{B4C9C3E5-1F0B-4D62-9E37-3A5C1B8FA0D1}` |
| `src/stub.cpp` | 清单要求的 `Windows.FullTrustApplication` 入口，空壳，永不被启动 |
| `src/test-host.cpp` | 绕过资源管理器直接调 COM 的自测宿主（`--no-invoke` 可只读状态） |
| `src/msix.manifest` | 嵌进 DLL 的 PE manifest：`<msix publisher="CN=DshOpenWith" packageName="DshOpenWith.Local" applicationId="App"/>`，缺了它 Explorer 不会加载扩展 |
| `src/msix.rc` | `1 24 "msix.manifest"`（RT_MANIFEST），由 `windres` 编成 `build/msix.res.o` |
| `package/AppxManifest.xml` | 包清单：`DshOpenWith.Local` / `CN=DshOpenWith` / 版本号（每次改内容都要 +1） |
| `make-assets.py` | 纯标准库生成 PNG 图标（本机没有 Pillow） |
| `build.sh` | 编译 → 签名 DLL/exe → `makeappx pack` → `signtool sign` |
| `install-msix.ps1` / `uninstall-msix.ps1` | 手工安装/卸载（安装前会先移除旧版本） |
| `trust-cert.ps1` / `trust-cert.bat` / `elevate-trust.ps1` | 把自签证书装进 `LocalMachine\TrustedPeople`（**需要管理员**，只做一次） |
| `assets/dsh.ico` | 新菜单图标（`tray.ico` 副本） |

清单要点：`<Application Id="App" Executable="DshOpenWithStub.exe" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App">`、`<uap:VisualElements AppListEntry="none" .../>`、`Properties` 里关掉注册表/文件系统写虚拟化、`Capabilities` 加 `runFullTrust` + `unvirtualizedResources`；`desktop4:Extension windows.fileExplorerContextMenus` 下三个 `desktop5:ItemType`：`Directory`、`Directory\Background`、`*`，同一个 Clsid；`com:Extension windows.comServer` → `com:SurrogateServer` → `com:Class Path="DshOpenWith.dll" ThreadingModel="STA"`。**清单里的 GUID 不能带花括号**（否则 `0x80080204 / 0xC00CE169`）。

### 6.2 构建与签名（一次性环境）

```bash
cd win11 && bash build.sh          # 产出 build/DshOpenWith.msix（已签名）
powershell -File install-msix.ps1  # 或让插件自己装
```

- 工具链：`g++ / windres` 来自 `D:/mingw64`；`makeappx.exe / signtool.exe` 从 NuGet 包 `Microsoft.Windows.SDK.BuildTools` 解到 `win11/build/sdk/bin/10.0.28000.0/x64/`。
- 证书：`CN=DshOpenWith`，指纹 `85DD43E68BEC4871E76A882E23FAFA1787FF4B67`，私钥在 `Cert:\CurrentUser\My`，**不要导出 pfx**（安全网会拦 `.pfx`）；直接 `signtool sign /sha1 <THUMB>` 从证书存储签。
- 信任链：`CurrentUser\Root` / `CurrentUser\TrustedPeople` **都不行**，必须 `LocalMachine\TrustedPeople`（管理员），否则 `Add-AppxPackage` 报 `0x800B0109`。

### 6.3 踩过的坑（都很费时间）

1. **`GetState` 返回 `ECS_HIDDEN` 会让菜单项彻底消失**：菜单构建时 Explorer 传给 `GetState` 的 `IShellItemArray` 是 **null**（托管代理进程里），拿不到路径就不要自作聪明地隐藏。现在 `GetState` 恒返回 `ECS_ENABLED`，路径解析只在 `Invoke` 里做。
2. **代理进程里 `GetModuleFileNameW(NULL)` 拿到的是代理进程的路径**（`C:\Windows\system32\`），所以图标路径要用 `DllMain` 里保存的 `g_hinst`：`GetModuleFileNameW(g_hinst, ...)`。
3. **`-static` 必须加**：否则 DLL 依赖 `libwinpthread-1.dll`，`WindowsApps` 里没有这个文件，加载静默失败。
4. 调试靠 `AppendLog`：只在 `DSH_OPEN_WITH_DEBUG=1` 时写 `%LOCALAPPDATA%\dsh-explorer-open-command.log`（UTF-16LE，读的时候要 `Get-Content -Encoding Unicode`）。
5. **绝不要 `taskkill explorer.exe` 再用 `cmd start` 重启**：踩过一次，用户桌面黑屏、任务栏消失。要重启就用 `powershell -Command "Stop-Process -Name explorer -Force; Start-Process explorer.exe"`，并且先跟用户确认。

## 7. 剩余待办

1. 重启 dsh，确认新宿主代码生效：启动日志里应出现 `[dsh-explorer-open] 新式菜单已就绪 ...`；关闭插件时两条菜单都要消失（旧式改注册表、新式卸包）。
2. ~~`native/` 手工同步~~ 已解决：`win11/build.sh` 末尾自动把 `DshOpenWith.msix`、`dsh-open-with.cer`、`version.txt` 同步到 `native/`（`trust-cert.*` 是手写文件，不在同步列表里）。所以改原生组件的流程是：改源码 → `bash win11/build.sh` → 插件下次启动自动升级包（版本号变了就重装）。
3. 清理：已删除 `win11/build/stage.*`、`.probe/` 里的临时脚本与 `home/`、旧诊断日志。**保留** `.probe/host-test.mjs`、`.probe/client-test.mjs`、`.probe/main.js`（回归测试用）和 `.probe/asar/`（app.asar 解压副本，读 skill 文档要用，删了要重新解）。`win11/build/sdk/` 可保留。
4. 分发形态：目前证书是自签的，别人装必须先跑一次 `trust-cert.bat`（管理员）。若要做成给别人用的安装包，需要正经的代码签名证书，或者接受「新式菜单只在本机可用」。
5. 目录被改名后（2026-11-06 已发生一次）：profile 里的 `link:` 会指向旧路径导致插件加载失败。修复方式是 `plugin_manager remove_bundle dsh-explorer-open` 再 `install_bundle <新路径>\plugin`（不能直接 install，会报 `already-installed`）。

## 8. 文件右键「@引用」与开源打包（2026-11-07）

需求（m01211）：右键普通文件时，新会话输入框里要把该文件作为引用带上；项目要开源到 GitHub，并支持官方渠道安装。

### 8.1 文件引用怎么实现的

- 启动器不再丢掉文件路径：payload 变成 `{folder, token, at, file?}`，`file` 只在目标本身是文件时出现（`file` 是原始 `%V`，`folder` 是父目录）。
- 宿主 `lib/index.js`：`isFile()` 校验，去重键改成 `folder + '\0' + file`，队列项带 `request.file`。
- 页面 `client.js`：`relativeMention(cwd, file)` 把绝对路径转成相对会话 cwd 的写法——含空白用 `@"sub\a b.txt"`，否则 `@sub\a.txt`，末尾补一个空格；**文件不在工作区里就不写引用**（只开会话）。写入走
  `ctx.get('conversation').input.requestDraftInitialization(binding, { prompt, clearPreviousDraft: true })`，
  需要 `ctx.sessions.binding(sessionId)` 先就绪，所以有 20×100ms 重试；拿不到就退回 `uiWorkspace.startSession(workspaceId, { prompt, clearPreviousDraft: true })`。
- 为什么这么做：草稿里的 `@路径` 本身就是引用语法（`dsh-client-ui-reference/lib/client.js` 的 `fileReferenceRule`，正则 `/(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu`），提交时按会话 cwd 解析成文件引用，不需要额外的 UI API。
- 启动器的 exe 路径不再写死：先读 `~/.dsh/dsh-explorer-open/config.json` 的 `exe`（插件启用时写 `process.execPath`），其次 `DSH_EXPLORER_OPEN_EXE`，最后才是几个常见安装路径。
- 菜单图标也不再借用 `D:\DeepSeek Harness\resources\tray.ico`：改用自带 `assets/dsh.ico`，启用时复制到 `~/.dsh/dsh-explorer-open/dsh.ico`。

### 8.2 仓库结构（仓库根 = 插件包）

原来插件在 `plugin/` 子目录，开源前整体上移，现在 `package.json` 就在仓库根。最初的包名候选 `dsh-open-with` 在 npm 上已被占用，于是定名 `dsh-explorer-open`；0.1.3 起又迁到 `@reed-io/dsh-explorer-open`（见第 11 节）。profile 里已重新挂过：
`plugin_manager remove_bundle dsh-explorer-open` → `install_bundle E:\work\tools\dsh-explorer-open`。

`npm pack` 产物 19 个文件（不含 `test/`、`win11/`、`.probe/`），230KB 左右，主体是 `native/DshOpenWith.msix`。

### 8.3 官方渠道

- `plugin_manager install_bundle` 的 target 接受 npm 包名/版本 spec（profile 里已有 `dsh-better-sidebar@0.30.1` 这种形态），所以**发布到 npm 之后，用户粘包名就能装**。
- `dsh-plugin-market` 的目录是服务端下发的目录文档，不是「发 npm 就自动出现」，需要提交收录。

### 8.4 内部命名统一（2026-11-07）

包名改成 `dsh-explorer-open` 之后，JS/PS 层的内部标识也统一了（原生组件仍是 `DshOpenWith.Local`，证书/包身份不动）：
状态目录 `~/.dsh/dsh-explorer-open/`、接口 `/api/plugins/dsh-explorer-open/request`、请求头 `x-dsh-explorer-open`、日志前缀 `[dsh-explorer-open]`、环境变量 `DSH_EXPLORER_OPEN_{NO_MSIX,EXE,REG_BASE,TEST_HOME}`。旧的 `~/.dsh/dsh-explorer-open/` 目录可以直接删掉（里面的 launch.ps1/config.json/dsh.ico 下次启用会重建）。

### 8.5 发布记录（2026-11-07）

- 仓库：<https://github.com/ame-code/dsh-explorer-open>，分支 `main`，最新提交 `d842d3f`（版本改 0.1.0）。
- npm：`dsh-explorer-open@0.1.0` 已上线，`dist-tags.latest = 0.1.0`；
  tarball `https://registry.npmjs.org/dsh-explorer-open/-/dsh-explorer-open-0.1.0.tgz`，
  211224 字节，`shasum 2b7ea87f29b7305238a7bb3d6fb862bf0ccaaebf`，19 个文件（含 `native/DshOpenWith.msix` 与 `assets/dsh.ico`）。
- 历史遗留：先误发过 `1.0.0`（`npm unpublish --force` 撤销，npm 留下占位版本 `0.0.0-stage`，可忽略）。
- **官方渠道已实测**：`plugin_manager remove_bundle dsh-explorer-open` → `install_bundle target=dsh-explorer-open`（裸包名，走 registry）→
  `+ dsh-explorer-open 0.1.0`，装出来是真实目录（非 link），`lib/`、`native/`、`assets/` 齐全。**用户粘包名即可安装**。
- 验证完已切回开发用 link：`remove_bundle` → `install_bundle target=E:\work\tools\dsh-explorer-open`，
  profile 里恢复 `"dsh-explorer-open": "link:E:/work/tools/dsh-explorer-open"`。
- 切回后复核：三个注册表键默认值仍为「通过 dsh 打开」、`Get-AppxPackage DshOpenWith.Local` = `1.0.0.7`。

### 8.6 还没做的

1. 用户重启 dsh 后要验证：文件右键草稿里出现 `@文件`；空白处/文件夹/文件三种右键都仍在；新式菜单图标正常；`~/.dsh/dsh-explorer-open/` 目录被重建。
2. 真要进 `dsh-plugin-market` 需要向那边提交收录（不是发 npm 就自动出现）。
3. 升级路径（用户已装旧版本 → 新版本）还没真实演练过。

## 9. 0.1.0 发布后的两个回归（2026-11-07 已修）

现象：无论在哪个文件夹右键，都只是把 dsh 调到前面，不打开工作区、不新建会话。

根因一：`win11/src/dsh_open_with.cpp` 里 `LauncherPath()` 仍写着 `%USERPROFILE%\.dsh\dsh-explorer-open\launch.ps1`（改名前的目录）。
新式菜单因此把 `pending.json` 写进旧目录，而宿主读的是 `~/.dsh/dsh-explorer-open/`，请求永远没人取。
根因二：DLL 传给启动器的是 `ParentFolderOf(路径)`，文件信息被丢掉，所以即使目录对了，文件右键也不会有 `@引用`。

修法：
- `LauncherPath()` 改指 `\.dsh\dsh-explorer-open\launch.ps1`，不再有旧目录兜底；日志文件名也改成 `dsh-explorer-open-command.log`。
- `FolderFromShellItemArray` → `SelectedPath`：返回**原始选中项路径**（文件仍是文件），由 `lib/launch.ps1` 拆成 `folder` + `file`；`GetState`/`Invoke` 同步改名，日志 `Invoke selection=...`。
- 版本升到 `1.0.0.8` 重新打包签名安装（`native/version.txt` 自动更新）。
- 新增诊断链路：宿主 `/api/plugins/dsh-explorer-open/ack?stage=start|ok|fail&detail=...` 写 `~/.dsh/dsh-explorer-open/trace.log`，页面每次领取请求/成功/失败都回报；`README.md` 增加「排查」一节。
- 顺手修 `win11/build.sh` 被 git 转成 CRLF 导致 `g++: fatal error: no input files`：加 `.gitattributes`（`* text=auto eol=lf`、`*.sh`/`*.ps1` 强制 LF、二进制标记），并就地转回 LF。

验证：`trace.log` 出现 `poll served=E:\work\tools\dsh-workplace-move\prompt.md` → `ack stage=start` → `ack stage=ok`（270ms 内），用户确认「成功了」。

**发版注意**：npm 上的 `0.1.0` 内置的 MSIX 仍是旧的 `1.0.0.7`（同样有这两个 bug），必须发 `0.1.1` 覆盖；本地 `package.json` 已是 `0.1.1`。
另：`plugin_manager remove_bundle` + `install_bundle` 会让宿主**热重建插件**（实测服务停止后旧路由返回 401、重装后新路由立即生效），改宿主代码不必重启 dsh；但客户端 bundle 仍需刷新页面。

## 10. dsh 0.2.2-rc.2 兼容性核对（2026-11-12）

本机当时是 0.2.2-rc.1（`DeepSeek Harness.exe` ProductVersion 0.2.2.0，卸载项 0.2.2-rc.1）。rc.2 只在 GitHub 上有 tag（`dsh-v0.2.2-rc.2`，2026-11-11），npm 上各 `@deepseek-ai/dsh-*` 仍停在 0.2.2-rc.1，拿不到可运行的 rc.2，所以做的是**源码契约核对**：

```bash
git clone --filter=blob:none --no-checkout --depth 1 --branch dsh-v0.2.2-rc.2 \
  https://github.com/deepseek-ai/deepseek-harness "$env:TEMP\dsh-rc2"
git sparse-checkout set packages .agents
```

逐文件与 rc.1（`gh api contents?ref=dsh-v0.2.2-rc.1`）比对，结果：

| 契约 | rc2 结论 |
| --- | --- |
| `packages/client/ui-workspace/src/client/navigation.ts`（`openWorkspace`/`openSession`/`startSession`、`StartSessionOptions`） | 0 差异 |
| `packages/api/workspace-controller/src/client/service.ts`（`create({path})`、`super(ctx,'workspaces')`） | 0 差异 |
| `packages/host/webserver/src/index.ts`（`WebRoute`/`WebResourceRoute`，只答 GET/HEAD） | 0 差异 |
| `packages/client/modules/src/client/manifest.ts`（`dsh.client` 校验、`__ModuleLoader__.load({id,factory})`、`platform==='web'`） | 0 差异 |
| `packages/util/package-manifest/src/types.ts`（`dsh.bundle.patch`、`dsh.client.*`） | 0 差异 |
| `packages/api/session-controller/src/client/contract/sessions.ts`（`sessions.create`/`binding`、`SessionTarget`） | 仅注释改写 |
| `packages/client/ui-conversation/src/client/contract/input.ts` | 新增 `insertQuote`，`requestDraftInitialization`/`DraftInitializationOptions` 未变 |

结论：插件用到的接口在 rc.2 全部保持，**不需要改代码**。rc.2 的相关变化都在别处：

- 新增插件**更新**流程（`updateBundle`，registry/git 两类 bundle），装包时的兼容检查会读 `engines.dsh`（否则看 `@deepseek-ai/dsh*` 的 `peerDependencies`）。我们两者都没声明，所以不受门禁影响。
- 浏览器启动审计（`packages/client/web/src/boot-client.ts`）的必活名单只有 7 个核心包（`dsh-client-modules`、`dsh-api-session-controller`、`dsh-client-ui-renderer`、`dsh-client-ui-layout`、`dsh-client-ui-session`、`dsh-client-ui-chat`、`dsh-client-ui-sidebar`），本插件不在其中：注入没满足时只产生一条 console 警告，不会拖垮启动。
- 仓库内新增「插件入口不得额外导出值」的 CI 门禁（`verify-plugin-entry-exports`），只约束仓库自身的包，不影响第三方插件；我们的 `index.js` 本来就只导出 `apply` 和 `inject`。
- `/api` 自注册路由仍然只被 `/` 与 connection 的 cookie 鉴权覆盖，本插件的 `/api/plugins/dsh-explorer-open/*` 行为不变。

遗留：rc.2 真机回归（升级后重跑右键三处 + 文件 `@引用`）还没做；`README.md` 已加「兼容性」一节。

## 11. 2026-11-12/13：另一台机器「菜单不出现」、自动提权修复（0.1.3）、包名迁到 scope

### 11.1 用户机器（aleaf）的现象与根因
- 现象：插件装上了（`dependencies: 0.1.2`、`in bundles: True`、三个经典键 PRESENT），但 Win11 新式菜单没有条目；`Get-AppxPackage DshOpenWith.Local` 为空、证书不在 `LocalMachine\TrustedPeople`。
- 运行目录里有 `.trust-prompt`（24 字节）= 自动提权分支跑过、写了 12 小时冷却标记，但 2 分钟轮询内证书始终没被信任。
- 该机器策略：`EnableLUA=1`、`ConsentPromptBehaviorAdmin=0`（提权不提示、静默通过）、`PromptOnSecureDesktop=0`、当前令牌 `Medium` + `Administrators`「只用于拒绝」。也就是说提权**不会弹窗**，用户完全感知不到，失败也无声。
- 手工执行 `native\trust-cert.ps1` 后证书立刻进 `TrustedPeople`，随后 `Add-AppxPackage` 成功 → `1.0.0.8 / Developer / Ok`，菜单恢复。说明脚本本身没问题，问题在「静默失败 + 无日志 + 失败也锁 12 小时」。
- 教训：静默提权环境里，任何「弹个 UAC 就好」的设计都不可验证，必须落盘日志 + 失败可重试 + 给人看得懂的说明。

### 11.2 0.1.3 改了什么
- `lib/index.js`：只有装成功（`current` / `installed`）才清除 `.trust-prompt` 并删掉 `NEED-TRUST.txt`；超时/失败一律 `clearTrustPrompt()`，下次启动继续重试；新增 `writeTrustHelp(reason)`，把「用管理员 PowerShell 执行这一条」写进 `~/.dsh/dsh-explorer-open/NEED-TRUST.txt`；未尝试提权（`DSH_EXPLORER_OPEN_NO_ELEVATE=1` 或冷却期）也写这份说明。
- `native/trust-cert.ps1`：全程追加日志到 `%LOCALAPPDATA%\dsh-explorer-open-trust.log`（首行 `start pid=… admin=… user=…`，提权用 `-Wait -PassThru` 记子进程退出码，导入后回查存储确认）；去掉 `-NoExit`，失败 `exit 1`。
- `README.md`：安装段改成「多数情况不用敲命令；失败看 NEED-TRUST.txt 与 trust log」；本地安装段把 `plugin_manager` 换成 `dsh plugin --profile desktop add <路径>`，并注明它只写 `dependencies`、不写 `dsh.profile.bundles`。
- 版本 `0.1.3`，提交 `851d7e5`。

### 11.3 包名迁到 `@reed-io/dsh-explorer-open`
- 起因：用户的 npm token 是按 scope 授权的（只覆盖 `@reed-io`），发全局包会 `E403`。npm 没有「迁移到 scope」操作，等价做法是用新名字重发 + 旧名字 `deprecate`。
- 改动：`package.json` 的 `name` 改 `@reed-io/dsh-explorer-open`、加 `"publishConfig": { "access": "public" }`（scoped 包默认私有）；`cordis.patch.yml` 的 `name` 同步改，实例 `id` 仍是 `dsh-explorer-open`；`scripts/diagnose-windows.ps1` 同时识别新旧两个包名；`README` 安装名同步。
- **不变的部分**：运行时目录 `~/.dsh/dsh-explorer-open/`、`/api/plugins/dsh-explorer-open/*`、请求头 `x-dsh-explorer-open`、环境变量 `DSH_EXPLORER_OPEN_*`、原生组件名（`DshOpenWith.Local`、`dsh-open-with.cer`）。
- 提交 `d5ce85c`；本机 profile 已用 `remove_bundle dsh-explorer-open` → `install_bundle <仓库路径>` 重挂为 `@reed-io/dsh-explorer-open 0.1.3`，三键与 MSIX 1.0.0.8 均正常。
- 旧包 `dsh-explorer-open@0.1.2` 已 `npm deprecate`（消息「已迁移到 @reed-io/dsh-explorer-open」）。

### 11.4 `plugin_manager` 不是 CLI
- 它是宿主内置的 **agent 工具**（在 `app.asar` 里与 `bash`/`schedule_create`/`credentials` 并列，属于 Host 自己拥有的能力），终端里敲 `plugin_manager …` 必然「无法运行」。
- 给用户的可执行等价物：dsh 的插件界面/市场；或 `dsh plugin --profile <name> add|remove <pkg>`（转发 pnpm，只动 `dependencies`）；手动装还要把包名写进 `dsh.profile.bundles`。

### 11.5 待办
1. `@reed-io/dsh-explorer-open` 目前 registry 上只有 `0.0.0-stage` 占位，**0.1.3 还没真正发上去**，需要再 `npm publish --otp=…` 一次（新版本号 0.1.3 > 0.0.0-stage，不会被 latest 冲突挡住）。
2. aleaf 那台机器验证：重装插件后是否只提示一次、失败时 `NEED-TRUST.txt` 是否出现。
3. 市场投稿 YAML 的 `name:` 是仓库链接文字，不涉及包名，无需改动。
