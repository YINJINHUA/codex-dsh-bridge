# Codex ↔ DSH 项目通信桥

[English](README.en.md) · 简体中文

让 **Codex 与 DeepSeek Harness（DSH）在本机互发消息**。登记项目后，可向所属对话发信、查询状态、读取 DSH 答复，也支持显式创建对话。

版本 0.4.1 · MIT · Node.js 22+ · macOS 已实测 / Windows 预览 / Linux 未实机验证

社区插件，非官方产品。使用本机 socket / Windows 加密命名管道连接 DSH 宿主（Host，即桌面应用的后台进程），通过官方 Codex CLI 通信；不模拟点击、不经云中转，桥本身无需 API Key。两款应用须运行在同一台电脑；不提供跨电脑远程桥接。

## 可以做什么

| 能力 | 用途 |
| --- | --- |
| 跨应用发信 | Codex 与 DSH 的已有对话互传任务、文档路径和结果 |
| 按项目使用 | 只登记项目，同项目所属对话无需逐个登记 |
| 查询进度和结果 | 查询两端会话状态、读取 DSH 最近答复，辅助交接 |
| 创建对话 | 创建 DSH 协调/执行/审查对话；Codex CLI 创建保留为高级用法 |
| 文档协作 | 把详细计划、执行报告和审查报告留在工作区，消息只传路径、版本与摘要 |

插件负责通信与核对项目归属，**不是自动任务调度器，也不保证模型费用降低**。

## 安装

需要 DSH 桌面版、Node.js 22+ 和已登录且支持 `queue` 的 Codex CLI。使用 DSH 官方 desktop profile 安装，源码目录与安装目录分开。

从0.3.8起，包名和GitHub仓库统一为 `codex-dsh-project-bridge`。0.3.7及以前使用旧包名 `dsh-plugin-codex-project-bridge`；升级时先按[卸载说明](docs/UNINSTALL.md)移除旧包，再安装新包，避免同时加载。私有状态目录仍为 `.codex-dsh-bridge`，保留原登记和回执。

### 方式一：客户端填写 npm 包名（推荐）

该入口受 DSH 官方支持。版本的安装与联合实测范围见[验证记录](docs/SECURITY-REVIEW.md)；准备中的版本以 npm 实际发布为准。

1. 打开 DSH 桌面版，进入 **插件 → 添加插件**。
2. 在包名输入框填写：

   ```text
   codex-dsh-project-bridge
   ```

3. 点击安装，核对显示的包名和实际版本，完成后点击**立即启用**；如提示重启，按提示操作。

只填包名，不填 `npm install` 或整条命令，也不必先下载文件。裸包名使用安装源的默认版本标签（通常为 `latest`）；固定版本可填 `codex-dsh-project-bridge@0.4.1`。新版本以 npm 实际发布成功为准，GitHub Release 出现不代表 npm 工作流已完成。找不到刚发布的版本时，可在**安装源**选择 **npm 官方源**（`https://registry.npmjs.org/`）再核查；镜像可能尚未同步。

该入口接受包名及版本，依据 [DSH 官方插件管理说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)。安装完成后核实际版本，不将下载成功视为插件已正常加载。

### 方式二：客户端安装本地压缩包

从可信发布来源取得固定版本 `.tgz`（或按[打包说明](docs/RELEASING.md)生成），在同一个**添加插件**输入框填写文件绝对路径，然后安装并启用。不要填写源码文件夹或整条命令。

### 方式三：桌面版自带命令行

使用 DSH 桌面应用提供的 `dsh` 命令，可在应用菜单的**管理 dsh 命令…**中安装或修复。先至少打开一次 Desktop 初始化 profile，再结束相关任务并**完全退出应用**（只关闭窗口不等于退出），然后执行：

```sh
dsh plugin --profile desktop add codex-dsh-project-bridge@0.4.1 --ignore-scripts
```

已有可信的本地安装包时：

```sh
dsh plugin --profile desktop add /absolute/path/codex-dsh-project-bridge-0.4.1.tgz --ignore-scripts
```

本地包安装也可能需要联网解析 desktop profile 中其他插件的依赖索引。仅在全部依赖和索引已缓存时追加 `--offline`；若提示缺少离线元数据，核对安装源后使用正常联网安装。网络包名下载不要加 `--offline`。单独通过 npm 安装的 `dsh` 不能管理 Desktop profile，见 [DSH 官方桌面说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md#内置命令运行时)。`npm install -g codex-dsh-project-bridge` 也不会登记桌面插件。

如需先下载已发布安装包，在保存目录运行：

```sh
npm pack codex-dsh-project-bridge@0.4.1 --registry=https://registry.npmjs.org/ --ignore-scripts
```

再按方式二安装生成的 `.tgz`。`next` 是预览标签，与 `latest` 分开；发布到 `next` 不会自动更新裸包名的默认版本。普通 GitHub 推送不发布 npm；发布预发行 Release → `next`，正式 Release → `latest`，均须通过该提交的完整 CI。见[发布说明](docs/RELEASING.md)。

GUI 安装不等同于上述命令的 `--ignore-scripts` 限制。默认安装位置：

| 平台 | 插件目录 |
| --- | --- |
| macOS | `~/.dsh/profiles/desktop/node_modules/codex-dsh-project-bridge` |
| Windows | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\codex-dsh-project-bridge` |

升级前按[卸载说明](docs/UNINSTALL.md)移除旧包，保留项目登记与通信记录。启动和数据目录见[启动说明](docs/STARTUP.md)。

### 配套安装：DSH 同项目对话互发消息

需要下方 3、4、5 的内部交接时，在 DSH「添加插件」再填入 **`dsh-xsession`** 并启用（本次兼容基线 `0.1.2`）。[项目与说明](https://github.com/YINJINHUA/dsh-xsession)。它让默认权限的 DSH 对话用 `xsession_*` 工具互发消息；本桥负责 Codex ↔ DSH 和创建对话，两包独立安装，不互改权限。

仅支持**同一 DSH 宿主、同一规范化工作区根目录**；父子目录或同一项目登记下的不同根目录也不算相同。需要跨项目对话，请另外选择并验证支持该能力的插件；本配套方案不提供跨项目路由。具体步骤见[配套指南](docs/XSESSION.md)。

## 首次配置与发消息

以下命令在已安装的插件目录执行；其他目录中请将 `bin/bridge.mjs` 换成绝对路径。

**1. 配置 Codex 并登记项目。** 根目录须与应用内项目/对话实际目录一致，无需逐个登记对话。

```sh
node bin/bridge.mjs configure-codex --binary /absolute/path/to/codex
node bin/bridge.mjs register --project my-app --root /absolute/path/to/my-app
```

Windows 的 `--binary` 指向可信的原生 `codex.exe`。应用中须已存在对应项目；登记不会替你创建应用项目。

**2. 将消息写入 UTF-8 文件，再发送。** 正文不超过 8192 字节，每条新消息使用唯一编号。

```sh
node bin/bridge.mjs send --project my-app --to dsh --session DSH_SESSION_ID --request-id handoff-001 --text-file message.txt
node bin/bridge.mjs send --project my-app --to codex --session CODEX_THREAD_ID --request-id reply-001 --text-file reply.txt
```

**3. 查询进度与答复。** 入队不代表完成；最近答复须与本次请求匹配。

```sh
node bin/bridge.mjs status --project my-app --to dsh --session DSH_SESSION_ID
node bin/bridge.mjs result --project my-app --to dsh --session DSH_SESSION_ID
```

## 建议示例：计划、执行与独立审查

| 对话 | 职责与建议权限 |
| --- | --- |
| 1 · Codex | 写计划、检查交付、编写审查说明；可使用“帮我批准” |
| 2 · Codex | 完全权限协调，通过桥创建 3、转交文档 |
| 3 · DSH | 完全权限协调，分别创建 4 和 5、收取报告 |
| 4 · DSH | 执行任务并写报告；跟随软件的新会话默认权限 |
| 5 · DSH | 独立审查并写报告；跟随软件的新会话默认权限 |

**执行：** 1 写计划 → 2 创建 3 → 3 写说明并创建 4 → 4 写报告 → 3 → 2 → 1 确认。

**审查：** 1 写审查说明 → 2 → 原 3 创建 5 → 5 写报告 → 3 → 2 → 1 最终确认。

1↔2 使用可用且获授权的 Codex 原生消息，2↔3 使用本桥。**DSH 对话 3、4、5 的内部消息和主动回报使用另装的 `dsh-xsession`。** 使用其真实 DSH 会话 ID，保持同一工作区。未安装时仍可由 3 有界收取报告，但本桥不会自动唤醒已结束的协调对话。

创建 4/5 时用 `--dsh-permission inherit`（跟随 DSH 默认权限）；3 的完全权限须本机明确配置。完整命令、兼容要求和权限说明见[协作指南](docs/WORKFLOW.md)。简单任务可减少角色，费用仍取决于模型与调用次数。

## 关键限制

- **权限与安全：** 完全权限须明确授权；项目登记不隔离同用户恶意进程。见[权限说明](docs/PERMISSIONS.md)。
- **Codex 新对话：** 建议由已有 Codex 对话通过桌面原生能力创建；CLI 创建不保证侧栏显示；Windows 单次成功不代表所有环境均稳定。见[平台与验证记录](docs/SECURITY-REVIEW.md)。
- **结果不明：** 先核查目标，不换编号重复发送或创建。代理消息不是新的用户授权，唤醒代理会使用目标应用额度。见[故障处理](docs/CLI.md#失败与重试)。

## 详细文档

| 想了解什么 | 文档 |
| --- | --- |
| 创建对话、完整命令、错误处理 | [CLI 参考](docs/CLI.md) |
| 五对话分工与报告交接 | [协作示例](docs/WORKFLOW.md) |
| 启动、数据位置、升级与卸载 | [启动](docs/STARTUP.md) · [卸载](docs/UNINSTALL.md) |
| 权限、通信实现、平台限制 | [权限](docs/PERMISSIONS.md) · [架构](docs/ARCHITECTURE.md) · [Windows](docs/WINDOWS.md) |
| 验证与开源发布 | [验证记录](docs/SECURITY-REVIEW.md) · [打包](docs/RELEASING.md) · [更新记录](CHANGELOG.md) |

开发验证：`npm test`、`npm run check:release`、`npm run check:pack`。安全问题见 [SECURITY.md](SECURITY.md)，许可证为 [MIT](LICENSE)。
