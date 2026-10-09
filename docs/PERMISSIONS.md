# 权限要求与实际操作

本说明适用于当前发布版本。它区分桥的请求限制、DSH 宿主的系统权限和目标代理自己的权限；三者不是同一层安全隔离。插件本身不要求管理员权限、sudo、关闭 SIP 或修改系统安全设置；Codex 自身的 Windows 沙箱初始化可能有独立的系统权限要求，见 [Windows 说明](WINDOWS.md)。若现有沙箱阻止某项操作，应按本说明定位，不默认授予完全访问。

## 术语

- **Host（宿主）**：DSH 桌面应用的后台进程，插件在其中提供本机通信服务。
- **CLI（命令行客户端）**：通过 `node bin/bridge.mjs` 调用本桥；文中的 Codex CLI 则是另一个官方程序。
- **revision（登记版本标识）**：标识项目登记内容；重新登记会使旧请求或绑定的权限策略失效。
- **inherit（跟随默认）**：不施加桥的权限覆盖，由 DSH 的新会话默认设置决定权限；不等于固定的低权限。

## 首次设置

| 操作 | 所需访问与实际写入 |
| --- | --- |
| 安装或更新 DSH 插件 | 相关工作先安全停止。GUI在“插件→添加插件”输入 npm 包名、固定版本或可信本地包路径；CLI先退出DSH再运行 `plugin --profile desktop add` 并加 `--ignore-scripts`，仅缓存完整时追加 `--offline`。两者写当前desktop profile的包及包管理记录，GUI不承诺同样的脚本限制。按提示重开后核版本；不删除桥状态或账号资料。 |
| `register` / `unregister` | 读取用户指定项目目录的真实路径和目录身份，创建/删除桥私有目录的项目登记。不会创建、删除应用项目或聊天。登记不等于证明调用者身份。 |
| `configure-codex --binary ...` | 在可信终端明确指定已有 Codex CLI；检查绝对路径、文件和本机权限，保存到私有 `codex-runtime.json`。启用宿主代执行能力；不从请求正文选命令、不下载工具、不写全局 PATH。文件不含 API Key。 |

更新 CLI 和 Host 应使用同一版本包。首次配置意味着允许持有桥端点访问能力的本机程序，在已登记项目范围内调用以下 Codex 功能。它不是每条提示的用户批准；代理仍须遵守用户的任务授权。

**当前对话权限与新会话默认权限分开。** 在 DSH 对话中切换“完全权限”，只修改该对话。未配置桥覆盖设置时，全新 DSH 对话使用 DSH 当时的“新会话默认权限”，不会继承旧 B 的选择。不要把一次实测对话的完全权限当作今后所有新对话的授权。

## 仅桥新建 DSH 对话的完全权限

用户可在本机可信终端执行 `configure-dsh --new-session-permission full-access`，明确授权此桥状态目录下、已登记项目内的后续新建 DSH 对话使用完全权限。配置保存为私有 `dsh-creation-policy.json`，不进入公开仓库或请求正文。默认 `inherit`，读取不到配置时沿用 DSH 默认值；格式或权限不合法则拒绝创建。

新会话创建后、首条任务投递前，Host 通过该会话对应的 DSH permissionPresets 服务设置 `danger-full-access`，并读回核对 sandbox 与 approval（分别为 danger-full-access / never）。Windows 在原 Host 完成权限操作，Worker 只转交这项固定内部调用。请求不能要求完全权限或修改此本机开关；仅接受单次 DSH 创建的 `dshPermission: "inherit"` 来跳过覆盖。不提供修改任意已有对话权限的桥命令。

完全权限允许新对话在宿主用户权限范围内执行更广泛的文件和命令操作，并关闭对应命令审批；它不只是发送桥消息的权限。该配置覆盖使用同一桥状态目录的已登记项目，应只对明确授权的可信任务启用。能直接写桥私有配置的同用户程序仍能改此设置，本机配置不是对完全权限代理的安全隔离。

权限服务不可用、读回不符、配置撤回或取消时，不投递首条任务；可能已留下空白或已设置权限的新会话，保留原 ID 与创建记录核查，不能换 ID 自动重建。创建回执的 permission 字段记录此次权限条件；重复已完成的请求只返回原回执，不再次更改会话权限。

执行 `configure-dsh --new-session-permission inherit` 可关闭对后续创建的覆盖；它不会收回已创建对话的权限。DSH 全局默认、人工创建的其他对话和 Codex 子会话权限不受此开关修改。Mac 与 Windows 独立配置。开启或关闭配置无需重装；但支持该功能的 Host 和 CLI 必须已升级并使用同一状态目录。

## 单次 DSH 创建跟随软件默认

`create --to dsh --dsh-permission inherit` 让 Host 正常创建新会话，但不调用桥的权限覆盖服务。适用于完全权限的对话 3 创建默认权限的对话 4，无需临时修改整个桥的配置。它不修改软件全局设置或复制父对话权限；默认本身为完全权限时也可能得到完全权限。回执 `source: "dsh_default", overrideApplied: false, verified: false` 表示未覆盖，不是核验了实际默认值。

该选项仅支持 inherit 值及 DSH 创建方向；同编号增加或移除选项会产生 request_id_conflict，不能把旧的完全权限会话回执当成默认权限新会话。仍检查项目登记及桥策略在创建过程中有无变化。完整命令及交接方式见 [五对话示例](WORKFLOW.md)。

## Codex 新对话权限设置

默认 workspace-write。本机可信终端可执行 `configure-codex-creation --project NAME --new-session-permission full-access`，保存到私有 `codex-creation-policies/NAME.json`。它绑定项目登记 revision；重新登记后返回 codex_creation_policy_stale，须重新配置。用 `codex-creation-policy --project NAME` 查询，恢复后续默认用 workspace-write；不改全局配置、已有会话、其他项目或 DSH。

完全权限以固定参数 `--sandbox danger-full-access -c 'approval_policy="never"'` 传入官方 exec，不是仅授权桥消息。创建意图记录策略快照，启动前、首轮结束及完成前复核配置；中途撤回不回滚已经发生的操作，未知创建不自动重建。已完成请求保留原回执。管理员限制及 CLI 启动失败照常生效，不绕过。

Codex 0.160.0 的只读 thread/read 不提供实际沙箱及审批策略，因此回执只记录请求参数与 policyRevision，permission.verified 为 false；不使用有副作用的 resume 冒充只读核验。完全权限可能允许宿主用户访问私有桥状态；additionalStateDirectoryGrant: false 只表示没加 --add-dir，不表示完全权限代理被隔离。

## 日常命令

推荐由 DSH 执行对话 B 直接联系已有的 Codex 协调对话 A，通常不由 B 新建 C。需要新对话时，由 A 按用户授权使用桌面端原生能力创建，并核实项目归属和可见性。A/B/C 仅为协作示例，不是桥内置的角色、权限或自动路由。

B 自行通过纯 CLI 执行 `create --to codex` 的功能仍保留，仍需明确的创建授权；它可能产生不自动显示在侧栏的 `exec` 会话。默认 Host 转发同样属于 CLI 路线，无需改用 `--via direct`；但调用者仍须能运行桥客户端、读取项目登记及通信认证材料、连接本机端点。Host 转发不保证调用者的 shell 沙箱允许这些前置操作。插件不会因可见性问题自动联系 A、重建 C 或切换创建方式。

| 命令 | 谁执行、读写和模型影响 |
| --- | --- |
| `status --to dsh` | DSH Host 读取项目成员、会话 projection 与已有 agent 状态，不发送提示、不激活新代理。 |
| `result --to dsh` | 同上，另读取 Host 提供的有限历史窗口，返回最多 16 KiB 文本及回合序号；不直接读数据库。窗口不完整返回空，不冒充完成。 |
| `send --to dsh` | Host 核成员及登记 revision，先写意图，再调用 prompt，写回入队回执。正文进入目标聊天，目标可能消耗其原有额度。 |
| `status --to codex` | 默认由 Host 启动已配置的官方 CLI，只用 app-server 的 initialize/thread-read 核目标工作目录。官方 CLI 可能写自己的日志、状态或会话支持文件；桥不直接读账号文件。摘要状态不代表桌面实时状态。 |
| `send --to codex` | 默认由 Host 核目标项目，再以固定参数数组调用 queue。桥写摘要与回执，官方 CLI 处理正常入队；接收者可能运行工具和消耗模型额度。正文进入命令 argv，同用户进程可能看到，禁止传密钥。 |
| `create --to dsh` | 当前 Host 创建项目内会话、命名、投递首条提示。创建阶段和 ID 保存在桥 `creations/`，Host 保存正常聊天记录；会启动代理和消耗额度。 |
| `create --to codex` | 默认 Host 调用官方 exec；在已登记根目录创建持久会话、运行首条提示。新代理默认 workspace-write，或使用本机显式启用的项目 full-access 策略；不通过 --add-dir 允许桥状态目录，仍拒绝状态与工作区重叠。随后官方 thread/name/set 命名、thread/read 读回；失败不重建。 |

宿主转发不把调用者的 shell 沙箱自动传给 Host：Host 用自身已有用户权限启动 CLI，目标代理再使用 Codex 所选权限策略（默认 workspace-write）。它解决“DSH 代理不能写 Codex 自身目录”的调用问题，不保证默认策略下的所有工具调用免审批。新代理仍受运行环境、可信 hooks、账号和模型可用性影响。桥不修复旧会话或既有安全配置，不能据此宣称恶意代理已被完全隔离。默认权限子会话直接回信可能被沙箱阻止，应交由已有 A 协调。

默认宿主协议仅接受 status/result/send/create 的固定字段，不接受 executable、argv、env、任意 shell、模型或 Codex 权限参数；DSH 创建只额外允许 inherit 选项。项目根路径必须精确匹配登记，消息与请求长度受限。Windows 在 Worker 中执行慢文件安全检查，传输有认证加密；Mac 使用同用户私有 Unix socket。均无网络监听或云中转服务。

## 直接路线与历史审批

`--via direct` 显式保留旧路线，由发起 CLI 的进程启动官方 Codex。`CODEX_DSH_CODEX` 只作用于这条路线。该进程若处于 DSH workspace-write 沙箱，可能无法写 Codex 自身状态目录并以 EPERM 失败；不能把它误报为目标对话离线。宿主路线失败不会自动改走 direct，也不自动申请完全访问。

宿主路线避免调用者直接启动Codex所遇到的部分目录访问问题，但调用者仍须能运行桥CLI及访问端点；一次固定命令的临时批准不等于永久完全访问授权。

## Windows 调用者沙箱

插件在 DSH Host 中运行成功，不等于 DSH 对话中的 shell 能运行桥客户端。Windows 原生沙箱可能使用独立低权限用户或受限令牌；桥的本机状态和认证文件仍要求私有 ACL。不要把沙箱组加入可信主体、复制通信认证材料到工作区，或把整个桥状态目录开放给所有代理，以此绕过检查。参见 [OpenAI Windows 沙箱说明](https://learn.chatgpt.com/docs/windows/windows-sandbox)。

Windows受限沙箱可能在共享目录初始化、读取桥脚本或访问私有通信状态时失败。完全权限下的通信成功不能记作默认workspace-write通过；当前支持边界见 [Windows说明](WINDOWS.md)。

回复正文文件应准备在调用者已有权访问的位置，不必写进桥状态目录。若仍需沙箱例外，先确认原请求是否已经发送，再由用户明确批准固定命令或自行调整目标对话权限；发送命令不会自动修改现有对话权限、切换路线或重发；新建权限覆盖仅按前述本机设置生效。完全访问会扩大该对话的本机操作范围，不是安装插件的通用前提。使用完全访问获得的通过结果必须注明权限条件，不能记作默认 workspace-write 验证通过。

## 数据、取消、重复请求与停用

- 桥状态包含 projects、receipts、creations、codex-runtime、dsh-creation-policy 和 codex-creation-policies；Windows 另有本机通信 channel-key。项目路径和 ID 属本机资料，不放开源仓库。回执存正文摘要，正文仍进入应用正常历史。
- 超时、断连、退出非零不证明没有发送或创建。保留原请求 ID 与回执核实，不能换编号、换路线或删账绕过去重。
- Codex queue 一经启动，取消不保证撤回；已接受提示不会因连接断开撤销。桥只终止自己创建的受控子进程，不按名字杀应用。新代理已产生的文件或其他副作用不会回滚。
- Codex 创建完成但命名失败时返回 `created: true, titleApplied: false`；不能据此重建。`exec` 来源的对话可能被桌面默认列表过滤，使用真实 ID 打开或执行返回的 resumeCommand；不修改内部数据库或伪造来源。
- 同编号同参数返回已有完成回执，不重新执行首条提示；参数改变拒绝。未知创建保留已知 ID，停下核查。
- 停用插件可阻止新的 Host 请求；删除某项目登记撤销它的后续访问，但无法撤销已发出的请求。取消 Codex 宿主配置应先停止调用再移除私有 codex-runtime.json，不影响 Codex 安装或聊天；不提供远程改配置接口。
- 目录权限/项目登记不是对同用户恶意程序的隔离。不要在不可信共享账号中使用，也不要登记整块磁盘来绕过成员检查。

## 验证边界

源码回归、实际安装、只读查询和真实收信分别记录，见 [验证记录](SECURITY-REVIEW.md)。创建成功不保证子会话工具可用；Windows高级CLI创建仍有结果不明限制，不冒充完整链路通过。

## 管理命令的信任要求

configure-*和项目登记需要写桥私有状态。能执行CLI不一定能写该目录；但一旦拥有写权限，就可能修改程序路径、权限策略和回执。本地配置校验文件权限，不鉴定配置的程序是否来自官方发行方；Host会以自己的用户权限启动该程序，必须自行选择可信官方安装。TTY或确认参数不能隔离同用户恶意进程。

DSH完全权限覆盖仍作用于同一状态目录下的所有已登记项目，直至明确恢复inherit；此次更新不改变这一范围。不再需要后可恢复inherit，但这不会撤销已有会话权限。程序更新不会代用户启用、撤回或迁移任何策略。

DSH创建回执的 `permission.verified: true` 仅表示权限设置及读回一致，不表示任务获得新的用户授权。代理消息前缀是模型提示，不是权限隔离措施；完全权限策略仍需本机明确配置。
