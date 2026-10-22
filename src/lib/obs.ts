import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_PATH =
  process.env.OBS_CONFIG_PATH ??
  path.join(os.homedir(), 'AppData', 'Roaming', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');

interface ObsConfig {
  server_enabled: boolean;
  server_port: number;
  server_password: string;
}

export function getObsConfig(): ObsConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config do obs-websocket nao encontrado -- OBS instalado e ja foi aberto ao menos uma vez?');
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function computeAuth(password: string, salt: string, challenge: string): string {
  const secretHash = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secretHash + challenge).digest('base64');
}

export function sendObsRequest(requestType: string, requestData: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let config: ObsConfig;
    try {
      config = getObsConfig();
    } catch (e) {
      return reject(e);
    }
    if (!config.server_enabled) return reject(new Error('servidor WebSocket do OBS esta desligado (Tools > WebSocket Server Settings)'));

    const ws = new WebSocket(`ws://127.0.0.1:${config.server_port}`);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      ws.terminate();
      reject(new Error('timeout conectando no OBS -- ta aberto?'));
    }, 8000);

    const done = (err: Error | null, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      if (err) reject(err);
      else resolve(value ?? {});
    };

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.op === 0) {
        const identify: { rpcVersion: number; authentication?: string } = { rpcVersion: msg.d.rpcVersion };
        if (msg.d.authentication) {
          identify.authentication = computeAuth(config.server_password, msg.d.authentication.salt, msg.d.authentication.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
      } else if (msg.op === 2) {
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: 'rigdeck', requestData } }));
      } else if (msg.op === 7) {
        const status = msg.d.requestStatus;
        if (status.result) {
          done(null, msg.d.responseData || {});
        } else {
          done(new Error(status.comment || `OBS recusou o pedido (code ${status.code})`));
        }
      }
    });

    ws.on('error', (err) => done(err));

    ws.on('close', (code, reasonBuf) => {
      if (code === 4009) return done(new Error('senha do OBS incorreta (config do obs-websocket desatualizada?)'));
      const reason = reasonBuf?.toString();
      done(new Error(reason ? `OBS fechou a conexao: ${reason}` : `OBS fechou a conexao (code ${code})`));
    });
  });
}
