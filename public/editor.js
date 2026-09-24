import { api } from './api.js';
import { state, STAT_KEYS, saveVisibleStats } from './state.js';
import { showToast, showActionToast } from './toast.js';
import { refreshStatsDisplay, hasClaudeData } from './status.js';

const programsList = document.getElementById('programs-list');
const obsScenesList = document.getElementById('obs-scenes-list');
const editor = document.getElementById('editor');
const presetList = document.getElementById('preset-list');
const presetSearchInput = document.getElementById('preset-search');
const stepsEl = document.getElementById('steps');
const nameInput = document.getElementById('preset-name');
const iconInput = document.getElementById('item-icon');
const formTitle = document.getElementById('form-title');
const itemTypeSelect = document.getElementById('item-type');
const itemParentSelect = document.getElementById('item-parent');
const itemFsPathInput = document.getElementById('item-fs-path');
const itemTriggerProcessInput = document.getElementById('item-trigger-process');
const itemTriggerPicker = itemTriggerProcessInput.closest('.trigger-picker');
const itemTriggerSuggestions = document.getElementById('item-trigger-suggestions');
const itemTriggerChips = document.getElementById('item-trigger-chips');
// Varios gatilhos por pasta (ex: jogo + launcher companion) -- cada item
// {processName, label, target}. target fica null pra entrada manual
// (usuario avancado que digitou o processo direto sem selecionar da lista).
let triggerChips = [];

function refresh() {
  document.dispatchEvent(new CustomEvent('deck:refresh'));
}

export function renderProgramsList() {
  programsList.innerHTML = '';
  state.programsByTarget = {};
  state.programsByProcessName = {};
  for (const p of state.programs) {
    state.programsByTarget[p.target] = p;
    // Reindexado por processName (nao so por target) pra reconhecer, ao
    // reabrir uma pasta pra editar, qual jogo/programa corresponde ao
    // "processo" ja salvo -- sem isso a pre-visualizacao (icone + nome)
    // some depois de salvar e reabrir o formulario.
    if (p.processName && !state.programsByProcessName[p.processName.toLowerCase()]) {
      state.programsByProcessName[p.processName.toLowerCase()] = p;
    }
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

export function renderObsScenesList() {
  obsScenesList.innerHTML = '';
  for (const name of state.obsScenes) {
    const opt = document.createElement('option');
    opt.value = name;
    obsScenesList.appendChild(opt);
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
        if (p.kind === 'folder' && !state.collapsedFolders.has(p.id)) addChildren(p.id, depth + 1);
      });
  };
  addChildren(null, 0);
  return rows;
}

// Com busca ativa, ignora hierarquia/collapse -- lista achatada (depth 0
// sempre) so com o que bate o nome, senao um preset dentro de uma pasta
// recolhida nunca apareceria no resultado da busca.
function searchPresetTree(query) {
  const q = query.toLowerCase();
  return state.presets.filter((p) => p.name.toLowerCase().includes(q)).map((preset) => ({ preset, depth: 0 }));
}

export function renderPresetList() {
  presetList.innerHTML = '';
  const query = presetSearchInput.value.trim();
  const rows = query ? searchPresetTree(query) : orderedPresetTree();
  for (const { preset, depth } of rows) {
    const row = document.createElement('div');
    row.className = 'preset-row' + (preset.kind === 'folder' ? ' is-folder' : '');
    row.dataset.id = preset.id;
    row.dataset.parentId = preset.parentId || '';
    row.style.marginLeft = `${depth * 22}px`;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Segurar e arrastar pra reordenar';
    handle.setAttribute('aria-label', 'Reordenar');

    let collapseBtn = null;
    if (preset.kind === 'folder') {
      const collapsed = state.collapsedFolders.has(preset.id);
      collapseBtn = document.createElement('button');
      collapseBtn.className = 'icon-btn collapse-btn';
      collapseBtn.textContent = collapsed ? '▸' : '▾';
      collapseBtn.title = collapsed ? 'Expandir pasta' : 'Recolher pasta';
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expandir pasta' : 'Recolher pasta');
      collapseBtn.onclick = () => {
        if (collapsed) state.collapsedFolders.delete(preset.id);
        else state.collapsedFolders.add(preset.id);
        localStorage.setItem('rigdeck-collapsed-folders', JSON.stringify([...state.collapsedFolders]));
        renderPresetList();
      };
    }

    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = (preset.kind === 'folder' ? '📁 ' : '') + preset.name;
    const upBtn = document.createElement('button');
    upBtn.className = 'icon-btn';
    upBtn.title = 'Mover pra cima';
    upBtn.setAttribute('aria-label', 'Mover pra cima');
    upBtn.textContent = '▲';
    upBtn.onclick = async () => {
      await api(`/presets/${preset.id}/move`, { method: 'POST', body: JSON.stringify({ direction: 'up' }) });
      refresh();
    };
    const downBtn = document.createElement('button');
    downBtn.className = 'icon-btn';
    downBtn.title = 'Mover pra baixo';
    downBtn.setAttribute('aria-label', 'Mover pra baixo');
    downBtn.textContent = '▼';
    downBtn.onclick = async () => {
      await api(`/presets/${preset.id}/move`, { method: 'POST', body: JSON.stringify({ direction: 'down' }) });
      refresh();
    };
    const pinBtn = document.createElement('button');
    pinBtn.className = 'icon-btn pin-btn' + (preset.pinned ? ' active' : '');
    pinBtn.title = 'Fixar na primeira página';
    pinBtn.setAttribute('aria-label', preset.pinned ? 'Desafixar' : 'Fixar na primeira página');
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
    delBtn.title = 'Apagar';
    delBtn.setAttribute('aria-label', 'Apagar');
    delBtn.textContent = '×';
    delBtn.onclick = async () => {
      // Apaga na hora (sem confirm() bloqueante -- ruim em PWA mobile) e
      // oferece desfazer por alguns segundos em vez de perguntar antes.
      const children = state.presets.filter((p) => p.parentId === preset.id);
      const snapshot = { ...preset };
      const childIds = children.map((c) => c.id);
      for (const child of children) {
        await api(`/presets/${child.id}`, { method: 'PUT', body: JSON.stringify({ parentId: null }) });
      }
      await api(`/presets/${preset.id}`, { method: 'DELETE' });
      refresh();
      const label = childIds.length
        ? `Apagado "${preset.name}" (${childIds.length} itens voltaram pra raiz).`
        : `Apagado "${preset.name}".`;
      showActionToast(label, 'DESFAZER', async () => {
        await api('/presets', { method: 'POST', body: JSON.stringify(snapshot) });
        for (const id of childIds) {
          await api(`/presets/${id}`, { method: 'PUT', body: JSON.stringify({ parentId: preset.id }) });
        }
        refresh();
        showToast(`"${preset.name}" restaurado.`);
      });
    };
    row.append(handle, upBtn, downBtn, pinBtn, ...(collapseBtn ? [collapseBtn] : []), label, editBtn, delBtn);
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

      presetList.querySelectorAll('.drop-target-folder').forEach((el) => el.classList.remove('drop-target-folder'));
      const hoverEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.preset-row');
      if (hoverEl && hoverEl !== row && hoverEl.classList.contains('is-folder')) {
        hoverEl.classList.add('drop-target-folder');
      }
    };

    handle.onpointerup = async (e) => {
      if (!drag) return;
      row.style.transform = '';
      row.classList.remove('dragging');
      drag = null;
      clearInterval(scrollTimer);
      scrollTimer = null;
      row.style.pointerEvents = '';
      presetList.querySelectorAll('.drop-target-folder').forEach((el) => el.classList.remove('drop-target-folder'));

      const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.preset-row');
      if (!targetEl || targetEl === row) return;

      const rowPreset = state.presets.find((p) => p.id === row.dataset.id);
      const targetPreset = state.presets.find((p) => p.id === targetEl.dataset.id);

      // Soltar em cima de uma pasta (que nao seja ela mesma nem descendente
      // dela, senao criaria um ciclo) reparenta pra dentro dela -- diferente
      // do reorder abaixo, que so troca posicao dentro do MESMO grupo.
      const isCycle = rowPreset.kind === 'folder' && descendantIds(rowPreset.id).has(targetPreset?.id);
      if (targetPreset?.kind === 'folder' && targetPreset.id !== rowPreset.id && !isCycle) {
        if (targetPreset.id !== (rowPreset.parentId || null)) {
          await api(`/presets/${rowPreset.id}`, { method: 'PUT', body: JSON.stringify({ parentId: targetPreset.id }) });
          showToast(`Movido pra "${targetPreset.name}".`);
          refresh();
        }
        return;
      }

      if (targetEl.dataset.parentId !== row.dataset.parentId) return;
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

// Mesma logica de icone real do grid (grid.js buildTile) reduzida pra um
// unico target -- so cobre Steam (CDN publico, sem precisar de instalacao
// local) e .exe local (extrai do binario). Resto cai no fallback (sem icone),
// que e aceitavel aqui: e so uma pre-visualizacao de confirmacao no forms,
// nao o grid principal.
function iconSrcFor(target) {
  if (!target) return null;
  const steamId = target.match(/^steam:\/\/rungameid\/(\d+)/i);
  if (steamId) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamId[1]}/header.jpg`;
  if (/\.exe$/i.test(target)) return `/api/icon?path=${encodeURIComponent(target)}`;
  return null;
}

// Sigla a partir do nome (ex: "Counter-Strike 2" -> "CS2", "Grand Theft
// Auto V" -> "GTAV") -- gente nao-tecnica digita a sigla que ja conhece,
// nao o nome completo, e busca por substring pura no nome sozinha nao acha
// "CS2" dentro de "Counter-Strike 2" (o nome nem contem essa sequencia).
function acronymOf(name) {
  return name
    .split(/[\s\-:]+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join('')
    .toUpperCase();
}

function matchesTriggerQuery(program, query) {
  const q = query.toLowerCase();
  return program.name.toLowerCase().includes(q) || acronymOf(program.name).toLowerCase().includes(q);
}

function addTriggerChip(chip) {
  // Dedupe por processName -- selecionar o mesmo jogo duas vezes nao faz
  // sentido e so inflaria a lista salva.
  if (triggerChips.some((c) => c.processName.toLowerCase() === chip.processName.toLowerCase())) return;
  triggerChips.push(chip);
  renderTriggerChips();
}

function renderTriggerChips() {
  itemTriggerChips.innerHTML = '';
  triggerChips.forEach((chip, i) => {
    const el = document.createElement('span');
    el.className = 'trigger-chip';
    const src = iconSrcFor(chip.target);
    if (src) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = src;
      img.onerror = () => img.remove();
      el.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = chip.label;
    el.appendChild(label);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remover ${chip.label}`);
    removeBtn.onclick = () => {
      triggerChips.splice(i, 1);
      renderTriggerChips();
    };
    el.appendChild(removeBtn);
    itemTriggerChips.appendChild(el);
  });
}

function renderTriggerSuggestions() {
  const query = itemTriggerProcessInput.value.trim();
  itemTriggerSuggestions.innerHTML = '';
  const matches = query ? state.programs.filter((p) => matchesTriggerQuery(p, query)).slice(0, 8) : [];
  if (!matches.length) {
    itemTriggerSuggestions.hidden = true;
    return;
  }
  matches.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'trigger-suggestion';
    const src = iconSrcFor(p.target);
    if (src) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = src;
      img.onerror = () => img.remove();
      row.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = p.name;
    row.appendChild(span);
    // mousedown (nao click) dispara antes do blur do input -- senao o blur
    // esconde a lista de sugestoes primeiro e o clique nunca chega no row.
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addTriggerChip({ processName: p.processName || p.name, label: p.name, target: p.target });
      itemTriggerProcessInput.value = '';
      itemTriggerSuggestions.hidden = true;
    });
    itemTriggerSuggestions.appendChild(row);
  });
  itemTriggerSuggestions.hidden = false;
}

itemTriggerProcessInput.addEventListener('input', renderTriggerSuggestions);
itemTriggerProcessInput.addEventListener('focus', renderTriggerSuggestions);
itemTriggerProcessInput.addEventListener('blur', () => {
  itemTriggerSuggestions.hidden = true;
});
// Enter sem ter clicado numa sugestao = usuario avancado digitando o nome
// do processo direto -- adiciona como chip manual (sem icone).
itemTriggerProcessInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const value = itemTriggerProcessInput.value.trim();
  if (!value) return;
  addTriggerChip({ processName: value, label: value, target: null });
  itemTriggerProcessInput.value = '';
  itemTriggerSuggestions.hidden = true;
});

function applyItemType() {
  const kind = itemTypeSelect.value;
  stepsEl.style.display = kind === 'launcher' ? '' : 'none';
  document.getElementById('add-step').style.display = kind === 'launcher' ? '' : 'none';
  itemFsPathInput.style.display = kind === 'fs-folder' ? '' : 'none';
  itemTriggerPicker.style.display = kind === 'folder' ? '' : 'none';
}

export function loadIntoForm(preset) {
  state.editingId = preset.id;
  formTitle.textContent = `Editando: ${preset.name}`;
  nameInput.value = preset.name;
  iconInput.value = preset.icon || '';
  state.steps = JSON.parse(JSON.stringify(preset.steps || []));
  renderParentOptions(preset.id);
  itemTypeSelect.value = preset.kind === 'folder' || preset.kind === 'fs-folder' ? preset.kind : 'launcher';
  itemParentSelect.value = preset.parentId || '';
  itemFsPathInput.value = preset.path || '';
  triggerChips = (preset.triggerProcess || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((processName) => {
      const known = state.programsByProcessName[processName.toLowerCase()];
      return known
        ? { processName, label: known.name, target: known.target }
        : { processName, label: processName, target: null };
    });
  itemTriggerProcessInput.value = '';
  renderTriggerChips();
  applyItemType();
  renderSteps();
}

export function newForm() {
  state.editingId = null;
  formTitle.textContent = 'Novo preset';
  nameInput.value = '';
  iconInput.value = '';
  state.steps = [];
  renderParentOptions(null);
  itemTypeSelect.value = 'launcher';
  itemParentSelect.value = state.currentFolderId || '';
  itemFsPathInput.value = '';
  itemTriggerProcessInput.value = '';
  triggerChips = [];
  renderTriggerChips();
  applyItemType();
  renderSteps();
}

const STEP_TYPES = [
  ['launch', 'Abrir'],
  ['cmd', 'Comando CMD'],
  ['key', 'Tecla'],
  ['sound', 'Tocar Som'],
  ['obs', 'OBS'],
];

const OBS_ACTIONS = [
  ['scene', 'Trocar cena'],
  ['mic-mute', 'Mutar microfone'],
  ['mic-unmute', 'Desmutar microfone'],
  ['mic-toggle', 'Alternar mudo do microfone'],
  ['start-record', '⏺ Iniciar gravação'],
  ['stop-record', '⏹ Parar gravação'],
  ['start-stream', '📡 Iniciar transmissão'],
  ['stop-stream', '📡 Parar transmissão'],
];

const OBS_MIC_ACTIONS = new Set(['mic-mute', 'mic-unmute', 'mic-toggle']);

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
  ['PLAY_PAUSE', '⏯ Play/Pause'],
  ['NEXT', '⏭ Próxima faixa'],
  ['PREV', '⏮ Faixa anterior'],
  ['VOLUME_UP', '🔊 Volume +'],
  ['VOLUME_DOWN', '🔉 Volume -'],
  ['MUTE', '🔇 Mudo'],
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
    removeBtn.title = 'Remover passo';
    removeBtn.setAttribute('aria-label', 'Remover passo');
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
    } else if (step.type === 'sound') {
      const pathInput = document.createElement('input');
      pathInput.className = 'step-target';
      pathInput.placeholder = 'Caminho do arquivo .wav (ex: C:\\Sons\\buzina.wav)';
      pathInput.value = step.path || '';
      pathInput.oninput = () => (state.steps[i].path = pathInput.value);
      row.append(typeSel, pathInput, removeBtn);
    } else if (step.type === 'obs') {
      if (!step.action) step.action = 'scene';
      const actionSel = document.createElement('select');
      OBS_ACTIONS.forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (step.action === value) opt.selected = true;
        actionSel.appendChild(opt);
      });
      actionSel.onchange = () => {
        state.steps[i].action = actionSel.value;
        renderSteps();
      };
      row.append(typeSel, actionSel);

      if (step.action === 'scene') {
        const sceneInput = document.createElement('input');
        sceneInput.className = 'step-target';
        sceneInput.placeholder = 'Nome da cena';
        sceneInput.setAttribute('list', 'obs-scenes-list');
        sceneInput.value = step.sceneName || '';
        sceneInput.oninput = () => (state.steps[i].sceneName = sceneInput.value);
        row.append(sceneInput);
      } else if (OBS_MIC_ACTIONS.has(step.action)) {
        const inputNameInput = document.createElement('input');
        inputNameInput.className = 'process-input';
        inputNameInput.placeholder = 'Mic/Aux';
        inputNameInput.title = 'Nome da fonte de audio no OBS -- so preenche se nao for a padrao "Mic/Aux"';
        inputNameInput.value = step.inputName || '';
        inputNameInput.oninput = () => (state.steps[i].inputName = inputNameInput.value);
        row.append(inputNameInput);
      }

      row.append(removeBtn);
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
  if (editor.classList.contains('open')) updateClaudeToggleVisibility();
};

// Chave que so faz sentido pra quem tem o plugin claude-hud escrevendo o
// snapshot -- some do CONFIG pra quem nao tem, em vez de opcao morta.
function updateClaudeToggleVisibility() {
  const available = hasClaudeData();
  for (const key of ['claude5h', 'claudeWeek']) {
    const label = document.getElementById(`stat-toggle-${key}`)?.closest('label');
    if (label) label.hidden = !available;
  }
}

for (const key of STAT_KEYS) {
  const checkbox = document.getElementById(`stat-toggle-${key}`);
  if (!checkbox) continue;
  checkbox.checked = state.visibleStats.has(key);
  checkbox.onchange = () => {
    if (checkbox.checked) state.visibleStats.add(key);
    else state.visibleStats.delete(key);
    saveVisibleStats(state.visibleStats);
    refreshStatsDisplay();
  };
}

editor.addEventListener('click', (e) => {
  if (e.target === editor) editor.classList.remove('open');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') editor.classList.remove('open');
});

presetSearchInput.addEventListener('input', () => renderPresetList());

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
  if (kind === 'fs-folder' && !itemFsPathInput.value.trim()) {
    showToast('Preenche o caminho da pasta do disco.', false);
    return;
  }
  const data = {
    name,
    kind,
    icon: iconInput.value.trim(),
    parentId: itemParentSelect.value || null,
    steps: kind === 'launcher' ? state.steps : [],
  };
  if (kind === 'fs-folder') data.path = itemFsPathInput.value.trim();
  if (kind === 'folder') {
    data.triggerProcess = triggerChips.map((c) => c.processName).join(',') || null;
  }
  try {
    if (state.editingId) {
      await api(`/presets/${state.editingId}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await api('/presets', { method: 'POST', body: JSON.stringify(data) });
    }
  } catch (e) {
    showToast(`Erro salvando: ${e.message}`, false);
    return;
  }
  newForm();
  refresh();
};
