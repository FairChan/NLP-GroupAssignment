# Decisions

## Initial memory architecture

Decision:
- Use `.codex-memory/` markdown files as external Codex working memory.

Reason:
- Codex threads and agent sessions are stateless; files provide reloadable context across people, computers, and threads.

Alternatives considered:
- Chat history only, rejected because it does not synchronize reliably.
- Separate per-agent memory folders, rejected because duplicated sources drift.

Impact:
- Every Codex session must read memory files before work and update them before handoff.
