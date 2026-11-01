# EngineBuddy

A desktop AI companion for developers: a small animated character that lives on your desktop,
talks like a friend, and uses Claude Code (on your claude.ai subscription) to actually help.

**Status:** Phase 1, step 3 of 11 (avatar window shell). See [ROADMAP.md](ROADMAP.md) and [docs/PHASE-1.md](docs/PHASE-1.md).

## Run it

Needs Node.js 22.18+ and Windows 11 (other platforms later).

```bash
npm install
```

If `npm run dev` complains that Electron failed to install, fetch its binary once:

```bash
node node_modules/electron/install.js
```

```bash
npm run dev
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` / `npm run preview` | Production build / run it |
| `npm run check` | Typecheck + lint + format check + tests (run before every commit) |
| `npm test` | Unit tests only |

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): how it's built, and why
- [SECURITY.md](SECURITY.md): the permission model
- [docs/decisions/](docs/decisions/): what each step found and decided
