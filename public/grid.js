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

// navigator.vibrate so nao existe no iOS Safari (WebKit nunca implementou) --
// checa suporte, nunca deixa a ausencia quebrar o toque.
function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function buildFolderTile(folder, i, childCount) {
  const btn = document.createElement('button');
  btn.className = 'tile folder';
  btn.style.setProperty('--i', i);
  btn.style.setProperty('--tile-accent', colorFor(folder.id || folder.name));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i + 1).padStart(2, '0');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap fallback';
  iconWrap.textContent = '📁';

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = `${folder.name} (${childCount})`;

  btn.append(idx, iconWrap, label);
  if (folder.pinned) btn.classList.add('pinned');
  btn.onclick = () => {
    haptic(15);
    state.currentFolderId = folder.id;
    renderGrid();
  };
  return btn;
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
    renderGrid();
  };
  return btn;
}

function buildTile(preset, i) {
  const btn = document.createElement('button');
  btn.className = 'tile';
  btn.style.setProperty('--i', i);
  btn.style.setProperty('--tile-accent', colorFor(preset.id || preset.name));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i + 1).padStart(2, '0');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'icon-wrap';
  const monogram = (preset.name || '?').trim().charAt(0).toUpperCase() || '?';
  const iconSources = (preset.steps || [])
    .map((s) => {
      const t = s.target || '';
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
    if (source.type === 'exe') {
      img.src = `/api/icon?path=${encodeURIComponent(source.target)}`;
      img.onerror = onFail;
    } else {
      let url;
      try {
        url = new URL(source.target);
      } catch {
        // onFail so pode rodar depois que a atribuicao "const img = makeIcon(...)"
        // do chamador terminar -- callbacks tipo "() => img.remove()" ainda
        // nao tem "img" inicializado se chamados sincrono daqui dentro (TDZ).
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

  if (iconSources.length === 0) {
    iconWrap.textContent = monogram;
    iconWrap.classList.add('fallback');
  } else if (iconSources.length === 1) {
    const img = makeIcon(iconSources[0], () => {
      iconWrap.textContent = monogram;
      iconWrap.classList.add('fallback');
    });
    iconWrap.appendChild(img);
  } else {
    iconWrap.classList.add('multi');
    iconSources.forEach((s) => {
      const img = makeIcon(s, () => img.remove());
      iconWrap.appendChild(img);
    });
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

export function renderGrid() {
  grid.innerHTML = '';
  gridDots.innerHTML = '';

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
  const tiles = ordered.map((item, i) =>
    item.kind === 'folder'
      ? buildFolderTile(item, i, state.presets.filter((p) => p.parentId === item.id).length)
      : buildTile(item, i)
  );
  if (currentFolder) tiles.unshift(buildBackTile());

  const pageCount = Math.ceil(tiles.length / PAGE_SIZE) || 1;

  for (let p = 0; p < pageCount; p++) {
    const page = document.createElement('div');
    page.className = 'grid-page';
    tiles.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE).forEach((tile) => page.appendChild(tile));
    grid.appendChild(page);
  }

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

async function runPreset(id, btn) {
  if (btn.classList.contains('loading')) return;
  btn.classList.add('firing', 'loading');
  setTimeout(() => btn.classList.remove('firing'), 200);
  try {
    const { results } = await api(`/presets/${id}/run`, { method: 'POST' });
    const failed = results.filter((r) => !r.ok);
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
