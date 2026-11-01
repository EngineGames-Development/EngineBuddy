import { ToolRegistry } from '../core/tools/tool-def';
import { openInVsCode } from './applications/open-in-vscode';
import { getSystemInfo } from './system/get-system-info';

/** Every tool EngineBuddy has. Phase 1: two SAFE ones. */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry([getSystemInfo, openInVsCode]);
}
