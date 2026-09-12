import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/presets-store.js';
import { parseMonitorsOutput } from './lib/monitors.js';
import { parseProgramsOutput } from './lib/programs.js';
import { runPreset, killPreset, killByPath, playSound, sendKey } from './lib/executor.js';
import { launch } from './lib/launch.js';
import { extractIcon } from './lib/icons.js';
import { lookupIcon } from './lib/icon-fetch.js';
import { getStats } from './lib/stats.js';
import { scanDir } from './lib/fs-scan.js';
import { log, logError } from './lib/log.js';
import { translateKeybind } from './lib/keybind.js';
import {
  getAudioState,
  setAudioVolume,
  subscribeMeters,
  getEqState,
  setEq,
  getVoiceState,
  setVoiceEffect,
} from './lib/audio.js';
import { sendObsRequest } from './lib/obs.js';
import type { Monitor, Preset, Program, Sound } from './types.js';

process.on('uncaughtException', (err) => logError('uncaughtException', err.stack ?? err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4321;
const SERVER_VERSION = String(Date.now());
const PROJECT_ROOT = path.join(__dirname, '..');
const store = createStore<Preset>(process.env.PRESETS_FILE ?? path.join(PROJECT_ROOT, 'presets.json'));
const soundsStore = createStore<Sound>(process.env.SOUNDS_FILE ?? path.join(PROJECT_ROOT, 'sounds.json'));
const GET_MONITORS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'get-monitors.ps1');
const GET_PROGRAMS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'get-programs.ps1');
const GET_FOREGROUND_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'get-foreground-process.ps1');
const GET_NOW_PLAYING_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'get-now-playing.ps1');

function runPowershell<T>(scriptPath: string, parse: (stdout: string) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(parse(stdout));
      }
    );
  });
}

function getMonitors(): Promise<Monitor[]> {
  return runPowershell(GET_MONITORS_SCRIPT, parseMonitorsOutput);
}

let programsCache: Promise<Program[]> | null = null;
function getPrograms(): Promise<Program[]> {
  if (programsCache) return programsCache;
  programsCache = runPowershell(GET_PROGRAMS_SCRIPT, parseProgramsOutput).catch((e) => {
    programsCache = null;
    throw e;
  });
  return programsCache;
}

const app = Fastify({ logger: false });

// Fastify's default JSON parser 400s on an empty body declared as
// application/json (FST_ERR_CTP_EMPTY_JSON_BODY) -- but the frontend always
// sends that content-type even for bodyless calls (DELETE, /run, /kill), so
// the stock behavior would break every one of those in real use. Treat an
// empty body as {} instead, same as Express's json() middleware does.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = body as string;
  if (!text) return done(null, {});
  try {
    done(null, JSON.parse(text));
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.addHook('onRequest', (request, _reply, done) => {
  (request as { startTime?: number }).startTime = Date.now();
  done();
});

// preHandler (not onRequest) -- body parsing happens between onRequest and
// preHandler, so this is the first point request.body is actually populated.
app.addHook('preHandler', (request, _reply, done) => {
  if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
    log(`${request.method} ${request.url} body:`, JSON.stringify(request.body ?? {}));
  }
  done();
});

app.addHook('onResponse', (request, reply, done) => {
  const start = (request as { startTime?: number }).startTime ?? Date.now();
  const line = `${request.method} ${request.url} ${reply.statusCode} ${Date.now() - start}ms`;
  if (reply.statusCode >= 400) logError(line);
  else log(line);
  done();
});

await app.register(fastifyStatic, { root: path.join(PROJECT_ROOT, 'public') });

app.get('/api/version', async () => ({ version: SERVER_VERSION }));

app.get('/api/presets', async () => store.list());

function fsFolderPathError(body: Partial<Preset>): string | null {
  if (body.kind !== 'fs-folder') return null;
  const p = body.path;
  if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
    return 'caminho invalido ou nao e uma pasta';
  }
  return null;
}

app.post<{ Body: Partial<Preset> }>('/api/presets', async (request, reply) => {
  const error = fsFolderPathError(request.body);
  if (error) return reply.code(400).send({ error });
  const preset = { ...request.body, id: request.body.id ?? randomUUID() } as Preset;
  return store.create(preset);
});

app.put<{ Params: { id: string }; Body: Partial<Preset> }>('/api/presets/:id', async (request, reply) => {
  const error = fsFolderPathError(request.body);
  if (error) return reply.code(400).send({ error });
  const updated = store.update(request.params.id, request.body);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

app.delete<{ Params: { id: string } }>('/api/presets/:id', async (request) => {
  store.remove(request.params.id);
  return { ok: true };
});

app.post<{ Params: { id: string }; Body: { direction?: string } }>('/api/presets/:id/move', async (request, reply) => {
  const direction = request.body.direction === 'up' ? 'up' : 'down';
  const list = store.list();
  const idx = list.findIndex((p) => p.id === request.params.id);
  if (idx === -1) return reply.code(404).send({ error: 'not found' });

  const item = list[idx];
  const siblings = list
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (p.parentId ?? null) === (item.parentId ?? null));
  const pos = siblings.findIndex(({ p }) => p.id === item.id);
  const swapPos = direction === 'up' ? pos - 1 : pos + 1;
  if (swapPos < 0 || swapPos >= siblings.length) return list;

  const otherIdx = siblings[swapPos].i;
  [list[idx], list[otherIdx]] = [list[otherIdx], list[idx]];
  store.replaceAll(list);
  return list;
});

app.get('/api/monitors', async (_request, reply) => {
  try {
    return await getMonitors();
  } catch (e) {
    const err = e as Error;
    logError('GET /api/monitors failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.get('/api/programs', async (_request, reply) => {
  try {
    return await getPrograms();
  } catch (e) {
    const err = e as Error;
    logError('GET /api/programs failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.post('/api/programs/refresh', async (_request, reply) => {
  programsCache = null;
  try {
    return await getPrograms();
  } catch (e) {
    const err = e as Error;
    logError('POST /api/programs/refresh failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

function runPowershellArgs<T>(args: string[], timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(String(stdout).trim()));
      } catch {
        reject(new Error('bad script output'));
      }
    });
  });
}

// Processo em foreground -- usado pelo frontend pra trocar de pasta sozinho
// quando o jogo/app associado a ela ganha foco (troca de perfil contextual).
app.get('/api/active-window', async (_request, reply) => {
  try {
    return await runPowershellArgs(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', GET_FOREGROUND_SCRIPT], 5000);
  } catch (e) {
    return reply.code(500).send({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/media/now-playing', async (_request, reply) => {
  try {
    return await runPowershellArgs(
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', GET_NOW_PLAYING_SCRIPT],
      8000
    );
  } catch (e) {
    return reply.code(500).send({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/export', async (_request, reply) => {
  const date = new Date().toISOString().slice(0, 10);
  reply.header('Content-Disposition', `attachment; filename="rigdeck-backup-${date}.json"`);
  return store.list();
});

app.post<{ Body: Preset[] }>('/api/import', async (request, reply) => {
  const data = request.body;
  if (!Array.isArray(data)) return reply.code(400).send({ error: 'esperado um array de presets' });
  store.replaceAll(data);
  log(`import: substituiu store por ${data.length} itens`);
  return { ok: true, count: data.length };
});

app.get('/api/stats', async (_request, reply) => {
  try {
    return await getStats();
  } catch (e) {
    const err = e as Error;
    logError('GET /api/stats failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.get<{ Querystring: { path?: string } }>('/api/icon', async (request, reply) => {
  const target = request.query.path;
  if (!target || !/\.exe$/i.test(target)) return reply.code(404).send();
  const buf = await extractIcon(target);
  if (!buf) return reply.code(404).send();
  reply.header('Content-Type', 'image/png');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(buf);
});

// Fallback quando nao ha icone local (Epic games, exe sem icone embutido):
// busca por nome na Steam Store (sem chave) e cacheia a capa em disco --
// so bate na rede na primeira vez, depois serve do cache local direto.
app.get<{ Querystring: { name?: string; target?: string } }>('/api/icon/lookup', async (request, reply) => {
  const { name, target } = request.query;
  if (!name) return reply.code(400).send({ error: 'name obrigatorio' });
  try {
    const filePath = await lookupIcon(name, target);
    if (!filePath) return reply.code(404).send();
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(filePath));
  } catch (e) {
    const err = e as Error;
    logError('GET /api/icon/lookup failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.get('/api/audio', async (_request, reply) => {
  try {
    return await getAudioState();
  } catch (e) {
    const err = e as Error;
    logError('GET /api/audio failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.post<{ Body: { volume?: number; muted?: boolean } }>('/api/audio/master', async (request, reply) => {
  try {
    await setAudioVolume({ target: 'master', volume: request.body.volume, muted: request.body.muted });
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    logError('POST /api/audio/master failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.post<{ Body: { volume?: number; muted?: boolean } }>('/api/audio/mic', async (request, reply) => {
  try {
    await setAudioVolume({ target: 'mic', volume: request.body.volume, muted: request.body.muted });
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    logError('POST /api/audio/mic failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.post<{ Params: { pid: string }; Body: { volume?: number; muted?: boolean } }>(
  '/api/audio/session/:pid',
  async (request, reply) => {
    try {
      await setAudioVolume({ target: 'session', pid: request.params.pid, volume: request.body.volume, muted: request.body.muted });
      return { ok: true };
    } catch (e) {
      const err = e as Error;
      logError(`POST /api/audio/session/${request.params.pid} failed:`, err.message);
      return reply.code(500).send({ error: err.message });
    }
  }
);

// VU meter ao vivo -- SSE em vez de poll: fica aberto so enquanto o mixer
// tiver na tela (frontend fecha o EventSource ao fechar o modal), o unsubscribe
// (via close da conexao) derruba o processo PowerShell residente quando
// ninguem mais ouve. reply.hijack() tira o Fastify do caminho da resposta --
// sem isso ele tenta finalizar a reply sozinho assim que o handler retorna,
// o que fecharia o stream SSE na hora.
app.get('/api/audio/meters', async (request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const unsubscribe = subscribeMeters((data) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  });
  request.raw.on('close', unsubscribe);
  reply.raw.on('error', unsubscribe);
});

app.get('/api/audio/eq', async (_request, reply) => {
  try {
    return getEqState();
  } catch (e) {
    const err = e as Error;
    logError('GET /api/audio/eq failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.post<{ Body: { bass?: number; treble?: number } }>('/api/audio/eq', async (request, reply) => {
  try {
    return { ok: true, ...setEq({ bass: request.body.bass, treble: request.body.treble }) };
  } catch (e) {
    const err = e as Error;
    logError('POST /api/audio/eq failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

app.get('/api/audio/voice', async () => getVoiceState());

app.post<{ Body: { voice?: string; pitch?: number; enabled?: boolean } }>('/api/audio/voice', async (request, reply) => {
  try {
    return await setVoiceEffect({ voice: request.body.voice, pitch: request.body.pitch, enabled: request.body.enabled });
  } catch (e) {
    const err = e as Error;
    logError('POST /api/audio/voice failed:', err.message);
    return reply.code(500).send({ error: err.message });
  }
});

// Le a lista de cenas direto do OBS (via websocket) pra popular o dropdown
// do editor -- se o OBS nao estiver aberto/websocket desligado, devolve
// lista vazia (editor cai pro campo de texto livre) em vez de quebrar a tela.
app.get('/api/obs/scenes', async () => {
  try {
    const { scenes } = (await sendObsRequest('GetSceneList')) as { scenes: Array<{ sceneName: string }> };
    return scenes.map((s) => s.sceneName);
  } catch {
    return [];
  }
});

app.get('/api/sounds', async () => soundsStore.list());

// Som local (toca no PC, so quem estiver no PC ouve) OU keybind do Discord
// (aciona um som ja cadastrado no Soundboard nativo do Discord -- a mistura
// com a voz acontece dentro do proprio Discord, sem precisar rotear
// dispositivo de audio nenhum. Trocar o dispositivo padrao do sistema pra
// isso foi tentado e descartado: bagunca outros apps de audio rodando
// junto, como o proprio gravador/call que a feature deveria ajudar).
app.post<{ Body: { name?: string; path?: string; keybind?: string } }>('/api/sounds', async (request, reply) => {
  const { name, path: soundPath, keybind } = request.body;
  if (!name || (!soundPath && !keybind)) {
    return reply.code(400).send({ error: 'nome e (caminho ou atalho) obrigatorios' });
  }
  if (soundPath && !fs.existsSync(soundPath)) {
    return reply.code(400).send({ error: 'arquivo nao encontrado nesse caminho' });
  }
  if (keybind) {
    try {
      translateKeybind(keybind);
    } catch (e) {
      return reply.code(400).send({ error: `atalho invalido: ${(e as Error).message}` });
    }
  }
  return soundsStore.create({ id: randomUUID(), name, path: soundPath ?? null, keybind: keybind ?? null });
});

app.delete<{ Params: { id: string } }>('/api/sounds/:id', async (request) => {
  soundsStore.remove(request.params.id);
  return { ok: true };
});

app.post<{ Params: { id: string } }>('/api/sounds/:id/play', async (request, reply) => {
  const sound = soundsStore.get(request.params.id);
  if (!sound) return reply.code(404).send({ error: 'not found' });
  try {
    return sound.keybind ? await sendKey(translateKeybind(sound.keybind)) : await playSound(sound.path!);
  } catch (e) {
    const err = e as Error;
    logError(`POST /api/sounds/${request.params.id}/play failed:`, err.message);
    return reply.code(500).send({ error: err.message });
  }
});

// Navegacao de pasta do disco: raiz cadastrada num preset kind=fs-folder,
// ai o front dispara /fs/list a cada nivel (sempre le o disco na hora, nunca
// vira preset salvo) e /fs/open pra rodar o arquivo clicado.
// ponytail: sem confinamento de path a raiz cadastrada -- app ja nao tem
// autenticacao e ja permite passo cmd com comando arbitrario, entao restringir
// so essas duas rotas nao mudaria o modelo de confianca (rede local).
app.get<{ Querystring: { path?: string } }>('/api/fs/list', async (request, reply) => {
  const target = request.query.path;
  if (!target) return reply.code(400).send({ error: 'path obrigatorio' });
  try {
    if (!fs.statSync(target).isDirectory()) return reply.code(400).send({ error: 'nao e uma pasta' });
    return { entries: scanDir(target) };
  } catch {
    return reply.code(404).send({ error: 'pasta nao encontrada' });
  }
});

app.post<{ Body: { path?: string } }>('/api/fs/open', async (request, reply) => {
  const target = request.body.path;
  if (!target || !fs.existsSync(target)) return reply.code(404).send({ error: 'arquivo nao encontrado' });
  log(`fs/open: ${target}`);
  launch(target);
  return { ok: true };
});

app.post<{ Body: { path?: string } }>('/api/fs/kill', async (request, reply) => {
  const target = request.body.path;
  if (!target) return reply.code(400).send({ error: 'path obrigatorio' });
  log(`fs/kill: ${target}`);
  return killByPath(target);
});

// Streama um resultado por linha (NDJSON) a medida que cada step termina,
// em vez de so responder no final -- preset com varios steps (ex: abrir
// Spotify + Brave + VSCode) deixava o usuario sem feedback nenhum ate tudo
// rodar. Compatibilidade: preset de 1 step so continua parecendo instantaneo.
app.post<{ Params: { id: string } }>('/api/presets/:id/run', async (request, reply) => {
  const preset = store.get(request.params.id);
  if (!preset) return reply.code(404).send({ error: 'not found' });
  log(`running preset "${preset.name}" (${preset.id}):`, JSON.stringify(preset.steps));
  reply.hijack();
  reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  try {
    const monitors = await getMonitors();
    log('monitors detected:', JSON.stringify(monitors));
    const results = await runPreset(preset, monitors, (entry, index, total) => {
      reply.raw.write(JSON.stringify({ type: 'step', index, total, ...entry }) + '\n');
    });
    log(`preset "${preset.name}" results:`, JSON.stringify(results));
    const failed = results.filter((r) => !r.ok);
    if (failed.length) logError(`preset "${preset.name}" step failures:`, JSON.stringify(failed));
    reply.raw.write(JSON.stringify({ type: 'done', results }) + '\n');
    reply.raw.end();
  } catch (e) {
    const err = e as Error;
    logError(`POST /api/presets/${request.params.id}/run failed:`, err.stack ?? err.message);
    reply.raw.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
    reply.raw.end();
  }
});

app.post<{ Params: { id: string } }>('/api/presets/:id/kill', async (request, reply) => {
  const preset = store.get(request.params.id);
  if (!preset) return reply.code(404).send({ error: 'not found' });
  log(`killing processes for preset "${preset.name}" (${preset.id})`);
  try {
    const results = await killPreset(preset);
    log(`kill results for "${preset.name}":`, JSON.stringify(results));
    return { results };
  } catch (e) {
    const err = e as Error;
    logError(`POST /api/presets/${request.params.id}/kill failed:`, err.stack ?? err.message);
    return reply.code(500).send({ error: err.message });
  }
});

// Barra de midia fixa no rodape -- nao e um preset (nao aparece na lista do
// editor, nao precisa de pasta), e um controle fixo sempre visivel. Reusa
// runPreset com um preset descartavel montado na hora, ja que a logica de
// passo "key" nao depende de estar salvo em lugar nenhum.
const MEDIA_ACTIONS = ['PLAY_PAUSE', 'NEXT', 'PREV', 'VOLUME_UP', 'VOLUME_DOWN', 'MUTE'];
app.post<{ Params: { action: string } }>('/api/media/:action', async (request, reply) => {
  const action = request.params.action.toUpperCase();
  if (!MEDIA_ACTIONS.includes(action)) return reply.code(400).send({ error: 'acao invalida' });
  try {
    const results = await runPreset({ id: 'media-bar', steps: [{ type: 'key', key: action }] } as Preset, []);
    return { results };
  } catch (e) {
    const err = e as Error;
    logError(`POST /api/media/${action} failed:`, err.stack ?? err.message);
    return reply.code(500).send({ error: err.message });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      logError('failed to start server:', err);
      process.exit(1);
    }
    log(`rigdeck server on ${address}`);
  });
}

export { app };
