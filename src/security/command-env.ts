// The environment approved commands (run_command) run with. Keys for cloud AI services and similar
// switches are left out, so a command can't print them into the conversation or quietly use a paid
// service (docs/security-audit.md, F4). ELECTRON_RUN_AS_NODE would turn any Electron app it starts
// into a plain Node runtime.
const STRIPPED =
  /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|ELECTRON_RUN_AS_NODE)$/i;

export function commandEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !STRIPPED.test(e[0])),
  );
}
