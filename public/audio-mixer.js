import { api } from './api.js';
import { showToast } from './toast.js';

const modal = document.getElementById('audio-mixer');
const channelsEl = document.getElementById('audio-channels');
const eqEl = document.getElementById('audio-eq');
const soundsEl = document.getElementById('audio-sounds');

let pollTimer = null;
let meterSource = null;
// Enquanto o usuario arrasta QUALQUER slider, o poll de estado pula o
// re-render inteiro -- senao o valor otimista na tela e sobrescrito pelo
// estado antigo que ainda esta a caminho do servidor (a chamada de verdade
// so dispara debounced). Os VU meters (SSE) continuam atualizando normal,
// nao dependem desse poll.
let dragging = false;
const debounceTimers = new Map();
// pid (ou 'master'/'mic') -> elemento .audio-meter-fill, refeito a cada
// render() pra apontar pros nos de DOM atuais.
const meterEls = new Map();

function debounce(key, fn, delay = 120) {
  clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(fn, delay));
}

// aria-label acompanha o estado (Mutar/Desmutar X) -- mesmo padrao ja usado
// no botao de pin do editor (`Fixar`/`Desafixar` conforme o estado atual).
function wireMuteBtn(btn, initialMuted, onToggle, label) {
  const apply = (muted) => {
    btn.classList.toggle('muted', muted);
    btn.textContent = muted ? '🔇' : '🔊';
    if (label) btn.setAttribute('aria-label', muted ? `Desmutar ${label}` : `Mutar ${label}`);
  };
  let muted = initialMuted;
  apply(muted);
  btn.onclick = async () => {
    muted = !muted;
    apply(muted);
    try {
      await onToggle(muted);
    } catch (e) {
      showToast(`Erro: ${e.message}`, false);
    }
  };
}

function fallbackIcon(icon = '🔊') {
  const span = document.createElement('span');
  span.className = 'audio-row-icon fallback';
  span.textContent = icon;
  return span;
}

// Canal vertical (fader que sobe/desce, tipo mesa de som de verdade) usado
// pra master, mic e cada app -- os 3 sao estruturalmente identicos, so muda
// de onde vem o volume/mute e pra onde manda a mudanca.
function buildChannelStrip({ key, label, icon, iconPath, volume, muted, onVolume, onMute }) {
  const strip = document.createElement('div');
  strip.className = 'channel-strip';

  if (iconPath) {
    const img = document.createElement('img');
    img.className = 'audio-row-icon';
    img.alt = '';
    img.src = iconPath;
    img.onerror = () => img.replaceWith(fallbackIcon(icon));
    strip.appendChild(img);
  } else {
    strip.appendChild(fallbackIcon(icon));
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'channel-label';
  labelEl.textContent = label;
  labelEl.title = label;
  strip.appendChild(labelEl);

  const valEl = document.createElement('span');
  valEl.className = 'channel-val';
  valEl.textContent = `${volume}%`;

  const faderRow = document.createElement('div');
  faderRow.className = 'fader-row';

  const faderWrap = document.createElement('div');
  faderWrap.className = 'fader-wrap';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'audio-slider vertical';
  slider.min = 0;
  slider.max = 100;
  slider.value = volume;
  slider.setAttribute('aria-label', `Volume de ${label}`);
  slider.addEventListener('pointerdown', () => { dragging = true; });
  slider.addEventListener('pointerup', () => { dragging = false; });
  slider.addEventListener('input', () => {
    valEl.textContent = `${slider.value}%`;
    debounce(`vol-${key}`, () => onVolume(Number(slider.value)).catch((e) => showToast(`Erro ajustando volume: ${e.message}`, false)));
  });
  faderWrap.appendChild(slider);

  const meterBar = document.createElement('div');
  meterBar.className = 'audio-meter vertical';
  const meterFill = document.createElement('span');
  meterFill.className = 'audio-meter-fill';
  meterBar.appendChild(meterFill);
  meterEls.set(key, meterFill);

  faderRow.append(faderWrap, meterBar);
  strip.appendChild(faderRow);
  strip.appendChild(valEl);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'icon-btn audio-mute-btn';
  wireMuteBtn(muteBtn, muted, onMute, label);
  strip.appendChild(muteBtn);

  return strip;
}

async function refreshAudioState() {
  if (dragging) return;
  let state;
  try {
    state = await api('/audio');
  } catch (e) {
    showToast(`Erro lendo áudio: ${e.message}`, false);
    return;
  }
  meterEls.clear();
  channelsEl.innerHTML = '';

  channelsEl.appendChild(
    buildChannelStrip({
      key: 'master',
      label: 'MASTER',
      icon: '🔊',
      volume: state.master.volume,
      muted: state.master.muted,
      onVolume: (volume) => api('/audio/master', { method: 'POST', body: JSON.stringify({ volume }) }),
      onMute: (muted) => api('/audio/master', { method: 'POST', body: JSON.stringify({ muted }) }),
    })
  );

  if (state.mic.available) {
    channelsEl.appendChild(
      buildChannelStrip({
        key: 'mic',
        label: 'MIC',
        icon: '🎤',
        volume: state.mic.volume,
        muted: state.mic.muted,
        onVolume: (volume) => api('/audio/mic', { method: 'POST', body: JSON.stringify({ volume }) }),
        onMute: (muted) => api('/audio/mic', { method: 'POST', body: JSON.stringify({ muted }) }),
      })
    );
  }

  if (!state.sessions.length) {
    const hint = document.createElement('div');
    hint.className = 'audio-empty-hint channels-hint';
    hint.textContent = 'Nenhum app com sessão de áudio no momento.';
    channelsEl.appendChild(hint);
  } else {
    state.sessions.forEach((session) =>
      channelsEl.appendChild(
        buildChannelStrip({
          key: session.pid,
          label: session.processName,
          icon: '🔊',
          iconPath: session.exePath ? `/api/icon?path=${encodeURIComponent(session.exePath)}` : null,
          volume: session.volume,
          muted: session.muted,
          onVolume: (volume) =>
            api(`/audio/session/${session.pid}`, { method: 'POST', body: JSON.stringify({ volume }) }),
          onMute: (muted) => api(`/audio/session/${session.pid}`, { method: 'POST', body: JSON.stringify({ muted }) }),
        })
      )
    );
  }
}

// --- Graves / Agudos (Equalizer APO) ---------------------------------------

function buildEqRow(label, value, onChange, min = -12, max = 12) {
  const row = document.createElement('div');
  row.className = 'audio-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'audio-row-label';
  labelEl.textContent = label;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'audio-slider';
  slider.min = min;
  slider.max = max;
  slider.step = 1;
  slider.value = value;
  slider.setAttribute('aria-label', label);

  const val = document.createElement('span');
  val.className = 'audio-row-val';
  const fmt = (v) => `${v > 0 ? '+' : ''}${v}dB`;
  val.textContent = fmt(value);

  slider.addEventListener('input', () => {
    val.textContent = fmt(Number(slider.value));
    debounce(`eq-${label}`, () => onChange(Number(slider.value)).catch((e) => showToast(`Erro no EQ: ${e.message}`, false)));
  });

  row.append(labelEl, slider, val);
  return row;
}

async function refreshEq() {
  let eq;
  try {
    eq = await api('/audio/eq');
  } catch (e) {
    eqEl.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'audio-empty-hint';
    hint.textContent = `Erro lendo EQ: ${e.message}`;
    eqEl.appendChild(hint);
    return;
  }

  eqEl.innerHTML = '';

  if (!eq.installed) {
    const hint = document.createElement('div');
    hint.className = 'audio-eq-hint';
    hint.textContent =
      'Precisa do Equalizer APO (driver de áudio free, usa a extensão nativa de áudio do Windows) instalado pra graves/agudos funcionarem. Baixa, instala e escolhe seu dispositivo de playback no assistente deles (uma vez só) — o rigdeck cuida do resto sozinho a partir daí.';

    const actions = document.createElement('div');
    actions.className = 'editor-actions';

    const installLink = document.createElement('a');
    installLink.className = 'btn-ghost small';
    installLink.href = 'https://sourceforge.net/projects/equalizerapo/';
    installLink.target = '_blank';
    installLink.rel = 'noopener';
    installLink.textContent = '⬇ BAIXAR EQUALIZER APO';

    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn-ghost small';
    checkBtn.textContent = '🔄 JÁ INSTALEI, VERIFICAR';
    checkBtn.onclick = refreshEq;

    actions.append(installLink, checkBtn);
    eqEl.append(hint, actions);
    return;
  }

  eqEl.appendChild(
    buildEqRow('GRAVES', eq.bass, (bass) => api('/audio/eq', { method: 'POST', body: JSON.stringify({ bass }) }))
  );
  eqEl.appendChild(
    buildEqRow('AGUDOS', eq.treble, (treble) => api('/audio/eq', { method: 'POST', body: JSON.stringify({ treble }) }))
  );
}

// --- Voz (Clownfish Voice Changer) ------------------------------------------
// Protocolo e so de ida -- Clownfish nao devolve estado nenhum (limitacao
// documentada da API deles), entao nao da pra saber qual efeito ta ativo
// agora nem ler o pitch atual. O slider sempre abre em 0, sem tentar sincronizar.

const voiceEl = document.getElementById('audio-voice');

const VOICE_PRESETS = [
  ['none', 'Nenhum'],
  ['femalePitch', 'Voz Feminina'],
  ['malePitch', 'Voz Masculina'],
  ['heliumPitch', 'Hélio'],
  ['babyPitch', 'Bebê'],
  ['robot', 'Robô'],
  ['radio', 'Rádio'],
  ['alien', 'Alien'],
  ['mutation', 'Mutação'],
  ['silence', 'Silêncio'],
];

function setVoice(body) {
  return api('/audio/voice', { method: 'POST', body: JSON.stringify(body) }).catch((e) =>
    showToast(`Erro no efeito de voz: ${e.message}`, false)
  );
}

async function refreshVoice() {
  let state;
  try {
    state = await api('/audio/voice');
  } catch (e) {
    voiceEl.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'audio-empty-hint';
    hint.textContent = `Erro lendo voz: ${e.message}`;
    voiceEl.appendChild(hint);
    return;
  }

  voiceEl.innerHTML = '';

  if (!state.running) {
    const hint = document.createElement('div');
    hint.className = 'audio-eq-hint';
    hint.textContent =
      'Precisa do Clownfish Voice Changer aberto (freeware, muda a voz em qualquer app -- Discord, jogos, etc). Abre uma vez, o rigdeck controla o resto por fora.';

    const actions = document.createElement('div');
    actions.className = 'editor-actions';

    const installLink = document.createElement('a');
    installLink.className = 'btn-ghost small';
    installLink.href = 'https://clownfish-translator.com/voicechanger/';
    installLink.target = '_blank';
    installLink.rel = 'noopener';
    installLink.textContent = '⬇ BAIXAR CLOWNFISH';

    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn-ghost small';
    checkBtn.textContent = '🔄 JÁ ABRI, VERIFICAR';
    checkBtn.onclick = refreshVoice;

    actions.append(installLink, checkBtn);
    voiceEl.append(hint, actions);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'audio-sounds-grid';
  VOICE_PRESETS.forEach(([key, label]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sound-chip';
    chip.textContent = `🎙 ${label}`;
    chip.onclick = () => setVoice({ voice: key });
    grid.appendChild(chip);
  });
  voiceEl.appendChild(grid);

  voiceEl.appendChild(buildEqRow('PITCH', 0, (pitch) => setVoice({ voice: 'customPitch', pitch }), -15, 15));
}

// --- Efeitos sonoros (soundboard) ------------------------------------------

function buildSoundChip(sound) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'sound-chip';

  const label = document.createElement('span');
  label.textContent = `${sound.keybind ? '⌨️' : '🔊'} ${sound.name}`;
  if (sound.keybind) label.title = `Aciona o Soundboard do Discord (atalho: ${sound.keybind})`;

  // span, nao button -- o chip inteiro ja e um <button> (toca o som), e
  // <button> dentro de <button> e HTML invalido (o navegador quebra a
  // estrutura, fecha o de fora antes da hora). role+tabindex+keydown cobre
  // teclado/leitor de tela sem precisar de elemento aninhado.
  const del = document.createElement('span');
  del.className = 'sound-chip-del';
  del.textContent = '×';
  del.title = 'Remover';
  del.setAttribute('role', 'button');
  del.setAttribute('tabindex', '0');
  del.setAttribute('aria-label', `Remover ${sound.name}`);
  const removeSound = async () => {
    try {
      await api(`/sounds/${sound.id}`, { method: 'DELETE' });
      refreshSounds();
    } catch (err) {
      showToast(`Erro removendo som: ${err.message}`, false);
    }
  };
  del.onclick = (e) => {
    e.stopPropagation();
    removeSound();
  };
  del.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    removeSound();
  };

  chip.append(label, del);
  chip.onclick = async () => {
    try {
      await api(`/sounds/${sound.id}/play`, { method: 'POST' });
    } catch (e) {
      showToast(`Erro tocando som: ${e.message}`, false);
    }
  };
  return chip;
}

async function refreshSounds() {
  let sounds;
  try {
    sounds = await api('/sounds');
  } catch (e) {
    showToast(`Erro lendo efeitos: ${e.message}`, false);
    return;
  }
  soundsEl.innerHTML = '';
  sounds.forEach((s) => soundsEl.appendChild(buildSoundChip(s)));
}

document.getElementById('audio-sound-add').onclick = async () => {
  const nameInput = document.getElementById('audio-sound-name');
  const pathInput = document.getElementById('audio-sound-path');
  const keybindInput = document.getElementById('audio-sound-keybind');
  const name = nameInput.value.trim();
  const path = pathInput.value.trim();
  const keybind = keybindInput.value.trim();
  if (!name || (!path && !keybind)) {
    showToast('Preenche nome e (caminho ou atalho) do som.', false);
    return;
  }
  try {
    await api('/sounds', { method: 'POST', body: JSON.stringify({ name, path: path || undefined, keybind: keybind || undefined }) });
    nameInput.value = '';
    pathInput.value = '';
    keybindInput.value = '';
    refreshSounds();
  } catch (e) {
    showToast(`Erro adicionando som: ${e.message}`, false);
  }
};

// --- VU meter ao vivo (SSE) -------------------------------------------------

function updateMeter(key, peak) {
  const el = meterEls.get(key);
  if (!el) return;
  // Meter vertical enche de baixo pra cima -- altura, nao largura. Peak
  // raramente chega perto de 1.0 em uso normal, escala um pouco pra o meter
  // nao ficar sempre baixinho na tela.
  el.style.height = `${Math.min(100, Math.round(peak * 140))}%`;
}

function startMeterStream() {
  stopMeterStream();
  meterSource = new EventSource('/api/audio/meters');
  meterSource.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    if (data.error) return;
    // Outro dispositivo com o mixer aberto mudou volume/mute -- busca o
    // estado novo na hora em vez de esperar o poll de 2s (sincroniza entre
    // celular/PC/etc que estiverem com o mixer aberto ao mesmo tempo).
    if (data.type === 'state-changed') {
      refreshAudioState();
      return;
    }
    updateMeter('master', data.master || 0);
    updateMeter('mic', data.mic || 0);
    (data.sessions || []).forEach((s) => updateMeter(s.pid, s.peak));
  };
}

function stopMeterStream() {
  if (!meterSource) return;
  meterSource.close();
  meterSource = null;
}

// --- Abrir/fechar -----------------------------------------------------------

export function openAudioMixer() {
  modal.classList.add('open');
  refreshAudioState();
  refreshEq();
  refreshVoice();
  refreshSounds();
  startMeterStream();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshAudioState, 2000);
}

function closeAudioMixer() {
  modal.classList.remove('open');
  clearInterval(pollTimer);
  pollTimer = null;
  stopMeterStream();
}

document.getElementById('audio-mixer-close').onclick = closeAudioMixer;
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeAudioMixer();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.classList.contains('open')) closeAudioMixer();
});
