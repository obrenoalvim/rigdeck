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

// Extraida a parte pura pra dar pra testar o limite de "antigo" sem
// depender do relogio real nem de um snapshot.json presente no disco.
export function isSnapshotStale(updatedAtMs: number, nowMs: number): boolean {
  const ageMs = nowMs - updatedAtMs;
  return !(ageMs >= 0 && ageMs <= CLAUDE_FRESHNESS_MS);
}

// Client id publico do proprio Claude Code CLI (mesmo valor usado por
// projetos open source que reimplementam esse OAuth, ex. opencode-claude-auth).
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_OAUTH_USER_AGENT = 'claude-code/2.1';
// Mesma janela de rate limit da API de usage que o claude-hud respeita.
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

interface OAuthCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  [key: string]: unknown;
}

async function readCredentialsFile(claudeDir: string) {
  const credsPath = path.join(claudeDir, '.credentials.json');
  try {
    const raw = await fs.promises.readFile(credsPath, 'utf8');
    const data = JSON.parse(raw);
    const oauth = data?.claudeAiOauth as OAuthCreds | undefined;
    if (!oauth?.accessToken || !oauth?.refreshToken) return null;
    return { credsPath, data, oauth };
  } catch {
    return null;
  }
}

// Refresh token dura bem mais que o access token (horas) -- com isso o
// rigdeck renova sozinho e nao depende de o Claude Code ter rodado NESTA
// maquina pra manter o token vivo. Uso real (contagem do 5h/semanal) e por
// conta, entao o numero fica certo mesmo gerado 100% no notebook.
async function refreshOAuthToken(oauth: OAuthCreds): Promise<OAuthCreds | null> {
  try {
    const res = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': CLAUDE_OAUTH_USER_AGENT },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (typeof json.access_token !== 'string') return null;
    return {
      ...oauth,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || oauth.refreshToken,
      expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    };
  } catch {
    return null;
  }
}

async function writeCredentialsBack(credsPath: string, data: Record<string, unknown>, oauth: OAuthCreds) {
  try {
    data.claudeAiOauth = oauth;
    const tmp = `${credsPath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmp, credsPath);
  } catch {
    // falhou em persistir -- so significa que refaz o refresh na proxima chamada
  }
}

async function fetchUsageFromApi(accessToken: string) {
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': CLAUDE_OAUTH_USER_AGENT,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function usageCachePath(claudeDir: string) {
  return path.join(claudeDir, 'cache', 'rigdeck-usage-cache.json');
}

async function readUsageCache(claudeDir: string) {
  try {
    const raw = await fs.promises.readFile(usageCachePath(claudeDir), 'utf8');
    const cache = JSON.parse(raw);
    if (Date.now() - cache.fetchedAt < USAGE_CACHE_TTL_MS) return cache.result;
  } catch {
    // sem cache ou corrompido -- busca de novo
  }
  return null;
}

async function writeUsageCache(claudeDir: string, result: unknown) {
  try {
    const cachePath = usageCachePath(claudeDir);
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.promises.writeFile(cachePath, JSON.stringify({ fetchedAt: Date.now(), result }), 'utf8');
  } catch {
    // cache e so otimizacao, nao impede o resto de funcionar
  }
}

async function fetchClaudeUsageViaOAuth(claudeDir: string) {
  const creds = await readCredentialsFile(claudeDir);
  if (!creds) return null;

  let oauth = creds.oauth;
  if (oauth.expiresAt <= Date.now() + 60_000) {
    const refreshed = await refreshOAuthToken(oauth);
    if (!refreshed) return null;
    oauth = refreshed;
    await writeCredentialsBack(creds.credsPath, creds.data, oauth);
  }

  const usage = await fetchUsageFromApi(oauth.accessToken);
  const pct = usage?.five_hour?.utilization;
  if (typeof pct !== 'number') return null;

  const weeklyPct = usage?.seven_day?.utilization;
  return {
    claudePercent: Math.round(pct),
    claudeStale: false,
    claudeWeeklyPercent: typeof weeklyPct === 'number' ? Math.round(weeklyPct) : null,
  };
}

// Le o snapshot que o plugin claude-hud escreve (config
// display.externalUsageWritePath) -- so usado como fallback de quem nao tem
// (ou nunca teve) .credentials.json utilizavel nesta maquina.
async function getClaudeSessionStatsFromSnapshot(claudeDir: string) {
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

    const weeklyPct = snapshot?.seven_day?.used_percentage;
    return {
      claudePercent: Math.round(pct),
      claudeStale: isSnapshotStale(new Date(snapshot.updated_at).getTime(), Date.now()),
      claudeWeeklyPercent: typeof weeklyPct === 'number' ? Math.round(weeklyPct) : null,
    };
  } catch {
    return null;
  }
}

export async function getClaudeSessionStats() {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

  const cached = await readUsageCache(claudeDir);
  if (cached) return cached;

  const result = await fetchClaudeUsageViaOAuth(claudeDir);
  if (result) {
    await writeUsageCache(claudeDir, result);
    return result;
  }

  return getClaudeSessionStatsFromSnapshot(claudeDir);
}

export async function getStats() {
  const [cpuPercent, diskStats, claude] = await Promise.all([
    getCpuPercent(),
    getDiskStats(),
    getClaudeSessionStats(),
  ]);
  return { cpuPercent, ...getMemoryStats(), ...diskStats, claude };
}
