import { api } from './api.js';
import { state } from './state.js';

// Mesma logica de icone real do grid (grid.js buildTile) reduzida pra um
// unico target -- so cobre Steam (CDN publico) e .exe local (extrai do
// binario). Resto cai no fallback (monograma).
export function iconSrcFor(target) {
  if (!target) return null;
  const steamId = target.match(/^steam:\/\/rungameid\/(\d+)/i);
  if (steamId) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamId[1]}/header.jpg`;
  if (/\.exe$/i.test(target)) return `/api/icon?path=${encodeURIComponent(target)}`;
  return null;
}

// Sigla a partir do nome ("Counter-Strike 2" -> "CS2") -- quem usa digita a
// sigla que ja conhece, e substring pura no nome nao acha.
export function acronymOf(name) {
  return name
    .split(/[\s\-:]+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join('')
    .toUpperCase();
}

export function matchesQuery(name, query) {
  const q = query.toLowerCase();
  return name.toLowerCase().includes(q) || acronymOf(name).toLowerCase().includes(q);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Cria o modal, devolve {body, footer, close}. Resolve a promise do chamador
// com `finish(valor)`; Esc / clique fora / CANCELAR resolvem com null.
// Esc em fase de captura pra nao fechar o editor que esta por baixo.
function openModal(title, subtitle) {
  const overlay = el('div', 'picker-overlay');
  const box = el('div', 'picker-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title);
  const head = el('div', 'picker-head');
  head.append(el('div', 'picker-title', title), el('div', 'picker-sub', subtitle));
  const body = el('div', 'picker-body');
  const footer = el('div', 'picker-footer');
  box.append(head, body, footer);
  overlay.append(box);
  document.body.append(overlay);

  const opener = document.activeElement;
  let done;
  const result = new Promise((resolve) => (done = resolve));
  const finish = (value) => {
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    opener?.focus?.();
    done(value);
  };
  const onKey = (e) => {
    // com 2 modais empilhados (catalogo -> disco) so o de cima reage
    if (e.key !== 'Escape' || overlay !== [...document.querySelectorAll('.picker-overlay')].pop()) return;
    e.stopPropagation();
    finish(null);
  };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) finish(null);
  });
  // Setas navegam entre as linhas (busca <-> lista), sem precisar de mouse.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...box.querySelectorAll('.picker-row')];
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : i - 1;
    if (next < 0) box.querySelector('input')?.focus();
    else rows[next].focus();
  });
  return { head, body, footer, finish, result };
}

function makeIcon(name, target) {
  const wrap = el('div', 'picker-icon fallback', (acronymOf(name)[0] || name[0] || '?').toUpperCase());
  const src = iconSrcFor(target);
  if (!src) return wrap;
  // monograma ate o icone real chegar (extracao do .exe pode demorar);
  // se falhar, o monograma fica.
  const img = new Image();
  img.alt = '';
  img.loading = 'lazy';
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => img.remove();
  img.src = src;
  wrap.append(img); // no DOM desde ja: loading=lazy so carrega o que esta visivel
  return wrap;
}

const TABS = [
  ['all', 'TODOS', () => true],
  ['app', 'APPS', (p) => p.source === 'App' && p.category !== 'game'],
  ['game', 'JOGOS', (p) => p.category === 'game'],
  ['Steam', 'STEAM', (p) => p.source === 'Steam'],
  ['Epic', 'EPIC', (p) => p.source === 'Epic'],
];

// Escolhe programas do catalogo (Menu Iniciar, Steam, Epic) com busca, abas
// e icones. multi=true marca varios e devolve uma lista; multi=false devolve
// 1 ao clicar. "PROCURAR NO DISCO" abre o navegador de arquivos pra .exe/.lnk
// que nao estao no catalogo. Devolve [] / null se cancelado.
export async function pickPrograms({ multi }) {
  const modal = openModal(
    multi ? 'Adicionar programas' : 'Escolher programa',
    multi ? 'Marque quantos quiser. Cada um vira um atalho.' : 'Clique num programa para usar.'
  );
  const picked = new Map();
  let tab = 'all';

  const tabsEl = el('div', 'picker-tabs');
  const search = el('input', 'picker-search');
  search.placeholder = '🔎 Buscar por nome ou sigla (ex: CS2)...';
  search.autocomplete = 'off';
  const list = el('div', 'picker-list');
  modal.body.append(tabsEl, search, list);

  const confirmBtn = el('button', 'btn-solid', 'ADICIONAR');
  const browseBtn = el('button', 'btn-ghost', '📂 PROCURAR NO DISCO');
  const cancelBtn = el('button', 'btn-ghost', 'CANCELAR');
  const spacer = el('span', 'picker-spacer');
  modal.footer.append(browseBtn, spacer, cancelBtn);
  if (multi) modal.footer.append(confirmBtn);

  const updateConfirm = () => {
    confirmBtn.textContent = picked.size ? `ADICIONAR (${picked.size})` : 'ADICIONAR';
    confirmBtn.disabled = picked.size === 0;
  };
  updateConfirm();

  const tabButtons = new Map();
  for (const [id, label, test] of TABS) {
    if (id !== 'all' && !state.programs.some(test)) continue;
    const btn = el('button', 'btn-ghost small picker-tab', label);
    btn.onclick = () => {
      tab = id;
      tabButtons.forEach((b, k) => b.classList.toggle('active', k === id));
      render();
    };
    tabButtons.set(id, btn);
    tabsEl.append(btn);
  }
  tabButtons.get('all').classList.add('active');

  function render() {
    list.innerHTML = '';
    const test = TABS.find(([id]) => id === tab)[2];
    const q = search.value.trim();
    const rows = state.programs.filter((p) => test(p) && (!q || matchesQuery(p.name, q)));
    if (!rows.length) {
      list.append(el('div', 'picker-empty', state.programs.length ? 'Nada encontrado.' : 'Nenhum programa carregado ainda.'));
      return;
    }
    for (const p of rows) {
      const row = el('div', 'picker-row' + (picked.has(p.target) ? ' selected' : ''));
      row.tabIndex = 0;
      const tag = p.source === 'App' ? (p.category === 'game' ? 'JOGO' : 'APP') : p.source.toUpperCase();
      row.append(makeIcon(p.name, p.target), el('span', 'picker-name', p.name), el('span', 'picker-tag', tag));
      const choose = () => {
        if (!multi) return modal.finish([p]);
        if (picked.has(p.target)) picked.delete(p.target);
        else picked.set(p.target, p);
        row.classList.toggle('selected', picked.has(p.target));
        updateConfirm();
      };
      row.onclick = choose;
      row.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      };
      list.append(row);
    }
  }

  search.oninput = render;
  // Enter na busca com um unico resultado = escolhe/marca ele (fluxo so-teclado).
  search.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const rows = list.querySelectorAll('.picker-row');
    if (rows.length === 1) rows[0].click();
    else if (multi && picked.size) confirmBtn.click();
  };
  confirmBtn.onclick = () => modal.finish([...picked.values()]);
  cancelBtn.onclick = () => modal.finish(null);
  browseBtn.onclick = async () => {
    const file = await browseDisk({ mode: 'file' });
    if (!file) return;
    const name = file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const processName = /\.exe$/i.test(file) ? name : '';
    modal.finish([{ name, target: file, processName, source: 'App' }]);
  };

  render();
  search.focus();
  return modal.result;
}

const LAST_DIR_KEY = 'rigdeck-last-browse-dir';
const FILE_EXT = /\.(exe|lnk|bat|cmd|url)$/i;

export function parentOf(p) {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (idx < 0) return null;
  // "C:" -> volta pra raiz "C:\"; acima do drive = lista de locais.
  return idx <= 2 && /^[A-Za-z]:$/.test(trimmed.slice(0, idx)) ? trimmed.slice(0, idx) + '\\' : trimmed.slice(0, idx) || null;
}

// Navegador de disco (roda no servidor, entao funciona do celular tambem).
// mode 'folder' -> devolve o caminho da pasta; 'file' -> caminho do arquivo.
export async function browseDisk({ mode, start }) {
  const isFolder = mode === 'folder';
  const modal = openModal(
    isFolder ? 'Escolher pasta do disco' : 'Procurar programa no disco',
    isFolder ? 'Entre na pasta e confirme.' : 'Clique num .exe ou atalho para escolher.'
  );
  const bar = el('div', 'picker-pathbar');
  const upBtn = el('button', 'btn-ghost small', '↑');
  upBtn.title = 'Pasta acima';
  upBtn.setAttribute('aria-label', 'Pasta acima');
  const pathInput = el('input', 'picker-path');
  pathInput.placeholder = 'Cole ou digite um caminho e aperte Enter';
  bar.append(upBtn, pathInput);
  const list = el('div', 'picker-list');
  modal.body.append(bar, list);

  const useBtn = el('button', 'btn-solid', 'ESCOLHER ESTA PASTA');
  const cancelBtn = el('button', 'btn-ghost', 'CANCELAR');
  modal.footer.append(el('span', 'picker-spacer'), cancelBtn);
  if (isFolder) modal.footer.append(useBtn);
  cancelBtn.onclick = () => modal.finish(null);

  let current = null;

  async function go(dir) {
    let entries;
    try {
      const res = dir ? await api(`/fs/list?path=${encodeURIComponent(dir)}`) : await api('/fs/roots');
      entries = res.entries;
    } catch {
      list.innerHTML = '';
      list.append(el('div', 'picker-empty', 'Pasta não encontrada ou sem acesso.'));
      return;
    }
    current = dir;
    pathInput.value = dir || '';
    upBtn.disabled = !dir;
    useBtn.disabled = !dir;
    if (dir) {
      try {
        localStorage.setItem(LAST_DIR_KEY, dir);
      } catch {
        // storage bloqueado: so nao lembra a ultima pasta
      }
    }
    list.innerHTML = '';
    const shown = entries.filter((e) => e.isDir || (!isFolder && FILE_EXT.test(e.name)));
    if (!shown.length) list.append(el('div', 'picker-empty', isFolder ? 'Sem subpastas aqui.' : 'Nenhuma pasta ou programa aqui.'));
    for (const e of shown) {
      const row = el('div', 'picker-row');
      row.tabIndex = 0;
      const icon = e.isDir ? el('div', 'picker-icon fallback', '📁') : makeIcon(e.name, e.path);
      row.append(icon, el('span', 'picker-name', e.name));
      const open = () => (e.isDir ? go(e.path) : modal.finish(e.path));
      row.onclick = open;
      row.onkeydown = (ev) => {
        if (ev.key === 'Enter') open();
      };
      list.append(row);
    }
  }

  upBtn.onclick = () => go(current ? parentOf(current) : null);
  useBtn.onclick = () => current && modal.finish(current);
  pathInput.onkeydown = (e) => {
    if (e.key === 'Enter') go(pathInput.value.trim() || null);
  };

  let first = start || null;
  if (!first) {
    try {
      first = localStorage.getItem(LAST_DIR_KEY);
    } catch {
      first = null;
    }
  }
  go(first).then(() => {
    // pasta lembrada sumiu -> cai na lista de locais em vez de tela vazia
    if (first && current === null && !list.querySelector('.picker-row')) go(null);
  });
  return modal.result;
}
