import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigdeck-icon-cache-'));
process.env.ICON_CACHE_DIR = cacheDir;

const { lookupIcon, cacheKeyFor } = await import('../src/lib/icon-fetch.js');

test.after(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('lookupIcon respeita negative-cache sem precisar de rede', async () => {
  const key = cacheKeyFor('Jogo Que Nao Existe De Verdade', null);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify({ [key]: null }));

  const start = Date.now();
  const result = await lookupIcon('Jogo Que Nao Existe De Verdade', null);
  assert.strictEqual(result, null);
  // Se tivesse ido pra rede, levaria bem mais que isso -- prova indireta de
  // que o negative-cache evitou a chamada HTTP.
  assert.ok(Date.now() - start < 200, 'nao deveria bater rede com negative-cache preenchido');
});

test('lookupIcon retorna o caminho do arquivo ja cacheado sem bater rede', async () => {
  const key = cacheKeyFor('Jogo Cacheado', 'target-x');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, `${key}.jpg`), 'fake-jpg-bytes');
  fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify({ [key]: `${key}.jpg` }));

  const result = await lookupIcon('Jogo Cacheado', 'target-x');
  assert.strictEqual(result, path.join(cacheDir, `${key}.jpg`));
});

test('cacheKeyFor prioriza target sobre name (games com mesmo nome, targets diferentes nao colidem)', () => {
  const a = cacheKeyFor('Mesmo Nome', 'target-a');
  const b = cacheKeyFor('Mesmo Nome', 'target-b');
  assert.notStrictEqual(a, b);
});
