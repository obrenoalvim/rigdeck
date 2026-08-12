import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rigdeck-obs-')), 'config.json');
process.env.OBS_CONFIG_PATH = configPath;

const { sendObsRequest, getObsConfig } = await import('../src/lib/obs.js');

function writeConfig(overrides: Record<string, unknown>) {
  fs.writeFileSync(configPath, JSON.stringify({ server_enabled: true, server_port: 0, server_password: 'senha123', ...overrides }));
}

// Mesma formula do handshake real (protocolo v5), calculada aqui de forma
// independente pra provar que obs.ts gera a auth response certa, e nao so
// que "manda alguma string".
function expectedAuth(password: string, salt: string, challenge: string): string {
  const secretHash = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secretHash + challenge).digest('base64');
}

test.after(() => {
  fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
  delete process.env.OBS_CONFIG_PATH;
});

test('getObsConfig lanca erro claro quando config nao existe', () => {
  process.env.OBS_CONFIG_PATH = path.join(os.tmpdir(), 'rigdeck-obs-inexistente', 'config.json');
  assert.throws(() => getObsConfig(), /config do obs-websocket nao encontrado/);
  process.env.OBS_CONFIG_PATH = configPath;
});

test('sendObsRequest rejeita quando servidor websocket do OBS esta desligado', async () => {
  writeConfig({ server_enabled: false });
  await assert.rejects(() => sendObsRequest('GetSceneList'), /servidor WebSocket do OBS esta desligado/);
});

test('sendObsRequest completa handshake de auth e resolve com a responseData', async () => {
  const wss = new WebSocketServer({ port: 0 });
  const salt = 'salt-fake';
  const challenge = 'challenge-fake';
  let receivedAuth: string | null = null;

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { salt, challenge } } }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 1) {
        receivedAuth = msg.d.authentication;
        ws.send(JSON.stringify({ op: 2, d: {} }));
      } else if (msg.op === 6) {
        assert.strictEqual(msg.d.requestType, 'GetSceneList');
        ws.send(JSON.stringify({ op: 7, d: { requestStatus: { result: true }, responseData: { scenes: [{ sceneName: 'Cena 1' }] } } }));
      }
    });
  });

  try {
    const port = (wss.address() as { port: number }).port;
    writeConfig({ server_port: port, server_password: 'senha123' });

    const result = await sendObsRequest('GetSceneList');

    assert.strictEqual(receivedAuth, expectedAuth('senha123', salt, challenge));
    assert.deepStrictEqual(result, { scenes: [{ sceneName: 'Cena 1' }] });
  } finally {
    wss.close();
  }
});

test('sendObsRequest rejeita com a mensagem do OBS quando o request falha', async () => {
  const wss = new WebSocketServer({ port: 0 });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 0, d: { rpcVersion: 1 } }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 1) ws.send(JSON.stringify({ op: 2, d: {} }));
      else if (msg.op === 6) ws.send(JSON.stringify({ op: 7, d: { requestStatus: { result: false, code: 604, comment: 'cena nao existe' } } }));
    });
  });

  try {
    const port = (wss.address() as { port: number }).port;
    writeConfig({ server_port: port, server_password: '' });

    await assert.rejects(() => sendObsRequest('SetCurrentProgramScene', { sceneName: 'Nao Existe' }), /cena nao existe/);
  } finally {
    wss.close();
  }
});

test('sendObsRequest rejeita rapido com mensagem clara quando OBS fecha o socket por senha errada (close code 4009), sem esperar o timeout de 8s', async () => {
  const wss = new WebSocketServer({ port: 0 });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { salt: 's', challenge: 'c' } } }));
    // OBS real fecha a conexao com 4009 assim que o Identify (op 1) chega com
    // auth invalida -- nao manda op:2 nem op:7, so fecha o socket.
    ws.on('message', () => ws.close(4009, 'Authentication failed.'));
  });

  try {
    const port = (wss.address() as { port: number }).port;
    writeConfig({ server_port: port, server_password: 'senha-errada' });

    const start = Date.now();
    await assert.rejects(() => sendObsRequest('GetSceneList'), /senha do OBS incorreta/);
    assert.ok(Date.now() - start < 2000, 'nao deveria esperar o timeout de 8s pra reportar senha errada');
  } finally {
    wss.close();
  }
});
