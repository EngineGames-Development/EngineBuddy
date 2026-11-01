import { ToolRegistry } from '../core/tools/tool-def';
import { openApplication } from './applications/open-application';
import { openInVsCode } from './applications/open-in-vscode';
import { getSystemInfo } from './system/get-system-info';
import { createRunCommand, type RunCommandOptions } from './terminal/run-command';

/** Every tool EngineBuddy has: SAFE ones, plus run_command, which always asks you first. */
export function createToolRegistry(opts: RunCommandOptions): ToolRegistry {
  return new ToolRegistry([getSystemInfo, openInVsCode, openApplication, createRunCommand(opts)]);
}
