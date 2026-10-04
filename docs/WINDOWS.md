# Windows 适配预览

Windows 支持正常启动 DSH、启用插件、项目登记、消息投递与状态查询。使用真实对话时必须逐段确认收信；**纯 CLI 创建 Codex 对话仍是高级预览能力，不保证创建调用能正确返回终态或会话显示在侧栏**。日常由已有 Codex 对话通过桌面原生能力创建新对话。

## 环境与安装

需要 Windows、本机 NTFS、Node.js 22+、系统 Windows PowerShell 5.1，以及已登录的 DSH Desktop 和支持 queue 的 Codex CLI。复用可信安装，PATH 缺失不代表未安装。

- 官方安装目录：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-plugin-codex-project-bridge`。
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

普通Host请求期限60秒、客户端连接后等待90秒；单次系统检查另限10秒。Codex创建内层默认180秒，外层有独立更长期限；同步检查可能推迟定时器，不是硬实时保证。超时保留不明状态，不自动重试、解锁未结束操作或重启应用。

## 诊断与验证

在已安装插件目录运行：

```powershell
node scripts/doctor.mjs
node scripts/doctor.mjs 'C:\path-to-trusted-tools\codex.exe'
```

只核目录和可选程序权限，不发消息、不读取认证正文、不修ACL。缺少SystemRoot、辅助程序启动/超时/输出问题与安全拒绝分别报告。`codex_unavailable`不等于必须重装。

开发验证：`npm test`、`npm run check:release`。测试使用合成Host/CLI，无真实消息；用系统.NET编译合成exe，不下载工具。测试入口原子创建私有TEMP并只清理该临时目录；如需指定父目录，设置本次测试的`BRIDGE_TEST_PARENT`到受保护本机目录，不指向正式桥状态。

当前包验证结果见 [验证记录](SECURITY-REVIEW.md)。此前三级实测已实际回信，但创建调用仍返回结果不明，未宣布全链通过。未知创建须保留原请求编号和已知ID核查，不更换编号重建。真实断电耐久与全部系统策略组合未验证。
