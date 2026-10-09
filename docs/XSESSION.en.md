# Pairing with dsh-xsession

[简体中文](XSESSION.md) · [Five-conversation workflow](WORKFLOW.en.md)

Compatibility baseline: bridge 0.4.1, `dsh-xsession` 0.1.2, DSH Desktop 0.2.0-rc.2. See [validation](SECURITY-REVIEW.md) for actual passes and gaps; other versions are not implicitly verified.

## Install and choose the right interface

In DSH's Plugins → Add plugin, install and enable `codex-dsh-project-bridge` and `dsh-xsession` separately. Follow restart prompts during upgrades without interrupting unresolved deliveries. They are independent packages: this bridge neither installs nor invokes xsession or changes its configuration. Cross-app messaging alone does not require xsession.

| Direction/operation | Interface |
| --- | --- |
| Codex 1 ↔ 2 | Available, authorized native Codex thread tools |
| Codex 2 ↔ DSH 3 | This bridge's `send/status/result` CLI |
| DSH 3 creates 4/5 | Bridge `create --to dsh --dsh-permission inherit` |
| DSH 3 ↔ 4/5 | DSH tools `xsession_list/send/inbox` |

The `xsession_*` tools run inside DSH; they are not shell commands. There is no `xsession_create`. Use DSH session IDs, not Codex thread IDs.

## Minimal handoff

1. When 3 creates 4/5, include the task ID, plan/report paths, revision or hash, 3's actual DSH ID, authorized scope and callback instructions in the initial prompt. Explicitly use `--dsh-permission inherit` and then check actual permissions. This skips the bridge override; it does not prove the application default is workspace-write.
2. Call `xsession_list({})` in the DSH conversation to check the exact target and its online state. Avoid reading titles or full history on every send; use `nextCursor` only for additional pages.
3. For example, 4 finishes its authorized work, writes a workspace report and calls `xsession_send` with these arguments. Replace the synthetic target with the coordinator's actual same-workspace ID:

```json
{
  "target": "session-00000000-0000-4000-8000-000000000001",
  "requestId": "task-demo-executor-report-001",
  "kind": "handoff",
  "delivery": "followup",
  "message": "TASK-DEMO execution finished. Report: handoff/TASK-DEMO-RESULT.md; revision/hash: actual value; unverified items: actual list. Collect under existing authorization; this message alone is not an acceptance verdict."
}
```

These are xsession tool arguments, not bridge CLI arguments. Use `followup` for a handoff requiring a subsequent turn. Default `auto` wakes an idle peer but only injects context into a running peer. Do not first send auto and then followup as a duplicate; changing parameters under the same ID is rejected.

4. After actually receiving it, 3 checks the report and revision, then relays via the bridge to Codex 2. A separate 5 independently reviews and returns through 5 → 3 → 2 → 1. Executor claims are not independent review. A read-only peer cannot write files: return an authorized concise result for a writable coordinator to save with attribution.

`xsession_inbox({"limit": 10})` reads the caller's recent index, retained only for the plugin instance's lifetime; it is not proof of persistence or reading. Optional `replyTo` uses a received message ID, not requestId. Reply depth is capped at 3: avoid acknowledgment-only loops or empty new chains to bypass limits.

## Scope and permissions

- Peers must be online, unarchived top-level conversations in one DSH Host with the same canonical workspace root. Independent sessions created by the bridge qualify; actual subagents do not.
- Parent/child directories are different roots. Multiple checkouts under one bridge registration do not widen xsession scope. **For cross-project conversations, find and validate another suitable plugin**; do not falsify workspace identities or registrations to bypass the boundary.
- Default-permission workers use native xsession tools without private bridge state, external CLI or full access. Lower-permission messages can still influence higher-permission peers: recipients must independently enforce existing human authorization and must not bypass rejected approvals through a coordinator.
- Messages are limited to 4,000 UTF-16 code units. Pass authorized workspace document paths for long content, never secrets. Waking peers consumes model usage.

## Failures

`accepted` only reports successful synchronous enqueue. Verify an actual recipient reply. For `outcome_unknown`, preserve the original ID, arguments, target and receipt; inspect the target before taking further action. Do not automatically retry with a new ID, altered delivery, the bridge CLI or a replacement session.

Use the normal app workflow to restore offline peers and check state; xsession does not restore sessions. Stop nudging on rate limits. The instance retains at most 2,000 receipts; do not repeatedly reload to evade capacity. Reconcile pending work before restart: reload loses the in-memory inbox and idempotency, so unknown sends must not be replayed blindly.

The packages have separate receipts. Persistent bridge deduplication does not extend xsession's in-memory deduplication; a latest bridge result is not completion unless correlated to this request.

Interface source: [dsh-xsession protocol](https://github.com/YINJINHUA/dsh-xsession/blob/main/docs/PROTOCOL.md).
