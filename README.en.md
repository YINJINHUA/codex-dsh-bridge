# Codex ↔ DSH Project Bridge

English · [简体中文](README.md)

**Exchange local messages between Codex and DeepSeek Harness (DSH).** Register a project to message its conversations, inspect status, read DSH replies and explicitly create conversations.

Version 0.4.0 (unreleased) · MIT · Node.js 22+ · macOS tested / Windows preview / Linux not live-tested

A community plugin, not an official product. It connects to the DSH Host (the desktop app’s background process) through local sockets or encrypted Windows named pipes, and to Codex through its official CLI. No UI automation, cloud relay or separate bridge API key. Both applications must run on the same computer; this plugin does not bridge remote machines.

## What it can do

| Capability | Use |
| --- | --- |
| Cross-app messaging | Exchange tasks, document references and results between existing Codex and DSH conversations |
| Project registration | Register a project once, without adding each conversation to an allowlist |
| Progress and results | Query conversation status on both sides and read recent DSH replies |
| Conversation creation | Create DSH coordinators, workers and reviewers; Codex CLI creation remains advanced usage |
| Document handoffs | Keep plans and reports in the workspace; exchange paths, versions and short summaries |

The plugin provides communication and project checks. **It is not an automatic scheduler and does not guarantee lower model costs.**

## Install

Requires DSH Desktop, Node.js 22+ and a signed-in Codex CLI with `queue` support. Use the official DSH desktop profile; keep the source checkout separate from the installed copy.

From 0.3.8, the package and GitHub repository are named `codex-dsh-project-bridge`. Versions through 0.3.7 used `dsh-plugin-codex-project-bridge`: [remove that old package](docs/UNINSTALL.md) before installing the new one to avoid loading both. Private state remains in `.codex-dsh-bridge`; preserve registrations and receipts.

### Option 1: Enter the npm package name in DSH (recommended)

This method is supported by DSH. Live installation under this plugin's new package name and upgrading from the old package have not yet been verified; see [validation](docs/SECURITY-REVIEW.md).

1. Open DSH Desktop → **Plugins → Add plugin**.
2. Enter:

   ```text
   codex-dsh-project-bridge
   ```

3. Install, check the displayed package name and actual version, then choose **Enable now**. Restart if the app requests it.

Enter only the package name, without `npm install` or a shell command; no manual download is needed. A bare name uses the registry's default tag (normally `latest`). To pin a version, enter `codex-dsh-project-bridge@0.3.8`. As verified on 2026-10-08, 0.3.8 is published; this repository's 0.4.0 is not yet published, so do not request `@0.4.0` yet. If a newly published version is missing, check with the **official npm registry** (`https://registry.npmjs.org/`) in the install-source selector; mirrors may lag.

Package names and versions are supported by the [official DSH plugin manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.md). Check the installed version; a successful download alone does not prove the plugin loaded.

### Option 2: Install a local archive in DSH

Obtain a fixed-version `.tgz` from a trusted release source, or [build it](docs/RELEASING.md). Enter its absolute file path in the same **Add plugin** field, then install and enable it. Do not enter a source checkout or shell command.

### Option 3: The desktop app's bundled CLI

Use the `dsh` command provided by DSH Desktop; install or repair it through the app's **Manage dsh command…** menu. Launch Desktop at least once to initialize its profile, finish related tasks and **fully quit the app** (closing its window is not enough), then run:

```sh
dsh plugin --profile desktop add codex-dsh-project-bridge@0.3.8 --ignore-scripts
```

For an existing trusted local candidate archive:

```sh
dsh plugin --profile desktop add /absolute/path/codex-dsh-project-bridge-0.4.0.tgz --offline --ignore-scripts
```

Do not use `--offline` for a registry download. A separately npm-installed `dsh` cannot manage the Desktop profile; see the [official desktop documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md). `npm install -g codex-dsh-project-bridge` also does not register a desktop plugin.

To download a published archive first, run in your download directory:

```sh
npm pack codex-dsh-project-bridge@0.3.8 --registry=https://registry.npmjs.org/ --ignore-scripts
```

Then install the `.tgz` using Option 2. `next` is a preview tag, separate from `latest`; publishing to `next` does not automatically change the default for a bare package name. GitHub pushes do not currently publish to npm automatically.

GUI installation does not imply the command's offline and script restrictions. Default installation locations:

| Platform | Plugin directory |
| --- | --- |
| macOS | `~/.dsh/profiles/desktop/node_modules/codex-dsh-project-bridge` |
| Windows | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\codex-dsh-project-bridge` |

For upgrades, [remove the previous package](docs/UNINSTALL.md) while preserving registrations and delivery records. See [startup and data locations](docs/STARTUP.md).

## Configure and send your first message

Run these commands from the installed plugin directory, or replace `bin/bridge.mjs` with its absolute path.

**1. Configure Codex and register a project.** The root must match the application's actual project/conversation directory. Individual conversations need no registration.

```sh
node bin/bridge.mjs configure-codex --binary /absolute/path/to/codex
node bin/bridge.mjs register --project my-app --root /absolute/path/to/my-app
```

On Windows, use a trusted native `codex.exe`. Registration does not create a project in either application; the corresponding project must already exist.

**2. Write a UTF-8 message file and send it.** Messages are limited to 8192 bytes. Give each new message a unique request ID.

```sh
node bin/bridge.mjs send --project my-app --to dsh --session DSH_SESSION_ID --request-id handoff-001 --text-file message.txt
node bin/bridge.mjs send --project my-app --to codex --session CODEX_THREAD_ID --request-id reply-001 --text-file reply.txt
```

**3. Check progress and replies.** Queued does not mean completed; match the latest reply to your request.

```sh
node bin/bridge.mjs status --project my-app --to dsh --session DSH_SESSION_ID
node bin/bridge.mjs result --project my-app --to dsh --session DSH_SESSION_ID
```

## Suggested workflow: plan, execute and independently review

| Conversation | Role and suggested permissions |
| --- | --- |
| 1 · Codex | Write the plan, assess delivery and prepare review instructions; may use Approve for me |
| 2 · Codex | Full-access coordinator; create 3 through the bridge and relay documents |
| 3 · DSH | Full-access coordinator; create 4 and 5 separately and collect their reports |
| 4 · DSH | Execute the task and write a report; follow DSH new-conversation defaults |
| 5 · DSH | Independently review and report; follow DSH new-conversation defaults |

**Execution:** 1 writes the plan → 2 creates 3 → 3 writes instructions and creates 4 → 4 writes a report → 3 → 2 → 1 assesses it.

**Review:** 1 writes review instructions → 2 → the same 3 creates 5 → 5 writes a report → 3 → 2 → 1 makes the final assessment.

Use available, authorized Codex-native messages for 1↔2 and this bridge for 2↔3. **Internal messages and worker callbacks among DSH conversations 3, 4 and 5 require a separate compatible messaging/subagent plugin; this bridge does not include it.** Without that plugin, 3 can perform bounded checks and collect reports, but an ended coordinator will not wake automatically.

Use `--dsh-permission inherit` (follow DSH defaults) when creating 4/5; full access for 3 requires explicit local configuration. See the [workflow guide](docs/WORKFLOW.en.md) for commands, compatibility and permissions. Simple tasks need fewer roles; cost depends on models and calls.

## Key limitations

- **Permissions and security:** full access requires explicit authorization; project registration does not isolate malicious same-user processes. See [permissions](docs/PERMISSIONS.md).
- **New Codex conversations:** prefer creation through an existing Codex conversation’s desktop tools. CLI creation does not guarantee sidebar visibility, and Windows has unresolved issues. See [platform validation](docs/SECURITY-REVIEW.md).
- **Unknown outcomes:** inspect the destination before doing anything else; do not resend or recreate under a new ID. Agent messages are not fresh user authorization, and waking an agent uses its model allowance. See [recovery](docs/CLI.en.md#errors-and-recovery).

## More documentation

| Topic | Guide |
| --- | --- |
| Creation, command reference and errors | [CLI reference](docs/CLI.en.md) |
| Five-conversation workflow and report handoffs | [Workflow](docs/WORKFLOW.en.md) |
| Startup, data, upgrades and removal | [Startup](docs/STARTUP.md) · [Uninstall](docs/UNINSTALL.md) |
| Permissions, transport and platform limits | [Permissions](docs/PERMISSIONS.md) · [Architecture](docs/ARCHITECTURE.md) · [Windows](docs/WINDOWS.md) |
| Validation and releases | [Validation](docs/SECURITY-REVIEW.md) · [Packaging](docs/RELEASING.md) · [Changelog](CHANGELOG.md) |

Some detailed guides are in Chinese. Development checks: `npm test`, `npm run check:release`. See [SECURITY.md](SECURITY.md) and the [MIT license](LICENSE).
