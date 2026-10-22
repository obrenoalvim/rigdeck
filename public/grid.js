import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';

const grid = document.getElementById('grid');
const gridDots = document.getElementById('grid-dots');
const breadcrumbEl = document.getElementById('breadcrumb');

const TILE_PALETTE = ['#ff8a1e', '#3ecf8e', '#4ea1ff', '#ff5c8a', '#c792ea', '#ffd166', '#5ee6d0'];

function colorFor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_PALETTE[h % TILE_PALETTE.length];
}

const PAGE_SIZE = 4;

document.fonts?.ready?.then(() => {
  if (grid.scrollLeft > 0 && grid.scrollLeft < 100) grid.scrollLeft = 0;
});

function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function buildFolderTile(folder, i, childCount) {
  const btn = document.createElement('button');
  btn.className = 'tile folder';
  btn.dataset.presetId = folder.id;
  btn.style.setProperty('--i', i);
  btn.style.setProperty('--tile-accent', colorFor(folder.id || folder.name));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i + 1).padStart(2, '0');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap fallback';
  iconWrap.textContent = folder.icon || '📁';

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = `${folder.name} (${childCount})`;

  btn.append(idx, iconWrap, label);
  if (folder.pinned) btn.classList.add('pinned');
  btn.onclick = () => {
    haptic(15);
    state.currentFolderId = folder.id;
    state.autoSwitched = false; // navegacao manual sobrepoe a troca automatica de perfil
    renderGrid();
  };
  return btn;
}

function buildFsFolderTile(item, i) {
  const btn = document.createElement('button');
  btn.className = 'tile folder';
  btn.dataset.presetId = item.id;
  btn.style.setProperty('--i', i);
  btn.style.setProperty('--tile-accent', colorFor(item.id || item.name));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i + 1).padStart(2, '0');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap fallback';
  iconWrap.textContent = item.icon || '💾';

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = item.name;

  btn.append(idx, iconWrap, label);
  if (item.pinned) btn.classList.add('pinned');
  btn.onclick = () => {
    haptic(15);
    state.currentFolderId = item.id;
    state.currentFsPath = item.path;
    state.autoSwitched = false; // navegacao manual sobrepoe a troca automatica de perfil
    renderGrid();
  };
  return btn;
}

function parentPath(p) {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

function buildFsBackTile() {
  const btn = document.createElement('button');
  btn.className = 'tile back-tile';
  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap fallback';
  iconWrap.textContent = '←';
  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = 'VOLTAR';
  btn.append(iconWrap, label);
  btn.onclick = () => {
    haptic(15);
    const rootFolder = state.presets.find((p) => p.id === state.currentFolderId);
    if (rootFolder && state.currentFsPath === rootFolder.path) {
      state.currentFsPath = null;
      state.currentFolderId = rootFolder.parentId || null;
    } else {
      state.currentFsPath = parentPath(state.currentFsPath);
    }
    renderGrid();
  };
  return btn;
}

function buildFsDirTile(entry, i) {
  const btn = document.createElement('button');
  btn.className = 'tile folder';
  btn.style.setProperty('--i', i);
  btn.style.setProperty('--tile-accent', colorFor(entry.path));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i + 1).padStart(2, '0');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap fallback';
  iconWrap.textContent = '📁';

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = entry.name;

  btn.append(idx, iconWrap, label);
  btn.onclick = () => {
    haptic(15);
    state.currentFsPath = entry.path;
    renderGrid();
  };
  return btn;
}

function buildFsFileTile(entry, i) {
  const btn = document.createElement('button');
  btn.className = 'tile';
  btn.style.setProperty('--i', i);
  btn.style.setProperty('--tile-accent', colorFor(entry.path));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i + 1).padStart(2, '0');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap';
  const monogram = (entry.name || '?').trim().charAt(0).toUpperCase() || '?';
  const img = document.createElement('img');
  img.className = 'icon';
  img.alt = '';
  img.src = `/api/icon?path=${encodeURIComponent(entry.path)}`;
  img.onerror = () => {
    iconWrap.textContent = monogram;
    iconWrap.classList.add('fallback');
    img.remove();
  };
  iconWrap.appendChild(img);

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = entry.name;

  const fill = document.createElement('span');
  fill.className = 'press-fill';

  btn.append(idx, iconWrap, label, fill);

  let pressTimer = null;
  let longPressed = false;
  const startPress = () => {
    longPressed = false;
    btn.classList.add('pressing');
    pressTimer = setTimeout(() => {
      longPressed = true;
      btn.classList.remove('pressing');
      haptic([30, 40, 30]);
      killFsFileAction(entry.path, btn);
    }, 650);
  };
  const cancelPress = () => {
    clearTimeout(pressTimer);
    btn.classList.remove('pressing');
  };
  btn.addEventListener('mousedown', startPress);
  btn.addEventListener('touchstart', startPress, { passive: true });
  btn.addEventListener('mouseup', cancelPress);
  btn.addEventListener('mouseleave', cancelPress);
  btn.addEventListener('touchend', cancelPress);
  btn.addEventListener('touchmove', cancelPress);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  btn.onclick = async () => {
    if (longPressed) return;
    if (btn.classList.contains('loading')) return;
    haptic(20);
    btn.classList.add('firing', 'loading');
    setTimeout(() => btn.classList.remove('firing'), 200);
    try {
      await api(`/fs/open`, { method: 'POST', body: JSON.stringify({ path: entry.path }) });
      showToast('OK — aberto.');
    } catch (e) {
      showToast(`Erro abrindo: ${e.message}`, false);
    } finally {
      btn.classList.remove('loading');
    }
  };
  return btn;
}

async function killFsFileAction(filePath, btn) {
  btn.classList.add('killed');
  setTimeout(() => btn.classList.remove('killed'), 300);
  try {
    const result = await api(`/fs/kill`, { method: 'POST', body: JSON.stringify({ path: filePath }) });
    showToast(result.ok ? 'Encerrado.' : result.error || 'Nada rodando pra encerrar', result.ok);
  } catch (e) {
    showToast(`Erro encerrando: ${e.message}`, false);
  }
}

function buildBackTile() {
  const btn = document.createElement('button');
  btn.className = 'tile back-tile';
  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap fallback';
  iconWrap.textContent = '←';
  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = 'VOLTAR';
  btn.append(iconWrap, label);
  btn.onclick = () => {
    haptic(15);
    const current = state.presets.find((p) => p.id === state.currentFolderId);
    state.currentFolderId = current ? current.parentId || null : null;
    state.autoSwitched = false; // navegacao manual sobrepoe a troca automatica de perfil
    renderGrid();
  };
  return btn;
}

function buildTile(preset, i) {
  const btn = document.createElement('button');
  btn.className = 'tile';
  btn.dataset.presetId = preset.id;
  btn.style.setProperty('--i', i);
  btn.style.setProperty('--tile-accent', colorFor(preset.id || preset.name));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i + 1).padStart(2, '0');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap';
  const monogram = (preset.name || '?').trim().charAt(0).toUpperCase() || '?';
  if (preset.icon) {
    iconWrap.textContent = preset.icon;
    iconWrap.classList.add('fallback');
  } else {
    const iconSources = (preset.steps || [])
      .map((s) => {
        const t = s.target || '';
        const steamId = t.match(/^steam:\/\/rungameid\/(\d+)/i);
        if (steamId) return { type: 'steam', target: steamId[1] };
        if (/\.exe$/i.test(t)) return { type: 'exe', target: t };
        if (/^https?:\/\//i.test(t)) return { type: 'url', target: t };
        return null;
      })
      .filter(Boolean)
      .slice(0, 4);

    const makeIcon = (source, onFail) => {
      const img = document.createElement('img');
      img.className = 'icon';
      img.alt = '';
      if (source.type === 'steam') {
        img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${source.target}/header.jpg`;
        img.onerror = onFail;
      } else if (source.type === 'exe') {
        img.src = `/api/icon?path=${encodeURIComponent(source.target)}`;
        img.onerror = onFail;
      } else {
        let url;
        try {
          url = new URL(source.target);
        } catch {
          setTimeout(onFail, 0);
          return img;
        }
        img.src = `${url.origin}/favicon.ico`;
        img.onerror = () => {
          img.src = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(url.hostname)}`;
          img.onerror = onFail;
        };
      }
      return img;
    };

    const showOnlineFallback = () => {
      const primaryTarget = (preset.steps || [])[0]?.target || '';
      const img = document.createElement('img');
      img.className = 'icon';
      img.alt = '';
      img.src = `/api/icon/lookup?name=${encodeURIComponent(preset.name)}&target=${encodeURIComponent(primaryTarget)}`;
      img.onerror = () => {
        img.remove();
        iconWrap.textContent = monogram;
        iconWrap.classList.add('fallback');
      };
      iconWrap.appendChild(img);
    };
    const hasUnresolvedLaunchTarget = (preset.steps || []).some((s) => !!s.target);

    if (iconSources.length === 0) {
      if (hasUnresolvedLaunchTarget) {
        showOnlineFallback();
      } else {
        iconWrap.textContent = monogram;
        iconWrap.classList.add('fallback');
      }
    } else if (iconSources.length === 1) {
      const source = iconSources[0];
      if (source.type === 'url') {
        const img = makeIcon(source, () => {
          iconWrap.textContent = monogram;
          iconWrap.classList.add('fallback');
        });
        iconWrap.appendChild(img);
      } else {
        let img;
        img = makeIcon(source, () => {
          img.remove();
          showOnlineFallback();
        });
        iconWrap.appendChild(img);
      }
    } else {
      iconWrap.classList.add('multi');
      iconSources.forEach((s) => {
        const img = makeIcon(s, () => img.remove());
        iconWrap.appendChild(img);
      });
    }
  }

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = preset.name;

  const fill = document.createElement('span');
  fill.className = 'press-fill';

  btn.append(idx, iconWrap, label, fill);
  if (preset.pinned) btn.classList.add('pinned');

  let pressTimer = null;
  let longPressed = false;
  const startPress = () => {
    longPressed = false;
    btn.classList.add('pressing');
    pressTimer = setTimeout(() => {
      longPressed = true;
      btn.classList.remove('pressing');
      haptic([30, 40, 30]);
      killPresetAction(preset.id, btn);
    }, 650);
  };
  const cancelPress = () => {
    clearTimeout(pressTimer);
    btn.classList.remove('pressing');
  };
  btn.addEventListener('mousedown', startPress);
  btn.addEventListener('touchstart', startPress, { passive: true });
  btn.addEventListener('mouseup', cancelPress);
  btn.addEventListener('mouseleave', cancelPress);
  btn.addEventListener('touchend', cancelPress);
  btn.addEventListener('touchmove', cancelPress);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.onclick = () => {
    if (longPressed) return;
    haptic(20);
    runPreset(preset.id, btn);
  };
  return btn;
}

function paginate(tiles) {
  const pageCount = Math.ceil(tiles.length / PAGE_SIZE) || 1;

  for (let p = 0; p < pageCount; p++) {
    const page = document.createElement('div');
    page.className = 'grid-page';
    tiles.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE).forEach((tile) => page.appendChild(tile));
    grid.appendChild(page);
  }

  grid.scrollLeft = 0;

  if (pageCount > 1) {
    for (let p = 0; p < pageCount; p++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (p === 0 ? ' active' : '');
      gridDots.appendChild(dot);
    }
    grid.onscroll = () => {
      const page = Math.round(grid.scrollLeft / grid.clientWidth);
      [...gridDots.children].forEach((d, i) => d.classList.toggle('active', i === page));
    };
  } else {
    grid.onscroll = null;
  }
}

async function renderFsLevel() {
  const rootFolder = state.presets.find((p) => p.id === state.currentFolderId);
  breadcrumbEl.style.display = 'block';
  breadcrumbEl.textContent = `💾 ${rootFolder ? rootFolder.name : ''} / ${state.currentFsPath.split(/[\\/]/).pop()}`;

  let entries = [];
  try {
    const res = await api(`/fs/list?path=${encodeURIComponent(state.currentFsPath)}`);
    entries = res.entries;
  } catch (e) {
    showToast(`Erro lendo pasta: ${e.message}`, false);
  }

  const tiles = [buildFsBackTile(), ...entries.map((entry, i) => (entry.isDir ? buildFsDirTile(entry, i) : buildFsFileTile(entry, i)))];
  paginate(tiles);
}

export async function renderGrid() {
  grid.innerHTML = '';
  gridDots.innerHTML = '';

  if (state.currentFsPath) {
    await renderFsLevel();
    return;
  }

  const here = state.presets.filter((p) => (p.parentId || null) === state.currentFolderId);
  const currentFolder = state.currentFolderId ? state.presets.find((p) => p.id === state.currentFolderId) : null;

  breadcrumbEl.innerHTML = '';
  if (currentFolder) {
    breadcrumbEl.style.display = 'block';
    breadcrumbEl.textContent = `📁 ${currentFolder.name}`;
  } else {
    breadcrumbEl.style.display = 'none';
  }

  if (!here.length && !currentFolder) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'Nenhum preset ainda — clique em EDITAR pra criar o primeiro.';
    grid.appendChild(hint);
    return;
  }

  const ordered = [...here].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const tiles = ordered.map((item, i) => {
    if (item.kind === 'folder') return buildFolderTile(item, i, state.presets.filter((p) => p.parentId === item.id).length);
    if (item.kind === 'fs-folder') return buildFsFolderTile(item, i);
    return buildTile(item, i);
  });
  if (currentFolder) tiles.unshift(buildBackTile());

  paginate(tiles);
}

async function runPreset(id, btn) {
  if (btn.classList.contains('loading')) return;
  btn.classList.add('firing', 'loading');
  setTimeout(() => btn.classList.remove('firing'), 200);
  try {
    const res = await fetch(`/api/presets/${id}/run`, { method: 'POST' });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResults = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIndex;
      while ((nlIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nlIndex);
        buffer = buffer.slice(nlIndex + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'error') throw new Error(msg.error);
        if (msg.type === 'done') {
          finalResults = msg.results;
        } else if (msg.type === 'step' && msg.total > 1) {
          showToast(`Passo ${msg.index + 1}/${msg.total}: ${msg.ok ? 'OK' : 'FALHOU'} — ${msg.step}`, msg.ok);
        }
      }
    }

    const failed = (finalResults || []).filter((r) => !r.ok);
    showToast(
      failed.length ? `FALHOU: ${failed.map((f) => f.step + ' - ' + f.error).join('; ')}` : 'OK — disparado.',
      !failed.length
    );
  } catch (e) {
    showToast(`PC OFFLINE OU ERRO: ${e.message}`, false);
  } finally {
    btn.classList.remove('loading');
  }
}

async function killPresetAction(id, btn) {
  btn.classList.add('killed');
  setTimeout(() => btn.classList.remove('killed'), 300);
  try {
    const { results } = await api(`/presets/${id}/kill`, { method: 'POST' });
    const closed = results.filter((r) => r.ok).length;
    showToast(closed ? `Encerrado (${closed}/${results.length})` : 'Nada rodando pra encerrar', closed > 0);
  } catch (e) {
    showToast(`PC OFFLINE OU ERRO: ${e.message}`, false);
  }
}
