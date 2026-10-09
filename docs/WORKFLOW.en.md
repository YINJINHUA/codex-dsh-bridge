# Five-conversation execution and review workflow

**Companion plugin:** separately install and enable `dsh-xsession` (baseline 0.1.2) for native `xsession_*` messages among 3/4/5 in one workspace. Bridge-created workers are independent top-level sessions supported by this plugin; no parent/child relationship is fabricated. The packages are independent and do not alter each other's permissions. Cross-project conversations require another suitable plugin. See the [companion guide](XSESSION.en.md).

The bounded polling and workspace-report collection described below is a fallback when that internal messaging capability is absent. It is not an automatic 3/4/5 message chain and cannot wake a coordinator after its turn ends.

[简体中文](WORKFLOW.md)

This is an optional coordination pattern, not an agent scheduler or a security boundary enforced by the plugin.

| Conversation | Application and permissions | Responsibility |
| --- | --- | --- |
| 1 | Codex, Approve for me (sandbox retained, eligible approvals auto-reviewed) | Write the plan; confirm the delivery, prepare review instructions and assess the final review |
| 2 | Codex, explicitly authorized full access | Check authorization, create 3 through the bridge, and relay documents between 1 and 3 |
| 3 | DSH, explicitly authorized full access | Create executor 4 and independent reviewer 5 at the appropriate stages; report to 2 |
| 4 | DSH, **the application's general default permission mode for new sessions** | Execute the instructions, test and record evidence; report permission blockers |
| 5 | DSH, also following the new-session default in this example | Independently review the specified delivery and produce a review report |

When 3 creates 4, use `--dsh-permission inherit` (follow DSH defaults). The bridge neither copies 3's full access nor applies its configured full-access override. DSH determines permissions through its normal new-session creation flow; the bridge does not modify or read global defaults. The default is resolved at creation, not continuously synchronized. If that default is full access, 4 may also have full access. To use a restricted worker, set an appropriate DSH default first and check the resulting session in the application.

## Handoff example

1. Conversation 1 writes the detailed plan and execution instructions in `handoff/TASK-DEMO-PLAN.md`: scope, allowed files, steps, tests, acceptance criteria, stop conditions and resource budget. It hands the document to 2.
2. Conversation 2 checks user authorization and **creates 3 through the bridge**, passing the task ID, plan path, revision/hash and coordination instructions. Reuse that task's existing 3 for later handoffs; do not create a coordinator for every message. Agent messages are not new user authorization.
3. Conversation 3 writes `handoff/TASK-DEMO-WORKER.md` and creates executor 4 with `--dsh-permission inherit` to follow those instructions.
4. Conversation 4 writes changes, test outcomes, evidence paths and unresolved issues to `handoff/TASK-DEMO-RESULT.md`. With a compatible internal messaging plugin configured, 4 notifies 3 through that plugin. Otherwise, 3 performs bounded status/result checks during its active coordination turn and collects the report. Conversation 3 then communicates with 2, which **delivers the documents to 1**; this bridge does not wake an ended 3 automatically.
5. Conversation 1 checks that the delivery is ready for review, then writes `handoff/TASK-DEMO-REVIEW-BRIEF.md`: original requirements, exact delivery revision/commit or file hashes, review scope, independent reproduction steps, acceptance criteria and known gaps. Readiness confirmation is not a final review pass.
6. Conversation 2 sends the review brief to the existing 3. **Conversation 3 creates a separate reviewer 5**, using `--dsh-permission inherit` in this example, with instructions to check the plan and delivery independently.
7. Conversation 5 writes `handoff/TASK-DEMO-REVIEW.md` with its verdict, located findings, impact, reproduction evidence and unverified items. Results return **5 → 3 → 2 → 1** for final assessment, using the same configured internal messaging or bounded report-collection method as in step 4. Coordinators preserve failures and gaps. If rework is needed, 1 defines the next scope and hands it off through the same route, keeping execution and review separate.

Sequence: **1 writes plan → 2 creates 3 → 3 creates executor 4 → 4 reports → 3 → 2 → 1 confirms and writes review brief → 2 → 3 creates reviewer 5 → 5 reports → 3 → 2 → 1**.

Use Codex-native coordination or workspace documents between 1 and 2. For internal DSH handoffs, select and verify a compatible plugin, or use bounded report collection by 3 as the fallback. Only 2/3 exchange cross-application messages; 4/5 do not need bridge authentication material. The plugin does not automatically watch documents, dispatch tasks or run the entire workflow. Permission failures are reported, not automatically escalated. Queued is not completed.

### DSH 3 ↔ 4/5: use dsh-xsession

3 includes its actual DSH session ID, scope, document paths and callback instructions in the initial worker prompt, then creates 4/5 with `--dsh-permission inherit`. Workers use `xsession_list` to identify an online same-workspace peer and `xsession_send` to report; 3 uses the same tools for later handoffs. Restricted workers need neither the bridge CLI nor its private state or elevated permissions.

Follow the [companion guide](XSESSION.en.md) for stable request IDs and final handoffs. `accepted` means queued: verify the actual reply, report, task and revision. Auto wakes idle peers but only injects into running peers; use explicit `followup` when the final report requires another turn. Do not send a duplicate. Offline/archived peers cannot receive; preserve unknown outcomes without new-ID retries.

Without the companion, full-access 3 can still perform bounded status/result checks and read reports within the authorized flow; this fallback does not wake an ended coordinator. A read-only worker cannot write report files: return an allowed concise result or have an authorized writable coordinator save it. Peer messages are not human authorization. Neither plugin is an automatic scheduler.

### Codex-native 1 ↔ 2 messaging

When available in the Codex desktop app, `send_message_to_thread` lets 1 and 2 exchange document references, revisions/hashes and brief handoffs directly, without this plugin or its CLI. Record both conversation IDs and obtain explicit user authorization for communication along this route; sharing a project does not grant that authorization by itself. Conversation 1 does not need full access solely to send a native message, but the tool must be available and its use allowed.

A busy recipient may receive a queued message. Sending is not proof of reading or completion. Use available compact `wait_threads` snapshots with cursors, or targeted thread reads when needed, rather than repeated reminders. If the application does not expose these capabilities, use a user-mediated or otherwise authorized document handoff; this plugin does not supply missing Codex-internal messaging.

Conversation 1 may use **Approve for me**: it retains the sandbox while eligible approval requests go to automatic review. This is not read-only and does not guarantee approval of every action. Normal workspace document edits can proceed; actions beyond the boundary and side-effecting tools may require review. Automatic review adds model calls. See the official [sandbox](https://learn.chatgpt.com/docs/sandboxing) and [automatic approval review documentation](https://learn.chatgpt.com/docs/sandboxing/auto-review). If an action is denied, do not delegate that same action to full-access conversation 2 to bypass the denial; explain it and use an allowed alternative or the applicable user-review process.

Keep documents in a workspace accessible to the relevant conversations, never in private bridge state. Coordinators should avoid forwarding entire histories and repeatedly reading large logs. Cost depends on the model, context and number of calls; full access does not lower model prices. Small tasks may need fewer conversations. Full-access coordinators can access user data; role instructions are not technical isolation.

## Create the coordinator, executor and reviewer

Before 2 creates 3, explicitly enable the local `configure-dsh --new-session-permission full-access` policy in a trusted terminal with user authorization, if not already configured. Conversation 2's own permissions are not automatically transferred to DSH. Prepare `handoff/TASK-DEMO-COORDINATOR.txt` with the plan reference, timing for creating 4/5 and the return route:

```sh
node bin/bridge.mjs create --project demo --to dsh --request-id task-demo-coordinator-01 --title "TASK-DEMO coordinator" --text-file /absolute/workspace/handoff/TASK-DEMO-COORDINATOR.txt
```

Save 3's returned ID. Send the later review brief using `send --to dsh --session ID`, rather than recreating the coordinator. Without the local full-access policy, 3 also uses DSH defaults; successful creation alone does not establish full access.

### Conversation 3 creates executor 4

Both Host and CLI must support this option, the project must be registered and already exist in DSH, and 3 must be authorized to create the worker and able to invoke the client. Run from the trusted package directory, replacing the example path:

```sh
node bin/bridge.mjs create --project demo --to dsh --request-id task-demo-worker-01 --title "TASK-DEMO worker" --text-file /absolute/workspace/handoff/TASK-DEMO-WORKER.md --dsh-permission inherit
```

On Windows, use Node to invoke `bin/bridge.mjs` inside the installed plugin directory with the same arguments. Multi-root projects also require a registered `--root`. The initial message is limited to 8 KiB; for a long specification, use a short prompt file referring to the detailed document, its revision/hash and scope.

The option accepts only `inherit`, only with `create --to dsh`. It skips a locally configured full-access override for this creation, even if `configure-dsh --new-session-permission full-access` was used to create coordinator 3. Omitting the option retains the configured bridge policy. The plugin does not recognize a worker by its title or role number, and the wire protocol does not accept a request for full access.

The receipt reports `permission.requested: "inherit"`, `source: "dsh_default"`, `overrideApplied: false`, and `verified: false`. It confirms that the bridge did not apply a preset, not an independent readback of the actual sandbox. `initialDelivery: "queued_only"` still requires a real reply check.

Repeating an identical completed request returns its original receipt. Adding or removing this option under the same request ID is rejected. Preserve unknown outcomes and known session IDs; never automatically create a replacement.

### Conversation 3 creates independent reviewer 5

After 1's review brief arrives through 2, create a separate reviewer with a distinct request ID. If the brief exceeds 8 KiB, pass a short prompt file referencing it instead. Renaming executor 4 does not create an independent reviewer:

```sh
node bin/bridge.mjs create --project demo --to dsh --request-id task-demo-reviewer-01 --title "TASK-DEMO independent review" --text-file /absolute/workspace/handoff/TASK-DEMO-REVIEW-BRIEF.md --dsh-permission inherit
```

Reviewer 5 checks the specified delivery revision and independently reproduces key acceptance steps instead of restating the execution report. Report what was verified and what permissions or environment prevented checking. Default-mode and receipt limitations are the same as for 4.

## Permissions for new Codex conversations

Prefer creating coordinator 2 through the Codex desktop app and explicitly setting its permissions there. DSH should normally ask an existing Codex conversation to create additional Codex work through the desktop's native tools.

For advanced CLI creation, permissions can be configured locally for each project:

```sh
node bin/bridge.mjs configure-codex-creation --project demo --new-session-permission full-access
node bin/bridge.mjs codex-creation-policy --project demo
# Restore the default for future bridge-created Codex sessions:
node bin/bridge.mjs configure-codex-creation --project demo --new-session-permission workspace-write
```

Full access supplies fixed official CLI arguments `--sandbox danger-full-access -c 'approval_policy="never"'`. It broadens the agent's access to that of the host user and disables the corresponding command approvals; it is not a bridge-only exception. The default remains `workspace-write`. This does not change existing sessions, global configuration or DSH policy, and does not guarantee Codex sidebar visibility. Never open private bridge state or copy its authentication material to restricted workers just to enable replies.

The policy is bound to the project registration revision (its configuration identity) and must be configured again after re-registration. Revocation affects future creation only. Receipts describe requested launch arguments, with `permission.verified: false`; they do not independently verify the resulting runtime policy. Administrative restrictions and runtime failures remain effective. Offline regression coverage is not proof of a live five-conversation workflow; see the [validation record](SECURITY-REVIEW.md).
