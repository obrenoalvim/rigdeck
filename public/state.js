function loadCollapsedFolders() {
  try {
    return new Set(JSON.parse(localStorage.getItem('rigdeck-collapsed-folders') || '[]'));
  } catch {
    return new Set();
  }
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
};
