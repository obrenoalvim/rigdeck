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
import { runPreset, killPreset } from './lib/executor.js';
import { launch } from './lib/launch.js';
import { extractIcon } from './lib/icons.js';
import { getStats } from './lib/stats.js';
import { scanDir } from './lib/fs-scan.js';
import { log, logError } from './lib/log.js';
import type { Monitor, Preset, Program } from './types.js';

process.on('uncaughtException', (err) => logError('uncaughtException', err.stack ?? err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4321;
const SERVER_VERSION = String(Date.now());
const PROJECT_ROOT = path.join(__dirname, '..');
const store = createStore(process.env.PRESETS_FILE ?? path.join(PROJECT_ROOT, 'presets.json'));
const GET_MONITORS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'get-monitors.ps1');
const GET_PROGRAMS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'get-programs.ps1');

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

app.post<{ Params: { id: string } }>('/api/presets/:id/run', async (request, reply) => {
  const preset = store.get(request.params.id);
  if (!preset) return reply.code(404).send({ error: 'not found' });
  log(`running preset "${preset.name}" (${preset.id}):`, JSON.stringify(preset.steps));
  try {
    const monitors = await getMonitors();
    log('monitors detected:', JSON.stringify(monitors));
    const results = await runPreset(preset, monitors);
    log(`preset "${preset.name}" results:`, JSON.stringify(results));
    const failed = results.filter((r) => !r.ok);
    if (failed.length) logError(`preset "${preset.name}" step failures:`, JSON.stringify(failed));
    return { results };
  } catch (e) {
    const err = e as Error;
    logError(`POST /api/presets/${request.params.id}/run failed:`, err.stack ?? err.message);
    return reply.code(500).send({ error: err.message });
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
