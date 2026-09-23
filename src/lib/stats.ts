import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

interface CpuSample {
  idle: number;
  total: number;
}

function cpuAverage(): CpuSample {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) total += cpu.times[type as keyof typeof cpu.times];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

export function cpuPercentFromSamples(start: CpuSample, end: CpuSample): number {
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

function getCpuPercent(sampleMs = 150): Promise<number> {
  return new Promise((resolve) => {
    const start = cpuAverage();
    setTimeout(() => resolve(cpuPercentFromSamples(start, cpuAverage())), sampleMs);
  });
}

export function getMemoryStats() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  return {
    ramPercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
    ramUsedGB: Math.round((usedBytes / 1024 ** 3) * 10) / 10,
    ramTotalGB: Math.round((totalBytes / 1024 ** 3) * 10) / 10,
  };
}

// Unidade onde o projeto roda -- e onde o usuario mais instala jogo grande,
// entao e o disco mais util de mostrar (nao da pra saber qual e "o disco
// de jogos" sem perguntar, isso aqui e a melhor aproximacao sem config).
const DISK_PATH = process.cwd().slice(0, 3);

export async function getDiskStats() {
  const stats = await fs.promises.statfs(DISK_PATH);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  const usedBytes = totalBytes - freeBytes;
  return {
    diskPercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
    diskFreeGB: Math.round((freeBytes / 1024 ** 3) * 10) / 10,
    diskTotalGB: Math.round((totalBytes / 1024 ** 3) * 10) / 10,
  };
}

// Le o mesmo snapshot que o plugin claude-hud escreve (config
// display.externalUsageWritePath) -- e o % real do limite de 5h da conta,
// nao uma estimativa por token. Mesma fonte usada em claude-usage-tray.
const CLAUDE_FRESHNESS_MS = 15 * 60 * 1000;

export async function getClaudeSessionStats() {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const snapshotPath = path.join(claudeDir, 'cache', 'usage-snapshot.json');

  let raw: string;
  try {
    raw = await fs.promises.readFile(snapshotPath, 'utf8');
  } catch {
    return null;
  }

  try {
    const snapshot = JSON.parse(raw);
    const pct = snapshot?.five_hour?.used_percentage;
    if (typeof pct !== 'number') return null;

    const ageMs = Date.now() - new Date(snapshot.updated_at).getTime();
    const stale = !(ageMs >= 0 && ageMs <= CLAUDE_FRESHNESS_MS);
    const weeklyPct = snapshot?.seven_day?.used_percentage;
    return {
      claudePercent: Math.round(pct),
      claudeStale: stale,
      claudeWeeklyPercent: typeof weeklyPct === 'number' ? Math.round(weeklyPct) : null,
    };
  } catch {
    return null;
  }
}

export async function getStats() {
  const [cpuPercent, diskStats, claude] = await Promise.all([
    getCpuPercent(),
    getDiskStats(),
    getClaudeSessionStats(),
  ]);
  return { cpuPercent, ...getMemoryStats(), ...diskStats, claude };
}
