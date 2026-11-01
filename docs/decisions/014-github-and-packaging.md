# 014 — Ready for GitHub, easy to run

Date: 2026-11-01

## What exists now

| Piece | Where |
|---|---|
| Windows installer + portable exe: `npm run dist` → `release/` | `electron-builder.yml` (electron-builder 26.17.0, pinned) |
| Electron fuses (audit F5) | `electron-builder.yml` → `electronFuses` |
| App icon, drawn in code | `scripts/make-icon.mjs` → `build/icon.png` (`npm run icon`) |
| CI on every push/PR (Windows): `npm run check` | `.github/workflows/ci.yml` |
| Release on tag `v*`: check, build, attach both exes to a GitHub Release | `.github/workflows/release.yml` |
| README for users (requirements, install, use, settings, safety) and developers | `README.md` |

## Decisions

1. **Two downloads**: an NSIS installer (per-user, no admin, shortcuts, uninstaller) and a
   portable exe. ~123 MB each.
2. **The SDK's bundled `claude.exe` (320 MB) is left out.** EngineBuddy always uses your installed
   Claude Code, which is also what holds your login. Installing Claude Code is a documented
   requirement.
3. **Fuses:** RunAsNode, NODE_OPTIONS and `--inspect`/`--inspect-brk` are off; embedded asar
   integrity and only-load-from-asar are on. `grantFileProtocolExtraPrivileges` stays on because
   our pages are bundled files loaded over `file://` (moving to a custom protocol would let us turn
   it off later).
4. **electron-builder 26.17.0, not the newest 26.18.x**: releases from the last two weeks are
   skipped on purpose (supply chain). 0 runtime vulnerabilities.
5. **No code signing.** SmartScreen warns; the README says what to do. Signing is for when others
   download it (audit R8).
6. **Releases come from CI, not from a local machine**, so a release is built from exactly what's
   in the tag, after `npm run check` passes. CI uses only GitHub's own actions plus the `gh` CLI;
   CI never sets `EB_INTEGRATION`, so it spends no Claude usage.
7. **Repo cleaned for publishing** (audit F7): local paths and the CPU name in the recorded
   transcripts are placeholders now; `spikes/` is removed as PHASE-1.md planned (results stay in
   decisions 001 and 002).
8. **MIT license** (your choice), in `LICENSE`.

## Verified

- `npm run dist` built both exes; `@electron/fuses read` on the built `EngineBuddy.exe` shows the
  fuse settings above.
- The packaged app (fuses on) started, greeted, and answered a real Claude question.
- `npm run check` passes with the scrubbed fixtures.
- A scan of every tracked file finds no personal paths, names or e-mail addresses. Commit
  metadata uses EngineGames-Development@web.de (audit F8, rewritten before the first push).

## Before you push

1. Commit author e-mail: every existing commit is by `LeanderGamer2@web.de`. It becomes public on
   push. If you'd rather not, say so before pushing (the history can be rewritten to GitHub's
   no-reply address, which changes every commit hash).
2. Create an empty repository on GitHub, then:
   `git remote add origin https://github.com/<you>/EngineBuddy.git` and `git push -u origin main`.
3. First release: set `"version"` in package.json, commit, `git tag v0.1.0`, `git push --tags`.
