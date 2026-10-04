# Codex ↔ DSH Project Bridge

English · [简体中文](README.md)

**Exchange local messages between Codex and DeepSeek Harness (DSH).** Register a project to message its conversations, inspect status, read DSH replies and explicitly create conversations.

Version 0.3.7 · MIT · Node.js 22+ · macOS tested / Windows preview / Linux not live-tested

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

### Option 1: Add plugin in the desktop app

1. Obtain a fixed-version `.tgz` from a trusted release source, or [build it](docs/RELEASING.md).
2. Open **Plugins → Add plugin** in DSH and enter the package's absolute path, not a shell command. The package is not currently published to npm.
3. Open DSH normally after installation and enable the plugin. No dedicated launcher or custom environment variable is required.

### Option 2: Official command line

Finish related work and quit DSH before running:

```sh
dsh plugin --profile desktop add /absolute/path/dsh-plugin-codex-project-bridge-0.3.7.tgz --offline --ignore-scripts
```

GUI installation does not imply the command's offline and script restrictions. Default installation locations:

| Platform | Plugin directory |
| --- | --- |
| macOS | `~/.dsh/profiles/desktop/node_modules/dsh-plugin-codex-project-bridge` |
| Windows | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-plugin-codex-project-bridge` |

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
