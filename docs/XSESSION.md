# 配套 dsh-xsession

[English](XSESSION.en.md) · [五对话流程](WORKFLOW.md)

兼容基线：本桥 0.4.1、`dsh-xsession` 0.1.2、DSH Desktop 0.2.0-rc.2。实际通过及未验项见[验证记录](SECURITY-REVIEW.md)，不推断其他版本也已通过。

## 安装与职责

本指南以可选的 [`dsh-xsession`](https://github.com/YINJINHUA/dsh-xsession) 为例；本桥不要求绑定这一内部通信插件。

在 DSH「插件 → 添加插件」分别填写 `codex-dsh-project-bridge` 和 `dsh-xsession`，安装并启用。更新按客户端提示重启；不要中断有未决投递的任务。两者是独立包，本桥不会自动安装、调用或更改 xsession 配置。只做 Codex ↔ DSH 通信时不必装 xsession。

| 方向/操作 | 使用什么 |
| --- | --- |
| Codex 1 ↔ 2 | 可用且获授权的 Codex 原生会话工具 |
| Codex 2 ↔ DSH 3 | 本桥 CLI `send/status/result` |
| DSH 3 创建 4/5 | 本桥 `create --to dsh --dsh-permission inherit` |
| DSH 3 ↔ 4/5 | DSH 内的 `xsession_list/send/inbox` 工具 |

`xsession_*` 是模型可调用的 DSH 工具，不是终端命令；没有 `xsession_create`。不要用 Codex thread ID 代替 DSH session ID。

## 最小交接

1. 3 创建 4/5 时，在首条提示写清任务编号、计划/报告路径、版本或哈希、3 的真实 DSH ID、授权范围及回报要求。创建时显式加 `--dsh-permission inherit`；随后核实际权限。它仅跳过桥的覆盖，不证明默认值一定是工作区内修改。
2. 在 DSH 对话里调用 `xsession_list({})` 核对目标 ID 与在线状态。不必为每次发信读取标题或完整历史；超过一页才用 `nextCursor`。
3. 例如 4 完成已授权任务后，将报告写在工作区内，再调用下面的工具参数。把占位 ID 换成同工作区协调者的完整 ID：

```json
{
  "target": "session-00000000-0000-4000-8000-000000000001",
  "requestId": "task-demo-executor-report-001",
  "kind": "handoff",
  "delivery": "followup",
  "message": "TASK-DEMO 执行完成。报告：handoff/TASK-DEMO-RESULT.md；版本/哈希：填写实际值；未验项：填写实际项。请按既有授权收取，勿仅凭本消息宣布通过。"
}
```

这是 `xsession_send` 的参数，不是本桥 `send` 的参数。`followup` 用于需要后续回合处理的交付；日常 `auto` 在空闲时唤醒，运行中只注入上下文。不要先发 auto 再发 followup 补一遍。同编号不同参数会被拒绝。

4. 3 实际收到后核报告与版本，再通过本桥回传 Codex 2。审查应由单独的 5 复现，再走 5 → 3 → 2 → 1；不把执行者自述当独立审查。只读会话不能写文件，可按原授权在消息中给简短结论，由可写协调者保存并注明来源。

`xsession_inbox({"limit": 10})` 可查自己的近期记录；这只是插件运行期间的索引，不是持久化或已读证明。可用 `replyTo` 关联收到的 message ID（不是 requestId）；链深上限 3，不进行纯确认回复或为绕过上限另起空链。

## 工作区与权限边界

- 同一 DSH Host、同一规范化工作区根目录、在线且未归档的顶层对话。桥创建的独立顶层对话适用；真正的子代理不在范围内。
- 父子目录不是同一工作区。桥登记多个 checkout、使用同一个项目代号，也不会扩大 xsession 的边界。**需要跨项目对话，请另外寻找并验证支持该能力的插件**；不要伪造工作区或更改登记绕过限制。
- 默认权限的执行者用 xsession 原生工具回信，不需要桥的私有状态、外部 CLI 或完全权限。低权限消息仍能影响高权限接收者，接收者必须独立核对用户原有授权；不能借协调者绕过审批拒绝。
- 消息最多 4,000 个 UTF-16 码元，长内容用已授权的项目文档；不发密钥。唤醒对话会使用模型额度。

## 错误处理

`accepted` 只表示同步入队调用成功，必须核目标实际回信。`outcome_unknown` 时保留原编号、参数、目标及回执，先查看目标，不换编号、改 delivery、切回桥 CLI 或重建对话自动补发。

离线目标须由正常应用流程恢复后再核状态；xsession 本身不恢复会话。限流时停止催问；实例最多 2,000 条回执，不能反复重载绕过。重启会丢失内存索引及幂等记录，先核未决任务，重启后不盲目重发。

两包不共用回执。桥 CLI 的持久化去重不能替代 xsession 的实例内去重，也不能将桥读取到的最近答复不加关联地当作当前请求完成。

接口来源：[dsh-xsession 协议](https://github.com/YINJINHUA/dsh-xsession/blob/main/docs/PROTOCOL.md)。
