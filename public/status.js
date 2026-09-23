import { api } from './api.js';
import { state, STAT_KEYS, saveVisibleStats } from './state.js';

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const statsEl = document.getElementById('stats');

const STAT_LABELS = {
  cpu: 'CPU',
  ram: 'RAM',
  disk: 'Disco',
  claude5h: 'Claude 5h',
  claudeWeek: 'Claude semanal',
};

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

function statMini(label, pct, valueText, extraClass = '') {
  const el = document.createElement('div');
  el.className = `stat-mini ${statLevel(pct)} ${extraClass}`.trim();
  el.innerHTML = `
    <span class="stat-mini-label">${label}</span>
    <span class="stat-mini-bar"><span class="stat-mini-fill" style="width:${Math.min(pct, 100)}%"></span></span>
    <span class="stat-mini-val">${valueText}</span>
  `;
  return el;
}

function buildStatTiles(s) {
  const stale = s.claude?.claudeStale ? ' (antigo)' : '';
  return {
    cpu: statMini('CPU', s.cpuPercent, `${s.cpuPercent}%`),
    ram: statMini('RAM', s.ramPercent, `${s.ramUsedGB}/${s.ramTotalGB}GB`),
    disk: statMini('DISCO', s.diskPercent, `${s.diskFreeGB}GB livre`, 'disk'),
    claude5h: s.claude
      ? statMini('CLAUDE 5H', s.claude.claudePercent, `${s.claude.claudePercent}%${stale}`, 'claude')
      : null,
    claudeWeek:
      s.claude && s.claude.claudeWeeklyPercent !== null
        ? statMini('CLAUDE SEM', s.claude.claudeWeeklyPercent, `${s.claude.claudeWeeklyPercent}%${stale}`, 'claude')
        : null,
  };
}

function renderStats(s) {
  const tiles = buildStatTiles(s);
  statsEl.querySelectorAll('.stat-mini').forEach((el) => el.remove());
  for (const key of STAT_KEYS) {
    if (state.visibleStats.has(key) && tiles[key]) {
      statsEl.insertBefore(tiles[key], statsEl.querySelector('.stats-config'));
    }
  }
}

export async function pollStats() {
  try {
    const s = await api('/stats');
    lastStats = s;
    renderStats(s);
  } catch {
    statsEl.querySelectorAll('.stat-mini').forEach((el) => el.remove());
  }
}

function initStatsConfig() {
  const btn = document.createElement('button');
  btn.className = 'stats-config';
  btn.type = 'button';
  btn.title = 'Escolher o que mostrar';
  btn.setAttribute('aria-label', 'Escolher o que mostrar');
  btn.textContent = '⚙';

  const panel = document.createElement('div');
  panel.className = 'stats-config-panel';
  panel.hidden = true;
  for (const key of STAT_KEYS) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.visibleStats.has(key);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.visibleStats.add(key);
      else state.visibleStats.delete(key);
      saveVisibleStats(state.visibleStats);
      if (lastStats) renderStats(lastStats);
    });
    label.appendChild(checkbox);
    label.append(` ${STAT_LABELS[key]}`);
    panel.appendChild(label);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true;
  });

  statsEl.appendChild(btn);
  statsEl.appendChild(panel);
}

initStatsConfig();
