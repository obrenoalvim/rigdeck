import { api } from './api.js';
import { state } from './state.js';
import { renderGrid } from './grid.js';

// Troca de perfil contextual: quando o processo em foreground no PC bate com
// o "processo (auto-troca)" de alguma pasta, o grid pula sozinho pra ela.
// Se o usuario navegar manualmente (grid.js zera state.autoSwitched), essa
// troca automatica para de "puxar" ate o processo em foco mudar de novo.
let lastProcess = undefined; // undefined = ainda nao rodou nenhuma vez

// Compara o "processo" salvo no preset (que pra jogos Steam costuma ser o
// installdir do manifesto, ex: "Counter-Strike Global Offensive", nao o
// nome real do processo) contra o nome exato E contra o caminho completo
// do exe em foco -- o installdir sempre aparece como pasta no caminho
// (...\steamapps\common\Counter-Strike Global Offensive\...\cs2.exe),
// entao a comparacao por substring cobre esse caso sem precisar saber o
// nome real do processo de cada jogo.
// triggerProcess pode ter varios processos separados por virgula (ex: jogo
// + launcher companion) -- basta UM bater pra pasta abrir sozinha.
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
    // o processo que disparou a troca nao esta mais em foco -- volta pra raiz
    state.currentFolderId = null;
    state.autoSwitched = false;
    renderGrid();
  }
}
