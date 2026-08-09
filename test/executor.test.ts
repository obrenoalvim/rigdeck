import test from 'node:test';
import assert from 'node:assert';
import { processNameFor, pidKeyFor } from '../src/lib/executor.js';

test('usa processName explicito quando presente', () => {
  assert.strictEqual(processNameFor({ type: 'launch', target: 'C:\\x\\Foo.exe', processName: 'bar' }), 'bar');
});

test('deriva do basename do target sem extensao', () => {
  assert.strictEqual(processNameFor({ type: 'launch', target: 'C:\\Games\\Fortnite\\FortniteClient.exe' }), 'FortniteClient');
});

test('retorna null pra protocolo sem processName explicito (nao da pra adivinhar)', () => {
  assert.strictEqual(processNameFor({ type: 'launch', target: 'discord://' }), null);
});

test('retorna null pra URL http sem processName explicito', () => {
  assert.strictEqual(processNameFor({ type: 'launch', target: 'http://localhost:8096/web/#/home' }), null);
});

test('usa processName explicito mesmo com target sendo URL', () => {
  assert.strictEqual(processNameFor({ type: 'launch', target: 'http://localhost:8096', processName: 'msedge' }), 'msedge');
});

test('pidKeyFor usa o target do passo, nao a posicao -- reordenar passos nao troca a chave', () => {
  const stepA = { type: 'launch' as const, target: 'C:\\Discord.exe' };
  const stepB = { type: 'launch' as const, target: 'C:\\Fortnite.exe' };
  // preset original: [A, B] -- usuario roda, depois reordena pra [B, A] e edita
  const keyBeforeReorder = pidKeyFor('preset1', stepA);
  const keyAfterReorder = pidKeyFor('preset1', stepA);
  assert.strictEqual(keyBeforeReorder, keyAfterReorder);
  // a chave de A nunca pode colidir com a de B, senao um kill mataria o processo errado
  assert.notStrictEqual(pidKeyFor('preset1', stepA), pidKeyFor('preset1', stepB));
});
