import test from 'node:test';
import assert from 'node:assert';
import { parseAudioStateOutput, clampDb, eqBlock, parseEqBlock, buildVoiceArgs } from '../src/lib/audio.js';

test('normaliza master, mic e sessoes', () => {
  const out = parseAudioStateOutput(
    '{"ok":true,"master":{"volume":48,"muted":false},"mic":{"available":true,"volume":70,"muted":false},"sessions":[{"pid":123,"processName":"Brave","exePath":"C:\\\\brave.exe","volume":60,"muted":false}]}'
  );
  assert.deepStrictEqual(out, {
    master: { volume: 48, muted: false },
    mic: { available: true, volume: 70, muted: false },
    sessions: [{ pid: 123, processName: 'Brave', exePath: 'C:\\brave.exe', volume: 60, muted: false }],
  });
});

test('mic ausente vira available:false', () => {
  const out = parseAudioStateOutput('{"ok":true,"master":{"volume":10,"muted":true}}');
  assert.deepStrictEqual(out.mic, { available: false, volume: 0, muted: false });
});

test('sessions ausente vira array vazio', () => {
  const out = parseAudioStateOutput('{"ok":true,"master":{"volume":10,"muted":true}}');
  assert.deepStrictEqual(out.sessions, []);
});

test('exePath ausente vira null', () => {
  const out = parseAudioStateOutput(
    '{"ok":true,"master":{"volume":10,"muted":false},"sessions":[{"pid":1,"processName":"?","volume":50,"muted":false}]}'
  );
  assert.strictEqual(out.sessions[0].exePath, null);
});

test('ok:false lanca erro com a mensagem do script', () => {
  assert.throws(() => parseAudioStateOutput('{"ok":false,"error":"sem dispositivo de audio"}'), /sem dispositivo de audio/);
});

test('clampDb limita ao range e usa fallback pra valor invalido', () => {
  assert.strictEqual(clampDb(20, 0), 12);
  assert.strictEqual(clampDb(-20, 0), -12);
  assert.strictEqual(clampDb(5, 0), 5);
  assert.strictEqual(clampDb('abc', 7), 7);
  assert.strictEqual(clampDb(NaN, 3), 3);
});

test('clampDb aceita range customizado', () => {
  assert.strictEqual(clampDb(20, 0, -15, 15), 15);
  assert.strictEqual(clampDb(-20, 0, -15, 15), -15);
});

test('eqBlock/parseEqBlock roundtrip', () => {
  const block = eqBlock(3, -2);
  assert.deepStrictEqual(parseEqBlock(block), { bass: 3, treble: -2 });
});

test('parseEqBlock ignora conteudo fora do bloco marcado', () => {
  const content = 'Include: peace.txt\nFilter: ON LSC Fc 100 Hz Gain 99 dB\n';
  assert.deepStrictEqual(parseEqBlock(content), { bass: 0, treble: 0 });
});

test('parseEqBlock le so o bloco marcado quando existe conteudo em volta', () => {
  const content = `Include: peace.txt\n${eqBlock(4, -6)}Filter: ON LSC Fc 999 Hz Gain 99 dB\n`;
  assert.deepStrictEqual(parseEqBlock(content), { bass: 4, treble: -6 });
});

test('buildVoiceArgs -- preset de voz', () => {
  assert.deepStrictEqual(buildVoiceArgs({ voice: 'robot' }), ['-Command', '3', '-Arg1', '12']);
});

test('buildVoiceArgs -- voz desconhecida lanca erro', () => {
  assert.throws(() => buildVoiceArgs({ voice: 'nao-existe' }), /efeito de voz desconhecido/);
});

test('buildVoiceArgs -- pitch customizado, com clamp', () => {
  assert.deepStrictEqual(buildVoiceArgs({ voice: 'customPitch', pitch: 5 }), ['-Command', '3', '-Arg1', '13', '-Arg2', '5']);
  assert.deepStrictEqual(buildVoiceArgs({ voice: 'customPitch', pitch: 999 }), ['-Command', '3', '-Arg1', '13', '-Arg2', '15']);
  assert.deepStrictEqual(buildVoiceArgs({ voice: 'customPitch' }), ['-Command', '3', '-Arg1', '13', '-Arg2', '0']);
});

test('buildVoiceArgs -- enabled tem prioridade sobre voice', () => {
  assert.deepStrictEqual(buildVoiceArgs({ enabled: true }), ['-Command', '2', '-Arg1', '0']);
  assert.deepStrictEqual(buildVoiceArgs({ enabled: false }), ['-Command', '2', '-Arg1', '1']);
});
