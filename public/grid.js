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

// Fonte web (Chakra Petch/JetBrains Mono) troca a fallback por ela mesma
// depois do primeiro paint -- o reflow disso pode fazer o scroll-snap
// "corrigir" o scrollLeft pra um valor pequeno e errado (~15px), vazando
// uns pixels da pagina 2 na borda da pagina 1. So corrige se o desvio for
// pequeno (deriva, nao navegacao real -- pagina 2 fica bem mais longe).
document.fonts?.ready?.then(() => {
  if (grid.scrollLeft > 0 && grid.scrollLeft < 100) grid.scrollLeft = 0;
});

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

// Sobe um nivel no path do disco (\\ ou /, tanto faz o SO). Usado so pra
// navegar "voltar" dentro de uma pasta do disco -- nao ha registro em
// presets.json pras subpastas, entao nao da pra pegar parentId como nos
// itens normais.
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
  btn.onclick = async () => {
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
        // Capa oficial da loja Steam via CDN publico -- so precisa do appid,
        // que ja vem embutido no target (steam://rungameid/{appid}), sem
        // depender de pasta de instalacao local nem chave de API.
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

    // Ultimo recurso antes do monograma: busca por nome na Steam Store (sem
    // chave) e cacheia local -- cobre jogo instalado por outro launcher (ex:
    // Epic) que tambem existe na Steam, ou exe sem icone embutido no binario.
    // Exclusivo de verdade (nunca esteve na Steam) ainda cai no monograma.
    // SO pra jogo: nunca dispara pra passo tipo "url" (site) nem pra preset
    // sem nenhum passo de "abrir" (ex: botao so de tecla/som) -- senao
    // busca "GitHub" ou "Tela Cheia (F11)" na loja Steam e arrisca pegar um
    // icone de jogo qualquer sem relacao nenhuma com o preset.
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
        // Site: favicon falhou -> monograma direto, sem busca de jogo.
        const img = makeIcon(source, () => {
          iconWrap.textContent = monogram;
          iconWrap.classList.add('fallback');
        });
        iconWrap.appendChild(img);
      } else {
        // "let" (nao "const") de proposito: o callback de erro roda async
        // (evento de rede), bem depois dessa atribuicao terminar -- por isso
        // "img" ja esta setado quando o onerror dispara e da pra remover o
        // <img> quebrado antes de tentar o fallback online. Sem isso os dois
        // ficavam lado a lado no wrapper (flex), embolando o icone quebrado
        // com o que carregou certo em vez de substituir.
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

  // Fontes web (Chakra Petch/JetBrains Mono) carregam depois do primeiro
  // paint -- o reflow que isso causa as vezes faz o scroll-snap "corrigir"
  // sozinho pra um scrollLeft fora de 0, deixando a pagina 2 vazar uns
  // pixels na borda da pagina 1. Trava explicito na pagina 1 apos montar.
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

// Le a resposta como NDJSON (uma linha por step, mais uma linha final
// "done") em vez de esperar o JSON completo -- em preset com varios steps
// mostra o progresso passo a passo em vez de deixar o usuario sem feedback
// nenhum ate o ultimo step terminar.
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
          // Preset de 1 step so (o caso mais comum, ex: abrir 1 programa)
          // fica igual a antes -- so mostra progresso quando ha o que
          // progredir de verdade.
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
