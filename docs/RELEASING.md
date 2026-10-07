# 0.4.0 上传与升级说明

本仓库采用 MIT。只上传源码仓库，不上传上一级工作目录、本机 audit、已安装 profile、通信状态或凭据。已发布版本不可覆盖。

## GitHub Release 自动发布 npm

`.github/workflows/publish.yml` 使用 npm 官方 OIDC 可信发布，不保存长期 npm Token、不关闭账号双重认证。普通提交、推送和 Release 草稿不会发布 npm。

| GitHub 操作 | npm 结果 |
| --- | --- |
| 发布预发行 Release（勾选 Set as a pre-release） | `next` |
| 发布正式 Release（不勾选预发行） | `latest`，裸包名默认安装此版本 |
| 将同一预发行 Release 转为正式 | 校验已发布包字节一致后，将该版本加入 `latest`；不重传或覆盖包 |

本次 0.4.0 使用 `v0.4.0` 正式 Release。Release 标签必须等于 `v` 加 package.json 版本；正式版不接受 `-rc` 等预发行版本号。改变版本号必须同步锁文件、CLI 和版本说明。

### 维护者一次性配置

在 npm 包 Settings → Trusted Publisher 中选择 GitHub Actions：

- Organization or user：`YINJINHUA`
- Repository：`codex-dsh-project-bridge`
- Workflow filename：`publish.yml`（只填文件名）
- Environment：留空（本工作流没有 environment）
- 允许 `npm publish` 和 `npm dist-tag`；后者用于同版本由 `next` 升为 `latest`。只允许 stage 不够。

保存时完成 npm 要求的身份验证。新配置须在 npm 规定的有效期内完成首次成功发布；若过期按网站提示重新配置。官方要求 GitHub 托管 runner；此工作流使用 Node 24、固定 npm 11.21.0，后者支持 dist-tag 的 OIDC 认证。CLI 安装仅发生在临时 runner，不修改维护者电脑。

### 每次发布

1. 核版本、更新记录、源码差异及公开文件清单；运行 `npm run check:release` 和 `npm test`，然后提交并推送。
2. 等该提交的 `checks` 全部通过：Linux/macOS Node 22/24 四组、Windows 三组及汇总，共八项。只认可默认分支上该 SHA 的最新 push 或手动检查；旧提交、PR、跳过或失败不算。
3. 在该提交创建标签及 Release，选择预发行或正式。不要移动已发布标签，也不要沿用包含不同字节的旧附件。
4. 发布 Release。`Publish npm` 复用上述 CI，核实时标签及 Release 类型，生成一次固定 `.tgz`，通过 OIDC 发布并核 npm 版本、标签、SHA512；最后添加同一包及 `SHA256SUMS.txt` 到 Release。
5. 检查 `Publish npm` 成功和 npm 的实际标签。GitHub 页面显示 Release 不代表 npm 已完成。下载、安装与 DSH 实际加载仍需分别验证；CI 通过不等于实机安装通过。

工作流从完整源码 checkout 执行门禁；npm 安装包按规则不含 package-lock.json 等仓库元数据，不能用安装包跑源码门禁来判定发布失败。

### 失败、重跑与预发行升级

- CI 尚未完成或失败时停止，不会绕过；待同一提交检查成功后重跑失败的 `Publish npm`。
- npm 版本不存在才发布。已存在且字节一致时只修正所需标签或验证；不一致则停止，必须另用版本号。
- 相同内容的预发行转正式只修改 `latest`；`next` 可继续指向同一版本，不自动删除。
- `-rc` 版本不能作为正式版本；创建新的稳定版本及 Release。
- npm 写入不做盲目重试。出现超时先核 registry 实际版本与标签；不能换包重试同一版本。
- 附件已存在时校验 GitHub 提供的 SHA256，匹配则保留，不匹配或无校验信息则停止并人工核查，不自动覆盖。
- 发布工作流串行运行；不要同时发布不同版本；流程拒绝将 `latest` 回退到较旧稳定版本。

紧急手工发布也必须使用同一份经核验固定包，明确 `--tag next` 或 `--tag latest`，遵守账号的双重认证要求；不得把登录信息写进仓库。package.json 不固定 tag，自动流程按 Release 类型显式传入。

参考 [npm 可信发布](https://docs.npmjs.com/trusted-publishers/) 与 [GitHub Release 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)。

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
