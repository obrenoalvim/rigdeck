import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { renderGrid } from './grid.js';
import { renderPresetList, renderProgramsList, newForm } from './editor.js';
import { pingStatus, checkVersion, pollStats } from './status.js';

async function loadAll() {
  state.monitors = await api('/monitors');
  state.presets = await api('/presets');
  renderGrid();
  renderPresetList();
  if (!state.editingId) newForm();
  api('/programs').then((list) => {
    state.programs = list;
    renderProgramsList();
  }).catch(() => {});
}

document.addEventListener('deck:refresh', () => {
  loadAll().catch((e) => showToast(`Erro atualizando: ${e.message}`, false));
});

loadAll().catch((e) => showToast(`Erro carregando: ${e.message}`, false));
pingStatus();
setInterval(pingStatus, 15000);
pollStats();
setInterval(pollStats, 5000);
checkVersion();
setInterval(checkVersion, 10000);
