// A turn that runs one of our tools directly, without the model: for menu actions whose input is
// already known (a folder you picked). It goes through the same ToolRunner (policy + audit) and
// produces the same events as a model turn, so the bubble and avatar react the same way.
import type { LocalTurn } from '../../core/agent/agent-controller';
import { LinePicker } from '../../core/personality/personality';
import type { ToolRegistry } from '../../core/tools/tool-def';
import type { ToolRunner } from '../../security/tool-runner';

const lines = new LinePicker();

export function localToolTurn(
  registry: ToolRegistry,
  runner: ToolRunner,
  name: string,
  input: unknown,
  doneText: (summary: string) => string = (summary) => `Done. ${summary}.`,
): LocalTurn {
  return async function* ({ turnId, signal }) {
    const tool = registry.get(name);
    const parsed = tool?.input.safeParse(input);
    const callId = `local-${turnId}`;
    yield { type: 'narration', text: lines.pick(tool?.category ?? 'default') };
    yield {
      type: 'tool_start',
      callId,
      tool: name,
      category: tool?.category ?? 'system',
      description: tool && parsed?.success ? tool.activity(parsed.data) : name,
    };
    const out = await runner.run(name, input, { turnId, signal });
    const ok = out.result?.ok === true;
    const summary = out.result?.summary ?? out.decision.reason;
    yield { type: 'tool_result', callId, success: ok, summary };
    yield { type: 'message', text: ok ? doneText(summary) : `That didn't work: ${summary}` };
  };
}
