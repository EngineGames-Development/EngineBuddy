// get_system_info (SAFE): CPU model and load, RAM, free space per drive, uptime. Read-only.
// Uses only node:os and node:fs: no extra dependency, nothing spawned.
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { z } from 'zod';
import type { ToolDef } from '../../core/tools/tool-def';

const LOAD_SAMPLE_MS = 400;
const DRIVE_TIMEOUT_MS = 600;
const GB = 1024 ** 3;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** CPU busy % across all cores over a short window (os.loadavg() is always 0 on Windows). */
async function cpuLoad(signal: AbortSignal): Promise<number> {
  const snap = () =>
    os.cpus().reduce(
      (acc, c) => {
        const t = c.times;
        acc.idle += t.idle;
        acc.total += t.user + t.nice + t.sys + t.irq + t.idle;
        return acc;
      },
      { idle: 0, total: 0 },
    );
  const a = snap();
  await new Promise((r) => {
    const timer = setTimeout(r, LOAD_SAMPLE_MS);
    signal.addEventListener('abort', () => (clearTimeout(timer), r(undefined)), { once: true });
  });
  const b = snap();
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 100) : 0;
}

export interface DriveInfo {
  drive: string;
  freeGB: number;
  totalGB: number;
}

/** Local drives C: … Z:. A drive that doesn't answer quickly (e.g. a sleeping network share) is skipped. */
async function drives(): Promise<DriveInfo[]> {
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const results = await Promise.all(
    letters.map(async (l) => {
      const timeout = new Promise<undefined>((r) => setTimeout(r, DRIVE_TIMEOUT_MS, undefined));
      const info = statfs(`${l}:\\`).then(
        (s) => ({
          drive: `${l}:`,
          freeGB: round1((s.bavail * s.bsize) / GB),
          totalGB: round1((s.blocks * s.bsize) / GB),
        }),
        () => undefined,
      );
      return Promise.race([info, timeout]);
    }),
  );
  return results.filter((d): d is DriveInfo => d !== undefined && d.totalGB > 0);
}

export const getSystemInfo: ToolDef = {
  name: 'get_system_info',
  category: 'system',
  description:
    "Read this computer's current state: CPU model and load (%), RAM used/total (GB), free/total space per drive (GB), and uptime (hours). Read-only.",
  input: z.object({}),
  permission: () => ({ permission: 'SAFE' }),
  activity: () => 'Reading system info',

  async execute(_input, signal) {
    const [load, disks] = await Promise.all([cpuLoad(signal), drives()]);
    const cpus = os.cpus();
    const usedGB = round1((os.totalmem() - os.freemem()) / GB);
    const totalGB = round1(os.totalmem() / GB);
    const data = {
      cpu: { model: cpus[0]?.model.trim() ?? 'unknown', cores: cpus.length, loadPercent: load },
      memory: { usedGB, totalGB },
      drives: disks,
      uptimeHours: round1(os.uptime() / 3600),
    };
    const c = disks.find((d) => d.drive === 'C:');
    return {
      ok: true,
      summary: `CPU ${load}%, RAM ${usedGB}/${totalGB} GB${c ? `, C: ${Math.round(c.freeGB)} GB free` : ''}`,
      data,
    };
  },
};
