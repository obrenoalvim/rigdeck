function loadCollapsedFolders() {
  try {
    return new Set(JSON.parse(localStorage.getItem('rigdeck-collapsed-folders') || '[]'));
  } catch {
    return new Set();
  }
}

export const STAT_KEYS = ['cpu', 'ram', 'disk', 'claude5h', 'claudeWeek'];

// Guarda os ESCONDIDOS (nao os visiveis). Whitelist de visiveis fazia tile
// novo (ex: claude5h) sumir pra sempre pra quem ja tinha salvo o array
// antigo -- nunca reaparecia, mesmo com o dado disponivel de novo.
function loadVisibleStats() {
  try {
    const hidden = JSON.parse(localStorage.getItem('rigdeck-hidden-stats'));
    if (Array.isArray(hidden)) return new Set(STAT_KEYS.filter((k) => !hidden.includes(k)));
  } catch {
    // ignora e cai no padrao
  }
  return new Set(STAT_KEYS);
}

export function saveVisibleStats(visible) {
  const hidden = STAT_KEYS.filter((k) => !visible.has(k));
  localStorage.setItem('rigdeck-hidden-stats', JSON.stringify(hidden));
}

export const state = {
  knownVersion: null,
  monitors: [],
  programs: [],
  programsByTarget: {},
  programsByProcessName: {},
  presets: [],
  obsScenes: [],
  editingId: null,
  steps: [],
  currentFolderId: null,
  currentFsPath: null,
  collapsedFolders: loadCollapsedFolders(),
  autoSwitched: false,
  visibleStats: loadVisibleStats(),
};
