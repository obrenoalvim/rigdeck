function loadCollapsedFolders() {
  try {
    return new Set(JSON.parse(localStorage.getItem('rigdeck-collapsed-folders') || '[]'));
  } catch {
    return new Set();
  }
}

export const STAT_KEYS = ['cpu', 'ram', 'disk', 'claude5h', 'claudeWeek'];

function loadVisibleStats() {
  try {
    const saved = JSON.parse(localStorage.getItem('rigdeck-visible-stats'));
    if (Array.isArray(saved)) return new Set(saved.filter((k) => STAT_KEYS.includes(k)));
  } catch {
    // ignora e cai no padrao
  }
  return new Set(STAT_KEYS);
}

export function saveVisibleStats(set) {
  localStorage.setItem('rigdeck-visible-stats', JSON.stringify([...set]));
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
