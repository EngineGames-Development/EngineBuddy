import { describe, expect, it } from 'vitest';
import { commandEnv } from './command-env';

describe('commandEnv', () => {
  it('keeps ordinary variables and drops AI keys and Node switches', () => {
    expect(
      commandEnv({
        PATH: 'C:/Windows',
        ANTHROPIC_API_KEY: 'x',
        openai_api_key: 'y',
        ELECTRON_RUN_AS_NODE: '1',
        EMPTY: undefined,
      }),
    ).toEqual({ PATH: 'C:/Windows' });
  });
});
