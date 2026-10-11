import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { addProgramsFlow, addFsFolderFlow, openEditorFor, createMany } from './editor.js';

// Botao direito no deck: sobre um tile = acoes do preset; sobre o fundo =
// adicionar coisas na pasta aberta (mesmos fluxos do painel CONFIG).
let menuEl = null;

function refresh() {
  document.dispatchEvent(new CustomEvent('deck:refresh'));
}

function close() {
  menuEl?.remove();
  menuEl = null;
}

function itemsFor(tile) {
  const preset = tile && state.presets.find((p) => p.id === tile.dataset.presetId);
  if (!preset) {
    return [
      ['＋ Adicionar programas…', addProgramsFlow],
      ['📂 Adicionar pasta do disco…', addFsFolderFlow],
      ['📁 Nova pasta', newFolder],
      ['✎ Novo atalho (editor)', () => openEditorFor(null)],
    ];
  }
  const isFolder = preset.kind === 'folder';
  return [
    [isFolder ? '↳ Abrir' : '▶ Executar', () => tile.click()],
    ['✎ Editar…', () => openEditorFor(preset)],
    [preset.pinned ? '☆ Desafixar' : '★ Fixar na primeira página', () => api(`/presets/${preset.id}`, { method: 'PUT', body: JSON.stringify({ pinned: !preset.pinned }) }).then(refresh)],
    ['⧉ Duplicar', () => duplicate(preset)],
    'sep',
    [isFolder ? '🗑 Remover pasta (e o que tem dentro)' : '🗑 Remover', () => remove(preset), true],
  ];
}

function descendants(id) {
  const out = [];
  for (const p of state.presets) {
    if (p.parentId === id) out.push(p.id, ...descendants(p.id));
  }
  return out;
}

async function remove(preset) {
  const inside = preset.kind === 'folder' ? descendants(preset.id) : [];
  const extra = inside.length ? ` e ${inside.length} item(ns) dentro dela` : '';
  if (!confirm(`Remover "${preset.name}"${extra}?`)) return;
  for (const id of [...inside, preset.id]) await api(`/presets/${id}`, { method: 'DELETE' });
  if (state.currentFolderId === preset.id) state.currentFolderId = preset.parentId || null;
  refresh();
  showToast(`"${preset.name}" removido.`);
}

async function duplicate(preset) {
  // Pasta duplicada vira pasta vazia: copiar a arvore inteira nao e o que se espera de "duplicar".
  const { id: _id, ...copy } = preset;
  await createMany([{ ...copy, name: `${preset.name} (cópia)`, pinned: false }]);
}

async function newFolder() {
  await createMany([{ name: 'Nova pasta', kind: 'folder', steps: [] }]);
  // createMany dispara refresh assíncrono; depois abre o editor pra nomear a pasta
  setTimeout(() => {
    const folder = state.presets.find((p) => p.kind === 'folder' && p.name === 'Nova pasta' && (p.parentId || null) === state.currentFolderId);
    if (folder) openEditorFor(folder);
  }, 400);
}

function show(x, y, items) {
  close();
  menuEl = document.createElement('div');
  menuEl.className = 'ctx-menu';
  menuEl.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === 'sep') {
      menuEl.append(Object.assign(document.createElement('div'), { className: 'ctx-sep' }));
      continue;
    }
    const [label, run, danger] = item;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.className = 'ctx-item' + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.onclick = async () => {
      close();
      try {
        await run();
      } catch (e) {
        showToast(`Erro: ${e.message}`, false);
      }
    };
    menuEl.append(btn);
  }
  document.body.append(menuEl);
  // Mantém dentro da tela
  const { width, height } = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 4))}px`;
  menuEl.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 4))}px`;
  menuEl.querySelector('button')?.focus();
}

document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  // Painéis, modais e campos de texto mantêm o menu normal do navegador.
  if (t.closest('#editor, #audio-mixer, .picker-overlay, input, textarea, select, header, footer, #stats')) return;
  const tile = t.closest('.tile');
  // Tiles sem preset (voltar, navegação do disco) não têm ações próprias.
  if (tile && !tile.dataset.presetId) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  show(e.clientX, e.clientY, itemsFor(tile));
});

document.addEventListener('mousedown', (e) => {
  if (menuEl && !menuEl.contains(e.target)) close();
});
window.addEventListener('blur', close);
window.addEventListener('resize', close);
document.addEventListener('keydown', (e) => {
  if (!menuEl) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const btns = [...menuEl.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
  }
}, true);
