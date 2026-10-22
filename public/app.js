import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { renderGrid } from './grid.js';
import { renderPresetList, renderProgramsList, renderObsScenesList, newForm } from './editor.js';
import { pingStatus, checkVersion, pollStats } from './status.js';
import { wireMediaBar } from './media-bar.js';
import { pollActiveWindow } from './autoswitch.js';
import { pollNowPlaying } from './now-playing.js';
import './context-menu.js';

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
  api('/obs/scenes').then((scenes) => {
    state.obsScenes = scenes;
    renderObsScenesList();
  }).catch(() => {});
}

document.addEventListener('deck:refresh', () => {
  loadAll().catch((e) => showToast(`Erro atualizando: ${e.message}`, false));
});

loadAll().catch((e) => showToast(`Erro carregando: ${e.message}`, false));
wireMediaBar();

const polls = [
  [pingStatus, 15000],
  [pollStats, 5000],
  [checkVersion, 10000],
  [pollActiveWindow, 4000],
  [pollNowPlaying, 6000],
];
let pollTimers = [];
function setPolling(on) {
  pollTimers.forEach(clearInterval);
  pollTimers = on ? polls.map(([fn, ms]) => (fn(), setInterval(fn, ms))) : [];
}
setPolling(document.visibilityState === 'visible');
document.addEventListener('visibilitychange', () => setPolling(document.visibilityState === 'visible'));

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

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    await navigator.wakeLock.request('screen');
  } catch {
  }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

const nosleepVideo = document.getElementById('nosleep-video');
function playNosleepVideo() {
  nosleepVideo.play().catch(() => {});
}
playNosleepVideo();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') playNosleepVideo();
});
