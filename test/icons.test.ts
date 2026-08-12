import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import { extractIcon } from '../src/lib/icons.js';

// Sem mock de child_process (mesmo padrao de executor.test.ts: roda o script
// real). Caminho garantidamente inexistente faz get-icon.ps1 sair com exit 1
// de forma deterministica (Test-Path falha antes de qualquer tentativa real
// de extrair icone), sem depender de nenhum .exe existir na maquina de teste.
const MISSING_EXE = path.join(os.tmpdir(), 'rigdeck-nao-existe-de-verdade.exe');

test('extractIcon resolve null quando o arquivo nao existe, sem lancar', async () => {
  const result = await extractIcon(MISSING_EXE);
  assert.strictEqual(result, null);
});

test('extractIcon deduplica chamadas concorrentes pro mesmo caminho (mesma promise)', () => {
  const p1 = extractIcon(MISSING_EXE + '-dedup');
  const p2 = extractIcon(MISSING_EXE + '-dedup');
  assert.strictEqual(p1, p2, 'segunda chamada antes da primeira resolver deveria reusar a mesma promise em voo');
});

test('extractIcon nao cacheia falha -- proxima chamada tenta de novo (nova promise)', async () => {
  const target = MISSING_EXE + '-retry';
  const p1 = extractIcon(target);
  await p1;
  const p2 = extractIcon(target);
  assert.notStrictEqual(p1, p2, 'apos falha, cache deveria ter sido limpo pra permitir retry');
  await p2;
});
