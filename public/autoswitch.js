import { api } from './api.js';
import { state } from './state.js';
import { renderGrid } from './grid.js';

let lastProcess = undefined; // undefined = ainda nao rodou nenhuma vez

function matchesTrigger(triggerList, processName, path) {
  return triggerList
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((t) => (processName && t === processName) || (path && path.toLowerCase().includes(t)));
}

export async function pollActiveWindow() {
  if (state.currentFsPath) return; // nao interrompe navegacao de arquivos

  let processName = null;
  let path = null;
  try {
    const res = await api('/active-window');
    processName = res.processName ? res.processName.toLowerCase() : null;
    path = res.path || null;
  } catch {
    return; // servidor offline -- deixa como esta, pingStatus ja avisa
  }

  const fingerprint = `${processName}|${path}`;
  if (fingerprint === lastProcess) return;
  lastProcess = fingerprint;

  const match = processName
    ? state.presets.find(
        (p) => p.kind === 'folder' && p.triggerProcess && matchesTrigger(p.triggerProcess, processName, path)
      )
    : null;

  if (match) {
    if (state.currentFolderId !== match.id) {
      state.currentFolderId = match.id;
      state.autoSwitched = true;
      renderGrid();
    }
  } else if (state.autoSwitched) {
    state.currentFolderId = null;
    state.autoSwitched = false;
    renderGrid();
  }
}
