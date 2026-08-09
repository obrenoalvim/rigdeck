import { api } from './api.js';
import { state } from './state.js';

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const statsEl = document.getElementById('stats');

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

function statMini(label, pct, valueText) {
  const el = document.createElement('div');
  el.className = `stat-mini ${statLevel(pct)}`;
  el.innerHTML = `
    <span class="stat-mini-label">${label}</span>
    <span class="stat-mini-bar"><span class="stat-mini-fill" style="width:${Math.min(pct, 100)}%"></span></span>
    <span class="stat-mini-val">${valueText}</span>
  `;
  return el;
}

export async function pollStats() {
  try {
    const s = await api('/stats');
    statsEl.innerHTML = '';
    statsEl.appendChild(statMini('CPU', s.cpuPercent, `${s.cpuPercent}%`));
    statsEl.appendChild(statMini('RAM', s.ramPercent, `${s.ramUsedGB}/${s.ramTotalGB}GB`));
    statsEl.appendChild(statMini('DISCO', s.diskPercent, `${s.diskFreeGB}GB livre`));
  } catch {
    statsEl.innerHTML = '';
  }
}
