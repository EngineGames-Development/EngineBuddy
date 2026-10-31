// The layer rules in eslint.config.mjs are a security boundary (core must stay free of Electron
// and process spawning; renderers must stay sandboxed), so they get tests like any other code.
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function errorsFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? 'unknown');
}

describe('layer boundaries', () => {
  // The first lint loads the config and the TypeScript resolver, which can take several seconds
  // on a cold start. Do it once here, so the individual tests don't hit the 5 s default timeout.
  beforeAll(() => eslint.lintText('', { filePath: 'src/core/warmup.ts' }), 60_000);

  it('core may not import electron', async () => {
    expect(await errorsFor('src/core/probe.ts', "import { app } from 'electron';\nvoid app;\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('core may not spawn processes', async () => {
    expect(
      await errorsFor('src/core/probe.ts', "import { spawn } from 'node:child_process';\nvoid spawn;\n"),
    ).toContain('no-restricted-imports');
  });

  it('renderer may not use Node APIs', async () => {
    expect(await errorsFor('src/renderer/probe.ts', "import fs from 'node:fs';\nvoid fs;\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('core may not reach into main', async () => {
    expect(
      await errorsFor(
        'src/core/probe.ts',
        "import { createAvatarWindow } from '../main/windows/avatar-window';\nvoid createAvatarWindow;\n",
      ),
    ).toContain('import-x/no-restricted-paths');
  });

  it('renderer may not reach into main', async () => {
    expect(
      await errorsFor(
        'src/renderer/probe.ts',
        "import { createAvatarWindow } from '../main/windows/avatar-window';\nvoid createAvatarWindow;\n",
      ),
    ).toContain('import-x/no-restricted-paths');
  });

  it('allowed imports stay clean: renderer may import shared', async () => {
    expect(
      await errorsFor(
        'src/renderer/probe.ts',
        "import { AVATAR_STATES } from '../shared/avatar';\nvoid AVATAR_STATES;\n",
      ),
    ).toEqual([]);
  });

  it('allowed imports stay clean: main may import shared', async () => {
    expect(
      await errorsFor(
        'src/main/probe.ts',
        "import { AVATAR_STATES } from '../shared/avatar';\nvoid AVATAR_STATES;\n",
      ),
    ).toEqual([]);
  });
});
