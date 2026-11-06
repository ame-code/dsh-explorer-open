# dsh-explorer-open

在 Windows 资源管理器的右键菜单里加一条 **「通过 dsh 打开」**：点一下就在 [DeepSeek Harness](https://github.com/deepseek-ai) 里打开这个文件夹（没有工作区就新建），并开一个新会话。

Win11 的**新式简洁菜单**和**旧式完整菜单**里都有这一条，都带图标。

- 仓库：<https://github.com/ame-code/dsh-explorer-open>
- npm：`dsh-explorer-open`

## 功能

| 在哪儿右键 | 打开的文件夹 | 放进新会话的草稿 |
| --- | --- | --- |
| 文件夹空白处 | 当前文件夹 | 无 |
| 文件夹图标上 | 这个文件夹 | 无 |
| 任意文件上 | 文件所在的文件夹 | `@文件名` 引用（工作区之外的路径不引用） |

- 每次都**新建会话**并切过去；工作区按完整路径复用，不会重复创建。
- dsh 没开时会先把它拉起来，请求排队等页面连上再执行。
- 插件停用/卸载时会**自己拆掉菜单**（旧式注册表键 + Win11 新式 MSIX 包），不留垃圾。

## 状态

当前 **0.1.x**：功能可用，但接口（`/api/plugins/...` 路径、`~/.dsh/dsh-explorer-open/` 状态目录、`DSH_EXPLORER_OPEN_*` 环境变量）和安装方式都还可能变，破坏性改动不保证向后兼容。

原生组件（`win11/`）有独立的版本号，见 `native/version.txt`；JS 侧版本见 `package.json`。

## 安装

### 从 npm 安装（推荐）

在 dsh 的插件设置里安装 `dsh-explorer-open`，或让 agent 执行安装（bundle 安装入口接受 npm 包名）。

首次启用时会自动装 Win11 新式菜单所需的 MSIX 包。因为是自签证书，包里没有受信的根，Windows 会拒绝安装并给出：

```
Deployment failed with HRESULT: 0x800B0109
```

这时以管理员身份运行一次插件目录下的 `native/trust-cert.bat`（把自签证书 `dsh-open-with.cer` 导入 `LocalMachine\TrustedPeople`），然后重启 dsh 即可。只需要做一次。

> 只想要旧式菜单、不想动证书：设环境变量 `DSH_EXPLORER_OPEN_NO_MSIX=1` 再启动 dsh，插件就不会去装 MSIX 包。

### 从源码/本地目录安装

```powershell
# 仓库本身就是插件包（package.json 在根目录）
plugin_manager install_bundle E:\work\tools\dsh-open-with
```

改过代码后要重启 dsh 才会重新加载宿主侧插件；客户端 bundle 需要刷新页面。

## 工作原理

```
资源管理器右键
   ├─ 旧式菜单：HKCU\Software\Classes\{Directory\Background, Directory, *}\shell\OpenWithDsh
   │     └─ powershell -File launch.ps1 "%V"   （无窗口，写入待办后退出）
   └─ 新式菜单：MSIX 包身份 + 原生 IExplorerCommand
         └─ 同一个 launch.ps1
                ↓
   %USERPROFILE%\.dsh\dsh-explorer-open\pending.json   {folder, file?, token, at}
                ↓  宿主侧插件每 300ms 扫描
   GET /api/plugins/dsh-explorer-open/request          （带 x-dsh-explorer-open 头）
                ↓  页面侧插件每 1s 轮询
   workspaces.create → sessions.create → uiWorkspace.openSession
                ↓  文件右键时
   conversation.input.requestDraftInitialization(binding, { prompt: '@文件', clearPreviousDraft: true })
```

- 启动器用 PowerShell 5.1 写 UTF-8（**无 BOM**）、先写临时文件再改名，页面不会读到半个 JSON。
- `/api/...` 路由要求自定义请求头，跨站页面带不上它（会先触发预检），因此别的网页没法领走排队中的请求。
- dsh 可执行文件位置由插件写进 `config.json`，启动器按 config → `DSH_EXPLORER_OPEN_EXE` → 常见安装路径的顺序查找。

## win11/ 原生组件

Win11 新式菜单不接受「注册表 + exe」的旧式扩展，必须是一个**有包身份、已签名、且 DLL 内嵌了 msix 身份清单**的 COM 组件。`win11/` 就是这个组件：

```
win11/
├─ src/dsh_open_with.cpp   IExplorerCommand 实现（GetTitle/GetIcon/GetState/Invoke）
├─ src/stub.cpp           满足清单的占位 exe（Windows.FullTrustApplication 入口，永不被启动）
├─ src/test-host.cpp      不经过资源管理器的自测宿主
├─ src/msix.manifest      DLL 内嵌的 msix 身份（publisher/packageName/applicationId）
├─ src/msix.rc            把上面那份清单编进 PE 资源
├─ assets/dsh.ico         菜单图标
├─ package/AppxManifest.xml  MSIX 清单：comServer + fileExplorerContextMenus
├─ build.sh               构建 → 签名 → 打包 → 同步到 ../native/
├─ install-msix.ps1 / uninstall-msix.ps1
└─ trust-cert.ps1 / trust-cert.bat   把自签证书导入受信存储
```

重新构建（需要 MinGW-w64、`windres`、Windows SDK BuildTools 的 `makeappx`/`signtool`，以及 `Cert:\CurrentUser\My` 里的 `CN=DshOpenWith` 证书）：

```bash
cd win11
bash build.sh
```

`build.sh` 会把签名好的 `DshOpenWith.msix`、`dsh-open-with.cer` 和 `version.txt` 复制到 `../native/`，插件启用时按 `version.txt` 决定要不要重装。

### 踩过的坑（都已在代码里修掉）

1. **清单里的 GUID 不能带花括号**，否则 `Add-AppxPackage` 报 `0x80080204 / 0xC00CE169`。
2. **DLL 必须内嵌 msix 身份清单**，否则资源管理器根本不会加载这个 COM 类（表现为"装好了但菜单里没有"）。
3. DLL 必须 `-static` 链接：包目录里没有 `libwinpthread-1.dll`。
4. `GetState` 不要依赖选中项解析结果：新式菜单取「文件夹空白处」时 `IShellItemArray` 是空的，返回 `ECS_HIDDEN` 会把菜单项藏起来。恒返回 `ECS_ENABLED`，路径解析放到 `Invoke`。
5. AppX 代理进程里 `GetModuleFileNameW(NULL)` 返回的是代理进程的路径，图标要按 `DllMain` 保存的 `hinst` 取自身目录。
6. 自签证书必须进 `LocalMachine\TrustedPeople`；`CurrentUser\Root` / `CurrentUser\TrustedPeople` 都不够。

## 开发

```bash
# 宿主侧：注册表、待办扫描、HTTP 路由、启用/停用清理
# USERPROFILE 指向一个空目录（要用 Windows 路径写法），DSH_EXPLORER_OPEN_TEST_HOME=1 是防误跑的开关
USERPROFILE='E:\tmp\dsh-explorer-open-home' DSH_EXPLORER_OPEN_TEST_HOME=1 \
DSH_EXPLORER_OPEN_REG_BASE='HKCU\Software\Classes\__dsh_explorer_open_test' \
DSH_EXPLORER_OPEN_NO_MSIX=1 node test/host-test.mjs

# 页面侧：调用顺序、参数、@引用拼装、失败回退
node test/client-test.mjs
```

两个脚本都用假的 ctx / fetch，不会碰真实的菜单和 MSIX 包。

- `HANDOFF.md`：开发笔记（决策记录、踩坑、待办），中文。
- `win11/build/` 与 `.probe/` 是构建产物和本地临时目录，不纳入版本库。

## 排查

点菜单后如果只把 dsh 窗口调到前面、没有打开工作区，先看两个地方：

1. `~/.dsh/dsh-explorer-open/trace.log` —— 宿主记录页面何时取走请求（`poll served=...`）、页面回报的处理结果（`ack stage=start|ok|fail`）。
   - 只有 `poll served` 没有 `ack`：页面里的客户端没跑起来，刷新页面（Ctrl+R）或重启 dsh。
   - `ack stage=fail`：带的是失败原因，多半是工作区/会话服务报错。
   - 连 `poll served` 都没有：请求没到宿主，检查 `~/.dsh/dsh-explorer-open/pending.json` 是否被写出来
     （经典菜单走注册表里的 `launch.ps1`；Win11 新式菜单走 MSIX 里的 `DshOpenWith.dll`，两者都指向这个目录）。
2. `LOCALAPPDATA%\dsh-explorer-open-command.log` —— 只有设了 `DSH_EXPLORER_OPEN_DEBUG=1` 时，原生组件才写这个日志。

## 已知限制

- 只在 Windows 上工作（注册表 + MSIX + 资源管理器）。
- `*` 键会让这一条出现在**所有**文件类型上，包括没有关联程序的。
- 以管理员权限运行的资源管理器不会显示用户级（HKCU）菜单项。
- 新式菜单需要证书受信；分发第三方时应该用正式代码签名证书，而不是自签。

## License

MIT
