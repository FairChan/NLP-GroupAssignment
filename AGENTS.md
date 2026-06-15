# Project Instructions

<!-- BEGIN CODEX MEMORY SYNC -->
## Codex Memory Sync

Before code work:

1. Run or emulate `python scripts/memory_sync.py sync --project . --thread <thread-id>`.
2. Read only the new memory commits reported by the sync command.
3. If no cursor exists, read `.codex-memory/SUMMARY.md`, `.codex-memory/CURRENT_WORK.md`, and `.codex-memory/MEMORY_INDEX.md`.

Rules:

- Treat `.codex-memory/` as the external working memory.
- Do not rely on chat history as source of truth.
- Never overwrite a teammate's existing memory files during setup or import.
- Before editing files, check whether another active task owns or locks the same files.
- After memory changes, create a memory commit with `memory_sync.py commit`.
- Every memory commit must update `MEMORY_COMMITS.jsonl` and `MEMORY_COMMITS.md`.
- If memory grows too long, run `memory_sync.py compact` and commit the compacted summary.
- Update `HANDOFF.md` when another person, computer, day, or Codex thread may continue the work.

Every handoff must include what changed, why it changed, files touched, tests run, risks, and the next step.
<!-- END CODEX MEMORY SYNC -->
