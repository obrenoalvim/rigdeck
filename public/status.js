import { api } from './api.js';
import { state, STAT_KEYS, saveVisibleStats } from './state.js';

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const statsEl = document.getElementById('stats');

let lastStats = null;

export async function pingStatus() {
  try {
    await api('/monitors');
    statusEl.className = 'status online';
    statusText.textContent = 'online';
  } catch {
    statusEl.className = 'status offline';
    statusText.textContent = 'offline';
  }
}

export async function checkVersion() {
  try {
    const { version } = await api('/version');
    if (state.knownVersion === null) {
      state.knownVersion = version;
    } else if (version !== state.knownVersion) {
      location.reload();
    }
  } catch {
    // servidor offline — deixa o pingStatus cuidar de avisar
  }
}

function statLevel(pct) {
  if (pct >= 90) return 'crit';
  if (pct >= 70) return 'warn';
  return 'ok';
}

function statMini(label, pct, valueText, extraClass = '', stale = false) {
  const el = document.createElement('div');
  const level = stale ? 'stale' : statLevel(pct);
  el.className = `stat-mini ${level} ${extraClass}`.trim();
  el.innerHTML = `
    <span class="stat-mini-label">${label}</span>
    <span class="stat-mini-bar"><span class="stat-mini-fill" style="width:${Math.min(pct, 100)}%"></span></span>
    <span class="stat-mini-val">${valueText}</span>
  `;
  return el;
}

function buildStatTiles(s) {
  const stale = !!s.claude?.claudeStale;
  return {
    cpu: statMini('CPU', s.cpuPercent, `${s.cpuPercent}%`),
    ram: statMini('RAM', s.ramPercent, `${s.ramUsedGB}/${s.ramTotalGB}GB`),
    disk: statMini('DISCO', s.diskPercent, `${s.diskFreeGB}GB livre`, 'disk'),
    claude5h: s.claude
      ? statMini('CLAUDE 5H', s.claude.claudePercent, `${s.claude.claudePercent}%`, 'claude', stale)
      : null,
    claudeWeek:
      s.claude && s.claude.claudeWeeklyPercent !== null
        ? statMini('CLAUDE SEM', s.claude.claudeWeeklyPercent, `${s.claude.claudeWeeklyPercent}%`, 'claude', stale)
        : null,
  };
}

function renderStats(s) {
  const tiles = buildStatTiles(s);
  statsEl.innerHTML = '';
  for (const key of STAT_KEYS) {
    if (state.visibleStats.has(key) && tiles[key]) statsEl.appendChild(tiles[key]);
  }
}

export async function pollStats() {
  try {
    const s = await api('/stats');
    lastStats = s;
    renderStats(s);
  } catch {
    statsEl.innerHTML = '';
  }
}

// checkboxes do que mostrar vivem no painel de CONFIG (mesma engrenagem
// dos presets) -- ver wireStatsVisibilityToggles em editor.js
export function refreshStatsDisplay() {
  if (lastStats) renderStats(lastStats);
}

// Usuario sem claude-hud nunca vai ter s.claude -- esconde os dois
// checkboxes de Claude no CONFIG em vez de deixar opcao morta na tela.
export function hasClaudeData() {
  return !!lastStats?.claude;
}
