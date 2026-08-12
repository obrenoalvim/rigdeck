import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// obs-websocket vem embutido no OBS desde a v28 (sem plugin pra instalar).
// A senha/porta ficam no proprio arquivo de config do OBS -- le direto de
// la em vez de pedir pro usuario copiar/colar, mesmo espirito do resto do
// projeto (detecta e usa o que ja existe, sem passo manual extra).
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

// Handshake de auth do protocolo v5: sha256(base64(sha256(senha+salt)) + challenge),
// documentado em https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#authentication
function computeAuth(password: string, salt: string, challenge: string): string {
  const secretHash = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secretHash + challenge).digest('base64');
}

// Conexao nova por chamada (mesmo padrao "stateless" dos scripts PowerShell
// do resto do projeto) -- acao de OBS e tipicamente um clique isolado (trocar
// cena, mutar mic), nao precisa de conexao residente pra isso.
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

    // OBS fecha o socket sem 'error' e sem responder o request em varios
    // casos (senha errada, rpcVersion nao suportada) -- sem isso, a promise
    // so rejeita 8s depois com mensagem generica de timeout, escondendo o
    // motivo real. Codes documentados em WebSocketCloseCode do protocolo v5.
    ws.on('close', (code, reasonBuf) => {
      if (code === 4009) return done(new Error('senha do OBS incorreta (config do obs-websocket desatualizada?)'));
      const reason = reasonBuf?.toString();
      done(new Error(reason ? `OBS fechou a conexao: ${reason}` : `OBS fechou a conexao (code ${code})`));
    });
  });
}
