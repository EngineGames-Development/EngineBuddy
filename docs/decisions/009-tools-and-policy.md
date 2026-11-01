# 009 — Tools and PolicyEngine (Phase 1, step 7)

Date: 2026-11-01

## What exists now

| File | Role |
|---|---|
| `src/core/tools/tool-def.ts` | `ToolDef`, `ToolRegistry`, `Permission`, `PolicyContext` |
| `src/tools/system/get-system-info.ts` | SAFE: CPU model + load, RAM, free space per drive, uptime |
| `src/tools/applications/open-in-vscode.ts` | SAFE: open an existing file/folder in VS Code |
| `src/security/policy/paths.ts` | Path normalisation + the secret-path denylist |
| `src/security/policy/policy-engine.ts` | The policy table: our tools, built-ins, default deny |
| `src/security/audit/audit-log.ts` | `userData/logs/audit-YYYY-MM-DD.jsonl`, redacted, 30-day retention |
| `src/security/tool-runner.ts` | validate → policy → execute → audit, for our own tools |

## Phase 1 policy table

| Request | Decision |
|---|---|
| `get_system_info` | SAFE |
| `open_in_vscode(path)` | SAFE; BLOCKED for secret paths; the path must exist |
| Read, Glob inside a project root | SAFE |
| Read, Glob elsewhere | CONFIRM → denied (no confirmation window until Phase 2) |
| Read of `.env*`, even in a project | CONFIRM → denied |
| Secret paths (SECURITY.md §4), UNC / `\\?\` / device paths, alternate data streams, unknown `%VARS%` | BLOCKED |
| Glob patterns that are absolute or contain `..` | BLOCKED |
| Bash, PowerShell, Write, Edit, MultiEdit, NotebookEdit, WebFetch, WebSearch | CONFIRM → denied |
| Grep, anything unknown, unregistered `mcp__enginebuddy__*`, other MCP servers | BLOCKED |
| Our tools with invalid or extra input keys | BLOCKED |

Every "no" carries a friendly reason ("I can't run commands yet…"), which the agent passes on.

## Decisions

1. **`ToolDef` lives in `core`**, so `security` (decides) and `tools` (implements) share it without
   importing each other (ARCHITECTURE.md §10 forbids both directions).
2. **Tests that combine layers live in `test/security/`**, outside the layer rules.
3. **No `systeminformation` dependency.** `node:os` covers CPU and RAM; CPU load is measured over
   400 ms from `os.cpus()` times (`os.loadavg()` is always 0 on Windows); `fs.statfs` gives free
   space per drive, with a 600 ms timeout per drive so a sleeping network share can't stall it.
   One less dependency with filesystem access.
4. **VS Code is launched as `Code.exe` with `execFile`**, found from `code.cmd` on PATH. Node won't
   run `.cmd` files without a shell (CVE-2024-27980), and a shell is exactly what we avoid.
   `ELECTRON_RUN_AS_NODE` is removed from its environment.
5. **The denylist is stricter than SECURITY.md §4 in two ways:** whole browser profile folders are
   blocked (not just Login Data/Cookies/Web Data/Local State), and it adds `~/.gnupg`,
   `~/.pypirc`, `~/.claude.json`, the Windows Vault, and `.p12`/`.ppk` keys.
6. **Grep is BLOCKED in Phase 1.** It reads contents across a folder, so it could pull a `.env`
   file into the conversation even though reading `.env` directly needs a confirmation. Read and
   Glob cover the slice. Phase 2 can add our own grep that skips secret files.
7. **CONFIRM is never "allowed" in Phase 1**: the decision says CONFIRM (so the audit log shows
   what *would* have been asked), but `allowed` is false.
8. **The runner re-checks policy** even when the Claude Code gates already did, so menu intents
   and any future path to a tool go through the same check.
9. **`ToolDef.describe()` (for confirmations) is deferred to Phase 2**, together with the
   confirmation window. Phase 1 has `activity()` for the activity list.

## Verified

`npm run check`: 49 new tests.
- Policy table: allows, CONFIRM-denials and BLOCKs for every row above.
- Denylist positive cases (12), tricks (traversal, mixed case + forward slashes, a junction into
  `.ssh`, an 8.3 short name, UNC, `\\?\`, an ADS, an unknown variable) and negative cases
  (`.sshfoo`, a `.pem` inside a project).
- Tool input validation (missing, empty, wrong type, extra keys).
- Runner: real `get_system_info`, VS Code launch with the path as one argument (fake launcher),
  a missing path, a denial (audited, not executed), a throwing tool.
- Audit log: redaction, daily file, pruning after 30 days.
