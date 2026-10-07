# 0.4.0 上传与升级说明

本仓库采用 MIT。只上传源码仓库，不上传上一级工作目录、本机audit、已安装profile、通信状态或凭据。0.3.8起启用公开npm发布配置，registry固定为官方地址，默认标签为`next`；0.4.0尚未发布，已发布的0.3.8包保持原样。GitHub推送与Release目前均不自动触发npm发布。

## 发布前

1. 运行 `npm test`、`npm run check:release`，核 `node bin/bridge.mjs help` 版本为0.4.0。平台跳过不计为通过，实际测试范围见 [验证记录](SECURITY-REVIEW.md)。
2. 检查提交差异，包含新增源码、测试与文档；不包含本机路径、实际对话ID、回执、日志或秘密。
3. 使用 `npm pack --offline --ignore-scripts --pack-destination /absolute/private-output` 生成固定包；核清单和SHA256，安装文件须匹配。已正式分发包不可用不同字节覆盖；实现变化另分配版本。未发布草稿修补后须在新输出目录重新打包，保留旧包证据，并同时替换草稿安装包和校验文件。
4. GitHub Desktop 中审阅后提交并推送；如发Release，标签为 `v0.4.0`。等待该提交的Actions检查通过，再核标签、源码和附件一致后发布。检查失败保持草稿，不用旧提交的成功结果替代。注明Windows仍为预览，CLI新会话不保证侧栏显示，未验链路不能称通过。

源码门禁在完整Git仓库中运行；npm安装包按npm规则不含package-lock.json及部分仓库元数据，不能用安装包运行源码门禁并据此判发布失败。安装包单独核文件清单/哈希和安装行为。

CI 应包含 Linux/macOS 的 Node22/24 四组、Windows 三个分组及汇总 `test (windows-latest, 24)`，共八项。Windows 单组成功不代表全套通过，汇总须三组均成功；只改分组或测试也须等待当前提交检查，不沿用此前性能优化提交的通过结果。

## npm 手动发布

首次发布前核包名可用性；registry返回404不保证最终能注册。维护者登录npm账号、完成邮箱及双重验证，勿把认证信息写入源码、日志或交接文档。先确认对应源码提交的CI通过，再发布同一份经清单和哈希验证的固定包：

```sh
npm publish /absolute/private-output/codex-dsh-project-bridge-0.4.0.tgz --dry-run --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
npm publish /absolute/private-output/codex-dsh-project-bridge-0.4.0.tgz --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
```

第一条仅预演；第二条才会公开发布，并可能要求浏览器登录或双重验证。发布失败时先查registry实际状态，不能换内容重试相同已存在版本。发布后核版本、`dist-tags`及`dist.integrity`与固定包SHA512一致，再验证从registry取得包并在DSH加载。当前不承诺npm首次安装已验证；不以源码测试代替安装验证。GitHub附件使用相同包；已发布0.3.7保持原样。

后续可单独配置GitHub Actions可信发布（OIDC），只由版本发布触发；本版未启用，也不需要新增长期npm令牌。参考[npm发布](https://docs.npmjs.com/cli/v11/commands/npm-publish/)与[可信发布](https://docs.npmjs.com/trusted-publishers/)。

## 安装与升级

0.3.7及以前的安装包名为 `dsh-plugin-codex-project-bridge`。升级到0.3.8及之后的版本须先按[卸载说明](UNINSTALL.md)移除旧包，再安装 `codex-dsh-project-bridge`，不得双加载。包名改动不移动既有私有状态目录，也不改内部插件ID。

0.4.0 默认私有状态目录为当前用户目录下 `.codex-dsh-bridge`，正常打开DSH并启用插件即可，无需专用启动器或自定义环境变量。通信客户端保留在包内，用Node调用 `bin/bridge.mjs`；不自动生成外部命令快捷入口。

已有其他状态目录时，先按 [启动与迁移说明](STARTUP.md) 保留并完整迁移数据。目标存在数据时先处理冲突；不得用重新登记或清空回执代替迁移，也不自动放宽权限。Mac默认位置未变。

结束相关工作并正常退出DSH，按 [卸载说明](UNINSTALL.md) 卸载旧包、核清加载项，再安装新包。终端操作须使用桌面应用自带的 `dsh`，单独从npm安装的CLI不能管理desktop profile。固定本地包安装：

```sh
dsh plugin --profile desktop add /absolute/path/codex-dsh-project-bridge-0.4.0.tgz --offline --ignore-scripts
```

图形界面安装见 [中文README](../README.md#安装) / [English README](../README.en.md)。优先在客户端“添加插件”填写 `codex-dsh-project-bridge`，或指定已发布版本；未发布候选使用本地包。安装源不是安装目标，不链接工作中的源码checkout；保留包管理器仍引用的安装包。GUI不等同于CLI的offline/ignore-scripts限制。

重开后核插件详情和CLI均为0.4.0，并对已登记测试项目核只读状态。不要用业务角色作测试探针；不因安装更新而创建会话或开启完全权限。保留登记revision、权限策略、创建意图、去重及未知交付记录，安装不自动删除或迁移这些数据。

DSH默认创建权限为inherit；显式full-access覆盖、单次 `--dsh-permission inherit` 及Codex按项目权限是独立配置，详见 [权限说明](PERMISSIONS.md) 与 [协作示例](WORKFLOW.md)。卸载或更新不撤销已有会话权限。

源码回归、安装文件一致、普通启动及实际收信分别记录。公开问题报告只用最小合成复现，不贴凭据、聊天正文或个人路径。历史部署清理与回退材料保留在本机，不随公开包分发。
