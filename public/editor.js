import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';

const programsList = document.getElementById('programs-list');
const editor = document.getElementById('editor');
const presetList = document.getElementById('preset-list');
const stepsEl = document.getElementById('steps');
const nameInput = document.getElementById('preset-name');
const formTitle = document.getElementById('form-title');
const itemTypeSelect = document.getElementById('item-type');
const itemParentSelect = document.getElementById('item-parent');

function refresh() {
  document.dispatchEvent(new CustomEvent('deck:refresh'));
}

export function renderProgramsList() {
  programsList.innerHTML = '';
  state.programsByTarget = {};
  for (const p of state.programs) {
    state.programsByTarget[p.target] = p;
    const opt = document.createElement('option');
    opt.value = p.target;
    if (p.source && p.source !== 'App') {
      opt.label = `${p.name} (${p.source})`;
    } else if (p.category === 'game') {
      opt.label = `${p.name} (Jogo)`;
    } else {
      opt.label = p.name;
    }
    programsList.appendChild(opt);
  }
}

// Pastas e seus itens ficam juntos, com indentação por nível -- lista
// crua em ordem de array (o formato antigo) intercalava pasta com
// filhos de outras pastas, exigindo ler "(em: X)" pra entender onde
// cada coisa estava.
function orderedPresetTree() {
  const rows = [];
  const addChildren = (parentId, depth) => {
    state.presets
      .filter((p) => (p.parentId || null) === parentId)
      .forEach((p) => {
        rows.push({ preset: p, depth });
        if (p.kind === 'folder') addChildren(p.id, depth + 1);
      });
  };
  addChildren(null, 0);
  return rows;
}

export function renderPresetList() {
  presetList.innerHTML = '';
  for (const { preset, depth } of orderedPresetTree()) {
    const row = document.createElement('div');
    row.className = 'preset-row' + (preset.kind === 'folder' ? ' is-folder' : '');
    row.dataset.id = preset.id;
    row.dataset.parentId = preset.parentId || '';
    row.style.marginLeft = `${depth * 22}px`;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Segurar e arrastar pra reordenar';

    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = (preset.kind === 'folder' ? '📁 ' : '') + preset.name;
    const upBtn = document.createElement('button');
    upBtn.className = 'icon-btn';
    upBtn.title = 'Mover pra cima';
    upBtn.textContent = '▲';
    upBtn.onclick = async () => {
      await api(`/presets/${preset.id}/move`, { method: 'POST', body: JSON.stringify({ direction: 'up' }) });
      refresh();
    };
    const downBtn = document.createElement('button');
    downBtn.className = 'icon-btn';
    downBtn.title = 'Mover pra baixo';
    downBtn.textContent = '▼';
    downBtn.onclick = async () => {
      await api(`/presets/${preset.id}/move`, { method: 'POST', body: JSON.stringify({ direction: 'down' }) });
      refresh();
    };
    const pinBtn = document.createElement('button');
    pinBtn.className = 'icon-btn pin-btn' + (preset.pinned ? ' active' : '');
    pinBtn.title = 'Fixar na primeira página';
    pinBtn.textContent = preset.pinned ? '★' : '☆';
    pinBtn.onclick = async () => {
      await api(`/presets/${preset.id}`, { method: 'PUT', body: JSON.stringify({ pinned: !preset.pinned }) });
      refresh();
    };
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-ghost small';
    editBtn.textContent = 'EDITAR';
    editBtn.onclick = () => loadIntoForm(preset);
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '×';
    delBtn.onclick = async () => {
      const children = state.presets.filter((p) => p.parentId === preset.id);
      const warning = children.length
        ? `Apagar a pasta "${preset.name}"? Os ${children.length} itens dentro dela voltam pra raiz (não são apagados).`
        : `Apagar "${preset.name}"?`;
      if (!confirm(warning)) return;
      for (const child of children) {
        await api(`/presets/${child.id}`, { method: 'PUT', body: JSON.stringify({ parentId: null }) });
      }
      await api(`/presets/${preset.id}`, { method: 'DELETE' });
      refresh();
    };
    row.append(handle, upBtn, downBtn, pinBtn, label, editBtn, delBtn);
    presetList.appendChild(row);
  }
  wireDragReorder();
}

// Segurar o "handle" e arrastar reordena dentro do MESMO grupo (mesma
// pasta-pai) -- solta em cima de outro item do mesmo grupo e usa o
// endpoint /move (ja testado) repetidas vezes ate chegar na posicao.
// So considera alvo com o mesmo parentId -- nao deixa "soltar" dentro
// de outro grupo por engano.
const AUTOSCROLL_EDGE = 50;
const AUTOSCROLL_MAX_SPEED = 14;

function wireDragReorder() {
  let drag = null;
  let pointerY = 0;
  let scrollTimer = null;

  const autoScrollStep = () => {
    const rect = presetList.getBoundingClientRect();
    let speed = 0;
    if (pointerY < rect.top + AUTOSCROLL_EDGE) {
      speed = -AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, pointerY - rect.top) / AUTOSCROLL_EDGE);
    } else if (pointerY > rect.bottom - AUTOSCROLL_EDGE) {
      speed = AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, rect.bottom - pointerY) / AUTOSCROLL_EDGE);
    }
    if (speed) presetList.scrollTop += speed;
  };

  presetList.querySelectorAll('.drag-handle').forEach((handle) => {
    const row = handle.closest('.preset-row');

    handle.onpointerdown = (e) => {
      handle.setPointerCapture(e.pointerId);
      drag = { row, startY: e.clientY };
      pointerY = e.clientY;
      row.classList.add('dragging');
      row.style.pointerEvents = 'none';
      if (!scrollTimer) scrollTimer = setInterval(autoScrollStep, 16);
      e.preventDefault();
    };

    handle.onpointermove = (e) => {
      if (!drag) return;
      pointerY = e.clientY;
      row.style.transform = `translateY(${e.clientY - drag.startY}px)`;
    };

    handle.onpointerup = async (e) => {
      if (!drag) return;
      row.style.transform = '';
      row.classList.remove('dragging');
      drag = null;
      clearInterval(scrollTimer);
      scrollTimer = null;

      const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.preset-row');
      row.style.pointerEvents = '';
      if (!targetEl || targetEl === row || targetEl.dataset.parentId !== row.dataset.parentId) return;

      const siblings = [...presetList.querySelectorAll('.preset-row')].filter(
        (r) => r.dataset.parentId === row.dataset.parentId
      );
      const steps = siblings.indexOf(targetEl) - siblings.indexOf(row);
      const direction = steps > 0 ? 'down' : 'up';
      for (let i = 0; i < Math.abs(steps); i++) {
        await api(`/presets/${row.dataset.id}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
      }
      refresh();
    };
  });
}

// Pra editar uma pasta, o seletor de "onde guardar" nao pode oferecer ela
// mesma nem nenhum dos seus descendentes -- senao da pra criar um ciclo
// (pasta A dentro da pasta B que ta dentro da propria pasta A).
function descendantIds(id) {
  const ids = new Set();
  const queue = [id];
  while (queue.length) {
    const current = queue.pop();
    for (const p of state.presets) {
      if (p.parentId === current && !ids.has(p.id)) {
        ids.add(p.id);
        queue.push(p.id);
      }
    }
  }
  return ids;
}

function renderParentOptions(excludeId) {
  itemParentSelect.innerHTML = '';
  const rootOpt = document.createElement('option');
  rootOpt.value = '';
  rootOpt.textContent = '— RAIZ —';
  itemParentSelect.appendChild(rootOpt);
  const blocked = excludeId ? descendantIds(excludeId) : new Set();
  if (excludeId) blocked.add(excludeId);
  state.presets
    .filter((p) => p.kind === 'folder' && !blocked.has(p.id))
    .forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      itemParentSelect.appendChild(opt);
    });
}

function applyItemType() {
  stepsEl.style.display = itemTypeSelect.value === 'folder' ? 'none' : '';
  document.getElementById('add-step').style.display = itemTypeSelect.value === 'folder' ? 'none' : '';
}

export function loadIntoForm(preset) {
  state.editingId = preset.id;
  formTitle.textContent = `Editando: ${preset.name}`;
  nameInput.value = preset.name;
  state.steps = JSON.parse(JSON.stringify(preset.steps || []));
  renderParentOptions(preset.id);
  itemTypeSelect.value = preset.kind === 'folder' ? 'folder' : 'launcher';
  itemParentSelect.value = preset.parentId || '';
  applyItemType();
  renderSteps();
}

export function newForm() {
  state.editingId = null;
  formTitle.textContent = 'Novo preset';
  nameInput.value = '';
  state.steps = [];
  renderParentOptions(null);
  itemTypeSelect.value = 'launcher';
  itemParentSelect.value = state.currentFolderId || '';
  applyItemType();
  renderSteps();
}

const STEP_TYPES = [
  ['launch', 'Abrir'],
  ['cmd', 'Comando CMD'],
  ['key', 'Tecla'],
];

const STEP_KEYS = [
  ['F11', 'F11 (tela cheia)'],
  ['ESC', 'ESC'],
  ['ENTER', 'Enter'],
  ['ALT+ENTER', 'Alt+Enter (tela cheia alt.)'],
  ['ALT+TAB', 'Alt+Tab'],
  ['TAB', 'Tab'],
  ['SPACE', 'Espaço'],
  ['MAXIMIZE', 'Maximizar janela (precisa do processo)'],
  ['RESTORE', 'Restaurar janela (precisa do processo)'],
];

function renderSteps() {
  stepsEl.innerHTML = '';
  state.steps.forEach((step, i) => {
    if (!step.type) step.type = 'launch';
    const row = document.createElement('div');
    row.className = 'step-row';

    const typeSel = document.createElement('select');
    typeSel.className = 'step-type';
    STEP_TYPES.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (step.type === value) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.onchange = () => {
      state.steps[i].type = typeSel.value;
      renderSteps();
    };

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      state.steps.splice(i, 1);
      renderSteps();
    };

    if (step.type === 'cmd') {
      const cmdInput = document.createElement('input');
      cmdInput.className = 'step-target';
      cmdInput.placeholder = 'Comando (ex: ipconfig /flushdns)';
      cmdInput.value = step.command || '';
      cmdInput.oninput = () => (state.steps[i].command = cmdInput.value);
      row.append(typeSel, cmdInput, removeBtn);
    } else if (step.type === 'key') {
      if (!step.key) step.key = 'F11';
      const keySel = document.createElement('select');
      STEP_KEYS.forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (step.key === value) opt.selected = true;
        keySel.appendChild(opt);
      });
      keySel.onchange = () => (state.steps[i].key = keySel.value);

      const procInput = document.createElement('input');
      procInput.placeholder = 'processo (opcional, ex: crosvm)';
      procInput.title = 'Se preenchido, traz essa janela pra frente antes de mandar a tecla — sem isso a tecla vai pra janela que estiver em foco na hora, que pode não ser a certa se o gatilho for disparado sozinho.';
      procInput.value = step.processName || '';
      procInput.className = 'process-input';
      procInput.oninput = () => (state.steps[i].processName = procInput.value);

      row.append(typeSel, keySel, procInput, removeBtn);
    } else {
      const target = document.createElement('input');
      target.className = 'step-target';
      target.placeholder = 'Escolha um programa ou digite URL/protocolo';
      target.setAttribute('list', 'programs-list');
      target.value = step.target || '';
      target.oninput = () => {
        state.steps[i].target = target.value;
        const match = state.programsByTarget[target.value];
        if (match) {
          state.steps[i].processName = match.processName || '';
          processInput.value = state.steps[i].processName;
        }
      };

      const processInput = document.createElement('input');
      processInput.placeholder = 'processo (auto)';
      processInput.title = 'Nome do processo pra localizar a janela — só preencha se o auto-detect falhar (comum em jogos com launcher/bootstrapper)';
      processInput.value = step.processName || '';
      processInput.className = 'process-input';
      processInput.oninput = () => (state.steps[i].processName = processInput.value);

      const monitorSel = document.createElement('select');
      state.monitors.forEach((m, mi) => {
        const opt = document.createElement('option');
        opt.value = mi;
        opt.textContent = `Monitor ${mi}${m.primary ? ' (primário)' : ''}`;
        if (step.monitor === mi) opt.selected = true;
        monitorSel.appendChild(opt);
      });
      monitorSel.onchange = () => (state.steps[i].monitor = Number(monitorSel.value));

      const fullscreen = document.createElement('label');
      fullscreen.className = 'fs-toggle';
      const fsCheck = document.createElement('input');
      fsCheck.type = 'checkbox';
      fsCheck.checked = !!step.fullscreen;
      fsCheck.onchange = () => (state.steps[i].fullscreen = fsCheck.checked);
      fullscreen.append(fsCheck, 'tela cheia');

      row.append(typeSel, target, processInput, monitorSel, fullscreen, removeBtn);
    }

    stepsEl.appendChild(row);
  });
}

document.getElementById('toggle-edit').onclick = () => {
  editor.classList.toggle('open');
};

editor.addEventListener('click', (e) => {
  if (e.target === editor) editor.classList.remove('open');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') editor.classList.remove('open');
});

document.getElementById('refresh-programs').onclick = async () => {
  try {
    state.programs = await api('/programs/refresh', { method: 'POST' });
    renderProgramsList();
    showToast(`Lista atualizada (${state.programs.length} programas).`);
  } catch (e) {
    showToast(`Erro atualizando: ${e.message}`, false);
  }
};

const importFile = document.getElementById('import-file');
document.getElementById('import-btn').onclick = () => importFile.click();
importFile.onchange = async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast('Arquivo inválido (não é JSON).', false);
    return;
  }
  if (!Array.isArray(data)) {
    showToast('Arquivo inválido (esperado uma lista de presets).', false);
    return;
  }
  if (!confirm(`Isso substitui TODOS os ${state.presets.length} presets atuais por ${data.length} do arquivo. Continuar?`)) return;
  try {
    await api('/import', { method: 'POST', body: JSON.stringify(data) });
    state.currentFolderId = null;
    refresh();
    showToast('Importado com sucesso.');
  } catch (e) {
    showToast(`Erro importando: ${e.message}`, false);
  }
};

document.getElementById('add-step').onclick = () => {
  state.steps.push({ type: 'launch', target: '', processName: '', monitor: 0, fullscreen: false });
  renderSteps();
};

itemTypeSelect.onchange = applyItemType;

document.getElementById('new-preset').onclick = newForm;

document.getElementById('save-preset').onclick = async () => {
  const name = nameInput.value.trim();
  if (!name) {
    showToast('Dá um nome pro preset antes de salvar.', false);
    return;
  }
  const kind = itemTypeSelect.value;
  const data = {
    name,
    kind,
    parentId: itemParentSelect.value || null,
    steps: kind === 'folder' ? [] : state.steps,
  };
  if (state.editingId) {
    await api(`/presets/${state.editingId}`, { method: 'PUT', body: JSON.stringify(data) });
  } else {
    await api('/presets', { method: 'POST', body: JSON.stringify(data) });
  }
  newForm();
  refresh();
};
