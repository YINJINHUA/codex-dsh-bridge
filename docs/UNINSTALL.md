# 卸载、清理与重新安装 / Uninstall, cleanup and reinstall

## 中文

**关闭插件只停用服务，不等于卸载。卸载插件代码也不等于删除聊天、项目登记或通信记录。**

### 1. 先结束相关工作，再正常退出 DSH

确认没有正在执行的会话或后台任务，通过应用菜单退出并确认 Host 已结束。[官方桌面文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md#内置命令运行时)要求使用桌面内置 CLI 管理插件前完全退出应用；客户端内置插件管理器是另一入口。不要强杀有效任务。

### 2. 用 DSH 官方 desktop profile 卸载

在可信本机终端运行应用自带的 CLI。若 `dsh` 已正确指向该 CLI：

以下主命令用于0.3.8起的新包名。若卸载或升级0.3.7及以前版本，须按实际安装名称执行 `dsh plugin --profile desktop remove dsh-plugin-codex-project-bridge`。核旧包及其加载登记已移除后再安装新包，不同时加载两个包；原私有状态目录 `.codex-dsh-bridge` 保留，无需重新登记项目。自建客户端快捷入口若指向旧安装目录，应改为新目录中的 `bin/bridge.mjs`。

```sh
dsh plugin --profile desktop remove codex-dsh-project-bridge
```

macOS 标准应用安装位置示例：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop remove codex-dsh-project-bridge
```

Windows 标准按用户安装位置示例（PowerShell）：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove codex-dsh-project-bridge
```

应用装在其他位置时，使用实际应用目录内的入口；命令不在 PATH 不代表需要重装。遇到版本差异，先查看 `dsh plugin --profile desktop remove --help`。

**不要给上述 remove 命令追加安装时的 `--offline --ignore-scripts`。** DSH 0.2.0-rc.2 随附 pnpm 11.7.0 的 remove 拒绝这两个参数。它们适用于这里使用的 add 安装命令，不能照搬到卸载命令。

### 3. 核对结果及定点清理入口

官方命令负责移除安装目录、profile 依赖、bundle 登记和锁文件引用。当前安装包不声明外部 CLI 命令快捷入口，通信客户端随插件本体一起移除。退出码 0 后还要核对：

- 当前 desktop profile 中已无本桥安装体及加载登记；不要手改数据库或删除整个 profile。
- `node_modules/.bin` 中以 `codex-dsh-bridge` 命名的入口，只有确认指向已删除的本插件时才移除或退役；不删除其他插件的入口。
- 如果曾自行创建本桥专用启动器或桌面快捷方式，确认不再使用后定点退役。包管理器不会管理这些外部文件；保留 DSH 官方入口。
- 没有残留 patch 加载项时，不修改 `cordis.yml` 或 `cordis.patch.yml`。若发现残留，应核对实际配置并用宿主支持的管理方式处理，不凭名字批量删配置。

保留私有状态目录中的项目登记、权限策略、去重记录、回执和通信材料；保留会话数据库、其他插件、现有 Node/Codex 工具及回退包。不得递归删除整个运行根、用户目录或 `node_modules`。卸载不会撤销先前已授予会话的权限。需要彻底清除数据属于另一项操作，必须明确其范围。

### 4. 检查完成后安装新版

确认卸载和入口核验完成，再按 [安装说明](../README.md#安装) 安装固定的新包，核对包文件、插件详情版本与 CLI 版本。不要重新创建项目登记来代替保留原状态。

日常采用正常打开 DSH、启用插件的方式；通信客户端 `bin/bridge.mjs` 仍需保留。已有自定义状态目录的用户须先完成独立迁移，验证 Host 和 CLI 使用同一状态，再取消环境覆盖和专用启动器。卸载或安装包本身不会自动迁移状态，详见 [启动方式](STARTUP.md)。

## English

**Disabling the plugin is not uninstalling it. Removing plugin code is not deleting conversations or bridge data.**

For versions through 0.3.7, remove the actual old package with `dsh plugin --profile desktop remove dsh-plugin-codex-project-bridge` before installing the renamed package. Do not load both. Preserve `.codex-dsh-bridge` state; update any custom CLI shortcut that points at the old installation directory.

1. Let related sessions and background tasks finish, then quit DSH normally and verify that its Host has exited. This is the tested procedure, not a claim that the CLI enforces it. Hot uninstall was not tested.
2. Use the application's bundled CLI: `dsh plugin --profile desktop remove codex-dsh-project-bridge`. The macOS and Windows examples above show the standard application locations. If the app was installed elsewhere, use its actual CLI; a missing PATH entry is not a missing installation.
3. Do **not** copy `--offline --ignore-scripts` from the add command onto remove. DSH 0.2.0-rc.2 with bundled pnpm 11.7.0 rejects these options for remove. Check the installed version's `remove --help` when needed.
4. Check that the package, dependency, bundle registration and lockfile reference are gone. The current package does not declare external CLI shims; the client file is removed with the package. Retire only entries verified to point to this removed plugin. Retire any obsolete custom bridge launchers or shortcuts separately; retain the official DSH app entry. Do not delete the entire profile or edit session databases. Only handle actual residual loading entries; do not rewrite unrelated configuration.
5. Preserve private bridge state, project registrations, permission policies, deduplication records, receipts, channel material, conversations, other plugins, tools and rollback packages. Uninstalling does not revoke existing session permissions. A complete data purge requires a separately defined scope.
6. Only then install the fixed new package according to the [installation instructions](../README.en.md), verify installed files and versions, and use normal DSH startup with the plugin enabled. Retain `bin/bridge.mjs` as the communication client. Custom state paths require a deliberate, verified migration; neither uninstall nor install performs one automatically. See [startup details](STARTUP.md#english).
