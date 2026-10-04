# 通信方式与信任边界

以下 Unix 路径和模式位适用于 macOS/Linux。Windows 预览改用命名管道、私有 ACL 与带认证加密的帧；服务端文件检查运行在 Worker，Host 会话调用经进程内消息传递，详见 [Windows 说明](WINDOWS.md)。它不连接远端 Windows/Mac 的会话，也不共享两台机器的状态。

## 两个方向使用不同机制

### Codex → DSH

1. 调用 `node bin/bridge.mjs send --project ... --to dsh --session ...`。
2. CLI 从自己的私有项目登记读取根目录、登记代号和目录身份，算出 revision。
3. CLI 连接 `~/.codex-dsh-bridge/bridge.sock`，发送 UTF-8、换行分隔的单条 JSON。
4. DSH Host 内的插件校验操作、字段、长度和 revision，再用 `workspaceRegistry.resolveByPath` 与经目录头信息校验的 `sessionIds` 核对目标属于该项目。
5. 插件写入不含正文的意图回执，用稳定 `requestId` 调用 `sessionController.prompt(..., mode: followup)`。
6. Host 返回 accepted 后回写回执；只表示接收入队，不表示代理已完成。

DSH 状态查询调用 `projections` 和已加载代理状态；最近结果调用有限窗口的 `page`。
插件不直接读取 DSH 会话数据库，只有显式 create 才创建新会话，不使用桌面点击来发消息。
所有连接有绝对截止时间；每连接一个请求，最多 32 个连接、16 个未结束请求；同目标请求串行。

### DSH → Codex

1. DSH 代理在用户授权范围内调用同一 CLI，指定 `--to codex` 和目标 Codex UUID。
2. 默认 CLI 将结构化请求交给 DSH Host，由 Host 从私有 codex-runtime.json 取已配置的可信 CLI，启动短暂的 `codex app-server --stdio` 元数据读取进程。请求不能指定二进制、argv、环境或权限。显式 `--via direct` 才由调用者启动。
3. 通过标准输入/输出的 JSON-RPC 只发送 `initialize`、`initialized`、`thread/read(includeTurns:false)`。
4. 返回的目标工作目录须与登记的一个根目录精确匹配，再核登记仍有效。
5. 持久保存意图后，以参数数组调用 `codex queue --thread UUID --message TEXT`，无 shell 拼接。
6. CLI 返回 0 才记 queued_only；超时/非零视为交付不明，拒绝自动或同编号重发。

元数据读取进程不会创建、恢复或驱动代理；结束即关闭。它返回的 `notLoaded` 不能代表桌面的实时运行状态。
`queue` 由已有应用机制处理排队，收件方忙时可能稍后才看见消息。
正文按官方 CLI 接口进入 argv，同一用户的本机进程可能看到；不要用它传密钥或敏感文件正文。

## 只登记项目，不登记对话

配置是 `projects/简称.json`，只包含 schema 版本、随机登记代号、根目录及目录的设备号/inode。
目标对话每次指定，插件不保存对话白名单。一个项目可登记最多 16 个精确根目录，适用于 worktree。
目录前缀相同不代表同项目；不默认授权子目录。目录被替换、登记撤销/重建会使旧 revision 失效。
应用内把对话改属项目与发送之间没有跨应用原子事务；发送期间不要同时移动对话或修改项目归属。

## 去重不是分布式恰好一次保证

- 回执键绑定方向、项目简称、目标对话和消息编号；正文摘要与登记 revision 绑定。
- DSH 完成回执会缓存；未确定的重试使用同一 Host requestId，依赖 Host 的持久去重。
- Codex queue 不提供桥可依赖的幂等键；未知时停止重发，要求在目标对话确认。
- 写意图和更新回执均同步文件/目录；断电、文件系统故障及应用升级仍可能留下交付不明状态。
- 不自动清空回执。新旧独立桥之间不共享去重，不能同时向同一目标提交同一任务。

## 权限边界

0700 目录与 0600 文件/socket 限制其他系统用户。状态目录拒绝符号链接和不安全的可写父目录。
这是同一可信用户内的项目路由防错，**不是同用户恶意进程隔离，也不是对调用者身份的密码学认证**。
能以该用户运行程序的人本来就可能调用 Codex/DSH 原生接口；同用户可修改登记配置。
入站文本包含“代理消息，非用户新授权”标记；接收者仍须遵守用户授权，不把代理消息当新的用户批准。

无 TCP/HTTP 服务、无安装脚本、无第三方 npm 运行时依赖、不负责启动目标应用、自动轮询或自动重发；桥端点随 DSH 插件启用而启动。
本桥无独立模型客户端，但正常投递可能唤醒目标代理并消耗目标原有额度。

## 显式创建与桌面显示

日常协作规则为 DSH 的 B 直接给已有 Codex A 发信；需要新 Codex 对话时，由已有 A 使用桌面端原生能力创建 C 并核验可见性。A/B/C 是文档示例，不是协议中的固定角色，也没有新增自动协调服务。

桥保留 B 通过纯 CLI 创建 C 的入口，仅用于用户明确要求的测试或高级用法；日常由已有 A 创建是文档协作规则，不是桥协议自动改道。默认 DSH Host 调用官方 Codex CLI 与显式 direct 路线都不依赖 UI；两者均不能承诺 `exec` 会话自动进入桌面侧栏。选择何种协作方式由用户及项目流程决定，不根据错误自动切换。

create 单独保存意图与创建阶段，已知 ID 立即写入 creations；失败不自动重建。DSH 在当前 Host 的已登记项目中创建、命名；若本机显式启用新建完全权限策略，通过 permissionPresets 服务仅设置该新会话，并读回 danger-full-access / never，再投递首条提示。默认 inherit 不覆盖权限；单次 DSH 创建可携带 dshPermission: inherit（CLI 为 --dsh-permission inherit），即使桥配置 full-access 也跳过覆盖，由 DSH 使用通用新会话默认值。该字段纳入请求指纹，同编号不能修改。接口缺失、读回不符或创建中策略撤回时，保留已创建 ID 并停止首条任务，不自动重建。

Codex 使用官方 exec（默认 workspace-write，或本机显式启用的项目 full-access 策略；不附加桥状态目录写授权，仍拒绝两目录重叠），首轮完成后核项目，再用官方 thread/name/set 命名并读回验证。标题失败单独报告，不把已创建会话伪装成未创建。Codex 策略保存在私有 codex-creation-policies 中，绑定项目登记 revision；创建意图记录策略快照，执行前后核撤回。回执中的权限是启动参数记录，并非实际权限独立读回。五对话建议见 [协作示例](WORKFLOW.md)。

exec 来源不保证被桌面默认列表展示。回执提供真实 ID、titleApplied、desktopVisibility 和终端 resumeCommand。桥不改 source 或内部数据库；桌面打开由用户或 Codex 的应用工具完成。

首次配置、宿主权限与每项实际读写见 [权限与操作说明](PERMISSIONS.md)。宿主路线与直接路线共享回执键，不用换路线或换编号绕过未知交付。
