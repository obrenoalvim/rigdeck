// Traduz um atalho tipo "ctrl+1" pra sintaxe crua do SendKeys ("^1") --
// usado pelo soundboard pra acionar um som ja cadastrado no Soundboard
// nativo do Discord (via keybind configurada nas Configuracoes > Atalhos do
// proprio Discord) em vez de tocar um arquivo local. Mistura acontece dentro
// do Discord (audio in-process), sem precisar rotear dispositivo nenhum --
// bem mais confiavel que forcar troca de dispositivo padrao (testado e
// descartado: mexe com outros apps de audio rodando junto).
const MODIFIER_TOKENS: Record<string, string> = { ctrl: '^', control: '^', alt: '%', shift: '+' };

const NAMED_KEYS: Record<string, string> = {
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6',
  f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12',
  esc: 'ESC', escape: 'ESC', enter: 'ENTER', tab: 'TAB',
  num0: 'NUMPAD0', num1: 'NUMPAD1', num2: 'NUMPAD2', num3: 'NUMPAD3', num4: 'NUMPAD4',
  num5: 'NUMPAD5', num6: 'NUMPAD6', num7: 'NUMPAD7', num8: 'NUMPAD8', num9: 'NUMPAD9',
};

const SENDKEYS_SPECIAL_CHARS = '+^%~(){}[]';

export function translateKeybind(input: string): string {
  const parts = String(input || '')
    .trim()
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('atalho vazio');

  const keyPart = parts.pop()!;
  let modifiers = '';
  for (const p of parts) {
    const token = MODIFIER_TOKENS[p];
    if (!token) throw new Error(`modificador desconhecido: "${p}" (use ctrl/alt/shift)`);
    modifiers += token;
  }

  let keyToken: string;
  if (keyPart === 'space') {
    keyToken = ' ';
  } else if (NAMED_KEYS[keyPart]) {
    keyToken = `{${NAMED_KEYS[keyPart]}}`;
  } else if (keyPart.length === 1) {
    keyToken = SENDKEYS_SPECIAL_CHARS.includes(keyPart) ? `{${keyPart}}` : keyPart;
  } else {
    throw new Error(`tecla desconhecida: "${keyPart}"`);
  }

  return modifiers + keyToken;
}
