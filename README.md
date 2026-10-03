# Codex ↔ DSH 项目通信桥

MIT 开源 · v0.2.0 · Node.js 22+ · macOS / Linux 本机通道

让本机 Codex 与 DeepSeek Harness 的现有对话通过命令行互相发消息。
**只登记项目，不登记每个对话。** 登记后，可指定该项目内任意现有对话。
不创建新角色，不替用户审批，不改变项目开发/审查规则。

这是社区自建集成，不是 OpenAI 或 DeepSeek 的官方插件。
实现细节见 [通信原理](docs/ARCHITECTURE.md)，审查发现及验证边界见 [安全审查记录](docs/SECURITY-REVIEW.md)。

```text
Codex → 本插件 CLI → Unix socket → DSH Host 插件 → 指定 DSH 对话
DSH   → 本插件 CLI → Codex 只读项目核验 → codex queue → 指定 Codex 对话
```

**不是通过模拟点击或读取账号数据库通信，也不启动新的代理会话。**
DSH 方向用私有 Unix socket 传递一行 JSON，由已安装 Host 插件调用会话接口；
Codex 方向用官方 CLI 的 stdio JSON-RPC 只读核验，再用 `queue` 投递。
默认没有 HTTP/TCP 监听端口，消息不经本插件的云端服务。

## 能做什么

| 功能 | 支持情况 |
| --- | --- |
| Codex → DSH 指定对话发消息 | 支持，DSH 桌面原对话可见 |
| DSH → Codex 指定对话发消息 | 支持，通过本机 `codex queue` |
| DSH 状态、最近答复 | 支持，只读、有限窗口，保留真实终态 |
| Codex 项目归属和摘要状态 | 支持；摘要状态来自独立只读接口，不能据此判断桌面对话是否在运行 |
| 注册新项目后使用已有/新建对话 | 支持，无须重新安装插件或登记对话 |
| 远程机器、Windows、自动建对话 | 本版本不支持 |

此插件使用独立的配置目录、Unix socket 和消息去重记录。
同一任务仍只用一条发送通道；不同桥之间不共享去重键，勿把同一消息同时发两遍。

## 安装一次

需要已有 Node.js 22+、DeepSeek Harness Desktop 和带 `queue` / `app-server` 的 Codex CLI。
不需要 API Key，不安装额外 npm 运行时依赖。使用现有应用登录与权限。

先让 DSH 中正在进行的工作到达可安全退出的时点，完整退出 DSH（仅关闭窗口不算），
在本插件目录运行应用自带的官方 `dsh` 命令：

```sh
dsh plugin --profile desktop add "$PWD" --offline --ignore-scripts
```

随后重新打开 DSH。在插件管理中可见 **Codex ↔ DSH 项目通信桥**；
点击插件名称可看到中文用途和使用边界。实现采用 DSH 的正式 `locale/*.json` 元数据，
随包附带本说明；详情页不依赖联网下载 README。
安装若被旧版应用拒绝，应核版本和应用自带 CLI；不要降级应用、覆盖已有配置或启动第二个会话运行时。

以下命令在插件目录执行。也可以把 `bin/bridge.mjs` 写成其绝对路径，从任意项目调用。

## 登记项目：一次登记，任意所属对话可用

```sh
node bin/bridge.mjs register --project my-app --root /absolute/path/to/my-app
node bin/bridge.mjs projects
```

`my-app` 是你选的项目简称，用小写字母、数字、连字符；登记的是已有目录，不会创建应用中的项目。
DSH 目标对话须已属于 DSH 中这个目录对应的项目；Codex 目标对话的工作目录须匹配登记目录。
若项目有多个独立 checkout，在同一次登记时重复 `--root` 指定各目录。
只按真实规范路径精确匹配，不把所有子目录或名字相似的项目自动授权。

对话不用登记：在应用里取得目标对话 ID，然后每次发送时指定它。
项目目录迁移或增加 checkout 时，先停止使用此通用桥发送该项目消息，`unregister` 后重新 `register`；
不改已有对话，也不删去重记录。登记会即时生效，不需要重启 DSH。
v0.2 每次登记生成新的登记代号，并核验目录身份；撤销后旧请求不能继续使用。
从 v0.1 升级时须先完整退出 DSH、更新插件和 CLI，再重新登记项目；v0.1 配置会明确拒绝使用。

```sh
node bin/bridge.mjs unregister --project my-app
```

## 收发消息

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
- `project_mismatch`：目标不属于登记目录；不要通过登记整个磁盘来绕过，核对项目/对话/checkout。
- `session_busy`：该目标的前一桥请求尚未结束；等待后查状态，不因此判定任务卡死。
- `bridge_busy`：尚未结束的桥请求已达上限；不自动重试，也不要据此另派并行任务。
- `host_request_unsettled`：前一请求已超时，但 Host 调用仍未结束；桥保留该会话锁，防止重叠发送。
- `host_capacity_unsettled`：未结束的 Host 调用已占满 16 个请求位；不释放为可无限重试状态。
  等待真实落地后会自动释放。若宿主确实永久挂起，先核实不明交付、保存工作并安全退出 DSH，
  再重新打开；不要清回执、换编号或另开通道重发。请求超时不证明宿主已取消。
- `unknown_project`：CLI 或 socket 请求的项目尚未登记；先核登记名称。
- `ENOENT`：通信端点或其他必要文件未出现；核 DSH 插件是否启用。PATH 缺失不等于工具未安装。
- 异常退出留下 socket 时，先确认原 Host 已退出且端点不可连接，再人工处理该通用桥端点。

## 数据、权限与兼容性

默认私有目录为 `~/.codex-dsh-bridge/`：`projects/` 保存项目根目录，
`receipts/` 保存消息摘要和入队状态，`bridge.sock` 提供本机通信。
不在回执中保存消息正文；正文会进入目标应用的正常对话历史。
目录 0700、文件/socket 0600；这是同一系统用户内的路由防错，不是隔离恶意同用户进程的安全沙箱。
服务端不校验连接方的进程身份或 uid，仅依赖目录与 socket 权限；项目登记不是调用者认证。
同用户进程可以连接 socket 向任意登记项目成员发送消息，也可调用应用原生接口。不要使用不可信共享账号。

清理方法：完整退出 DSH，确认桥 CLI 均已结束且不会重试旧消息，再人工删除私有状态目录的 `receipts/`。
此操作永久丧失桥的历史去重与正文冲突检查，之后必须使用全新请求编号；不要借清理重试不明交付。
DSH Host 还可能保存同编号的去重状态，删桥回执不表示消息可重新执行。
`projects/` 保存登记；删除它会撤销全部项目登记，不删除应用项目或对话。默认不自动清理。
有界请求超时不会撤销目标代理已经接收的任务。受控 CLI 子进程不退出时，只终止本次创建的子进程，
不会按进程名终止桌面应用或共享服务。意图回执先落盘再发送，交付不明时宁可停止核实。

可通过 `CODEX_DSH_BRIDGE_HOME` 指定更短私有目录，但 DSH Host 和 CLI 必须一致；
Unix socket 路径不得超过 100 字节。无需更改时不要设置。
该状态目录必须使用规范绝对路径，不含符号链接、`..` 或末尾斜线，且位于受信任的本地文件系统。
`CODEX_DSH_CODEX` 可指定已安装 Codex CLI 的绝对路径；默认使用 PATH 中的 `codex`。
插件不读取密钥文件，不连远程服务；发送会唤醒已有代理，目标任务仍可能使用其原有模型额度。

接口核查基线：DSH Desktop 所带 `0.2.0-rc.2` API、Node 24、带 `queue` 的 Codex CLI。
DSH 使用 `workspaceRegistry.resolveByPath` 和经头信息校验的 `sessionIds` 核对项目成员；
Codex 临时只读 app-server 只调用 initialize/thread-read，不创建或恢复代理，不发模型请求。
不同版本接口不兼容时拒绝操作。Linux 仅代码适配，尚未实机验证；Windows 未实现。

## 测试、停用与打包

```sh
node --test tests/*.test.mjs
npm pack --offline --ignore-scripts
```

测试使用临时目录、假的 Host 和假的 Codex 可执行程序，无真实对话发送。
实际验证情况见 [安全审查记录](docs/SECURITY-REVIEW.md)，不能把离线绿当作已安装或真实双向测试通过。
停用只需在 DSH 插件管理关闭本插件；不删除项目或对话。卸载使用应用官方插件管理，
卸载插件包 `dsh-plugin-codex-project-bridge`。

本代码采用 [MIT 许可证](LICENSE)。`private: true` 用于防止误发 npm，**不妨碍在 GitHub 开源**。
本文件不声称已经发布；上传前运行 `npm run check:release` 并参阅 [发布清单](docs/RELEASING.md)。

参考：[DSH Desktop 官方安装流程](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)、
[DSH workspace 成员规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workspace/README.md)、
[OpenAI 只读 thread/read](https://learn.chatgpt.com/docs/app-server#read-a-stored-thread-without-resuming)。
