# 正常启动与插件开关 / Normal startup and the plugin switch

## 中文

**正常打开 DSH，在插件页启用本通信桥即可启动服务。不需要专用应用启动脚本或手动设置环境变量。** 插件加载时在 DSH Host 内启动本机通信端点；停用时释放端点。开关不授予代理完全权限，也不代替首次项目登记与 Codex 程序配置。

Host 和 CLI 使用相同的默认私有状态目录：

| 平台 | 默认数据目录 |
| --- | --- |
| Windows | 当前用户目录下 `.codex-dsh-bridge`，通常为 `%USERPROFILE%\.codex-dsh-bridge` |
| macOS / Linux | `~/.codex-dsh-bridge` |

Windows 路径由 `os.homedir()` 取得，不依赖额外设置。目录必须满足既有本地 NTFS、无路径重解析点、可信祖先及私有 ACL 检查；没有自动降级或绕过权限检查。Mac 的默认目录保持不变。

**程序和数据分开。** 插件代码由 DSH 的 desktop profile 管理，用户登记、权限策略、去重记录、回执和通信材料留在上述私有目录，不放进 `node_modules`，也不上传公开仓库。卸载不清空用户数据。

通信客户端仍保留在插件内，从任意项目使用可信 Node 调用：

```sh
node /absolute/path/to/installed/plugin/bin/bridge.mjs help
```

安装包不再声明外部命令快捷入口，因此不应假定终端直接输入 `codex-dsh-bridge` 就能运行。自建便捷命令不是必需组件，也不会由包管理器自动卸载。客户端负责请求；DSH 插件开关负责是否提供服务。

### 已有数据的更新

首次使用可直接采用默认目录。已经用过其他目录的用户，须先结束相关任务并退出 Host/CLI，保留旧目录，然后将整套登记、权限配置、创建记录和去重回执迁到新默认目录。目标有数据时先处理冲突，不混合覆盖、不重新登记来假装延续旧状态。切换后核目录权限、原有项目及只读查询，再退役不再使用的入口；不要为了迁移放宽上级目录权限。

`CODEX_DSH_BRIDGE_HOME` 只保留为显式高级覆盖的兼容入口，默认安装不会设置它。已有覆盖必须在数据迁移后取消，或确保 Host/CLI 一致；空目录不是成功迁移。正常使用无需这一覆盖。

正确卸载和重新安装见 [UNINSTALL.md](UNINSTALL.md)。应用若提示重启，按应用提示操作；不要另开第二个Host管理同一会话存储。

## English

**Open DSH normally and enable this bridge in its plugin page. No dedicated app launcher or custom environment variable is required.** Loading the plugin starts its local endpoint inside the DSH Host; disabling it releases the endpoint. The switch does not grant agent permissions or replace initial project registration and Codex executable configuration.

Host and CLI default to `.codex-dsh-bridge` under the current user's home directory on every platform: usually `%USERPROFILE%\.codex-dsh-bridge` on Windows and `~/.codex-dsh-bridge` on macOS/Linux. Windows uses `os.homedir()`, avoiding a custom environment setup. Existing NTFS, reparse-point, ancestor and private ACL checks remain enforced; there is no insecure fallback.

Keep code in the DSH-managed desktop profile and persistent state outside `node_modules`. Registration, policy, deduplication, receipt and channel data stay private and are not removed by uninstalling the package.

Invoke the client with `node /absolute/path/to/installed/plugin/bin/bridge.mjs`. The package no longer declares an external command shim; do not assume a bare `codex-dsh-bridge` command exists. A user-created convenience command is optional and is not managed by package uninstall.

For existing deployments, stop related work and exit Host/CLI before migration. Preserve the old state and migrate the complete registration and delivery records to the default location. Resolve destination conflicts without merging or overwriting blindly. Validate directory security, registrations and read-only access before retiring old entry points. Do not loosen ancestor permissions to make a migration pass.

`CODEX_DSH_BRIDGE_HOME` remains an explicit advanced compatibility override; normal installation does not set or require it. Cancel an existing override only after safely migrating the data, or keep Host and CLI consistent. Follow [uninstall/reinstall instructions](UNINSTALL.md#english) and any DSH restart prompt. Never run a second Host against the same session store.

## 启用后不可用 / Startup diagnostics

若插件已启用却找不到端点，先在已安装目录运行 `node scripts/doctor.mjs`，再核 DSH 本地日志中的安全错误码；不要反复安装、放宽 ACL 或删除未知状态。On startup failure, run this local diagnostic and inspect the safe Host error code; it does not repair permissions or send messages.
