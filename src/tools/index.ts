import { ToolRegistry } from '../core/tools/tool-def';
import { openApplication } from './applications/open-application';
import { openInVsCode } from './applications/open-in-vscode';
import { createFileTools } from './files/file-edits';
import { createMemoryTools, type MemoryStore } from './memory/memory';
import { getSystemInfo } from './system/get-system-info';
import { createRunCommand, type RunCommandOptions } from './terminal/run-command';

export interface ToolOptions extends RunCommandOptions {
  /** Without a store, there are no memory tools. */
  memory?: MemoryStore;
}

/** Every tool EngineBuddy has: SAFE ones, plus run_command and the file edits, which ask you first. */
export function createToolRegistry(opts: ToolOptions): ToolRegistry {
  return new ToolRegistry([
    getSystemInfo,
    openInVsCode,
    openApplication,
    createRunCommand(opts),
    ...createFileTools({ defaultCwd: opts.defaultCwd }),
    ...(opts.memory ? createMemoryTools(opts.memory) : []),
  ]);
}
