import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { renderGrid } from './grid.js';
import { renderPresetList, renderProgramsList, newForm } from './editor.js';
import { pingStatus, checkVersion, pollStats } from './status.js';
import { wireMediaBar } from './media-bar.js';

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
wireMediaBar();

// Fullscreen API exige gesto do usuario -- nao da pra entrar sozinho ao
// carregar a pagina. iOS Safari nao suporta essa API (so "Adicionar a Tela
// de Inicio" tira a barra do navegador la); onde nao tem suporte o botao
// fica escondido (hidden no HTML) em vez de quebrado.
const fullscreenBtn = document.getElementById('toggle-fullscreen');
if (document.documentElement.requestFullscreen) {
  fullscreenBtn.hidden = false;
  fullscreenBtn.onclick = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => showToast('Não foi possível entrar em tela cheia.', false));
    }
  };
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
  });
}

// Mantem a tela ligada enquanto a aba estiver visivel -- e um painel de
// parede (celular/tablet/Echo Show), sem isso o SO apaga a tela depois de
// uns minutos parado mesmo com o app aberto. Solta sozinho quando a aba
// perde foco/minimiza, entao pede de novo ao voltar. Sem suporte (ex: iOS
// Safari) so nao faz nada -- nenhum botao, nenhum erro visivel.
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    await navigator.wakeLock.request('screen');
  } catch {
    // permissao negada, sem energia suficiente, etc -- nada a fazer
  }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

// Fallback pro Wake Lock API acima -- navegador embarcado tipo o do Echo
// Show pode reportar suporte e mesmo assim negar em silencio, ou nem ter a
// API. Video mudo em loop e o truque classico que segura a tela ligada em
// praticamente qualquer navegador (o SO trata playback ativo como "em uso"
// e nao apaga a tela) -- nao substitui o Wake Lock, roda junto.
const nosleepVideo = document.getElementById('nosleep-video');
function playNosleepVideo() {
  nosleepVideo.play().catch(() => {});
}
playNosleepVideo();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') playNosleepVideo();
});
