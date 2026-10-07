# CLI reference and troubleshooting

[Home](../README.en.md) · [简体中文](CLI.md)

`bin/bridge.mjs` is relative to the installed plugin directory; an absolute path also works. Configure Codex and register the project first, as described on the homepage.

## Command reference at a glance

Prefix every command below with `node bin/bridge.mjs`. Replace placeholders with real values: `NAME` is a registered project name, `ID` the target conversation ID, `TARGET` either `dsh` or `codex`, and `UNIQUE` a unique request ID.

| Command | Arguments | Purpose |
| --- | --- | --- |
| `help` | None | Show help and version |
| `configure-codex` | `--binary PATH` | Save the absolute path to a trusted Codex CLI |
| `register` | `--project NAME --root PATH` | Register a project; repeat `--root` for multiple roots |
| `projects` | None | List registrations and roots |
| `unregister` | `--project NAME` | Remove registration, preserving app projects, conversations and delivery records |
| `send` | `--project NAME --to TARGET --session ID --request-id UNIQUE --text-file FILE` | Message an existing conversation |
| `status` | `--project NAME --to TARGET --session ID` | Query a target status summary |
| `result` | `--project NAME --to dsh --session ID` | Read recent DSH output; Codex results are not supported |
| `create` | `--project NAME --to TARGET --request-id UNIQUE --title TITLE --text-file FILE` | Create a conversation and submit its first prompt; add `--root PATH` for multiple roots |
| `configure-dsh` | `--new-session-permission MODE` | Set the override for future bridge-created DSH conversations |
| `configure-codex-creation` | `--project NAME --new-session-permission MODE` | Set a project's Codex creation permissions |
| `codex-creation-policy` | `--project NAME` | Read the project's Codex creation policy |

DSH accepts `inherit` (follow app defaults) or `full-access` for `MODE`; Codex accepts `workspace-write` or `full-access`. Management commands write private local configuration and require user authorization. See [permissions](PERMISSIONS.md) for scope and revocation.

Codex `send`, `status` and `create` accept `--via host` (the default, executed by the DSH Host) or `--via direct` (executed by the calling CLI process). Only `create --to dsh` accepts `--dsh-permission inherit`. Host means the DSH desktop background process; a registration `revision` identifies the project configuration and detects changes.

## Send messages

Prepare a local UTF-8 file, at most 8192 bytes. Use a regular file, not a symlink or pipe. NUL and invalid UTF-8 are rejected. Do not include credentials or sensitive file contents.

```sh
node bin/bridge.mjs send --project my-app --to dsh \
  --session session-TARGET-UUID --request-id handoff-001 --text-file message.txt
node bin/bridge.mjs send --project my-app --to codex \
  --session TARGET-CODEX-UUID --request-id reply-001 --text-file reply.txt
```

Use a unique request ID for each new message and never change the body under the same ID. Include the sender's real session ID in the message if a reply is needed. Forwarded content is marked as an agent message, not new user authorization. Agents must still follow their project rules.

**`accepted` / `queued_only` means queued, not completed.** Codex may consume a message after its current turn ends. Check actual target receipt; do not send a second copy merely because the conversation is busy.

## Query progress

```sh
node bin/bridge.mjs status --project my-app --to dsh --session session-TARGET-UUID
node bin/bridge.mjs result --project my-app --to dsh --session session-TARGET-UUID
node bin/bridge.mjs status --project my-app --to codex --session TARGET-CODEX-UUID
```

Match the send receipt's `hostRequestId` against `latestTurn.requestIds`, then inspect `startSeq`, `endSeq` and `reason`. A bounded window may contain an older turn or no complete turn; `latestTurn: null` is not success. DSH `running` is not proof of healthy progress. Codex summary `notLoaded` is not evidence that its desktop task stopped.

## Explicit creation: advanced Codex usage

```sh
node bin/bridge.mjs create --project my-app --to dsh --request-id create-child-001 \
  --title 'Test conversation B' --text-file first-prompt.txt
node bin/bridge.mjs create --project my-app --to codex --request-id create-child-002 \
  --title 'Test conversation C' --text-file first-prompt.txt
```

For a multi-root project, specify one registered `--root`. DSH uses the existing Desktop Host's create/rename/prompt APIs, applying the optional permission override first. Its receipt is queued-only; verify the first reply separately.

Codex uses official `codex exec --json`, waits for the first turn (a default inner timeout of 180 seconds, excluding surrounding checks and process cleanup; synchronous Windows checks may delay timeout handling), verifies project membership, then sets and reads back the title. Children default to **workspace-write**, unless the local project policy explicitly enables full access. Existing conversations are unchanged. `permission.verified: false` records the launch request rather than independent permission readback. See [Codex creation permissions](PERMISSIONS.md#codex-新对话权限设置) for configuration, scope and revocation. An outer process exit code of zero does not prove that every tool call succeeded.

CLI-created sessions have an `exec` source and may not appear in the desktop sidebar. Receipts include `desktopVisibility: not_guaranteed_exec_source`, a real ID and `resumeCommand`. A successful title change does not imply sidebar visibility. Use the real ID with the app's supported open-conversation function or the returned terminal resume command. Do not recreate a session just to make it visible. The bridge does not modify conversation databases or forge source labels.

Creation intent and known/planned IDs are stored durably. Repeating a completed request with identical parameters returns its original receipt. An unknown outcome returns `creation_unknown_no_retry`; preserve the ID and investigate instead of changing the request ID or route.

## Errors and recovery

- `codex_unavailable`: the executable is missing, rejected by trust checks, or could not start. Check the existing installation, complete runtime layout and route configuration before reinstalling.
- `codex_timeout`: a metadata call timed out. This does not prove the conversation is absent; creation may already have happened.
- `delivery_unknown_no_retry` / `creation_unknown_no_retry`: preserve the original request and records, inspect the target, and do not retry via a new ID or route.
- `unknown_project` / `project_mismatch` / `workspace_not_found`: check registration and actual application project membership. Do not broaden registration to bypass the check.
- `session_busy` / `bridge_busy`: bounded requests are still in progress. Wait and inspect status rather than dispatching duplicates.
- `host_request_unsettled` / `host_capacity_unsettled`: a timed-out Host operation has not settled; its lock remains held, with at most 16 unsettled requests. A timeout is not cancellation.
- `bridge_not_ready`: a communication file/endpoint is missing or the connection was refused. Check DSH, plugin enablement and matching state directories. Other security errors remain separate.
- `state_file_missing` / `state_file_exists`: Windows state-file failures retain ENOENT/EEXIST codes for configuration and deduplication logic. Other ENOENT errors may concern a missing project root.
- `request_timeout_delivery_unknown`: the Host deadline elapsed without a known outcome; do not resend under a new ID.
- `unsafe_socket` / `socket_path_too_long`: POSIX endpoint permissions/type or path length failed validation.
- `session_not_found` / `not_accepted`: the Host did not find the conversation or confirm acceptance; preserve any creation record before investigating.
- A missing endpoint requires checking that DSH and the plugin are running with the same state environment. The bridge does not automatically delete stale endpoints or restart applications.

If the Host is permanently stuck, first reconcile unknown delivery and save ongoing work, then quit DSH safely and reopen it. Do not delete receipts as a retry mechanism. The bridge only terminates child processes it owns, never desktop applications by process name.


## Publication and diagnostics

- `publication_busy`: another process owns an unfinished POSIX publication. Check its progress; do not delete locks or change request IDs to bypass it. A crash can leave a `.publish` directory; reconcile unknown delivery and confirm all writers stopped before manual recovery.
- `unsafe_acl` / `posix_acl_check_unavailable`: Mac ACL rejected or could not be checked. Do not remove ACLs automatically. Run `node scripts/doctor.mjs` from the installed plugin directory.
- `bridge_error` / `bridge_failed`: an unexpected exception was sanitized. Inspect local Host logs without publishing private paths or message text.
- `codex_invalid_response` / `codex_response_too_large`: configured CLI response is malformed or exceeds bounds; verify its version and trusted installation.

The diagnostic reports `scope: local_permissions` and `hostConnectivity: not_checked`: success does not prove the bridge is online. It does not test endpoint length/connectivity, repair permissions or resend messages. Host create/rename calls currently receive no cancellation signal; stopping the plugin or Worker does not prove those operations were cancelled. Windows CLI creation may have created a conversation even when the returned outcome is unknown; preserve the original ID and inspect it.
