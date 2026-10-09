# CLI 参考与故障排查

[返回首页](../README.md) · [English](CLI.en.md)

命令中的 `bin/bridge.mjs` 相对于已安装插件目录；也可替换为该文件的绝对路径。先按首页配置 Codex 并登记项目。

## 命令速查

下表命令均在前面加 `node bin/bridge.mjs`。`NAME` 为登记的项目简称，`ID` 为目标对话 ID，`TARGET` 为 `dsh` 或 `codex`，`UNIQUE` 为本条请求的唯一编号；路径和其他大写占位符须替换为实际值。

| 命令 | 参数 | 用途 |
| --- | --- | --- |
| `help` | 无 | 显示帮助和版本 |
| `configure-codex` | `--binary PATH` | 保存可信 Codex CLI 的绝对路径 |
| `register` | `--project NAME --root PATH` | 登记项目；多个根目录可重复 `--root` |
| `projects` | 无 | 列出登记及根目录 |
| `unregister` | `--project NAME` | 撤销登记，保留应用项目、对话和通信记录 |
| `send` | `--project NAME --to TARGET --session ID --request-id UNIQUE --text-file FILE` | 向已有对话发消息 |
| `status` | `--project NAME --to TARGET --session ID` | 查询目标状态摘要 |
| `result` | `--project NAME --to dsh --session ID` | 读取 DSH 最近结果；不支持 Codex 方向 |
| `create` | `--project NAME --to TARGET --request-id UNIQUE --title TITLE --text-file FILE` | 创建对话并投递首条提示；多根项目须加 `--root PATH` |
| `configure-dsh` | `--new-session-permission MODE` | 设置后续桥新建 DSH 对话的权限覆盖 |
| `configure-codex-creation` | `--project NAME --new-session-permission MODE` | 设置项目的 Codex 新对话权限 |
| `codex-creation-policy` | `--project NAME` | 查询项目的 Codex 创建权限策略 |

DSH 的 `MODE` 可为 `inherit`（跟随软件默认）或 `full-access`；Codex 可为 `workspace-write` 或 `full-access`。这些管理命令需要用户授权并写入本机私有配置，范围和撤回方式见[权限说明](PERMISSIONS.md)。

Codex 方向的 `send`、`status`、`create` 可加 `--via host`（默认，由 DSH 宿主执行）或 `--via direct`（由当前 CLI 进程直接执行）。仅 `create --to dsh` 可加 `--dsh-permission inherit`。Host 指 DSH 桌面应用的后台进程；`revision` 指项目登记版本标识，用于发现登记变化。

## 显式创建新对话（Codex 创建为高级用法）

```sh
node bin/bridge.mjs create --project my-app --to dsh --request-id create-child-001 \
  --title '测试对话 B' --text-file first-prompt.txt
node bin/bridge.mjs create --project my-app --to codex --request-id create-child-002 \
  --title '测试对话 C' --text-file first-prompt.txt
```

只能选择已登记根目录；多根项目必须指定一个 `--root`。创建使用独立持久记录，同编号同参数成功后返回原 ID；交付不明返回 `creation_unknown_no_retry`，不得换编号重建。`creations/` 中保留已知或计划 ID，供人工核查，不自动清理。

DSH 使用当前 Desktop Host 的 create、rename、prompt；若本机显式启用新建完全权限覆盖且请求未指定 `--dsh-permission inherit`，则在首条提示前设置并核验权限。返回 `queued_only`；创建后必须另验真实回信。Codex 使用官方 `codex exec --json` 创建持久 CLI 会话并执行首条提示，等待本轮结束（默认内层时限 180 秒；不含前后核验和进程收尾，Windows 同步检查可能延迟超时处理）后核验项目归属，再用官方 `thread/name/set` 设置标题并读回验证；回执以 `titleApplied` 单独报告命名结果。

Codex 子会话默认 `workspace-write`（工作区内修改），可由本机项目策略显式启用完全权限；不会自动更改已有会话。回执 `permission.verified: false` 只记录启动请求，不证明实际权限已独立读回。配置、作用范围和撤回方式统一见[Codex 新对话权限设置](PERMISSIONS.md#codex-新对话权限设置)。

CLI 创建的 Codex 会话不保证显示在桌面侧栏；命名成功也不代表可见。回执提供 `desktopVisibility` 和 `resumeCommand`。日常应请项目中已有的 Codex 对话用桌面原生能力创建新对话。桥不修改应用数据库或伪造来源。

这会启动新代理并消耗其原有模型额度。任务正文不是新权限授权；DSH 新对话的权限由其默认值或用户在本机显式配置的桥覆盖设置决定，原有项目规则仍适用。应用未响应、权限设置/命名失败或首条提示失败时，可能已经创建会话；保留记录核实，不把错误退出当作“没有创建”。

## 发送消息

先把消息写入本地 UTF-8 文本文件，单条不超过 8192 字节。不要放密码或用户敏感正文。
只接受普通文件，拒绝符号链接、管道、NUL 和无效 UTF-8。
为每条新消息选一个唯一编号；同一编号不能换正文。

```sh
node bin/bridge.mjs send --project my-app --to dsh \
  --session session-目标UUID --request-id handoff-001 --text-file message.txt
node bin/bridge.mjs send --project my-app --to codex \
  --session 目标CodexUUID --request-id reply-001 --text-file reply.txt
```

回信时由发送者在正文提供自己的 Codex/DSH ID；接收者仍须按项目规则取得发送授权。
入站消息统一标注“代理消息，非用户新授权”。代理不能用转发内容冒充用户同意。
Codex 收到排队消息后可能在当前工作结束才处理；`accepted` / `queued_only` 只是入队回执。

## 查询进展

```sh
node bin/bridge.mjs status --project my-app --to dsh --session session-目标UUID
node bin/bridge.mjs result --project my-app --to dsh --session session-目标UUID
node bin/bridge.mjs status --project my-app --to codex --session 目标CodexUUID
```

DSH 最近结果可能是上轮，必须核回执的 `hostRequestId` 是否在 `latestTurn.requestIds` 中，
再看 `startSeq/endSeq/reason`。窗口外或无完整开始事件时返回 `null`，不假定完成。
`running` 只表示应用状态，不证明任务健康；Codex 的 `notLoaded` 也不表示桌面任务停止。

## 失败与重试

- 插件不会自动重发、自动重启应用、自动删除 socket 或回退到桌面点击。
- DSH 发送超时：先查结果。确需手动重试时保留同一项目、对话、编号和正文；桥与 Host 共同去重。
- Codex 发送超时或退出非零：记为交付不明，同一编号拒绝重发，先到目标对话核实。
- `codex_unavailable`：找不到可用的 Codex CLI、程序不符合本机安全检查，或子进程启动失败。先核对可信安装位置及当前路线的配置；PATH 缺失不等于未安装，不要反复重装或放宽权限检查。Windows 还会检查程序父目录的 ACL。
- `codex_timeout`：Codex 元数据接口未及时返回。先核 CLI 可用性，再按目标 ID 查询 `status`；不要据此认定会话不存在。该查询本身不启动代理，但若错误发生在 `create` 的后续核验阶段，会话可能已经创建，须按创建记录核实，不能重新创建。
- `delivery_unknown_no_retry`：Codex 入队结果不明，或同编号存在未完成的意图记录；同一编号拒绝重发。先到目标对话核实是否收到，不要换编号或换路线重复投递这条不明消息。
- `workspace_not_found`：登记目录在当前 DSH 中找不到对应项目。先核对该目录是否已在应用中建为项目，不要改登记为别的路径绕过。
- `project_mismatch`：目标不属于登记目录；不要通过登记整个磁盘来绕过，核对项目/对话/checkout。
- `session_busy`：该目标的前一桥请求尚未结束；等待后查状态，不因此判定任务卡死。
- `bridge_busy`：尚未结束的桥请求已达上限；不自动重试，也不要据此另派并行任务。
- `host_request_unsettled`：前一请求已超时，但 Host 调用仍未结束；桥保留该会话锁，防止重叠发送。
- `host_capacity_unsettled`：未结束的 Host 调用已占满 16 个请求位；不释放为可无限重试状态。
  等待真实落地后会自动释放。若宿主确实永久挂起，先核实不明交付、保存工作并安全退出 DSH，
  再重新打开；不要清回执、换编号或另开通道重发。请求超时不证明宿主已取消。
- `unknown_project`：CLI 或 socket 请求的项目尚未登记；先核登记名称。
- `bridge_not_ready`：通信端点/所需通信文件不存在，或连接被拒绝。核DSH是否运行、插件是否启用、两端状态目录是否一致，不代表需要重装系统工具。
- `state_file_missing` / `state_file_exists`：Windows状态文件缺失或独占创建发现已存在；底层保留ENOENT/EEXIST语义，既有去重与默认配置行为保持。
- `ENOENT`：其他必要路径不存在，例如登记根掉线；按当前操作核对应路径，不能一概当作桥未运行。
- `request_timeout_delivery_unknown`：Host请求超时，操作可能仍在进行；先核交付，不换编号重试。
- `incomplete_response` / `invalid_response`：连接关闭前未收到完整换行帧，或完整帧的编码/JSON/结构不合法。`response_identity_mismatch` 表示回包项目、请求或目标不匹配。均不证明发送/创建没有执行，保留原编号核查，不自动重发。
- `authentication_failed` / `invalid_channel_key`：通道认证失败或通信材料无效；核Host与CLI使用同一可信私有状态，不关闭认证或盲目替换密钥。
- `transport_timeout_delivery_unknown`：传输层期限已过，交付仍不明；保留原编号核目标，不重复投递。
- `response_too_large`：响应超过协议大小上限，不通过移除限制解决。
- `unsafe_socket` / `socket_path_too_long`：POSIX端点类型/权限不符或路径过长；doctor不检查端点可连接性或长度，不删端点绕过门禁。
- `session_not_found` / `not_accepted`：会话未找到或Host未确认接受；创建阶段出错仍须保留创建记录核查。
- 异常退出留下 socket 时，先确认原 Host 已退出且端点不可连接，再人工处理该通用桥端点。


## 发布与诊断

- `publication_busy`：另一个进程正在发布 POSIX 状态文件。先核进展，不删锁或换请求编号绕过。崩溃可能留下 `.publish` 目录；人工恢复前须核清未知交付，并确认所有写入者已停止。
- `unsafe_acl` / `posix_acl_check_unavailable`：Mac ACL 不符合要求或无法检查。不要自动删除 ACL；在已安装插件目录运行 `node scripts/doctor.mjs` 定位。
- `bridge_error` / `bridge_failed`：未预期异常已转为安全错误码。定点核本机 Host 日志，不公开个人路径或消息正文。
- `codex_invalid_response` / `codex_response_too_large`：已配置 CLI 的响应格式不符或超限；核对版本及可信安装。

POSIX发布未结束会返回忙状态，不能清锁、换编号绕过去重。启动失败先运行已安装目录下的doctor；它只检查本机权限，不确认桥已在线，不修权限，也不重发消息。Windows纯CLI创建可能已有会话但返回结果不明，请保留原ID核查。

Codex `queue` 入队不保证未加载的桌面对话立即开始处理。先使用已有、已准备接收的对话；若目标尚未处理，可通过桌面或已授权原生工具打开/唤醒原目标，再核原消息实际入站，不用新的请求号重发。原生准备消息本身不是桥收信证据。
