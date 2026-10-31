// Spike 0b: verify the Claude Agent SDK assumptions in ARCHITECTURE.md §6.
// Throwaway. Usage: node spike.mjs [testName...]   (no args = all tests)
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SANDBOX = path.join(HERE, 'sandbox');
const FIXTURES = path.join(HERE, 'fixtures');
const CLAUDE = process.env.CLAUDE_EXE ?? path.join(os.homedir(), '.local', 'bin', 'claude.exe');
fs.mkdirSync(SANDBOX, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });
fs.writeFileSync(path.join(SANDBOX, 'package.json'), JSON.stringify({ name: 'spike-sandbox-pkg', version: '0.0.1' }, null, 2));

// ---- the one in-process tool --------------------------------------------------
let toolExecutions = 0;
const getSystemInfo = tool(
  'get_system_info',
  'Returns CPU, memory and uptime of the computer.',
  {},
  async () => {
    toolExecutions++;
    const info = {
      cpu: os.cpus()[0]?.model, cores: os.cpus().length,
      memUsedGB: +((os.totalmem() - os.freemem()) / 2 ** 30).toFixed(1),
      memTotalGB: +(os.totalmem() / 2 ** 30).toFixed(1),
      uptimeH: +(os.uptime() / 3600).toFixed(1),
    };
    return { content: [{ type: 'text', text: JSON.stringify(info) }] };
  },
);

// ---- policy: the thing both gates consult -------------------------------------
const SAFE = new Set(['mcp__enginebuddy__get_system_info', 'Read', 'Glob', 'Grep']);
const policy = (name) => (SAFE.has(name) ? 'allow' : 'deny');

function makeGates(log, { canUseToolDenies = true, hookDenies = true } = {}) {
  return {
    canUseTool: async (name, input) => {
      const d = policy(name);
      log.canUseTool.push({ name, input, decision: canUseToolDenies ? d : 'allow' });
      return d === 'allow' || !canUseToolDenies
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: `EngineBuddy policy: ${name} is blocked.` };
    },
    hooks: {
      PreToolUse: [{
        hooks: [async (input) => {
          const d = policy(input.tool_name);
          log.preToolUse.push({ name: input.tool_name, decision: hookDenies ? d : 'none' });
          if (hookDenies && d === 'deny') {
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'EngineBuddy policy (hook).' } };
          }
          return {};
        }],
      }],
    },
  };
}

// No-billing guard: never hand Claude Code an API key, and refuse any session that
// would bill per request instead of running on the claude.ai subscription.
const BILLING_ENV = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|ANTHROPIC_BASE_URL)$/;
const subscriptionOnlyEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !BILLING_ENV.test(k)));

async function run(name, prompt, { gates = {}, resume, abortAfterFirstDelta = false, interruptAfterFirstDelta = false, maxTurns = 4 } = {}) {
  const log = { canUseTool: [], preToolUse: [] };
  const abortController = new AbortController();
  const messages = [];
  const t0 = performance.now();
  let initMs = null, model = null, firstDeltaMs = null, deltas = 0, text = '', sessionId = null, result = null, error = null;
  const toolUses = [];
  let tInterrupt = null, interruptAckMs = null, deltasAfterInterrupt = 0;
  try {
    const q = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: CLAUDE,
        cwd: SANDBOX,
        env: subscriptionOnlyEnv,
        settingSources: [],
        strictMcpConfig: true,
        tools: ['Read', 'Glob', 'Grep', 'Bash'],
        ...(process.env.SPIKE_MODEL ? { model: process.env.SPIKE_MODEL } : {}),
        includePartialMessages: true,
        mcpServers: { enginebuddy: createSdkMcpServer({ name: 'enginebuddy', version: '0.0.1', tools: [getSystemInfo], alwaysLoad: true }) },
        maxTurns,
        abortController,
        ...(resume ? { resume } : {}),
        ...makeGates(log, gates),
      },
    });
    for await (const m of q) {
      messages.push(m);
      if (m.session_id) sessionId = m.session_id;
      if (m.type === 'system' && m.subtype === 'init') { initMs = Math.round(performance.now() - t0); model = m.model;
        if (m.apiKeySource !== 'none') { abortController.abort(); throw new Error(`Refusing: billed auth source ${m.apiKeySource}`); } }
      if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
        deltas++;
        if (tInterrupt !== null) deltasAfterInterrupt++;
        if (firstDeltaMs === null) {
          firstDeltaMs = Math.round(performance.now() - t0);
          if (abortAfterFirstDelta) abortController.abort();
          if (interruptAfterFirstDelta) { tInterrupt = performance.now(); q.interrupt().then(() => { interruptAckMs = Math.round(performance.now() - tInterrupt); }); }
        }
      }
      if (m.type === 'assistant') {
        for (const b of m.message.content) {
          if (b.type === 'text') text += b.text;
          if (b.type === 'tool_use') toolUses.push(b.name);
        }
      }
      if (m.type === 'result') result = { subtype: m.subtype, cost: m.total_cost_usd, turns: m.num_turns };
    }
  } catch (e) {
    error = String(e?.message ?? e).slice(0, 300);
  }
  const totalMs = Math.round(performance.now() - t0);
  fs.writeFileSync(path.join(FIXTURES, `${name}.json`), JSON.stringify(messages, null, 1));
  const summary = { name, interruptAckMs, deltasAfterInterrupt, model, initMs, firstDeltaMs, totalMs, deltas, toolUses, gates: log, sessionId, result, error, text: text.slice(0, 300), messageTypes: [...new Set(messages.map((m) => m.type + (m.subtype ? ':' + m.subtype : '')))] };
  console.log(JSON.stringify(summary, null, 1));
  return summary;
}

// ---- tests --------------------------------------------------------------------
const marker = path.join(SANDBOX, 'bash-ran.txt');
const tests = {
  async mcp_tool() {
    const before = toolExecutions;
    const s = await run('mcp_tool', 'Use the get_system_info tool, then tell me my RAM usage in one short sentence.');
    return { pass: toolExecutions > before && s.deltas > 0, executions: toolExecutions - before };
  },
  async builtin_read() {
    const s = await run('builtin_read', 'Use the Read tool to read package.json in the current directory and tell me the package name only.');
    return { pass: s.toolUses.includes('Read'), canUseToolSawRead: s.gates.canUseTool.some((c) => c.name === 'Read'), hookSawRead: s.gates.preToolUse.some((c) => c.name === 'Read') };
  },
  async bash_deny_both() {
    fs.rmSync(marker, { force: true });
    const s = await run('bash_deny_both', 'Run this exact command with the Bash tool: echo hi > bash-ran.txt', { maxTurns: 3 });
    return { pass: !fs.existsSync(marker), attempted: s.toolUses.includes('Bash'), canUseTool: s.gates.canUseTool, hook: s.gates.preToolUse };
  },
  async bash_deny_canusetool_only() {
    fs.rmSync(marker, { force: true });
    const s = await run('bash_deny_canusetool_only', 'Run this exact command with the Bash tool: echo hi > bash-ran.txt', { maxTurns: 3, gates: { hookDenies: false } });
    return { pass: !fs.existsSync(marker), attempted: s.toolUses.includes('Bash'), canUseToolFired: s.gates.canUseTool.length };
  },
  async bash_deny_hook_only() {
    fs.rmSync(marker, { force: true });
    const s = await run('bash_deny_hook_only', 'Run this exact command with the Bash tool: echo hi > bash-ran.txt', { maxTurns: 3, gates: { canUseToolDenies: false } });
    return { pass: !fs.existsSync(marker), attempted: s.toolUses.includes('Bash'), hookFired: s.gates.preToolUse.length };
  },
  async resume() {
    const a = await run('resume_1', 'Remember the codeword PLUM-42 for later. Reply with just OK.', { maxTurns: 1 });
    const b = await run('resume_2', 'What was the codeword? Reply with just the codeword.', { resume: a.sessionId, maxTurns: 1 });
    return { pass: /PLUM-42/i.test(b.text), answer: b.text };
  },
  async abort() {
    const s = await run('abort', 'Write a 600-word essay about linker scripts.', { abortAfterFirstDelta: true, maxTurns: 1 });
    return { pass: s.firstDeltaMs !== null && s.totalMs - s.firstDeltaMs < 3000, afterAbortMs: s.firstDeltaMs === null ? null : s.totalMs - s.firstDeltaMs, error: s.error, deltas: s.deltas };
  },
};

tests.interrupt = async () => {
  const s = await run('interrupt', 'Write a 600-word essay about linker scripts.', { interruptAfterFirstDelta: true, maxTurns: 1 });
  return { pass: s.firstDeltaMs !== null && s.totalMs - s.firstDeltaMs < 3000, afterInterruptMs: s.firstDeltaMs === null ? null : s.totalMs - s.firstDeltaMs, ackMs: s.interruptAckMs, deltasAfter: s.deltasAfterInterrupt, result: s.result?.subtype, error: s.error };
};

const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(tests);
const results = {};
for (const t of selected) {
  console.log(`\n===== ${t} =====`);
  try { results[t] = await tests[t](); } catch (e) { results[t] = { pass: false, crash: String(e) }; }
}
console.log('\n===== RESULTS =====\n' + JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 1));
