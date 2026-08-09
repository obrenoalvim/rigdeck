import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/lib/presets-store.js';

function tempFile(): string {
  return path.join(os.tmpdir(), `presets-test-${Date.now()}-${Math.random()}.json`);
}

test('list retorna vazio quando arquivo nao existe', () => {
  const store = createStore(tempFile());
  assert.deepStrictEqual(store.list(), []);
});

test('create adiciona preset e persiste no arquivo', () => {
  const file = tempFile();
  const store = createStore(file);
  const preset = store.create({ id: 'a', name: 'Teste', steps: [] });
  assert.strictEqual(preset.id, 'a');
  assert.deepStrictEqual(store.list(), [{ id: 'a', name: 'Teste', steps: [] }]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ id: 'a', name: 'Teste', steps: [] }]);
});

test('get retorna preset por id ou undefined', () => {
  const store = createStore(tempFile());
  store.create({ id: 'a', name: 'Teste', steps: [] });
  assert.strictEqual(store.get('a')?.name, 'Teste');
  assert.strictEqual(store.get('missing'), undefined);
});

test('update mescla dados mantendo o id', () => {
  const store = createStore(tempFile());
  store.create({ id: 'a', name: 'Velho', steps: [] });
  const updated = store.update('a', { name: 'Novo' });
  assert.strictEqual(updated?.name, 'Novo');
  assert.strictEqual(updated?.id, 'a');
  assert.strictEqual(store.update('missing', { name: 'x' }), null);
});

test('remove tira o preset da lista', () => {
  const store = createStore(tempFile());
  store.create({ id: 'a', name: 'Teste', steps: [] });
  assert.strictEqual(store.remove('a'), true);
  assert.deepStrictEqual(store.list(), []);
  assert.strictEqual(store.remove('a'), false);
});

test('replaceAll troca a lista inteira (import)', () => {
  const file = tempFile();
  const store = createStore(file);
  store.create({ id: 'a', name: 'Velho', steps: [] });
  const novos = [{ id: 'b', name: 'Novo', steps: [] }];
  store.replaceAll(novos);
  assert.deepStrictEqual(store.list(), novos);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), novos);
});
