import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempFile = path.join(os.tmpdir(), `server-test-presets-${Date.now()}.json`);
process.env.PRESETS_FILE = tempFile;
process.env.NODE_ENV = 'test';

const { app } = await import('../src/server.js');

let baseUrl: string;

test.before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(tempFile, { force: true });
});

async function api(pathName: string, opts?: RequestInit): Promise<Response> {
  return fetch(baseUrl + pathName, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
}

test('GET /api/version retorna uma versao', async () => {
  const res = await api('/api/version');
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(typeof body.version, 'string');
});

test('GET /api/presets comeca vazio', async () => {
  const res = await api('/api/presets');
  assert.deepStrictEqual(await res.json(), []);
});

test('POST /api/presets cria, GET /api/presets lista', async () => {
  const created = await (
    await api('/api/presets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Teste', steps: [] }),
    })
  ).json();
  assert.strictEqual(created.name, 'Teste');
  assert.ok(created.id);

  const list = await (await api('/api/presets')).json();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'Teste');
});

test('POST /api/presets em paralelo nunca gera ids repetidos', async () => {
  // Date.now() so tem resolucao de milissegundo -- duas criacoes bem rapidas
  // (ex: clique duplo, script) colidiam antes de trocar pra crypto.randomUUID.
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      api('/api/presets', { method: 'POST', body: JSON.stringify({ name: `Paralelo${i}`, steps: [] }) }).then((r) => r.json())
    )
  );
  const ids = results.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length);

  // limpa
  await Promise.all(ids.map((id) => api(`/api/presets/${id}`, { method: 'DELETE' })));
});

test('PUT /api/presets/:id atualiza; id desconhecido da 404', async () => {
  const list = await (await api('/api/presets')).json();
  const id = list[0].id;

  const updated = await (
    await api(`/api/presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ pinned: true }),
    })
  ).json();
  assert.strictEqual(updated.pinned, true);

  const notFound = await api('/api/presets/nao-existe', {
    method: 'PUT',
    body: JSON.stringify({ pinned: true }),
  });
  assert.strictEqual(notFound.status, 404);
});

test('POST /api/presets/:id/run em id desconhecido da 404', async () => {
  const res = await api('/api/presets/nao-existe/run', { method: 'POST' });
  assert.strictEqual(res.status, 404);
});

test('GET /api/export manda Content-Disposition de download', async () => {
  const res = await api('/api/export');
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="rigdeck-backup-.*\.json"/);
  const body = await res.json();
  assert.strictEqual(body.length, 1);
});

test('POST /api/import substitui a lista inteira; rejeita corpo que nao e array', async () => {
  const bad = await api('/api/import', { method: 'POST', body: JSON.stringify({ not: 'array' }) });
  assert.strictEqual(bad.status, 400);

  const novos = [{ id: 'a', name: 'Importado', steps: [] }];
  const ok = await api('/api/import', { method: 'POST', body: JSON.stringify(novos) });
  assert.strictEqual(ok.status, 200);

  const list = await (await api('/api/presets')).json();
  assert.deepStrictEqual(list, novos);
});

test('DELETE /api/presets/:id remove', async () => {
  const res = await api('/api/presets/a', { method: 'DELETE' });
  assert.strictEqual((await res.json()).ok, true);
  const list = await (await api('/api/presets')).json();
  assert.deepStrictEqual(list, []);
});

test('POST /api/presets/:id/move troca de posicao só com os irmãos (mesma parentId)', async () => {
  await api('/api/import', {
    method: 'POST',
    body: JSON.stringify([
      { id: 'x1', name: 'Um', parentId: null, steps: [] },
      { id: 'x2', name: 'Dois', parentId: null, steps: [] },
      { id: 'x3', name: 'Tres', parentId: null, steps: [] },
      { id: 'y1', name: 'Filho', parentId: 'x1', steps: [] },
    ]),
  });

  // sobe "Dois" -- troca com "Um"
  let list = await (
    await api('/api/presets/x2/move', {
      method: 'POST',
      body: JSON.stringify({ direction: 'up' }),
    })
  ).json();
  assert.deepStrictEqual(
    list.map((p: { id: string }) => p.id),
    ['x2', 'x1', 'x3', 'y1']
  );

  // ja esta no topo do seu grupo -- sobe de novo, fica igual (no-op)
  list = await (
    await api('/api/presets/x2/move', {
      method: 'POST',
      body: JSON.stringify({ direction: 'up' }),
    })
  ).json();
  assert.deepStrictEqual(
    list.map((p: { id: string }) => p.id),
    ['x2', 'x1', 'x3', 'y1']
  );

  // desce "x1" -- so tem um irmao (y1, parentId diferente) entao nao mexe com x3
  list = await (
    await api('/api/presets/y1/move', {
      method: 'POST',
      body: JSON.stringify({ direction: 'down' }),
    })
  ).json();
  assert.deepStrictEqual(
    list.map((p: { id: string }) => p.id),
    ['x2', 'x1', 'x3', 'y1']
  );

  const notFound = await api('/api/presets/nada/move', {
    method: 'POST',
    body: JSON.stringify({ direction: 'up' }),
  });
  assert.strictEqual(notFound.status, 404);
});
