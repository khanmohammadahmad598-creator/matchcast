import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../core/logger';
import { realtime } from '../realtime/io';
import type { SystemStats } from '@matchcast/shared';

const execFileAsync = promisify(execFile);

let latest: SystemStats = emptyStats();
let lastCpu = cpuSnapshot();
let gpuCache: { at: number; value: SystemStats['gpu'] } = { at: 0, value: null };

interface CpuSnapshot {
  idle: number;
  total: number;
}

function cpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function emptyStats(): SystemStats {
  return {
    cpuPercent: 0,
    loadAverage: os.loadavg(),
    memTotalMb: Math.round(os.totalmem() / 1048576),
    memUsedMb: Math.round((os.totalmem() - os.freemem()) / 1048576),
    memPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    gpu: null,
    diskFreeMb: 0,
    uptimeSeconds: Math.round(os.uptime()),
    nodeHeapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    createdAt: new Date().toISOString(),
  };
}

async function diskFreeMb(): Promise<number> {
  try {
    const { stdout } = await execFileAsync('df', ['-k', '-P', process.cwd()]);
    const parts = stdout.trim().split('\n');
    const cols = (parts[1] ?? '').trim().split(/\s+/);
    return Math.round(Number(cols[3] ?? 0) / 1024);
  } catch {
    return 0;
  }
}

/** Best-effort NVIDIA GPU probe; returns null on machines without nvidia-smi. */
async function gpuStats(): Promise<SystemStats['gpu']> {
  const now = Date.now();
  if (now - gpuCache.at < 5000) return gpuCache.value;
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits',
    ], { timeout: 3000 });
    const [name, util, memUsed, memTotal] = (stdout.trim().split('\n')[0] ?? '').split(',').map((s) => s.trim());
    const value = {
      name: name || 'nvidia',
      utilPercent: Number(util) || 0,
      memUsedMb: Number(memUsed) || 0,
      memTotalMb: Number(memTotal) || 0,
    };
    gpuCache = { at: now, value };
    return value;
  } catch {
    gpuCache = { at: now, value: null };
    return null;
  }
}

async function sample(): Promise<SystemStats> {
  const now = cpuSnapshot();
  const totalDelta = now.total - lastCpu.total;
  const idleDelta = now.idle - lastCpu.idle;
  lastCpu = now;
  const cpuPercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;

  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();

  latest = {
    cpuPercent: Math.max(0, Math.min(100, cpuPercent)),
    loadAverage: os.loadavg().map((n) => Number(n.toFixed(2))),
    memTotalMb: Math.round(memTotal / 1048576),
    memUsedMb: Math.round(memUsed / 1048576),
    memPercent: Math.round((memUsed / memTotal) * 100),
    gpu: await gpuStats(),
    diskFreeMb: await diskFreeMb(),
    uptimeSeconds: Math.round(os.uptime()),
    nodeHeapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    createdAt: new Date().toISOString(),
  };
  return latest;
}

export function startStatsBroadcast(intervalMs = 2000): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      const stats = await sample();
      realtime.systemStats(stats);
    } catch (err) {
      logger.warn('system', 'Failed to sample system stats', { error: (err as Error).message });
    }
  }, intervalMs);
  timer.unref();
  void sample();
  return timer;
}

export function currentStats(): SystemStats {
  return latest;
}
