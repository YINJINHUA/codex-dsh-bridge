# Windows 适配预览

Windows 支持正常启动 DSH、启用插件、项目登记、消息投递与状态查询。使用真实对话时必须逐段确认收信；**纯 CLI 创建 Codex 对话仍是高级预览能力，不保证创建调用能正确返回终态或会话显示在侧栏**。日常由已有 Codex 对话通过桌面原生能力创建新对话。

## 环境与安装

需要 Windows、本机 NTFS、Node.js 22+、系统 Windows PowerShell 5.1，以及已登录的 DSH Desktop 和支持 queue 的 Codex CLI。复用可信安装，PATH 缺失不代表未安装。

- 官方安装目录：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\codex-dsh-project-bridge`。
- 优先默认用户目录。目录是否可用取决于自身和祖先的ACL，不取决于是否由桥创建；预建或复制目录若继承了其他主体的修改/删除权限会被拒绝，不应清空或放宽ACL绕过。
- 默认私有状态：`%USERPROFILE%\.codex-dsh-bridge`。正常启动无需专用启动器或自定义环境变量。
- 状态目录应保持较短：当前PowerShell/.NET与文件发布路径未全面支持Windows长路径，嵌套过深可能报 `atomic_move_failed`。优先默认位置，不为此关闭安全检查；迁移须保留完整回执与配置，见[启动说明](STARTUP.md)。
- 工具和固定安装包放长期可信位置；不要安装后删除包管理器仍引用的源包。
- 项目可以在共享目录，但桥状态、认证材料和回执须在本机；工作区不能包含桥状态，反向包含也拒绝。
- DSH和CLI须使用同一用户和状态目录。祖先可被其他账户/沙箱组/未知主体替换或改权限时，安全检查会拒绝，不能靠放宽ACL解决。

详细步骤见 [安装](../README.md#安装)、[启动](STARTUP.md) 和 [卸载](UNINSTALL.md)。

## Codex 程序与调用者权限

`configure-codex --binary <可信 codex.exe 绝对路径>` 保存默认Host路线的程序。需要原生exe和同版本完整运行文件；只复制codex.exe可能使查询成功而执行命令失败。程序位于本机可信路径，拒绝cmd/bat、共享盘程序及不安全ACL/reparse路径。

`--via direct` 才从调用者环境选择程序；不自动回退。Host已运行不代表受限代理能运行CLI或访问认证材料；不要把桥状态授权给沙箱用户、复制认证材料或为通过测试自行提权。

出现 `setup refresh had errors` 或 `GetNamedSecurityInfoW` 错误时，核实际沙箱、对应日志及Windows错误码，不反复建会话。元数据查询、外层进程退出0、消息入队和目标实际收信是不同结论。官方说明见 [Windows沙箱排障](https://learn.chatgpt.com/docs/windows/windows-sandbox)；不要读取或公开`.sandbox-secrets`。

## 通信安全与时限

使用命名管道，无TCP/HTTP监听。随机挑战、HMAC证明和方向隔离AES-256-GCM帧保护正文；通信材料由桥生成并保存在私有channel-key.json，与模型API Key无关。认证失败不发送正文，无明文回退。

同用户持有材料的进程可调用桥，管理员及系统属于信任边界。管道连接权限不等同消息认证；未认证连接仍可能占连接位，受32连接及15秒读期限限制。认证并验证后的活动请求另限16个，不提供同用户恶意程序隔离。

静态PowerShell源码通过stdin JSON接收路径，不拼命令、不改全局执行策略。文件同步后用MoveFileEx WRITE_THROUGH原子发布，首次记录禁止覆盖。Windows慢检查运行在Worker，DSH会话接口仍由原Host调用。

自0.4.0起，将一次JSON新建/替换的目录准备、独占私有临时文件创建、Flush和原子发布合并到一次辅助程序调用。属主与DACL通过系统.NET的 [File.GetAccessControl](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.getaccesscontrol?view=netframework-4.8.1) / [Directory.GetAccessControl](https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.getaccesscontrol?view=netframework-4.8.1) 每次重新读取，保留原有规则判定；不缓存权限、不安装额外运行时、不放宽ACL。失败只清理本次成功独占创建的临时文件，原目标通过原子替换保持完整。

默认时限如下（开发测试可显式设置较短时限）：

| 路线 | Host请求时限 | 客户端等待 |
| --- | --- | --- |
| DSH普通请求，Windows | 60秒 | 90秒 |
| DSH普通请求，POSIX | 10秒 | 15秒 |
| DSH创建，两平台 | 60秒 | 90秒 |
| Codex普通请求，经Host | 60秒 | 90秒 |
| Codex创建，经Host | 210秒；内层exec默认180秒 | 225秒 |
| Codex创建，direct | 不经过Host；内层exec默认180秒 | 无上述Host/传输层时限 |

客户端计时从发起连接开始，包含连接过程，不包含此前同步预检。单次Windows系统检查另限10秒。同步检查可能推迟定时器，内层exec时间不含前后验证和收尾，均非硬实时保证。超时保留不明状态，不自动重试、解锁未结束操作或重启应用。DSH创建/改名调用当前未传取消信号，停用插件或终止Worker不保证Host操作取消；保存计划/已知ID人工核实，不自动删除或重建。

## 诊断与验证

在已安装插件目录运行：

```powershell
node scripts/doctor.mjs
node scripts/doctor.mjs 'C:\path-to-trusted-tools\codex.exe'
```

只核目录和可选程序权限，不发消息、不读取认证正文、不修ACL。缺少SystemRoot、辅助程序启动/超时/输出问题与安全拒绝分别报告。`codex_unavailable`不等于必须重装。

开发验证：`npm test`、`npm run check:release`。测试使用合成Host/CLI，无真实消息；用系统.NET编译合成exe，不下载工具。测试入口原子创建私有TEMP并只清理该临时目录；如需指定父目录，设置本次测试的`BRIDGE_TEST_PARENT`到受保护本机目录，不指向正式桥状态。

0.4.1 将单机测试文件并发限制为2，减少多个 PowerShell 安全辅助进程争用；三个云端分组仍在独立runner并行，测试、超时和ACL检查不减少。实际打包清单另用 `npm run check:pack` 验证。

若桥状态意外出现沙箱组等额外 Allow ACE，`unsafe_file` 是预期保护。不要加入白名单或给沙箱开放状态目录。先结束使用桥的任务并退出DSH，由管理员核明变更来源，只恢复桥状态本身原有私有ACL，保留登记、创建意图和回执；若 channel-key.json 曾可能被额外主体读取，恢复ACL后须安全轮换该桥通道密钥，不能仅改ACL便宣称隔离已恢复。不要输出/备份旧密钥到工作区；账号凭据、项目和系统ACL不在恢复范围内。重开后先核只读连接，不重试结果未知的原请求。插件和 doctor 不自动修权限或清空状态。

当前包验证结果见 [验证记录](SECURITY-REVIEW.md)。0.4.0 的 R7 三级实测创建与逐级回信通过；此前 R6 曾创建结果不明，不能据一次成功抹去历史风险。未知创建须保留原请求编号和已知ID核查，不更换编号重建。真实断电耐久与全部系统策略组合未验证。

doctor 的 `scope: local_permissions`、`hostConnectivity: not_checked` 表示只核本机权限；`ok: true`不代表DSH、桥端点或Codex在线，也不检查POSIX端点长度。请使用 `npm test` 或 `node scripts/test.mjs`；直接 `node --test` 绕过私有TEMP准备，在系统TEMP权限不合格时可能失败。`BRIDGE_TEST_PARENT` 优先选择已存在且ACL合格的父目录；缺失祖先可能被辅助程序创建，测试结束不会连带清理这些祖先。

共享工作区不享有桥状态的私有ACL保证。登记路径应与DSH项目一致，不混用UNC、映射盘、别名或不同大小写。网络根不可达或身份改变时会拒绝操作；核实真实目录后再决定是否重新登记，不降低身份检查。

### 开发者：Windows CI 分组

GitHub Actions 在每个Windows runner先用系统Windows PowerShell 5.1做一次只读初始化（步骤上限1分钟），再运行测试；初始化不读取桥状态、不修改ACL，也不复用权限判定，正式系统检查仍限10秒。这样将可能的首次解释器启动开销与安全检查区分，仍须以云端运行结果验证效果。

GitHub Actions 使用三个独立 Windows runner 并行执行测试，再由 `test (windows-latest, 24)` 汇总结果。所有分组通过才算 Windows 通过；失败、取消或跳过任一分组都不能获得成功汇总。本地 `npm test` 仍运行全套，也可定位单组：

```sh
node scripts/test.mjs --list
npm test -- --shard=1/3
npm test -- --shard=2/3
npm test -- --shard=3/3
```

分组清单在 `scripts/test-shards.mjs`，按本机 Windows 耗时平衡；新增、移除测试文件时需同步更新。入口每次核对全部测试文件恰好分配一次，不会静默漏测。Host、Worker 和 CLI 权限用例分文件执行，原断言、超时与私有 TEMP 规则保留。并行主要缩短等待时间，不保证减少 runner 总用量；云端排队及启动时间另计。
