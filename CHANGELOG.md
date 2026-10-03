# Changelog

## 0.2.1 — 2026-10-04

- 明确区分超时未落地的宿主请求与普通忙碌，保留锁以避免重叠发送。
- socket 绑定期间同步收紧并恢复 umask，消除 chmod 前的宽松权限。
- CLI 与 socket 统一返回 unknown_project，内部错误仍保持脱敏。
- 补充对端身份、挂起恢复、回执清理边界及回归验证。

## 0.2.0 — 2026-10-04

- Add MIT license, communication architecture, threat model and upload checklist.
- Reject stale requests after project re-registration or directory replacement.
- Recheck registration after asynchronous membership reads; corrupt receipts fail closed.
- Apply absolute connection deadlines and terminate owned unresponsive CLI children.
- Refuse named pipes, symlink state ancestors, invalid Unicode and unsafe executables.
- Bound DSH summaries and transport responses; reject malformed success envelopes.
- Flush receipt directory updates and avoid stale temporary-file collisions.
- Keep optional bridge startup failure from taking down the DSH Host.
- Add regression tests and pinned, read-only GitHub Actions checks.

## 0.1.0 — initial local version

- Project-based routing without individual conversation registration.
- Unix socket DSH adapter; Codex read-only metadata and queue adapters.
- Chinese/English plugin descriptions; no third-party runtime dependencies.
